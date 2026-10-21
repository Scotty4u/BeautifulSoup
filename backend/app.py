from product_categories import display_category, retailer_categories
import asyncio
import secrets
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
import uuid
from urllib.parse import urljoin, urlparse
from datetime import datetime, timedelta, date
from functools import wraps
from typing import Dict, List, Tuple

from rapidfuzz import fuzz
from apscheduler.schedulers.background import BackgroundScheduler
from fake_useragent import UserAgent
from flask import Flask, jsonify, request, render_template, session, redirect, url_for, flash, abort, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash, check_password_hash
import httpx
from playwright.async_api import async_playwright
from store_locations import nearby_branches, search_places, validate_location, SUPPORTED
from smartbasket_helpers import clean_list_name, normalize_list_name

basedir = os.path.abspath(os.path.dirname(__file__))
instance_dir = os.path.join(basedir, 'instance')
os.makedirs(instance_dir, exist_ok=True)

IS_PRODUCTION = (
    os.environ.get('SMARTBASKET_ENV', '').strip().lower() == 'production'
    or bool(os.environ.get('RAILWAY_PROJECT_ID')
            or os.environ.get('RAILWAY_ENVIRONMENT_ID')
            or os.environ.get('RAILWAY_ENVIRONMENT_NAME'))
)
REACT_DIST_DIR = os.path.abspath(os.path.join(basedir, '..', 'frontend', 'dist'))

app = Flask(
    __name__,
    instance_path=instance_dir,
    template_folder='../templates',
    static_folder='../static'
)

if not IS_PRODUCTION:
    CORS(app, supports_credentials=True,
         origins=['http://localhost:5173', 'http://127.0.0.1:5173'])

def load_persistent_flask_secret():
    """Keep sessions valid across development reloads and application restarts.

    Use SECRET_KEY from the environment for deployments. Otherwise generate a
    secret only once and store it in the private backend/instance directory.
    Never commit or share instance/.flask_secret_key.
    """
    configured = os.environ.get('SECRET_KEY')
    if configured:
        return configured

    key_file = os.path.join(instance_dir, '.flask_secret_key')
    try:
        descriptor = os.open(key_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write(secrets.token_urlsafe(48))

    with open(key_file, encoding='utf-8') as handle:
        persisted_key = handle.read().strip()
    if not persisted_key:
        raise RuntimeError(f'Flask session key file is empty: {key_file}')
    return persisted_key


app.secret_key = load_persistent_flask_secret()

app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = IS_PRODUCTION  # HTTPS only on Railway
app.config['PERMANENT_SESSION_LIFETIME'] = 14 * 86400  # 14 days; admin sessions separately expire after 8h

db_path = os.environ.get(
    "SMARTBASKET_DB_PATH",
    os.path.join(app.instance_path, "smartbasket.db")
)

os.makedirs(os.path.dirname(db_path), exist_ok=True)

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + db_path
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

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


def run_async(coroutine):
    """Run a request's async scraper work and always release its pooled sockets."""
    async def runner():
        try:
            return await coroutine
        finally:
            loop = asyncio.get_running_loop()
            client = _http_clients.pop(loop, None)
            if client is not None and not client.is_closed:
                await client.aclose()
            _semaphores.pop(loop, None)
    return asyncio.run(runner())

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    location = db.Column(db.String(100), default='Ibhayi, Eastern Cape')
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    nearby_radius_km = db.Column(db.Integer, default=15, nullable=False)
    date_of_birth = db.Column(db.Date, nullable=True)
    age_confirmation = db.Column(db.Boolean, nullable=True)  # Explicit self-declaration: None=not answered
    postal_code = db.Column(db.String(12), nullable=True)
    notifications_opt_in = db.Column(db.Boolean, default=False, nullable=False)
    marketing_opt_in = db.Column(db.Boolean, default=False, nullable=False)
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
    product_url = db.Column(db.Text)
    barcode = db.Column(db.String(14))
    age_restricted = db.Column(db.Boolean, default=False, nullable=False)
    catalog_category = db.Column(db.String(48), default='Other', nullable=False, index=True)
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

class SearchActionReceipt(db.Model):
    """One database-backed receipt per deliberate search action, per user.

    React may call /api/search multiple times for filters or during development
    re-renders. Repeated requests sharing a search_action_id are one search.
    A subsequent deliberate search gets a new ID, even for the same text.
    """
    __tablename__ = 'search_action_receipts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    action_id = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint('user_id', 'action_id', name='uq_user_search_action'),)


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
    monthly_budget = db.Column(db.Float, default=0.0)
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
    name_key = db.Column(db.Text, nullable=True)  # normalized per-owner uniqueness, migration below
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    share_token = db.Column(db.String(64), unique=True, default=lambda: uuid.uuid4().hex)
    # A token alone does not publish a saved list. Owners must explicitly share it.
    is_public = db.Column(db.Boolean, default=False, nullable=False)
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
    db.create_all() # This creates the database file automatically if it doesn't exist
    # db.create_all() doesn't add columns to existing SQLite tables. Keep user data.
    # For other database engines, use Alembic migrations instead.
    if db.engine.dialect.name == 'sqlite':
        present = {row[1] for row in db.session.execute(db.text('PRAGMA table_info(products)'))}
        for column, sql_type in (('product_url', 'TEXT'), ('barcode', 'VARCHAR(14)'), ('age_restricted', 'BOOLEAN DEFAULT 0 NOT NULL'), ('catalog_category', "VARCHAR(48) DEFAULT 'Other' NOT NULL")):
            if column not in present:
                db.session.execute(db.text(f'ALTER TABLE products ADD COLUMN {column} {sql_type}'))
        present_users = {row[1] for row in db.session.execute(db.text('PRAGMA table_info(users)'))}
        for column, sql_type in (
            ('date_of_birth', 'DATE'), ('age_confirmation', 'BOOLEAN'), ('postal_code', 'VARCHAR(12)'),
            ('notifications_opt_in', 'BOOLEAN DEFAULT 0 NOT NULL'),
            ('marketing_opt_in', 'BOOLEAN DEFAULT 0 NOT NULL'),
            ('latitude', 'FLOAT'), ('longitude', 'FLOAT'),
            ('nearby_radius_km', 'INTEGER DEFAULT 15 NOT NULL'),
        ):
            if column not in present_users:
                db.session.execute(db.text(f'ALTER TABLE users ADD COLUMN {column} {sql_type}'))
        # Preserve existing saved lists as private, including lists which
        # already had a share_token generated at creation time.
        present_baskets = {row[1] for row in db.session.execute(db.text('PRAGMA table_info(saved_baskets)'))}
        if 'is_public' not in present_baskets:
            db.session.execute(db.text('ALTER TABLE saved_baskets ADD COLUMN is_public BOOLEAN DEFAULT 0 NOT NULL'))
        if 'name_key' not in present_baskets:
            db.session.execute(db.text('ALTER TABLE saved_baskets ADD COLUMN name_key TEXT'))
        # Preserve legacy duplicate display names without renaming/deleting any list.
        # One original keeps its claim; later duplicates retain a NULL claim until
        # renamed. New names are unique per owner, enforced atomically by SQLite.
        claims = set()
        for old_id, owner_id, old_name, old_key in db.session.execute(
                db.text('SELECT id, user_id, name, name_key FROM saved_baskets ORDER BY id')):
            key = normalize_list_name(old_name)
            unique_key = (owner_id, key)
            desired = key if key and unique_key not in claims else None
            if old_key != desired:
                db.session.execute(db.text('UPDATE saved_baskets SET name_key=:key WHERE id=:id'),
                                   {'key': desired, 'id': old_id})
            claims.add(unique_key)
        db.session.execute(db.text('CREATE UNIQUE INDEX IF NOT EXISTS '
                                   'uq_saved_baskets_owner_name_key '
                                   'ON saved_baskets(user_id, name_key) WHERE name_key IS NOT NULL'))
        db.session.commit()
    seed_database() # This adds the stores and categories

    # DEVELOPMENT BOOTSTRAP: create the requested default admin on first setup.
    # Never overwrite an existing administrator's password during restart.
    # Set SMARTBASKET_ADMIN_EMAIL and SMARTBASKET_ADMIN_PASSWORD to override
    # these defaults for deployment, then rotate the password immediately.
    if not User.query.filter_by(is_admin=True).first():
        admin_email = os.environ.get('SMARTBASKET_ADMIN_EMAIL', '').strip()
        admin_password = os.environ.get('SMARTBASKET_ADMIN_PASSWORD', '')
        if IS_PRODUCTION and (not admin_email or not admin_password):
            print('SECURITY: No administrator created. Configure both '
                  'SMARTBASKET_ADMIN_EMAIL and SMARTBASKET_ADMIN_PASSWORD.')
        else:
            # Development-only defaults; never generate a known password online.
            admin_email = admin_email or 'admin@smartbasket.local'
            admin_password = admin_password or 'admin123'
            if (User.query.filter_by(email=admin_email).first()
                    or User.query.filter_by(username='SystemAdmin').first()):
                print('Admin bootstrap skipped: email or username already belongs to another account. '
                      'Resolve that account explicitly rather than changing its privileges automatically.')
            else:
                db.session.add(User(
                    username='SystemAdmin', email=admin_email,
                    password_hash=generate_password_hash(admin_password),
                    is_admin=True, is_active=True,
                ))
                db.session.commit()
                print(f'First administrator created: {admin_email}. '
                      'Set a strong unique password before deploying publicly.')

    # Earlier deployments may have created SystemAdmin with the old, known
    # admin123 password. Rotate ONLY that unsafe bootstrap account using the
    # secure credentials already configured in Railway's environment.
    if IS_PRODUCTION:
        system_admin = User.query.filter_by(username='SystemAdmin', is_admin=True).first()
        if system_admin and check_password_hash(system_admin.password_hash, 'admin123'):
            secure_email = os.environ.get('SMARTBASKET_ADMIN_EMAIL', '').strip()
            secure_password = os.environ.get('SMARTBASKET_ADMIN_PASSWORD', '')
            email_in_use = (User.query.filter_by(email=secure_email).first()
                            if secure_email else None)
            if (secure_email and len(secure_password) >= 12
                    and secure_password != 'admin123'
                    and (email_in_use is None or email_in_use.id == system_admin.id)):
                system_admin.email = secure_email
                system_admin.password_hash = generate_password_hash(secure_password)
                db.session.commit()
                print('SECURITY: Rotated insecure default administrator credentials.')
            else:
                print('SECURITY WARNING: Default administrator still has a known '
                      'password. Set a unique admin email and a password of '
                      'at least 12 characters in Railway immediately.')

    if Product.query.count() == 0:
        print("⚠️ Empty database detected (First Run). Triggering background seeder...")
        import threading
        from seeder import seed_initial_data

        threading.Thread(target=seed_initial_data, daemon=True).start()

def log_system_event(action: str, details: str = None):
    try:
        new_log = SystemLog(action=action, details=details)
        db.session.add(new_log)
        db.session.commit()
    except Exception:
        db.session.rollback()

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
                return jsonify({'error': 'Your account has been suspended.',
                                'code': 'ACCOUNT_SUSPENDED', 'suspended': True}), 403
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

# Gunicorn imports app.py instead of running it as __main__. Initialize the
# ephemeral search-cache TABLE during module import in both environments.
# This does not touch the persistent customer/order database.
init_cache_db()

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

# === Centralised catalogue classification ===
# Classify every item *before* returning or storing it. Store metadata and an
# explicit retailer age flag take priority over heuristic title matching.
# This is conservative keyword/catalogue filtering, not verified age assurance.
_CATEGORY_TEXT_FIELDS = (
    'category', 'catalogCategory', 'categoryName', 'category_name',
    'department', 'departmentName', 'department_name', 'subCategory',
    'subcategory', 'subCategoryName', 'productType', 'product_type',
    'breadcrumbs', 'categories', 'hierarchy', 'taxonomy', 'tags',
    'categoryPath', 'categoryLabel', 'aisle', 'aisleName', 'departments',
)
_CLOTHING = re.compile(
    r"\b(?:tangas?|thongs?|panties|knickers|underwear|underpants|briefs|boxers|"
    r"lingerie|bras?|bralettes?|swimwear|swimsuits?|bikinis?|"
    r"jeans|pants?|shorts|trousers|leggings|dresses|skirts|blouses|tank\s+tops?|shirts?|t-shirts?|"
    r"hoodies?|sweatshirts?|sweaters?|cardigans?|jerseys?|jackets?|coats?|jumpsuits?|tracksuits?|sleepwear|"
    r"pyjamas?|pajamas?|nightwear|socks?|stockings|"
    r"sandals?|slippers?|trainers?|sneakers?|footwear|shoes?|boots?|rompers?|onesies?|tights?|"
    r"apparel|clothing|menswear|womenswear|kidswear|activewear|fashion|"
    r"handbags?|scarves?|beanies?|gloves|baby\s+clothes|"
    r"school\s+uniforms?|shoe\s+laces|nighties?|vests?|men'?s\s+wear|women'?s\s+wear)\b", re.I
)
_CLOTHING_CATEGORIES = re.compile(
    r"\b(?:clothing|apparel|fashion|lingerie|underwear|intimates|"
    r"footwear|swimwear|menswear|womenswear|kidswear|babywear|"
    r"garments|sleepwear|accessories\s*[/>]\s*clothing)\b", re.I
)
_ALCOHOL = re.compile(
    r"\b(?:alcohol(?:ic)?|liquor|spirits?|beer|lager|pilsner|ale|cider|"
    r"whisk(?:e)?y|vodka|gin|brandy|rum|tequila|wine|wines|champagne|"
    r"prosecco|liqueur|cognac|absinthe|schnapps|hard\s+seltzer|"
    r"savann?ah?|hunters\s+(?:dry|gold|extreme)|castle(?:\s+(?:lite|lager|double\s+malt))?|"
    r"carling\s+black\s+label|heineken|windhoek|amstel|hansa|"
    r"flying\s+fish|smirnoff|klipdrift|j[aä]germeister|"
    r"jack\s+daniel'?s|johnnie\s+walker|strongbow|"
    r"stella\s+artois|corona(?:\s+extra)?|belgravia|bacardi|jameson|glenfiddich|chivas\s+regal|"
    r"brutal\s+fruit|4th\s+street|nederburg|tassies|bavaria\s+beer|"
    r"robertson\s+wines?|cape\s+velvet|gordons\s+gin|"
    r"absolute?\s+vodka|tanqueray|j\s*&\s*b|red\s+heart\s+rum)\b", re.I
)
_TOBACCO = re.compile(
    r"\b(?:tobacco|cigarettes?|cigars?|nicotine|vapes?|e-cigarettes?|"
    r"rolling\s+tobacco|snuff|shisha|hookah|marlboro|dunhill\s+cigarettes|peter\s+stuyvesant|benson\s*&\s*hedges|rothmans)\b", re.I
)
_ADULT_OTHER = re.compile(r"(?<!\w)18\+(?!\w)|\b(?:adult\s+(?:toys?|dvd|magazines?|content)|explicit\s+content)\b", re.I)
_ALCOHOL_EXCEPTIONS = re.compile(
    r"\b(?:wine\s+(?:gums?|vinegar)|beer\s+(?:battered|bread)|"
    r"non[- ]?alcoholic|alcohol[- ]?free|zero\s+alcohol|"
    r"cooking\s+wine\s+vinegar|ginger\s+ale|methylated\s+spirits|surgical\s+spirits|rubbing\s+alcohol|rubber\s+gloves)\b", re.I
)


def _metadata_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return ' '.join(_metadata_text(v) for v in value.values() if isinstance(v, (str, dict, list, tuple)))
    if isinstance(value, (list, tuple)):
        return ' '.join(_metadata_text(v) for v in value)
    return ''


def classify_product(item):
    """Return (display category, age restricted, is clothing) for ALL listings.

    Explicit retailer flags always win; an unknown DOB is never treated as adult.
    Clothes are excluded for every viewer including administrators.
    """
    if isinstance(item, dict):
        name = str(item.get('name') or item.get('title') or '')
        source_category = ' '.join(_metadata_text(item.get(f)) for f in _CATEGORY_TEXT_FIELDS)
        explicit = any(item.get(f) is True or str(item.get(f)).strip().lower() in ('true', 'yes', '1')
                       for f in ('ageRestricted', 'age_restricted', 'isAgeRestricted', 'restricted'))
        age_limit = (item.get('minimumAge') or item.get('minAge') or item.get('ageLimit') or 0)
        try:
            explicit |= int(age_limit) >= 18
        except (ValueError, TypeError):
            pass
    else:
        name = str(item if isinstance(item, str) else (getattr(item, 'name', '') or ''))
        source_category = str(getattr(item, 'catalog_category', '') or '')
        explicit = bool(getattr(item, 'age_restricted', False))
    cleaning_gloves = bool(re.search(
        r"\b(?:cleaning|dishwashing|rubber|latex|nitrile|examination|gardening|work)\s+gloves?\b", name, re.I))
    clothing = bool((_CLOTHING.search(name) and not cleaning_gloves)
                    or _CLOTHING_CATEGORIES.search(source_category))
    if clothing:
        return 'Clothing', False, True
    text = _ALCOHOL_EXCEPTIONS.sub(' ', name)
    # The source department is reliable for alcohol; exceptions protect foods
    # when only the product title contains an ingredient-like word.
    alcohol_category = bool(re.search(r'\b(?:alcohol(?:ic)?|liquor|beers?|wines?|spirits?|ciders?)\b', source_category, re.I))
    non_alcoholic = bool(re.search(r'\b(?:non[- ]?alcoholic|alcohol[- ]?free|zero\s+alcohol)\b', name, re.I))
    if alcohol_category or (not non_alcoholic and _ALCOHOL.search(text)):
        return 'Liquor', True, False
    if _TOBACCO.search(name) or re.search(r'\b(?:tobacco|nicotine|vapes?)\b', source_category, re.I):
        return 'Tobacco', True, False
    if explicit or _ADULT_OTHER.search(name) or re.search(r'\b(?:adult(?:\s+only|\s+beverages)?|age\s+restricted|18\+)\b', source_category, re.I):
        return 'Age Restricted', True, False
    return display_category(item), False, False


def catalog_product(item):
    """Create a fresh annotated dictionary, never mutating shared cached entries."""
    category, age_restricted, is_clothing = classify_product(item)
    if is_clothing:
        return None
    value = dict(item)
    value['catalogCategory'] = category
    value['sourceCategories'] = retailer_categories(item)
    value['ageRestricted'] = age_restricted
    return value


def product_is_adult(item):
    return classify_product(item)[1]


def product_is_clothing(item):
    return classify_product(item)[2]


def age_from_date(birthday):
    if birthday is None:
        return None
    today = date.today()
    return today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day))


def user_age_group(user):
    """Do not infer adulthood from a blank answer. A known underage DOB overrides yes."""
    if not user:
        return 'unknown'
    if user.is_admin:
        return 'admin'
    if user.date_of_birth is not None and age_from_date(user.date_of_birth) < 18:
        return 'under_18'
    if user.age_confirmation is False:
        return 'under_18'
    if user.age_confirmation is True:
        return 'adult'
    if user.date_of_birth is not None and age_from_date(user.date_of_birth) >= 18:
        return 'adult'
    return 'unknown'


def user_can_see_adult(user):
    return bool(user and user.is_active and user_age_group(user) in ('admin', 'adult'))


def viewer_age_group():
    """Unconfirmed age is underage for every content permission."""
    user_id = session.get('user_id')
    user = db.session.get(User, user_id) if user_id else None
    return user_age_group(user) if user and user.is_active else 'under_18_unverified'


def current_viewer_can_see_adult():
    user_id = session.get('user_id')
    user = db.session.get(User, user_id) if user_id else None
    return user_can_see_adult(user)


def filter_catalog_for_viewer(products):
    """Uniform restriction for every search, comparison, category and listing."""
    adult = current_viewer_can_see_adult()
    output = []
    for product in products:
        if not isinstance(product, dict):
            continue
        clean = catalog_product(product)
        if clean and (adult or not clean['ageRestricted']):
            output.append(clean)
    return output


def sanitize_catalog_json(value, allow_adult):
    """Defense in depth: recursively screen nested product payloads."""
    if isinstance(value, list):
        return [clean for item in value if (clean := sanitize_catalog_json(item, allow_adult)) is not None]
    if isinstance(value, dict):
        looks_like_product = ('name' in value and ('price' in value or 'formattedPrice' in value)
                              and ('store' in value or 'imageUrl' in value or 'productUrl' in value))
        if looks_like_product:
            clean = catalog_product(value)
            if clean is None or (clean['ageRestricted'] and not allow_adult):
                return None
            value = clean
        result = {k: sanitize_catalog_json(v, allow_adult) for k, v in value.items()}
        if isinstance(result.get('products'), list):
            visible = result['products']
            if 'found' in result:
                result['found'] = bool(visible)
            if 'cheapest' in result:
                viable = []
                for offer in visible:
                    if not isinstance(offer, dict):
                        continue
                    try:
                        amount = float(offer.get('price') or 0)
                        if math.isfinite(amount) and amount > 0:
                            viable.append((amount, offer))
                    except (TypeError, ValueError, OverflowError):
                        continue
                # Preserve the explicit exact-product winner through the global
                # catalogue sanitizer. A cheaper *equivalent* must not replace
                # a verified exact match just because the page was sanitized.
                marked = [offer for _, offer in viable if offer.get('isBestPrice')]
                if marked:
                    cheapest = min(marked, key=lambda offer: (
                        float(offer['price']), str(offer.get('id', ''))))
                else:
                    exact = [(price, offer) for price, offer in viable
                             if offer.get('matchType') != 'equivalent']
                    cheapest = min(exact or viable,
                                   key=lambda pair: (pair[0], str(pair[1].get('id', ''))))[1] if viable else None
                result['cheapest'] = cheapest
                result['bestPriceProductId'] = cheapest.get('id') if cheapest else None
        return result
    return value



@app.before_request
def reject_suspended_session_requests():
    """Suspended users cannot continue using unguarded API routes either.

    /api/me is still queryable by an already logged-in browser so the UI can
    show the three-second suspension notice before /logout clears the cookie.
    """
    uid = session.get('user_id')
    if not uid or request.path in ('/api/me', '/logout', '/login', '/signup'):
        return None
    user = db.session.get(User, uid)
    if user is not None and not user.is_active:
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Your account has been suspended.',
                            'code': 'ACCOUNT_SUSPENDED', 'suspended': True}), 403
        return redirect(url_for('logout'))
    return None


@app.after_request
def restrict_catalog_responses(response):
    if not request.path.startswith('/api/') or request.path.startswith('/api/admin/'):
        return response
    if response.status_code >= 400 or not response.is_json:
        return response
    allow_adult = current_viewer_can_see_adult()
    raw = response.get_json(silent=True)
    if raw is None:
        return response
    clean = sanitize_catalog_json(raw, allow_adult)
    if clean is None:
        response = jsonify({'error': 'Product unavailable'})
        response.status_code = 404
        return response
    if not allow_adult and request.path in ('/api/trending-searches', '/api/search/history') and isinstance(clean, list):
        clean = [row for row in clean if not product_is_adult(row.get('query', ''))]
    response.set_data(app.json.dumps(clean))
    response.headers['Content-Length'] = str(len(response.get_data()))
    return response

def log_search_results_to_db(products_list):
    if not products_list:
        return
    try:
        with app.app_context():
            changed_prices = []
            for item in products_list:
                prod_id = str(item.get('id', ''))
                if not prod_id:
                    continue

                existing = db.session.get(Product, prod_id)
                store_name = item.get('store', 'Unknown')
                store_record = Store.query.filter_by(name=store_name).first()
                store_id = store_record.id if store_record else None
                try:
                    price_val = float(item.get('price', 0.0))
                except (ValueError, TypeError, OverflowError):
                    continue
                if not math.isfinite(price_val) or price_val <= 0:
                    continue

                old_price = float(existing.price) if existing else None
                if not existing:
                    new_p = Product(
                        id=prod_id,
                        name=item.get('name', 'Unknown Product'),
                        store=store_name,
                        store_id=store_id,
                        price=price_val,
                        formatted_price=item.get('formattedPrice', f"R {price_val:.2f}"),
                        image_url=item.get('imageUrl', ''),
                        product_url=item.get('productUrl') or None,
                        age_restricted=product_is_adult(item),
                        catalog_category=classify_product(item)[0],
                        barcode=validate_gtin(item.get('barcode')) or None,
                    )
                    db.session.add(new_p)
                else:
                    existing.price = price_val
                    existing.name = item.get('name') or existing.name
                    existing.formatted_price = item.get('formattedPrice') or f"R {price_val:.2f}"
                    existing.image_url = item.get('imageUrl') or existing.image_url
                    existing.product_url = item.get('productUrl') or existing.product_url
                    existing.age_restricted = bool(existing.age_restricted or product_is_adult(item))
                    existing.catalog_category = classify_product(item)[0]
                    existing.barcode = validate_gtin(item.get('barcode')) or existing.barcode
                    existing.store = store_name
                    existing.store_id = store_id
                    existing.last_updated = datetime.utcnow()

                # Save actual observations, not a fake new graph point on every search.
                latest = PriceHistory.query.filter_by(product_id=prod_id).order_by(
                    PriceHistory.recorded_at.desc()).first()
                if (latest is None or abs(float(latest.price) - price_val) >= 0.005
                        or latest.recorded_at < datetime.utcnow() - timedelta(hours=24)):
                    db.session.add(PriceHistory(product_id=prod_id, price=price_val,
                                                store_name=store_name))
                if old_price is not None and price_val < old_price - 0.005:
                    changed_prices.append((prod_id, old_price, price_val))
            db.session.commit()
            if changed_prices:
                app.extensions['smartbasket_addons']['process_price_changes'](changed_prices)
            print(f"[Database] Successfully logged {len(products_list)} products to main database.")
    except Exception as e:
        db.session.rollback()
        print(f"[Database Error] Failed to log search results: {e}")

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
    run_async(run_harvest())
    print("[Scheduler] Token harvest complete.")

# ==========================================
# MATCHING & UTILITIES
# ==========================================
# ==========================================
# HIGH-PRECISION CROSS-RETAILER MATCHING
# ==========================================
# Price comparisons must use the SAME branded product, variant and pack size.
# If a name does not contain enough information, we deliberately do not guess.
# This is a title-based match; verified shared EAN/GTIN barcodes are stronger.

from decimal import Decimal, InvalidOperation
from functools import lru_cache
import math
import unicodedata

CLOTHING_EXCLUSIONS = {
    'shirt', 'jeans', 'dress', 'shoes', 'bra', 'briefs', 'socks', 'jacket',
    'leggings', 'sleepwear', 'cushion', 'towels', 'duvet', 'pillow', 'pants',
    't-shirt', 'skirt', 'blouse', 'sneakers', 'boots', 'homeware', 'clothing', 'apparel'
}

# Brand words are NEVER throwaway stopwords: different brands are different products.
# Multi-word brands are normalised to a single token before comparison.
BRAND_ALIASES = {
    'coca cola': 'cocacola', 'cocacola': 'cocacola', 'coke': 'cocacola',
    'pick n pay': 'picknpay', 'pick and pay': 'picknpay', 'pnp': 'picknpay',
    'all gold': 'allgold', 'simply truth': 'simplytruth',
    'kellogg s': 'kelloggs', 'kelloggs': 'kelloggs',
    'nestle': 'nestle', 'cadbury': 'cadbury', 'clover': 'clover',
    'parmalat': 'parmalat', 'sasko': 'sasko', 'albany': 'albany',
    'tastic': 'tastic', 'spekk o': 'spekko', 'spekko': 'spekko',
    'koo': 'koo', 'fanta': 'fanta', 'sprite': 'sprite',
    'woolworths': 'woolworths', 'woolies': 'woolworths',
    'shoprite': 'shoprite', 'checkers': 'checkers',
    'sunlight': 'sunlight', 'omo': 'omo', 'ariel': 'ariel',
    'nescafe': 'nescafe', 'five roses': 'fiveroses',
    'lipton': 'lipton', 'milo': 'milo', 'stork': 'stork',
    'flora': 'flora', 'nivea': 'nivea', 'kitkat': 'kitkat',
    'bar one': 'barone', 'barone': 'barone', 'lays': 'lays',
    'simba': 'simba', 'willards': 'willards', 'pringles': 'pringles',
    'fair cape': 'faircape', 'faircape': 'faircape',
    'lucky star': 'luckystar', 'luckystar': 'luckystar',
    'bokomo': 'bokomo', 'jungle': 'jungle', 'rhodes': 'rhodes',
    'mccain': 'mccain', 'snowflake': 'snowflake',
    'robertsons': 'robertsons', 'futurelife': 'futurelife',
    'colgate': 'colgate', 'sensodyne': 'sensodyne',
    'knorr': 'knorr', 'maggi': 'maggi', 'dettol': 'dettol',
    'handy andy': 'handyandy', 'handyandy': 'handyandy',
}
KNOWN_BRANDS = frozenset(BRAND_ALIASES.values())
RETAILER_BRANDS = frozenset({'shoprite', 'checkers', 'woolworths', 'picknpay'})
PRODUCT_LINE_BRANDS = frozenset({'kitkat', 'barone'})
BRAND_IMPLIED_CATEGORY = {'cocacola': 'softdrink', 'fanta': 'softdrink',
                          'sprite': 'softdrink'}

# Descriptors safe to remove without changing the product's identity.
MARKETING_WORDS = frozenset({
    'the', 'and', 'of', 'with', 'new', 'offer', 'special', 'specials',
    'deal', 'sale',
    'product', 'online', 'buy', 'save', 'great', 'taste', 'each',
})

UNIT_PATTERN = r'(?:kilograms?|kgs?|grams?|g|milligrams?|mgs?|millilit(?:er|re)s?|ml|lit(?:er|re)s?|ltrs?|lts?|l|cl)'
QUANTITY_RE = re.compile(
    rf'(?<!\w)(\d+(?:\.\d+)?)\s*({UNIT_PATTERN})(?!\w)', re.IGNORECASE
)
MULTIPACK_FORWARD_RE = re.compile(
    rf'(?<!\w)(\d{{1,3}})\s*(?:x|×|packs?\s+of|pk\s+of)\s*'
    rf'(\d+(?:\.\d+)?)\s*({UNIT_PATTERN})(?!\w)', re.IGNORECASE
)
MULTIPACK_REVERSE_RE = re.compile(
    rf'(?<!\w)(\d+(?:\.\d+)?)\s*({UNIT_PATTERN})\s*'
    rf'(?:x|×)\s*(\d{{1,3}})(?!\w)', re.IGNORECASE
)
MULTIPACK_PACK_RE = re.compile(
    rf'(?<!\w)(\d{{1,3}})\s*(?:-\s*)?(?:packs?|pk|packets?)\s*(?:of\s+)?'
    rf'(\d+(?:\.\d+)?)\s*({UNIT_PATTERN})(?!\w)', re.IGNORECASE
)
COUNT_POST_RE = re.compile(r'\b(?:eggs?|rolls?|packs?|pieces?|cans?|bottles?)\s*(\d{1,3})(?!\w)', re.IGNORECASE)
COUNT_EGGS_RE = re.compile(r'(?<!\w)(\d{1,3})\s*(?:extra\s+large|large|medium|small)?\s*eggs?(?!\w)', re.IGNORECASE)
COUNT_RE = re.compile(
    r"(?<!\w)(\d{1,3})\s*(?:-\s*)?(?:pack|pk|packets?|pcs?|pieces?|count|ct|units?|rolls?|eggs?|sachets?|cans?|tins?|bottles?|jars?|cartons?|tubs?|pouches?|bags?|s['’]?|x)(?!\w)",
    re.IGNORECASE,
)

UNIT_CONVERSIONS = {
    'kg': ('mass', Decimal('1000')), 'kgs': ('mass', Decimal('1000')),
    'kilogram': ('mass', Decimal('1000')), 'kilograms': ('mass', Decimal('1000')),
    'g': ('mass', Decimal('1')), 'gram': ('mass', Decimal('1')),
    'grams': ('mass', Decimal('1')),
    'mg': ('mass', Decimal('0.001')), 'mgs': ('mass', Decimal('0.001')),
    'milligram': ('mass', Decimal('0.001')), 'milligrams': ('mass', Decimal('0.001')),
    'l': ('volume', Decimal('1000')), 'lt': ('volume', Decimal('1000')),
    'lts': ('volume', Decimal('1000')), 'ltr': ('volume', Decimal('1000')),
    'ltrs': ('volume', Decimal('1000')), 'liter': ('volume', Decimal('1000')),
    'liters': ('volume', Decimal('1000')), 'litre': ('volume', Decimal('1000')),
    'litres': ('volume', Decimal('1000')),
    'ml': ('volume', Decimal('1')),
    'milliliter': ('volume', Decimal('1')), 'milliliters': ('volume', Decimal('1')),
    'millilitre': ('volume', Decimal('1')), 'millilitres': ('volume', Decimal('1')),
    'cl': ('volume', Decimal('10')),
}

VARIANT_PATTERNS = {
    'fat': {
        'full': r'\b(?:full\s*cream|whole\s*milk)\b',
        'low': r'\b(?:low\s*fat|reduced\s*fat|semi\s*skimmed|2\s*%\s*fat)\b',
        'skim': r'\b(?:fat\s*free|skimmed|skim\s*milk|0\s*%\s*fat)\b',
    },
    'sugar': {
        'zero': r'\b(?:zero\s*(?:sugar)?|sugar\s*free|no\s*sugar)\b',
        'diet': r'\bdiet\b',
        'no_added': r'\bno\s*added\s*sugar\b',
        'regular': r'\b(?:regular|original)\b',
    },
    'milk_processing': {
        'uht': r'\b(?:uht|long\s*life|longlife)\b',
        'fresh': r'\bfresh\b',
        'powder': r'\bpowder(?:ed)?\b',
        'condensed': r'\bcondensed\b',
        'evaporated': r'\bevaporated\b',
    },
    'rice_variety': {
        'basmati': r'\bbasmati\b', 'jasmine': r'\bjasmine\b',
        'long': r'\blong\s*grain\b', 'short': r'\bshort\s*grain\b',
    },
    'rice_colour': {
        'brown': r'\bbrown\b', 'white': r'\bwhite\b',
    },
    'bread': {
        'white': r'\bwhite\b', 'brown': r'\bbrown\b',
        'wholewheat': r'\b(?:whole\s*wheat|wholewheat|wholemeal)\b',
        'seeded': r'\bseeded\b', 'rye': r'\brye\b',
        'sourdough': r'\bsourdough\b',
    },
    'flavour': {
        'chocolate': r'\b(?:choc|chocolate)\b',
        'vanilla': r'\bvanilla\b', 'strawberry': r'\bstrawberry\b',
        'banana': r'\bbanana\b', 'caramel': r'\bcaramel\b',
        'orange': r'\borange\b', 'apple': r'\bapple\b',
        'mango': r'\bmango\b', 'lemon': r'\blemon\b',
        'peach': r'\bpeach\b', 'pineapple': r'\bpineapple\b',
        'raspberry': r'\braspberry\b', 'berry': r'\b(?:berry|mixed\s*berries)\b',
        'grape': r'\bgrape\b', 'lime': r'\blime\b',
        'cherry': r'\bcherry\b', 'ginger': r'\bginger\b',
    },
    # Roll-on, spray and stick are NOT interchangeable, even at the same ml.
    'application': {
        'roll_on': r'\broll\s*on\b',
        'spray': r'\b(?:spray|aerosol)\b',
        'stick': r'\bstick\b',
        'gel': r'\bgel\b',
    },
    'salt': {'salted': r'\bsalted\b', 'unsalted': r'\bunsalted\b'},
    'meat_cut': {
        'breast': r'\bbreast\b', 'thigh': r'\bthigh\b',
        'wing': r'\bwings?\b', 'drumstick': r'\bdrumsticks?\b',
    },
    'texture': {
        'smooth': r'\bsmooth\b', 'crunchy': r'\bcrunchy\b',
    },
    'egg_grade': {
        'jumbo': r'\bjumbo\b', 'large': r'\blarge\b',
        'medium': r'\bmedium\b', 'small': r'\bsmall\b',
    },
}

PACKAGING_ALIASES = {
    'can': 'can', 'cans': 'can', 'tin': 'can', 'tins': 'can',
    'bottle': 'bottle', 'bottles': 'bottle', 'pet': 'bottle',
    'pouch': 'pouch', 'pouches': 'pouch',
    'carton': 'carton', 'cartons': 'carton',
    'tub': 'tub', 'tubs': 'tub', 'jar': 'jar', 'jars': 'jar',
    'sachet': 'sachet', 'sachets': 'sachet',
}

PRODUCT_CATEGORIES = {
    'milk': {'milk'}, 'bread': {'bread', 'loaf'},
    'rice': {'rice'}, 'sugar': {'sugar'}, 'flour': {'flour'},
    'oil': {'oil'}, 'pasta': {'pasta', 'spaghetti', 'macaroni'},
    'juice': {'juice'}, 'softdrink': {'cola', 'soda', 'softdrink', 'cooldrink'},
    'water': {'water'}, 'eggs': {'egg', 'eggs'},
    'cheese': {'cheese'}, 'butter': {'butter'},
    'chocolate': {'chocolate'}, 'coffee': {'coffee'},
    'tea': {'tea'}, 'cereal': {'cereal'},
    'yoghurt': {'yoghurt'}, 'biscuits': {'biscuit'},
    'chips': {'chips', 'crisps'}, 'soap': {'soap'},
    'shampoo': {'shampoo'},
    'deodorant': {'deodorant', 'antiperspirant'},
}


def _normalize_title(title: str) -> str:
    """Canonical spellings without discarding the original brand or variant."""
    title = ''.join(character for character in unicodedata.normalize('NFKD', str(title or ''))
                    if not unicodedata.combining(character)).casefold()
    title = title.replace('×', 'x').replace('’', "'")
    title = re.sub(r'(?<=\d),(?=\d)', '.', title)  # 1,5 L -> 1.5 L
    title = title.replace('&', ' and ')
    title = re.sub(r'(?<=\w)[\-](?=\w)', ' ', title)
    title = re.sub(r'[^a-z0-9.%\s\']', ' ', title)
    title = re.sub(r'\b(?:yogurt|yoghurts)\b', 'yoghurt', title)
    title = re.sub(r'\b(?:biscuits)\b', 'biscuit', title)
    title = re.sub(r'\b(?:soft\s+drinks?|cool\s+drinks?)\b', 'softdrink', title)
    title = re.sub(r'\bfullcream\b', 'full cream', title)
    title = re.sub(r'\banti\s*perspirant\b', 'antiperspirant', title)
    title = re.sub(r'\brollon\b', 'roll on', title)
    title = re.sub(r'\bwholewheat\b', 'whole wheat', title)
    title = re.sub(r'\b(?:longlife|long\-life)\b', 'long life', title)
    title = re.sub(r'\s+', ' ', title).strip()
    for alias in sorted(BRAND_ALIASES, key=len, reverse=True):
        title = re.sub(r'\b' + re.escape(alias) + r'\b', BRAND_ALIASES[alias], title)
    return title


def _unit_size(amount: str, unit: str, count: int = 1):
    dimension, factor = UNIT_CONVERSIONS[unit.lower()]
    return (dimension, Decimal(amount) * factor, int(count))


def _extract_pack_size(text: str):
    """Return (dimension, per-item amount in g/ml, pack count), or None.

    A 2 x 500 ml pack is intentionally NOT equivalent to one 1 L bottle.
    Ambiguous titles containing multiple inconsistent sizes are not compared.
    """
    for pattern, reverse in (
        (MULTIPACK_FORWARD_RE, False), (MULTIPACK_REVERSE_RE, True),
        (MULTIPACK_PACK_RE, False),
    ):
        match = pattern.search(text)
        if match:
            if reverse:
                amount, unit, count = match.groups()
            else:
                count, amount, unit = match.groups()
            result = _unit_size(amount, unit, count)
            remaining = text[:match.start()] + ' ' + text[match.end():]
            # Avoid treating bundles with an additional size as a single SKU.
            if QUANTITY_RE.search(remaining):
                return None, text
            return result, remaining

    sizes = list(QUANTITY_RE.finditer(text))
    if len(sizes) > 1:
        return None, text
    if sizes:
        match = sizes[0]
        pack_size = _unit_size(match.group(1), match.group(2))
        remainder = text[:match.start()] + ' ' + text[match.end():]
        count_match = COUNT_RE.search(remainder)
        if count_match:
            pack_size = (pack_size[0], pack_size[1], int(count_match.group(1)))
            remainder = remainder[:count_match.start()] + ' ' + remainder[count_match.end():]
        return pack_size, remainder

    for pattern in (COUNT_RE, COUNT_POST_RE, COUNT_EGGS_RE):
        count_match = pattern.search(text)
        if count_match:
            count = int(count_match.group(1))
            remainder = text[:count_match.start()] + ' ' + text[count_match.end():]
            return ('count', Decimal(1), count), remainder
    return None, text


def _category(tokens):
    token_set = set(tokens)
    # Prefer the actual product type, not the flavour word "chocolate".
    for preferred in ('yoghurt', 'cereal', 'biscuits', 'juice', 'coffee', 'tea'):
        if token_set.intersection(PRODUCT_CATEGORIES.get(preferred, set())):
            return preferred
    if ('chocolate' in token_set or 'choc' in token_set or
        ('cadbury' in token_set and {'dairy', 'milk'} <= token_set) or
        token_set.intersection({'kitkat', 'barone'})):
        return 'chocolate'
    for category, words in PRODUCT_CATEGORIES.items():
        if token_set.intersection(words):
            return category
    if {'roll', 'on'} <= token_set and token_set.intersection(
            {'rexona', 'dove', 'nivea', 'mitchum', 'sure', 'shield', 'adidas'}):
        return 'deodorant'
    return ''


def _get_variants(text: str, category: str):
    variants = {}
    for group, values in VARIANT_PATTERNS.items():
        if group in {'fat', 'milk_processing'} and category != 'milk':
            continue
        if group in {'rice_variety', 'rice_colour'} and category != 'rice':
            continue
        if group == 'bread' and category != 'bread':
            continue
        if group == 'application' and category != 'deodorant':
            continue
        if group == 'egg_grade' and category != 'eggs':
            continue
        if group == 'meat_cut' and not any(w in text.split() for w in ('chicken', 'beef', 'turkey')):
            continue
        matched = [value for value, pattern in values.items() if re.search(pattern, text)]
        if len(matched) == 1:
            variants[group] = matched[0]
        elif len(matched) > 1:
            variants[group] = 'ambiguous'
    return variants


@lru_cache(maxsize=8192)
def extract_features(title: str):
    """Cache immutable title features across batch comparisons."""
    normalized = _normalize_title(title)
    size, without_size = _extract_pack_size(normalized)
    without_size = re.sub(r"\b(?:pack|packet|pk|of|s)\b", ' ', without_size)
    words = tuple(w for w in re.findall(r'[a-z0-9]+', without_size)
                  if w not in MARKETING_WORDS and len(w) > 1)
    brands_present = [w for w in words if w in KNOWN_BRANDS]
    brand = next((w for w in brands_present if w in PRODUCT_LINE_BRANDS), '')
    if not brand:
        brand = next((w for w in brands_present if w not in RETAILER_BRANDS), '')
    if not brand and brands_present:
        brand = brands_present[0]
    category = _category(re.findall(r'[a-z0-9]+', normalized)) or BRAND_IMPLIED_CATEGORY.get(brand, '')
    variants = _get_variants(normalized, category)
    packaging = frozenset(PACKAGING_ALIASES[w] for w in re.findall(r'[a-z]+', normalized)
                          if w in PACKAGING_ALIASES)
    identity_words = []
    for word in words:
        if word in KNOWN_BRANDS or word in PACKAGING_ALIASES:
            continue
        if word in PRODUCT_CATEGORIES.get(category, set()):
            continue
        if any(re.fullmatch(pattern, word) for group in VARIANT_PATTERNS.values() for pattern in group.values()):
            continue
        if word in {'cream', 'fat', 'long', 'life', 'full', 'low', 'original',
                    'regular', 'sugar', 'zero', 'fresh', 'whole', 'white',
                    'brown', 'grain', 'softdrink', 'no', 'added', 'skimmed',
                    'sliced', 'choc', 'chocolate', 'flavoured'}:
            continue
        identity_words.append(word)
    return {
        'normalized': normalized,
        'size': size,
        'brand': brand,
        'category': category,
        'variants': variants,
        'packaging': packaging,
        'tokens': frozenset(words),
        'identity_tokens': frozenset(identity_words),
        'clean_text': ' '.join(sorted(set(words))),
    }


PRICE_FAMILY_VARIANTS = frozenset({
    'fat', 'milk_processing', 'rice_variety', 'rice_colour', 'bread',
    'salt', 'meat_cut', 'texture', 'egg_grade', 'sugar', 'application',
})


def price_family_key(product):
    """Category + *per-item size* + pack count + type; NOT brand or flavour.

    2L == 2000ml. A 2x500ml pack != a 1L bottle. Unknown-sized products
    never get an unsupported cheapest-by-size label.
    """
    name = product if isinstance(product, str) else (product or {}).get('name', '')
    f = extract_features(name)
    if not f['category'] or not f['size']:
        return None
    dims, amount, count = f['size']
    # Preserve material dietary/form differences. "regular" and absent sugar
    # are equivalent when neither contains an explicit dietary restriction.
    variants = tuple(sorted((key, val) for key, val in f['variants'].items()
                            if key in PRICE_FAMILY_VARIANTS and val not in ('regular', 'ambiguous')))
    return (f['category'], dims, format(amount.normalize(), 'f'), count, tuple(sorted(f['packaging'])), variants)


def format_price_group(key):
    if not key:
        return ''
    category, dimension, per_item, count, _, _ = key
    suffix = {'mass': 'g', 'volume': 'ml', 'count': 'item'}[dimension]
    qty = f'{per_item}{suffix}' if dimension != 'count' else f'{count} items'
    if dimension != 'count' and count > 1:
        qty = f'{count} × {qty}'
    return f'{category.replace("softdrink", "soft drink").title()} · {qty}'


def annotate_family_best_prices(products):
    """One deterministic minimum per category/size, even across flavours.

    Annotate a copy of every product. Never tag a zero/invalid price or a
    product whose category/size isn't known. A tie chooses one stable winner.
    """
    values = [dict(p) for p in products]
    winners = {}
    for idx, item in enumerate(values):
        group = price_family_key(item)
        item['bestPriceGroup'] = format_price_group(group)
        item['isBestPrice'] = False
        item['bestPriceScope'] = 'family_size' if group else None
        try:
            price = float(item.get('price'))
        except (ValueError, TypeError, OverflowError):
            continue
        if not group or not math.isfinite(price) or price <= 0:
            continue
        ranking = (price, str(item.get('id', '')), str(item.get('store', '')).casefold())
        if group not in winners or ranking < winners[group][0]:
            winners[group] = (ranking, idx)
    for _, idx in winners.values():
        values[idx]['isBestPrice'] = True
    return values


def annotate_exact_best_prices(products):
    """An exact-match comparison can have only one badge (even on ties)."""
    values = [dict(p, isBestPrice=False, bestPriceScope='exact_product') for p in products]
    if values:
        viable = [(float(p.get('price') or 0), str(p.get('store', '')).casefold(),
                   str(p.get('id', '')), idx) for idx, p in enumerate(values)
                  if isinstance(p.get('price'), (float, int)) and math.isfinite(float(p.get('price'))) and float(p.get('price')) > 0]
        if viable:
            winner = min(viable)
            values[winner[3]]['isBestPrice'] = True
    return values


def annotate_mixed_best_prices(products):
    """Choose ONE lowest exact SKU first; use an equivalent only if none match.

    An equivalent may be cheaper but must never receive the 'same product'
    winning badge when a verified exact listing exists. All candidates must
    have valid positive prices. Tie-breaking is deterministic.
    """
    values = [dict(p, isBestPrice=False, bestPriceScope=None) for p in products]
    eligible = []
    for index, item in enumerate(values):
        try:
            price = float(item.get('price', 0))
        except (ValueError, TypeError, OverflowError):
            continue
        if not math.isfinite(price) or price <= 0:
            continue
        is_equivalent = item.get('matchType') == 'equivalent'
        eligible.append((int(is_equivalent), price,
                         str(item.get('store', '')).casefold(),
                         str(item.get('id', '')), index))
    if eligible:
        equivalent, _, _, _, winner_index = min(eligible)
        values[winner_index]['isBestPrice'] = True
        values[winner_index]['bestPriceScope'] = ('store_equivalent' if equivalent else 'exact_product')
    return values


def normalize_units(text: str) -> str:
    """Backwards-compatible helper: canonical size with normalized units."""
    info = extract_features(text)
    size = info['size']
    if size is None:
        return _normalize_title(text)
    dimension, amount, count = size
    unit = {'volume': 'ml', 'mass': 'g', 'count': 'each'}[dimension]
    return f'{count}x{format(amount, "f")}{unit}'


def calculate_match_score(target_title: str, candidate_title: str):
    """Return (score, eligible_for_price_comparison).

    Never let fuzzy matching override a different brand, pack or variant.
    """
    a = extract_features(target_title)
    b = extract_features(candidate_title)
    if not a['size'] or not b['size'] or a['size'] != b['size']:
        return 0.0, False
    if a['brand'] != b['brand'] and (a['brand'] or b['brand']):
        return 0.0, False
    if a['category'] and b['category'] and a['category'] != b['category']:
        return 0.0, False
    if a['packaging'] and b['packaging'] and a['packaging'] != b['packaging']:
        return 0.0, False
    if 'ambiguous' in a['variants'].values() or 'ambiguous' in b['variants'].values():
        return 0.0, False
    for variant_type in set(a['variants']) | set(b['variants']):
        left = a['variants'].get(variant_type)
        right = b['variants'].get(variant_type)
        if left != right:
            # A missing "original"/"regular" tag is often an abbreviated label.
            # All other missing/contradictory variants must be rejected.
            if variant_type == 'sugar' and {left, right} <= {None, 'regular'}:
                continue
            return 0.0, False

    if (not a['brand'] and not a['identity_tokens']) or (not b['brand'] and not b['identity_tokens']):
        return 0.0, False  # Generic labels alone cannot prove identical SKUs.
    if (not a['category'] and not a['identity_tokens']) or (not b['category'] and not b['identity_tokens']):
        return 0.0, False  # Brand + quantity alone might describe many products.

    if a['identity_tokens'] and b['identity_tokens']:
        intersection = len(a['identity_tokens'] & b['identity_tokens'])
        identity_coverage = min(
            intersection / len(a['identity_tokens']),
            intersection / len(b['identity_tokens']),
        )
        if identity_coverage < 0.75:
            return 0.0, False
    elif a['identity_tokens'] != b['identity_tokens']:
        return 0.0, False

    token_sort = fuzz.token_sort_ratio(a['clean_text'], b['clean_text'])
    token_set = fuzz.token_set_ratio(a['clean_text'], b['clean_text'])
    intersection = len(a['tokens'] & b['tokens'])
    cover = 100 * intersection / max(1, min(len(a['tokens']), len(b['tokens'])))
    score = round(0.35 * token_sort + 0.45 * token_set + 0.20 * cover, 1)
    return score, score >= 82.0


def optimize_search_query(query: str) -> str:
    """Search retailers with natural product words, not internal canonical tokens."""
    query = ''.join(character for character in unicodedata.normalize('NFKD', str(query or ''))
                    if not unicodedata.combining(character)).casefold()
    query = query.replace('×', 'x').replace('&', ' and ')
    query = re.sub(r'(?<=\d),(?=\d)', '.', query)
    query = re.sub(r'[^a-z0-9.\s-]', ' ', query)
    query = query.replace('-', ' ')
    tokens = [word for word in query.split() if word not in MARKETING_WORDS]
    return ' '.join(tokens)[:100]


def comparison_search_queries(title: str) -> list:
    """A precise original-name search and a short indexed phrase per retailer."""
    features = extract_features(title)
    precise = optimize_search_query(title)
    candidates = [precise]
    size = features['size']
    size_hint = ''
    if size:
        dimension, amount, count = size
        if dimension != 'count':
            unit = 'ml' if dimension == 'volume' else 'g'
            amount_for_query = amount
            if amount >= 1000 and amount % 1000 == 0:
                amount_for_query = amount / 1000
                unit = 'l' if dimension == 'volume' else 'kg'
            size_hint = f'{format(amount_for_query, "f")}{unit}'
            if count > 1:
                size_hint = f'{count}x{size_hint}'
        else:
            size_hint = f'{count} pack'

    brand_names = {
        'cocacola': 'coca cola', 'picknpay': 'pick n pay',
        'barone': 'bar one', 'allgold': 'all gold',
        'simplytruth': 'simply truth', 'fiveroses': 'five roses',
        'faircape': 'fair cape', 'luckystar': 'lucky star',
        'handyandy': 'handy andy',
    }
    brand = brand_names.get(features['brand'], features['brand'])
    category = features['category']
    category_search_term = 'soft drink' if category == 'softdrink' else category
    variant_words = []
    if features['variants'].get('sugar') not in {None, 'regular'}:
        variant_words.append(features['variants']['sugar'])
    if features['variants'].get('fat'):
        variant_words.append(features['variants']['fat'])
    if features['variants'].get('flavour'):
        variant_words.append(features['variants']['flavour'])

    important_words = [w for w in (brand, category_search_term, *variant_words, size_hint) if w]
    if brand:
        relaxed = ' '.join(important_words)
    else:
        name_words = precise.split()
        relaxed = ' '.join(name_words[:3] + ([size_hint] if size_hint else []))
    candidates.append(relaxed)

    distinct = []
    for candidate in candidates:
        candidate = candidate.strip()
        if candidate and candidate not in distinct:
            distinct.append(candidate)
    return distinct[:2]


def validate_gtin(value) -> str:
    """Validate UPC/EAN/GTIN checksum; return a consistent 14-digit form."""
    raw = str(value or '').strip()
    if not raw.isdigit() or len(raw) not in (8, 12, 13, 14) or len(set(raw)) == 1:
        return ''
    numbers = [int(char) for char in raw]
    checksum_total = sum(digit * (3 if i % 2 == 0 else 1)
                         for i, digit in enumerate(reversed(numbers[:-1])))
    check_digit = (-checksum_total) % 10
    return raw.zfill(14) if check_digit == numbers[-1] else ''


def extract_item_gtin(raw_item: dict) -> str:
    """Use explicit barcode fields only; retailer SKU/code is NOT a GTIN."""
    if not isinstance(raw_item, dict):
        return ''
    for key in ('gtin', 'GTIN', 'ean', 'EAN', 'ean13', 'barcode',
                'barCode', 'productBarcode', 'upc'):
        valid = validate_gtin(raw_item.get(key))
        if valid:
            return valid
    return ''


def filter_and_score_competitors(original_name: str, scraped_results: list, target_barcode: str = "") -> list:
    """Cheapest *eligible* match per retailer, never an unrelated fallback.

    Score is used only for product verification; price decides among matches.
    """
    target_size = extract_features(original_name)['size']
    target_gtin = validate_gtin(target_barcode)
    if not target_size and not target_gtin:
        return []  # Unknown product size/ID: do not manufacture a cheapest claim.
    best_by_store = {}
    for item in scraped_results:
        if not isinstance(item, dict):
            continue
        store, name = item.get('store'), item.get('name')
        if not store or not name:
            continue
        try:
            price = float(item.get('price', 0))
        except (TypeError, ValueError, OverflowError):
            continue
        if not math.isfinite(price) or price <= 0:
            continue
        item_gtin = validate_gtin(item.get('barcode'))
        if target_gtin and item_gtin:
            # UPC/EAN match is a stronger identity signal than retailer wording.
            if target_gtin != item_gtin:
                continue
            candidate_size = extract_features(name)['size']
            if target_size and candidate_size and target_size != candidate_size:
                continue
            score, matches, match_method = 100.0, True, 'barcode'
        else:
            score, matches = calculate_match_score(original_name, name)
            match_method = 'title_and_pack'
        if not matches:
            continue
        candidate = dict(item)  # Do not mutate cached scraper objects.
        candidate['score'] = score
        candidate['is_exact_match'] = True
        candidate['isExact'] = True
        candidate['matchMethod'] = match_method
        candidate['price'] = price
        current = best_by_store.get(store)
        if current is None or (price, -score) < (current['price'], -current['score']):
            best_by_store[store] = candidate
    return sorted(best_by_store.values(), key=lambda item: (item['price'], -item['score'], item['store']))


COMPARE_TTL_SECONDS = 300  # prices may change; we NEVER call cached values live-verified.
_compare_cache = {}
_compare_cache_lock = threading.RLock()
_compare_metrics = {'requests': 0, 'hits': 0, 'completed': 0, 'total_ms': 0.0}


def clear_comparison_cache():
    with _compare_cache_lock:
        _compare_cache.clear()


def compare_cache_stats():
    with _compare_cache_lock:
        count = _compare_metrics['completed']
        return {
            'requests': _compare_metrics['requests'], 'cacheHits': _compare_metrics['hits'],
            'averageMs': round(_compare_metrics['total_ms'] / count, 0) if count else None,
            'cachedComparisons': len(_compare_cache), 'cacheSeconds': COMPARE_TTL_SECONDS,
        }


async def fetch_verified_competitors(original_name: str, target_barcode: str = "") -> list:
    """Fetch four stores concurrently; retry *only* stores lacking verified matches.

    This reduces remote requests for products with an easy first-pass match.
    Results are cached briefly to speed Back / repeated comparison visits.
    """
    if not extract_features(original_name)['size'] and not validate_gtin(target_barcode):
        return []
    search_queries = comparison_search_queries(original_name)
    if not search_queries:
        return []
    cache_key = (original_name.strip().casefold(), validate_gtin(target_barcode))
    now = time.monotonic()
    with _compare_cache_lock:
        _compare_metrics['requests'] += 1
        old = _compare_cache.get(cache_key)
        if old and now - old[0] < COMPARE_TTL_SECONDS:
            _compare_metrics['hits'] += 1
            return [dict(p) for p in old[1]]
    started = time.perf_counter()
    scrapers = (('Pick n Pay', scrape_pnp), ('Shoprite', scrape_shoprite),
                ('Checkers', scrape_checkers), ('Woolworths', scrape_woolworths))
    gathered = []
    seen = set()

    async def run_phase(query, eligible):
        async def attempt(scraper):
            try:
                return await asyncio.wait_for(scraper(query, page_size=20), timeout=8.0)
            except (asyncio.TimeoutError, Exception):
                return []
        batches = await asyncio.gather(*(attempt(scraper) for _, scraper in eligible))
        for results in batches:
            for product in results or []:
                product_id = product.get('id')
                if product_id and product_id not in seen:
                    seen.add(product_id)
                    gathered.append(product)

    await run_phase(search_queries[0], scrapers)
    matches = filter_and_score_competitors(original_name, gathered, target_barcode)
    if len(search_queries) > 1:
        matched_stores = {offer['store'] for offer in matches}
        retry_stores = [(name, scraper) for name, scraper in scrapers if name not in matched_stores]
        if retry_stores:
            await run_phase(search_queries[1], retry_stores)
            matches = filter_and_score_competitors(original_name, gathered, target_barcode)
    with _compare_cache_lock:
        _compare_cache[cache_key] = (time.monotonic(), [dict(p) for p in matches])
        if len(_compare_cache) > 512:
            for k, (saved, _) in list(_compare_cache.items()):
                if time.monotonic() - saved > COMPARE_TTL_SECONDS:
                    _compare_cache.pop(k, None)
            if len(_compare_cache) > 512:
                _compare_cache.pop(next(iter(_compare_cache)))
        _compare_metrics['completed'] += 1
        _compare_metrics['total_ms'] += (time.perf_counter() - started) * 1000
    return matches


FAMILY_COMPARE_TTL_SECONDS = 300
_family_compare_cache = {}
_family_compare_lock = threading.RLock()


async def fetch_family_size_competitors(original_name):
    """Compare the cheapest AVAILABLE offer per shop for a category + pack size.

    Flavours/brands are deliberately allowed to vary, but packaging, count,
    ingredient/dietary subtype and the measured per-item quantity must match.
    This is not an exact-SKU comparator: /api/batch-compare remains exact.
    """
    group = price_family_key(original_name)
    if group is None:
        return []
    now = time.monotonic()
    with _family_compare_lock:
        hit = _family_compare_cache.get(group)
        if hit and now - hit[0] < FAMILY_COMPARE_TTL_SECONDS:
            return [dict(p) for p in hit[1]]
    features = extract_features(original_name)
    _, amount, count = features['size']
    unit = 'g' if features['size'][0] == 'mass' else ('ml' if features['size'][0] == 'volume' else '')
    # Retailer search engines usually index 2L / 1kg rather than 2000ml / 1000g.
    if unit and amount >= 1000 and amount % 1000 == 0:
        amount = amount / 1000
        unit = 'l' if unit == 'ml' else 'kg'
    size_text = f'{format(amount, "f")}{unit}' if unit else f'{count} pack'
    if count > 1 and unit:
        size_text = f'{count}x{size_text}'
    category_term = 'soft drink' if features['category'] == 'softdrink' else features['category']
    broad_query = f'{category_term} {size_text}'.strip()
    scrapers = (('Pick n Pay', scrape_pnp), ('Shoprite', scrape_shoprite),
                ('Checkers', scrape_checkers), ('Woolworths', scrape_woolworths))

    async def fetch(scraper, q):
        try:
            return await asyncio.wait_for(scraper(q, page_size=32), timeout=8.0)
        except Exception:
            return []

    batches = await asyncio.gather(*(fetch(scraper, broad_query) for _, scraper in scrapers))
    pool = [p for batch in batches for p in batch or [] if isinstance(p, dict)]
    # Broaden search once only for stores without an eligible family offer.
    found_stores = {p.get('store') for p in pool if price_family_key(p) == group}
    missing = [(name, scraper) for name, scraper in scrapers if name not in found_stores]
    if missing:
        more = await asyncio.gather(*(fetch(scraper, category_term) for _, scraper in missing))
        pool.extend(p for batch in more for p in batch or [] if isinstance(p, dict))

    by_store = {}
    for p in pool:
        if price_family_key(p) != group:
            continue
        try:
            price = float(p.get('price', 0))
        except (TypeError, ValueError, OverflowError):
            continue
        if not math.isfinite(price) or price <= 0 or not p.get('store') or not p.get('id'):
            continue
        candidate = dict(p, price=price, matchMethod='same_category_and_pack',
                         isExact=False, is_exact_match=False)
        previous = by_store.get(p['store'])
        if previous is None or (price, str(p.get('id'))) < (previous['price'], str(previous.get('id'))):
            by_store[p['store']] = candidate
    output = annotate_family_best_prices(list(by_store.values()))
    output.sort(key=lambda p: (p['price'], str(p['store']).casefold(), str(p['id'])))
    with _family_compare_lock:
        _family_compare_cache[group] = (time.monotonic(), [dict(p) for p in output])
        if len(_family_compare_cache) > 256:
            _family_compare_cache.pop(next(iter(_family_compare_cache)))
    return output


# Product links must come directly from the retailer's data, never a guessed
# slug based on a name or on the SKU. Some searches don't supply a detail URL.
RETAILER_LINK_HOSTS = {
    'pnp': ('pnp.co.za',),
    'shoprite': ('shoprite.co.za',),
    'checkers': ('checkers.co.za',),
    'woolworths': ('woolworths.co.za',),
}


def extract_product_url(item: dict, store_key: str) -> str:
    if not isinstance(item, dict):
        return ''
    allowed_hosts = RETAILER_LINK_HOSTS.get(store_key, ())
    for key in ('productUrl', 'product_url', 'pdpUrl', 'productLink',
                'webUrl', 'detailUrl', 'url'):
        raw = item.get(key)
        if not isinstance(raw, str) or not raw.strip():
            continue
        raw = raw.strip()
        if raw.startswith('/') and not raw.startswith('//'):
            raw = urljoin('https://www.' + allowed_hosts[0], raw)
        parsed = urlparse(raw)
        host = (parsed.hostname or '').lower()
        if (parsed.scheme == 'https' and not parsed.username and
                not parsed.password and
                any(host == domain or host.endswith('.' + domain)
                    for domain in allowed_hosts) and
                any(segment in parsed.path.lower()
                    for segment in ('/p/', '/product/', '/products/', '/prod/', '/pdp/'))):
            return raw
    return ''


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
    if is_fresh: return [p for raw in cached_data if (p := catalog_product(raw)) is not None]
    headers = get_dynamic_headers('pnp', referer=f'https://www.pnp.co.za/search/{query}')
    url = f'https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search?fields=products(code%2Cname%2Cprice(FULL)%2Cimages(DEFAULT)%2Curl)&query={query}&pageSize={page_size}&storeCode=WC21&lang=en&curr=ZAR'

    async with get_http_semaphore():
        for attempt in range(2):
            try:
                res = await get_http_client().post(url, headers=headers, json={}, timeout=5.0)
                if res.status_code == 200:
                    products = res.json().get('products', [])
                    extracted = []
                    for item in products:
                        name = item.get('name', '')
                        if product_is_clothing(item):
                            continue
                        extracted.append({
                            'id': f"pnp_{item.get('code')}",
                            'barcode': extract_item_gtin(item),
                            'productUrl': extract_product_url(item, 'pnp'),
                            'ageRestricted': product_is_adult(item),
                            'catalogCategory': classify_product(item)[0],
                            'sourceCategories': retailer_categories(item),
                            'name': name,
                            'store': 'Pick n Pay',
                            'price': float(item.get('price', {}).get('value', 0.0)),
                            'formattedPrice': item.get('price', {}).get('formattedValue', 'R0.00'),
                            'imageUrl': get_pnp_high_res_image(item.get('images', [])),
                        })
                    save_to_cache('pnp', query, extracted)
                    return extracted
                elif res.status_code in [403, 429]:
                    headers = get_dynamic_headers('pnp', referer=f'https://www.pnp.co.za/search/{query}')
                    await asyncio.sleep(1)
            except Exception:
                pass
    return [p for raw in (cached_data or []) if (p := catalog_product(raw)) is not None]

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
    if is_fresh: return [p for raw in cached_data if (p := catalog_product(raw)) is not None]
    headers = get_dynamic_headers('shoprite', referer='https://www.shoprite.co.za/')
    json_data = {'storeContexts': [], 'filterData': {'filter': {'showAllDisplayVariants': False, 'showNotRangedProducts': False, 'productListSource': {'search': query}, 'paginationOptions': {'page': 0, 'pageSize': page_size}, 'filterOptions': {'dealsOnly': False, 'serviceOptions': [], 'facetOptions': []}, 'sortOptions': None}, 'displayOptions': {}}, 'forYouBonusBuyIds': []}

    async with get_http_semaphore():
        try:
            res = await get_http_client().post('https://www.shoprite.co.za/api/catalogue/get-products-filter', headers=headers, json=json_data, timeout=6.0)
            if res.status_code == 200:
                products = res.json().get('products', []) or res.json().get('filterResult', {}).get('products', [])
                extracted = []
                for item in products:
                    name = item.get('name', item.get('title', ''))
                    if product_is_clothing(item):
                        continue
                    extracted.append({
                        'id': f"shoprite_{item.get('code', item.get('id', ''))}",
                        'barcode': extract_item_gtin(item),
                        'productUrl': extract_product_url(item, 'shoprite'),
                        'ageRestricted': product_is_adult(item),
                            'catalogCategory': classify_product(item)[0],
                            'sourceCategories': retailer_categories(item),
                        'name': name,
                        'store': 'Shoprite',
                        'price': float(item.get('price', {}).get('value', 0.0) if isinstance(item.get('price'), dict) else item.get('price', 0.0)),
                        'formattedPrice': f"R {float(item.get('price', {}).get('value', 0.0) if isinstance(item.get('price'), dict) else item.get('price', 0.0)):.2f}",
                        'imageUrl': extract_shoprite_image(item),
                    })
                save_to_cache('shoprite', query, extracted)
                return extracted
        except Exception:
            pass
    return [p for raw in (cached_data or []) if (p := catalog_product(raw)) is not None]

async def scrape_checkers(query: str, page_size: int = 16):
    cached_data, is_fresh = get_cached_data('checkers', query)
    if is_fresh: return [p for raw in cached_data if (p := catalog_product(raw)) is not None]
    headers = get_dynamic_headers('checkers', referer=f'https://www.checkers.co.za/search?Search={query}')
    json_data = {'storeContexts': [], 'filterData': {'filter': {'showAllDisplayVariants': False, 'showNotRangedProducts': False, 'productListSource': {'search': query}, 'paginationOptions': {'page': 0, 'pageSize': page_size}, 'filterOptions': {'filterIds': [], 'dealsOnly': False, 'brandOptions': [], 'departmentOptions': [], 'serviceOptions': [], 'facetOptions': []}, 'sortOptions': None}, 'displayOptions': {'includeDisplayCategoryTree': True}}, 'forYouBonusBuyIds': []}

    async with get_http_semaphore():
        try:
            res = await get_http_client().post('https://www.checkers.co.za/api/catalogue/get-products-filter', headers=headers, json=json_data, timeout=6.0)
            if res.status_code == 200:
                products = res.json().get('products', []) or res.json().get('filterResult', {}).get('products', [])
                extracted = []
                for item in products:
                    name = item.get('name', item.get('title', ''))
                    if product_is_clothing(item):
                        continue
                    extracted.append({
                        'id': f"checkers_{item.get('code', item.get('id', ''))}",
                        'barcode': extract_item_gtin(item),
                        'productUrl': extract_product_url(item, 'checkers'),
                        'ageRestricted': product_is_adult(item),
                            'catalogCategory': classify_product(item)[0],
                            'sourceCategories': retailer_categories(item),
                        'name': name,
                        'store': 'Checkers',
                        'price': float(item.get('price', {}).get('value', 0.0) if isinstance(item.get('price'), dict) else item.get('price', 0.0)),
                        'formattedPrice': f"R {float(item.get('price', {}).get('value', 0.0) if isinstance(item.get('price'), dict) else item.get('price', 0.0)):.2f}",
                        'imageUrl': extract_shoprite_image(item),
                    })
                save_to_cache('checkers', query, extracted)
                return extracted
        except Exception:
            pass
    return [p for raw in (cached_data or []) if (p := catalog_product(raw)) is not None]

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
    if is_fresh: return [p for raw in cached_data if (p := catalog_product(raw)) is not None]

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
                    if product_is_clothing(dict(item_data, name=name)) or product_is_clothing(item):
                        continue
                    price = extract_woolworths_price(item_data)
                    image_url = extract_woolworths_image(item_data)
                    extracted.append({
                        'id': f"woolworths_{item_data.get('product_id') or item_data.get('id', '')}",
                        'barcode': extract_item_gtin(item_data) or extract_item_gtin(item),
                        'productUrl': extract_product_url(item_data, 'woolworths') or extract_product_url(item, 'woolworths'),
                        'ageRestricted': product_is_adult(item_data) or product_is_adult(item),
                            'catalogCategory': classify_product(dict(item_data, name=name))[0],
                            'sourceCategories': retailer_categories(item_data) or retailer_categories(item),
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
    return [p for raw in (cached_data or []) if (p := catalog_product(raw)) is not None]


@app.route('/api/me', methods=['GET'])
def get_me():
    """Returns the authenticated user details for the frontend AuthContext."""
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"authenticated": False}), 401

    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"authenticated": False}), 401
    if not user.is_active:
        return jsonify({'authenticated': False, 'suspended': True,
                        'code': 'ACCOUNT_SUSPENDED',
                        'error': 'Your account has been suspended.'}), 403

    return jsonify({
        "authenticated": True,
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "is_admin": user.is_admin,
        "location": getattr(user, 'location', 'Ibhayi, Eastern Cape'),
        "latitude": user.latitude, "longitude": user.longitude,
        "radius_km": user.nearby_radius_km or 15,
        "created_at": user.created_at.strftime('%B %Y'),
        "age_group": user_age_group(user),
        "profile_complete": bool((user.date_of_birth or user.age_confirmation is not None) and user.postal_code),
    })

@app.route('/api/profile', methods=['GET', 'PATCH'])
@check_active_status
def api_profile():
    """Authenticated shopping profile and account details.

    Editing username/email requires the current password. Shopping preferences
    can be updated without re-entering a password.
    """
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Sign in to edit your profile'}), 401
    user = db.session.get(User, user_id)
    if user is None or not user.is_active:
        return jsonify({'error': 'Account unavailable'}), 403

    if request.method == 'PATCH':
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'Expected a JSON object'}), 400

        username = user.username
        email = user.email
        if 'username' in data:
            username = str(data['username'] or '').strip()
            if username != user.username and not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_. -]{2,79}', username):
                return jsonify({'error': 'Username must be 3-80 characters and start with a letter or number'}), 400
        if 'email' in data:
            email = str(data['email'] or '').strip().lower()
            if len(email) > 120 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
                return jsonify({'error': 'Enter a valid email address'}), 400

        changed_identity = (username != user.username or email.lower() != user.email.lower())
        if changed_identity:
            password = data.get('current_password')
            if not isinstance(password, str) or not check_password_hash(user.password_hash, password):
                return jsonify({'error': 'Current password is required to change your username or email'}), 403
            if (db.session.query(User.id).filter(
                db.func.lower(User.username) == username.lower(), User.id != user.id
            ).first()):
                return jsonify({'error': 'That username is already taken'}), 409
            if (db.session.query(User.id).filter(
                db.func.lower(User.email) == email.lower(), User.id != user.id
            ).first()):
                return jsonify({'error': 'That email is already registered'}), 409

        birthday = user.date_of_birth
        if 'date_of_birth' in data:
            raw = str(data['date_of_birth'] or '').strip()
            if raw:
                try:
                    birthday = date.fromisoformat(raw)
                    if birthday > date.today() or birthday.year < 1900:
                        raise ValueError()
                except ValueError:
                    return jsonify({'error': 'Enter a valid birth date (YYYY-MM-DD)'}), 400
            else:
                birthday = None

        age_confirmation = user.age_confirmation
        if 'age_confirmation' in data:
            if type(data['age_confirmation']) is not bool:
                return jsonify({'error': 'Choose whether you are 18 or older (Yes or No).'}), 400
            age_confirmation = data['age_confirmation']
        # Never let a self-declaration override a date of birth confirming under 18.
        if age_confirmation is True and birthday is not None and age_from_date(birthday) < 18:
            return jsonify({'error': 'Your saved birth date indicates under 18. Correct the date of birth first if it is inaccurate.'}), 400

        location = user.location or ''
        if 'location' in data:
            location = str(data['location'] or '').strip()
            if len(location) > 100:
                return jsonify({'error': 'City/town cannot exceed 100 characters'}), 400

        new_lat, new_lng = user.latitude, user.longitude
        new_radius = user.nearby_radius_km or 15
        if 'latitude' in data or 'longitude' in data or 'radius_km' in data:
            new_lat = data.get('latitude', user.latitude)
            new_lng = data.get('longitude', user.longitude)
            new_radius = data.get('radius_km', new_radius)
            if new_lat is None and new_lng is None:
                try:
                    if int(new_radius) not in (5, 10, 15, 20, 30, 50): raise ValueError()
                    new_radius = int(new_radius)
                except (TypeError, ValueError):
                    return jsonify({'error': 'Invalid nearby search radius'}), 400
            else:
                try:
                    new_lat, new_lng, new_radius = validate_location(new_lat, new_lng, new_radius)
                except ValueError as exc:
                    return jsonify({'error': str(exc)}), 400

        postal_code = user.postal_code
        if 'postal_code' in data:
            postal_code = str(data['postal_code'] or '').strip().upper()
            if postal_code and not re.fullmatch(r'[A-Z0-9 -]{3,12}', postal_code):
                return jsonify({'error': 'Invalid postal code'}), 400
            postal_code = postal_code or None

        notifications_opt_in = user.notifications_opt_in
        marketing_opt_in = user.marketing_opt_in
        for key in ('notifications_opt_in', 'marketing_opt_in'):
            if key in data and not isinstance(data[key], bool):
                return jsonify({'error': f'Invalid {key} value'}), 400
        notifications_opt_in = data.get('notifications_opt_in', notifications_opt_in)
        marketing_opt_in = data.get('marketing_opt_in', marketing_opt_in)

        preferred_store = None
        allowed_stores = ('Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths')
        if 'preferred_stores' in data:
            entries = data['preferred_stores']
            if not isinstance(entries, list) or len(entries) > len(allowed_stores) or any(
                not isinstance(store, str) or store not in allowed_stores for store in entries
            ) or len(set(entries)) != len(entries):
                return jsonify({'error': 'Select valid supermarkets, without duplicates.'}), 400
            preferred_store = ','.join(store for store in allowed_stores if store in entries)
        elif 'preferred_store' in data:
            raw_store = data['preferred_store']
            if not isinstance(raw_store, str):
                return jsonify({'error': 'Invalid preferred store'}), 400
            entries = [value.strip() for value in raw_store.split(',') if value.strip()]
            if len(entries) > len(allowed_stores) or any(store not in allowed_stores for store in entries) or len(set(entries)) != len(entries):
                return jsonify({'error': 'Unsupported preferred store'}), 400
            preferred_store = ','.join(store for store in allowed_stores if store in entries)

        budget = None
        if 'monthly_budget' in data:
            try:
                budget = float(data['monthly_budget'] or 0)
                if not math.isfinite(budget) or not 0 <= budget <= 1000000:
                    raise ValueError()
            except (ValueError, TypeError):
                return jsonify({'error': 'Monthly budget must be between R0 and R1,000,000'}), 400

        user.username = username
        user.email = email
        user.date_of_birth = birthday
        user.age_confirmation = age_confirmation
        user.location = location
        user.latitude = new_lat
        user.longitude = new_lng
        user.nearby_radius_km = new_radius
        user.postal_code = postal_code
        user.notifications_opt_in = notifications_opt_in
        user.marketing_opt_in = marketing_opt_in

        if preferred_store is not None or budget is not None:
            pref = user.preference
            if pref is None:
                pref = UserPreference(user_id=user.id, preferred_store='')
                db.session.add(pref)
            if preferred_store is not None:
                pref.preferred_store = preferred_store
            if budget is not None:
                pref.monthly_budget = budget

        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return jsonify({'error': 'Username or email already in use'}), 409
        if changed_identity:
            session['username'] = user.username

    pref = user.preference
    return jsonify({
        'username': user.username, 'email': user.email,
        'date_of_birth': user.date_of_birth.isoformat() if user.date_of_birth else '',
        'age_confirmation': user.age_confirmation,
        'age_group': user_age_group(user),
        'location': user.location or '', 'postal_code': user.postal_code or '',
        'latitude': user.latitude, 'longitude': user.longitude,
        'radius_km': user.nearby_radius_km or 15,
        'preferred_store': pref.preferred_store if pref else '',
        'preferred_stores': [name for name in ('Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths') if name in (pref.preferred_store or '').split(',')] if pref else [],
        'monthly_budget': pref.monthly_budget if pref else 0,
        'notifications_opt_in': bool(user.notifications_opt_in),
        'marketing_opt_in': bool(user.marketing_opt_in),
    })


# === LOCATION-BASED SHOPPING (strictly 4 scraped retailer chains) ===
@app.route('/api/locations/search', methods=['GET'])
def api_location_places():
    query = (request.args.get('q') or '').strip()
    if len(query) < 3 or len(query) > 110:
        return jsonify({'places': [], 'error': 'Enter at least 3 characters'}), 400
    try:
        return jsonify({'places': search_places(query)})
    except Exception:
        app.logger.warning('OSM geocoding unavailable', exc_info=True)
        return jsonify({'places': [], 'error': 'Location search is unavailable. Please try again.'}), 503


@app.route('/api/locations/nearby', methods=['GET'])
def api_location_nearby():
    try:
        lat, lng, radius = validate_location(request.args.get('lat'), request.args.get('lng'),
                                               request.args.get('radius_km', '15'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    try:
        return jsonify(nearby_branches(lat, lng, radius))
    except Exception:
        app.logger.warning('OSM branch service unavailable', exc_info=True)
        return jsonify({'status': 'unavailable', 'filterActive': False, 'stores': [],
                        'retailers': [], 'radiusKm': radius,
                        'error': 'Nearby store data is unavailable. Prices are not location-filtered.'}), 503


def request_nearby_retailers():
    """Return None when no map location is set or OSM is unavailable.

    Empty set means OSM returned NO matching retailer branches: show no products,
    rather than silently reverting to nationwide results.
    """
    lat = request.args.get('lat')
    lng = request.args.get('lng')
    radius = request.args.get('radius_km', 15)
    if lat is None and lng is None:
        uid = session.get('user_id')
        user = db.session.get(User, uid) if uid else None
        if not user or user.latitude is None or user.longitude is None:
            return None
        lat, lng, radius = user.latitude, user.longitude, user.nearby_radius_km or 15
    try:
        lat, lng, radius = validate_location(lat, lng, radius)
        data = nearby_branches(lat, lng, radius)
        return set(data['retailers'])
    except Exception:
        app.logger.warning('Nearby retailer filtering temporarily unavailable', exc_info=True)
        return None


def limit_to_nearby_retailers(products, retailers):
    if retailers is None:
        return products
    return [product for product in products if product.get('store') in retailers]


@app.route('/api/admin/insights', methods=['GET'])
@admin_required
def api_admin_insights():
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    users = User.query.all()
    store_counts = db.session.query(Product.store, db.func.count(Product.id)).group_by(Product.store).all()
    query_col = db.func.lower(SearchHistory.__table__.c.query)
    top_searches = db.session.query(query_col, db.func.count(SearchHistory.id)).filter(
        SearchHistory.created_at >= seven_days_ago).group_by(query_col).order_by(
            db.func.count(SearchHistory.id).desc()).limit(7).all()
    recent_logs = SystemLog.query.order_by(SystemLog.created_at.desc()).limit(8).all()
    return jsonify({
        'profileCompletion': sum(bool((u.date_of_birth or u.age_confirmation is not None) and u.postal_code) for u in users),
        'adultUsers': sum(user_age_group(u) == 'adult' for u in users),
        'underageUsers': sum(user_age_group(u) == 'under_18' for u in users),
        'unknownAgeUsers': sum(user_age_group(u) == 'unknown' for u in users),
        'restrictedProducts': Product.query.filter(db.or_(
            Product.age_restricted.is_(True),
            *(Product.name.ilike(f'%{term}%') for term in ('wine', 'beer', 'vodka', 'gin',
              'whisky', 'whiskey', 'brandy', 'tobacco', 'cigarette', 'vape', 'nicotine', '18+'))
        )).count(),  # Approximate including possible name-based false positives
        'storeCounts': [{'store': name or 'Unknown', 'count': count} for name, count in store_counts],
        'topSearches': [{'query': q, 'count': count} for q, count in top_searches],
        'recentLogs': [{'action': log.action, 'date': log.created_at.isoformat(), 'details': log.details or ''} for log in recent_logs],
        'comparison': compare_cache_stats(),
        'configuredScrapers': 4,
    })


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
        "activeScrapers": 4,
        "scraperStatus": "Configured; live health not verified"
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
        "joined": u.created_at.strftime('%Y-%m-%d'),
        "age_group": user_age_group(u),
        "location": u.location or '',
        "profile_complete": bool((u.date_of_birth or u.age_confirmation is not None) and u.postal_code),
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
    if len(password) < 12:
        return jsonify({'error': 'Password must be at least 12 characters.'}), 400

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
        clear_comparison_cache()
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

@app.route('/favicon.ico')
def favicon(): return '', 204

def log_distinct_search_action(query):
    user_id = session.get('user_id')
    if not user_id:
        return
    action_id = (request.args.get('search_action_id') or
                 request.headers.get('X-Search-Action-ID') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', action_id):
        action_id = ''
    try:
        if action_id:
            # Unique constraint is atomic across concurrent Flask workers.
            db.session.add(SearchActionReceipt(user_id=user_id, action_id=action_id))
            db.session.add(SearchHistory(user_id=user_id, query=query))
            db.session.commit()
        else:
            # Legacy clients: coalesce only near-simultaneous network duplicates.
            # Send distinct action IDs to record intentionally repeated queries.
            duplicate = SearchHistory.query.filter(
                SearchHistory.user_id == user_id,
                SearchHistory.__table__.c.query == query,
                SearchHistory.created_at >= datetime.utcnow() - timedelta(seconds=1)
            ).first()
            if not duplicate:
                db.session.add(SearchHistory(user_id=user_id, query=query))
                db.session.commit()
    except IntegrityError:
        db.session.rollback()  # Same action already counted; expected race result.
    except Exception:
        db.session.rollback()
        app.logger.exception('Failed to log search action')


# Category tabs browse product groups, not a literal item named "all".
# Restrict each category to a small number of retailer searches; return indexed
# products too when a retailer is temporarily unavailable.
_SMARTBASKET_BROWSE_TERMS = {
    'Grocery': ('milk', 'rice', 'bread'),
    'Pharmacy': ('vitamins', 'panado', 'bandage'),
    'Liquor': ('wine', 'beer', 'cider'),
    'Electronics': ('batteries', 'charger', 'kettle'),
}
_SMARTBASKET_CATEGORY_GROUPS = {
    'Grocery': 'Grocery', 'Baby': 'Grocery', 'Household': 'Grocery',
    'Personal Care': 'Grocery', 'Pet Care': 'Grocery', 'Other': 'Grocery',
    'Pharmacy': 'Pharmacy', 'Electronics': 'Electronics', 'Liquor': 'Liquor',
}


def _smartbasket_browse_category(value):
    if not isinstance(value, str):
        return None
    return next((cat for cat in _SMARTBASKET_BROWSE_TERMS if cat.lower() == value.strip().lower()), None)


def _smartbasket_matches_browse_category(product, category):
    return not category or _SMARTBASKET_CATEGORY_GROUPS.get(classify_product(product)[0]) == category


def _smartbasket_indexed_browse(category, store_filter, nearby_retailers):
    """Include saved products when targeted live category scraping is unavailable."""
    if store_filter == 'pnp' or store_filter in ('pick n pay', 'picknpay'):
        store = 'Pick n Pay'
    elif store_filter in ('shoprite', 'checkers', 'woolworths'):
        store = store_filter.capitalize()
    elif store_filter != 'all':
        return []
    else:
        store = None
    query = Product.query
    if store:
        query = query.filter(db.func.lower(Product.store) == store.lower())
    if nearby_retailers is not None:
        query = query.filter(Product.store.in_(list(nearby_retailers)))
    if category:
        aliases = [raw for raw, broad in _SMARTBASKET_CATEGORY_GROUPS.items() if broad == category]
        preferred = query.filter(Product.catalog_category.in_(aliases)).order_by(Product.last_updated.desc()).limit(180).all()
        remainder = query.order_by(Product.last_updated.desc()).limit(700).all()
        records = dict((record.id, record) for record in preferred + remainder).values()
    else:
        records = query.order_by(Product.last_updated.desc()).limit(200).all()
    result = []
    for record in records:
        if not _smartbasket_matches_browse_category(record, category):
            continue
        result.append({
            'id': record.id, 'name': record.name, 'store': record.store,
            'price': record.price,
            'formattedPrice': record.formatted_price or f'R {record.price:.2f}',
            'imageUrl': record.image_url or '', 'productUrl': record.product_url or '',
            'barcode': record.barcode or '',
            'catalogCategory': record.catalog_category or 'Other',
            'ageRestricted': bool(record.age_restricted),
        })
        if len(result) >= 180:
            break
    return result


@app.route('/api/search', methods=['GET'])
@check_active_status
def handle_search():
    query = request.args.get('q', '').strip().lower()
    requested_category = _smartbasket_browse_category(request.args.get('category'))
    browsing = query in ('', 'all', 'browse')
    if not query and requested_category:
        query = 'all'
    # Never scrape or return restricted products to guest/underage accounts.
    if requested_category == 'Liquor' and not current_viewer_can_see_adult():
        return jsonify([])
    store_filter = request.args.get('store', 'all').strip().lower()
    sort_option = request.args.get('sort', '').strip().lower()
    location = request.args.get('loc', 'National') # Kept for older clients
    nearby_retailers = request_nearby_retailers()

    if not query: return jsonify([])

    # Count an intentional search exactly once, even if multiple requests arrive.
    # Repeating the same query with a NEW action ID correctly increments the count.
    log_distinct_search_action(query)

    search_queries = list(_SMARTBASKET_BROWSE_TERMS.get(requested_category, ('milk',))) if browsing else [query]
    if not browsing and query in ['milk', 'dairy']:
        search_queries = ['milk', 'fresh milk', 'butter', 'cheese', 'yogurt']
    elif not browsing and query in ['juice', 'fruit']:
        search_queries = ['juice', 'fruit juice', 'apple juice', 'orange juice']
    elif not browsing and query in ['pantry']:
        search_queries = ['rice', 'pasta', 'oil', 'sugar', 'flour']
    elif not browsing and query in ['bread', 'bakery']:
        search_queries = ['bread', 'brown bread', 'white bread', 'bakery']
    elif not browsing and query in ['snacks']:
        search_queries = ['chips', 'chocolate', 'biscuits', 'snacks']
    elif not browsing and query in ['meat', 'poultry']:
        search_queries = ['chicken', 'beef', 'steak', 'wors', 'mince']

    async def run_search():
        scrapers = (
            (('all', 'pnp', 'pick n pay', 'picknpay'), scrape_pnp),
            (('all', 'shoprite'), scrape_shoprite),
            (('all', 'checkers'), scrape_checkers),
            (('all', 'woolworths', 'ww'), scrape_woolworths),
        )
        requests = [(index, q_term, scraper) for q_term in search_queries
                    for index, (aliases, scraper) in enumerate(scrapers)
                    if store_filter in aliases and (nearby_retailers is None or
                       ('Pick n Pay', 'Shoprite', 'Checkers', 'Woolworths')[index] in nearby_retailers)]
        # The global HTTP semaphore already limits concurrent retailer calls.
        responses = await asyncio.gather(*(scraper(q_term, page_size=16) for index, q_term, scraper in requests),
                                         return_exceptions=True)
        by_store = [[], [], [], []]
        seen = [set() for _ in range(4)]
        for (index, _, _), result in zip(requests, responses):
            if isinstance(result, BaseException):
                continue
            for product in result or []:
                pid = product.get('id')
                if pid and pid not in seen[index]:
                    seen[index].add(pid)
                    by_store[index].append(product)
        return tuple(by_store)

    pnp_res, sr_res, ch_res, ww_res = run_async(run_search())

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

    if browsing:
        # Do not rely only on retailer search results: some retailers do not
        # return good matches for broad terms such as "electronics".
        indexed = _smartbasket_indexed_browse(requested_category, store_filter, nearby_retailers)
        seen_ids = {str(item.get('id')) for item in combined if item.get('id')}
        for saved in indexed:
            if str(saved['id']) not in seen_ids:
                combined.append(saved)
                seen_ids.add(str(saved['id']))
    visible = filter_catalog_for_viewer(combined)
    if requested_category:
        visible = [item for item in visible if _smartbasket_matches_browse_category(item, requested_category)]
    if sort_option in ['asc', 'price_asc', 'low_to_high']:
        visible.sort(key=lambda x: float(x.get('price') or 0))
    elif sort_option in ['desc', 'price_desc', 'high_to_low']:
        visible.sort(key=lambda x: float(x.get('price') or 0), reverse=True)
    return jsonify(annotate_family_best_prices(limit_to_nearby_retailers(visible, nearby_retailers)))

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
        requests = [(category, q, scraper) for category, queries in categories.items()
                    for q in queries for scraper in (scrape_pnp, scrape_shoprite, scrape_checkers, scrape_woolworths)]
        results = await asyncio.gather(*(scraper(q, page_size=4) for _, q, scraper in requests),
                                       return_exceptions=True)
        by_category = {category: [] for category in categories}
        seen = {category: set() for category in categories}
        for (category, _, _), result in zip(requests, results):
            if isinstance(result, BaseException):
                continue
            for product in result or []:
                pid = product.get('id')
                if pid and pid not in seen[category] and len(by_category[category]) < 15:
                    seen[category].add(pid)
                    by_category[category].append(product)
        return by_category

    return jsonify(run_async(fetch_live_categories()))

def private_shared_basket_access(basket):
    """Public links are read-only; private links require accepted membership."""
    if basket.is_public:
        return True
    viewer_id = session.get('user_id')
    if not viewer_id:
        return False
    viewer = db.session.get(User, viewer_id)
    if not viewer or not viewer.is_active:
        return False
    if basket.user_id == viewer.id:
        return True
    return SavedBasketCollaborator.query.filter_by(
        saved_basket_id=basket.id, user_id=viewer.id, status='accepted'
    ).first() is not None


@app.route('/api/saved-baskets/<int:basket_id>/share', methods=['POST', 'DELETE'])
@check_active_status
def configure_basket_sharing(basket_id):
    """An owner explicitly publishes a read-only link or revokes it.

    Revoking rotates the token, invalidating all previously published URLs.
    Accepted collaborators retain their authenticated edit access by list ID.
    """
    viewer_id = session.get('user_id')
    if not viewer_id:
        return jsonify({'error': 'Sign in to manage list sharing.'}), 401
    basket = db.session.get(SavedBasket, basket_id)
    if not basket:
        return jsonify({'error': 'List not found.'}), 404
    if basket.user_id != viewer_id:
        return jsonify({'error': 'Only the list owner can change public sharing.'}), 403

    if request.method == 'POST':
        if not basket.share_token:
            basket.share_token = uuid.uuid4().hex
        basket.is_public = True
    else:
        basket.is_public = False
        # An unshared old URL must never become live again on re-sharing.
        basket.share_token = uuid.uuid4().hex

    db.session.commit()
    return jsonify({
        'success': True,
        'is_public': bool(basket.is_public),
        'share_token': basket.share_token if basket.is_public else None,
        'share_path': f'/shared/basket/{basket.share_token}' if basket.is_public else None,
    })


def user_can_edit_basket(basket_id, user_id):
    if not user_id: return False
    basket = db.session.get(SavedBasket, basket_id)
    if not basket: return False
    if basket.user_id == user_id: return True
    collab = SavedBasketCollaborator.query.filter_by(
        saved_basket_id=basket_id, user_id=user_id, status='accepted'
    ).first()
    return collab is not None

@app.route('/api/products/<path:product_id>', methods=['GET'])
def api_get_exact_product(product_id):
    """A retailer product ID resolves ONLY to that product, never a competitor.

    If the asynchronous DB writer has not indexed this product yet, search
    recent retailer cache entries for the exact same ID. Never substitute a
    different retailer item or the cheapest fuzzy match.
    """
    record = db.session.get(Product, product_id)
    if record is None:
        # Immediate clicks can arrive before the nonblocking DB indexer commits.
        # Find the EXACT SKU from recent search caches, never a fuzzy competitor.
        prefix = product_id.split('_', 1)[0]
        if prefix in ('pnp', 'shoprite', 'checkers', 'woolworths'):
            try:
                with sqlite3.connect(CACHE_DB_FILE, timeout=1) as connection:
                    recent = connection.execute(
                        'SELECT data FROM search_cache WHERE store_key = ? AND timestamp > ? '
                        'ORDER BY timestamp DESC LIMIT 100',
                        (prefix, time.time() - CACHE_EXPIRATION_SECONDS)
                    ).fetchall()
                for (payload,) in recent:
                    matching = next((item for item in json.loads(payload)
                                     if item.get('id') == product_id), None)
                    if matching:
                        if product_is_clothing(matching) or (not current_viewer_can_see_adult() and product_is_adult(matching)):
                            return jsonify({'error': 'Product not found', 'id': product_id}), 404
                        return jsonify(matching)
            except (sqlite3.Error, ValueError, TypeError):
                pass
    if record is None or product_is_clothing(record) or (not current_viewer_can_see_adult() and product_is_adult(record)):
        return jsonify({'error': 'Product not found', 'id': product_id}), 404
    return jsonify({
        'id': record.id,
        'name': record.name,
        'store': record.store,
        'price': record.price,
        'formattedPrice': record.formatted_price or f'R {record.price:.2f}',
        'imageUrl': record.image_url or '',
        'barcode': record.barcode or '',
        'ageRestricted': bool(record.age_restricted) or product_is_adult(record),
        'catalogCategory': classify_product(record)[0],
        'productUrl': record.product_url or '',
    })


def comparison_login_required(function):
    @wraps(function)
    def authenticated(*args, **kwargs):
        user_id = session.get('user_id')
        user = db.session.get(User, user_id) if user_id else None
        if not user or not user.is_active:
            return jsonify({'error': 'Sign in or create an account to compare prices.',
                            'code': 'LOGIN_REQUIRED'}), 401
        return function(*args, **kwargs)
    return authenticated


def recent_indexed_offer(product_id):
    """Look up a selected retailer listing by ID; never trust client price data.

    The recent scraper cache is checked first because search results may be
    clicked before the asynchronous product DB writer has committed them.
    """
    if not product_id or len(product_id) > 100:
        return None
    prefix = product_id.split('_', 1)[0]
    if prefix in ('pnp', 'shoprite', 'checkers', 'woolworths'):
        try:
            with sqlite3.connect(CACHE_DB_FILE, timeout=1) as connection:
                rows = connection.execute(
                    'SELECT data FROM search_cache WHERE store_key = ? AND timestamp > ? '
                    'ORDER BY timestamp DESC LIMIT 100',
                    (prefix, time.time() - CACHE_EXPIRATION_SECONDS),
                ).fetchall()
            for (payload,) in rows:
                offer = next((item for item in json.loads(payload)
                              if isinstance(item, dict) and item.get('id') == product_id), None)
                if offer:
                    return dict(offer)
        except (sqlite3.Error, ValueError, TypeError):
            pass
    record = db.session.get(Product, product_id)
    if not record or not record.last_updated or \
            (datetime.utcnow() - record.last_updated).total_seconds() > CACHE_EXPIRATION_SECONDS:
        return None
    return {
        'id': record.id, 'name': record.name, 'store': record.store,
        'price': record.price, 'formattedPrice': record.formatted_price,
        'imageUrl': record.image_url or '', 'barcode': record.barcode or '',
        'productUrl': record.product_url or '',
    }

# Individual product price comparison is public. Age-restricted products are
# still removed by filter_catalog_for_viewer below. Basket comparison remains
# authenticated at /api/batch-compare.
@app.route('/api/compare', methods=['GET'])
def compare_product():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'found': False, 'products': [], 'cheapest': None})

    barcode = request.args.get('barcode', '').strip()
    selected_id = request.args.get('product_id', '').strip()
    mode = (request.args.get('mode') or 'exact').strip().lower()
    if mode not in ('exact', 'family', 'mixed'):
        return jsonify({'error': 'mode must be exact, family or mixed'}), 400
    if mode == 'family':
        results = run_async(fetch_family_size_competitors(query))
    elif mode == 'mixed':
        async def fetch_mixed():
            exact, family = await asyncio.gather(
                fetch_verified_competitors(query, barcode), fetch_family_size_competitors(query)
            )
            # Include the original product when it is still in our recent
            # catalogue, even if retailer ranking omitted it from the top 20.
            original = recent_indexed_offer(selected_id)
            if original:
                selected_matches = filter_and_score_competitors(query, [original], barcode)
                for selected in selected_matches:
                    same_store = next((i for i, p in enumerate(exact)
                                       if p.get('store') == selected.get('store')), None)
                    if same_store is None:
                        exact.append(selected)
                    elif float(selected['price']) < float(exact[same_store]['price']):
                        exact[same_store] = selected
            # Exact listings get priority per retailer. Equivalents are clearly
            # labelled and have identical type, pack size, and packaging.
            exact_by_store = {p['store']: p for p in exact}
            merged = []
            for p in exact:
                merged.append(dict(p, matchType='exact', matchLabel='Exact product'))
            for p in family:
                if p.get('store') not in exact_by_store:
                    merged.append(dict(p, matchType='equivalent', matchLabel='Store equivalent',
                                       isExact=False, is_exact_match=False))
            return merged
        results = run_async(fetch_mixed())
    else:
        results = run_async(fetch_verified_competitors(query, barcode))
    results = limit_to_nearby_retailers(filter_catalog_for_viewer(results),
                                        request_nearby_retailers())
    # Recalculate after filtering; children must not see restricted products or
    # be left with an invisible best-price winner.
    if mode == 'family':
        results = annotate_family_best_prices(results)
    elif mode == 'mixed':
        results = annotate_mixed_best_prices(results)
    else:
        results = annotate_exact_best_prices(results)
    results.sort(key=lambda p: (not p.get('isBestPrice', False), float(p.get('price') or 0), str(p.get('store', ''))))
    cheapest = next((p for p in results if p.get('isBestPrice')), None)
    return jsonify({
        'found': bool(results), 'mode': mode,
        'comparisonDescription': ('Cheapest available offer of the same type and pack size; flavours may vary.'
                                  if mode == 'family' else ('Exact product when available; otherwise a clearly labelled store equivalent of the same type and pack size.' if mode == 'mixed' else 'Same product, flavour and pack size.')),
        'query': optimize_search_query(query),
        'products': results,
        'cheapest': cheapest,
        'bestPriceProductId': cheapest.get('id') if cheapest else None,
        'bestPriceMatchType': cheapest.get('matchType', 'exact') if cheapest else None,
    })


async def internal_fetch_competitors(query: str):
    """Exact offer first per retailer; compatible same-size alternative second.

    Both result sets come from real scraped store listings. Never invent a
    price or treat a compatible product as the same SKU. The pre-existing
    catalogue/age and location filters still run in the batch endpoint.
    """
    exact = await fetch_verified_competitors(query)
    by_store = {p['store']: dict(p, matchType='exact',
                                  matchLabel='Exact product',
                                  isExact=True, is_exact_match=True)
                for p in exact if p.get('store')}
    if len(by_store) == 4:
        return sorted(by_store.values(), key=lambda p: (p['price'], p['store']))

    # The family's pack size, count, type, major variants and packaging must
    # match. If classification or size is unknown, do not guess an alternative.
    if price_family_key(query) is not None:
        equivalents = await fetch_family_size_competitors(query)
        for offer in equivalents:
            retailer = offer.get('store')
            if not retailer or retailer in by_store:
                continue
            by_store[retailer] = dict(
                offer, matchType='equivalent',
                matchLabel='Store equivalent',
                isExact=False, is_exact_match=False,
                matchMethod='same_category_variant_and_pack',
            )
    return sorted(by_store.values(), key=lambda p: (p['price'], p['store']))


@app.route('/api/batch-compare', methods=['POST'])
@comparison_login_required
def batch_compare():
    data = request.get_json(silent=True) or {}
    queries = data.get('queries', [])
    if not isinstance(queries, list) or len(queries) > 40:
        return jsonify({'error': 'Provide a list of up to 40 product names'}), 400
    queries = [str(q).strip()[:150] for q in queries if isinstance(q, str) and q.strip()]
    if not queries:
        return jsonify({})

    nearby_retailers = request_nearby_retailers()
    # If someone selected an area but OSM has no usable data at all, do not
    # silently show nationwide prices as though they were nearby.
    if nearby_retailers is None:
        user = db.session.get(User, session.get('user_id')) if session.get('user_id') else None
        chosen_location = ('lat' in request.args or 'lng' in request.args or
                           (user is not None and user.latitude is not None and user.longitude is not None))
        if chosen_location:
            return jsonify({'error': 'Nearby branch information is temporarily unavailable. Please try again or switch to National view.'}), 503
    if nearby_retailers == set():
        return jsonify({name: [] for name in queries})

    async def fetch_all_competitors():
        unique_queries = list(dict.fromkeys(queries))
        limiter = asyncio.Semaphore(3)
        async def lookup(query):
            async with limiter:
                return await internal_fetch_competitors(query)
        values = await asyncio.gather(*(lookup(q) for q in unique_queries))
        lookup_table = dict(zip(unique_queries, values))
        return {q: lookup_table[q] for q in queries}

    result = run_async(fetch_all_competitors())
    # Exact matches and labelled equivalents are both filtered by age and location.
    # The same enforced age and nearby-chain filters used by Search and Home.
    # The request's cached OSM branch coordinates determine which of the four
    # scraped chains may appear. No branch-level price/stock assertions.
    return jsonify({name: limit_to_nearby_retailers(
        filter_catalog_for_viewer(offers), nearby_retailers)
        for name, offers in result.items()})


@app.route('/api/analytics/price-history/<path:product_id>', methods=['GET'])
def get_price_history(product_id):
    product = db.session.get(Product, product_id)
    if not product or product_is_clothing(product) or (
        product_is_adult(product) and not current_viewer_can_see_adult()
    ):
        return jsonify([])
    history = list(reversed(PriceHistory.query.filter_by(product_id=product_id).order_by(
        PriceHistory.recorded_at.desc()).limit(365).all()))
    if not history:
        prod = db.session.get(Product, product_id)
        if not prod:
            return jsonify([])
        return jsonify([{
            'date': prod.last_updated.strftime('%Y-%m-%d'),
            'price': prod.price,
            'store': prod.store,
            'provisional': True
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

def log_basket_event(basket_id, user_id, kind, product_id=None, product_name=None,
                     old_quantity=None, quantity=None):
    """Record an item change in the SAME DB transaction as the modification.

    No schema migration needed. Keep the payload under VARCHAR(255) for other DBs.
    """
    payload = {'v': 1, 't': kind}
    if product_id:
        payload['i'] = str(product_id)[:70]
    if product_name:
        payload['n'] = str(product_name)[:86]
    if old_quantity is not None:
        payload['o'] = int(old_quantity)
    if quantity is not None:
        payload['q'] = int(quantity)
    encoded = json.dumps(payload, separators=(',', ':'), ensure_ascii=True)
    # Pathologically long/non-ASCII retailer titles still fit DB column.
    if len(encoded) > 255:
        payload.pop('n', None)
        encoded = json.dumps(payload, separators=(',', ':'))
    db.session.add(BasketActivity(basket_id=basket_id, user_id=user_id, action=encoded))


def serialize_basket_events(basket, *, max_events=50, public=False):
    """Return a safe activity feed. Guests only see structured safe events.

    Legacy plain-text events have no product identifier to safely classify, so
    they remain visible only to adult account members / admins (not public URLs).
    """
    adult = current_viewer_can_see_adult()
    viewer_id = session.get('user_id')
    member = bool(viewer_id and user_can_edit_basket(basket.id, viewer_id))
    output = []
    # Limit DB work: large lists should not load their entire edit history.
    recent_events = (BasketActivity.query.filter_by(basket_id=basket.id)
                     .order_by(BasketActivity.created_at.desc(), BasketActivity.id.desc())
                     .limit(250).all())
    for event in recent_events:
        try:
            data = json.loads(event.action)
            if not isinstance(data, dict) or data.get('v') != 1:
                data = None
        except (TypeError, ValueError):
            data = None
        if not data:
            if public or not (member and adult):
                continue  # Legacy summaries can contain hidden item names.
            entry = {'type': 'legacy', 'action': str(event.action)[:255]}
        else:
            kind = data.get('t')
            if kind not in {'created', 'added', 'removed', 'quantity_increased',
                            'quantity_decreased', 'renamed'}:
                continue
            name = str(data.get('n') or '')
            item_id = data.get('i')
            if item_id:
                product = db.session.get(Product, str(item_id))
                target = product if product is not None else {'name': name}
                if product is None and not name:
                    continue  # Unverifiable product identity: suppress rather than leak.
                if (product_is_clothing(target) or product_is_clothing(name)
                        or (not adult and (product_is_adult(target) or product_is_adult(name)))):
                    continue
            elif name:
                if product_is_clothing(name) or (not adult and product_is_adult(name)):
                    continue
            entry = {
                'type': kind,
                'product_name': name,
                'product_id': str(item_id) if item_id else None,
                'previous_quantity': data.get('o'),
                'quantity': data.get('q'),
            }
        entry.update({
            'id': event.id,
            'user': {'username': event.user.username if event.user else 'Former member'},
            'created_at': event.created_at.strftime('%Y-%m-%dT%H:%M:%SZ')
                if event.created_at else None,
        })
        output.append(entry)
        if len(output) >= max_events:
            break
    return output


def basket_revision(basket_id):
    return (db.session.query(db.func.max(BasketActivity.id))
            .filter(BasketActivity.basket_id == basket_id).scalar() or 0)


def notify_list_members(basket, sender_id, message):
    """Notify owner and accepted collaborators, excluding the actor.

    Never put product names in notifications: under-age members cannot see
    restricted product details by reading their inbox.
    """
    recipients = {basket.user_id}
    recipients.update(member.user_id for member in basket.collaborators
                      if member.status == 'accepted')
    # Do not notify the member who just made the change. A different member's
    # first unread change must add one badge group for this list.
    for recipient in recipients - {sender_id}:
        alerts = app.extensions.get('shopping_notifications')
        if alerts and not alerts['preferences'](recipient)['list_activity']:
            continue
        db.session.add(Notification(recipient_id=recipient, sender_id=sender_id,
                                    basket_id=basket.id, message=message[:255],
                                    status='unread', created_at=datetime.utcnow()))


def normalize_basket_lines(raw_items):
    """Reject ambiguous or unsafe lines; accept one line per known retailer SKU."""
    if not isinstance(raw_items, list) or len(raw_items) > 200:
        raise ValueError('Please supply a list of up to 200 products.')
    result = {}
    for entry in raw_items:
        if not isinstance(entry, dict) or not entry.get('id'):
            raise ValueError('Every product needs a retailer product ID.')
        pid = str(entry['id']).strip()[:100]
        try:
            quantity = int(entry.get('quantity', 1))
        except (ValueError, TypeError):
            raise ValueError('Quantities must be whole numbers.')
        if quantity < 1 or quantity > 1000 or pid in result:
            raise ValueError('Quantities must be 1 to 1000 and each item must be unique.')
        product = db.session.get(Product, pid)
        if not product:
            try:
                price = float(entry['price'])
            except (KeyError, ValueError, TypeError):
                raise ValueError('Product price is required.')
            name, store = str(entry.get('name') or ''), str(entry.get('store') or '')
            if not name or not store or len(name) > 255 or price < 0 or not __import__('math').isfinite(price):
                raise ValueError('Product has invalid name, store or price.')
            product = Product(id=pid, name=name, store=store, price=price,
                              formatted_price=f'R {price:.2f}', image_url=str(entry.get('imageUrl') or '')[:4000])
            # Older scraped products may not have been inserted into catalogue yet.
            if product_is_clothing(product):
                raise ValueError('Clothing is excluded from SmartBasket.')
            if product_is_adult(product) and not current_viewer_can_see_adult():
                raise ValueError('This account cannot add age-restricted products.')
            db.session.add(product)
        if product_is_clothing(product) or (product_is_adult(product) and not current_viewer_can_see_adult()):
            raise ValueError('Your account cannot save this product.')
        try:
            price = float(entry.get('price', product.price))
        except (ValueError, TypeError):
            raise ValueError('Product price is invalid.')
        if price < 0 or not __import__('math').isfinite(price):
            raise ValueError('Product price is invalid.')
        result[pid] = (product, quantity, price)
    return result


@app.route('/api/db/save-basket', methods=['POST'])
@check_active_status
def save_basket_to_db():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Sign in to save a basket.'}), 401
    data = request.get_json(silent=True) or {}
    basket_id = data.get('basket_id')
    try:
        name = clean_list_name(data.get('name') or 'My Saved Basket')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    name_key = normalize_list_name(name)
    try:
        # Existing baskets can be edited by the owner or accepted editors only.
        if basket_id is not None:
            try:
                basket_id = int(basket_id)
            except (ValueError, TypeError):
                return jsonify({'error': 'Invalid basket ID.'}), 400
            basket = db.session.get(SavedBasket, basket_id)
            if not basket:
                return jsonify({'error': 'Basket not found.'}), 404
            if not user_can_edit_basket(basket_id, user_id):
                return jsonify({'error': 'You cannot edit this list.'}), 403
            if name != basket.name and any(
                normalize_list_name(other.name) == name_key
                for other in SavedBasket.query.filter_by(user_id=basket.user_id).filter(
                    SavedBasket.id != basket.id).all()
            ):
                return jsonify({'error': 'You already have a saved list with this name.',
                                'code': 'DUPLICATE_LIST_NAME'}), 409
            if 'base_revision' in data and data['base_revision'] is not None:
                if int(data['base_revision']) != basket_revision(basket.id):
                    return jsonify({'error': 'This list changed since you loaded it. Reopen it to get the latest changes.'}), 409
        else:
            if any(normalize_list_name(other.name) == name_key
                   for other in SavedBasket.query.filter_by(user_id=user_id).all()):
                return jsonify({'error': 'You already have a saved list with this name.',
                                'code': 'DUPLICATE_LIST_NAME'}), 409
            basket = SavedBasket(name=name, name_key=name_key, user_id=user_id)
            db.session.add(basket)
            db.session.flush()
            log_basket_event(basket.id, user_id, 'created')
        lines = normalize_basket_lines(data.get('items'))
        if not lines and basket_id is None:
            return jsonify({'error': 'Add a product before saving.'}), 400
        previous = {item.product_id: item for item in basket.items}
        change_count = 0
        for pid, old in previous.items():
            if pid not in lines:
                log_basket_event(basket.id, user_id, 'removed', pid,
                                 old.product.name if old.product else '', old.quantity, 0)
                db.session.delete(old)
                change_count += 1
        for pid, (product, qty, price) in lines.items():
            previous_item = previous.get(pid)
            if previous_item is None:
                db.session.add(BasketItem(basket_id=basket.id, product_id=pid, quantity=qty,
                                          price=price, competitor_prices='[]'))
                log_basket_event(basket.id, user_id, 'added', pid, product.name, None, qty)
                change_count += 1
            else:
                old_qty = previous_item.quantity or 1
                if old_qty != qty:
                    log_basket_event(basket.id, user_id,
                                     'quantity_increased' if qty > old_qty else 'quantity_decreased',
                                     pid, product.name, old_qty, qty)
                    change_count += 1
                previous_item.quantity = qty
                previous_item.price = price
        if basket.name != name:
            basket.name = name
            basket.name_key = name_key
            log_basket_event(basket.id, user_id, 'renamed', product_name=name)
            change_count += 1
        if change_count:
            notify_list_members(basket, user_id,
                                f"{session.get('username', 'A member')} made {change_count} change(s) to '{basket.name}'.")
        total = sum(quantity * price for _, quantity, price in lines.values())
        preference = UserPreference.query.filter_by(user_id=user_id).first()
        warning = bool(preference and preference.monthly_budget and total > preference.monthly_budget)
        db.session.commit()
        return jsonify({'success': True, 'basket_id': basket.id,
                        'basket_total': total, 'budget_warning': warning,
                        'share_token': basket.share_token,
                        'revision': basket_revision(basket.id), 'changes': change_count})
    except (ValueError, TypeError) as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except IntegrityError as exc:
        db.session.rollback()
        if 'uq_saved_baskets_owner_name_key' in str(exc) or 'saved_baskets.user_id, saved_baskets.name_key' in str(exc):
            return jsonify({'error': 'You already have a saved list with this name.',
                            'code': 'DUPLICATE_LIST_NAME'}), 409
        app.logger.exception('Database error saving basket')
        return jsonify({'error': 'Unable to save basket right now.'}), 500
    except Exception:
        db.session.rollback()
        app.logger.exception('Failed to save basket')
        return jsonify({'error': 'Unable to save basket right now.'}), 500


@app.route('/api/db/saved-baskets/<int:basket_id>', methods=['DELETE'])
@check_active_status
def delete_db_basket(basket_id):
    try:
        b = db.session.get(SavedBasket, basket_id)
        if not b:
            return jsonify({'error': 'Basket not found'}), 404
        # Deletion is an owner-only operation. Being able to view or edit a
        # collaborative list must not allow deleting its owner's basket.
        if not session.get('user_id') or b.user_id != session.get('user_id'):
            return jsonify({'error': 'Only the basket owner may delete it'}), 403
        # Prevent orphaned invitations and old notifications referencing a deleted list.
        Notification.query.filter_by(basket_id=b.id).delete(synchronize_session=False)
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
    if not user_can_edit_basket(basket_id, session.get('user_id')):
        return jsonify({'error': 'Access denied'}), 403
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

    if basket.user_id != session['user_id']:
        return jsonify({'error': 'Only the list owner can invite people.'}), 403
    data = request.json or {}
    raw_user_id = data.get('user_id')
    if not raw_user_id:
        return jsonify({'error': 'Target user ID is required'}), 400

    try:
        target_user_id = int(raw_user_id)
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid user ID'}), 400
    if target_user_id == session['user_id']:
        return jsonify({'error': 'You cannot invite yourself'}), 400

    target_user = db.session.get(User, target_user_id)
    if not target_user or target_user.is_admin or not target_user.is_active:
        return jsonify({'error': 'Invalid user account'}), 403

    basket.is_collaborative = True

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

@app.after_request
def prevent_private_notification_caching(response):
    if request.path.startswith('/api/notifications'):
        response.headers['Cache-Control'] = 'private, no-store, max-age=0'
        response.headers['Pragma'] = 'no-cache'
    return response


@app.route('/api/notifications', methods=['GET'])
def get_user_notifications():
    if 'user_id' not in session:
        return jsonify([])
    notifs = Notification.query.filter_by(recipient_id=session['user_id']).order_by(Notification.created_at.desc()).all()
    basket_ids = {n.basket_id for n in notifs}
    baskets = ({b.id: b for b in SavedBasket.query.filter(SavedBasket.id.in_(basket_ids)).all()}
               if basket_ids else {})
    pending = ({c.saved_basket_id for c in SavedBasketCollaborator.query.filter(
                   SavedBasketCollaborator.user_id == session['user_id'],
                   SavedBasketCollaborator.status == 'pending',
                   SavedBasketCollaborator.saved_basket_id.in_(basket_ids)).all()}
               if basket_ids else set())
    entries = [{
        'id': n.id, 'message': n.message, 'basket_id': n.basket_id,
        'sender_id': n.sender_id, 'status': n.status,
        'type': ('invitation' if n.basket_id in pending and baskets.get(n.basket_id)
                 and baskets[n.basket_id].user_id == n.sender_id else 'update'),
        'date': n.created_at.strftime('%Y-%m-%d %H:%M')
    } for n in notifs]
    alerts = app.extensions.get('shopping_notifications')
    if alerts:
        entries.extend(alerts['inbox'](session['user_id']))
    return jsonify(sorted(entries, key=lambda entry: entry['date'], reverse=True))

@app.route('/api/notifications/count', methods=['GET'])
def get_unread_notifications_count():
    if 'user_id' not in session:
        return jsonify({'count': 0})
    count = (db.session.query(db.func.count(db.distinct(Notification.basket_id)))
             .filter(Notification.recipient_id == session['user_id'],
                     Notification.status == 'unread').scalar() or 0)
    alerts = app.extensions.get('shopping_notifications')
    if alerts:
        count += alerts['count'](session['user_id'])
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
    if action not in ('accept', 'decline'):
        return jsonify({'error': 'Choose accept or decline.'}), 400
    collab = SavedBasketCollaborator.query.filter_by(saved_basket_id=notif.basket_id,
              user_id=session['user_id'], status='pending').first()
    basket = db.session.get(SavedBasket, notif.basket_id)
    if not collab or not basket or notif.sender_id != basket.user_id:
        return jsonify({'error': 'This invitation is no longer pending.'}), 409
    notif.status = 'read'
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

    # Accepting or declining clears the old invitation group completely.
    # Otherwise historical unread rows keep the bell at 1 forever.
    Notification.query.filter_by(
        recipient_id=session['user_id'], basket_id=notif.basket_id, status='unread'
    ).update({'status': 'read'}, synchronize_session=False)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/shared/basket/<token>', methods=['GET'])
@check_active_status
def public_shared_basket(token):
    basket = SavedBasket.query.filter_by(share_token=token).first_or_404()
    if not private_shared_basket_access(basket):
        # Private lists still require accepted membership even when a token
        # is known; published URLs can be read anonymously.
        if not session.get('user_id'):
            from urllib.parse import quote
            next_page = quote(f'/shared/basket/{token}', safe='')
            return redirect(f'{react_dev_origin()}/login?next={next_page}', code=303)
        abort(403)
    allow_adult = current_viewer_can_see_adult()
    visible_items = [bi for bi in basket.items if bi.product and not product_is_clothing(bi.product)
                     and (allow_adult or not product_is_adult(bi.product))]
    # Read-only template proxy; do not mutate the SQLAlchemy relationship.
    class BasketTemplateView:
        def __getattr__(self, name):
            if name == 'items':
                return visible_items
            return getattr(basket, name)
    return render_template('public_shared_basket.html', basket=BasketTemplateView())

def list_member_summary(basket):
    """Non-sensitive member metadata for the account's own saved-list pages."""
    output = []
    for member in basket.collaborators:
        account = db.session.get(User, member.user_id)
        if account:
            output.append({'id': account.id, 'username': account.username,
                           'status': member.status, 'role': member.role})
    return output


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
        items_list = [{'id': bi.product.id, 'name': bi.product.name, 'store': bi.product.store, 'price': bi.price or bi.product.price, 'formattedPrice': bi.product.formatted_price, 'imageUrl': bi.product.image_url, 'quantity': bi.quantity} for bi in b.items if bi.product and not product_is_clothing(bi.product)
                      and (current_viewer_can_see_adult() or not product_is_adult(bi.product))]
        output.append({
            'id': b.id,
            'name': b.name,
            'date': b.created_at.strftime('%Y-%m-%d'),
            'items': items_list,
            'is_shared': False,
            'is_collab': False,
            'share_token': b.share_token,
            'is_public': bool(b.is_public),
            'is_owner': True,
            'owner_id': b.user_id,
            'owner_profile': {'id': b.user_id, 'username': b.owner.username if b.owner else 'List owner'},
            'collaborators': list_member_summary(b),
            'revision': basket_revision(b.id),
            'activities': serialize_basket_events(b, max_events=50)
        })

    for b in all_collabs:
        inviter_name = b.owner.username if b.owner else 'Someone'
        items_list = [{'id': bi.product.id, 'name': bi.product.name, 'store': bi.product.store, 'price': bi.price or bi.product.price, 'formattedPrice': bi.product.formatted_price, 'imageUrl': bi.product.image_url, 'quantity': bi.quantity} for bi in b.items if bi.product and not product_is_clothing(bi.product)
                      and (current_viewer_can_see_adult() or not product_is_adult(bi.product))]

        activities_list = serialize_basket_events(b, max_events=50)

        output.append({
            'id': b.id,
            'name': b.name,
            'date': b.created_at.strftime('%Y-%m-%d'),
            'items': items_list,
            'is_shared': (b.user_id != user_id),
            'is_collab': True,
            'inviter_name': inviter_name,
            'activities': activities_list,
            'share_token': b.share_token,
            'is_public': bool(b.is_public),
            'is_owner': b.user_id == user_id,
            'owner_id': b.user_id,
            'owner_profile': {'id': b.user_id, 'username': inviter_name},
            'collaborators': list_member_summary(b),
            'revision': basket_revision(b.id)
        })

    return jsonify(output)

@app.route('/api/notifications/lists/<int:basket_id>/read', methods=['POST'])
@check_active_status
def mark_list_notifications_as_read(basket_id):
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Sign in first.'}), 401
    basket = db.session.get(SavedBasket, basket_id)
    if not basket or not private_shared_basket_access(basket):
        return jsonify({'error': 'List not found or access denied.'}), 404
    changed = Notification.query.filter_by(
        recipient_id=user_id, basket_id=basket_id, status='unread'
    ).update({'status': 'read'}, synchronize_session=False)
    db.session.commit()
    return jsonify({'success': True, 'marked_read': changed})


@app.route('/api/notifications/<int:notif_id>/read', methods=['POST'])
def mark_notification_read(notif_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    notif = db.session.get(Notification, notif_id)
    if not notif or notif.recipient_id != session['user_id']:
        return jsonify({'error': 'Notification not found'}), 404

    Notification.query.filter_by(recipient_id=session['user_id'], basket_id=notif.basket_id,
                                 status='unread').update({'status': 'read'}, synchronize_session=False)
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
    alerts = app.extensions.get('shopping_notifications')
    if alerts:
        alerts['mark_all'](session['user_id'])
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/db/saved-baskets/<int:basket_id>/items/<path:product_id>', methods=['PATCH', 'DELETE'])
@check_active_status
def modify_saved_basket_item(basket_id, product_id):
    user_id = session.get('user_id')
    if not user_can_edit_basket(basket_id, user_id):
        return jsonify({'error': 'Unauthorized'}), 403

    item = BasketItem.query.filter_by(basket_id=basket_id, product_id=product_id).first_or_404()
    product_name = item.product.name if item.product else 'Product'
    old_qty = int(item.quantity or 1)

    if request.method == 'DELETE':
        db.session.delete(item)
        log_basket_event(basket_id, user_id, 'removed', product_id, product_name, old_qty, 0)
    else:
        data = request.get_json(silent=True) or {}
        try:
            raw_change = data.get('change')
            if isinstance(raw_change, bool) or isinstance(raw_change, float) or raw_change is None:
                raise ValueError()
            change = int(raw_change)
        except (ValueError, TypeError):
            return jsonify({'error': 'Quantity change must be a whole number.'}), 400
        if change == 0 or abs(change) > 100:
            return jsonify({'error': 'Quantity change must be from -100 to 100, excluding 0.'}), 400
        new_qty = old_qty + change
        if new_qty <= 0:
            db.session.delete(item)
            log_basket_event(basket_id, user_id, 'removed', product_id, product_name, old_qty, 0)
        else:
            item.quantity = new_qty
            log_basket_event(basket_id, user_id,
                             'quantity_increased' if change > 0 else 'quantity_decreased',
                             product_id, product_name, old_qty, new_qty)

    basket = db.session.get(SavedBasket, basket_id)
    if basket:
        notify_list_members(basket, user_id,
                            f"{session.get('username', 'A member')} updated '{basket.name}'.")
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/search/history', methods=['GET'])
def get_search_history():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify([])  # Strictly restrict history dropdown to logged-in users

    history = db.session.query(SearchHistory).filter_by(user_id=user_id).order_by(SearchHistory.created_at.desc()).limit(100).all()

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
        db.session.query(SearchHistory).filter_by(user_id=user_id).filter(
            db.func.lower(SearchHistory.__table__.c.query) == item.query.lower()
        ).delete(synchronize_session=False)
        db.session.commit()

    return jsonify({'success': True})

@app.route('/api/category/<path:category_name>', methods=['GET'])
def get_products_by_category(category_name):
    """Fetches all products belonging to a specific category from the database."""
    category_name_clean = category_name.strip().lower()

    category = Category.query.filter(Category.name.ilike(f"%{category_name_clean}%")).first()

    if not category:
        # Fallback if category name doesn't match exactly
        products = Product.query.filter(Product.name.ilike(f"%{category_name_clean}%")).limit(20).all()
    else:
        products = Product.query.filter_by(category_id=category.id).all()

    results = [{
        'id': p.id,
        'name': p.name,
        'store': p.store,
        'price': p.price,
        'formattedPrice': p.formatted_price or f"R {p.price:.2f}",
        'imageUrl': p.image_url,
        'productUrl': p.product_url or '',
        'barcode': p.barcode or '',
        'ageRestricted': bool(p.age_restricted) or product_is_adult(p),
                            'catalogCategory': classify_product(p)[0]
    } for p in products]

    return jsonify(results)

@app.route('/api/trending-searches', methods=['GET'])
def get_trending_searches():
    try:
        from sqlalchemy import func
        query_col = func.lower(SearchHistory.__table__.c.query)

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


def serve_react_on_this_request():
    """Serve the built UI for any non-local hostname, even without an env flag.

    Railway public URLs must NEVER redirect browsers to localhost:5173.
    Preserve the Vite redirect only for localhost development requests.
    """
    if IS_PRODUCTION:
        return True
    host = request.host.split(':', 1)[0].lower().strip('[]')
    return host not in ('localhost', '127.0.0.1', '::1')


def serve_react():
    """Serve the production React SPA without exposing a local dev-server URL."""
    index_file = os.path.join(REACT_DIST_DIR, 'index.html')
    if not os.path.isfile(index_file):
        return ('React production build is missing. Build frontend/dist '
                'in the Dockerfile and redeploy.', 503)
    return send_from_directory(REACT_DIST_DIR, 'index.html')


@app.route('/')
@app.route('/search')
@app.route('/basket')
@app.route('/saved')
@app.route('/collaborative')
@app.route('/notifications')
@app.route('/account/profile')
def redirect_to_react():
    if serve_react_on_this_request():
        return serve_react()

    query_string = request.query_string.decode('utf-8')
    redirect_url = f"{react_dev_origin()}{request.path}"
    if query_string:
        redirect_url += f"?{query_string}"
    return redirect(redirect_url)


@app.route('/account')
def account():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    if serve_react_on_this_request():
        return serve_react()
    return redirect(f'{react_dev_origin()}/account')


def react_dev_origin():
    """Return relative URLs for public visitors and Vite URL for local dev."""
    if serve_react_on_this_request():
        return ''
    hostname = (request.host or '').split(':')[0].lower()
    if hostname not in ('localhost', '127.0.0.1'):
        hostname = 'localhost'
    return f'http://{hostname}:5173'


def submitted_auth_data():
    """Accept normal HTML form submissions and JSON-based React submissions."""
    if request.is_json:
        payload = request.get_json(silent=True)
        return payload if isinstance(payload, dict) else {}
    return request.form


def auth_wants_json():
    """Treat JSON and AJAX form submissions as API calls, not browser navigation."""
    accept = request.headers.get('Accept', '')
    return (request.is_json or
            request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
            ('application/json' in accept and 'text/html' not in accept))


def auth_form_error(template_name, message, status=400):
    if auth_wants_json():
        return jsonify({'error': message}), status
    return render_template(template_name, error=message), status


@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'GET':
        return serve_react() if serve_react_on_this_request() else render_template('signup.html')

    payload = submitted_auth_data()
    username = payload.get('username')
    email = payload.get('email')
    password = payload.get('password')

    username = username.strip() if isinstance(username, str) else ''
    email = email.strip().lower() if isinstance(email, str) else ''

    if not username or not email or not isinstance(password, str) or not password:
        return auth_form_error('signup.html', 'Username, email and password are required.')
    if len(username) > 80 or len(email) > 120 or '@' not in email:
        return auth_form_error('signup.html', 'Please enter a valid username and email address.')

    confirm_password = payload.get('confirm_password')
    if confirm_password is not None and confirm_password != password:
        return auth_form_error('signup.html', 'Passwords do not match.')

    if User.query.filter(db.func.lower(User.email) == email).first():
        return auth_form_error('signup.html', 'Email already exists.', 409)
    if User.query.filter_by(username=username).first():
        return auth_form_error('signup.html', 'Username is already taken.', 409)

    dob_raw = payload.get('date_of_birth') or ''
    if dob_raw:
        if not isinstance(dob_raw, str):
            return auth_form_error('signup.html', 'Invalid date of birth.')
        try:
            dob = date.fromisoformat(dob_raw.strip())
            if dob > date.today() or dob.year < 1900:
                raise ValueError('Date outside allowed range')
        except ValueError:
            return auth_form_error('signup.html', 'Invalid date of birth.')
    else:
        dob = None

    try:
        new_user = User(
            username=username,
            email=email,
            date_of_birth=dob,
            password_hash=generate_password_hash(password),
        )
        db.session.add(new_user)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return auth_form_error('signup.html', 'Username or email is already registered.', 409)

    session.clear()
    session['user_id'] = new_user.id
    session['username'] = new_user.username
    session['is_admin'] = bool(new_user.is_admin)
    app.extensions['smartbasket_addons']['create_session'](new_user)

    if auth_wants_json():
        return jsonify({'success': True, 'authenticated': True,
                        'is_admin': False, 'redirect': '/account'}), 201
    return redirect(f'{react_dev_origin()}/account', code=303)


@app.route('/api/shared/basket/<token>', methods=['GET'])
@check_active_status
def api_public_shared_basket(token):
    basket = SavedBasket.query.filter_by(share_token=token).first_or_404()
    if not private_shared_basket_access(basket):
        if not session.get('user_id'):
            return jsonify({'error': 'Sign in to view this private list.'}), 401
        return jsonify({'error': 'This list is private. Accept an invitation to access it.'}), 403
    items_list = [{
        'id': bi.product.id,
        'name': bi.product.name,
        'store': bi.product.store,
        'price': bi.price or bi.product.price,
        'formattedPrice': bi.product.formatted_price,
        'imageUrl': bi.product.image_url,
        'quantity': bi.quantity
    } for bi in basket.items if bi.product
        and not product_is_clothing(bi.product)
        and (current_viewer_can_see_adult() or not product_is_adult(bi.product))]

    return jsonify({
        'id': basket.id,
        'name': basket.name,
        'owner': basket.owner.username if basket.owner else 'Someone',
        'is_public': bool(basket.is_public),
        'date': basket.created_at.strftime('%Y-%m-%d'),
        'items': items_list,
        'activities': serialize_basket_events(basket, max_events=50, public=True)
    })

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        return serve_react() if serve_react_on_this_request() else render_template('login.html')

    payload = submitted_auth_data()
    identifier = payload.get('identifier') or payload.get('email') or payload.get('username')
    password = payload.get('password')
    identifier = identifier.strip() if isinstance(identifier, str) else ''

    if not identifier or not isinstance(password, str) or not password:
        return auth_form_error('login.html', 'Email or username and password are required.')
    security = app.extensions['smartbasket_addons']
    if security['locked_out'](identifier):
        return auth_form_error('login.html', 'Too many attempts. Try again in 15 minutes.', 429)

    # Email takes precedence; exact usernames preserve existing case-sensitive
    # accounts. Case-insensitive username fallback is allowed only if unique.
    user = User.query.filter(db.func.lower(User.email) == identifier.lower()).first()
    if user is None:
        user = User.query.filter(User.username == identifier).first()
    if user is None:
        candidates = User.query.filter(db.func.lower(User.username) == identifier.lower()).limit(2).all()
        user = candidates[0] if len(candidates) == 1 else None
    if not user or not check_password_hash(user.password_hash, password):
        security['failed_login'](identifier)
        return auth_form_error('login.html', 'Invalid email/username or password.', 401)
    if not user.is_active:
        return auth_form_error('login.html', 'Your account has been suspended.', 403)
    if not security['admin_totp_ok'](user, payload):
        security['failed_login'](identifier)
        return auth_form_error('login.html', 'Invalid authenticator code.', 401)
    security['successful_login'](identifier)

    session.clear()
    session['user_id'] = user.id
    session['username'] = user.username
    session['is_admin'] = bool(user.is_admin)
    security['create_session'](user)
    destination = '/admin' if user.is_admin else '/account'

    if auth_wants_json():
        return jsonify({'success': True, 'authenticated': True,
                        'is_admin': bool(user.is_admin), 'redirect': destination})
    return redirect(f'{react_dev_origin()}{destination}', code=303)


@app.route('/logout')
def logout():
    app.extensions['smartbasket_addons']['revoke_current']()
    return redirect(f'{react_dev_origin()}/', code=303)


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
        return redirect(f'{react_dev_origin()}/account')

    return serve_react() if serve_react_on_this_request() else render_template('onboarding.html')

@app.route('/api/popular', methods=['GET'])
def get_popular_products():
    """Fetches popular everyday items from the local database instantly,
    falling back to live scraping only if necessary."""
    try:
        with app.app_context():
            popular_items = Product.query.order_by(db.func.random()).limit(240).all()

            if popular_items:
                results = []
                seen_ids = set()
                for p in popular_items:
                    if p.id not in seen_ids:
                        seen_ids.add(p.id)
                        results.append({
                            'id': p.id,
                            'name': p.name,
                            'store': p.store,
                            'price': p.price,
                            'formattedPrice': p.formatted_price or f"R {p.price:.2f}",
                            'imageUrl': p.image_url,
                            'productUrl': p.product_url or '',
                            'barcode': p.barcode or '',
                            'ageRestricted': bool(p.age_restricted) or product_is_adult(p),
                            'catalogCategory': classify_product(p)[0]
                        })
                results = limit_to_nearby_retailers(filter_catalog_for_viewer(results),
                                                   request_nearby_retailers())[:24]
                if results:
                    return jsonify(results)
    except Exception as e:
        print(f"[Popular Route Error] Falling back to live fetch: {e}")

    # Fallback to your original live rotation logic if DB is empty
    popular_queries = ['milk', 'bread', 'eggs', 'chicken', 'rice', 'sugar', 'cooking oil', 'juice', 'butter', 'cheese']

    async def fetch_popular():
        tasks = []
        for q in popular_queries:
            tasks.append(scrape_pnp(q, page_size=2))
            tasks.append(scrape_shoprite(q, page_size=2))
            tasks.append(scrape_checkers(q, page_size=2))
            tasks.append(scrape_woolworths(q, page_size=2))

        results = await asyncio.gather(*tasks)
        rotated = []
        rotated_ids = set()
        for store_results in results:
            for p in store_results:
                pid = p.get('id', '')
                if p.get('price', 0) > 0 and pid not in rotated_ids:
                    rotated_ids.add(pid)
                    rotated.append(p)
                    break
        return rotated[:24]

    products = run_async(fetch_popular())
    return jsonify(limit_to_nearby_retailers(filter_catalog_for_viewer(products),
                                            request_nearby_retailers())[:24])

# Production SPA fallback: built React assets and client-side routes share
# the same origin as Flask's API and the existing order/notification endpoints.
# Keep this after the specific API routes so they continue to work normally.
@app.route('/<path:react_path>', methods=['GET'])
def react_static_or_route(react_path):
    if not serve_react_on_this_request():
        abort(404)

    # Never route API or private/backend paths to the public React application.
    first_part = react_path.split('/', 1)[0].lower()
    if first_part in ('api', 'backend', 'instance', 'templates', '.git'):
        abort(404)

    candidate = os.path.join(REACT_DIST_DIR, react_path)
    if os.path.isfile(candidate):
        return send_from_directory(REACT_DIST_DIR, react_path)

    if '.' in react_path.rsplit('/', 1)[-1]:
        abort(404)
    return serve_react()



# SmartBasket: browsable, visibility-filtered retailer catalogues.
from store_catalog import register_store_catalog
register_store_catalog(app, Product, filter_catalog_for_viewer)

from shopping_notifications import register_shopping_notifications
register_shopping_notifications(app, db, User, Product, SavedBasket,
                                product_is_adult, product_is_clothing, age_from_date,
                                user_can_see_adult=user_can_see_adult)

from order_price_refresh import refresh_stale_checkout_offers


def refresh_checkout_prices(product_ids):
    """Refresh old catalog prices using the existing retailer scrapers."""
    return refresh_stale_checkout_offers(
        product_ids, Product=Product, PriceHistory=PriceHistory, db=db,
        scrapers={
            'pnp': scrape_pnp,
            'shoprite': scrape_shoprite,
            'checkers': scrape_checkers,
            'woolworths': scrape_woolworths,
        },
        get_cached_data=get_cached_data,
        run_async=run_async,
        logger=app.logger,
    )


from order_features import register_order_features
register_order_features(
    app, db, User, Product, recent_indexed_offer,
    product_is_adult, product_is_clothing, age_from_date,
    refresh_stale_offers=refresh_checkout_prices, user_can_see_adult=user_can_see_adult,
)

from smartbasket_addons import register_smartbasket_addons
register_smartbasket_addons(app, db, User, Product, PriceHistory,
                            product_is_adult, product_is_clothing, age_from_date,
                            user_can_see_adult=user_can_see_adult)['instrument_scrapers'](globals())

from smartbasket_google_auth import register_google_auth
register_google_auth(app, db, User, react_dev_origin)

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
