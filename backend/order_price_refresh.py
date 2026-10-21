"""Safe automatic checkout price refresh for SmartBasket.

Search a retailer automatically using *hints*, but accept a price only from a
freshly indexed result whose product ID and retailer exactly match the basket.
Never substitute a fuzzy match, a price from the browser, or old scraper data.
"""
import asyncio
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

MAX_REFRESH_IDS = 12
MAX_CONCURRENT = 6
MAX_SEARCH_TERMS = 3
MAX_LOOKUP_SECONDS = 19
STORE_KEYS = {
    'Pick n Pay': 'pnp',
    'Shoprite': 'shoprite',
    'Checkers': 'checkers',
    'Woolworths': 'woolworths',
}
KEY_STORES = {value: key for key, value in STORE_KEYS.items()}


def retailer_for_id(pid):
    if not isinstance(pid, str) or len(pid) > 100 or '_' not in pid:
        return None
    key, suffix = pid.split('_', 1)
    if key not in KEY_STORES or not suffix or not re.fullmatch(r'[\w-]+', suffix):
        return None
    return KEY_STORES[key]


def product_search_terms(name):
    """Return bounded, increasingly broad queries for a known retailer SKU."""
    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 200:
        return []
    words = re.findall(r"[\w]+(?:[-'][\w]+)*", name, flags=re.UNICODE)
    if not words:
        return []
    terms = [' '.join(words[:12]), ' '.join(words[:6]), ' '.join(words[:3])]
    return list(dict.fromkeys(term for term in terms if len(term) >= 3))[:MAX_SEARCH_TERMS]


def valid_price(raw):
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not value.is_finite() or not Decimal('0') < value <= Decimal('100000'):
        return None
    return value.quantize(Decimal('0.01'))


def refresh_stale_checkout_offers(product_ids, *, Product, PriceHistory, db,
                                  scrapers, get_cached_data, run_async,
                                  logger=None, search_hints=None):
    """Try retailer lookups, persist exact fresh matches, return refreshed IDs.

    When a product hasn't been indexed into Product yet, a basket-supplied name
    may be used as a SEARCH HINT ONLY; never accept its price, store, SKU name,
    stock, or any other claims. A fresh retailer result must prove the exact ID.
    A successful cached search from the existing 12-hour window is acceptable;
    a stale-cache fallback returned after a network failure is NOT.
    """
    unique_ids = list(dict.fromkeys(str(pid) for pid in product_ids))[:MAX_REFRESH_IDS]
    hints = search_hints if isinstance(search_hints, dict) else {}
    targets = []
    for pid in unique_ids:
        retailer = retailer_for_id(pid)
        if retailer is None:
            continue
        record = db.session.get(Product, pid)
        if record is not None and record.store != retailer:
            continue
        key = STORE_KEYS[retailer]
        scraper = scrapers.get(key)
        if scraper is None:
            continue
        # Trust stored name first. Use the basket name only as a query hint,
        # especially for newly searched products not yet saved in the DB.
        names = [record.name if record is not None else None, hints.get(pid)]
        terms = []
        for name in names:
            for query in product_search_terms(name):
                if query not in terms:
                    terms.append(query)
        if terms:
            targets.append((pid, retailer, key, scraper, terms[:MAX_SEARCH_TERMS]))

    if not targets:
        return []

    async def gather():
        limiter = asyncio.Semaphore(MAX_CONCURRENT)

        async def look_up(target):
            pid, retailer, key, scraper, terms = target
            async with limiter:
                loop = asyncio.get_running_loop()
                deadline = loop.time() + MAX_LOOKUP_SECONDS
                for term in terms:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        break
                    try:
                        # The scraper must store a fresh cache entry. Simply
                        # inspecting its return value can accept stale fallback.
                        await asyncio.wait_for(
                            scraper(term, page_size=96), timeout=min(9, remaining)
                        )
                        payload, fresh = get_cached_data(key, term)
                        if not fresh or not isinstance(payload, list):
                            continue
                        for item in payload:
                            if (isinstance(item, dict)
                                    and str(item.get('id', '')) == pid
                                    and item.get('store') == retailer
                                    and valid_price(item.get('price')) is not None):
                                return pid, item
                    except (Exception,) as exc:
                        if logger:
                            logger.warning('Checkout retailer lookup failed (%s: %s)',
                                           key, type(exc).__name__)
            return None

        return await asyncio.gather(*(look_up(t) for t in targets))

    try:
        found = run_async(gather())
    except Exception:
        if logger:
            logger.exception('Checkout price refresh tasks failed')
        return []

    refreshed = []
    now = datetime.utcnow()
    try:
        for result in found:
            if result is None:
                continue
            pid, offer = result
            retailer = retailer_for_id(pid)
            if retailer is None or offer.get('store') != retailer:
                continue
            price = valid_price(offer.get('price'))
            if price is None:
                continue
            record = db.session.get(Product, pid)
            if record is None:
                # Only actual retailer responses may seed a missing catalog row.
                # This permits checkout after an ephemeral cache reset on Railway.
                real_name = str(offer.get('name') or '').strip()
                if not real_name or len(real_name) > 255:
                    continue
                record = Product(
                    id=pid, name=real_name, store=retailer, price=float(price),
                    formatted_price=f'R {price:.2f}',
                    image_url=str(offer.get('imageUrl') or '') or None,
                    product_url=str(offer.get('productUrl') or '') or None,
                    barcode=str(offer.get('barcode') or '')[:14] or None,
                    age_restricted=bool(offer.get('ageRestricted') or offer.get('age_restricted')),
                    catalog_category=str(offer.get('catalogCategory') or 'Other')[:48],
                    last_updated=now,
                )
                db.session.add(record)
                db.session.add(PriceHistory(
                    product_id=pid, price=float(price),
                    store_name=retailer, recorded_at=now,
                ))
            else:
                if record.store != retailer:
                    continue
                if valid_price(record.price) != price:
                    db.session.add(PriceHistory(
                        product_id=pid, price=float(price),
                        store_name=retailer, recorded_at=now,
                    ))
                record.price = float(price)
                record.formatted_price = f'R {price:.2f}'
                record.last_updated = now
                # Keep original metadata and existing restriction flags.
                record.age_restricted = bool(record.age_restricted or
                    offer.get('ageRestricted') or offer.get('age_restricted'))
            refreshed.append(pid)
        if refreshed:
            db.session.commit()
    except Exception:
        db.session.rollback()
        if logger:
            logger.exception('Failed to persist verified checkout prices')
        return []
    return refreshed
