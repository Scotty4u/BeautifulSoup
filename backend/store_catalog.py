"""Product browse API for the four scraper-supported retailers.

Does not scrape inventory itself. It pages through products already indexed
by the existing SmartBasket scraper, then applies its existing adult/clothing
visibility filter. New searches continue to use /api/search.
"""
from flask import jsonify, request
from sqlalchemy import func

STORES = {
    'pick-n-pay': 'Pick n Pay',
    'shoprite': 'Shoprite',
    'checkers': 'Checkers',
    'woolworths': 'Woolworths',
}

_GROUPS = {
    'Grocery': 'Grocery', 'Baby': 'Grocery', 'Household': 'Grocery',
    'Personal Care': 'Grocery', 'Pet Care': 'Grocery', 'Other': 'Grocery',
    'Pharmacy': 'Pharmacy', 'Electronics': 'Electronics', 'Liquor': 'Liquor',
}


def register_store_catalog(app, Product, filter_catalog_for_viewer):
    if 'store_catalog_products' in app.view_functions:
        return

    @app.route('/api/stores/<store_slug>/products', methods=['GET'], endpoint='store_catalog_products')
    def store_catalog_products(store_slug):
        store = STORES.get(store_slug)
        if store is None:
            return jsonify({'error': 'Unknown retailer'}), 404
        try:
            page = min(max(int(request.args.get('page', 1)), 1), 100000)
            page_size = min(max(int(request.args.get('page_size', 24)), 1), 60)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid pagination values'}), 400
        q = str(request.args.get('q', '')).strip()[:100]
        category = str(request.args.get('category', '')).strip().lower()
        selected_category = next((name for name in ('Grocery', 'Pharmacy', 'Liquor', 'Electronics') if name.lower() == category), None)
        if category and not selected_category:
            return jsonify({'error': 'Unsupported category'}), 400
        price_text = str(request.args.get('max_price', '')).strip()
        try:
            price_cap = float(price_text) if price_text else None
            if price_cap is not None and (not 0 < price_cap <= 100000):
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid maximum price'}), 400
        sort = request.args.get('sort', 'latest')
        query = Product.query.filter(func.lower(Product.store) == store.lower())
        if price_cap is not None:
            query = query.filter(Product.price <= price_cap)
        if q:
            # SQLAlchemy escapes the percent and underscore characters so the
            # search remains a literal substring match, rather than a wildcard.
            escaped = q.replace('\\', '\\\\').replace('%', r'\%').replace('_', r'\_')
            query = query.filter(Product.name.ilike(f'%{escaped}%', escape='\\'))
        if sort == 'price_asc':
            query = query.order_by(Product.price.asc(), Product.id.asc())
        elif sort == 'price_desc':
            query = query.order_by(Product.price.desc(), Product.id.asc())
        elif sort == 'name':
            query = query.order_by(Product.name.asc(), Product.id.asc())
        else:
            query = query.order_by(Product.last_updated.desc(), Product.id.asc())

        start = (page - 1) * page_size
        visible_count = 0
        page_products = []
        # Filter BEFORE pagination, preventing clothing/18+ products from
        # consuming slots and from changing the shown totals. Batch catalogue
        # visibility decisions to avoid repeated user lookups per row.
        def collect_visible(batch):
            nonlocal visible_count
            for clean in filter_catalog_for_viewer(batch):
                if selected_category and _GROUPS.get(str(clean.get('catalogCategory') or '')) != selected_category:
                    continue
                if start <= visible_count < start + page_size:
                    page_products.append(clean)
                visible_count += 1

        pending = []
        for product in query.yield_per(200):
            pending.append({
                'id': product.id, 'name': product.name, 'store': product.store,
                'price': product.price,
                'formattedPrice': product.formatted_price or f'R {product.price:.2f}',
                'imageUrl': product.image_url or '', 'productUrl': product.product_url or '',
                'barcode': product.barcode or '',
                'ageRestricted': bool(product.age_restricted),
                'catalogCategory': product.catalog_category or 'Other',
            })
            if len(pending) >= 200:
                collect_visible(pending)
                pending = []
        if pending:
            collect_visible(pending)
        pages = max(1, (visible_count + page_size - 1) // page_size)
        return jsonify({
            'store': store, 'products': page_products, 'total': visible_count,
            'page': page, 'page_size': page_size, 'pages': pages,
            'source': 'indexed_products',
        })