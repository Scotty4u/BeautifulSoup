import asyncio
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
from datetime import datetime
from typing import Dict, List, Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from fake_useragent import UserAgent
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
import httpx
from playwright.async_api import async_playwright

app = Flask(__name__)
CORS(app)

# ==========================================
# DATABASE & CONFIGURATION
# ==========================================
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(tempfile.gettempdir(), 'smartbasket.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

CACHE_DB_FILE = os.path.join(tempfile.gettempdir(), "smartbasket_cache.db")
CACHE_EXPIRATION_SECONDS = 43200  # 12 Hours

WAF_TOKEN_CACHE: Dict[str, dict] = {
    'pnp': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
    'shoprite': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
    'checkers': {'cookies': {}, 'waf_token': '', 'user_agent': '', 'updated': 0},
}

PROXY_URL = os.getenv("RESIDENTIAL_PROXY_URL", None)
ua_generator = UserAgent()

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
    """Silently saves searched products to SQLite in the background for database proof."""
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

async def token_refresh_loop(interval_seconds: int = 1200):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled', '--no-sandbox'])
        context = await browser.new_context(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
        while True:
            await harvest_tokens_for_store(context, 'pnp', 'https://www.pnp.co.za')
            await harvest_tokens_for_store(context, 'shoprite', 'https://www.shoprite.co.za')
            await harvest_tokens_for_store(context, 'checkers', 'https://www.checkers.co.za')
            await asyncio.sleep(interval_seconds)

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
    
    async with HTTP_SEMAPHORE:
        for attempt in range(2):
            try:
                res = await HTTP_CLIENT.post(url, headers=headers, json={}, timeout=5.0)
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
    
    async with HTTP_SEMAPHORE:
        try:
            res = await HTTP_CLIENT.post('https://www.shoprite.co.za/api/catalogue/get-products-filter', headers=headers, json=json_data, timeout=6.0)
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
    
    async with HTTP_SEMAPHORE:
        try:
            res = await HTTP_CLIENT.post('https://www.checkers.co.za/api/catalogue/get-products-filter', headers=headers, json=json_data, timeout=6.0)
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

    async def run_search():
        tasks = []
        tasks.append(scrape_pnp(query, page_size=24) if store_filter in ['all', 'pnp', 'pick n pay', 'picknpay'] else asyncio.sleep(0, result=[]))
        tasks.append(scrape_shoprite(query, page_size=24) if store_filter in ['all', 'shoprite'] else asyncio.sleep(0, result=[]))
        tasks.append(scrape_checkers(query, page_size=24) if store_filter in ['all', 'checkers'] else asyncio.sleep(0, result=[]))
        return await asyncio.gather(*tasks)

    pnp_res, sr_res, ch_res = asyncio.run(run_search())
    
    combined_raw = pnp_res + sr_res + ch_res
    # Automatically log searched products into SQLite database for database validation
    if combined_raw:
        threading.Thread(target=log_search_results_to_db, args=(combined_raw,), daemon=True).start()

    if not sort_option:
        combined, max_len = [], max(len(pnp_res), len(sr_res), len(ch_res))
        for i in range(max_len):
            if i < len(pnp_res): combined.append(pnp_res[i])
            if i < len(sr_res): combined.append(sr_res[i])
            if i < len(ch_res): combined.append(ch_res[i])
    else:
        combined = combined_raw

    if sort_option in ['asc', 'price_asc', 'low_to_high']: combined.sort(key=lambda x: x['price'])
    elif sort_option in ['desc', 'price_desc', 'high_to_low']: combined.sort(key=lambda x: x['price'], reverse=True)
    return jsonify(combined)

@app.route('/api/categories', methods=['GET'])
def get_categories():
    categories = {'Dairy & Essentials': ['Fresh Milk', 'Brown Bread', 'Large Eggs', 'Butter'], 'Pantry Staples': ['White Sugar', 'Sunflower Oil', 'White Maize Meal', 'Long Grain Rice']}
    response_data = {}
    for cat_name, items in categories.items():
        cat_products = []
        for q in items:
            cat_products.extend((get_cached_data('pnp', q)[0] or [])[:2] + (get_cached_data('shoprite', q)[0] or [])[:2] + (get_cached_data('checkers', q)[0] or [])[:2])
        response_data[cat_name] = cat_products
    return jsonify(response_data)

@app.route('/api/compare', methods=['GET'])
def compare_product():
    return jsonify({'found': False})

# --- SQL DB Saved Basket Endpoints ---
@app.route('/api/db/saved-baskets', methods=['GET'])
def get_db_saved_baskets():
    baskets = SavedBasket.query.order_by(SavedBasket.created_at.desc()).all()
    output = []
    for b in baskets:
        items_list = [{
            'id': bi.product.id, 'name': bi.product.name, 'store': bi.product.store,
            'price': bi.product.price, 'formattedPrice': bi.product.formatted_price,
            'imageUrl': bi.product.image_url, 'quantity': bi.quantity
        } for bi in b.items if bi.product]
        output.append({'id': b.id, 'name': b.name, 'date': b.created_at.strftime('%Y-%m-%d'), 'items': items_list})
    return jsonify(output)

@app.route('/api/db/save-basket', methods=['POST'])
def save_basket_to_db():
    data = request.json or {}
    basket_name, items = data.get('name', 'My Saved Basket'), data.get('items', [])
    if not items: return jsonify({'error': 'No items in basket'}), 400

    new_basket = SavedBasket(name=basket_name)
    db.session.add(new_basket)
    db.session.flush()

    for item in items:
        product = Product.query.get(item['id'])
        if not product:
            product = Product(
                id=item['id'], name=item['name'], store=item['store'],
                price=float(item['price']), formatted_price=item.get('formattedPrice', f"R {float(item['price']):.2f}"),
                image_url=item.get('imageUrl', '')
            )
            db.session.add(product)
        db.session.add(BasketItem(basket_id=new_basket.id, product_id=item['id'], quantity=item.get('quantity', 1)))

    db.session.commit()
    return jsonify({'success': True, 'basket_id': new_basket.id})

@app.route('/api/db/saved-baskets/<int:basket_id>', methods=['DELETE'])
def delete_db_basket(basket_id):
    basket = SavedBasket.query.get(basket_id)
    if not basket: return jsonify({'error': 'Basket not found'}), 404
    db.session.delete(basket)
    db.session.commit()
    return jsonify({'success': True})

# ==========================================
# APP STARTUP
# ==========================================
if __name__ == '__main__':
    init_cache_db()
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        threading.Thread(target=lambda: asyncio.run(token_refresh_loop()), daemon=True).start()
    app.run(host='0.0.0.0', port=5000, debug=True)