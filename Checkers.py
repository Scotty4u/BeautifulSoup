import os
import re
import sqlite3
import asyncio

from datetime import datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

CHECKERS_URL = "https://www.checkers.co.za/"

DATABASE_FOLDER = os.path.join(
    BASE_DIR,
    "checkers databases"
)

RENDERED_HTML = os.path.join(
    BASE_DIR,
    "rendered_checkers.html"
)


# ============================================================
# CATEGORY DEFINITIONS
# ============================================================

CATEGORY_KEYWORDS = {

    "meat": [
        "beef",
        "steak",
        "sirloin",
        "rump",
        "fillet",
        "mince",
        "boerewors",
        "wors",
        "biltong",
        "chicken",
        "drumstick",
        "drumsticks",
        "chicken breast",
        "chicken breasts",
        "chicken wings",
        "chicken wing",
        "chicken thigh",
        "chicken thighs",
        "pork",
        "bacon",
        "ham",
        "pork chop",
        "pork chops",
        "lamb",
        "mutton",
        "fish",
        "hake",
        "tuna",
        "sardine",
        "sardines",
        "salmon",
        "prawn",
        "prawns",
        "seafood",
        "calamari",
    ],

    "dairy": [
        "milk",
        "cheese",
        "cheddar",
        "mozzarella",
        "gouda",
        "butter",
        "margarine",
        "yoghurt",
        "yogurt",
        "cream",
        "custard",
        "maas",
        "amasi",
        "buttermilk",
    ],

    "bakery": [
        "bread",
        "loaf",
        "roll",
        "rolls",
        "bun",
        "buns",
        "croissant",
        "muffin",
        "muffins",
        "cake",
        "cakes",
        "donut",
        "doughnut",
        "rusks",
        "rusk",
        "bagel",
        "bakery",
    ],

    "fruit_vegetables": [
        "apple",
        "apples",
        "banana",
        "bananas",
        "orange",
        "oranges",
        "pear",
        "pears",
        "grape",
        "grapes",
        "strawberry",
        "strawberries",
        "blueberry",
        "blueberries",
        "mango",
        "mangoes",
        "pineapple",
        "watermelon",
        "avocado",
        "avocados",
        "lemon",
        "lemons",
        "lime",
        "limes",
        "peach",
        "peaches",
        "plum",
        "plums",
        "kiwi",
        "potato",
        "potatoes",
        "onion",
        "onions",
        "tomato",
        "tomatoes",
        "carrot",
        "carrots",
        "lettuce",
        "cabbage",
        "spinach",
        "broccoli",
        "cauliflower",
        "cucumber",
        "cucumbers",
        "pepper",
        "peppers",
        "pumpkin",
        "sweetcorn",
        "corn",
        "peas",
        "beans",
        "vegetable",
        "vegetables",
        "fruit",
        "fruits",
        "salad",
    ],

    "beverages": [
        "water",
        "mineral water",
        "sparkling water",
        "juice",
        "drink",
        "drinks",
        "cooldrink",
        "soft drink",
        "soft drinks",
        "cola",
        "coke",
        "lemonade",
        "iced tea",
        "energy drink",
        "energy drinks",
        "coffee",
        "tea",
        "hot chocolate",
        "cordial",
        "squash",
    ],

    "snacks": [
        "chips",
        "crisps",
        "popcorn",
        "chocolate",
        "chocolates",
        "sweets",
        "candy",
        "biscuit",
        "biscuits",
        "cookie",
        "cookies",
        "nuts",
        "peanuts",
        "cashews",
        "trail mix",
        "snack",
        "snacks",
        "pretzel",
        "pretzels",
    ],

    "frozen": [
        "frozen",
        "ice cream",
        "icecream",
        "frozen pizza",
        "frozen vegetables",
        "frozen chicken",
        "frozen fish",
        "frozen chips",
        "frozen meals",
    ],

    "pantry": [
        "rice",
        "pasta",
        "spaghetti",
        "macaroni",
        "noodles",
        "flour",
        "sugar",
        "salt",
        "cereal",
        "cereals",
        "oats",
        "porridge",
        "beans",
        "lentils",
        "peas",
        "tinned",
        "canned",
        "tomato sauce",
        "tomato paste",
        "sauce",
        "sauces",
        "mayonnaise",
        "ketchup",
        "mustard",
        "vinegar",
        "oil",
        "olive oil",
        "cooking oil",
        "spices",
        "spice",
        "stock",
        "stock cubes",
        "jam",
        "peanut butter",
        "honey",
    ],

    "household": [
        "dishwashing",
        "dishwasher",
        "washing powder",
        "washing liquid",
        "laundry",
        "detergent",
        "bleach",
        "cleaner",
        "cleaning",
        "disinfectant",
        "floor cleaner",
        "toilet cleaner",
        "toilet paper",
        "paper towel",
        "paper towels",
        "tissue",
        "tissues",
        "bin bag",
        "bin bags",
        "refuse bag",
        "refuse bags",
        "foil",
        "cling wrap",
        "food wrap",
        "sponge",
        "sponges",
        "air freshener",
    ],

    "personal_care": [
        "shampoo",
        "conditioner",
        "soap",
        "body wash",
        "deodorant",
        "toothpaste",
        "toothbrush",
        "mouthwash",
        "razor",
        "razors",
        "shaving",
        "lotion",
        "moisturiser",
        "moisturizer",
        "face wash",
        "skin care",
        "skincare",
        "sanitary",
        "tampon",
        "tampons",
        "pad",
        "pads",
        "nappy",
        "nappies",
        "diaper",
        "diapers",
        "baby wipes",
        "wipes",
    ],
}


# ============================================================
# CATEGORIZE PRODUCT
# ============================================================

def categorize_product(name):

    if not name:
        return "uncategorized"

    text = name.lower()

    text = re.sub(
        r"\s+",
        " ",
        text
    ).strip()

    for category, keywords in CATEGORY_KEYWORDS.items():

        for keyword in keywords:

            if keyword in text:
                return category

    return "uncategorized"


# ============================================================
# CREATE DATABASE
# ============================================================

def create_category_database(category):

    os.makedirs(
        DATABASE_FOLDER,
        exist_ok=True
    )

    database_path = os.path.join(
        DATABASE_FOLDER,
        f"checkers_{category}.db"
    )

    connection = sqlite3.connect(
        database_path
    )

    cursor = connection.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,

            price REAL,

            original_price REAL,

            discount REAL,

            brand TEXT,

            category TEXT NOT NULL,

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

    return database_path


# ============================================================
# CREATE ALL DATABASES
# ============================================================

def create_all_databases():

    os.makedirs(
        DATABASE_FOLDER,
        exist_ok=True
    )

    categories = list(
        CATEGORY_KEYWORDS.keys()
    )

    categories.append(
        "uncategorized"
    )

    print("\nCreating Checkers databases...")

    for category in categories:

        database_path = create_category_database(
            category
        )

        print(
            f"  {os.path.basename(database_path)}"
        )

    print("")


# ============================================================
# LOAD CHECKERS WITH PLAYWRIGHT
# ============================================================

async def download_checkers_html():

    print(
        "Opening Checkers with Playwright..."
    )

    async with async_playwright() as p:

        browser = await p.chromium.launch(
            headless=True
        )

        context = await browser.new_context(

            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/151.0.0.0 Safari/537.36"
            ),

            viewport={
                "width": 1920,
                "height": 1080
            },

            locale="en-ZA",

        )

        page = await context.new_page()

        try:

            print(
                "Navigating to Checkers..."
            )

            await page.goto(
                CHECKERS_URL,
                wait_until="domcontentloaded",
                timeout=60000
            )

            print(
                "Page loaded."
            )

            # ------------------------------------------------
            # Give JavaScript time to execute
            # ------------------------------------------------

            await page.wait_for_timeout(
                5000
            )

            print(
                "Waiting for dynamic content..."
            )

            # ------------------------------------------------
            # Try to wait for product content
            # ------------------------------------------------

            product_selectors = [

                '[data-testid="product-card"]',

                '[data-testid="product"]',

                '[class*="product-card"]',

                '[class*="ProductCard"]',

            ]

            product_found = False

            for selector in product_selectors:

                try:

                    await page.wait_for_selector(
                        selector,
                        timeout=5000
                    )

                    count = await page.locator(
                        selector
                    ).count()

                    if count > 0:

                        print(
                            f"Found {count} "
                            f"elements using: "
                            f"{selector}"
                        )

                        product_found = True

                        break

                except Exception:

                    continue

            # ------------------------------------------------
            # Scroll page to trigger lazy loading
            # ------------------------------------------------

            print(
                "Scrolling page..."
            )

            for _ in range(5):

                await page.evaluate(
                    """
                    window.scrollBy(
                        0,
                        window.innerHeight
                    );
                    """
                )

                await page.wait_for_timeout(
                    1000
                )

            # ------------------------------------------------
            # Scroll back to top
            # ------------------------------------------------

            await page.evaluate(
                """
                window.scrollTo(0, 0);
                """
            )

            await page.wait_for_timeout(
                1000
            )

            # ------------------------------------------------
            # Get rendered HTML
            # ------------------------------------------------

            html = await page.content()

            # ------------------------------------------------
            # Save rendered HTML
            # ------------------------------------------------

            with open(
                RENDERED_HTML,
                "w",
                encoding="utf-8"
            ) as file:

                file.write(html)

            print(
                f"\nRendered HTML saved to:"
            )

            print(
                RENDERED_HTML
            )

            if product_found:

                print(
                    "Product elements were detected."
                )

            else:

                print(
                    "WARNING: No product elements "
                    "were detected yet."
                )

            return html

        except Exception as error:

            print(
                f"\nERROR loading Checkers:"
            )

            print(error)

            return None

        finally:

            await browser.close()


# ============================================================
# PRICE CLEANER
# ============================================================

def clean_price(text):

    if not text:
        return None

    text = text.replace(
        "\xa0",
        " "
    )

    match = re.search(
        r"R\s?(\d+(?:[.,]\d{1,2})?)",
        text,
        re.IGNORECASE
    )

    if not match:

        match = re.search(
            r"(\d+(?:[.,]\d{1,2})?)",
            text
        )

    if not match:
        return None

    value = match.group(1)

    value = value.replace(
        ",",
        "."
    )

    try:

        return float(value)

    except ValueError:

        return None


# ============================================================
# GET TEXT SAFELY
# ============================================================

def get_text(element):

    if not element:
        return None

    text = element.get_text(
        " ",
        strip=True
    )

    return text if text else None


# ============================================================
# FIND PRODUCT NAME
# ============================================================

def find_product_name(card):

    selectors = [

        '[data-testid="product-name"]',

        '[data-testid="product-title"]',

        '[class*="product-name"]',

        '[class*="productName"]',

        '[class*="ProductName"]',

        '[class*="title"]',

        'h2',

        'h3',

        'h4',

    ]

    for selector in selectors:

        element = card.select_one(
            selector
        )

        text = get_text(
            element
        )

        if text:

            return text

    return None


# ============================================================
# FIND PRICE
# ============================================================

def find_price(card):

    selectors = [

        '[data-testid="product-price"]',

        '[data-testid="price"]',

        '[class*="product-price"]',

        '[class*="productPrice"]',

        '[class*="price"]',

        '[class*="Price"]',

    ]

    for selector in selectors:

        elements = card.select(
            selector
        )

        for element in elements:

            text = get_text(
                element
            )

            price = clean_price(
                text
            )

            if price is not None:

                return price

    # ----------------------------------------------
    # Last resort: search entire card text
    # ----------------------------------------------

    card_text = get_text(
        card
    )

    return clean_price(
        card_text
    )


# ============================================================
# FIND IMAGE
# ============================================================

def find_image(card):

    image = card.select_one(
        "img"
    )

    if not image:
        return None

    image_url = (

        image.get("src")

        or image.get("data-src")

        or image.get("data-lazy-src")

        or image.get("data-original")

    )

    if not image_url:
        return None

    return urljoin(
        CHECKERS_URL,
        image_url
    )


# ============================================================
# FIND PRODUCT URL
# ============================================================

def find_product_url(card):

    link = card.select_one(
        "a[href]"
    )

    if not link:
        return None

    href = link.get(
        "href"
    )

    if not href:
        return None

    return urljoin(
        CHECKERS_URL,
        href
    )


# ============================================================
# FIND PRODUCT CARDS
# ============================================================

def find_product_cards(soup):

    selectors = [

        '[data-testid="product-card"]',

        '[data-testid="product"]',

        '[data-testid*="product-card"]',

        '[data-testid*="product"]',

        'article[class*="product"]',

        'div[class*="product-card"]',

        'div[class*="ProductCard"]',

        'li[class*="product"]',

    ]

    all_cards = []

    for selector in selectors:

        cards = soup.select(
            selector
        )

        if cards:

            print(
                f"Selector '{selector}' "
                f"found {len(cards)} elements."
            )

            all_cards.extend(
                cards
            )

    # --------------------------------------------------------
    # Remove duplicates
    # --------------------------------------------------------

    unique_cards = []

    seen = set()

    for card in all_cards:

        identifier = id(
            card
        )

        if identifier not in seen:

            seen.add(
                identifier
            )

            unique_cards.append(
                card
            )

    return unique_cards


# ============================================================
# PARSE PRODUCTS WITH BEAUTIFULSOUP
# ============================================================

def parse_products(html):

    print(
        "\nParsing rendered HTML "
        "with BeautifulSoup4..."
    )

    soup = BeautifulSoup(
        html,
        "html.parser"
    )

    cards = find_product_cards(
        soup
    )

    print(
        f"\nUnique product cards found: "
        f"{len(cards)}"
    )

    products = []

    for card in cards:

        name = find_product_name(
            card
        )

        if not name:
            continue

        price = find_price(
            card
        )

        image_url = find_image(
            card
        )

        product_url = find_product_url(
            card
        )

        category = categorize_product(
            name
        )

        product = {

            "name": name,

            "price": price,

            "original_price": None,

            "discount": None,

            "brand": None,

            "category": category,

            "size": None,

            "promotion": None,

            "product_url": product_url,

            "image_url": image_url,

        }

        products.append(
            product
        )

    # --------------------------------------------------------
    # Remove duplicate products
    # --------------------------------------------------------

    unique_products = []

    seen_products = set()

    for product in products:

        key = (

            product["name"],

            product["product_url"]

        )

        if key not in seen_products:

            seen_products.add(
                key
            )

            unique_products.append(
                product
            )

    return unique_products


# ============================================================
# SAVE PRODUCT
# ============================================================

def save_product(product):

    category = product[
        "category"
    ]

    database_path = create_category_database(
        category
    )

    connection = sqlite3.connect(
        database_path
    )

    cursor = connection.cursor()

    scraped_at = datetime.now().isoformat()

    cursor.execute(
        """
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

        """,

        (

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

            scraped_at,

        )
    )

    connection.commit()

    connection.close()


# ============================================================
# SAVE ALL PRODUCTS
# ============================================================

def save_products(products):

    category_counts = {}

    for product in products:

        category = product[
            "category"
        ]

        save_product(
            product
        )

        category_counts[
            category
        ] = category_counts.get(
            category,
            0
        ) + 1

    print(
        "\nProducts saved:"
    )

    print(
        "-" * 45
    )

    for category in sorted(
        category_counts
    ):

        print(
            f"{category:<25}"
            f"{category_counts[category]}"
        )

    print(
        "-" * 45
    )

    print(
        f"TOTAL: {len(products)}"
    )


# ============================================================
# SHOW DATABASE STATISTICS
# ============================================================

def show_database_statistics():

    print(
        "\nDatabase statistics:"
    )

    print(
        "=" * 55
    )

    if not os.path.exists(
        DATABASE_FOLDER
    ):

        return

    database_files = [

        filename

        for filename in os.listdir(
            DATABASE_FOLDER
        )

        if filename.endswith(
            ".db"
        )

    ]

    total = 0

    for filename in sorted(
        database_files
    ):

        database_path = os.path.join(
            DATABASE_FOLDER,
            filename
        )

        try:

            connection = sqlite3.connect(
                database_path
            )

            cursor = connection.cursor()

            cursor.execute(
                """
                SELECT COUNT(*)
                FROM products
                """
            )

            count = cursor.fetchone()[0]

            connection.close()

            total += count

            print(
                f"{filename:<35}"
                f"{count} products"
            )

        except sqlite3.Error as error:

            print(
                f"{filename}: {error}"
            )

    print(
        "=" * 55
    )

    print(
        f"TOTAL PRODUCTS: {total}"
    )


# ============================================================
# MAIN
# ============================================================

async def main():

    print(
        "=" * 65
    )

    print(
        "CHECKERS PRODUCT SCRAPER"
    )

    print(
        "=" * 65
    )

    print(
        f"\nDatabase folder:"
    )

    print(
        DATABASE_FOLDER
    )

    # --------------------------------------------------------
    # 1. Create databases
    # --------------------------------------------------------

    create_all_databases()

    # --------------------------------------------------------
    # 2. Load Checkers using Playwright
    # --------------------------------------------------------

    html = await download_checkers_html()

    if not html:

        print(
            "\nCould not download Checkers."
        )

        return

    # --------------------------------------------------------
    # 3. Parse rendered HTML using BeautifulSoup4
    # --------------------------------------------------------

    products = parse_products(
        html
    )

    print(
        f"\nProducts extracted: "
        f"{len(products)}"
    )

    # --------------------------------------------------------
    # 4. Save products
    # --------------------------------------------------------

    if products:

        save_products(
            products
        )

        show_database_statistics()

        print(
            "\nSUCCESS!"
        )

    else:

        print(
            "\nNO PRODUCTS WERE EXTRACTED."
        )

        print(
            "\nThe rendered HTML has been saved at:"
        )

        print(
            RENDERED_HTML
        )

        print(
            "\nOpen that file in your browser "
            "and we can inspect the actual "
            "Checkers product structure."
        )


# ============================================================
# START
# ============================================================

if __name__ == "__main__":

    asyncio.run(
        main()
    )