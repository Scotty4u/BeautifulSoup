from flask import Flask, jsonify, request
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)  # Prevents cross-origin browser errors


def get_high_res_image_url(images_list):
    if not images_list:
        return ""
    high_res_path = ""
    for img in images_list:
        if img.get("format", "").lower() in ["zoom", "superzoom", "product"]:
            high_res_path = img.get("url", "")
            break
    if not high_res_path:
        high_res_path = images_list[-1].get("url", "")
    return (
        high_res_path
        if high_res_path.startswith("http")
        else f"https://www.pnp.co.za{high_res_path}"
    )


@app.route("/api/search", methods=["GET"])
def handle_search():
    # 1. Grab the search keyword typed by the user in the frontend
    clean_query = request.args.get("q", "").strip().lower()

    if not clean_query:
        return jsonify([])

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101"
            " Firefox/154.0"
        ),
        "Accept": "application/json, text/plain, */*",
        "X-Anonymous-Consents": "%5B%5D",
        "X-Pnp-Search-Session-Id": "1",
        "X-Pnp-Search-Client-Id": "c2f7ad20-3c62-4c17-83e5-7cd5114dd7c4",
        "X-Pnp-Cache-Key": "anonymous",
        "Origin": "https://www.pnp.co.za",
        "Referer": f"https://www.pnp.co.za/search/{clean_query}",
    }

    cookies = {
        "route": "5aae561be1e2e76e36b6aadac2b43d34",
        "dtCookie": (
            "v_4_srv_3_sn_A64BE04E5900F794B34B7B6187292556_perc_100000_ol_0_mul_1_app-3A2ce7406a2949d129_0"
        ),
        "ConstructorioID_client_id": "c2f7ad20-3c62-4c17-83e5-7cd5114dd7c4",
        "ConstructorioID_session_id": "1",
        "ConstructorioID_session": '{"sessionId":1,"lastTime":1787587238709}',
    }

    url = (
        "https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search"
        "?fields=products(variantMatrix(FULL)%2CproductIdForTracking%2CsponsoredProduct%2ConlineSalesAdId%2ConlineSalesExtendedAdId%2Ccode%2Cname%2CbrandSellerId%2CaverageWeight%2Csummary%2Cprice(FULL)%2Cimages(DEFAULT)%2Cstock(FULL)%2CaverageRating%2CnumberOfReviews%2CvariantOptions%2CmaxOrderQuantity%2CproductDisplayBadges(DEFAULT)%2CallowedQuantities(DEFAULT)%2Cavailable%2CquantityType%2CdefaultQuantityOfUom%2CinStockIndicator%2CdefaultUnitOfMeasure%2CpotentialPromotions(FULL)%2CcategoryNames)%2Cfacets%2Cbreadcrumbs%2Cpagination(DEFAULT)%2Csorts(DEFAULT)%2CfreeTextSearch%2CcurrentQuery%2CresponseJson%2CseoCategoryContent%2CseoCategoryTitle%2CrefinedContent%2CcategoryDescription%2CkeywordRedirectUrl"
        f"&query={clean_query}&pageSize=72&storeCode=WC21&lang=en&curr=ZAR"
    )

    response = requests.post(url, cookies=cookies, headers=headers, json={})

    if response.status_code == 200:
        products = response.json().get("products", [])
        extracted_items = [
            {
                "id": f"pnp_{item.get('code')}",
                "name": item.get("name"),
                "store": "Pick n Pay",
                "price": item.get("price", {}).get("value", 0.0),
                "formattedPrice": item.get("price", {}).get(
                    "formattedValue", "R0.00"
                ),
                "imageUrl": get_high_res_image_url(item.get("images", [])),
            }
            for item in products
        ]
        # 2. Return live JSON directly to the browser
        return jsonify(extracted_items)

    return jsonify({"error": "Failed to fetch products"}), 500


if __name__ == "__main__":
    app.run(port=5000, debug=True)