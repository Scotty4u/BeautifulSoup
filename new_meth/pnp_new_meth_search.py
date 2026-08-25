import json
import requests


def get_high_res_image_url(images_list):
    """Extracts high-resolution images rather than thumbnails."""
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


def scrape_pnp(search_term: str):
    # Clean the input search term
    clean_query = search_term.strip().lower()

    # Dynamic headers with matching Referer
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101"
            " Firefox/154.0"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Anonymous-Consents": "%5B%5D",
        "X-Pnp-Search-Session-Id": "1",
        "X-Pnp-Search-Client-Id": "c2f7ad20-3c62-4c17-83e5-7cd5114dd7c4",
        "X-Pnp-Cache-Key": "anonymous",
        "Origin": "https://www.pnp.co.za",
        "Connection": "keep-alive",
        "Referer": f"https://www.pnp.co.za/search/{clean_query}",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
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

    # Dynamic URL injecting the search term
    url = (
        "https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search"
        "?fields=products(variantMatrix(FULL)%2CproductIdForTracking%2CsponsoredProduct%2ConlineSalesAdId%2ConlineSalesExtendedAdId%2Ccode%2Cname%2CbrandSellerId%2CaverageWeight%2Csummary%2Cprice(FULL)%2Cimages(DEFAULT)%2Cstock(FULL)%2CaverageRating%2CnumberOfReviews%2CvariantOptions%2CmaxOrderQuantity%2CproductDisplayBadges(DEFAULT)%2CallowedQuantities(DEFAULT)%2Cavailable%2CquantityType%2CdefaultQuantityOfUom%2CinStockIndicator%2CdefaultUnitOfMeasure%2CpotentialPromotions(FULL)%2CcategoryNames)%2Cfacets%2Cbreadcrumbs%2Cpagination(DEFAULT)%2Csorts(DEFAULT)%2CfreeTextSearch%2CcurrentQuery%2CresponseJson%2CseoCategoryContent%2CseoCategoryTitle%2CrefinedContent%2CcategoryDescription%2CkeywordRedirectUrl"
        f"&query={clean_query}&pageSize=72&storeCode=WC21&lang=en&curr=ZAR"
    )

    print(f"Scraping results for '{clean_query}'...")
    response = requests.post(url, cookies=cookies, headers=headers, json={})

    if response.status_code == 200:
        products = response.json().get("products", [])
        extracted_items = []

        for item in products:
            extracted_items.append({
                "id": f"pnp_{item.get('code')}",
                "name": item.get("name"),
                "store": "Pick n Pay",
                "storeCode": "WC21",
                "price": item.get("price", {}).get("value", 0.0),
                "formattedPrice": item.get("price", {}).get(
                    "formattedValue", "R0.00"
                ),
                "imageUrl": get_high_res_image_url(item.get("images", [])),
            })

        # Save to a dynamically named JSON file
        output_filename = f"pnp_{clean_query}_products.json"
        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(extracted_items, f, indent=4)

        print(
            f"Done! Saved {len(extracted_items)} items to '{output_filename}'."
        )
        return output_filename
    else:
        print(f"Failed with status: {response.status_code}")
        return None


# Example usage:
if __name__ == "__main__":
    scrape_pnp("milk")
    scrape_pnp("butter")