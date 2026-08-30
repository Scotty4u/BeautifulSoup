from concurrent.futures import ThreadPoolExecutor
import re
import time
from curl_cffi import requests  # Drop-in replacement that mimics real browser TLS fingerprints
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ==========================================
# CACHE CONFIGURATION
# ==========================================
SEARCH_CACHE = {}
CACHE_EXPIRATION_SECONDS = 3600  # 1 hour in seconds


def get_cached_data(store_key: str, query: str):
    key = (store_key.lower(), query.lower().strip())
    if key in SEARCH_CACHE:
        entry = SEARCH_CACHE[key]
        is_fresh = (time.time() - entry['timestamp']) < CACHE_EXPIRATION_SECONDS
        return entry['data'], is_fresh
    return None, False


def save_to_cache(store_key: str, query: str, data: list):
    if data:
        key = (store_key.lower(), query.lower().strip())
        SEARCH_CACHE[key] = {'timestamp': time.time(), 'data': data}


# ==========================================
# 1. PICK N PAY SCRAPER (WAF-Resilient)
# ==========================================
def get_pnp_high_res_image(images_list):
    if not images_list:
        return ''
    high_res_path = ''
    for img in images_list:
        if img.get('format', '').lower() in ['zoom', 'superzoom', 'product']:
            high_res_path = img.get('url', '')
            break
    if not high_res_path:
        high_res_path = images_list[-1].get('url', '')
    return (
        high_res_path
        if high_res_path.startswith('http')
        else f'https://www.pnp.co.za{high_res_path}'
    )


def scrape_pnp(query: str):
    cached_data, is_fresh = get_cached_data('pnp', query)
    if is_fresh:
        print(f"[CACHE HIT] Returning fresh Pick n Pay results for '{query}'")
        return cached_data

    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        ),
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.pnp.co.za',
        'Referer': f'https://www.pnp.co.za/search/{query}',
    }
    url = (
        'https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search'
        '?fields=products(variantMatrix(FULL)%2CproductIdForTracking%2CsponsoredProduct%2ConlineSalesAdId%2ConlineSalesExtendedAdId%2Ccode%2Cname%2CbrandSellerId%2CaverageWeight%2Csummary%2Cprice(FULL)%2Cimages(DEFAULT)%2Cstock(FULL)%2CaverageRating%2CnumberOfReviews%2CvariantOptions%2CmaxOrderQuantity%2CproductDisplayBadges(DEFAULT)%2CallowedQuantities(DEFAULT)%2Cavailable%2CquantityType%2CdefaultQuantityOfUom%2CinStockIndicator%2CdefaultUnitOfMeasure%2CpotentialPromotions(FULL)%2CcategoryNames)%2Cfacets%2Cbreadcrumbs%2Cpagination(DEFAULT)%2Csorts(DEFAULT)%2CfreeTextSearch%2CcurrentQuery%2CresponseJson%2CseoCategoryContent%2CseoCategoryTitle%2CrefinedContent%2CcategoryDescription%2CkeywordRedirectUrl'
        f'&query={query}&pageSize=36&storeCode=WC21&lang=en&curr=ZAR'
    )

    try:
        print(f"[LIVE FETCH] Scraping Pick n Pay for '{query}'")
        # impersonate="chrome120" tells curl_cffi to match a real browser's TLS signature, avoiding WAF blocks
        res = requests.post(url, headers=headers, json={}, impersonate='chrome120', timeout=10)
        if res.status_code == 200:
            products = res.json().get('products', [])
            extracted = [
                {
                    'id': f"pnp_{item.get('code')}",
                    'name': item.get('name'),
                    'store': 'Pick n Pay',
                    'price': float(item.get('price', {}).get('value', 0.0)),
                    'formattedPrice': item.get('price', {}).get('formattedValue', 'R0.00'),
                    'imageUrl': get_pnp_high_res_image(item.get('images', [])),
                }
                for item in products
            ]
            save_to_cache('pnp', query, extracted)
            return extracted
    except Exception as e:
        print(f'PnP Scraper Error: {e}')

    if cached_data is not None:
        print(f"[CACHE FALLBACK] Returning stale Pick n Pay data for '{query}'")
        return cached_data

    return []


# ==========================================
# 2. SHOPRITE SCRAPER (WAF-Resilient)
# ==========================================
def extract_shoprite_image(item: dict) -> str:
    raw_img = ''
    if item.get('imageId'):
        raw_img = item.get('imageId')
    elif item.get('images') and isinstance(item['images'], list) and len(item['images']) > 0:
        first = item['images'][0]
        if isinstance(first, dict):
            raw_img = (
                first.get('id')
                or first.get('fileId')
                or first.get('url')
                or first.get('src')
                or ''
            )
        elif isinstance(first, str):
            raw_img = first
    elif item.get('image'):
        raw_img = item.get('image')
    elif item.get('imageUrl'):
        raw_img = item.get('imageUrl')

    if not raw_img:
        return ''

    raw_img = str(raw_img).strip()
    if raw_img.startswith('http://') or raw_img.startswith('https://'):
        return raw_img
    if raw_img.startswith('//'):
        return f'https:{raw_img}'
    if '/' in raw_img:
        raw_img = raw_img.split('/')[-1]
    raw_img = raw_img.split('?')[0]

    return f'https://catalog.sixty60.co.za/v2/files/{raw_img}?width=400&height=400'


def scrape_shoprite(query: str):
    cached_data, is_fresh = get_cached_data('shoprite', query)
    if is_fresh:
        print(f"[CACHE HIT] Returning fresh Shoprite results for '{query}'")
        return cached_data

    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        ),
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.shoprite.co.za/',
        'Content-Type': 'application/json',
        'Origin': 'https://www.shoprite.co.za',
    }

    json_data = {
        'storeContexts': [],
        'filterData': {
            'filter': {
                'showAllDisplayVariants': False,
                'showNotRangedProducts': False,
                'productListSource': {'search': query},
                'paginationOptions': {'page': 0, 'pageSize': 36},
                'filterOptions': {'dealsOnly': False, 'serviceOptions': [], 'facetOptions': []},
                'sortOptions': None,
            },
            'displayOptions': {},
        },
        'forYouBonusBuyIds': [],
    }

    try:
        print(f"[LIVE FETCH] Scraping Shoprite for '{query}'")
        # Using curl_cffi with chrome impersonation to pass AWS WAF checks seamlessly
        res = requests.post(
            'https://www.shoprite.co.za/api/catalogue/get-products-filter',
            headers=headers,
            json=json_data,
            impersonate='chrome120',
            timeout=10,
        )
        if res.status_code == 200:
            data = res.json()
            products = data.get('products', []) or data.get('filterResult', {}).get('products', [])

            extracted = []
            for item in products:
                raw_price = item.get('price', 0.0)
                if isinstance(raw_price, dict):
                    raw_price = raw_price.get('value', 0.0)

                extracted.append({
                    'id': f"shoprite_{item.get('code', item.get('id', ''))}",
                    'name': item.get('name', item.get('title', '')),
                    'store': 'Shoprite',
                    'price': float(raw_price),
                    'formattedPrice': f"R {float(raw_price):.2f}",
                    'imageUrl': extract_shoprite_image(item),
                })
            save_to_cache('shoprite', query, extracted)
            return extracted
    except Exception as e:
        print(f'Shoprite Scraper Error: {e}')

    if cached_data is not None:
        print(f"[CACHE FALLBACK] Returning stale Shoprite data for '{query}'")
        return cached_data

    return []


# ==========================================
# 3. SEARCH ENDPOINT
# ==========================================
@app.route('/api/search', methods=['GET'])
def handle_search():
    query = request.args.get('q', '').strip().lower()
    store_filter = request.args.get('store', 'all').strip().lower()
    sort_option = request.args.get('sort', '').strip().lower()

    if not query:
        return jsonify([])

    pnp_results = []
    shoprite_results = []

    run_pnp = store_filter in ['all', 'pnp', 'pick n pay', 'picknpay']
    run_shoprite = store_filter in ['all', 'shoprite']

    if run_pnp and run_shoprite:
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_pnp = executor.submit(scrape_pnp, query)
            future_shoprite = executor.submit(scrape_shoprite, query)
            pnp_results = future_pnp.result()
            shoprite_results = future_shoprite.result()
    elif run_pnp:
        pnp_results = scrape_pnp(query)
    elif run_shoprite:
        shoprite_results = scrape_shoprite(query)

    if run_pnp and run_shoprite and not sort_option:
        combined = []
        max_len = max(len(pnp_results), len(shoprite_results))
        for i in range(max_len):
            if i < len(pnp_results):
                combined.append(pnp_results[i])
            if i < len(shoprite_results):
                combined.append(shoprite_results[i])
    else:
        combined = pnp_results + shoprite_results

    if sort_option in ['asc', 'price_asc', 'low_to_high', 'low-to-high']:
        combined.sort(key=lambda x: x['price'])
    elif sort_option in ['desc', 'price_desc', 'high_to_low', 'high-to-low']:
        combined.sort(key=lambda x: x['price'], reverse=True)

    return jsonify(combined)


# ==========================================
# 4. CATEGORIES ENDPOINT
# ==========================================
@app.route('/api/categories', methods=['GET'])
def get_categories():
    categories = {
        'Dairy & Essentials': ['Fresh Milk', 'Brown Bread', 'Large Eggs', 'Butter'],
        'Pantry Staples': ['White Sugar', 'Sunflower Oil', 'White Maize Meal', 'Long Grain Rice'],
        'Beverages & Household': ['Coffee', 'Ceylon Tea', 'Toilet Paper', 'Cold Drink'],
    }

    response_data = {}

    def fetch_category_items(cat_name, items):
        cat_products = []
        for query in items:
            pnp = scrape_pnp(query)[:2]
            shoprite = scrape_shoprite(query)[:2]
            cat_products.extend(pnp + shoprite)
        return cat_name, cat_products

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(fetch_category_items, cat, items)
            for cat, items in categories.items()
        ]
        for future in futures:
            cat_name, cat_products = future.result()
            response_data[cat_name] = cat_products

    return jsonify(response_data)


# ==========================================
# 5. EXACT-SIZE CROSS-STORE PRICE COMPARISON
# ==========================================
@app.route('/api/compare', methods=['GET'])
def compare_product():
    product_name = request.args.get('name', '').strip()
    current_store = request.args.get('store', '').strip().lower()
    current_price = float(request.args.get('price', 0.0))

    if not product_name:
        return jsonify({'found': False})

    def extract_size(text):
        match = re.search(r'\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|mg|s)\b', text, re.IGNORECASE)
        return match.group(0).lower().replace(' ', '') if match else None

    current_size = extract_size(product_name)

    clean_name_words = [
        w
        for w in product_name.split()
        if not re.match(r'^\d+(?:\.\d+)?(?:kg|g|ml|l|mg|s)$', w, re.IGNORECASE)
        and len(w) > 2
    ]
    keywords = ' '.join(clean_name_words[:3]) or product_name

    alternative_products = []
    if 'pick' in current_store or 'pnp' in current_store:
        alternative_products = scrape_shoprite(keywords)
    else:
        alternative_products = scrape_pnp(keywords)

    if not alternative_products:
        return jsonify({'found': False})

    matching_alternatives = []
    for alt in alternative_products:
        alt_size = extract_size(alt['name'])
        if current_size and alt_size:
            if current_size == alt_size:
                matching_alternatives.append(alt)
        else:
            matching_alternatives.append(alt)

    if not matching_alternatives:
        return jsonify({'found': False})

    cheapest_alt = min(matching_alternatives, key=lambda x: x['price'])

    if cheapest_alt['price'] < current_price and current_price > 0:
        diff = current_price - cheapest_alt['price']
        percent_cheaper = round((diff / current_price) * 100)
        return jsonify({
            'found': True,
            'cheaper': True,
            'percent': percent_cheaper,
            'product': cheapest_alt,
        })
    elif cheapest_alt['price'] > current_price:
        return jsonify({
            'found': True,
            'cheaper': False,
            'product': cheapest_alt,
        })

    return jsonify({'found': False})



if __name__ == '__main__':
    app.run(port=5000, debug=True)