"""Additive SmartBasket simulated checkout, savings and admin reporting module.

A placed plan is NOT a retailer order, payment, delivery request or confirmed purchase.
Product prices are resolved on the SERVER from recently indexed scraper listings.
"""
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from collections import Counter, defaultdict
from functools import wraps
import re
import uuid
import json
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from store_locations import available_collection_branches

from flask import Blueprint, jsonify, request, session
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError


def register_order_features(app, db, User, Product, recent_indexed_offer,
                            product_is_adult, product_is_clothing, age_from_date,
                            refresh_stale_offers=None, user_can_see_adult=None):
    if 'smartbasket_orders' in app.blueprints:
        return

    class DeliveryAddress(db.Model):
        __tablename__ = 'delivery_addresses'
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
        label = db.Column(db.String(60), nullable=False, default='Home')
        recipient = db.Column(db.String(100), nullable=False)
        phone = db.Column(db.String(25), nullable=False)
        street = db.Column(db.String(180), nullable=False)
        suburb = db.Column(db.String(100), nullable=False)
        city = db.Column(db.String(100), nullable=False)
        province = db.Column(db.String(80), nullable=False)
        postal_code = db.Column(db.String(12), nullable=False)
        notes = db.Column(db.String(250), nullable=False, default='')
        created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    class ShoppingOrder(db.Model):
        __tablename__ = 'shopping_orders'
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
        address_id = db.Column(db.Integer, db.ForeignKey('delivery_addresses.id'), nullable=False)
        request_id = db.Column(db.String(80), nullable=False)
        status = db.Column(db.String(32), nullable=False, default='simulated_placed')
        retailer = db.Column(db.String(50), nullable=True)  # None for legacy orders
        fulfillment_type = db.Column(db.String(16), nullable=False, default='delivery')
        pickup_branch = db.Column(db.String(120), nullable=False, default='')
        total = db.Column(db.Numeric(12, 2), nullable=False)
        estimated_savings = db.Column(db.Numeric(12, 2), nullable=True)
        baseline_total = db.Column(db.Numeric(12, 2), nullable=True)
        baseline_retailer = db.Column(db.String(50), nullable=True)
        address_snapshot = db.Column(db.JSON, nullable=False)
        placed_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
        __table_args__ = (db.UniqueConstraint('user_id', 'request_id', name='uq_order_request_user'),)
        lines = db.relationship('ShoppingOrderLine', backref='order', cascade='all, delete-orphan', lazy=True)

    class ShoppingOrderLine(db.Model):
        __tablename__ = 'shopping_order_lines'
        id = db.Column(db.Integer, primary_key=True)
        order_id = db.Column(db.Integer, db.ForeignKey('shopping_orders.id'), nullable=False, index=True)
        product_id = db.Column(db.String(100), nullable=False)
        product_name = db.Column(db.String(255), nullable=False)
        retailer = db.Column(db.String(50), nullable=False)
        image_url = db.Column(db.Text, nullable=True)
        quantity = db.Column(db.Integer, nullable=False)
        unit_price = db.Column(db.Numeric(12, 2), nullable=False)
        line_total = db.Column(db.Numeric(12, 2), nullable=False)

    class ShoppingOrderEvent(db.Model):
        __tablename__ = 'shopping_order_events'
        id = db.Column(db.Integer, primary_key=True)
        order_id = db.Column(db.Integer, db.ForeignKey('shopping_orders.id'), nullable=False, index=True)
        status = db.Column(db.String(32), nullable=False)
        created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    with app.app_context():
        db.create_all()   # never drops existing data
        if 'retailer' not in {column['name'] for column in inspect(db.engine).get_columns('shopping_orders')}:
            # Existing installations created this table before retailer choice was added.
            db.session.execute(text('ALTER TABLE shopping_orders ADD COLUMN retailer VARCHAR(50)'))
            db.session.commit()

        # Additive migrations: no table resets or destructive SQLite rewrites.
        existing_order_columns = {c['name'] for c in inspect(db.engine).get_columns('shopping_orders')}
        if 'fulfillment_type' not in existing_order_columns:
            db.session.execute(text("ALTER TABLE shopping_orders ADD COLUMN fulfillment_type VARCHAR(16) NOT NULL DEFAULT 'delivery'"))
            db.session.commit()
        if 'pickup_branch' not in existing_order_columns:
            db.session.execute(text("ALTER TABLE shopping_orders ADD COLUMN pickup_branch VARCHAR(120) NOT NULL DEFAULT ''"))
            db.session.commit()

        if 'image_url' not in {column['name'] for column in inspect(db.engine).get_columns('shopping_order_lines')}:
            db.session.execute(text('ALTER TABLE shopping_order_lines ADD COLUMN image_url TEXT'))
            db.session.commit()

    def adult_allowed(user):
        if callable(user_can_see_adult):
            return bool(user_can_see_adult(user))
        return bool(user.is_admin or (user.date_of_birth and age_from_date(user.date_of_birth) >= 18))

    bp = Blueprint('smartbasket_orders', __name__)
    supported = {'Pick n Pay', 'Shoprite', 'Checkers', 'Woolworths'}
    # Compatibility with existing Railway SQLite: shopping_orders.address_id has a
    # NOT NULL constraint. Keep one invisible, empty reference address per user
    # for collection plans rather than destructively rebuilding their order table.
    COLLECTION_ADDRESS_LABEL = '__smartbasket_collection_only__'
    provinces = {'Eastern Cape', 'Western Cape', 'Northern Cape', 'Gauteng',
                 'KwaZulu-Natal', 'Free State', 'North West', 'Limpopo', 'Mpumalanga'}
    # Admin-only status transitions; simulated, NOT real courier/supermarket updates.
    transitions = {
        'simulated_placed': ('simulated_confirmed', 'simulated_cancelled'),
        'simulated_confirmed': ('simulated_preparing', 'simulated_cancelled'),
        'simulated_preparing': ('simulated_out_for_delivery', 'simulated_ready_for_collection', 'simulated_cancelled'),
        'simulated_out_for_delivery': ('simulated_delivered',),
        'simulated_ready_for_collection': ('simulated_collected',),
        'simulated_delivered': (), 'simulated_collected': (), 'simulated_cancelled': (),
    }

    def allowed_next(order):
        choices = transitions.get(order.status, ())
        mode = order.fulfillment_type or 'delivery'
        return [item for item in choices
                if not (item == 'simulated_out_for_delivery' and mode != 'delivery')
                and not (item == 'simulated_ready_for_collection' and mode != 'collection')]

    def currency(value):
        return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    def money(value):
        return float(currency(value))

    def current_user():
        uid = session.get('user_id')
        if not uid:
            return None
        user = db.session.get(User, uid)
        return user if user and user.is_active else None

    def login_required(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not current_user():
                return jsonify(error='Sign in to use orders and shopping insights.', code='LOGIN_REQUIRED'), 401
            return fn(*args, **kwargs)
        return wrapped

    def admin_required(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = current_user()
            if not user:
                return jsonify(error='Sign in first.'), 401
            if not user.is_admin:
                return jsonify(error='Administrator access required.'), 403
            return fn(*args, **kwargs)
        return wrapped

    def address_json(a):
        return {key: getattr(a, key) for key in (
            'id', 'label', 'recipient', 'phone', 'street', 'suburb',
            'city', 'province', 'postal_code', 'notes')}

    def address_form(data):
        mandatory = ['recipient', 'phone', 'street', 'suburb', 'city', 'province', 'postal_code']
        limits = {'recipient': 100, 'phone': 25, 'street': 180, 'suburb': 100,
                  'city': 100, 'province': 80, 'postal_code': 12, 'notes': 250, 'label': 60}
        if not isinstance(data, dict):
            raise ValueError('Provide a valid delivery address.')
        fields = {k: str(data.get(k) or '').strip() for k in limits}
        if any(not fields[k] for k in mandatory):
            raise ValueError('Complete all delivery address fields.')
        if any(len(value) > limits[key] for key, value in fields.items()):
            raise ValueError('A delivery address field is too long.')
        if fields['province'] not in provinces:
            raise ValueError('Choose a valid South African province.')
        if not re.fullmatch(r'\d{4}', fields['postal_code']):
            raise ValueError('South African postal codes must be four digits.')
        if not re.fullmatch(r'[+0-9()\s-]{7,25}', fields['phone']):
            raise ValueError('Enter a valid phone number.')
        fields['label'] = fields['label'] or 'Home'
        if fields['label'].casefold() == COLLECTION_ADDRESS_LABEL.casefold():
            raise ValueError('This address label is reserved.')
        return fields

    def collection_reference_address(user):
        # The placeholder is never returned to /api/orders/addresses and never
        # presented as a real street address to the customer or admins.
        address = DeliveryAddress.query.filter_by(user_id=user.id, label=COLLECTION_ADDRESS_LABEL).first()
        if address:
            return address
        address = DeliveryAddress(
            user_id=user.id, label=COLLECTION_ADDRESS_LABEL,
            recipient='', phone='', street='', suburb='', city='',
            province='', postal_code='', notes=''
        )
        db.session.add(address)
        db.session.flush()
        return address

    def serialize(order, include_lines=True):
        value = {
            'id': order.id, 'status': order.status, 'retailer': order.retailer, 'placedAt': order.placed_at.isoformat() + 'Z',
            'fulfillmentType': order.fulfillment_type or 'delivery', 'pickupBranch': order.pickup_branch or '',
            'nextStatuses': allowed_next(order),
            'timeline': [{'status': event.status, 'createdAt': event.created_at.isoformat() + 'Z'}
                         for event in ShoppingOrderEvent.query.filter_by(order_id=order.id)
                         .order_by(ShoppingOrderEvent.created_at, ShoppingOrderEvent.id).all()],
            'total': money(order.total),
            'estimatedSavings': money(order.estimated_savings) if order.estimated_savings is not None else None,
            'baselineTotal': money(order.baseline_total) if order.baseline_total is not None else None,
            'baselineRetailer': order.baseline_retailer,
            'address': order.address_snapshot,
            'itemCount': sum(line.quantity for line in order.lines),
            'isSimulated': True,
        }
        if include_lines:
            # Older plans have no image snapshot. Resolve their catalogue images
            # in one query per order without requiring a fresh price or scraper cache.
            missing_ids = {line.product_id for line in order.lines if not line.image_url}
            legacy_images = {
                product.id: product.image_url or ''
                for product in Product.query.filter(Product.id.in_(missing_ids)).all()
            } if missing_ids else {}
            value['items'] = [{'id': line.product_id, 'name': line.product_name,
                               'store': line.retailer, 'imageUrl': line.image_url or legacy_images.get(line.product_id, ''),
                               'quantity': line.quantity,
                               'unitPrice': money(line.unit_price), 'subtotal': money(line.line_total)}
                              for line in order.lines]
        return value

    def normalize_lines(items):
        if not isinstance(items, list) or not 1 <= len(items) <= 40:
            raise ValueError('Your basket must contain between 1 and 40 products.')
        combined = {}
        for raw in items:
            if not isinstance(raw, dict) or not isinstance(raw.get('id'), (str, int)):
                raise ValueError('Every basket line must specify a valid product ID.')
            pid = str(raw['id']).strip()
            if not 1 <= len(pid) <= 100 or not re.fullmatch(r'[\w-]+', pid):
                raise ValueError('Invalid product ID.')
            qty = raw.get('quantity', 1)
            if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= 99:
                raise ValueError('Product quantities must be whole numbers from 1 to 99.')
            combined[pid] = combined.get(pid, 0) + qty
            if combined[pid] > 99:
                raise ValueError('Maximum 99 units per product.')
        return combined

    def verified_product(pid, user):
        # Never accept a price, retailer or item name supplied by a browser.
        offer = recent_indexed_offer(pid)
        if not offer:
            return None
        if (product_is_clothing(offer) or
            (product_is_adult(offer) and not adult_allowed(user))):
            return None
        if offer.get('store') not in supported:
            return None
        try:
            amount = currency(offer.get('price'))
            if amount <= 0 or amount > 100000:
                return None
        except (InvalidOperation, ValueError, TypeError):
            return None
        return {'id': pid, 'name': str(offer.get('name') or '')[:255],
                'store': offer['store'], 'price': amount,
                'imageUrl': str(offer.get('imageUrl') or '')[:4000], 'barcode': str(offer.get('barcode') or '')}

    def comparable_complete_retailer(lines):
        """Compare exact indexed SKUs, not guesses or family-size alternatives.
        Baseline only exists where ONE other chain offers the entire list.
        Avoid stale indexed offers (>7 days).
        """
        chains = {chain: Decimal('0') for chain in supported}
        available = {chain: True for chain in supported}
        cutoff = datetime.utcnow() - timedelta(days=7)
        for line in lines:
            match = Product.barcode == line['barcode'] if line['barcode'] else db.func.lower(Product.name) == line['name'].lower()
            candidates = Product.query.filter(match, Product.last_updated >= cutoff).all()
            best_by_store = {}
            for candidate in candidates:
                if candidate.store not in supported or product_is_clothing(candidate) or product_is_adult(candidate):
                    # Never leak a restricted product into public savings reporting.
                    continue
                if candidate.price and candidate.price > 0:
                    price = currency(candidate.price)
                    best_by_store[candidate.store] = min(price, best_by_store.get(candidate.store, price))
            best_by_store[line['store']] = line['price']
            for chain in supported:
                if chain not in best_by_store:
                    available[chain] = False
                elif available[chain]:
                    chains[chain] += best_by_store[chain] * line['qty']
        eligible = [(chain, value) for chain, value in chains.items() if available[chain]]
        return max(eligible, key=lambda x: x[1]) if len(eligible) >= 2 else None

    def resolve_basket(user, raw_items, requested_retailer=None):
        chosen = normalize_lines(raw_items)
        # Basket-supplied names are NEVER prices or identities. Use them only
        # as safe, length-bounded retailer SEARCH HINTS when a catalog row is
        # missing on Railway or has an outdated search title. Exact SKU + store
        # verification remains mandatory after the retailer scraper responds.
        search_hints = {}
        for item in raw_items:
            pid = str(item['id']).strip()
            name = item.get('name')
            if (isinstance(name, str) and 2 <= len(name.strip()) <= 180
                    and not any(ord(ch) < 32 for ch in name)):
                search_hints[pid] = name.strip()
        if requested_retailer not in supported:
            raise ValueError('Choose a supermarket from the comparison page first.')
        # Do not reject legacy product IDs here. The existing server-side
        # verified_retailer() will reject mismatched stores AFTER verification.
        lines = []
        unavailable = []
        for pid, qty in chosen.items():
            product = verified_product(pid, user)
            if not product:
                unavailable.append(pid)
            else:
                lines.append({**product, 'qty': qty, 'subtotal': product['price'] * qty})
        if unavailable and callable(refresh_stale_offers):
            # Refresh only known products that the customer may view.
            # Never use a browser-provided name, retailer or price.
            to_refresh = []
            for pid in unavailable:
                record = db.session.get(Product, pid)
                # Missing catalog rows may be legitimately newly-searched
                # products: retailer lookup uses a basket name as a hint, and
                # will only accept a verified exact SKU from the retailer.
                if record is None and pid not in search_hints:
                    continue
                if record is not None and product_is_clothing(record):
                    continue
                if record is not None and product_is_adult(record) and not adult_allowed(user):
                    continue
                to_refresh.append(pid)
            if to_refresh:
                try:
                    refresh_stale_offers(to_refresh, search_hints=search_hints)
                except Exception:
                    app.logger.exception('Price refresh unavailable during checkout')
                # Re-check the actual server-side offers after refresh.
                # Do not accept alternative SKU/retailer substitutions.
                resolved = {line['id'] for line in lines}
                for pid in unavailable:
                    product = verified_product(pid, user)
                    if product and pid not in resolved:
                        qty = chosen[pid]
                        lines.append({**product, 'qty': qty, 'subtotal': product['price'] * qty})
                        resolved.add(pid)
                unavailable = [pid for pid in chosen if pid not in resolved]
        if unavailable:
            raise LookupError(','.join(unavailable))
        # Keep the original basket order when returning resolved line items.
        return sorted(lines, key=lambda line: list(chosen).index(line['id']))

    def verified_retailer(data, lines):
        # The client may suggest a retailer, but never prices or retailer identities
        # for product IDs: all items are independently resolved on the server.
        retailer = data.get('retailer')
        if retailer not in supported:
            raise ValueError('Choose a supermarket from the comparison page first.')
        if any(line['store'] != retailer for line in lines):
            raise ValueError('Some selected products are not verified for this retailer. Refresh your comparison and choose a complete store basket.')
        return retailer

    @bp.post('/api/orders/quote')
    @login_required
    def order_quote():
        data = request.get_json(silent=True) or {}
        try:
            lines = resolve_basket(current_user(), data.get('items') if isinstance(data, dict) else None, data.get('retailer') if isinstance(data, dict) else None)
            retailer = verified_retailer(data, lines)
        except ValueError as error:
            return jsonify(error=str(error)), 400
        except LookupError as error:
            return jsonify(error='Some products could not be verified automatically. Retry price checks or remove those products.',
                           code='PRICE_UNAVAILABLE', unavailableIds=str(error).split(',')), 409
        total = sum((line['subtotal'] for line in lines), Decimal('0'))
        comparison = comparable_complete_retailer(lines)
        baseline = comparison[1] if comparison else None
        return jsonify({
            'retailer': retailer, 'total': money(total),
            'estimatedSavings': money(max(Decimal('0'), baseline - total)) if baseline is not None else None,
            'baselineRetailer': comparison[0] if comparison else None,
            'items': [{'id': line['id'], 'name': line['name'], 'store': line['store'],
                       'imageUrl': line['imageUrl'], 'quantity': line['qty'], 'unitPrice': money(line['price']),
                       'subtotal': money(line['subtotal'])} for line in lines],
            'isSimulated': True,
        })

    @bp.get('/api/orders/address-reverse')
    @login_required
    def reverse_shopping_address():
        # Only called for coordinates chosen in SmartBasket's map picker.
        try:
            lat = float(request.args['lat'])
            lng = float(request.args['lng'])
        except (KeyError, ValueError, TypeError):
            return jsonify(error='Choose a location first.'), 400
        if not (-35.5 <= lat <= -21.5 and 16 <= lng <= 34):
            return jsonify(error='Choose a South African location.'), 400
        try:
            params = urlencode({'lat': lat, 'lon': lng, 'format': 'jsonv2',
                                'addressdetails': 1, 'zoom': 18})
            req = Request('https://nominatim.openstreetmap.org/reverse?' + params,
                          headers={'User-Agent': 'SmartBasket educational location picker',
                                   'Accept': 'application/json'})
            with urlopen(req, timeout=8) as response:
                place = json.load(response)
            fields = place.get('address') or {}
            road = fields.get('road') or fields.get('pedestrian') or fields.get('residential') or ''
            street = ' '.join((fields.get('house_number') or '', road)).strip()
            return jsonify({'place': {'name': place.get('display_name') or '',
                'lat': lat, 'lng': lng,
                'address': {'street': street,
                 'suburb': fields.get('suburb') or fields.get('neighbourhood') or fields.get('quarter') or '',
                 'city': fields.get('city') or fields.get('town') or fields.get('village') or fields.get('municipality') or '',
                 'province': fields.get('state') or '',
                 'postal_code': fields.get('postcode') or ''}}})
        except Exception:
            return jsonify(error='Could not fill the address automatically. You can enter the missing details manually.'), 503

    @bp.get('/api/orders/addresses')
    @login_required
    def list_addresses():
        return jsonify([address_json(a) for a in DeliveryAddress.query.filter_by(
            user_id=current_user().id).filter(
            DeliveryAddress.label != COLLECTION_ADDRESS_LABEL
        ).order_by(DeliveryAddress.id.desc()).all()])

    @bp.post('/api/orders/addresses')
    @login_required
    def create_address():
        try:
            fields = address_form(request.get_json(silent=True) or {})
        except ValueError as error:
            return jsonify(error=str(error)), 400
        address = DeliveryAddress(user_id=current_user().id, **fields)
        db.session.add(address)
        db.session.commit()
        return jsonify(address_json(address)), 201

    @bp.patch('/api/orders/addresses/<int:address_id>')
    @login_required
    def update_address(address_id):
        address = DeliveryAddress.query.filter_by(id=address_id, user_id=current_user().id).first()
        if not address or address.label == COLLECTION_ADDRESS_LABEL:
            return jsonify(error='Address not found.'), 404
        try:
            fields = address_form(request.get_json(silent=True) or {})
        except ValueError as error:
            return jsonify(error=str(error)), 400
        for key, value in fields.items():
            setattr(address, key, value)
        db.session.commit()
        return jsonify(address_json(address))

    @bp.delete('/api/orders/addresses/<int:address_id>')
    @login_required
    def delete_address(address_id):
        address = DeliveryAddress.query.filter_by(id=address_id, user_id=current_user().id).first()
        if not address or address.label == COLLECTION_ADDRESS_LABEL:
            return jsonify(error='Address not found.'), 404
        if ShoppingOrder.query.filter_by(address_id=address_id).first():
            return jsonify(error='This address is referenced by an earlier order. Edit it instead.'), 409
        db.session.delete(address)
        db.session.commit()
        return jsonify(success=True)

    @bp.get('/api/orders/collection-branches')
    @login_required
    def collection_branches():
        user = current_user()
        retailer = str(request.args.get('retailer') or '').strip()
        if retailer not in supported:
            return jsonify(error='Choose a supported supermarket before selecting collection.'), 400
        try:
            branches = available_collection_branches(retailer, user.latitude, user.longitude)
        except Exception:
            app.logger.warning('Collection branch list could not be loaded', exc_info=True)
            return jsonify(error='Mapped store branches are temporarily unavailable. Try again.'), 503
        return jsonify(retailer=retailer, branches=branches,
                       note='OSM mapped supermarket branches, not retailer pickup/stock confirmation.')

    @bp.post('/api/orders')
    @login_required
    def create_order():
        user = current_user()
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(error='Invalid order.'), 400
        request_id = str(data.get('requestId') or '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{10,80}', request_id):
            return jsonify(error='Request ID is missing. Please refresh checkout.'), 400
        existing = ShoppingOrder.query.filter_by(user_id=user.id, request_id=request_id).first()
        if existing:
            return jsonify(serialize(existing)), 200
        fulfillment = str(data.get('fulfillmentType') or 'delivery').strip().lower()
        if fulfillment not in ('delivery', 'collection'):
            return jsonify(error='Choose home delivery or supermarket collection.'), 400
        try:
            address_id = int(data.get('addressId')) if fulfillment == 'delivery' else None
            lines = resolve_basket(user, data.get('items'), data.get('retailer'))
            retailer = verified_retailer(data, lines)
        except (ValueError, TypeError) as error:
            return jsonify(error=str(error)), 400
        except LookupError as error:
            return jsonify(error='Some products could not be verified automatically. Retry price checks or remove those products.',
                           code='PRICE_UNAVAILABLE', unavailableIds=str(error).split(',')), 409
        # Collection is branch-only. A home address is never requested or read.
        branch = ''
        if fulfillment == 'collection':
            selected_id = data.get('pickupBranchId')
            if not isinstance(selected_id, str) or not 1 <= len(selected_id) <= 100:
                return jsonify(error='Select an available branch from the list.'), 400
            try:
                available = available_collection_branches(retailer, user.latitude, user.longitude, limit=300)
            except Exception:
                app.logger.warning('Could not validate mapped collection branch', exc_info=True)
                return jsonify(error='Collection locations are unavailable. Please retry.'), 503
            selected_branch = next((b for b in available if b['id'] == selected_id and b['store'] == retailer), None)
            if not selected_branch:
                return jsonify(error='That branch is not available for your selected supermarket. Choose a listed branch.'), 400
            branch = f"{selected_branch['name']} — {selected_branch['address']}" if selected_branch['address'] else selected_branch['name']
            branch = branch[:120]
        address = None
        if fulfillment == 'delivery':
            address = DeliveryAddress.query.filter_by(id=address_id, user_id=user.id).filter(
                DeliveryAddress.label != COLLECTION_ADDRESS_LABEL
            ).first()
            if not address:
                return jsonify(error='Choose one of your delivery addresses.'), 400
        total = sum((line['subtotal'] for line in lines), Decimal('0'))
        # Re-verify the price at placement. The UI sends the quoted total only
        # for change detection; the server still sets the final order amount.
        if data.get('quoteTotal') is not None:
            try:
                expected = currency(data['quoteTotal'])
            except (InvalidOperation, ValueError, TypeError):
                return jsonify(error='Invalid quote. Please refresh checkout.'), 400
            if expected != total:
                return jsonify(error='Prices changed since your quote. Review the updated prices and confirm again.',
                               code='PRICE_CHANGED'), 409
        comparison = comparable_complete_retailer(lines)
        baseline = comparison[1] if comparison else None
        savings = max(Decimal('0'), baseline - total) if baseline is not None else None
        if fulfillment == 'collection':
            address = collection_reference_address(user)
            # An order snapshot must describe the selected pickup branch, never
            # an unrelated home address. Keep the established address object
            # shape for old order-history/admin pages.
            address_snapshot = {
                'id': address.id, 'label': 'Supermarket collection',
                'recipient': (getattr(user, 'username', None) or getattr(user, 'email', None) or '')[:100],
                'phone': '', 'street': '', 'suburb': '', 'city': 'Gqeberha',
                'province': 'Eastern Cape', 'postal_code': '', 'notes': '',
                'collectionOnly': True, 'pickupBranch': branch,
            }
        else:
            address_snapshot = address_json(address)
        order = ShoppingOrder(user_id=user.id, address_id=address.id, retailer=retailer,
                              fulfillment_type=fulfillment, pickup_branch=branch,
                              request_id=request_id, total=total,
                              baseline_total=baseline, baseline_retailer=comparison[0] if comparison else None,
                              estimated_savings=savings,
                              address_snapshot=address_snapshot)
        db.session.add(order)
        db.session.flush()
        for line in lines:
            db.session.add(ShoppingOrderLine(order_id=order.id, product_id=line['id'],
                                            product_name=line['name'], retailer=line['store'],
                                            image_url=line['imageUrl'],
                                            quantity=line['qty'], unit_price=line['price'],
                                            line_total=line['subtotal']))
        db.session.add(ShoppingOrderEvent(order_id=order.id, status='simulated_placed'))
        alerts = app.extensions.get('shopping_notifications')
        if alerts:
            alerts['order_event'](order)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            existing = ShoppingOrder.query.filter_by(user_id=user.id, request_id=request_id).first()
            if existing:
                return jsonify(serialize(existing)), 200
            raise
        return jsonify(serialize(order)), 201

    @bp.get('/api/orders')
    @login_required
    def my_orders():
        orders = ShoppingOrder.query.filter_by(user_id=current_user().id).order_by(
            ShoppingOrder.placed_at.desc(), ShoppingOrder.id.desc()).limit(150).all()
        return jsonify([serialize(o) for o in orders])

    @bp.get('/api/orders/<int:order_id>')
    @login_required
    def order_detail(order_id):
        order = ShoppingOrder.query.filter_by(id=order_id, user_id=current_user().id).first()
        if not order:
            return jsonify(error='Order not found.'), 404
        return jsonify(serialize(order))

    @bp.post('/api/orders/<int:order_id>/cancel')
    @login_required
    def cancel_order(order_id):
        order = ShoppingOrder.query.filter_by(id=order_id, user_id=current_user().id).first()
        if not order:
            return jsonify(error='Order not found.'), 404
        if order.status == 'simulated_cancelled':
            return jsonify(serialize(order))
        if order.status != 'simulated_placed':
            return jsonify(error='This order cannot be cancelled.'), 409
        order.status = 'simulated_cancelled'
        db.session.add(ShoppingOrderEvent(order_id=order.id, status='simulated_cancelled'))
        alerts = app.extensions.get('shopping_notifications')
        if alerts:
            alerts['order_event'](order, cancelled=True)
        db.session.commit()
        return jsonify(serialize(order))

    @bp.get('/api/insights/me')
    @login_required
    def customer_insights():
        orders = ShoppingOrder.query.filter_by(user_id=current_user().id).filter(
            ShoppingOrder.status != 'simulated_cancelled').order_by(ShoppingOrder.placed_at.desc()).all()
        total = sum((currency(o.total) for o in orders), Decimal('0'))
        measured = [o for o in orders if o.estimated_savings is not None]
        savings = sum((currency(o.estimated_savings) for o in measured), Decimal('0'))
        counts = Counter()
        retailer_totals = defaultdict(lambda: Decimal('0'))
        monthly = defaultdict(lambda: Decimal('0'))
        for order in orders:
            monthly[order.placed_at.strftime('%Y-%m')] += currency(order.total)
            for line in order.lines:
                counts[line.product_name] += line.quantity
                retailer_totals[line.retailer] += currency(line.line_total)
        return jsonify({
            'simulatedOrders': len(orders), 'estimatedPlannedSpend': money(total),
            'estimatedSavings': money(savings), 'ordersWithSavingsComparison': len(measured),
            'ordersWithoutSavingsComparison': len(orders) - len(measured),
            'favoriteRetailer': max(retailer_totals, key=retailer_totals.get) if retailer_totals else None,
            'topProducts': [{'name': n, 'units': count} for n, count in counts.most_common(5)],
            'monthly': [{'month': m, 'plannedSpend': money(value)} for m, value in sorted(monthly.items())],
            'disclaimer': 'Shopping plans only; no verified supermarket purchase, payment or delivery. Savings are estimates only when comparable complete-store indexed prices exist.'
        })

    @bp.get('/api/admin/order-analytics')
    @admin_required
    def admin_order_analytics():
        orders = ShoppingOrder.query.filter(ShoppingOrder.status != 'simulated_cancelled').all()
        cancelled = ShoppingOrder.query.filter_by(status='simulated_cancelled').count()
        spend = sum((currency(o.total) for o in orders), Decimal('0'))
        covered = [o for o in orders if o.estimated_savings is not None]
        savings = sum((currency(o.estimated_savings) for o in covered), Decimal('0'))
        store_orders = Counter(order.retailer for order in orders if order.retailer in supported)
        product_units = Counter()
        regions = Counter()
        monthly = defaultdict(lambda: Decimal('0'))
        for order in orders:
            regions[order.address_snapshot.get('province') or 'Unknown'] += 1
            monthly[order.placed_at.strftime('%Y-%m')] += currency(order.total)
            for line in order.lines:
                product_units[line.product_name] += line.quantity
        return jsonify({
            'simulatedOrders': len(orders), 'cancelledPlans': cancelled,
            'usersWithPlans': len({order.user_id for order in orders}),
            'plannedSpend': money(spend), 'estimatedSavings': money(savings),
            'comparablePlans': len(covered), 'incomparablePlans': len(orders) - len(covered),
            'stores': [{'name': n, 'orders': store_orders.get(n, 0)} for n in sorted(supported)],
            'products': [{'name': n, 'units': k} for n, k in product_units.most_common(10)],
            'provinces': [{'name': n, 'orders': k} for n, k in regions.most_common()],
            'monthly': [{'month': m, 'plannedSpend': money(v)} for m, v in sorted(monthly.items())],
            'disclaimer': 'Simulated order plans, not confirmed supermarket sales or deliveries. Store counts measure distinct completed plans per selected retailer; legacy mixed-store plans are excluded.'
        })

    @bp.patch('/api/admin/orders/<int:order_id>/status')
    @admin_required
    def admin_update_order_status(order_id):
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get('status'), str):
            return jsonify(error='Choose a valid order status.'), 400
        order = db.session.get(ShoppingOrder, order_id)
        if not order:
            return jsonify(error='Order not found.'), 404
        next_status = data['status']
        if data.get('expectedStatus') != order.status:
            return jsonify(error='Another admin changed this order. Refresh the order list and try again.'), 409
        if next_status not in allowed_next(order):
            return jsonify(error='This status transition is not allowed for this order.'), 409
        order.status = next_status
        event = ShoppingOrderEvent(order_id=order.id, status=next_status)
        db.session.add(event)
        db.session.flush()
        notifications = app.extensions.get('shopping_notifications')
        if notifications:
            notifications['emit'](
                order.user_id, 'order_updates', f'order:{order.id}',
                f'order:{order.id}:status:{event.id}',
                f'Order #{order.id} status updated to {next_status.removeprefix("simulated_").replace("_", " " )} (SmartBasket demo only).',
                '/account/orders',
            )
        db.session.commit()
        return jsonify(serialize(order))

    @bp.get('/api/admin/orders')
    @admin_required
    def admin_orders():
        orders = ShoppingOrder.query.order_by(ShoppingOrder.placed_at.desc(), ShoppingOrder.id.desc()).limit(200).all()
        user_ids = {order.user_id for order in orders}
        people = {user.id: user for user in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
        results = []
        for order in orders:
            record = serialize(order)
            owner = people.get(order.user_id)
            record['customer'] = {'id': order.user_id, 'username': getattr(owner, 'username', None) or 'User', 'email': getattr(owner, 'email', None) or ''}
            record['province'] = order.address_snapshot.get('province')
            results.append(record)
        return jsonify(results)

    app.register_blueprint(bp)
    app.extensions['smartbasket_order_models'] = {
        'Address': DeliveryAddress, 'Order': ShoppingOrder, 'Line': ShoppingOrderLine,
        'Event': ShoppingOrderEvent
    }
