import asyncio
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
import difflib
from datetime import datetime
from typing import Dict, List, Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from fake_useragent import UserAgent
from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
import httpx
from playwright.async_api import async_playwright

app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

# ==========================================
# DATABASE & CONFIGURATION
# ==========================================
db_path = os.path.join(tempfile.gettempdir(), 'smartbasket.db')
if os.path.exists(db_path):
    try:
        os.remove(db_path)
    except Exception:
        pass

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + db_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

with app.app_context():
    db.create_all()

CACHE_DB_FILE = os.path.join(tempfile.gettempdir(), "smartbasket_cache.db")
CACHE_EXPIRATION_SECONDS = 43200  # 12 Hours

WAF_TOKEN_CACHE: Dict[str, dict] = {
    'pnp': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
    'shoprite': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
    'checkers': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
    'woolworths': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
}

PROXY_URL = os.getenv("RESIDENTIAL_PROXY_URL", None)
ua_generator = UserAgent()

# Loop-safe dynamic management to prevent event loop binding errors
_semaphores = {}
def get_http_semaphore():
    loop = asyncio.get_running_loop()
    if loop not in _semaphores:
        _semaphores[loop] = asyncio.Semaphore(5)
    return _semaphores[loop]

_http_client = None
def get_http_client():
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            proxy=PROXY_URL if PROXY_URL else None,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=30),
            timeout=10.0,
            follow_redirects=True,
        )
    return _http_client

# ==========================================
# SQLALCHEMY DATABASE MODELS
# ==========================================
class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    baskets = db.relationship('SavedBasket', backref='owner', lazy=True, cascade="all, delete-orphan")

class Product(db.Model):
    __tablename__ = 'products'
    id = db.Column(db.String(100), primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    store = db.Column(db.String(50), nullable=False)
    price = db.Column(db.Float, nullable=False)
    formatted_price = db.Column(db.String(20))
    image_url = db.Column(db.Text)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)

class SavedBasket(db.Model):
    __tablename__ = 'saved_baskets'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    items = db.relationship('BasketItem', backref='basket', lazy=True, cascade="all, delete-orphan")

class BasketItem(db.Model):
    __tablename__ = 'basket_items'
    id = db.Column(db.Integer, primary_key=True)
    basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    product_id = db.Column(db.String(100), db.ForeignKey('products.id'), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    price = db.Column(db.Float, nullable=True)
    competitor_prices = db.Column(db.Text, nullable=True)
    product = db.relationship('Product')

with app.app_context():
    db.create_all()

# ==========================================
# SEARCH CACHE (SQLite Helper)
# ==========================================
def init_cache_db():
    with sqlite3.connect(CACHE_DB_FILE) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS search_cache (
                store_key TEXT, query TEXT, data TEXT, timestamp REAL,
                PRIMARY KEY (store_key, query)
            )
        """)
        conn.commit()

def get_cached_data(store_key: str, query: str):
    store_key_clean, query_clean = store_key.lower(), query.lower().strip()
    try:
        with sqlite3.connect(CACHE_DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data, timestamp FROM search_cache WHERE store_key = ? AND query = ?", (store_key_clean, query_clean))
            row = cursor.fetchone()
            if row:
                data_json, timestamp = row
                if (time.time() - timestamp) < CACHE_EXPIRATION_SECONDS:
                    return json.loads(data_json), True
    except Exception:
        pass
    return None, False

def save_to_cache(store_key: str, query: str, data: list):
    if not data: return
    try:
        with sqlite3.connect(CACHE_DB_FILE) as conn:
            conn.execute("INSERT OR REPLACE INTO search_cache (store_key, query, data, timestamp) VALUES (?, ?, ?, ?)",
                         (store_key.lower(), query.lower().strip(), json.dumps(data), time.time()))
            conn.commit()
    except Exception:
        pass

def log_search_results_to_db(products_list):
    try:
        with app.app_context():
            for item in products_list:
                existing = Product.query.get(item['id'])
                if not existing:
                    new_p = Product(
                        id=item['id'],
                        name=item['name'],
                        store=item['store'],
                        price=float(item['price']),
                        formatted_price=item.get('formattedPrice', f"R {float(item['price']):.2f}"),
                        image_url=item.get('imageUrl', '')
                    )
                    db.session.add(new_p)
            db.session.commit()
    except Exception:
        db.session.rollback()

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
        'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
    }
    if referer: headers['Referer'] = referer
    if waf_token: headers['x-aws-waf-token'] = waf_token
    return headers

async def harvest_tokens_for_store(context, store_key: str, url: str):
    try:
        page = await context.new_page()
        await page.goto(url, wait_until='commit', timeout=45000)
        await asyncio.sleep(4)
        cookies = await context.cookies()
        cookie_dict = {c['name']: c['value'] for c in cookies}
        WAF_TOKEN_CACHE[store_key] = {
            'cookies': cookie_dict,
            'waf_token': cookie_dict.get('aws-waf-token', ''),
            'user_agent': await page.evaluate("navigator.userAgent"),
            'updated': time.time(),
        }
        await page.close()
    except Exception:
        pass

def refresh_tokens_sync():
    async def run_harvest():
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True, 
                args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
            )
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            )
            await harvest_tokens_for_store(context, 'pnp', 'https://www.pnp.co.za')
            await harvest_tokens_for_store(context, 'shoprite', 'https://www.shoprite.co.za')
            await harvest_tokens_for_store(context, 'checkers', 'https://www.checkers.co.za')
            await browser.close()
            
    print("[Scheduler] Harvesting WAF tokens...")
    asyncio.run(run_harvest())
    print("[Scheduler] Token harvest complete.")

# ==========================================
# 7-STEP MATCHING & UTILITIES
# ==========================================
def optimize_search_query(query: str) -> str:
    cleaned = re.sub(r'\b(pnp|woolworths|shoprite|checkers|finest|store|superior|sliced|thick slice|fresh)\b', '', query, flags=re.IGNORECASE)
    words = [w for w in cleaned.split() if len(w) > 1][:5]
    return " ".join(words).strip()

def extract_size(product_name: str):
    match = re.search(r'(\d+(?:\.\d+)?\s*(?:ml|l|g|kg|litre|litres))', product_name, flags=re.IGNORECASE)
    if match:
        return match.group(1).replace(" ", "").lower()
    return None

def filter_and_score_competitors(original_name: str, scraped_results: list) -> list:
    """
    Uses token intersection and semantic keyword matching to find store equivalents
    regardless of retail naming differences, enforcing size matching.
    """
    target_size = extract_size(original_name)
    
    # Common descriptive filler words to ignore during semantic comparison
    stop_words = {'the', 'and', 'fresh', 'superior', 'sliced', 'thick', 'slice', 'grade', 'full', 'cream', 'long', 'life', 'white', 'brown', 'regular', 'classic'}
    
    def get_clean_tokens(name):
        cleaned = re.sub(r'(\d+(?:\.\d+)?\s*(?:ml|l|g|kg|litre|litres))', '', name, flags=re.IGNORECASE)
        words = re.findall(r'\b[a-zA-Z]{2,}\b', cleaned.lower())
        return {w for w in words if w not in stop_words}

    target_tokens = get_clean_tokens(original_name)
    
    store_groups = {}
    for item in scraped_results:
        if item.get('price', 0) <= 0:
            continue
        store = item.get('store', 'Unknown')
        if store not in store_groups:
            store_groups[store] = []
        store_groups[store].append(item)
        
    final_results = []
    
    for store, items in store_groups.items():
        best_match = None
        highest_score = 0
        is_exact = False
        
        for item in items:
            item_name = item.get('name', '')
            item_size = extract_size(item_name)
            
            # Size Rule: If both specify sizes, they must match
            if target_size and item_size and target_size != item_size:
                continue
                
            item_tokens = get_clean_tokens(item_name)
            if not target_tokens or not item_tokens:
                continue
                
            # Calculate token intersection (shared core words like brand + product type)
            intersection = target_tokens.intersection(item_tokens)
            union = target_tokens.union(item_tokens)
            jaccard_score = len(intersection) / len(union) if union else 0
            seq_similarity = difflib.SequenceMatcher(None, original_name.lower(), item_name.lower()).ratio()
            
            # Require shared core identity tokens to qualify as a valid match
            if len(intersection) >= min(2, len(target_tokens)) or jaccard_score >= 0.35:
                score = jaccard_score + (seq_similarity * 0.5)
                
                if score > highest_score:
                    highest_score = score
                    best_match = item
                    # Strict string match determines if it's an exact match vs store equivalent badge
                    is_exact = bool(seq_similarity >= 0.70 or target_tokens == item_tokens)

        if best_match:
            best_match['is_exact_match'] = is_exact
            best_match['isExact'] = is_exact
            final_results.append(best_match)
        elif items:
            # Fallback to the lowest-priced item of the identical size in that store
            same_size = [i for i in items if not target_size or extract_size(i.get('name', '')) == target_size]
            pool = same_size if same_size else items
            pool.sort(key=lambda x: x['price'])
            fallback = pool[0]
            fallback['is_exact_match'] = False
            fallback['isExact'] = False
            final_results.append(fallback)
            
    final_results.sort(key=lambda x: x['price'])
    return final_results

# ==========================================
# STORE SCRAPERS
# ==========================================
def get_pnp_high_res_image(images_list):
    if not images_list: return ''
    high_res_path = ''
    for img in images_list:
        if img.get('format', '').lower() in ['zoom', 'superzoom', 'product']:
            high_res_path = img.get('url', '')
            break
    if not high_res_path: high_res_path = images_list[-1].get('url', '')
    return high_res_path if high_res_path.startswith('http') else f'https://www.pnp.co.za{high_res_path}'

async def scrape_pnp(query: str, page_size: int = 16):
    cached_data, is_fresh = get_cached_data('pnp', query)
    if is_fresh: return cached_data
    headers = get_dynamic_headers('pnp', referer=f'https://www.pnp.co.za/search/{query}')
    url = f'https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search?fields=products(code%2Cname%2Cprice(FULL)%2Cimages(DEFAULT))&query={query}&pageSize={page_size}&storeCode=WC21&lang=en&curr=ZAR'
    
    async with get_http_semaphore():
        for attempt in range(2):
            try:
                res = await get_http_client().post(url, headers=headers, json={}, timeout=5.0)
                if res.status_code == 200:
                    products = res.json().get('products', [])
                    extracted = [{
                        'id': f"pnp_{item.get('code')}",
                        'name': item.get('name'),
                        'store': 'Pick n Pay',
                        'price': float(item.get('price', {}).get('value', 0.0)),
                        'formattedPrice': item.get('price', {}).get('formattedValue', 'R0.00'),
                        'imageUrl': get_pnp_high_res_image(item.get('images', [])),
                    } for item in products]
                    save_to_cache('pnp', query, extracted)
                    return extracted
                elif res.status_code in [403, 429]:
                    headers = get_dynamic_headers('pnp', referer=f'https://www.pnp.co.za/search/{query}')
                    await asyncio.sleep(1)
            except Exception:
                pass
    return cached_data if cached_data is not None else []

def extract_shoprite_image(item: dict) -> str:
    raw_img = item.get('imageId') or ''
    if not raw_img and item.get('images') and isinstance(item['images'], list) and len(item['images']) > 0:
        first = item['images'][0]
        raw_img = first.get('id', '') if isinstance(first, dict) else str(first)
    if not raw_img: return ''
    raw_img = str(raw_img).strip()
    if raw_img.startswith(('http://', 'https://')): return raw_img
    if raw_img.startswith('//'): return f'https:{raw_img}'
    if '/' in raw_img: raw_img = raw_img.split('/')[-1]
    return f'https://catalog.sixty60.co.za/v2/files/{raw_img.split("?")[0]}?width=400&height=400'

async def scrape_shoprite(query: str, page_size: int = 16):
    cached_data, is_fresh = get_cached_data('shoprite', query)
    if is_fresh: return cached_data
    headers = get_dynamic_headers('shoprite', referer='https://www.shoprite.co.za/')
    json_data = {'storeContexts': [], 'filterData': {'filter': {'showAllDisplayVariants': False, 'showNotRangedProducts': False, 'productListSource': {'search': query}, 'paginationOptions': {'page': 0, 'pageSize': page_size}, 'filterOptions': {'dealsOnly': False, 'serviceOptions': [], 'facetOptions': []}, 'sortOptions': None}, 'displayOptions': {}}, 'forYouBonusBuyIds': []}
    
    async with get_http_semaphore():
        try:
            res = await get_http_client().post('https://www.shoprite.co.za/api/catalogue/get-products-filter', headers=headers, json=json_data, timeout=6.0)
            if res.status_code == 200:
                products = res.json().get('products', []) or res.json().get('filterResult', {}).get('products', [])
                extracted = [{
                    'id': f"shoprite_{item.get('code', item.get('id', ''))}",
                    'name': item.get('name', item.get('title', '')),
                    'store': 'Shoprite',
                    'price': float(item.get('price', {}).get('value', 0.0) if isinstance(item.get('price'), dict) else item.get('price', 0.0)),
                    'formattedPrice': f"R {float(item.get('price', {}).get('value', 0.0) if isinstance(item.get('price'), dict) else item.get('price', 0.0)):.2f}",
                    'imageUrl': extract_shoprite_image(item),
                } for item in products]
                save_to_cache('shoprite', query, extracted)
                return extracted
        except Exception:
            pass
    return cached_data if cached_data is not None else []

async def scrape_checkers(query: str, page_size: int = 16):
    cached_data, is_fresh = get_cached_data('checkers', query)
    if is_fresh: return cached_data
    headers = get_dynamic_headers('checkers', referer=f'https://www.checkers.co.za/search?Search={query}')
    json_data = {'storeContexts': [], 'filterData': {'filter': {'showAllDisplayVariants': False, 'showNotRangedProducts': False, 'productListSource': {'search': query}, 'paginationOptions': {'page': 0, 'pageSize': page_size}, 'filterOptions': {'filterIds': [], 'dealsOnly': False, 'brandOptions': [], 'departmentOptions': [], 'serviceOptions': [], 'facetOptions': []}, 'sortOptions': None}, 'displayOptions': {'includeDisplayCategoryTree': True}}, 'forYouBonusBuyIds': []}
    
    async with get_http_semaphore():
        try:
            res = await get_http_client().post('https://www.checkers.co.za/api/catalogue/get-products-filter', headers=headers, json=json_data, timeout=6.0)
            if res.status_code == 200:
                products = res.json().get('products', []) or res.json().get('filterResult', {}).get('products', [])
                extracted = [{
                    'id': f"checkers_{item.get('code', item.get('id', ''))}",
                    'name': item.get('name', item.get('title', '')),
                    'store': 'Checkers',
                    'price': float(item.get('price', {}).get('value', 0.0) if isinstance(item.get('price'), dict) else item.get('price', 0.0)),
                    'formattedPrice': f"R {float(item.get('price', {}).get('value', 0.0) if isinstance(item.get('price'), dict) else item.get('price', 0.0)):.2f}",
                    'imageUrl': extract_shoprite_image(item),
                } for item in products]
                save_to_cache('checkers', query, extracted)
                return extracted
        except Exception:
            pass
    return cached_data if cached_data is not None else []

# ==========================================
# WOOLWORTHS VARIATIONS MAP & SCRAPER
# ==========================================
VARIATIONS_MAP = {
    "group_by": [{"name": "style", "field": "data.styleid"}],
    "values": {
        "swatch": {"field": "data.swatch", "aggregation": "first"},
        "color": {"field": "data.color", "aggregation": "first"},
        "variation_id": {"field": "data.variation_id", "aggregation": "first"},
        "image_url": {"field": "data.image_url", "aggregation": "first"},
        "altimgs": {"field": "data.altimgs", "aggregation": "first"},
        "p10_min": {"field": "data.p10", "aggregation": "min"},
        "p10_max": {"field": "data.p10", "aggregation": "max"},
        "p10_wp": {"field": "data.p10_wp", "aggregation": "max"},
        "p30_min": {"field": "data.p30", "aggregation": "min"},
        "p30_max": {"field": "data.p30", "aggregation": "max"},
        "p30_wp": {"field": "data.p30_wp", "aggregation": "max"},
        "p60_min": {"field": "data.p60", "aggregation": "min"},
        "p60_max": {"field": "data.p60", "aggregation": "max"},
        "p60_wp": {"field": "data.p60_wp", "aggregation": "max"},
        "p10_sale": {"field": "data.p10_sale", "aggregation": "value_count", "value": 1},
        "p30_sale": {"field": "data.p30_sale", "aggregation": "value_count", "value": 1},
        "p60_sale": {"field": "data.p60_sale", "aggregation": "value_count", "value": 1},
    },
    "dtype": "object",
}

def extract_woolworths_price(item_data: dict) -> float:
    for field in ['p60', 'p30', 'p10']:
        val = item_data.get(field)
        if val is not None:
            try:
                return float(val)
            except (ValueError, TypeError):
                continue
    return 0.0

def extract_woolworths_image(item_data: dict) -> str:
    img = item_data.get('image_url', '')
    if img:
        return img
    altimgs = item_data.get('altimgs', '')
    if altimgs:
        try:
            imgs = json.loads(altimgs) if isinstance(altimgs, str) else altimgs
            if isinstance(imgs, list) and imgs:
                return imgs[0]
        except Exception:
            pass
    return ''

async def scrape_woolworths(query: str, page_size: int = 16):
    cached_data, is_fresh = get_cached_data('woolworths', query)
    if is_fresh: return cached_data
    
    url = f'https://wpkmgeuco-zone.cnstrc.com/v1/search/{query}'
    params = {
        'variations_map': json.dumps(VARIATIONS_MAP),
        'key': 'key_tw9hKe0fkfgEf36D',
        'filters[visibility]': ['all', 'web and app'],
        'sort_by': 'relevance',
        'sort_order': 'descending',
        'num_results_per_page': str(page_size),
        'page': '1',
        'us': 'default',
        'i': '9af55ff8-2d69-47ce-a8b8-5b8a16d448c0',
        's': '1',
    }
    headers = {
        'User-Agent': ua_generator.random,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'isCognito': 'true',
        'X-Requested-By': 'Woolworths Online',
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Source-Chanel': 'web',
        'Origin': 'https://www.woolworths.co.za',
        'Referer': 'https://www.woolworths.co.za/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
    }
    
    async with get_http_semaphore():
        try:
            res = await get_http_client().get(url, params=params, headers=headers, timeout=6.0)
            if res.status_code == 200:
                data = res.json()
                results = data.get('response', {}).get('results', [])
                
                extracted = []
                for item in results:
                    item_data = item.get('data', {})
                    name = item_data.get('name') or item.get('value', '')
                    price = extract_woolworths_price(item_data)
                    image_url = extract_woolworths_image(item_data)
                    
                    extracted.append({
                        'id': f"woolworths_{item_data.get('product_id') or item_data.get('id', '')}",
                        'name': name,
                        'store': 'Woolworths',
                        'price': price,
                        'formattedPrice': f"R {price:.2f}",
                        'imageUrl': image_url,
                    })
                save_to_cache('woolworths', query, extracted)
                return extracted
        except Exception:
            pass
    return cached_data if cached_data is not None else []

# ==========================================
# ROUTES & ENDPOINTS
# ==========================================
@app.route('/favicon.ico')
def favicon(): return '', 204

@app.route('/api/search', methods=['GET'])
def handle_search():
    query = request.args.get('q', '').strip().lower()
    store_filter = request.args.get('store', 'all').strip().lower()
    sort_option = request.args.get('sort', '').strip().lower()
    if not query: return jsonify([])

    search_queries = [query]
    if query in ['milk', 'dairy']:
        search_queries = ['milk', 'fresh milk', 'butter', 'cheese', 'yogurt']
    elif query in ['juice', 'fruit']:
        search_queries = ['juice', 'fruit juice', 'apple juice', 'orange juice']
    elif query in ['pantry']:
        search_queries = ['rice', 'pasta', 'oil', 'sugar', 'flour']
    elif query in ['bread', 'bakery']:
        search_queries = ['bread', 'brown bread', 'white bread', 'bakery']
    elif query in ['snacks']:
        search_queries = ['chips', 'chocolate', 'biscuits', 'snacks']
    elif query in ['meat', 'poultry']:
        search_queries = ['chicken', 'beef', 'steak', 'wors', 'mince']

    async def run_search():
        all_pnp, all_sr, all_ch, all_ww = [], [], [], []
        for q_term in search_queries:
            tasks = []
            tasks.append(scrape_pnp(q_term, page_size=16) if store_filter in ['all', 'pnp', 'pick n pay', 'picknpay'] else asyncio.sleep(0, result=[]))
            tasks.append(scrape_shoprite(q_term, page_size=16) if store_filter in ['all', 'shoprite'] else asyncio.sleep(0, result=[]))
            tasks.append(scrape_checkers(q_term, page_size=16) if store_filter in ['all', 'checkers'] else asyncio.sleep(0, result=[]))
            tasks.append(scrape_woolworths(q_term, page_size=16) if store_filter in ['all', 'woolworths', 'ww'] else asyncio.sleep(0, result=[]))
            
            pnp_res, sr_res, ch_res, ww_res = await asyncio.gather(*tasks)
            all_pnp.extend(pnp_res)
            all_sr.extend(sr_res)
            all_ch.extend(ch_res)
            all_ww.extend(ww_res)

        def deduplicate(prod_list):
            seen = set()
            unique = []
            for p in prod_list:
                if p['id'] not in seen:
                    seen.add(p['id'])
                    unique.append(p)
            return unique

        return deduplicate(all_pnp), deduplicate(all_sr), deduplicate(all_ch), deduplicate(all_ww)

    pnp_res, sr_res, ch_res, ww_res = asyncio.run(run_search())
    
    combined_raw = pnp_res + sr_res + ch_res + ww_res
    if combined_raw:
        threading.Thread(target=log_search_results_to_db, args=(combined_raw,), daemon=True).start()

    if not sort_option:
        combined, max_len = [], max(len(pnp_res), len(sr_res), len(ch_res), len(ww_res))
        for i in range(max_len):
            if i < len(pnp_res): combined.append(pnp_res[i])
            if i < len(sr_res): combined.append(sr_res[i])
            if i < len(ch_res): combined.append(ch_res[i])
            if i < len(ww_res): combined.append(ww_res[i])
    else:
        combined = combined_raw

    if sort_option in ['asc', 'price_asc', 'low_to_high']: combined.sort(key=lambda x: x['price'])
    elif sort_option in ['desc', 'price_desc', 'high_to_low']: combined.sort(key=lambda x: x['price'], reverse=True)
    return jsonify(combined)

@app.route('/api/categories', methods=['GET'])
def get_categories():
    categories = {
        'Dairy & Fresh Milk': ['Fresh Milk', 'Butter', 'Cheese', 'Yogurt'],
        'Fruits & Juices': ['Fruit Juice', 'Apples', 'Oranges'],
        'Pantry Staples': ['White Sugar', 'Sunflower Oil', 'Rice', 'Pasta'],
        'Bakery & Breads': ['Brown Bread', 'White Bread', 'Rolls'],
        'Snacks & Treats': ['Chips', 'Chocolate', 'Biscuits'],
        'Meat & Poultry': ['Chicken', 'Steak', 'Wors', 'Mince']
    }
    
    async def fetch_live_categories():
        response_data = {}
        for cat_name, items in categories.items():
            cat_products = []
            for q in items:
                pnp_res = await scrape_pnp(q, page_size=4)
                sr_res = await scrape_shoprite(q, page_size=4)
                ch_res = await scrape_checkers(q, page_size=4)
                ww_res = await scrape_woolworths(q, page_size=4)
                
                combined_pool = pnp_res + sr_res + ch_res + ww_res
                for prod in combined_pool:
                    if not any(existing['id'] == prod['id'] for existing in cat_products):
                        cat_products.append(prod)
                        
            response_data[cat_name] = cat_products[:15]
        return response_data

    return jsonify(asyncio.run(fetch_live_categories()))

@app.route('/api/compare', methods=['GET'])
def compare_product():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'found': False, 'products': []})
    
    search_query = optimize_search_query(query)

    async def run_comparison():
        pnp_res, sr_res, ch_res, ww_res = await asyncio.gather(
            scrape_pnp(search_query, page_size=10),
            scrape_shoprite(search_query, page_size=10),
            scrape_checkers(search_query, page_size=10),
            scrape_woolworths(search_query, page_size=10)
        )
        all_results = pnp_res + sr_res + ch_res + ww_res
        return filter_and_score_competitors(query, all_results)

    results = asyncio.run(run_comparison())
    if results:
        return jsonify({
            'found': True,
            'query': search_query,
            'products': results,
            'cheapest': results[0]
        })
    return jsonify({'found': False, 'products': [], 'query': query})

async def internal_fetch_competitors(query: str):
    search_query = optimize_search_query(query)
    if not search_query: return []

    pnp_res, sr_res, ch_res, ww_res = await asyncio.gather(
        scrape_pnp(search_query, page_size=10),
        scrape_shoprite(search_query, page_size=10),
        scrape_checkers(search_query, page_size=10),
        scrape_woolworths(search_query, page_size=10)
    )
    all_results = pnp_res + sr_res + ch_res + ww_res
    return filter_and_score_competitors(query, all_results)

# --- SQL DB Saved Basket Endpoints ---
@app.route('/api/db/saved-baskets', methods=['GET'])
def get_db_saved_baskets():
    baskets = SavedBasket.query.order_by(SavedBasket.created_at.desc()).all()
    output = []
    for b in baskets:
        items_list = [{
            'id': bi.product.id, 'name': bi.product.name, 'store': bi.product.store,
            'price': bi.price if bi.price is not None else bi.product.price, 
            'formattedPrice': bi.product.formatted_price,
            'imageUrl': bi.product.image_url, 'quantity': bi.quantity,
            'competitors': json.loads(bi.competitor_prices) if bi.competitor_prices else []
        } for bi in b.items if bi.product]
        output.append({'id': b.id, 'name': b.name, 'date': b.created_at.strftime('%Y-%m-%d'), 'items': items_list})
    return jsonify(output)

@app.route('/api/db/save-basket', methods=['POST'])
def save_basket_to_db():
    data = request.json or {}
    basket_name, items = data.get('name', 'My Saved Basket'), data.get('items', [])
    if not items: return jsonify({'error': 'No items in basket'}), 400

    try:
        new_basket = SavedBasket(name=basket_name)
        db.session.add(new_basket)
        db.session.flush()

        async def get_all_competitors():
            tasks = [internal_fetch_competitors(item['name']) for item in items]
            return await asyncio.gather(*tasks)
        
        competitors_lists = asyncio.run(get_all_competitors())

        for idx, item in enumerate(items):
            product = Product.query.get(item['id'])
            if not product:
                product = Product(
                    id=item['id'], name=item['name'], store=item['store'],
                    price=float(item['price']), formatted_price=item.get('formattedPrice', f"R {float(item['price']):.2f}"),
                    image_url=item.get('imageUrl', '')
                )
                db.session.add(product)
                
            # Grab all valid competitors for the snapshot (don't limit to 3 anymore)
            comps = [c for c in competitors_lists[idx] if c['id'] != item['id']]

            snapshot_price = float(item['price'])
            db.session.add(BasketItem(
                basket_id=new_basket.id, 
                product_id=item['id'], 
                quantity=item.get('quantity', 1),
                price=snapshot_price,
                competitor_prices=json.dumps(comps) # Save ALL competitors to DB
            ))

        db.session.commit()
        return jsonify({'success': True, 'basket_id': new_basket.id})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/saved-baskets/<int:basket_id>', methods=['DELETE'])
def delete_db_basket(basket_id):
    try:
        b = SavedBasket.query.get(basket_id)
        if not b: return jsonify({'error': 'Basket not found'}), 404
        db.session.delete(b)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ==========================================
# HTML FRONTEND ROUTES
# ==========================================
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/search')
def search():
    query = request.args.get('q', '')
    return render_template('search.html', query=query)

@app.route('/product/<path:product_id>')
def product(product_id):
    return render_template('product.html', product_id=product_id)

@app.route('/basket')
def basket():
    return render_template('basket.html')

@app.route('/saved')
def saved_baskets():
    return render_template('saved_basket.html')

@app.route('/saved/<int:basket_id>')
def saved_basket_detail(basket_id):
    basket = db.get_or_404(SavedBasket, basket_id)
    return render_template('saved_basket_detail.html', basket=basket)

@app.route('/account')
def account():
    return render_template('account.html')

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    # If you submit the form, handle the POST request here in the future
    if request.method == 'POST':
        pass 
    return render_template('signup.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    # If you submit the form, handle the POST request here in the future
    if request.method == 'POST':
        pass 
    return render_template('login.html')

# ==========================================
# APP STARTUP
# ==========================================
if __name__ == '__main__':
    init_cache_db()
    
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        scheduler = BackgroundScheduler()
        scheduler.add_job(
            func=refresh_tokens_sync, 
            trigger="interval", 
            minutes=20, 
            next_run_time=datetime.now()
        )
        scheduler.start()
        
    app.run(host='0.0.0.0', port=5000, debug=True)