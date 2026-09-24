import asyncio
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta
from functools import wraps
from typing import Dict, List, Tuple

from rapidfuzz import fuzz
from apscheduler.schedulers.background import BackgroundScheduler
from fake_useragent import UserAgent
from flask import Flask, jsonify, request, render_template, session, redirect, url_for, flash, abort
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import httpx
from playwright.async_api import async_playwright

# Get absolute path of backend directory and ensure instance folder exists
basedir = os.path.abspath(os.path.dirname(__file__))
instance_dir = os.path.join(basedir, 'instance')
os.makedirs(instance_dir, exist_ok=True)

app = Flask(
    __name__,
    instance_path=instance_dir,
    template_folder='../templates',
    static_folder='../static'
)

# Enable CORS with credentials for React frontend (localhost:5173)
CORS(app, supports_credentials=True, origins=["http://localhost:5173"])

# ==========================================
# DATABASE & CONFIGURATION
# ==========================================
app.secret_key = os.environ.get('SECRET_KEY', 'smartbasket-secure-persistent-secret-key-2026')

app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = False  # Change to True if running via HTTPS
app.config['PERMANENT_SESSION_LIFETIME'] = 86400  # 1 day

db_path = os.path.join(app.instance_path, 'smartbasket.db')
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
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False) # Added for Admin banning
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    baskets = db.relationship('SavedBasket', backref='owner', lazy=True, cascade="all, delete-orphan")
    preference = db.relationship('UserPreference', backref='user', uselist=False, cascade="all, delete-orphan")
    active_cart = db.relationship('ActiveCart', backref='user', uselist=False, cascade="all, delete-orphan")
    reviews = db.relationship('Review', backref='user', lazy=True, cascade="all, delete-orphan")
    
    collaborations = db.relationship('SavedBasketCollaborator', backref='user', lazy=True)
    notifications_received = db.relationship('Notification', foreign_keys='Notification.recipient_id', backref='recipient', lazy=True)
    search_history = db.relationship('SearchHistory', backref='user', lazy=True)

class SystemLog(db.Model):
    __tablename__ = 'system_logs'
    id = db.Column(db.Integer, primary_key=True)
    action = db.Column(db.String(255), nullable=False)
    details = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

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
    name = db.Column(db.String(100), unique=True, nullable=False)
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
    
    store_id = db.Column(db.Integer, db.ForeignKey('stores.id'), nullable=True) 
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=True)
    store = db.Column(db.String(50), index=True) 
    
    price_history = db.relationship('PriceHistory', backref='product_ref', lazy=True, cascade="all, delete-orphan")
    reviews = db.relationship('Review', backref='product_ref', lazy=True, cascade="all, delete-orphan")
    deals = db.relationship('StoreDeal', backref='product_ref', lazy=True, cascade="all, delete-orphan")

class StoreDeal(db.Model):
    __tablename__ = 'store_deals'
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.String(100), db.ForeignKey('products.id'), nullable=False)
    original_price = db.Column(db.Float, nullable=False)
    sale_price = db.Column(db.Float, nullable=False)
    valid_until = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class SearchHistory(db.Model):
    __tablename__ = 'search_history'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    query = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

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
    monthly_budget = db.Column(db.Float, default=0.0) # Re-added for Budget Guardrails
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
    
    share_token = db.Column(db.String(64), unique=True, default=lambda: uuid.uuid4().hex) 
    is_collaborative = db.Column(db.Boolean, default=False)
    
    items = db.relationship('BasketItem', backref='basket', cascade='all, delete-orphan')
    collaborators = db.relationship('SavedBasketCollaborator', backref='basket_ref', cascade='all, delete-orphan')
    activities = db.relationship('BasketActivity', backref='basket', cascade='all, delete-orphan', order_by='BasketActivity.created_at.desc()')

class BasketItem(db.Model):
    __tablename__ = 'basket_items'
    id = db.Column(db.Integer, primary_key=True)
    basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    product_id = db.Column(db.String(100), db.ForeignKey('products.id'), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    price = db.Column(db.Float, nullable=True)
    competitor_prices = db.Column(db.Text, nullable=True)
    
    product = db.relationship('Product')

class BasketActivity(db.Model):
    __tablename__ = 'basket_activities'
    id = db.Column(db.Integer, primary_key=True)
    basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    action = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='activities')

class Review(db.Model):
    __tablename__ = 'reviews'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False) 
    product_id = db.Column(db.String(100), db.ForeignKey('products.id'), index=True, nullable=False) 
    rating = db.Column(db.Integer, nullable=False)
    comment = db.Column(db.Text, nullable=False)
    helpful_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    author_name = db.Column(db.String(100), default='Anonymous')

class SavedBasketCollaborator(db.Model):
    __tablename__ = 'saved_basket_collaborators'
    id = db.Column(db.Integer, primary_key=True)
    saved_basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(20), default='pending')
    role = db.Column(db.String(20), default='editor')

class Notification(db.Model):
    __tablename__ = 'notifications'
    id = db.Column(db.Integer, primary_key=True)
    recipient_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    message = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), default='unread')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# ==========================================
# DATABASE SEEDER
# ==========================================
def seed_database():
    stores = [
        {'name': 'Checkers', 'store_key': 'checkers', 'website_url': 'https://www.checkers.co.za'},
        {'name': 'Shoprite', 'store_key': 'shoprite', 'website_url': 'https://www.shoprite.co.za'},
        {'name': 'Pick n Pay', 'store_key': 'pnp', 'website_url': 'https://www.pnp.co.za'},
        {'name': 'Woolworths', 'store_key': 'woolworths', 'website_url': 'https://www.woolworths.co.za'}
    ]
    for s_data in stores:
        if not Store.query.filter_by(name=s_data['name']).first():
            db.session.add(Store(**s_data))

    categories = [
        {'name': 'Dairy & Fresh Milk', 'description': 'Milk, butter, cheese, and yogurt'},
        {'name': 'Fruits & Juices', 'description': 'Fresh fruit and fruit juices'},
        {'name': 'Pantry Staples', 'description': 'Rice, pasta, oil, sugar, and flour'},
        {'name': 'Bakery & Breads', 'description': 'Fresh baked breads and rolls'},
        {'name': 'Snacks & Treats', 'description': 'Chips, chocolates, and biscuits'},
        {'name': 'Meat & Poultry', 'description': 'Chicken, beef, steak, and mince'}
    ]
    for c_data in categories:
        if not Category.query.filter_by(name=c_data['name']).first():
            db.session.add(Category(**c_data))
            
    db.session.commit()
    print("Database seeding completed: Stores and Categories populated.")

with app.app_context():
    db.create_all()
    seed_database()
    if not User.query.filter_by(is_admin=True).first():
        default_admin = User(
            username='SystemAdmin',
            email='admin@smartbasket.local',
            password_hash=generate_password_hash('admin123'),
            is_admin=True,
            is_active=True
        )
        db.session.add(default_admin)
        db.session.commit()
        print("Default admin account created: admin@smartbasket.local | Password: admin123")

def log_system_event(action: str, details: str = None):
    try:
        new_log = SystemLog(action=action, details=details)
        db.session.add(new_log)
        db.session.commit()
    except Exception:
        db.session.rollback()

# ==========================================
# ADMIN DECORATOR & STATUS CHECK
# ==========================================
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'error': 'Authentication required'}), 401
        
        current_user = db.session.get(User, user_id)
        if not current_user or not current_user.is_admin:
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return decorated_function

def check_active_status(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get('user_id')
        if user_id:
            current_user = db.session.get(User, user_id)
            if current_user and not current_user.is_active:
                session.clear()
                return jsonify({'error': 'Account suspended. Please contact support.'}), 403
        return f(*args, **kwargs)
    return decorated_function

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
    if not products_list:
        return
    try:
        with app.app_context():
            for item in products_list:
                prod_id = str(item.get('id', ''))
                if not prod_id:
                    continue
                
                existing = db.session.get(Product, prod_id)
                store_name = item.get('store', 'Unknown')
                store_record = Store.query.filter_by(name=store_name).first()
                store_id = store_record.id if store_record else None
                price_val = float(item.get('price', 0.0))

                if not existing:
                    new_p = Product(
                        id=prod_id,
                        name=item.get('name', 'Unknown Product'),
                        store=store_name,
                        store_id=store_id,
                        price=price_val,
                        formatted_price=item.get('formattedPrice', f"R {price_val:.2f}"),
                        image_url=item.get('imageUrl', '')
                    )
                    db.session.add(new_p)
                else:
                    existing.price = price_val
                    existing.last_updated = datetime.utcnow()

                # Always log price history
                db.session.add(PriceHistory(
                    product_id=prod_id,
                    price=price_val,
                    store_name=store_name
                ))
            db.session.commit()
            print(f"[Database] Successfully logged {len(products_list)} products to main database.")
    except Exception as e:
        db.session.rollback()
        print(f"[Database Error] Failed to log search results: {e}")

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

def refresh_tokens_sync(target_store='all'):
    async def run_harvest():
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True, 
                args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
            )
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            )
            if target_store in ['all', 'pnp']:
                await harvest_tokens_for_store(context, 'pnp', 'https://www.pnp.co.za')
            if target_store in ['all', 'shoprite']:
                await harvest_tokens_for_store(context, 'shoprite', 'https://www.shoprite.co.za')
            if target_store in ['all', 'checkers']:
                await harvest_tokens_for_store(context, 'checkers', 'https://www.checkers.co.za')
            await browser.close()
            
    print(f"[Scheduler] Harvesting WAF tokens for store: {target_store}...")
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

# --- Admin API Routes ---
@app.route('/api/admin/stats', methods=['GET'])
@admin_required
def api_admin_stats():
    total_users = User.query.count()
    active_users = User.query.filter_by(is_active=True).count()
    total_products = Product.query.count()
    total_baskets = SavedBasket.query.count()
    
    # FIX: Use db.select to avoid conflict with the 'query' column name in SearchHistory
    total_searches = db.session.scalar(db.select(db.func.count(SearchHistory.id))) or 0
    
    return jsonify({
        "usersCount": total_users,
        "activeUsers": active_users,
        "productsCount": total_products,
        "basketsCount": total_baskets,
        "searchesCount": total_searches,
        "activeScrapers": 4
    })

@app.route('/api/admin/users', methods=['GET'])
@admin_required
def api_admin_users():
    users = User.query.all()
    return jsonify([{
        "id": u.id,
        "username": u.username,
        "email": u.email,
        "role": "Admin" if u.is_admin else "User",
        "is_active": u.is_active,
        "joined": u.created_at.strftime('%Y-%m-%d')
    } for u in users])

@app.route('/api/admin/users', methods=['POST'])
@admin_required
def api_admin_create_user():
    data = request.json or {}
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    is_admin = bool(data.get('is_admin', False))

    if not username or not email or not password:
        return jsonify({'error': 'Username, email, and password are required.'}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'A user with this email already exists.'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'This username is already taken.'}), 400

    try:
        new_user = User(
            username=username,
            email=email,
            password_hash=generate_password_hash(password),
            is_admin=is_admin,
            is_active=True
        )
        db.session.add(new_user)
        db.session.commit()
        log_system_event("User Created", f"Admin created user: {username}")
        
        return jsonify({
            'success': True,
            'user': {
                'id': new_user.id,
                'username': new_user.username,
                'email': new_user.email,
                'role': 'Admin' if new_user.is_admin else 'User',
                'is_active': new_user.is_active,
                'joined': new_user.created_at.strftime('%Y-%m-%d')
            }
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/users/<int:user_id>/toggle-status', methods=['POST'])
@admin_required
def api_admin_toggle_user_status(user_id):
    user = db.session.get(User, user_id)
    if not user: return jsonify({'error': 'User not found'}), 404
    if user.is_admin: return jsonify({'error': 'Cannot suspend an administrative account.'}), 403
    
    user.is_active = not user.is_active
    db.session.commit()
    log_system_event("User Status Changed", f"Admin {'activated' if user.is_active else 'suspended'} user: {user.username}")
    
    return jsonify({'success': True, 'is_active': user.is_active})

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def api_admin_delete_user(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.is_admin and User.query.filter_by(is_admin=True).count() <= 1:
        return jsonify({'error': 'Cannot delete the last remaining administrator.'}), 400
    
    username = user.username
    db.session.delete(user)
    db.session.commit()
    log_system_event("User Deleted", f"Admin deleted user: {username}")
    return jsonify({'success': True})

@app.route('/api/admin/system/trigger-job', methods=['POST'])
@admin_required
def api_admin_trigger_job():
    store = (request.json or {}).get('store', 'all')
    try:
        threading.Thread(target=refresh_tokens_sync, args=(store,), daemon=True).start()
        log_system_event("Scraper Triggered", f"Manual trigger for store: {store}")
        return jsonify({'success': True, 'message': f'Scrapers triggered successfully for [{store}].'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/system/clear-cache', methods=['POST'])
@admin_required
def api_admin_clear_cache():
    try:
        if os.path.exists(CACHE_DB_FILE):
            os.remove(CACHE_DB_FILE)
        init_cache_db()
        log_system_event("Cache Cleared", "Admin manually flushed search cache")
        return jsonify({'success': True, 'message': 'Search cache successfully flushed.'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/logs', methods=['GET'])
@admin_required
def api_admin_logs():
    logs = SystemLog.query.order_by(SystemLog.created_at.desc()).limit(50).all()
    return jsonify([{
        'id': l.id,
        'action': l.action,
        'details': l.details,
        'date': l.created_at.strftime('%Y-%m-%d %H:%M:%S')
    } for l in logs])

# --- Standard Routes ---
@app.route('/favicon.ico')
def favicon(): return '', 204

@app.route('/api/search', methods=['GET'])
@check_active_status
def handle_search():
    query = request.args.get('q', '').strip().lower()
    store_filter = request.args.get('store', 'all').strip().lower()
    sort_option = request.args.get('sort', '').strip().lower()
    if not query: return jsonify([])

    # Log Search to populate SearchHistory with 5-second deduplication guard
    try:
        with app.app_context():
            user_id = session.get('user_id')
            if user_id:
                five_seconds_ago = datetime.utcnow() - timedelta(seconds=5)
                recent_duplicate = db.session.query(SearchHistory).filter(
                    SearchHistory.__table__.c.query == query,
                    SearchHistory.user_id == user_id,
                    SearchHistory.created_at >= five_seconds_ago
                ).first()
                
                if not recent_duplicate:
                    db.session.add(SearchHistory(user_id=user_id, query=query))
                    db.session.commit()
    except Exception:
        db.session.rollback()

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
    query = request.args.get('q', '').strip().lower()
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

@app.route('/api/analytics/price-history/<path:product_id>', methods=['GET'])
def get_price_history(product_id):
    history = PriceHistory.query.filter_by(product_id=product_id).order_by(PriceHistory.recorded_at.asc()).all()
    if not history:
        prod = db.session.get(Product, product_id)
        if not prod:
            return jsonify([])
        return jsonify([{
            'date': prod.last_updated.strftime('%Y-%m-%d'),
            'price': prod.price,
            'store': prod.store
        }])
        
    return jsonify([{
        'date': h.recorded_at.strftime('%Y-%m-%d'),
        'price': h.price,
        'store': h.store_name
    } for h in history])

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
@check_active_status
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
        
        try:
            cart_record = db.session.get(ActiveCart, user_id)
            if not cart_record:
                cart_record = ActiveCart(user_id=user_id, items_json=json.dumps(items))
                db.session.add(cart_record)
            else:
                cart_record.items_json = json.dumps(items)
            db.session.commit()
            return jsonify({'authenticated': True, 'success': True, 'message': 'Cart successfully updated.'})
        except Exception as e:
            db.session.rollback()
            return jsonify({'authenticated': True, 'success': False, 'error': str(e)})

@app.route('/api/db/save-basket', methods=['POST'])
@check_active_status
def save_basket_to_db():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Authentication required. Please log in.'}), 401

    data = request.json or {}
    basket_id = data.get('basket_id')
    basket_name = data.get('name', 'My Saved Basket')
    items = data.get('items', [])
    if not items: 
        return jsonify({'error': 'No items in basket'}), 400

    try:
        sender_name = session.get('username', 'Someone')
        change_description = f"{sender_name} updated the list."

        if basket_id:
            basket = db.session.get(SavedBasket, basket_id)
            if not basket:
                return jsonify({'error': 'Basket not found'}), 404
            if not user_can_edit_basket(basket_id, user_id):
                return jsonify({'error': 'Unauthorized'}), 403
            
            old_items_map = {bi.product_id: bi for bi in basket.items}
            new_items_map = {item['id']: item for item in items}

            added = [item['name'] for pid, item in new_items_map.items() if pid not in old_items_map]
            removed = [bi.product.name for pid, bi in old_items_map.items() if pid not in new_items_map and bi.product]
            modified = []
            for pid, item in new_items_map.items():
                if pid in old_items_map:
                    old_qty = old_items_map[pid].quantity
                    new_qty = item.get('quantity', 1)
                    if old_qty != new_qty:
                        modified.append(f"{item['name']} (Qty: {old_qty} ➔ {new_qty})")

            details = []
            if added: details.append(f"Added: {', '.join(added)}")
            if removed: details.append(f"Removed: {', '.join(removed)}")
            if modified: details.append(f"Changed qty: {', '.join(modified)}")
            
            if details:
                change_description = f"{sender_name} " + "; ".join(details) + "."

            basket.name = basket_name
            BasketItem.query.filter_by(basket_id=basket.id).delete()
            target_basket_id = basket.id
        else:
            basket = SavedBasket(name=basket_name, user_id=user_id)
            db.session.add(basket)
            db.session.flush()
            target_basket_id = basket.id
            change_description = f"{sender_name} created the list with {len(items)} items."

        async def get_all_competitors():
            tasks = [internal_fetch_competitors(item['name']) for item in items]
            return await asyncio.gather(*tasks)
        
        competitors_lists = asyncio.run(get_all_competitors())
        current_total = 0.0

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
            quantity = item.get('quantity', 1)
            current_total += (snapshot_price * quantity)
            
            db.session.add(BasketItem(
                basket_id=target_basket_id, 
                product_id=item['id'], 
                quantity=quantity,
                price=snapshot_price,
                competitor_prices=json.dumps(comps)
            ))

        # Check Budget Guardrails
        budget_warning = False
        user_pref = UserPreference.query.filter_by(user_id=user_id).first()
        if user_pref and user_pref.monthly_budget and user_pref.monthly_budget > 0:
            if current_total > user_pref.monthly_budget:
                budget_warning = True

        has_collaborators = SavedBasketCollaborator.query.filter_by(saved_basket_id=basket.id).count() > 0
        if basket.is_collaborative or has_collaborators:
            basket.is_collaborative = True
            
            db.session.add(BasketActivity(
                basket_id=basket.id,
                user_id=user_id,
                action=change_description
            ))

            collabs = SavedBasketCollaborator.query.filter_by(saved_basket_id=basket.id, status='accepted').all()
            for c in collabs:
                if c.user_id != user_id:
                    db.session.add(Notification(
                        recipient_id=c.user_id,
                        sender_id=user_id,
                        basket_id=basket.id,
                        message=change_description
                    ))
            if basket.user_id != user_id:
                db.session.add(Notification(
                    recipient_id=basket.user_id,
                    sender_id=user_id,
                    basket_id=basket.id,
                    message=change_description
                ))

        db.session.commit()
        return jsonify({
            'success': True, 
            'basket_id': target_basket_id,
            'basket_total': current_total,
            'budget_warning': budget_warning
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/saved-baskets/<int:basket_id>', methods=['DELETE'])
@check_active_status
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
    
    users = User.query.filter(
        User.username.ilike(f'%{query}%'), 
        User.id != session['user_id'],
        User.is_admin == False,
        User.is_active == True
    ).limit(5).all()
    
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
@check_active_status
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
        
    target_user = db.session.get(User, target_user_id)
    if not target_user or target_user.is_admin or not target_user.is_active:
        return jsonify({'error': 'Invalid user account'}), 403

    basket.is_collaborative = True
    if not basket.name.endswith("(Collab)"):
        basket.name = f"{basket.name} (Collab)"

    existing = SavedBasketCollaborator.query.filter_by(saved_basket_id=basket.id, user_id=target_user_id).first()
    if existing:
        return jsonify({'error': 'User is already invited or a member'}), 400

    collab = SavedBasketCollaborator(saved_basket_id=basket.id, user_id=target_user_id, status='pending')
    db.session.add(collab)

    sender_name = session.get('username', 'Someone')
    notif = Notification(
        recipient_id=target_user_id,
        sender_id=session['user_id'],
        basket_id=basket.id,
        message=f"{sender_name} invited you to collaborate on list: '{basket.name}'"
    )
    db.session.add(notif)
    db.session.commit()
    
    return jsonify({'success': True, 'basket_id': basket.id})

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

    owned_personal = SavedBasket.query.filter_by(user_id=user_id, is_collaborative=False).order_by(SavedBasket.created_at.desc()).all()
    
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
        
        activities_list = [{
            'user': {'username': act.user.username if act.user else 'Someone'},
            'action': act.action,
            'created_at': act.created_at.strftime('%Y-%m-%d %H:%M')
        } for act in b.activities]

        output.append({
            'id': b.id, 'name': b.name, 'date': b.created_at.strftime('%Y-%m-%d'), 
            'items': items_list, 'is_shared': (b.user_id != user_id), 'is_collab': True,
            'inviter_name': inviter_name,
            'activities': activities_list
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

@app.route('/api/db/saved-baskets/<int:basket_id>/items/<path:product_id>', methods=['PATCH', 'DELETE'])
@check_active_status
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
# Searching & Trending Routes
# ==========================================

@app.route('/api/search/history', methods=['GET'])
def get_search_history():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify([])  # Strictly restrict history dropdown to logged-in users
    
    history = db.session.query(SearchHistory).filter_by(user_id=user_id).order_by(SearchHistory.created_at.desc()).limit(15).all()
    
    seen = set()
    unique_history = []
    for h in history:
        if h.query.lower() not in seen:
            seen.add(h.query.lower())
            unique_history.append({'id': h.id, 'query': h.query})
            
    return jsonify(unique_history[:8])

@app.route('/api/search/history/<int:history_id>', methods=['DELETE'])
def delete_search_history_item(history_id):
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Unauthorized'}), 401
        
    item = db.session.query(SearchHistory).filter_by(id=history_id, user_id=user_id).first()
    if item:
        db.session.delete(item)
        db.session.commit()
        
    return jsonify({'success': True})

@app.route('/api/trending-searches', methods=['GET'])
def get_trending_searches():
    try:
        from sqlalchemy import func
        query_col = func.lower(SearchHistory.__table__.c.query)
        
        # Optional: Limit trending to searches within the last 24 hours for daily trending
        one_day_ago = datetime.utcnow() - timedelta(days=1)
        
        top_searches = db.session.query(
            query_col, func.count(SearchHistory.id).label('count')
        ).filter(SearchHistory.created_at >= one_day_ago)\
         .group_by(query_col)\
         .order_by(func.count(SearchHistory.id).desc())\
         .limit(8).all()
        
        return jsonify([{'query': item[0], 'count': item[1]} for item in top_searches])
    except Exception as e:
        return jsonify([])

# ==========================================
# HTML FRONTEND ROUTES (Bridged to React)
# ==========================================

@app.route('/')
@app.route('/search')
@app.route('/basket')
@app.route('/saved')
@app.route('/collaborative')
@app.route('/notifications')
def redirect_to_react():
    query_string = request.query_string.decode('utf-8')
    path = request.path
    redirect_url = f"http://localhost:5173{path}"
    if query_string:
        redirect_url += f"?{query_string}"
    return redirect(redirect_url)

@app.route('/account')
def account():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return redirect('http://localhost:5173/account')

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        
        if User.query.filter_by(email=email).first():
            return render_template('signup.html', error="Email already exists.")
            
        if User.query.filter_by(username=username).first():
            return render_template('signup.html', error="Username is already taken.")
            
        new_user = User(
            username=username, email=email, 
            password_hash=generate_password_hash(password)
        )
        db.session.add(new_user)
        db.session.commit()
        
        session['user_id'] = new_user.id
        session['username'] = new_user.username
        
        return f"""
        <script>
            localStorage.removeItem('smartBasket_active');
            window.location.href = 'http://localhost:5173/account';
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
            if not user.is_active:
                return render_template('login.html', error="Your account has been suspended by an administrator.")
                
            session['user_id'] = user.id
            session['username'] = user.username
            session['is_admin'] = user.is_admin
            
            if user.is_admin:
                return f"""
                <script>
                    localStorage.removeItem('smartBasket_active');
                    window.location.href = 'http://localhost:5173/admin';
                </script>
                """
            else:
                return f"""
                <script>
                    localStorage.removeItem('smartBasket_active');
                    window.location.href = 'http://localhost:5173/account';
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
        window.location.href = 'http://localhost:5173/';
    </script>
    """

@app.route('/onboarding', methods=['GET', 'POST'])
@check_active_status
def onboarding():
    if 'user_id' not in session:
        return redirect(url_for('login'))
        
    user_pref = UserPreference.query.filter_by(user_id=session['user_id']).first()
    if request.method == 'POST':
        stores = request.form.getlist('preferred_stores')
        stores_str = ",".join(stores) if stores else "Checkers"
        budget = request.form.get('monthly_budget', 0.0, type=float)
        
        if not user_pref:
            user_pref = UserPreference(user_id=session['user_id'], preferred_store=stores_str, monthly_budget=budget)
            db.session.add(user_pref)
        else:
            user_pref.preferred_store = stores_str
            user_pref.monthly_budget = budget
            
        db.session.commit()
        return redirect('http://localhost:5173/account')
        
    return render_template('onboarding.html')

@app.route('/api/popular', methods=['GET'])
def get_popular_products():
    popular_queries = ['milk', 'bread', 'eggs', 'chicken', 'rice', 'sugar', 'cooking oil', 'juice']

    async def fetch_popular():
        tasks = []
        for q in popular_queries:
            tasks.append(scrape_pnp(q, page_size=2))
            tasks.append(scrape_shoprite(q, page_size=2))
            tasks.append(scrape_checkers(q, page_size=2))
            tasks.append(scrape_woolworths(q, page_size=2))

        results = await asyncio.gather(*tasks)

        query_buckets = []
        for i in range(0, len(results), 4):
            chunk = results[i:i+4]
            query_buckets.append(chunk)

        rotated = []

        for q_idx, store_chunks in enumerate(query_buckets):
            store_idx = q_idx % 4
            ordered_chunks = store_chunks[store_idx:] + store_chunks[:store_idx]
            for store_results in ordered_chunks:
                for p in store_results:
                    pid = p.get('id', '')
                    name = p.get('name', '')
                    if p.get('price', 0) > 0 and pid not in [x['id'] for x in rotated]:
                        if not any(fuzz.token_set_ratio(name.lower(), x['name'].lower()) > 75 for x in rotated):
                            rotated.append(p)
                            break

        return rotated[:24]

    products = asyncio.run(fetch_popular())
    return jsonify(products)

@app.route('/api/me', methods=['GET'])
def get_current_user():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'authenticated': False}), 200
        
    user = db.session.get(User, user_id)
    if not user or not user.is_active:
        session.clear()
        return jsonify({'authenticated': False}), 200
        
    user_pref = UserPreference.query.filter_by(user_id=user_id).first()
    budget = user_pref.monthly_budget if user_pref else 0.0
    
    return jsonify({
        'authenticated': True,
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'is_admin': user.is_admin,
        'monthly_budget': budget,
        'created_at': user.created_at.strftime('%B %Y')
    })

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
        
    app.run(host='127.0.0.1', port=5000, debug=True)