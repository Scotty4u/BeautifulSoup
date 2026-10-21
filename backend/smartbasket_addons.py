"""SmartBasket 2026 safe add-ons for the existing Flask/SQLAlchemy app.

Register after shopping_notifications and order_features in backend/app.py.
This module adds tables; it never drops or overwrites existing user data.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta
from functools import wraps
from urllib.parse import urlparse, quote

from flask import jsonify, request, session
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from smartbasket_helpers import token_digest, totp_valid, watch_price_triggered


STORES = ('Pick n Pay', 'Shoprite', 'Checkers', 'Woolworths')


def register_smartbasket_addons(app, db, User, Product, PriceHistory, product_is_adult, product_is_clothing, age_from_date, user_can_see_adult=None):
    def adult_allowed(user):
        if callable(user_can_see_adult):
            return bool(user_can_see_adult(user))
        return bool(user.is_admin or (user.date_of_birth and age_from_date(user.date_of_birth) >= 18))

    class AuthSession(db.Model):
        __tablename__ = 'sb_auth_sessions'
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
        token_hash = db.Column(db.String(64), unique=True, nullable=False)
        device_hash = db.Column(db.String(64), nullable=False)
        user_agent = db.Column(db.String(220), nullable=False, default='Unknown device')
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        last_seen_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        expires_at = db.Column(db.DateTime, nullable=False)
        revoked_at = db.Column(db.DateTime, nullable=True)

    class LoginThrottle(db.Model):
        __tablename__ = 'sb_login_throttles'
        key = db.Column(db.String(64), primary_key=True)
        failures = db.Column(db.Integer, nullable=False, default=0)
        window_started = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    class PriceWatch(db.Model):
        __tablename__ = 'sb_price_watches'
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
        product_id = db.Column(db.String(100), db.ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
        target_price = db.Column(db.Float, nullable=True)
        last_notified_price = db.Column(db.Float, nullable=True)
        active = db.Column(db.Boolean, nullable=False, default=True)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        __table_args__ = (db.UniqueConstraint('user_id', 'product_id', name='uq_sb_user_product_watch'),)

    class ScraperHealth(db.Model):
        __tablename__ = 'sb_scraper_health'
        store = db.Column(db.String(40), primary_key=True)
        last_attempt_at = db.Column(db.DateTime)
        last_nonempty_at = db.Column(db.DateTime)
        last_error_at = db.Column(db.DateTime)
        last_error_type = db.Column(db.String(90))
        last_result_count = db.Column(db.Integer, default=0)
        consecutive_errors = db.Column(db.Integer, default=0)
        consecutive_empty = db.Column(db.Integer, default=0)
        total_calls = db.Column(db.Integer, default=0)
        total_errors = db.Column(db.Integer, default=0)
        total_empty = db.Column(db.Integer, default=0)

    with app.app_context():
        db.create_all()  # Creates only missing add-on tables.

    def current_auth():
        token = session.get('sb_auth_token')
        uid = session.get('user_id')
        if not token or not uid:
            return None
        row = AuthSession.query.filter_by(token_hash=token_digest(token), user_id=uid).first()
        if not row or row.revoked_at or row.expires_at <= datetime.utcnow():
            return None
        return row

    def get_current_user():
        if not current_auth():
            return None
        user = db.session.get(User, session['user_id'])
        return user if user and user.is_active else None

    def fingerprint():
        # Approximate browser signature, not a guarantee of a physical device.
        raw = (request.headers.get('User-Agent', '')[:400] + '\n'
               + request.headers.get('Accept-Language', '')[:100])
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()

    def create_session(user):
        device_hash = fingerprint()
        has_prior_device = db.session.query(AuthSession.id).filter_by(user_id=user.id).first() is not None
        recognized = db.session.query(AuthSession.id).filter_by(
            user_id=user.id, device_hash=device_hash).first() is not None
        # Customer sessions coexist. For administrators, a new login revokes
        # other admin sessions to reduce exposure of privileged accounts.
        if user.is_admin:
            AuthSession.query.filter_by(user_id=user.id, revoked_at=None).update(
                {'revoked_at': datetime.utcnow()}, synchronize_session=False)
        raw = secrets.token_urlsafe(48)
        session.permanent = True
        session['sb_auth_token'] = raw
        session['sb_csrf'] = secrets.token_urlsafe(32)
        now = datetime.utcnow()
        ttl = timedelta(hours=8) if user.is_admin else timedelta(days=14)
        db.session.add(AuthSession(user_id=user.id, token_hash=token_digest(raw),
                                  device_hash=device_hash,
                                  user_agent=request.headers.get('User-Agent', 'Unknown device')[:220],
                                  created_at=now, last_seen_at=now, expires_at=now + ttl))
        db.session.commit()
        if has_prior_device and not recognized:
            alerts = app.extensions.get('shopping_notifications')
            if alerts:
                try:
                    alerts['emit'](user.id, 'security_alerts', 'account-security',
                                   f'new-device:{device_hash}',
                                   'A sign-in from a new browser was detected. Review Active Sessions if it was not you.',
                                   '/account/security', force=True)
                    db.session.commit()
                except Exception:
                    db.session.rollback()
                    app.logger.exception('Could not deliver new-device notification')

    def revoke_current():
        row = current_auth()
        if row:
            row.revoked_at = datetime.utcnow()
            db.session.commit()
        session.clear()

    def revoke_all_for_user(user_id, except_session_id=None):
        query = AuthSession.query.filter_by(user_id=user_id, revoked_at=None)
        if except_session_id is not None:
            query = query.filter(AuthSession.id != except_session_id)
        changed = query.update({'revoked_at': datetime.utcnow()}, synchronize_session=False)
        db.session.commit()
        return changed

    def attempt_key(identifier):
        # Never trust arbitrary X-Forwarded-For. request.remote_addr is controlled
        # by the server/proxy configuration. Key includes identifier to avoid a
        # single shared Railway proxy IP locking all customers out.
        salt = app.secret_key.encode('utf-8') if isinstance(app.secret_key, str) else app.secret_key
        data = (request.remote_addr or 'unknown') + '\n' + str(identifier).strip().casefold()
        return hmac.new(salt, data.encode('utf-8'), hashlib.sha256).hexdigest()

    def locked_out(identifier):
        key = attempt_key(identifier)
        row = db.session.get(LoginThrottle, key)
        if not row:
            return False
        if datetime.utcnow() - row.window_started > timedelta(minutes=15):
            db.session.delete(row)
            db.session.commit()
            return False
        return row.failures >= 5

    def failed_login(identifier):
        key = attempt_key(identifier)
        row = db.session.get(LoginThrottle, key)
        now = datetime.utcnow()
        if not row:
            row = LoginThrottle(key=key, failures=0, window_started=now)
            db.session.add(row)
        if now - row.window_started > timedelta(minutes=15):
            row.window_started, row.failures = now, 0
        row.failures += 1
        db.session.commit()

    def successful_login(identifier):
        row = db.session.get(LoginThrottle, attempt_key(identifier))
        if row:
            db.session.delete(row)
            db.session.commit()

    def admin_totp_ok(user, payload):
        if not user.is_admin:
            return True
        secret = os.environ.get('SMARTBASKET_ADMIN_TOTP_SECRET', '').strip()
        if not secret:
            return True  # Optional: see README; configure before deploying admin MFA.
        return totp_valid(secret, str(payload.get('totp_code') or ''))

    @app.before_request
    def enforce_sb_session_and_csrf():
        unsafe = request.method in ('POST', 'PUT', 'PATCH', 'DELETE')
        if unsafe:
            origin = request.headers.get('Origin')
            if origin:
                parsed = urlparse(origin)
                allowed = {request.host.lower()}
                if not app.config.get('SESSION_COOKIE_SECURE'):
                    allowed |= {'localhost:5173', '127.0.0.1:5173'}
                if parsed.scheme not in ('http', 'https') or parsed.netloc.lower() not in allowed:
                    return jsonify(error='Untrusted request origin.'), 403
            if request.headers.get('Sec-Fetch-Site') == 'cross-site':
                return jsonify(error='Cross-site requests are not permitted.'), 403
        uid = session.get('user_id')
        if not uid:
            return None
        if request.path in ('/login', '/signup'):
            return None
        auth = current_auth()
        if not auth:
            session.clear()
            if request.path.startswith('/api/'):
                return jsonify(error='Session expired. Please sign in again.', authenticated=False,
                               code='SESSION_EXPIRED'), 401
            return None  # Public pages remain accessible to signed-out visitors.
        if unsafe and request.path.startswith('/api/'):
            supplied = request.headers.get('X-SmartBasket-CSRF', '')
            expected = session.get('sb_csrf', '')
            if not expected or not hmac.compare_digest(supplied, expected):
                return jsonify(error='Security token missing. Refresh and retry.', code='CSRF_FAILED'), 403
        if auth.last_seen_at < datetime.utcnow() - timedelta(minutes=5):
            auth.last_seen_at = datetime.utcnow()
            db.session.commit()
        return None

    @app.after_request
    def set_sb_csrf_cookie(response):
        if session.get('user_id') and session.get('sb_auth_token') and session.get('sb_csrf'):
            response.set_cookie('sb_csrf', session['sb_csrf'], secure=app.config.get('SESSION_COOKIE_SECURE', False),
                                httponly=False, samesite='Lax', path='/')
        else:
            response.delete_cookie('sb_csrf', path='/')
        if request.path.startswith('/api/security/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/security/sessions')
    def list_auth_sessions():
        user = get_current_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        current = current_auth()
        rows = AuthSession.query.filter_by(user_id=user.id, revoked_at=None).order_by(
            AuthSession.last_seen_at.desc()).all()
        now = datetime.utcnow()
        return jsonify([{
            'id': row.id, 'device': row.user_agent or 'Unknown browser',
            'created_at': row.created_at.isoformat() + 'Z',
            'last_seen_at': row.last_seen_at.isoformat() + 'Z',
            'expires_at': row.expires_at.isoformat() + 'Z',
            'current': row.id == current.id,
        } for row in rows if row.expires_at > now])

    @app.delete('/api/security/sessions/<int:session_id>')
    def revoke_auth_session(session_id):
        user = get_current_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        row = AuthSession.query.filter_by(id=session_id, user_id=user.id).first()
        if not row:
            return jsonify(error='Session not found.'), 404
        is_current = row.id == current_auth().id
        if not row.revoked_at:
            row.revoked_at = datetime.utcnow()
            db.session.commit()
        if is_current:
            session.clear()
        return jsonify(success=True, logged_out=is_current)

    @app.delete('/api/security/sessions/others')
    def revoke_other_auth_sessions():
        user = get_current_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        changed = revoke_all_for_user(user.id, except_session_id=current_auth().id)
        return jsonify(success=True, revoked=changed)

    @app.delete('/api/security/sessions/all')
    def revoke_every_auth_session():
        user = get_current_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        changed = revoke_all_for_user(user.id)
        session.clear()
        return jsonify(success=True, revoked=changed, logged_out=True)

    @app.post('/api/security/change-password')
    def change_account_password():
        user = get_current_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        payload = request.get_json(silent=True) or {}
        old, new = payload.get('current_password'), payload.get('new_password')
        if not isinstance(old, str) or not check_password_hash(user.password_hash, old):
            return jsonify(error='Current password is incorrect.'), 403
        if not isinstance(new, str) or len(new) < 12 or len(new) > 128 or new == old:
            return jsonify(error='Choose a different password of 12–128 characters.'), 400
        user.password_hash = generate_password_hash(new)
        db.session.commit()
        changed = revoke_all_for_user(user.id, except_session_id=current_auth().id)
        return jsonify(success=True, other_sessions_revoked=changed)

    @app.get('/api/price-watches/<path:product_id>')
    def get_price_watch(product_id):
        user = get_current_user()
        if not user:
            return jsonify(watching=False, authenticated=False)
        row = PriceWatch.query.filter_by(user_id=user.id, product_id=product_id).first()
        return jsonify(watching=bool(row and row.active), target_price=row.target_price if row and row.active else None)

    @app.post('/api/price-watches/<path:product_id>')
    def set_price_watch(product_id):
        user = get_current_user()
        if not user:
            return jsonify(error='Please sign in to follow a price.'), 401
        product = db.session.get(Product, product_id)
        if not product or product_is_clothing(product) or (
            product_is_adult(product) and not (adult_allowed(user))
        ):
            return jsonify(error='Product not found.'), 404
        payload = request.get_json(silent=True) or {}
        target = payload.get('target_price')
        if target in ('', None):
            target = None
        else:
            try:
                target = float(target)
            except (ValueError, TypeError, OverflowError):
                return jsonify(error='Enter a valid target price.'), 400
            if not 0 < target < 1000000 or not __import__('math').isfinite(target):
                return jsonify(error='Enter a valid target price.'), 400
        row = PriceWatch.query.filter_by(user_id=user.id, product_id=product_id).first()
        if not row:
            row = PriceWatch(user_id=user.id, product_id=product_id)
            db.session.add(row)
        row.target_price, row.active, row.last_notified_price = target, True, None
        db.session.commit()
        return jsonify(watching=True, target_price=target)

    @app.delete('/api/price-watches/<path:product_id>')
    def remove_price_watch(product_id):
        user = get_current_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        row = PriceWatch.query.filter_by(user_id=user.id, product_id=product_id).first()
        if row:
            row.active = False
            db.session.commit()
        return jsonify(watching=False)

    def process_price_changes(changes):
        """Call after a *successful* product/history commit, only on actual drops.

        changes = [(product_id, previous_price, new_price), ...].
        Existing global saved-list price alerts remain separate.
        """
        alerts = app.extensions.get('shopping_notifications')
        if not alerts:
            return
        for product_id, before, after in changes:
            watches = PriceWatch.query.filter_by(product_id=product_id, active=True).all()
            for watch in watches:
                if not watch_price_triggered(before, after, watch.target_price, watch.last_notified_price):
                    continue
                user = db.session.get(User, watch.user_id)
                if not user or not user.is_active:
                    continue
                product = db.session.get(Product, product_id)
                if not product or product_is_clothing(product) or (
                    product_is_adult(product) and not (adult_allowed(user))
                ):
                    continue
                try:
                    alerts['emit'](user.id, 'price_drops', f'watch:{product_id}',
                                   f'watch:{product_id}:{after:.2f}',
                                   f'{product.name[:90]} at {product.store} dropped from R {before:.2f} to R {after:.2f}. Confirm the retailer price.',
                                   f'/product/{quote(product_id, safe="")}', force=True)
                    watch.last_notified_price = after
                    db.session.commit()
                except Exception:
                    db.session.rollback()
                    app.logger.exception('Price watch notification failed')

    def record_scraper(store, count, error=None):
        try:
            with app.app_context():
                row = db.session.get(ScraperHealth, store)
                if not row:
                    row = ScraperHealth(store=store)
                    db.session.add(row)
                now = datetime.utcnow()
                row.last_attempt_at = now
                row.last_result_count = count
                row.total_calls = (row.total_calls or 0) + 1
                if error:
                    row.last_error_at = now
                    row.last_error_type = type(error).__name__
                    row.total_errors = (row.total_errors or 0) + 1
                    row.consecutive_errors = (row.consecutive_errors or 0) + 1
                    row.consecutive_empty = 0
                elif count == 0:
                    row.total_empty = (row.total_empty or 0) + 1
                    row.consecutive_empty = (row.consecutive_empty or 0) + 1
                    row.consecutive_errors = 0
                else:
                    row.last_nonempty_at = now
                    row.consecutive_errors = 0
                    row.consecutive_empty = 0
                db.session.commit()
                if error and row.consecutive_errors == 3:
                    alerts = app.extensions.get('shopping_notifications')
                    if alerts:
                        for admin in User.query.filter_by(is_admin=True, is_active=True).all():
                            alerts['emit'](admin.id, 'security_alerts', f'scraper:{store}',
                                           f'scraper:{store}:{now.strftime("%Y-%m-%d-%H")}',
                                           f'{store} scraper has failed 3 times in a row. Check scraper health.',
                                           '/admin', force=True)
                        db.session.commit()
        except Exception:
            db.session.rollback()
            app.logger.exception('Could not record scraper health for %s', store)

    def instrument_scrapers(module_globals):
        """Wrap existing async scraper functions; never change returned products."""
        for name, store in (('scrape_pnp', 'Pick n Pay'), ('scrape_shoprite', 'Shoprite'),
                            ('scrape_checkers', 'Checkers'), ('scrape_woolworths', 'Woolworths')):
            original = module_globals.get(name)
            if not original or getattr(original, '_sb_instrumented', False):
                continue
            def make_wrapper(fn, retailer):
                @wraps(fn)
                async def wrapper(*args, **kwargs):
                    try:
                        result = await fn(*args, **kwargs)
                    except Exception as exc:
                        record_scraper(retailer, 0, exc)
                        raise
                    record_scraper(retailer, len(result) if isinstance(result, (list, tuple)) else 0)
                    return result
                wrapper._sb_instrumented = True
                return wrapper
            module_globals[name] = make_wrapper(original, store)

    @app.get('/api/admin/scraper-health')
    def admin_scraper_health():
        user = get_current_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        if not user.is_admin:
            return jsonify(error='Forbidden.'), 403
        output = []
        now = datetime.utcnow()
        for store in STORES:
            row = db.session.get(ScraperHealth, store)
            if not row:
                output.append({'store': store, 'status': 'not_checked', 'message': 'No scraper calls recorded yet.'})
                continue
            if (row.consecutive_errors or 0) >= 3:
                status = 'error'
            elif (row.consecutive_empty or 0) >= 5:
                status = 'warning'
            elif not row.last_nonempty_at or now - row.last_nonempty_at > timedelta(hours=48):
                status = 'stale'
            else:
                status = 'ok'
            output.append({
                'store': store, 'status': status,
                'last_attempt_at': row.last_attempt_at.isoformat() + 'Z' if row.last_attempt_at else None,
                'last_nonempty_at': row.last_nonempty_at.isoformat() + 'Z' if row.last_nonempty_at else None,
                'last_error_at': row.last_error_at.isoformat() + 'Z' if row.last_error_at else None,
                'last_error_type': row.last_error_type,
                'last_result_count': row.last_result_count or 0,
                'consecutive_errors': row.consecutive_errors or 0,
                'consecutive_empty': row.consecutive_empty or 0,
                'total_calls': row.total_calls or 0,
            })
        return jsonify(output)

    app.extensions['smartbasket_addons'] = {
        'create_session': create_session, 'revoke_current': revoke_current,
        'revoke_all_for_user': revoke_all_for_user,
        'locked_out': locked_out, 'failed_login': failed_login,
        'successful_login': successful_login, 'admin_totp_ok': admin_totp_ok,
        'process_price_changes': process_price_changes,
        'instrument_scrapers': instrument_scrapers,
    }
    return app.extensions['smartbasket_addons']
