"""Persistent in-app shopping alerts. Checks use indexed prices, never network scraping."""
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from flask import jsonify, request, session
from sqlalchemy.exc import IntegrityError

DEFAULTS = {'price_drops': False, 'basket_savings': False, 'order_updates': True,
            'list_activity': True, 'reminders': False}


def amount(value):
    try:
        result = Decimal(str(value))
        return result.quantize(Decimal('0.01')) if result.is_finite() and result > 0 else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def register_shopping_notifications(app, db, User, Product, SavedBasket, product_is_adult, product_is_clothing, age_from_date, user_can_see_adult=None):
    class AlertPreferences(db.Model):
        __tablename__ = 'shopping_alert_preferences'
        user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
        options = db.Column(db.JSON, nullable=False, default=dict)
        checked_at = db.Column(db.DateTime)
        reminder_at = db.Column(db.DateTime)

    class ShoppingAlert(db.Model):
        __tablename__ = 'shopping_alerts'
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
        kind = db.Column(db.String(30), nullable=False)
        group_key = db.Column(db.String(160), nullable=False)
        dedupe_key = db.Column(db.String(220), nullable=False)
        message = db.Column(db.String(500), nullable=False)
        url = db.Column(db.String(220), nullable=False)
        unread = db.Column(db.Boolean, default=True, nullable=False)
        created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
        __table_args__ = (db.UniqueConstraint('user_id', 'dedupe_key', name='uq_shopping_alert_dedupe'),)

    with app.app_context():
        db.create_all()

    def preferences(uid):
        row = db.session.get(AlertPreferences, uid)
        return {**DEFAULTS, **(row.options or {})} if row else dict(DEFAULTS)

    def emit(uid, kind, group_key, dedupe_key, message, url):
        if not preferences(uid).get(kind, False):
            return
        if ShoppingAlert.query.filter_by(user_id=uid, dedupe_key=dedupe_key).first():
            return
        # Savepoint prevents concurrent polling from rolling back another action.
        try:
            with db.session.begin_nested():
                ShoppingAlert.query.filter_by(user_id=uid, group_key=group_key, unread=True).update({'unread': False})
                db.session.add(ShoppingAlert(user_id=uid, kind=kind, group_key=group_key,
                    dedupe_key=dedupe_key, message=message[:500], url=url))
                db.session.flush()
        except IntegrityError:
            pass

    def order_event(order, cancelled=False):
        action = 'cancelled' if cancelled else 'saved'
        emit(order.user_id, 'order_updates', f'order:{order.id}', f'order:{order.id}:{action}',
             f'Order #{order.id} with {order.retailer or "your selected stores"} was {action}. This is a simulated order.',
             '/account/orders')

    def tick(uid):
        user = db.session.get(User, uid)
        if not user or not user.is_active:
            return
        opts = preferences(uid)
        if not any(opts[k] for k in ('price_drops', 'basket_savings', 'reminders')):
            return
        now = datetime.utcnow()
        row = db.session.get(AlertPreferences, uid)
        if not row:
            return  # Optional alerts must first be enabled in preferences.
        # Atomic claim across workers. Concurrent page/bell polls do not duplicate work.
        claimed = AlertPreferences.query.filter(AlertPreferences.user_id == uid,
            db.or_(AlertPreferences.checked_at.is_(None), AlertPreferences.checked_at < now - timedelta(minutes=5))).update({'checked_at': now}, synchronize_session=False)
        if not claimed:
            return
        db.session.commit()
        adult = bool(user_can_see_adult(user)) if callable(user_can_see_adult) else bool(
            user.is_admin or (user.date_of_birth and age_from_date(user.date_of_birth) >= 18))
        def visible(product):
            return product and not product_is_clothing(product) and (adult or not product_is_adult(product))
        def fresh(product):
            return visible(product) and product.last_updated and product.last_updated >= now - timedelta(hours=48) and amount(product.price)
        baskets = SavedBasket.query.filter_by(user_id=uid).all()
        for basket in baskets:
            lines = list(basket.items)
            if opts['price_drops']:
                for line in lines:
                    product = line.product
                    before = amount(line.price)
                    after = fresh(product)
                    if before and after and after < before:
                        emit(uid, 'price_drops', f'price:{product.id}', f'price:{product.id}:{before}:{after}',
                             f'A saved product at {product.store} dropped from R {before:.2f} to R {after:.2f}. Latest indexed price; confirm at the retailer.',
                             f'/saved/{basket.id}')
            # Barcode-only comparison: no fuzzy substitutions, no partial baskets.
            if opts['basket_savings'] and lines and all(fresh(line.product) and amount(line.price) and str(line.product.barcode or '').isdigit() and len(str(line.product.barcode)) in (8, 12, 13, 14) for line in lines):
                codes = {line.product.barcode for line in lines}
                candidates = Product.query.filter(Product.barcode.in_(codes)).all()
                stores = {}
                for product in candidates:
                    price = fresh(product)
                    if not price or product.store not in {'Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths'}:
                        continue
                    prices = stores.setdefault(product.store, {})
                    prices[product.barcode] = min(prices.get(product.barcode, price), price)
                baseline = sum(amount(line.price) * max(1, line.quantity or 1) for line in lines)
                totals = [(sum(prices[line.product.barcode] * max(1, line.quantity or 1) for line in lines), store)
                          for store, prices in stores.items() if codes <= prices.keys()
                          and not all(line.product.store == store for line in lines)]
                if totals:
                    total, store = min(totals)
                    if total < baseline:
                        emit(uid, 'basket_savings', f'basket-savings:{basket.id}', f'basket-savings:{basket.id}:{store}:{baseline}:{total}',
                             f'{store} has an estimated total of R {total:.2f} for your saved list, R {baseline-total:.2f} below its saved prices. Exact barcodes only; excludes delivery.',
                             f'/saved/{basket.id}')
        if opts['reminders'] and baskets:
            row = db.session.get(AlertPreferences, uid)
            if row.reminder_at and row.reminder_at <= now - timedelta(days=7):
                emit(uid, 'reminders', 'shopping-reminder', f'reminder:{now.date().isoformat()}',
                     'Time to review your grocery lists for this week.', '/saved')
                row.reminder_at = now
        db.session.commit()

    def inbox(uid):
        tick(uid)
        return [{'id': f'alert-{a.id}', 'message': a.message, 'basket_id': None,
                 'group_key': a.group_key, 'status': 'unread' if a.unread else 'read',
                 'type': a.kind, 'date': a.created_at.strftime('%Y-%m-%d %H:%M'),
                 'url': a.url} for a in ShoppingAlert.query.filter_by(user_id=uid).order_by(ShoppingAlert.created_at.desc(), ShoppingAlert.id.desc()).limit(150).all()]

    def count(uid):
        tick(uid)
        return db.session.query(db.func.count(db.distinct(ShoppingAlert.group_key))).filter(ShoppingAlert.user_id == uid, ShoppingAlert.unread.is_(True)).scalar() or 0

    def mark_all(uid):
        ShoppingAlert.query.filter_by(user_id=uid, unread=True).update({'unread': False})

    def active_user():
        user = db.session.get(User, session.get('user_id')) if session.get('user_id') else None
        return user if user and user.is_active else None

    @app.route('/api/notifications/preferences', methods=['GET', 'PUT'])
    def shopping_notification_preferences():
        user = active_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        if request.method == 'PUT':
            data = request.get_json(silent=True)
            if not isinstance(data, dict) or any(k not in DEFAULTS or type(v) is not bool for k, v in data.items()):
                return jsonify(error='Invalid notification preferences.'), 400
            row = db.session.get(AlertPreferences, user.id)
            if not row:
                row = AlertPreferences(user_id=user.id, options={})
                db.session.add(row)
            previous = preferences(user.id)
            row.options = {**previous, **data}
            if row.options['reminders'] and not previous['reminders']:
                row.reminder_at = datetime.utcnow()
            row.checked_at = None
            db.session.commit()
        return jsonify(preferences(user.id))

    @app.post('/api/notifications/alerts/<int:alert_id>/read')
    def read_shopping_alert(alert_id):
        user = active_user()
        if not user:
            return jsonify(error='Please sign in.'), 401
        alert = ShoppingAlert.query.filter_by(id=alert_id, user_id=user.id).first()
        if not alert:
            return jsonify(error='Notification not found.'), 404
        ShoppingAlert.query.filter_by(user_id=user.id, group_key=alert.group_key).update({'unread': False})
        db.session.commit()
        return jsonify(success=True)

    app.extensions['shopping_notifications'] = dict(preferences=preferences, emit=emit, order_event=order_event, inbox=inbox, count=count, mark_all=mark_all)