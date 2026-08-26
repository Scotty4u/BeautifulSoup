import asyncio
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
from typing import Dict, List, Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from fake_useragent import UserAgent
from flask import Flask, jsonify, request
from flask_cors import CORS
import httpx
from playwright.async_api import async_playwright

app = Flask(__name__)
CORS(app)

# ==========================================
# CONFIGURATION & PERSISTENT PATHS
# ==========================================
DB_FILE = os.path.join(tempfile.gettempdir(), "smartbasket_cache.db")
CACHE_EXPIRATION_SECONDS = 43200  # 12 Hours

WAF_TOKEN_CACHE: Dict[str, dict] = {
    'pnp': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
    'shoprite': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
    'checkers': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
}

PROXY_URL = os.getenv("RESIDENTIAL_PROXY_URL", None)
ua_generator = UserAgent()

# Concurrency control & keep-alive connection pooling
HTTP_SEMAPHORE = asyncio.Semaphore(5)
HTTP_CLIENT = httpx.AsyncClient(
    proxy=PROXY_URL if PROXY_URL else None,
    limits=httpx.Limits(max_keepalive_connections=20, max_connections=30),
    timeout=10.0,
    follow_redirects=True,
)

POPULAR_STAPLES = [
    'Fresh Milk', 'Brown Bread', 'Large Eggs', 'Butter',
    'White Sugar', 'Sunflower Oil', 'White Maize Meal', 'Long Grain Rice',
    'Coffee', 'Ceylon Tea', 'Toilet Paper', 'Cold Drink'
]

# ==========================================
# SQLITE PERSISTENT CACHE
# ==========================================
def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS search_cache (
                store_key TEXT,
                query TEXT,
                data TEXT,
                timestamp REAL,
                PRIMARY KEY (store_key, query)
            )
        """)
        conn.commit()


def get_cached_data(store_key: str, query: str):
    store_key_clean = store_key.lower()
    query_clean = query.lower().strip()
    try:
        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data, timestamp FROM search_cache WHERE store_key = ? AND query = ?",
                (store_key_clean, query_clean)
            )
            row = cursor.fetchone()
            if row:
                data_json, timestamp = row
                is_fresh = (time.time() - timestamp) < CACHE_EXPIRATION_SECONDS
                return json.loads(data_json), is_fresh
    except Exception as e:
        print(f"[DB ERROR] Fetch failed: {e}")
    return None, False


def save_to_cache(store_key: str, query: str, data: list):
    if not data:
        return
    store_key_clean = store_key.lower()
    query_clean = query.lower().strip()
    data_json = json.dumps(data)
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO search_cache (store_key, query, data, timestamp) VALUES (?, ?, ?, ?)",
                (store_key_clean, query_clean, data_json, time.time())
            )
            conn.commit()
    except Exception as e:
        print(f"[DB ERROR] Save failed: {e}")


# ==========================================
# DYNAMIC HEADERS & HARVESTER
# ==========================================
def get_dynamic_headers(store_key: str, referer: str = '') -> dict:
    token_data = WAF_TOKEN_CACHE.get(store_key, {})
    user_agent = token_data.get('user_agent') or ua_generator.random
    waf_token = token_data.get('waf_token', '')

    headers = {
        'User-Agent': user_agent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    }

    if referer:
        headers['Referer'] = referer
    if waf_token:
        headers['x-aws-waf-token'] = waf_token

    return headers


async def harvest_tokens_for_store(context, store_key: str, url: str):
    try:
        page = await context.new_page()
        print(f"[WAF HARVESTER] Refreshing tokens for {store_key.upper()}...")
        await page.goto(url, wait_until='commit', timeout=45000)
        await asyncio.sleep(4)

        cookies = await context.cookies()
        cookie_dict = {c['name']: c['value'] for c in cookies}
        waf_token = cookie_dict.get('aws-waf-token', '')
        user_agent = await page.evaluate("navigator.userAgent")

        WAF_TOKEN_CACHE[store_key] = {
            'cookies': cookie_dict,
            'waf_token': waf_token,
            'user_agent': user_agent,
            'updated': time.time(),
        }
        print(f"[WAF HARVESTER] Success for {store_key.upper()}")
        await page.close()
    except Exception as e:
        print(f"[WAF HARVESTER ERROR] {store_key}: {e}")


async def token_refresh_loop(interval_seconds: int = 1200):
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
        )
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        )

        while True:
            await harvest_tokens_for_store(context, 'pnp', 'https://www.pnp.co.za')
            await harvest_tokens_for_store(context, 'shoprite', 'https://www.shoprite.co.za')
            await harvest_tokens_for_store(context, 'checkers', 'https://www.checkers.co.za')
            await asyncio.sleep(interval_seconds)


# ==========================================
# STORE SCRAPERS
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
    return high_res_path if high_res_path.startswith('http') else f'https://www.pnp.co.za{high_res_path}'


async def scrape_pnp(query: str, page_size: int = 16):
    cached_data, is_fresh = get_cached_data('pnp', query)
    if is_fresh:
        return cached_data

    headers = get_dynamic_headers('pnp', referer=f'https://www.pnp.co.za/search/{query}')
    url = (
        'https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search'
        '?fields=products(code%2Cname%2Cprice(FULL)%2Cimages(DEFAULT))'
        f'&query={query}&pageSize={page_size}&storeCode=WC21&lang=en&curr=ZAR'
    )

    async with HTTP_SEMAPHORE:
        # Retry loop to handle Pick n Pay's aggressive temporary 403 blocks or timeouts
        for attempt in range(2):
            try:
                # Enforce a strict 5-second timeout per attempt to prevent hanging
                res = await HTTP_CLIENT.post(url, headers=headers, json={}, timeout=5.0)
                
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
                
                elif res.status_code in [403, 429]:
                    print(f"PnP Attempt {attempt + 1} blocked ({res.status_code}). Refreshing headers...")
                    headers = get_dynamic_headers('pnp', referer=f'https://www.pnp.co.za/search/{query}')
                    await asyncio.sleep(1) # Brief pause before retry
                    
            except Exception as e:
                print(f'PnP Scraper Attempt {attempt + 1} Exception: {e}')

    return cached_data if cached_data is not None else []


def extract_shoprite_image(item: dict) -> str:
    raw_img = item.get('imageId') or ''
    if not raw_img and item.get('images') and isinstance(item['images'], list) and len(item['images']) > 0:
        first = item['images'][0]
        raw_img = first.get('id', '') if isinstance(first, dict) else str(first)

    if not raw_img:
        return ''

    raw_img = str(raw_img).strip()
    if raw_img.startswith(('http://', 'https://')):
        return raw_img
    if raw_img.startswith('//'):
        return f'https:{raw_img}'
    if '/' in raw_img:
        raw_img = raw_img.split('/')[-1]

    return f'https://catalog.sixty60.co.za/v2/files/{raw_img.split("?")[0]}?width=400&height=400'


async def scrape_shoprite(query: str, page_size: int = 16):
    cached_data, is_fresh = get_cached_data('shoprite', query)
    if is_fresh:
        return cached_data

    headers = get_dynamic_headers('shoprite', referer='https://www.shoprite.co.za/')
    json_data = {
        'storeContexts': [],
        'filterData': {
            'filter': {
                'showAllDisplayVariants': False,
                'showNotRangedProducts': False,
                'productListSource': {'search': query},
                'paginationOptions': {'page': 0, 'pageSize': page_size},
                'filterOptions': {'dealsOnly': False, 'serviceOptions': [], 'facetOptions': []},
                'sortOptions': None,
            },
            'displayOptions': {},
        },
        'forYouBonusBuyIds': [],
    }

    async with HTTP_SEMAPHORE:
        try:
            res = await HTTP_CLIENT.post(
                'https://www.shoprite.co.za/api/catalogue/get-products-filter',
                headers=headers,
                json=json_data,
                timeout=6.0
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
            print(f'Shoprite Scraper Exception: {e}')

    return cached_data if cached_data is not None else []


async def scrape_checkers(query: str, page_size: int = 16):
    cached_data, is_fresh = get_cached_data('checkers', query)
    if is_fresh:
        return cached_data

    headers = get_dynamic_headers('checkers', referer=f'https://www.checkers.co.za/search?Search={query}')
    json_data = {
        'storeContexts': [],
        'filterData': {
            'filter': {
                'showAllDisplayVariants': False,
                'showNotRangedProducts': False,
                'productListSource': {'search': query},
                'paginationOptions': {'page': 0, 'pageSize': page_size},
                'filterOptions': {
                    'filterIds': [], 'dealsOnly': False, 'brandOptions': [],
                    'departmentOptions': [], 'serviceOptions': [], 'facetOptions': [],
                },
                'sortOptions': None,
            },
            'displayOptions': {'includeDisplayCategoryTree': True},
        },
        'forYouBonusBuyIds': [],
    }

    async with HTTP_SEMAPHORE:
        try:
            res = await HTTP_CLIENT.post(
                'https://www.checkers.co.za/api/catalogue/get-products-filter',
                headers=headers,
                json=json_data,
                timeout=6.0
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
                        'id': f"checkers_{item.get('code', item.get('id', ''))}",
                        'name': item.get('name', item.get('title', '')),
                        'store': 'Checkers',
                        'price': float(raw_price),
                        'formattedPrice': f"R {float(raw_price):.2f}",
                        'imageUrl': extract_shoprite_image(item),
                    })
                save_to_cache('checkers', query, extracted)
                return extracted
        except Exception as e:
            print(f'Checkers Scraper Exception: {e}')

    return cached_data if cached_data is not None else []


# ==========================================
# SCHEDULED ETL PRE-SCRAPING PIPELINE
# ==========================================
def run_etl_pipeline():
    print("[ETL PIPELINE] Pre-scraping staples across stores...")

    async def fetch_all_staples():
        tasks = []
        for item in POPULAR_STAPLES:
            tasks.append(scrape_pnp(item, page_size=8))
            tasks.append(scrape_shoprite(item, page_size=8))
            tasks.append(scrape_checkers(item, page_size=8))
        await asyncio.gather(*tasks)

    try:
        asyncio.run(fetch_all_staples())
        print("[ETL PIPELINE] Completed pass successfully.")
    except Exception as e:
        print(f"[ETL PIPELINE ERROR] Failed: {e}")


def start_etl_scheduler():
    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(run_etl_pipeline, 'interval', hours=12)
    scheduler.start()
    threading.Thread(target=run_etl_pipeline, daemon=True).start()


# ==========================================
# ROUTES & ENDPOINTS
# ==========================================
@app.route('/favicon.ico')
def favicon():
    return '', 204


@app.route('/api/search', methods=['GET'])
def handle_search():
    query = request.args.get('q', '').strip().lower()
    store_filter = request.args.get('store', 'all').strip().lower()
    sort_option = request.args.get('sort', '').strip().lower()

    if not query:
        return jsonify([])

    async def run_search():
        tasks = []
        if store_filter in ['all', 'pnp', 'pick n pay', 'picknpay']:
            tasks.append(scrape_pnp(query, page_size=24))
        else:
            tasks.append(asyncio.sleep(0, result=[]))

        if store_filter in ['all', 'shoprite']:
            tasks.append(scrape_shoprite(query, page_size=24))
        else:
            tasks.append(asyncio.sleep(0, result=[]))

        if store_filter in ['all', 'checkers']:
            tasks.append(scrape_checkers(query, page_size=24))
        else:
            tasks.append(asyncio.sleep(0, result=[]))

        return await asyncio.gather(*tasks)

    pnp_results, shoprite_results, checkers_results = asyncio.run(run_search())

    if not sort_option:
        combined = []
        max_len = max(len(pnp_results), len(shoprite_results), len(checkers_results))
        for i in range(max_len):
            if i < len(pnp_results):
                combined.append(pnp_results[i])
            if i < len(shoprite_results):
                combined.append(shoprite_results[i])
            if i < len(checkers_results):
                combined.append(checkers_results[i])
    else:
        combined = pnp_results + shoprite_results + checkers_results

    if sort_option in ['asc', 'price_asc', 'low_to_high', 'low-to-high']:
        combined.sort(key=lambda x: x['price'])
    elif sort_option in ['desc', 'price_desc', 'high_to_low', 'high-to-low']:
        combined.sort(key=lambda x: x['price'], reverse=True)

    return jsonify(combined)


@app.route('/api/categories', methods=['GET'])
def get_categories():
    categories = {
        'Dairy & Essentials': ['Fresh Milk', 'Brown Bread', 'Large Eggs', 'Butter'],
        'Pantry Staples': ['White Sugar', 'Sunflower Oil', 'White Maize Meal', 'Long Grain Rice'],
        'Beverages & Household': ['Coffee', 'Ceylon Tea', 'Toilet Paper', 'Cold Drink'],
    }

    response_data = {}
    for cat_name, items in categories.items():
        cat_products = []
        for q in items:
            pnp_items = (get_cached_data('pnp', q)[0] or [])[:2]
            shoprite_items = (get_cached_data('shoprite', q)[0] or [])[:2]
            checkers_items = (get_cached_data('checkers', q)[0] or [])[:2]
            cat_products.extend(pnp_items + shoprite_items + checkers_items)
        response_data[cat_name] = cat_products

    return jsonify(response_data)


@app.route('/api/compare', methods=['GET'])
def compare_product():
    product_name = request.args.get('name', '').strip()
    current_store = request.args.get('store', '').strip().lower()
    try:
        current_price = float(request.args.get('price', 0.0))
    except (ValueError, TypeError):
        current_price = 0.0

    if not product_name:
        return jsonify({'found': False})

    def normalise_size(text):
        wv = re.search(r'\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l|mg|litres?)\b', text, re.IGNORECASE)
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

        pk = re.search(
            r'\b(\d+)\s*(?:pack|packs|bags?|rolls?|tablets?|tabs?|sachets?|teabags?|capsules?|sheets?|wipes?|nappies|diapers?|bars?|slices?|pieces?|pcs?|units?|count|ct)\b|\bx\s*(\d+)\b|\b(\d+)\s*x\b',
            text, re.IGNORECASE
        )
        if pk:
            count = pk.group(1) or pk.group(2) or pk.group(3)
            return f"{count}pk"

        return None

    STOP = {'with', 'and', 'the', 'for', 'of', 'in', 'a', 'by', 'per'}
    FILLER = re.compile(
        r'\b(full|low|fat|free|range|value|plain|natural|original|classic|tagless|tagged|string|superior|quality|premium|extra|select|strong|mild|rich|smooth|blend|blended|pure|imported|african|ceylon)\b',
        re.I
    )

    def tokenise(text):
        text = FILLER.sub('', text.lower())
        return {w for w in re.findall(r'[a-z]+', text) if len(w) > 2 and w not in STOP}

    brand_match = re.match(r'([A-Z][a-zA-Z]+)', product_name.strip())
    brand = brand_match.group(1).lower() if brand_match else ''
    size_token_re = re.compile(r'^\d+(?:kg|g|ml|l|mg|pk)?$', re.I)

    noun_candidates = [
        w for w in re.findall(r'[a-zA-Z]+', product_name)
        if w.lower() not in STOP and w.lower() != brand and not size_token_re.match(w)
    ]
    core_noun = noun_candidates[0].lower() if noun_candidates else ''
    current_size = normalise_size(product_name)

    raw_size_match = re.search(r'\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|mg|litres?|pack|packs|bags?|rolls?|pk)\b', product_name, re.IGNORECASE)
    raw_size_str = raw_size_match.group(0) if raw_size_match else (current_size or '')
    query_parts = [p for p in [brand, core_noun, raw_size_str] if p]
    search_query = ' '.join(query_parts) if query_parts else product_name[:40]

    async def run_compare():
        tasks = []
        if 'pick' in current_store or 'pnp' in current_store:
            tasks.append(scrape_shoprite(search_query, page_size=8))
            tasks.append(scrape_checkers(search_query, page_size=8))
        elif 'shoprite' in current_store:
            tasks.append(scrape_pnp(search_query, page_size=8))
            tasks.append(scrape_checkers(search_query, page_size=8))
        elif 'checkers' in current_store:
            tasks.append(scrape_pnp(search_query, page_size=8))
            tasks.append(scrape_shoprite(search_query, page_size=8))
        else:
            tasks.append(scrape_pnp(search_query, page_size=8))
            tasks.append(scrape_shoprite(search_query, page_size=8))
            tasks.append(scrape_checkers(search_query, page_size=8))

        fetched_lists = await asyncio.gather(*tasks)
        alts = []
        for flist in fetched_lists:
            alts.extend(flist)
        return alts

    alternatives = asyncio.run(run_compare())
    if not alternatives:
        return jsonify({'found': False})

    current_tokens = tokenise(product_name)

    def score_match(alt):
        alt_name = alt['name']
        alt_size = normalise_size(alt_name)
        if current_size or alt_size:
            if current_size != alt_size:
                return -1

        score = 0
        alt_tokens = tokenise(alt_name)
        if brand and brand in alt_tokens:
            score += 1
        if core_noun and core_noun in alt_tokens:
            score += 1
        if current_size and alt_size and current_size == alt_size:
            score += 1

        overlap = len(current_tokens & alt_tokens)
        score += min(overlap, 1) * 0.5
        return score

    SCORE_THRESHOLD = 3
    scored = [(alt, score_match(alt)) for alt in alternatives]
    valid = [(alt, s) for alt, s in scored if s >= SCORE_THRESHOLD]

    if not valid:
        return jsonify({'found': False})

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


# ==========================================
# APP STARTUP
# ==========================================
def start_background_harvester():
    def run_loop():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(token_refresh_loop())

    thread = threading.Thread(target=run_loop, daemon=True)
    thread.start()


if __name__ == '__main__':
    init_db()

    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_background_harvester()
        start_etl_scheduler()

    app.run(port=5000, debug=True)