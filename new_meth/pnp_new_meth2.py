import json
import requests

cookies = {
    'route': '5aae561be1e2e76e36b6aadac2b43d34',
    'dtCookie': (
        'v_4_srv_3_sn_A64BE04E5900F794B34B7B6187292556_perc_100000_ol_0_mul_1_app-3A2ce7406a2949d129_0'
    ),
    'ConstructorioID_client_id': 'c2f7ad20-3c62-4c17-83e5-7cd5114dd7c4',
    'ConstructorioID_session_id': '1',
    'ConstructorioID_session': '{"sessionId":1,"lastTime":1787587238709}',
}

headers = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101'
        ' Firefox/154.0'
    ),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Anonymous-Consents': '%5B%5D',
    'X-Pnp-Search-Session-Id': '1',
    'X-Pnp-Search-Client-Id': 'c2f7ad20-3c62-4c17-83e5-7cd5114dd7c4',
    'X-Pnp-Cache-Key': 'anonymous',
    'Origin': 'https://www.pnp.co.za',
    'Connection': 'keep-alive',
    'Referer': 'https://www.pnp.co.za/search/bread',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
}

url = (
    'https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search'
    '?fields=products(variantMatrix(FULL)%2CproductIdForTracking%2CsponsoredProduct%2ConlineSalesAdId%2ConlineSalesExtendedAdId%2Ccode%2Cname%2CbrandSellerId%2CaverageWeight%2Csummary%2Cprice(FULL)%2Cimages(DEFAULT)%2Cstock(FULL)%2CaverageRating%2CnumberOfReviews%2CvariantOptions%2CmaxOrderQuantity%2CproductDisplayBadges(DEFAULT)%2CallowedQuantities(DEFAULT)%2Cavailable%2CquantityType%2CdefaultQuantityOfUom%2CinStockIndicator%2CdefaultUnitOfMeasure%2CpotentialPromotions(FULL)%2CcategoryNames)%2Cfacets%2Cbreadcrumbs%2Cpagination(DEFAULT)%2Csorts(DEFAULT)%2CfreeTextSearch%2CcurrentQuery%2CresponseJson%2CseoCategoryContent%2CseoCategoryTitle%2CrefinedContent%2CcategoryDescription%2CkeywordRedirectUrl'
    '&query=bread&pageSize=72&storeCode=WC21&lang=en&curr=ZAR'
)

json_data = {}


def get_high_res_image_url(images_list):
    """Parses Hybris image objects to extract full-resolution assets rather than thumbnails."""
    if not images_list:
        return ''

    high_res_path = ''

    # 1. Search for explicit full-size format labels in Hybris response
    for img in images_list:
        fmt = img.get('format', '').lower()
        if fmt in ['zoom', 'superzoom', 'product']:
            high_res_path = img.get('url', '')
            break

    # 2. Fallback: Take the last asset in the list (Hybris places higher res assets at the end)
    if not high_res_path:
        high_res_path = images_list[-1].get('url', '')

    # 3. Format into a complete HTTPS URL
    if high_res_path.startswith('http'):
        return high_res_path
    elif high_res_path:
        return f'https://www.pnp.co.za{high_res_path}'

    return ''


def run_scraper():
    try:
        response = requests.post(
            url, cookies=cookies, headers=headers, json=json_data, timeout=15
        )

        if response.status_code == 200:
            data = response.json()
            products = data.get('products', [])

            print(f'Successfully retrieved {len(products)} products!\n')
            print('=' * 70)

            extracted_items = []
            for item in products:
                sku = item.get('code')
                name = item.get('name')
                price_info = item.get('price', {})
                formatted_price = price_info.get(
                    'formattedValue', 'Price Unavailable'
                )
                raw_price = price_info.get('value', 0.0)

                # Extract high-resolution image URL
                image_url = get_high_res_image_url(item.get('images', []))

                print(f'[{sku}] {name} -> {formatted_price}')
                print(f' Image URL: {image_url}\n')

                extracted_items.append({
                    'sku': sku,
                    'name': name,
                    'formatted_price': formatted_price,
                    'price': raw_price,
                    'image_url': image_url,
                    'store_code': 'WC21',
                })

            # Save clean parsed data with full-size image links to JSON
            with open('pnp_bread_products.json', 'w', encoding='utf-8') as f:
                json.dump(extracted_items, f, indent=4)

            print('=' * 70)
            print(
                'Successfully saved products and high-res image URLs to'
                ' pnp_bread_products.json'
            )

        else:
            print(f'Request failed with HTTP status: {response.status_code}')

    except Exception as err:
        print(f'An error occurred: {err}')


if __name__ == '__main__':
    run_scraper()