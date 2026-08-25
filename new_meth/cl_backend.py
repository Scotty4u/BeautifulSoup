from concurrent.futures import ThreadPoolExecutor
import re
import time
from curl_cffi import requests  # Drop-in replacement that mimics real browser TLS fingerprints
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ==========================================
# CACHE CONFIGURATION
# ==========================================
SEARCH_CACHE = {}
CACHE_EXPIRATION_SECONDS = 3600  # 1 hour in seconds


def get_cached_data(store_key: str, query: str):
    key = (store_key.lower(), query.lower().strip())
    if key in SEARCH_CACHE:
        entry = SEARCH_CACHE[key]
        is_fresh = (time.time() - entry['timestamp']) < CACHE_EXPIRATION_SECONDS
        return entry['data'], is_fresh
    return None, False


def save_to_cache(store_key: str, query: str, data: list):
    if data:
        key = (store_key.lower(), query.lower().strip())
        SEARCH_CACHE[key] = {'timestamp': time.time(), 'data': data}


# ==========================================
# 1. PICK N PAY SCRAPER (WAF-Resilient)
# ==========================================
def get_pnp_high_res_image(images_list):
    if not images_list:
        return ''
    high_res_path = ''
    for img in images_list:
        if img.get('format', '').lower() in ['zoom', 'superzoom', 'product']:
            high_res_path = img.get('url', '')
            break
    if not high_res_path:
        high_res_path = images_list[-1].get('url', '')
    return (
        high_res_path
        if high_res_path.startswith('http')
        else f'https://www.pnp.co.za{high_res_path}'
    )


def scrape_pnp(query: str):
    cached_data, is_fresh = get_cached_data('pnp', query)
    if is_fresh:
        print(f"[CACHE HIT] Returning fresh Pick n Pay results for '{query}'")
        return cached_data

    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        ),
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.pnp.co.za',
        'Referer': f'https://www.pnp.co.za/search/{query}',
    }
    url = (
        'https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search'
        '?fields=products(variantMatrix(FULL)%2CproductIdForTracking%2CsponsoredProduct%2ConlineSalesAdId%2ConlineSalesExtendedAdId%2Ccode%2Cname%2CbrandSellerId%2CaverageWeight%2Csummary%2Cprice(FULL)%2Cimages(DEFAULT)%2Cstock(FULL)%2CaverageRating%2CnumberOfReviews%2CvariantOptions%2CmaxOrderQuantity%2CproductDisplayBadges(DEFAULT)%2CallowedQuantities(DEFAULT)%2Cavailable%2CquantityType%2CdefaultQuantityOfUom%2CinStockIndicator%2CdefaultUnitOfMeasure%2CpotentialPromotions(FULL)%2CcategoryNames)%2Cfacets%2Cbreadcrumbs%2Cpagination(DEFAULT)%2Csorts(DEFAULT)%2CfreeTextSearch%2CcurrentQuery%2CresponseJson%2CseoCategoryContent%2CseoCategoryTitle%2CrefinedContent%2CcategoryDescription%2CkeywordRedirectUrl'
        f'&query={query}&pageSize=36&storeCode=WC21&lang=en&curr=ZAR'
    )

    try:
        print(f"[LIVE FETCH] Scraping Pick n Pay for '{query}'")
        res = requests.post(url, headers=headers, json={}, impersonate='chrome120', timeout=10)
        if res.status_code == 200:
            products = res.json().get('products', [])
            extracted = [
                {
                    'id': f"pnp_{item.get('code')}",
                    'name': item.get('name'),
                    'store': 'Pick n Pay',
                    'price': float(item.get('price', {}).get('value', 0.0)),
                    'formattedPrice': item.get('price', {}).get('formattedValue', 'R0.00'),
                    'imageUrl': get_pnp_high_res_image(item.get('images', [])),
                }
                for item in products
            ]
            save_to_cache('pnp', query, extracted)
            return extracted
    except Exception as e:
        print(f'PnP Scraper Error: {e}')

    if cached_data is not None:
        print(f"[CACHE FALLBACK] Returning stale Pick n Pay data for '{query}'")
        return cached_data

    return []


# ==========================================
# 2. SHOPRITE SCRAPER (WAF-Resilient)
# ==========================================
def extract_shoprite_image(item: dict) -> str:
    raw_img = ''
    if item.get('imageId'):
        raw_img = item.get('imageId')
    elif item.get('images') and isinstance(item['images'], list) and len(item['images']) > 0:
        first = item['images'][0]
        if isinstance(first, dict):
            raw_img = (
                first.get('id')
                or first.get('fileId')
                or first.get('url')
                or first.get('src')
                or ''
            )
        elif isinstance(first, str):
            raw_img = first
    elif item.get('image'):
        raw_img = item.get('image')
    elif item.get('imageUrl'):
        raw_img = item.get('imageUrl')

    if not raw_img:
        return ''

    raw_img = str(raw_img).strip()
    if raw_img.startswith('http://') or raw_img.startswith('https://'):
        return raw_img
    if raw_img.startswith('//'):
        return f'https:{raw_img}'
    if '/' in raw_img:
        raw_img = raw_img.split('/')[-1]
    raw_img = raw_img.split('?')[0]

    return f'https://catalog.sixty60.co.za/v2/files/{raw_img}?width=400&height=400'


def scrape_shoprite(query: str):
    cached_data, is_fresh = get_cached_data('shoprite', query)
    if is_fresh:
        print(f"[CACHE HIT] Returning fresh Shoprite results for '{query}'")
        return cached_data

    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        ),
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.shoprite.co.za/',
        'Content-Type': 'application/json',
        'Origin': 'https://www.shoprite.co.za',
    }

    json_data = {
        'storeContexts': [],
        'filterData': {
            'filter': {
                'showAllDisplayVariants': False,
                'showNotRangedProducts': False,
                'productListSource': {'search': query},
                'paginationOptions': {'page': 0, 'pageSize': 36},
                'filterOptions': {'dealsOnly': False, 'serviceOptions': [], 'facetOptions': []},
                'sortOptions': None,
            },
            'displayOptions': {},
        },
        'forYouBonusBuyIds': [],
    }

    try:
        print(f"[LIVE FETCH] Scraping Shoprite for '{query}'")
        res = requests.post(
            'https://www.shoprite.co.za/api/catalogue/get-products-filter',
            headers=headers,
            json=json_data,
            impersonate='chrome120',
            timeout=10,
        )
        if res.status_code == 200:
            data = res.json()
            products = data.get('products', []) or data.get('filterResult', {}).get('products', [])

            extracted = []
            for item in products:
                raw_price = item.get('price', 0.0)
                if isinstance(raw_price, dict):
                    raw_price = raw_price.get('value', 0.0)

                extracted.append({
                    'id': f"shoprite_{item.get('code', item.get('id', ''))}",
                    'name': item.get('name', item.get('title', '')),
                    'store': 'Shoprite',
                    'price': float(raw_price),
                    'formattedPrice': f"R {float(raw_price):.2f}",
                    'imageUrl': extract_shoprite_image(item),
                })
            save_to_cache('shoprite', query, extracted)
            return extracted
    except Exception as e:
        print(f'Shoprite Scraper Error: {e}')

    if cached_data is not None:
        print(f"[CACHE FALLBACK] Returning stale Shoprite data for '{query}'")
        return cached_data

    return []


# ==========================================
# 3. SEARCH ENDPOINT
# ==========================================
@app.route('/api/search', methods=['GET'])
def handle_search():
    query = request.args.get('q', '').strip().lower()
    store_filter = request.args.get('store', 'all').strip().lower()
    sort_option = request.args.get('sort', '').strip().lower()

    if not query:
        return jsonify([])

    pnp_results = []
    shoprite_results = []

    run_pnp = store_filter in ['all', 'pnp', 'pick n pay', 'picknpay']
    run_shoprite = store_filter in ['all', 'shoprite']

    if run_pnp and run_shoprite:
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_pnp = executor.submit(scrape_pnp, query)
            future_shoprite = executor.submit(scrape_shoprite, query)
            pnp_results = future_pnp.result()
            shoprite_results = future_shoprite.result()
    elif run_pnp:
        pnp_results = scrape_pnp(query)
    elif run_shoprite:
        shoprite_results = scrape_shoprite(query)

    if run_pnp and run_shoprite and not sort_option:
        combined = []
        max_len = max(len(pnp_results), len(shoprite_results))
        for i in range(max_len):
            if i < len(pnp_results):
                combined.append(pnp_results[i])
            if i < len(shoprite_results):
                combined.append(shoprite_results[i])
    else:
        combined = pnp_results + shoprite_results

    if sort_option in ['asc', 'price_asc', 'low_to_high', 'low-to-high']:
        combined.sort(key=lambda x: x['price'])
    elif sort_option in ['desc', 'price_desc', 'high_to_low', 'high-to-low']:
        combined.sort(key=lambda x: x['price'], reverse=True)

    return jsonify(combined)


# ==========================================
# 4. CATEGORIES ENDPOINT
# ==========================================
@app.route('/api/categories', methods=['GET'])
def get_categories():
    categories = {
        'Dairy & Essentials': ['Fresh Milk', 'Brown Bread', 'Large Eggs', 'Butter'],
        'Pantry Staples': ['White Sugar', 'Sunflower Oil', 'White Maize Meal', 'Long Grain Rice'],
        'Beverages & Household': ['Coffee', 'Ceylon Tea', 'Toilet Paper', 'Cold Drink'],
    }

    response_data = {}

    def fetch_category_items(cat_name, items):
        cat_products = []
        for query in items:
            pnp = scrape_pnp(query)[:2]
            shoprite = scrape_shoprite(query)[:2]
            cat_products.extend(pnp + shoprite)
        return cat_name, cat_products

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(fetch_category_items, cat, items)
            for cat, items in categories.items()
        ]
        for future in futures:
            cat_name, cat_products = future.result()
            response_data[cat_name] = cat_products

    return jsonify(response_data)


# ==========================================
# 5. EXACT-SIZE CROSS-STORE PRICE COMPARISON (Enhanced Matching)
# ==========================================
@app.route('/api/compare', methods=['GET'])
def compare_product():
    product_name = request.args.get('name', '').strip()
    current_store = request.args.get('store', '').strip().lower()
    current_price = float(request.args.get('price', 0.0))

    if not product_name:
        return jsonify({'found': False})

    # --------------------------------------------------
    # Helpers
    # --------------------------------------------------
    def normalise_size(text):
        """
        Return a canonical size string e.g. '2l', '500g', '100pk'.
        Handles weight/volume AND pack counts like '100 Pack' or '26 Bags'.
        """
        # Weight / volume (more specific — try first)
        wv = re.search(
            r'\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l|mg|litres?)\b',
            text, re.IGNORECASE
        )
        if wv:
            value, unit = wv.group(1), wv.group(2).lower()
            unit = re.sub(r'litres?', 'l', unit)
            val = float(value)
            if unit == 'ml' and val >= 1000:
                val, unit = val / 1000, 'l'
            if unit == 'g' and val >= 1000:
                val, unit = val / 1000, 'kg'
            val_str = str(int(val)) if val == int(val) else str(val)
            return f"{val_str}{unit}"

        # Pack / count: "100 Pack", "26 Bags", "12 Rolls", "x6", etc.
        pk = re.search(
            r'\b(\d+)\s*(?:pack|packs|bags?|rolls?|tablets?|tabs?|sachets?|'
            r'teabags?|capsules?|sheets?|wipes?|nappies|diapers?|bars?|slices?|'
            r'pieces?|pcs?|units?|count|ct)\b'
            r'|\bx\s*(\d+)\b'
            r'|\b(\d+)\s*x\b',
            text, re.IGNORECASE
        )
        if pk:
            count = pk.group(1) or pk.group(2) or pk.group(3)
            return f"{count}pk"

        return None

    # Words that carry no product meaning
    STOP = {'with', 'and', 'the', 'for', 'of', 'in', 'a', 'by', 'per'}

    # Adjectives that commonly differ between stores for the same product
    FILLER = re.compile(
        r'\b(full|low|fat|free|range|value|plain|natural|original|classic|'
        r'tagless|tagged|string|superior|quality|premium|extra|select|'
        r'strong|mild|rich|smooth|blend|blended|pure|imported|african|ceylon)\b',
        re.I
    )

    def tokenise(text):
        """Meaningful word tokens with adjectives stripped."""
        text = FILLER.sub('', text.lower())
        return {
            w for w in re.findall(r'[a-z]+', text)
            if len(w) > 2 and w not in STOP
        }

    # Brand: first capitalised word in the name
    brand_match = re.match(r'([A-Z][a-zA-Z]+)', product_name.strip())
    brand = brand_match.group(1).lower() if brand_match else ''

    # Core noun: first meaningful word that isn't the brand or a numeric/size token
    size_token_re = re.compile(r'^\d+(?:kg|g|ml|l|mg|pk)?$', re.I)
    noun_candidates = [
        w for w in re.findall(r'[a-zA-Z]+', product_name)
        if w.lower() not in STOP
        and w.lower() != brand
        and not size_token_re.match(w)
    ]
    core_noun = noun_candidates[0].lower() if noun_candidates else ''

    current_size = normalise_size(product_name)

    # Build search query for the other store using the raw size string from the name
    raw_size_match = re.search(
        r'\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|mg|litres?|pack|packs|bags?|rolls?|pk)\b',
        product_name, re.IGNORECASE
    )
    raw_size_str = raw_size_match.group(0) if raw_size_match else (current_size or '')
    query_parts = [p for p in [brand, core_noun, raw_size_str] if p]
    search_query = ' '.join(query_parts) if query_parts else product_name[:40]

    # --------------------------------------------------
    # Fetch alternatives from the other store
    # --------------------------------------------------
    if 'pick' in current_store or 'pnp' in current_store:
        alternatives = scrape_shoprite(search_query)
    else:
        alternatives = scrape_pnp(search_query)

    if not alternatives:
        return jsonify({'found': False})

    # --------------------------------------------------
    # Score each alternative (max 3 points)
    # --------------------------------------------------
    current_tokens = tokenise(product_name)

    def score_match(alt):
        alt_name = alt['name']
        alt_size = normalise_size(alt_name)

        # Hard filter: sizes must match if either product has one.
        # A 100-pack must not match a 26-pack, and a sized product
        # must not match an unsized one.
        if current_size or alt_size:
            if current_size != alt_size:
                return -1

        score = 0
        alt_tokens = tokenise(alt_name)

        # Brand match (+1)
        if brand and brand in alt_tokens:
            score += 1

        # Core noun match (+1)
        if core_noun and core_noun in alt_tokens:
            score += 1

        # Explicit size agreement (+1)
        if current_size and alt_size and current_size == alt_size:
            score += 1

        # Token overlap tiebreaker (up to +0.5)
        overlap = len(current_tokens & alt_tokens)
        score += min(overlap, 1) * 0.5

        return score

    # Must hit brand + noun + matching size to qualify
    SCORE_THRESHOLD = 3

    scored = [(alt, score_match(alt)) for alt in alternatives]
    valid = [(alt, s) for alt, s in scored if s >= SCORE_THRESHOLD]

    if not valid:
        return jsonify({'found': False})

    # Pick the cheapest among valid matches
    cheapest_alt = min(valid, key=lambda x: x[0]['price'])[0]

    if cheapest_alt['price'] < current_price and current_price > 0:
        diff = current_price - cheapest_alt['price']
        percent_cheaper = round((diff / current_price) * 100)
        return jsonify({
            'found': True,
            'cheaper': True,
            'percent': percent_cheaper,
            'product': cheapest_alt,
        })
    elif cheapest_alt['price'] > current_price:
        return jsonify({
            'found': True,
            'cheaper': False,
            'product': cheapest_alt,
        })

    return jsonify({'found': False})


if __name__ == '__main__':
    app.run(port=5000, debug=True)