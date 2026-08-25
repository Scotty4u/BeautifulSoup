"""
Woolworths ZA Product Scraper
===============================
Strategy: Use Playwright to intercept the XHR/fetch API calls that the
browser makes when loading product listings — since the page is fully
JS-rendered, plain HTML scraping returns nothing.

Two modes:
  1. API intercept (fastest) — captures the JSON payloads directly
  2. DOM fallback             — reads rendered product cards if API shape changes

Requirements:
    pip install playwright
    playwright install chromium
"""

import asyncio
import json
import re
import csv
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright, Request, Response

# ── Config ────────────────────────────────────────────────────────────────────
TARGET_URL = "https://www.woolworths.co.za/browse/food-south-africa"

# Patterns that Woolworths XHR product calls match
API_PATTERNS = [
    r"/server/search/search",
    r"/api/products",
    r"/browse/",          # sometimes the browse endpoint returns JSON
    r"Nrpp=",            # Oracle ATG pagination param
    r"endeca",
]

OUTPUT_JSON = "woolworths_products.json"
OUTPUT_CSV  = "woolworths_products.csv"
# ─────────────────────────────────────────────────────────────────────────────


def is_product_api_call(url: str) -> bool:
    return any(re.search(p, url) for p in API_PATTERNS)


def extract_products_from_json(data: dict | list) -> list[dict]:
    """
    Woolworths typically wraps products inside a nested JSON object.
    This tries common keys and falls back to a recursive search.
    """
    products = []

    # Common wrapper keys seen in Oracle ATG / custom APIs
    for key in ("products", "records", "items", "results", "contents",
                "productList", "product", "ProductList"):
        if isinstance(data, dict) and key in data:
            candidate = data[key]
            if isinstance(candidate, list) and len(candidate) > 0:
                products = candidate
                break
            elif isinstance(candidate, dict):
                # recurse one level
                products = extract_products_from_json(candidate)
                if products:
                    break

    # If still nothing, try to find any list that looks like products
    if not products and isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list) and len(v) > 2:
                # Heuristic: a product list item usually has a name/price key
                if any(
                    any(k in str(item).lower() for k in ("name", "price", "sku", "displayname"))
                    for item in v[:3] if isinstance(item, dict)
                ):
                    products = v
                    break

    return products


def normalise_product(raw: dict) -> dict:
    """Flatten a raw product dict into a clean, consistent shape."""
    # Woolworths uses camelCase and sometimes nested dicts
    def get(*keys):
        for k in keys:
            if k in raw:
                return raw[k]
        return None

    price_raw = get("price", "displayPrice", "priceInfo")
    if isinstance(price_raw, dict):
        price = price_raw.get("formattedValue") or price_raw.get("value") or price_raw.get("min")
    else:
        price = price_raw

    image = get("thumbnail", "imageUrl", "smallImage", "image")
    if isinstance(image, dict):
        image = image.get("url") or image.get("src")

    return {
        "name":        get("displayName", "name", "title", "productName"),
        "sku":         get("sku", "id", "productId", "code"),
        "price":       price,
        "brand":       get("brand", "brandName"),
        "category":    get("category", "breadcrumb", "categoryName"),
        "url":         get("url", "pdpUrl", "link"),
        "image":       image,
        "in_stock":    get("inStock", "available", "stockStatus"),
        "rating":      get("rating", "averageRating", "reviewRating"),
        "raw":         raw,   # keep original for debugging
    }


async def scrape_via_api_intercept(page, url: str) -> list[dict]:
    """
    Navigate to the page and collect all product API responses.
    Returns a flat list of normalised product dicts.
    """
    captured: list[dict] = []

    async def handle_response(response: Response):
        try:
            if not is_product_api_call(response.url):
                return
            content_type = response.headers.get("content-type", "")
            if "json" not in content_type:
                return
            body = await response.json()
            print(f"  ↳ Captured API response from: {response.url[:120]}")
            products = extract_products_from_json(body)
            if products:
                print(f"    Found {len(products)} products in this response")
                captured.extend(products)
            else:
                # Save raw for inspection
                Path("debug_response.json").write_text(json.dumps(body, indent=2))
                print("    ⚠️  No products parsed — saved raw JSON to debug_response.json")
        except Exception as e:
            print(f"    ⚠️  Could not parse response: {e}")

    page.on("response", handle_response)

    print(f"Navigating to {url} ...")
    await page.goto(url, wait_until="networkidle", timeout=60_000)

    # Scroll to trigger lazy-loaded batches
    print("Scrolling to trigger lazy loads ...")
    for _ in range(5):
        await page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
        await asyncio.sleep(1.5)

    # Wait a bit more for any pending XHR
    await asyncio.sleep(3)

    return [normalise_product(p) for p in captured]


async def scrape_via_dom(page) -> list[dict]:
    """
    Fallback: read rendered product cards from the DOM.
    Adjust selectors if Woolworths changes their markup.
    """
    print("Falling back to DOM scraping ...")

    selectors = [
        # Common Woolworths product card selectors (inspect and update as needed)
        ".product-list__item",
        ".product-card",
        "[class*='ProductCard']",
        "[class*='product-tile']",
        "[data-product-id]",
        "article[data-sku]",
    ]

    for sel in selectors:
        count = await page.locator(sel).count()
        if count > 0:
            print(f"  Found {count} elements matching '{sel}'")
            break
    else:
        print("  ⚠️  No product card selector matched — inspect the page markup.")
        return []

    products = []
    cards = page.locator(sel)
    for i in range(await cards.count()):
        card = cards.nth(i)
        try:
            name  = await card.get_attribute("data-name")  or \
                    await card.locator("[class*='name'], [class*='title']").first.inner_text()
            price = await card.get_attribute("data-price") or \
                    await card.locator("[class*='price']").first.inner_text()
            sku   = await card.get_attribute("data-product-id") or \
                    await card.get_attribute("data-sku")
            products.append({"name": name, "sku": sku, "price": price, "raw": {}})
        except Exception:
            pass

    return products


def save_results(products: list[dict], json_path: str, csv_path: str):
    # JSON
    Path(json_path).write_text(json.dumps(products, indent=2, default=str))
    print(f"✅ Saved {len(products)} products to {json_path}")

    # CSV (exclude raw column)
    if products:
        fields = [k for k in products[0] if k != "raw"]
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(products)
        print(f"✅ Saved CSV to {csv_path}")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="en-ZA",
            timezone_id="Africa/Johannesburg",
        )

        # Block images/fonts to speed up loading
        await context.route(
            "**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}",
            lambda route: route.abort(),
        )

        page = await context.new_page()

        products = await scrape_via_api_intercept(page, TARGET_URL)

        if not products:
            print("API intercept found no products — trying DOM fallback ...")
            products = await scrape_via_dom(page)

        await browser.close()

    if products:
        save_results(products, OUTPUT_JSON, OUTPUT_CSV)
    else:
        print("\n❌ No products found.")
        print("Next steps:")
        print("  1. Open Chrome DevTools → Network → XHR/Fetch tab")
        print("     Reload the page and look for calls returning product JSON")
        print("  2. Note the URL pattern and add it to API_PATTERNS at the top of this script")
        print("  3. Check debug_response.json if it was created — shows the raw JSON shape")


if __name__ == "__main__":
    print(f"Woolworths ZA Scraper — {datetime.now():%Y-%m-%d %H:%M}")
    asyncio.run(main())