from concurrent.futures import ThreadPoolExecutor
import time
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

# ==========================================
# CACHE CONFIGURATION
# ==========================================
# Stores scraper results keyed by (store, query)
# Structure: { ('pnp', 'milk'): {'timestamp': 1787587200, 'data': [...] } }
SEARCH_CACHE = {}
CACHE_EXPIRATION_SECONDS = 3600  # 1 hour in seconds


def get_cached_data(store_key: str, query: str):
    """Retrieve cached product data if available.

    Returns (data, is_fresh)
    """
    key = (store_key.lower(), query.lower().strip())
    if key in SEARCH_CACHE:
        entry = SEARCH_CACHE[key]
        is_fresh = (time.time() - entry['timestamp']) < CACHE_EXPIRATION_SECONDS
        return entry['data'], is_fresh
    return None, False


def save_to_cache(store_key: str, query: str, data: list):
    """Save scraped results to memory if items were found."""
    if data:
        key = (store_key.lower(), query.lower().strip())
        SEARCH_CACHE[key] = {'timestamp': time.time(), 'data': data}


# ==========================================
# 1. PICK N PAY SCRAPER & HELPERS
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
    # 1. Check cache first
    cached_data, is_fresh = get_cached_data('pnp', query)
    if is_fresh:
        print(f"[CACHE HIT] Returning fresh Pick n Pay results for '{query}'")
        return cached_data

    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101'
            ' Firefox/154.0'
        ),
        'Accept': 'application/json, text/plain, */*',
        'X-Anonymous-Consents': '%5B%5D',
        'X-Pnp-Search-Session-Id': '1',
        'X-Pnp-Search-Client-Id': 'c2f7ad20-3c62-4c17-83e5-7cd5114dd7c4',
        'X-Pnp-Cache-Key': 'anonymous',
        'Origin': 'https://www.pnp.co.za',
        'Referer': f'https://www.pnp.co.za/search/{query}',
    }
    cookies = {
        'route': '5aae561be1e2e76e36b6aadac2b43d34',
        'dtCookie': (
            'v_4_srv_3_sn_A64BE04E5900F794B34B7B6187292556_perc_100000_ol_0_mul_1_app-3A2ce7406a2949d129_0'
        ),
        'ConstructorioID_client_id': 'c2f7ad20-3c62-4c17-83e5-7cd5114dd7c4',
        'ConstructorioID_session_id': '1',
        'ConstructorioID_session': '{"sessionId":1,"lastTime":1787587238709}',
    }
    url = (
        'https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search'
        '?fields=products(variantMatrix(FULL)%2CproductIdForTracking%2CsponsoredProduct%2ConlineSalesAdId%2ConlineSalesExtendedAdId%2Ccode%2Cname%2CbrandSellerId%2CaverageWeight%2Csummary%2Cprice(FULL)%2Cimages(DEFAULT)%2Cstock(FULL)%2CaverageRating%2CnumberOfReviews%2CvariantOptions%2CmaxOrderQuantity%2CproductDisplayBadges(DEFAULT)%2CallowedQuantities(DEFAULT)%2Cavailable%2CquantityType%2CdefaultQuantityOfUom%2CinStockIndicator%2CdefaultUnitOfMeasure%2CpotentialPromotions(FULL)%2CcategoryNames)%2Cfacets%2Cbreadcrumbs%2Cpagination(DEFAULT)%2Csorts(DEFAULT)%2CfreeTextSearch%2CcurrentQuery%2CresponseJson%2CseoCategoryContent%2CseoCategoryTitle%2CrefinedContent%2CcategoryDescription%2CkeywordRedirectUrl'
        f'&query={query}&pageSize=36&storeCode=WC21&lang=en&curr=ZAR'
    )

    try:
        print(f"[LIVE FETCH] Scraping Pick n Pay for '{query}'")
        res = requests.post(url, cookies=cookies, headers=headers, json={}, timeout=10)
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

    # Fallback to expired cache if live fetch failed/rate limited
    if cached_data is not None:
        print(f"[CACHE FALLBACK] Returning stale Pick n Pay data for '{query}'")
        return cached_data

    return []


# ==========================================
# 2. SHOPRITE SCRAPER & HELPERS
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
    # 1. Check cache first
    cached_data, is_fresh = get_cached_data('shoprite', query)
    if is_fresh:
        print(f"[CACHE HIT] Returning fresh Shoprite results for '{query}'")
        return cached_data

    cookies = {
        'storeContexts': '%5B%7B%22storeId%22%3A%2265ddb7b35511bf8f03a90564%22%2C%22serviceOptionIds%22%3A%5B%22sixty-min-delivery%22%5D%2C%22brandPriority%22%3A8%2C%22hasCapacity%22%3A%5B%22sixty-min-delivery%22%5D%2C%22distanceFromCustomer%22%3A0.0034009759877851827%2C%22returnServiceOptionIds%22%3Anull%2C%22hasReturnCapacity%22%3Anull%7D%2C%7B%22storeId%22%3A%2265cb65a1f88f400671ab9c79%22%2C%22serviceOptionIds%22%3A%5B%22sixty-min-delivery%22%5D%2C%22brandPriority%22%3A4%2C%22hasCapacity%22%3A%5B%22sixty-min-delivery%22%5D%2C%22distanceFromCustomer%22%3A0.0034009759877851827%2C%22returnServiceOptionIds%22%3Anull%2C%22hasReturnCapacity%22%3Anull%7D%5D',
        'storeids': '65ddb7b35511bf8f03a90564-65cb65a1f88f400671ab9c79',
        'istio-storeIds': '65ddb7b35511bf8f03a90564-65cb65a1f88f400671ab9c79',
        'aws-waf-token': '48a073ca-b7f1-4644-a071-46d6b6433e08:CgoAtAZ3yJ42AQAA:tRTw8lJleygJjPnUxMxyhLKxljDiH7vWC218z73X1wzVFE6KuyRTTseq+q9v/HO+eQLYfC8TYwSxfdICrjA4VoKDEPbrXYKOLFFimI69nruOEovSsAJ3x6FxmDv3141tQH3sZt0YAjgnhsJLf0qbmdonjsZQpPfLqR8yFdLISBlQirAyiVUgyAGr+gKm+FoW0KJmSWT4xYeBL+q3ktRRHH7gWhMH2qnkPD9poyoxyzB0V1NKpGpsoDl1O9SjYG/Bok2I4kjXe8KOB5QOj8BLlFo9RdF2HfQ=',
    }

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.shoprite.co.za/',
        'Content-Type': 'application/json',
        'Origin': 'https://www.shoprite.co.za',
        'Connection': 'keep-alive',
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
        res = requests.post(
            'https://www.shoprite.co.za/api/catalogue/get-products-filter',
            cookies=cookies,
            headers=headers,
            json=json_data,
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

    # Fallback to expired cache if live fetch failed/rate limited
    if cached_data is not None:
        print(f"[CACHE FALLBACK] Returning stale Shoprite data for '{query}'")
        return cached_data

    return []


# ==========================================
# 3. SEARCH ENDPOINT (FILTER & SORT SUPPORT)
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

    # Identify targeted scrapers
    run_pnp = store_filter in ['all', 'pnp', 'pick n pay', 'picknpay']
    run_shoprite = store_filter in ['all', 'shoprite']

    # Execute scrapers conditionally
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

    # Combine results
    if run_pnp and run_shoprite and not sort_option:
        # Interleave side-by-side when both stores run without explicit sorting
        combined = []
        max_len = max(len(pnp_results), len(shoprite_results))
        for i in range(max_len):
            if i < len(pnp_results):
                combined.append(pnp_results[i])
            if i < len(shoprite_results):
                combined.append(shoprite_results[i])
    else:
        combined = pnp_results + shoprite_results

    # Apply Price Sorting
    if sort_option in ['asc', 'price_asc', 'low_to_high', 'low-to-high']:
        combined.sort(key=lambda x: x['price'])
    elif sort_option in ['desc', 'price_desc', 'high_to_low', 'high-to-low']:
        combined.sort(key=lambda x: x['price'], reverse=True)

    return jsonify(combined)


if __name__ == '__main__':
    app.run(port=5000, debug=True)