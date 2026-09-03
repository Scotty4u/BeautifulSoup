import asyncio
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
import uuid
from datetime import datetime
from typing import Dict, List, Tuple

from rapidfuzz import fuzz
from apscheduler.schedulers.background import BackgroundScheduler
from fake_useragent import UserAgent
from flask import Flask, jsonify, request, render_template, session, redirect, url_for
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import httpx
from playwright.async_api import async_playwright

app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

# ==========================================
# DATABASE & CONFIGURATION
# ==========================================
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24))

db_path = 'smartbasket.db'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + db_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

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

_semaphores = {}
def get_http_semaphore():
    loop = asyncio.get_running_loop()
    if loop not in _semaphores:
        _semaphores[loop] = asyncio.Semaphore(5)
    return _semaphores[loop]

_http_clients = {}
def get_http_client():
    loop = asyncio.get_running_loop()
    if loop not in _http_clients or _http_clients[loop].is_closed:
        _http_clients[loop] = httpx.AsyncClient(
            proxy=PROXY_URL if PROXY_URL else None,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=30),
            timeout=10.0,
            follow_redirects=True,
        )
    return _http_clients[loop]

# ==========================================
# SQLALCHEMY DATABASE MODELS
# ==========================================
class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Core UML Relationships
    baskets = db.relationship('SavedBasket', backref='owner', lazy=True, cascade="all, delete-orphan")
    preference = db.relationship('UserPreference', backref='user', uselist=False, cascade="all, delete-orphan")
    active_cart = db.relationship('ActiveCart', backref='user', uselist=False, cascade="all, delete-orphan")
    reviews = db.relationship('Review', backref='user', lazy=True, cascade="all, delete-orphan")
    
    # Preserved Latest System Features
    collaborations = db.relationship('SavedBasketCollaborator', backref='user', lazy=True)
    notifications_received = db.relationship('Notification', foreign_keys='Notification.recipient_id', backref='recipient', lazy=True)

class Store(db.Model):
    __tablename__ = 'stores'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    store_key = db.Column(db.String(50))
    logo_url = db.Column(db.String(255))
    website_url = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    products = db.relationship('Product', backref='store_ref', lazy=True)

class Category(db.Model):
    __tablename__ = 'categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    icon_url = db.Column(db.String(255))
    
    products = db.relationship('Product', backref='category_ref', lazy=True)

class Product(db.Model):
    __tablename__ = 'products'
    id = db.Column(db.String(100), primary_key=True)
    name = db.Column(db.String(255), nullable=False, index=True)
    price = db.Column(db.Float, nullable=False)
    formatted_price = db.Column(db.String(20))
    image_url = db.Column(db.Text)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    
    # Updated to match UML FKs (Kept 'store' string for scraper backwards compatibility)
    store_id = db.Column(db.Integer, db.ForeignKey('stores.id'), nullable=True) 
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=True)
    store = db.Column(db.String(50), index=True) 
    
    # UML Relationships
    price_history = db.relationship('PriceHistory', backref='product_ref', lazy=True, cascade="all, delete-orphan")
    reviews = db.relationship('Review', backref='product_ref', lazy=True, cascade="all, delete-orphan")

class PriceHistory(db.Model):
    __tablename__ = 'price_history'
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.String(100), db.ForeignKey('products.id'), nullable=False)
    price = db.Column(db.Float, nullable=False)
    recorded_at = db.Column(db.DateTime, default=datetime.utcnow)
    store_name = db.Column(db.String(100))

class UserPreference(db.Model):
    __tablename__ = 'user_preferences'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
    preferred_store = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ActiveCart(db.Model):
    __tablename__ = 'active_carts'
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    items_json = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SavedBasket(db.Model):
    __tablename__ = 'saved_baskets'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Preserved Latest System Features
    share_token = db.Column(db.String(64), unique=True, default=lambda: uuid.uuid4().hex) 
    is_collaborative = db.Column(db.Boolean, default=False)
    
    items = db.relationship('BasketItem', backref='basket', cascade='all, delete-orphan')
    collaborators = db.relationship('SavedBasketCollaborator', backref='basket_ref', cascade='all, delete-orphan')

class BasketItem(db.Model):
    __tablename__ = 'basket_items'
    id = db.Column(db.Integer, primary_key=True)
    basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    product_id = db.Column(db.String(100), db.ForeignKey('products.id'), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    price = db.Column(db.Float, nullable=True)
    competitor_prices = db.Column(db.Text, nullable=True)
    
    product = db.relationship('Product')

class Review(db.Model):
    __tablename__ = 'reviews'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False) 
    product_id = db.Column(db.String(100), db.ForeignKey('products.id'), index=True, nullable=False) 
    rating = db.Column(db.Integer, nullable=False)
    comment = db.Column(db.Text, nullable=False)
    helpful_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Kept for routing compatibility
    author_name = db.Column(db.String(100), default='Anonymous')

class SavedBasketCollaborator(db.Model):
    __tablename__ = 'saved_basket_collaborators'
    id = db.Column(db.Integer, primary_key=True)
    saved_basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(20), default='pending') # pending, accepted, declined
    role = db.Column(db.String(20), default='editor') # editor, viewer

class Notification(db.Model):
    __tablename__ = 'notifications'
    id = db.Column(db.Integer, primary_key=True)
    recipient_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    message = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), default='unread') # unread, read
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

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
                existing = db.session.get(Product, item['id'])
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
# MATCHING & UTILITIES
# ==========================================
RETAILER_STOPWORDS = {'pnp', 'pick', 'pay', 'shoprite', 'checkers', 'woolworths', 'woolies', 'housebrand', 'ritebrand', 'simple', 'truth', 'the', 'and', 'fresh', 'superior'}

def normalize_units(text: str) -> str:
    text = text.lower()
    text = re.sub(r'(\d+)\s*(litre|litres|liter|liters|l\b)', r'\1l', text)
    text = re.sub(r'2000\s*ml', '2l', text)
    text = re.sub(r'1000\s*ml', '1l', text)
    text = re.sub(r'500\s*ml', '0.5l', text)
    text = re.sub(r'1000\s*g\b', '1kg', text)
    text = re.sub(r'(\d+)\s*(kilogram|kilograms|kg\b)', r'\1kg', text)
    text = re.sub(r'(\d+)\s*(gram|grams|g\b)', r'\1g', text)
    return text

def extract_features(title: str):
    normalized = normalize_units(title)
    size_match = re.search(r'\b(\d+(?:\.\d+)?(?:kg|g|l|ml)|(?:\d+x\d+ml))\b', normalized)
    size = size_match.group(0) if size_match else ""
    cleaned = re.sub(r'[^a-z0-9\s]', ' ', normalized)
    tokens = [w for w in cleaned.split() if w not in RETAILER_STOPWORDS and len(w) > 1]
    return {
        'clean_text': " ".join(tokens),
        'tokens': set(tokens),
        'size': size
    }

def calculate_match_score(target_title: str, candidate_title: str):
    target_feat = extract_features(target_title)
    candidate_feat = extract_features(candidate_title)
    if target_feat['size'] and candidate_feat['size']:
        if target_feat['size'] != candidate_feat['size']:
            return 0, False
    similarity = fuzz.token_set_ratio(
        target_feat['clean_text'], 
        candidate_feat['clean_text']
    )
    is_exact = similarity >= 88 and target_feat['size'] == candidate_feat['size']
    return similarity, is_exact

def optimize_search_query(query: str) -> str:
    cleaned = re.sub(r'\b(pnp|woolworths|shoprite|checkers|finest|store|superior|sliced|thick slice|fresh)\b', '', query, flags=re.IGNORECASE)
    words = [w for w in cleaned.split() if len(w) > 1][:4]
    return " ".join(words).strip()

def filter_and_score_competitors(original_name: str, scraped_results: list) -> list:
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
        best_is_exact = False
        for item in items:
            item_name = item.get('name', '')
            score, is_exact = calculate_match_score(original_name, item_name)
            if score > highest_score:
                highest_score = score
                best_match = item
                best_is_exact = is_exact

        if best_match and highest_score >= 65:
            best_match['is_exact_match'] = best_is_exact
            best_match['isExact'] = best_is_exact
            best_match['score'] = highest_score
            final_results.append(best_match)
        elif items:
            items.sort(key=lambda x: x['price'])
            fallback = items[0]
            fallback['is_exact_match'] = False
            fallback['isExact'] = False
            fallback['score'] = 0
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

def user_can_edit_basket(basket_id, user_id):
    if not user_id: return False
    basket = db.session.get(SavedBasket, basket_id)
    if not basket: return False
    if basket.user_id == user_id: return True
    collab = SavedBasketCollaborator.query.filter_by(
        saved_basket_id=basket_id, user_id=user_id, status='accepted'
    ).first()
    return collab is not None

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

@app.route('/api/batch-compare', methods=['POST'])
def batch_compare():
    data = request.json or {}
    queries = data.get('queries', [])
    if not queries:
        return jsonify({})

    async def fetch_all_competitors():
        tasks = [internal_fetch_competitors(q) for q in queries]
        results = await asyncio.gather(*tasks)
        return dict(zip(queries, results))
        
    batch_results = asyncio.run(fetch_all_competitors())
    return jsonify(batch_results)

# --- Reviews, Active Cart & Saved Baskets ---

@app.route('/api/reviews/<path:product_id>', methods=['GET'])
def get_reviews(product_id):
    reviews = Review.query.filter_by(product_id=product_id).order_by(Review.created_at.desc()).all()
    return jsonify([{
        'id': r.id,
        'author_name': r.author_name,
        'rating': r.rating,
        'comment': r.comment,
        'date': r.created_at.strftime('%Y-%m-%d %H:%M')
    } for r in reviews])

@app.route('/api/reviews/<path:product_id>', methods=['POST'])
def add_review(product_id):
    if 'username' not in session or 'user_id' not in session:
        return jsonify({'error': 'Authentication required'}), 401

    data = request.json or {}
    rating = int(data.get('rating', 5))
    comment = data.get('comment', '').strip()
    author = session.get('username')
    user_id = session.get('user_id')
    
    if not comment:
        return jsonify({'error': 'Comment is required'}), 400
        
    new_review = Review(
        product_id=product_id, 
        user_id=user_id,
        author_name=author, 
        rating=rating, 
        comment=comment
    )
    db.session.add(new_review)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/db/active-cart', methods=['GET', 'POST'])
def handle_active_cart():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'authenticated': False, 'items': []})
    
    if request.method == 'GET':
        cart_record = db.session.get(ActiveCart, user_id)
        if cart_record and cart_record.items_json:
            try:
                return jsonify({'authenticated': True, 'items': json.loads(cart_record.items_json)})
            except:
                pass
        return jsonify({'authenticated': True, 'items': []})
    
    elif request.method == 'POST':
        data = request.json or {}
        items = data.get('items', [])
        cart_record = db.session.get(ActiveCart, user_id)
        if not cart_record:
            cart_record = ActiveCart(user_id=user_id, items_json=json.dumps(items))
            db.session.add(cart_record)
        else:
            cart_record.items_json = json.dumps(items)
        db.session.commit()
        return jsonify({'authenticated': True, 'success': True})

@app.route('/api/db/save-basket', methods=['POST'])
def save_basket_to_db():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Authentication required. Please log in.'}), 401

    data = request.json or {}
    basket_id = data.get('basket_id')  # Optional: present if updating an existing list
    basket_name = data.get('name', 'My Saved Basket')
    items = data.get('items', [])
    if not items: 
        return jsonify({'error': 'No items in basket'}), 400

    try:
        if basket_id:
            basket = db.session.get(SavedBasket, basket_id)
            if not basket:
                return jsonify({'error': 'Basket not found'}), 404
            if not user_can_edit_basket(basket_id, user_id):
                return jsonify({'error': 'Unauthorized'}), 403
            
            basket.name = basket_name
            BasketItem.query.filter_by(basket_id=basket.id).delete()
            target_basket_id = basket.id
        else:
            basket = SavedBasket(name=basket_name, user_id=user_id)
            db.session.add(basket)
            db.session.flush()
            target_basket_id = basket.id

        async def get_all_competitors():
            tasks = [internal_fetch_competitors(item['name']) for item in items]
            return await asyncio.gather(*tasks)
        
        competitors_lists = asyncio.run(get_all_competitors())

        for idx, item in enumerate(items):
            product = db.session.get(Product, item['id'])
            if not product:
                product = Product(
                    id=item['id'], name=item['name'], store=item['store'],
                    price=float(item['price']), formatted_price=item.get('formattedPrice', f"R {float(item['price']):.2f}"),
                    image_url=item.get('imageUrl', '')
                )
                db.session.add(product)
                
            comps = [c for c in competitors_lists[idx] if c['id'] != item['id']]
            snapshot_price = float(item['price'])
            db.session.add(BasketItem(
                basket_id=target_basket_id, 
                product_id=item['id'], 
                quantity=item.get('quantity', 1),
                price=snapshot_price,
                competitor_prices=json.dumps(comps)
            ))

        # Notify collaborators if this is an active collaborative list
        if basket.is_collaborative:
            collabs = SavedBasketCollaborator.query.filter_by(saved_basket_id=basket.id, status='accepted').all()
            sender_name = session.get('username', 'Someone')
            
            # Notify all accepted collaborators except the sender
            for c in collabs:
                if c.user_id != user_id:
                    db.session.add(Notification(
                        recipient_id=c.user_id,
                        sender_id=user_id,
                        basket_id=basket.id,
                        message=f"{sender_name} updated the collaborative list '{basket.name}'."
                    ))
            
            # Notify the owner if someone else edited it
            if basket.user_id != user_id:
                db.session.add(Notification(
                    recipient_id=basket.user_id,
                    sender_id=user_id,
                    basket_id=basket.id,
                    message=f"{sender_name} updated your collaborative list '{basket.name}'."
                ))

        db.session.commit()
        return jsonify({'success': True, 'basket_id': target_basket_id})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/saved-baskets/<int:basket_id>', methods=['DELETE'])
def delete_db_basket(basket_id):
    try:
        b = db.session.get(SavedBasket, basket_id)
        if not b: return jsonify({'error': 'Basket not found'}), 404
        db.session.delete(b)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/search', methods=['GET'])
def search_system_users():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify([])
    users = User.query.filter(User.username.ilike(f'%{query}%'), User.id != session['user_id']).limit(5).all()
    return jsonify([{'id': u.id, 'username': u.username} for u in users])

@app.route('/api/saved-baskets/<int:basket_id>/collaborators', methods=['GET'])
def get_collaborators(basket_id):
    collabs = SavedBasketCollaborator.query.filter_by(saved_basket_id=basket_id).all()
    output = []
    for c in collabs:
        u = db.session.get(User, c.user_id)
        if u:
            output.append({
                'id': u.id, 'username': u.username, 'status': c.status, 'role': c.role
            })
    return jsonify(output)

@app.route('/api/saved-baskets/<int:basket_id>/invite', methods=['POST'])
def invite_collaborator(basket_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    basket = db.session.get(SavedBasket, basket_id)
    if not basket:
        return jsonify({'error': 'List not found'}), 404

    data = request.json or {}
    raw_user_id = data.get('user_id')
    if not raw_user_id:
        return jsonify({'error': 'Target user ID is required'}), 400
        
    target_user_id = int(raw_user_id)
    if target_user_id == session['user_id']:
        return jsonify({'error': 'You cannot invite yourself'}), 400
    
    # Automatically duplicate personal snapshot into a collaborative workspace copy
    target_basket = basket
    if not basket.is_collaborative:
        collab_basket = SavedBasket(
            user_id=basket.user_id,
            name=f"{basket.name} (Collab)",
            is_collaborative=True
        )
        db.session.add(collab_basket)
        db.session.flush()
        
        for item in basket.items:
            new_item = BasketItem(
                basket_id=collab_basket.id,
                product_id=item.product_id,
                quantity=item.quantity,
                price=item.price,
                competitor_prices=item.competitor_prices
            )
            db.session.add(new_item)
        target_basket = collab_basket

    existing = SavedBasketCollaborator.query.filter_by(saved_basket_id=target_basket.id, user_id=target_user_id).first()
    if existing:
        return jsonify({'error': 'User is already invited or a member'}), 400

    collab = SavedBasketCollaborator(saved_basket_id=target_basket.id, user_id=target_user_id, status='pending')
    db.session.add(collab)

    sender_name = session.get('username', 'Someone')
    notif = Notification(
        recipient_id=target_user_id,
        sender_id=session['user_id'],
        basket_id=target_basket.id,
        message=f"{sender_name} invited you to collaborate on list: '{target_basket.name}'"
    )
    db.session.add(notif)
    db.session.commit()
    
    return jsonify({'success': True, 'basket_id': target_basket.id})

@app.route('/api/notifications', methods=['GET'])
def get_user_notifications():
    if 'user_id' not in session:
        return jsonify([])
    notifs = Notification.query.filter_by(recipient_id=session['user_id']).order_by(Notification.created_at.desc()).all()
    return jsonify([{
        'id': n.id, 'message': n.message, 'basket_id': n.basket_id,
        'sender_id': n.sender_id, 'status': n.status,
        'date': n.created_at.strftime('%Y-%m-%d %H:%M')
    } for n in notifs])

@app.route('/api/notifications/count', methods=['GET'])
def get_unread_notifications_count():
    if 'user_id' not in session:
        return jsonify({'count': 0})
    count = Notification.query.filter_by(recipient_id=session['user_id'], status='unread').count()
    return jsonify({'count': count})

@app.route('/api/notifications/<int:notif_id>/respond', methods=['POST'])
def respond_notification(notif_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    notif = db.session.get(Notification, notif_id)
    if not notif or notif.recipient_id != session['user_id']:
        return jsonify({'error': 'Notification not found'}), 404

    data = request.json or {}
    action = data.get('action')
    notif.status = 'read'

    collab = SavedBasketCollaborator.query.filter_by(saved_basket_id=notif.basket_id, user_id=session['user_id']).first()
    if action == 'accept':
        if collab: collab.status = 'accepted'
        basket = db.session.get(SavedBasket, notif.basket_id)
        if basket:
            owner_notif = Notification(
                recipient_id=notif.sender_id,
                sender_id=session['user_id'],
                basket_id=basket.id,
                message=f"{session.get('username')} accepted your invite for '{basket.name}'!"
            )
            db.session.add(owner_notif)
    else:
        if collab: db.session.delete(collab)

    db.session.commit()
    return jsonify({'success': True})

@app.route('/shared/basket/<token>', methods=['GET'])
def public_shared_basket(token):
    basket = SavedBasket.query.filter_by(share_token=token).first_or_404()
    return render_template('public_shared_basket.html', basket=basket)

@app.route('/api/db/saved-baskets', methods=['GET'])
def get_db_saved_baskets():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify([])

    # Personal snapshots (non-collaborative)
    owned_personal = SavedBasket.query.filter_by(user_id=user_id, is_collaborative=False).order_by(SavedBasket.created_at.desc()).all()
    
    # Collaborative lists (owned workspaces + shared with user)
    owned_collab = SavedBasket.query.filter_by(user_id=user_id, is_collaborative=True).all()
    collabs = SavedBasketCollaborator.query.filter_by(user_id=user_id, status='accepted').all()
    shared_basket_ids = [c.saved_basket_id for c in collabs]
    shared_collab = SavedBasket.query.filter(SavedBasket.id.in_(shared_basket_ids)).all() if shared_basket_ids else []
    
    all_collabs = list(set(owned_collab + shared_collab))
    all_collabs.sort(key=lambda x: x.created_at, reverse=True)

    output = []

    for b in owned_personal:
        items_list = [{'id': bi.product.id, 'name': bi.product.name, 'store': bi.product.store, 'price': bi.price or bi.product.price, 'formattedPrice': bi.product.formatted_price, 'imageUrl': bi.product.image_url, 'quantity': bi.quantity} for bi in b.items if bi.product]
        output.append({'id': b.id, 'name': b.name, 'date': b.created_at.strftime('%Y-%m-%d'), 'items': items_list, 'is_shared': False, 'is_collab': False})

    for b in all_collabs:
        inviter_name = b.owner.username if b.owner else 'Someone'
        items_list = [{'id': bi.product.id, 'name': bi.product.name, 'store': bi.product.store, 'price': bi.price or bi.product.price, 'formattedPrice': bi.product.formatted_price, 'imageUrl': bi.product.image_url, 'quantity': bi.quantity} for bi in b.items if bi.product]
        output.append({
            'id': b.id, 'name': b.name, 'date': b.created_at.strftime('%Y-%m-%d'), 
            'items': items_list, 'is_shared': (b.user_id != user_id), 'is_collab': True,
            'inviter_name': inviter_name
        })

    return jsonify(output)

@app.route('/api/notifications/<int:notif_id>/read', methods=['POST'])
def mark_notification_read(notif_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    notif = db.session.get(Notification, notif_id)
    if not notif or notif.recipient_id != session['user_id']:
        return jsonify({'error': 'Notification not found'}), 404

    notif.status = 'read'
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/notifications/mark-all-read', methods=['POST'])
def mark_all_notifications_as_read():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    Notification.query.filter_by(
        recipient_id=session['user_id'], 
        status='unread'
    ).update({'status': 'read'})
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/db/saved-baskets/<int:basket_id>/items', methods=['POST'])
def add_item_to_saved_basket(basket_id):
    user_id = session.get('user_id')
    if not user_can_edit_basket(basket_id, user_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.json or {}
    product_id = data.get('id')
    quantity = int(data.get('quantity', 1))
    
    product = db.session.get(Product, product_id)
    if not product:
        product = Product(
            id=product_id, name=data['name'], store=data['store'],
            price=float(data['price']), formatted_price=data.get('formattedPrice', f"R {float(data['price']):.2f}"),
            image_url=data.get('imageUrl', '')
        )
        db.session.add(product)
        db.session.commit()
        
    existing_item = BasketItem.query.filter_by(basket_id=basket_id, product_id=product_id).first()
    if existing_item:
        existing_item.quantity += quantity
    else:
        new_item = BasketItem(
            basket_id=basket_id, product_id=product_id, 
            quantity=quantity, price=product.price
        )
        db.session.add(new_item)
        
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/db/saved-baskets/<int:basket_id>/items/<path:product_id>', methods=['PATCH', 'DELETE'])
def modify_saved_basket_item(basket_id, product_id):
    user_id = session.get('user_id')
    if not user_can_edit_basket(basket_id, user_id):
        return jsonify({'error': 'Unauthorized'}), 403
        
    item = BasketItem.query.filter_by(basket_id=basket_id, product_id=product_id).first_or_404()
    
    if request.method == 'DELETE':
        db.session.delete(item)
    elif request.method == 'PATCH':
        data = request.json or {}
        change = int(data.get('change', 0))
        item.quantity += change
        if item.quantity <= 0:
            db.session.delete(item)
            
    db.session.commit()
    return jsonify({'success': True})

# ==========================================
# HTML FRONTEND ROUTES
# ==========================================
@app.route('/')
def home():
    user_pref_stores = []
    if 'user_id' in session:
        user_pref = UserPreference.query.filter_by(user_id=session['user_id']).first()
        if user_pref and user_pref.preferred_store:
            user_pref_stores = [s.strip() for s in user_pref.preferred_store.split(',')]
            
    return render_template('index.html', user_pref_stores=user_pref_stores)

@app.route('/collaborative')
def collaborative_lists():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('collaborative.html')

@app.route('/api/popular', methods=['GET'])
def api_popular_products():
    user_pref_stores = []
    if 'user_id' in session:
        user_pref = UserPreference.query.filter_by(user_id=session['user_id']).first()
        if user_pref and user_pref.preferred_store:
            user_pref_stores = [s.strip() for s in user_pref.preferred_store.split(',')]
            
    if user_pref_stores:
        products = Product.query.filter(Product.store.in_(user_pref_stores)).order_by(db.func.random()).limit(20).all()
    else:
        products = Product.query.order_by(db.func.random()).limit(20).all()
        
    output = [{
        'id': p.id, 'name': p.name, 'store': p.store,
        'price': p.price, 'formattedPrice': p.formatted_price,
        'imageUrl': p.image_url
    } for p in products]
    return jsonify(output)

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
    if not basket.share_token:
        basket.share_token = uuid.uuid4().hex
        db.session.commit()
        
    user_id = session.get('user_id')
    requires_acceptance = False
    
    if user_id and basket.user_id != user_id:
        collab = SavedBasketCollaborator.query.filter_by(saved_basket_id=basket_id, user_id=user_id).first()
        if not collab or collab.status != 'accepted':
            requires_acceptance = True
            
    return render_template('saved_basket_detail.html', basket=basket, requires_acceptance=requires_acceptance)

@app.route('/notifications', endpoint='notifications')
@app.route('/notifications-page', endpoint='notifications_page')
def notifications():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('notifications.html')

@app.route('/account')
def account():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user = db.session.get(User, session['user_id'])
    user_pref = UserPreference.query.filter_by(user_id=user.id).first()
    return render_template('account.html', user=user, user_pref=user_pref)

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        
        if User.query.filter_by(email=email).first():
            return render_template('signup.html', error="Email already exists.")
            
        new_user = User(
            username=username, email=email, 
            password_hash=generate_password_hash(password)
        )
        db.session.add(new_user)
        db.session.commit()
        
        session['user_id'] = new_user.id
        session['username'] = new_user.username
        
        next_url = url_for('onboarding')
        return f"""
        <script>
            localStorage.removeItem('smartBasket_active');
            window.location.href = '{next_url}';
        </script>
        """
    return render_template('signup.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        user = User.query.filter_by(email=email).first()
        
        if user and check_password_hash(user.password_hash, password):
            session['user_id'] = user.id
            session['username'] = user.username
            
            pref = UserPreference.query.filter_by(user_id=user.id).first()
            next_url = url_for('onboarding') if not pref else url_for('account')
            return f"""
            <script>
                localStorage.removeItem('smartBasket_active');
                window.location.href = '{next_url}';
            </script>
            """
        else:
            return render_template('login.html', error="Invalid email or password.")
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return """
    <script>
        localStorage.removeItem('smartBasket_active');
        window.location.href = '/login';
    </script>
    """

@app.route('/onboarding', methods=['GET', 'POST'])
def onboarding():
    if 'user_id' not in session:
        return redirect(url_for('login'))
        
    user_pref = UserPreference.query.filter_by(user_id=session['user_id']).first()
    if request.method == 'POST':
        stores = request.form.getlist('preferred_stores')
        stores_str = ",".join(stores) if stores else "Checkers"
        
        if not user_pref:
            user_pref = UserPreference(user_id=session['user_id'], preferred_store=stores_str)
            db.session.add(user_pref)
        else:
            user_pref.preferred_store = stores_str
        db.session.commit()
        return redirect(url_for('account'))
        
    return render_template('onboarding.html')

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