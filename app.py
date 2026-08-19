import asyncio
import sqlite3
import re
from datetime import datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright


# ============================================================
# CONFIGURATION
# ============================================================

URL = "https://www.shoprite.co.za/"
DATABASE = "shoprite.db"


# ============================================================
# DATABASE
# ============================================================

def create_database():

    connection = sqlite3.connect(DATABASE)
    cursor = connection.cursor()

    # --------------------------------------------------------
    # Check whether the products table already exists
    # --------------------------------------------------------

    cursor.execute("""
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name = 'products'
    """)

    table_exists = cursor.fetchone()

    # --------------------------------------------------------
    # If the table does not exist, create it
    # --------------------------------------------------------

    if not table_exists:

        print("Creating products database...")

        cursor.execute("""
            CREATE TABLE products (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                name TEXT NOT NULL,

                price REAL,

                original_price REAL,

                discount REAL,

                brand TEXT,

                category TEXT,

                size TEXT,

                promotion TEXT,

                product_url TEXT,

                image_url TEXT,

                scraped_at TEXT NOT NULL,

                UNIQUE(name, product_url)

            )
        """)

        connection.commit()
        connection.close()

        print("Database created successfully.")

        return

    # --------------------------------------------------------
    # Check existing table indexes
    # --------------------------------------------------------

    cursor.execute("""
        PRAGMA index_list(products)
    """)

    indexes = cursor.fetchall()

    has_unique_constraint = False

    for index in indexes:

        # SQLite PRAGMA index_list columns:
        # seq, name, unique, origin, partial

        index_name = index[1]
        is_unique = index[2]

        if is_unique:

            cursor.execute(
                f'PRAGMA index_info("{index_name}")'
            )

            columns = cursor.fetchall()

            column_names = [
                column[2]
                for column in columns
            ]

            if column_names == [
                "name",
                "product_url"
            ]:

                has_unique_constraint = True

                break

    # --------------------------------------------------------
    # If the UNIQUE constraint exists, nothing to do
    # --------------------------------------------------------

    if has_unique_constraint:

        connection.close()

        print("Database structure OK.")

        return

    # --------------------------------------------------------
    # Existing database is missing the required UNIQUE
    # constraint.
    #
    # Rebuild the table so ON CONFLICT(name, product_url)
    # works correctly.
    # --------------------------------------------------------

    print(
        "Existing database is missing the required "
        "UNIQUE(name, product_url) constraint."
    )

    print("Updating database structure...")

    # Create replacement table

    cursor.execute("""
        CREATE TABLE products_new (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,

            price REAL,

            original_price REAL,

            discount REAL,

            brand TEXT,

            category TEXT,

            size TEXT,

            promotion TEXT,

            product_url TEXT,

            image_url TEXT,

            scraped_at TEXT NOT NULL,

            UNIQUE(name, product_url)

        )
    """)

    # --------------------------------------------------------
    # Copy old data.
    #
    # INSERT OR IGNORE prevents duplicate
    # (name, product_url) combinations from causing problems.
    # --------------------------------------------------------

    cursor.execute("""
        INSERT OR IGNORE INTO products_new (
            id,
            name,
            price,
            original_price,
            discount,
            brand,
            category,
            size,
            promotion,
            product_url,
            image_url,
            scraped_at
        )

        SELECT
            id,
            name,
            price,
            original_price,
            discount,
            brand,
            category,
            size,
            promotion,
            product_url,
            image_url,
            scraped_at

        FROM products
    """)

    # Delete old table

    cursor.execute("""
        DROP TABLE products
    """)

    # Rename replacement table

    cursor.execute("""
        ALTER TABLE products_new
        RENAME TO products
    """)

    connection.commit()
    connection.close()

    print("Database structure updated successfully.")


# ============================================================
# CLEAN PRICE
# ============================================================

def clean_price(text):

    if not text:
        return None

    # Remove spaces

    text = text.replace(" ", "")

    # Find something like:
    #
    # R19.99
    # R19
    # 19.99

    match = re.search(
        r"R?(\d+(?:[.,]\d{1,2})?)",
        text,
        re.IGNORECASE
    )

    if not match:

        return None

    value = match.group(1)

    value = value.replace(",", ".")

    try:

        return float(value)

    except ValueError:

        return None


# ============================================================
# GET PAGE WITH PLAYWRIGHT
# ============================================================

async def download_page():

    async with async_playwright() as p:

        browser = await p.chromium.launch(
            headless=True
        )

        page = await browser.new_page(

            viewport={
                "width": 1920,
                "height": 1080
            },

            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/151.0.0.0 Safari/537.36"
            )
        )

        print("Opening Shoprite...")

        await page.goto(
            URL,
            wait_until="domcontentloaded",
            timeout=60000
        )

        print("Waiting for page to render...")

        await page.wait_for_timeout(8000)

        # ----------------------------------------------------
        # Scroll to trigger lazy loading
        # ----------------------------------------------------

        for _ in range(5):

            await page.mouse.wheel(
                0,
                1000
            )

            await page.wait_for_timeout(1000)

        # ----------------------------------------------------
        # Get rendered HTML
        # ----------------------------------------------------

        html = await page.content()

        # ----------------------------------------------------
        # Save a copy so we can inspect it
        # ----------------------------------------------------

        with open(
            "rendered_shoprite.html",
            "w",
            encoding="utf-8"
        ) as file:

            file.write(html)

        await browser.close()

        return html


# ============================================================
# PARSE PRODUCTS
# ============================================================

def parse_products(html):

    soup = BeautifulSoup(
        html,
        "html.parser"
    )

    products = []

    # --------------------------------------------------------
    # Find product cards
    # --------------------------------------------------------

    cards = soup.select(
        '[data-testid="product-card"]'
    )

    print(
        f"Product cards found: {len(cards)}"
    )

    # --------------------------------------------------------
    # Fallback selector
    # --------------------------------------------------------

    if not cards:

        cards = soup.select(
            '[class*="product-card"]'
        )

        print(
            f"Fallback product cards found: {len(cards)}"
        )

    # --------------------------------------------------------
    # Process each card
    # --------------------------------------------------------

    for card in cards:

        # ----------------------------------------------------
        # PRODUCT NAME
        # ----------------------------------------------------

        name = None

        name_element = card.select_one(
            '[data-testid="product-name"]'
        )

        if not name_element:

            name_element = card.select_one(
                '[class*="name"]'
            )

        if name_element:

            name = name_element.get_text(
                " ",
                strip=True
            )

        # ----------------------------------------------------
        # PRICE
        # ----------------------------------------------------

        price = None

        price_element = card.select_one(
            '[data-testid="product-price"]'
        )

        if not price_element:

            price_element = card.select_one(
                '[class*="price"]'
            )

        if price_element:

            price = clean_price(
                price_element.get_text(
                    " ",
                    strip=True
                )
            )

        # ----------------------------------------------------
        # IMAGE
        # ----------------------------------------------------

        image_url = None

        image = card.select_one("img")

        if image:

            image_url = (
                image.get("src")
                or image.get("data-src")
                or image.get("data-lazy-src")
            )

            if image_url:

                image_url = urljoin(
                    URL,
                    image_url
                )

        # ----------------------------------------------------
        # PRODUCT LINK
        # ----------------------------------------------------

        product_url = None

        link = card.select_one("a")

        if link:

            href = link.get("href")

            if href:

                product_url = urljoin(
                    URL,
                    href
                )

        # ----------------------------------------------------
        # ONLY SAVE ACTUAL PRODUCTS
        # ----------------------------------------------------

        if name:

            product = {

                "name": name,

                "price": price,

                "original_price": None,

                "discount": None,

                "brand": None,

                "category": None,

                "size": None,

                "promotion": None,

                "product_url": product_url,

                "image_url": image_url

            }

            products.append(product)

    return products


# ============================================================
# SAVE TO DATABASE
# ============================================================

def save_products(products):

    connection = sqlite3.connect(
        DATABASE
    )

    cursor = connection.cursor()

    saved_count = 0
    updated_count = 0

    # --------------------------------------------------------
    # Current scrape time
    # --------------------------------------------------------

    scraped_at = datetime.now().isoformat()

    # --------------------------------------------------------
    # Save every product
    # --------------------------------------------------------

    for product in products:

        # ----------------------------------------------------
        # Check whether this product already exists
        # ----------------------------------------------------

        cursor.execute("""
            SELECT id
            FROM products
            WHERE name = ?
            AND product_url IS ?
        """, (
            product["name"],
            product["product_url"]
        ))

        existing = cursor.fetchone()

        # ----------------------------------------------------
        # Insert or update
        # ----------------------------------------------------

        cursor.execute("""
            INSERT INTO products (

                name,
                price,
                original_price,
                discount,
                brand,
                category,
                size,
                promotion,
                product_url,
                image_url,
                scraped_at

            )

            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

            ON CONFLICT(name, product_url)

            DO UPDATE SET

                price = excluded.price,

                original_price =
                    excluded.original_price,

                discount =
                    excluded.discount,

                brand =
                    excluded.brand,

                category =
                    excluded.category,

                size =
                    excluded.size,

                promotion =
                    excluded.promotion,

                image_url =
                    excluded.image_url,

                scraped_at =
                    excluded.scraped_at

        """, (

            product["name"],

            product["price"],

            product["original_price"],

            product["discount"],

            product["brand"],

            product["category"],

            product["size"],

            product["promotion"],

            product["product_url"],

            product["image_url"],

            scraped_at

        ))

        if existing:

            updated_count += 1

        else:

            saved_count += 1

    connection.commit()

    connection.close()

    print(
        f"New products: {saved_count}"
    )

    print(
        f"Updated products: {updated_count}"
    )


# ============================================================
# SHOW DATABASE STATISTICS
# ============================================================

def show_database_stats():

    connection = sqlite3.connect(
        DATABASE
    )

    cursor = connection.cursor()

    cursor.execute("""
        SELECT COUNT(*)
        FROM products
    """)

    result = cursor.fetchone()

    total_products = result[0]

    connection.close()

    print(
        f"Total products in database: {total_products}"
    )


# ============================================================
# MAIN
# ============================================================

async def main():

    print("=" * 60)

    print("SHOPRITE PRODUCT SCRAPER")

    print("=" * 60)

    # --------------------------------------------------------
    # Create / repair database
    # --------------------------------------------------------

    create_database()

    # --------------------------------------------------------
    # Download Shoprite
    # --------------------------------------------------------

    html = await download_page()

    # --------------------------------------------------------
    # Parse products
    # --------------------------------------------------------

    print(
        "\nParsing rendered HTML..."
    )

    products = parse_products(
        html
    )

    print(
        f"Products extracted: {len(products)}"
    )

    # --------------------------------------------------------
    # Save products
    # --------------------------------------------------------

    if products:

        print(
            "\nSaving products to database..."
        )

        save_products(
            products
        )

        print(
            "\nProducts successfully saved!"
        )

        show_database_stats()

    else:

        print(
            "\nWARNING:"
        )

        print(
            "No products were detected."
        )

        print(
            "Open rendered_shoprite.html "
            "and inspect the actual product structure."
        )

    # --------------------------------------------------------
    # Database location
    # --------------------------------------------------------

    print(
        "\nDatabase:"
    )

    print(
        DATABASE
    )

    print(
        "\nDone."
    )


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    asyncio.run(
        main()
    )