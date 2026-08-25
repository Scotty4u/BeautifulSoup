"""
Pick n Pay Grocery & Household Scraper
========================================
pip install playwright beautifulsoup4
playwright install chromium
"""

import asyncio
import sqlite3
import csv
import re
from datetime import datetime
from pathlib import Path
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

BASE_URL = "https://www.pnp.co.za"
DB_PATH  = "pnp_products.db"
CSV_PATH = "pnp_products.csv"

# Direct category paths — discovered from pnpbase navigation links
CATEGORIES = [
    ("Food Cupboard",              "/food-cupboard"),
    ("Milk, Dairy & Eggs",         "/milk-dairy-and-eggs"),
    ("Beverages",                  "/beverages"),
    ("Frozen Food",                "/frozen-food"),
    ("Chocolates, Chips & Snacks", "/chocolate-chips-snacks"),
    ("Meat, Poultry & Fish",       "/meat-poultry-and-seafood"),
    ("Fresh Produce",              "/fresh-fruit-and-vegetables"),
    ("Bakery",                     "/bakery"),
    ("Household & Cleaning",       "/household-cleaning"),
    ("Personal Care",              "/personal-care-hygiene"),
    ("Baby",                       "/baby"),
    ("Health & Wellness",          "/health-wellness"),
    ("Ready Meals & Desserts",     "/ready-meals-desserts"),
    ("Deli & Party",               "/deli-and-party"),
    ("Pet Care",                   "/pet-care"),
]


def make_url(path: str, page: int) -> str:
    return f"{BASE_URL}{path}?currentPage={page}"


def get_total_pages(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    nums = []
    for a in soup.select("cx-pagination a.page"):
        txt = a.get_text(strip=True)
        if txt.isdigit():
            nums.append(int(txt))
    return max(nums) if nums else 1


def parse_products(html: str, category: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")

    # Only take real product cards — skip skeleton loaders
    real_cards = [
        c for c in soup.select(".product-grid-item")
        if not c.select_one(".skeleton-loader")
           and c.select_one(".product-grid-item__info-container__name")
    ]

    products = []
    for card in real_cards:
        # Name
        name_el = card.select_one(".product-grid-item__info-container__name span")
        name = name_el.get_text(strip=True) if name_el else None
        if not name:
            name = card.get("aria-label", "").split(",")[0].strip() or None
        if not name:
            continue

        # Price + was-price
        price_el = card.select_one(".product-grid-item__price-container .price")
        was_price = None
        if price_el:
            old_el = price_el.select_one("span.old")
            if old_el:
                was_price = old_el.get_text(strip=True)
                old_el.decompose()
            price = price_el.get_text(strip=True) or None
        else:
            price = None

        # Promo label e.g. "2 For R32.00"
        promo_el = card.select_one(".product-grid-item__promotion-container a")
        promo = promo_el.get_text(strip=True) if promo_el else None

        # URL + SKU
        link_el = card.select_one("a.product-grid-item__image-container")
        href = link_el.get("href", "") if link_el else ""
        url = BASE_URL + href if href else None
        sku = None
        if href:
            m = re.search(r"/p/([^/?#]+)", href)
            if m:
                sku = m.group(1)

        # Image
        img_el = card.select_one(".product-grid-item__image-container img")
        image = img_el.get("src") if img_el else None

        # Badge e.g. "SMART SHOPPER"
        badge_el = card.select_one(".product-grid-item__group4-badges li")
        badge = badge_el.get_text(strip=True) if badge_el else None

        products.append({
            "name":      name,
            "sku":       sku,
            "price":     price,
            "was_price": was_price,
            "promo":     promo,
            "badge":     badge,
            "category":  category,
            "url":       url,
            "image":     image,
        })

    return products


# ── Database ──────────────────────────────────────────────────────────────────

def init_db(path: str) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.execute("DROP TABLE IF EXISTS products")
    con.execute("""
        CREATE TABLE products (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            sku        TEXT,
            price      TEXT,
            was_price  TEXT,
            promo      TEXT,
            badge      TEXT,
            category   TEXT,
            url        TEXT,
            image      TEXT,
            scraped_at TEXT DEFAULT (datetime('now'))
        )
    """)
    con.execute("CREATE INDEX idx_sku ON products(sku)")
    con.commit()
    return con


def save_batch(con: sqlite3.Connection, products: list[dict], seen: set) -> int:
    inserted = 0
    for p in products:
        key = p.get("sku") or p["name"]
        if key in seen:
            continue
        seen.add(key)
        con.execute("""
            INSERT INTO products
                (name, sku, price, was_price, promo, badge, category, url, image)
            VALUES
                (:name, :sku, :price, :was_price, :promo, :badge, :category, :url, :image)
        """, p)
        inserted += 1
    con.commit()
    return inserted


def export_csv(con: sqlite3.Connection, path: str):
    cur = con.execute("SELECT * FROM products")
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(rows)
    print(f"✅ CSV  → {path}  ({len(rows)} rows)")


# ── Playwright ────────────────────────────────────────────────────────────────

async def fetch_page(browser, url: str) -> str:
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
    await context.route("**/*.{mp4,mov,woff,woff2,ttf,eot,gif}", lambda r: r.abort())
    page = await context.new_page()

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
    except Exception as e:
        print(f"    ⚠️  goto (non-fatal): {e}")

    # Wait for skeleton loaders to be REPLACED by real product cards
    # Real cards have aria-label with product name; skeletons don't
    try:
        await page.wait_for_selector(
            ".product-grid-item[aria-label]",
            timeout=30_000
        )
        print(f"    ✓ Real products loaded")
    except Exception:
        print(f"    ⚠️  Real products didn't appear (still skeletons?)")

    # Scroll to trigger any remaining lazy cards
    for _ in range(6):
        await page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
        await asyncio.sleep(1)
    await asyncio.sleep(2)

    html = await page.content()
    await context.close()
    return html


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print(f"Pick n Pay Grocery Scraper — {datetime.now():%Y-%m-%d %H:%M}")
    print(f"Scraping {len(CATEGORIES)} categories")
    print("=" * 60)

    con = init_db(DB_PATH)
    seen: set   = set()
    grand_total = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )

        for cat_name, cat_path in CATEGORIES:
            print(f"\n📦 {cat_name}  ({cat_path})")
            print("-" * 50)
            cat_total = 0

            # Page 0 — also detects total pages
            url = make_url(cat_path, 0)
            try:
                html = await fetch_page(browser, url)
            except Exception as e:
                print(f"  ❌ Failed to load first page: {e}")
                continue

            total_pages = get_total_pages(html)
            products    = parse_products(html, cat_name)

            if not products:
                print(f"  ⚠️  0 products on page 1 — skipping category")
                continue

            inserted = save_batch(con, products, seen)
            cat_total += inserted
            print(f"  Pages: {total_pages}  |  Page 1 → {inserted}/{len(products)} saved")

            for page_num in range(1, total_pages):
                url = make_url(cat_path, page_num)
                try:
                    html     = await fetch_page(browser, url)
                    products = parse_products(html, cat_name)
                    inserted = save_batch(con, products, seen)
                    cat_total += inserted
                    print(f"  Page {page_num+1}/{total_pages} → {inserted}/{len(products)} saved")
                    await asyncio.sleep(0.5)
                except Exception as e:
                    print(f"  ❌ Page {page_num+1} failed: {e}")

            print(f"  ✅ {cat_name}: {cat_total} products")
            grand_total += cat_total

        await browser.close()

    total_db = con.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    print(f"\n{'='*60}")
    print(f"Grand total : {grand_total}")
    print(f"Total in DB : {total_db}")
    print(f"✅ DB  → {DB_PATH}")
    export_csv(con, CSV_PATH)

    print("\nBy category:")
    for row in con.execute(
        "SELECT category, COUNT(*) FROM products GROUP BY category ORDER BY COUNT(*) DESC"
    ):
        print(f"  {row[0]:<35} {row[1]} products")

    print("\nSample:")
    for row in con.execute(
        "SELECT name, price, was_price, promo, category FROM products LIMIT 6"
    ):
        print(f"  {row}")

    con.close()


if __name__ == "__main__":
    asyncio.run(main())