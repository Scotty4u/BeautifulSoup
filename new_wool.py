"""
Woolworths ZA Product Scraper
================================
Products load via Dynamic Yield (st-eu.dynamicyield.com/spa/json)
and Woolworths' own getleftNav endpoint.

pip install playwright
playwright install chromium
"""

import asyncio
import json
import re
import csv
import sqlite3
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright, Response

# ── Config ────────────────────────────────────────────────────────────────────
TARGET_URL = "https://www.woolworths.co.za/browse/food-south-africa"
DB_PATH    = "woolworths.db"
CSV_PATH   = "woolworths_products.csv"
DEBUG_DIR  = Path("debug_responses")
DEBUG_HTML = Path("debug_page.html")

# Only intercept these — everything else is noise
PRODUCT_URL_PATTERNS = [
    r"dynamicyield\.com/spa/json",   # main product feed
    r"woolworths\.co\.za/server/",   # internal Woolworths API (getleftNav, search, etc.)
]
# ─────────────────────────────────────────────────────────────────────────────


def is_product_url(url: str) -> bool:
    return any(re.search(p, url) for p in PRODUCT_URL_PATTERNS)


# ── Dynamic Yield response parser ─────────────────────────────────────────────

def parse_dynamic_yield(data: dict) -> list[dict]:
    """
    Dynamic Yield wraps products inside:
      data["itemsData"]["slots"][N]["data"]["items"][N]
    or sometimes directly in:
      data["slots"][N]["data"]["items"]
    """
    products = []

    def walk_slots(slots):
        for slot in slots:
            if not isinstance(slot, dict):
                continue
            slot_data = slot.get("data", {})

            # Direct items list
            items = slot_data.get("items") or slot_data.get("products") or []
            for item in items:
                if isinstance(item, dict):
                    products.append(item)

            # Sometimes nested under "slots" again
            inner = slot_data.get("slots", [])
            if inner:
                walk_slots(inner)

    # Try top-level itemsData
    items_data = data.get("itemsData", {})
    slots = items_data.get("slots", [])
    if slots:
        walk_slots(slots)

    # Also try top-level slots
    if not products:
        slots = data.get("slots", [])
        if slots:
            walk_slots(slots)

    # Last resort: find any list of dicts with a "name" or "sku" key
    if not products:
        products = generic_find_products(data)

    return products


def generic_find_products(data, depth=0) -> list:
    """Fallback: recursively find any list that looks like products."""
    if depth > 6:
        return []
    product_keys = {"name", "sku", "price", "displayname", "productname",
                    "displayprice", "imageurl", "thumbnail"}
    if isinstance(data, list) and data:
        sample = data[0]
        if isinstance(sample, dict):
            keys = {k.lower() for k in sample}
            if keys & product_keys:
                return data
    if isinstance(data, dict):
        for key in ("products", "items", "records", "results", "data",
                    "productList", "catalogEntryView"):
            if key in data and isinstance(data[key], list):
                result = generic_find_products(data[key], depth + 1)
                if result:
                    return result
        for v in data.values():
            if isinstance(v, (dict, list)):
                result = generic_find_products(v, depth + 1)
                if result:
                    return result
    return []


def parse_woolworths_api(data: dict) -> list[dict]:
    """Parse Woolworths' own /server/ API responses."""
    return generic_find_products(data)


def normalise(raw: dict) -> dict | None:
    """Map a raw product dict to clean fields."""
    lc = {k.lower().replace("_", "").replace("-", ""): v for k, v in raw.items()}

    def get(*keys):
        for k in keys:
            norm = k.lower().replace("_", "").replace("-", "")
            if norm in lc:
                return lc[norm]
        return None

    name = get("name", "displayName", "productName", "title", "itemName")
    if not name:
        return None
    name = str(name).strip()
    if not name or name.startswith("Affinity_") or re.match(r"^[A-Z0-9]{15,}$", name):
        return None  # skip CRM IDs

    price_raw = get("price", "displayPrice", "sellPrice", "listPrice",
                    "salePrice", "priceInfo", "skuPrice")
    if isinstance(price_raw, dict):
        price = (price_raw.get("formattedValue")
                 or price_raw.get("value")
                 or price_raw.get("min")
                 or price_raw.get("amount"))
    elif isinstance(price_raw, (int, float)):
        price = f"{price_raw:.2f}"
    else:
        price = price_raw

    image = get("imageUrl", "thumbnail", "image", "smallImage",
                "productImage", "images", "imageSet")
    if isinstance(image, dict):
        image = image.get("url") or image.get("src") or image.get("medium")
    elif isinstance(image, list) and image:
        first = image[0]
        image = first.get("url") if isinstance(first, dict) else first
    if image and not str(image).startswith("http"):
        image = "https://www.woolworths.co.za" + str(image)

    url = get("url", "pdpUrl", "link", "productUrl", "seoUrl", "pageUrl")
    if url and not str(url).startswith("http"):
        url = "https://www.woolworths.co.za" + str(url)

    sku = get("sku", "id", "productId", "stockCode", "itemNo", "code",
              "productCode", "repositoryId")

    return {
        "name":     name,
        "sku":      str(sku).strip() if sku else None,
        "price":    str(price).strip() if price else None,
        "brand":    get("brand", "brandName", "manufacturer"),
        "category": get("category", "categoryName", "breadcrumb"),
        "url":      url,
        "image":    image,
        "in_stock": get("inStock", "available", "stockStatus", "availability"),
        "rating":   get("rating", "averageRating", "reviewRating"),
    }


# ── Database ──────────────────────────────────────────────────────────────────

def init_db(path: str) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    # Drop and recreate if schema is stale
    con.execute("DROP TABLE IF EXISTS products")
    con.execute("""
        CREATE TABLE products (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            sku        TEXT,
            price      TEXT,
            brand      TEXT,
            category   TEXT,
            url        TEXT,
            image      TEXT,
            in_stock   TEXT,
            rating     TEXT,
            scraped_at TEXT DEFAULT (datetime('now'))
        )
    """)
    con.execute("CREATE INDEX IF NOT EXISTS idx_sku ON products(sku)")
    con.commit()
    return con


def upsert(con: sqlite3.Connection, p: dict, seen: set) -> bool:
    # Deduplicate in memory — no ON CONFLICT needed
    key = (p.get("name"), p.get("sku"))
    if key in seen:
        return False
    seen.add(key)
    try:
        con.execute("""
            INSERT INTO products (name, sku, price, brand, category, url, image, in_stock, rating)
            VALUES (:name, :sku, :price, :brand, :category, :url, :image, :in_stock, :rating)
        """, p)
        con.commit()
        return True
    except Exception as e:
        print(f"    DB error: {e}")
        return False


def export_csv(con: sqlite3.Connection, path: str):
    cur = con.execute("SELECT * FROM products")
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(rows)
    print(f"✅ CSV  → {path}  ({len(rows)} rows)")


# ── Scraper ───────────────────────────────────────────────────────────────────

async def scrape(con: sqlite3.Connection) -> int:
    DEBUG_DIR.mkdir(exist_ok=True)
    resp_count = 0
    inserted   = 0
    seen: set  = set()   # in-memory dedup

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
        await context.route("**/*.{mp4,mov,avi,webm,woff,woff2,ttf,eot}",
                            lambda route: route.abort())

        page = await context.new_page()

        async def handle_response(resp: Response):
            nonlocal resp_count, inserted
            try:
                if not is_product_url(resp.url):
                    return
                ct = resp.headers.get("content-type", "")
                if "json" not in ct:
                    return
                body = await resp.body()
                if len(body) < 100:
                    return

                data = json.loads(body)
                resp_count += 1

                slug = re.sub(r"[^a-zA-Z0-9]", "_", resp.url)[-80:]
                (DEBUG_DIR / f"{resp_count:03d}_{slug}.json").write_bytes(body)

                print(f"  [{resp_count:03d}] {resp.url[:100]}")

                # Choose parser based on source
                if "dynamicyield" in resp.url:
                    raw_products = parse_dynamic_yield(data)
                else:
                    raw_products = parse_woolworths_api(data)

                if not raw_products:
                    print(f"        — no products found in response")
                    return

                batch = 0
                for raw in raw_products:
                    if not isinstance(raw, dict):
                        continue
                    p = normalise(raw)
                    if p and upsert(con, p, seen):
                        batch += 1

                inserted += batch
                print(f"        ✅ {batch}/{len(raw_products)} products saved")

            except Exception as e:
                print(f"    ⚠️  Error: {e}")

        page.on("response", handle_response)

        print(f"\nLoading {TARGET_URL}")
        try:
            await page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=90_000)
        except Exception as e:
            print(f"⚠️  goto (non-fatal): {e}")

        print("Waiting 6s for JS to boot ...")
        await asyncio.sleep(6)

        print("Scrolling to trigger lazy-loaded batches ...")
        for i in range(8):
            await page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
            await asyncio.sleep(2)
            print(f"  scroll {i+1}/8")

        await asyncio.sleep(4)

        html = await page.content()
        DEBUG_HTML.write_text(html, encoding="utf-8")
        print(f"\nSaved rendered HTML → {DEBUG_HTML}")

        await browser.close()

    return inserted


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print(f"Woolworths ZA Scraper — {datetime.now():%Y-%m-%d %H:%M}")
    print("=" * 55)

    con = init_db(DB_PATH)
    inserted = await scrape(con)

    total = con.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    print(f"\n{'='*55}")
    print(f"Saved this run : {inserted}")
    print(f"Total in DB    : {total}")
    print(f"✅ DB  → {DB_PATH}")

    if total > 0:
        export_csv(con, CSV_PATH)
        # Preview first 5
        print("\nSample products:")
        for row in con.execute("SELECT name, sku, price FROM products LIMIT 5"):
            print(f"  {row}")
    else:
        print("\n❌ No products found — check debug_responses/ for the raw JSON.")

    con.close()


if __name__ == "__main__":
    asyncio.run(main())