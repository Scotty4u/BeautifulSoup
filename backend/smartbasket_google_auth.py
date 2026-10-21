"""SmartBasket Google OpenID Connect authentication.

Install after SmartBasket's existing session add-on is registered in app.py.
New users are created as ordinary, non-admin accounts. No existing user is
linked merely because Google reports a matching email address.
"""
from __future__ import annotations

import os
import re
import secrets
from datetime import datetime
from urllib.parse import urlparse

from flask import redirect, request, session, url_for
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash
from authlib.integrations.flask_client import OAuth


def register_google_auth(app, db, User, react_dev_origin):
    """Register Google login/link routes and additive database table."""
    class GoogleIdentity(db.Model):
        __tablename__ = 'sb_google_identities'
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True)
        google_sub = db.Column(db.String(255), nullable=False, unique=True, index=True)
        email_at_link = db.Column(db.String(120), nullable=False)
        linked_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    with app.app_context():
        db.create_all()  # Only creates the new table if missing; never drops data.

    client_id = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
    client_secret = os.environ.get('GOOGLE_CLIENT_SECRET', '').strip()
    oauth = OAuth(app)
    google = None
    if client_id and client_secret:
        google = oauth.register(
            'google',
            client_id=client_id,
            client_secret=client_secret,
            server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
            client_kwargs={'scope': 'openid email profile'},
        )

    def page(path):
        """Known internal paths only; never forward untrusted 'next' URLs."""
        return f'{react_dev_origin()}{path}'

    def callback_url():
        """Use configured public HTTPS URL so Railway proxy headers cannot affect redirects."""
        public_url = os.environ.get('SMARTBASKET_PUBLIC_URL', '').strip().rstrip('/')
        if public_url:
            parts = urlparse(public_url)
            if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.path not in ('', '/'):
                raise RuntimeError('SMARTBASKET_PUBLIC_URL must be an HTTPS origin without a path')
            return f'{public_url}/auth/google/callback'
        # Local development needs the backend port, not the Vite port.
        if app.config.get('SESSION_COOKIE_SECURE'):
            raise RuntimeError('Set SMARTBASKET_PUBLIC_URL to your HTTPS Railway domain')
        return 'http://localhost:5000/auth/google/callback'

    def choose_username(email):
        local = email.split('@', 1)[0]
        stem = re.sub(r'[^a-z0-9_]+', '_', local.casefold()).strip('_')[:34]
        if len(stem) < 3:
            stem = 'google_user'
        # Random suffix makes it extremely unlikely to collide with an existing
        # user. Keep usernames below SmartBasket's existing 80-character limit.
        for _ in range(8):
            candidate = f'{stem}_{secrets.token_hex(5)}'
            if not User.query.filter_by(username=candidate).first():
                return candidate
        raise RuntimeError('Could not select an unused username')

    @app.get('/auth/google')
    def google_login_start():
        if google is None:
            return redirect(page('/login?google=unavailable'), code=303)
        if session.get('user_id'):
            return redirect(page('/account?google=already_signed_in'), code=303)
        session['sb_google_intent'] = 'login'
        try:
            return google.authorize_redirect(callback_url())
        except Exception:
            app.logger.exception('Google OAuth start failed')
            return redirect(page('/login?google=configuration'), code=303)

    @app.get('/auth/google/link')
    def google_link_start():
        """Link an existing password account only after a valid login session."""
        if google is None:
            return redirect(page('/account?google=unavailable'), code=303)
        uid = session.get('user_id')
        user = db.session.get(User, uid) if uid else None
        if user is None or not user.is_active:
            return redirect(page('/login?google=sign_in_first'), code=303)
        if user.is_admin:
            return redirect(page('/account?google=admin_disabled'), code=303)
        if GoogleIdentity.query.filter_by(user_id=uid).first():
            return redirect(page('/account?google=already_linked'), code=303)
        session['sb_google_intent'] = 'link'
        session['sb_google_link_user'] = uid
        try:
            return google.authorize_redirect(callback_url())
        except Exception:
            app.logger.exception('Google OAuth linking failed to start')
            return redirect(page('/account?google=configuration'), code=303)

    @app.get('/auth/google/callback')
    def google_callback():
        if google is None:
            return redirect(page('/login?google=unavailable'), code=303)
        intent = session.get('sb_google_intent')
        if intent not in ('login', 'link'):
            return redirect(page('/login?google=failed'), code=303)
        # Authlib checks the signed session's OAuth state and verifies the OIDC
        # ID token using Google's keys and the configured client ID.
        try:
            token = google.authorize_access_token()
            info = token.get('userinfo')
            if not info:
                raise ValueError('Missing verified OpenID Connect userinfo')
            sub = str(info.get('sub') or '').strip()
            email = str(info.get('email') or '').strip().lower()
            verified = info.get('email_verified') is True
            if not sub or len(sub) > 255 or not verified or not email or len(email) > 120:
                raise ValueError('Google identity has no verified email or subject')
        except Exception:
            app.logger.warning('Google OpenID Connect verification failed', exc_info=True)
            session.pop('sb_google_intent', None)
            session.pop('sb_google_link_user', None)
            return redirect(page('/login?google=failed' if intent == 'login' else '/account?google=failed'), code=303)

        session.pop('sb_google_intent', None)
        bound_uid = session.pop('sb_google_link_user', None)
        identity = GoogleIdentity.query.filter_by(google_sub=sub).first()

        if intent == 'link':
            uid = session.get('user_id')
            user = db.session.get(User, uid) if uid else None
            if (not user or not user.is_active or user.is_admin or uid != bound_uid):
                return redirect(page('/login?google=sign_in_first'), code=303)
            # Requiring the same verified email prevents accidental linking to
            # somebody else's Google account on a shared computer.
            if user.email.casefold() != email:
                return redirect(page('/account?google=email_mismatch'), code=303)
            if identity and identity.user_id != uid:
                return redirect(page('/account?google=already_used'), code=303)
            if not identity:
                if GoogleIdentity.query.filter_by(user_id=uid).first():
                    return redirect(page('/account?google=already_linked'), code=303)
                try:
                    db.session.add(GoogleIdentity(user_id=uid, google_sub=sub, email_at_link=email))
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
                    return redirect(page('/account?google=already_used'), code=303)
            return redirect(page('/account?google=linked'), code=303)

        if identity:
            user = db.session.get(User, identity.user_id)
            if user is None or not user.is_active:
                return redirect(page('/login?google=disabled'), code=303)
            if user.is_admin:
                # An admin must use SmartBasket's password + authenticator flow.
                return redirect(page('/login?google=admin_disabled'), code=303)
        else:
            # Do NOT automatically link by matching email; this preserves the
            # existing account's own login credentials and security boundary.
            if User.query.filter(db.func.lower(User.email) == email).first():
                return redirect(page('/login?google=link_required'), code=303)
            user = User(
                username=choose_username(email),
                email=email,
                password_hash=generate_password_hash(secrets.token_urlsafe(64)),
                is_admin=False,
                is_active=True,
            )
            try:
                db.session.add(user)
                db.session.flush()
                db.session.add(GoogleIdentity(user_id=user.id, google_sub=sub, email_at_link=email))
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return redirect(page('/login?google=link_required'), code=303)

        # Reuse SmartBasket's same database-backed, revocable login sessions,
        # instead of inventing another cookie/token or adding OAuth tokens to it.
        session.clear()
        session['user_id'] = user.id
        session['username'] = user.username
        session['is_admin'] = False
        app.extensions['smartbasket_addons']['create_session'](user)
        return redirect(page('/account'), code=303)

    return {'GoogleIdentity': GoogleIdentity}
