import json
import requests

cookies = {
    'storeContexts': '%5B%7B%22storeId%22%3A%2265ddb7b35511bf8f03a90564%22%2C%22serviceOptionIds%22%3A%5B%22sixty-min-delivery%22%5D%2C%22brandPriority%22%3A8%2C%22hasCapacity%22%3A%5B%22sixty-min-delivery%22%5D%2C%22distanceFromCustomer%22%3A0.0034009759877851827%2C%22returnServiceOptionIds%22%3Anull%2C%22hasReturnCapacity%22%3Anull%7D%2C%7B%22storeId%22%3A%2265cb65a1f88f400671ab9c79%22%2C%22serviceOptionIds%22%3A%5B%22sixty-min-delivery%22%5D%2C%22brandPriority%22%3A4%2C%22hasCapacity%22%3A%5B%22sixty-min-delivery%22%5D%2C%22distanceFromCustomer%22%3A0.0034009759877851827%2C%22returnServiceOptionIds%22%3Anull%2C%22hasReturnCapacity%22%3Anull%7D%5D',
    'storeids': '65ddb7b35511bf8f03a90564-65cb65a1f88f400671ab9c79',
    'istio-storeIds': '65ddb7b35511bf8f03a90564-65cb65a1f88f400671ab9c79',
    # Note: If status code is 403, update this AWS WAF token from your browser DevTools
    'aws-waf-token': '48a073ca-b7f1-4644-a071-46d6b6433e08:CgoAtAZ3yJ42AQAA:tRTw8lJleygJjPnUxMxyhLKxljDiH7vWC218z73X1wzVFE6KuyRTTseq+q9v/HO+eQLYfC8TYwSxfdICrjA4VoKDEPbrXYKOLFFimI69nruOEovSsAJ3x6FxmDv3141tQH3sZt0YAjgnhsJLf0qbmdonjsZQpPfLqR8yFdLISBlQirAyiVUgyAGr+gKm+FoW0KJmSWT4xYeBL+q3ktRRHH7gWhMH2qnkPD9poyoxyzB0V1NKpGpsoDl1O9SjYG/Bok2I4kjXe8KOB5QOj8BLlFo9RdF2HfQ=',
}

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0',
    'Accept': 'application/json, text/plain, */*',
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
            'productListSource': {'search': 'milk'},
            'paginationOptions': {'page': 0, 'pageSize': 2},
            'filterOptions': {'dealsOnly': False, 'serviceOptions': [], 'facetOptions': []},
            'sortOptions': None,
        },
        'displayOptions': {},
    },
    'forYouBonusBuyIds': [],
}

print("Sending request to Shoprite API...")
response = requests.post(
    'https://www.shoprite.co.za/api/catalogue/get-products-filter',
    cookies=cookies,
    headers=headers,
    json=json_data,
)

print(f"\n[HTTP Status Code]: {response.status_code}")

if response.status_code == 200:
    data = response.json()
    print(f"[Top-level Keys]: {list(data.keys())}")
    
    # Locate product array
    products = data.get('products') or data.get('filterResult', {}).get('products', [])
    print(f"[Products Found]: {len(products)}")

    if products:
        item = products[0]
        print("\n--- FIRST PRODUCT RAW DATA ---")
        print(f"Name: {item.get('name') or item.get('title')}")
        print(f"Code/ID: {item.get('code') or item.get('id')}")
        
        print("\n--- ALL IMAGE-RELATED KEYS FOUND IN THIS ITEM ---")
        for key, val in item.items():
            if any(term in key.lower() for term in ['image', 'img', 'media', 'picture', 'photo', 'url']):
                print(f"Key: '{key}' -> Value: {json.dumps(val, indent=2)}")
else:
    print(f"Request failed. Response snippet:\n{response.text[:300]}")