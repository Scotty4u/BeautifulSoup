import asyncio
import os
import re
import sqlite3

from datetime import datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright


# ============================================================
# CONFIGURATION
# ============================================================

URL = "https://www.shoprite.co.za/"

# Put all category databases next to app.py
BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

DATABASE_FOLDER = os.path.join(
    BASE_DIR,
    "Shoprite Databases"
)

RENDERED_HTML = os.path.join(
    BASE_DIR,
    "rendered_shoprite.html"
)


# ============================================================
# CATEGORY DEFINITIONS
# ============================================================
#
# Products are classified using keywords found in the
# product name.
#
# The order matters.
# More specific categories should come first.
# ============================================================

CATEGORY_KEYWORDS = {

    "meat": [

        # Beef
        "beef",
        "steak",
        "sirloin",
        "rump",
        "fillet",
        "mince",
        "boerewors",
        "wors",
        "biltong",

        # Chicken
        "chicken",
        "drumstick",
        "drumsticks",
        "chicken breast",
        "chicken breasts",
        "chicken wings",
        "chicken wing",
        "chicken thigh",
        "chicken thighs",

        # Pork
        "pork",
        "bacon",
        "ham",
        "pork chops",
        "pork chop",

        # Lamb
        "lamb",
        "mutton",

        # Fish / seafood
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
        "full cream milk",
        "low fat milk",
        "fat free milk",
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
        "rolls",
        "roll",
        "bun",
        "buns",
        "croissant",
        "croissants",
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

        # Fruit
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
        "raspberry",
        "raspberries",
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

        # Vegetables
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
        "pepper",
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
        "cooking",

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
        "insecticide",

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

    # Lowercase the product name
    text = name.lower()

    # Normalize whitespace
    text = re.sub(
        r"\s+",
        " ",
        text
    ).strip()

    # --------------------------------------------------------
    # Check each category
    # --------------------------------------------------------

    for category, keywords in CATEGORY_KEYWORDS.items():

        for keyword in keywords:

            if keyword.lower() in text:

                return category

    # --------------------------------------------------------
    # Nothing matched
    # --------------------------------------------------------

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
        f"Shoprite_{category}.db"
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

    print("\nCreating category databases...")

    for category in categories:

        database_path = create_category_database(
            category
        )

        print(
            f"  Created/checked: {os.path.basename(database_path)}"
        )

    print(
        "Category databases ready.\n"
    )


# ============================================================
# CLEAN PRICE
# ============================================================

def clean_price(text):

    if not text:
        return None

    # Remove spaces
    text = text.replace(
        " ",
        ""
    )

    # Find:
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

    value = value.replace(
        ",",
        "."
    )

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

        print(
            "Opening Shoprite..."
        )

        await page.goto(

            URL,

            wait_until="domcontentloaded",

            timeout=60000

        )

        print(
            "Waiting for page to render..."
        )

        await page.wait_for_timeout(
            8000
        )

        # ----------------------------------------------------
        # Scroll page
        # ----------------------------------------------------

        for _ in range(5):

            await page.mouse.wheel(
                0,
                1000
            )

            await page.wait_for_timeout(
                1000
            )

        # ----------------------------------------------------
        # Get rendered HTML
        # ----------------------------------------------------

        html = await page.content()

        # ----------------------------------------------------
        # Save HTML
        # ----------------------------------------------------

        with open(
            RENDERED_HTML,
            "w",
            encoding="utf-8"
        ) as file:

            file.write(
                html
            )

        print(
            f"Rendered HTML saved to:\n{RENDERED_HTML}"
        )

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
    # Fallback
    # --------------------------------------------------------

    if not cards:

        cards = soup.select(
            '[class*="product-card"]'
        )

        print(
            f"Fallback product cards found: {len(cards)}"
        )

    # --------------------------------------------------------
    # Parse each product
    # --------------------------------------------------------

    for card in cards:

        # ====================================================
        # PRODUCT NAME
        # ====================================================

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

        # ====================================================
        # PRICE
        # ====================================================

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

        # ====================================================
        # IMAGE
        # ====================================================

        image_url = None

        image = card.select_one(
            "img"
        )

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

        # ====================================================
        # PRODUCT LINK
        # ====================================================

        product_url = None

        link = card.select_one(
            "a"
        )

        if link:

            href = link.get(
                "href"
            )

            if href:

                product_url = urljoin(
                    URL,
                    href
                )

        # ====================================================
        # CATEGORY
        # ====================================================

        category = categorize_product(
            name
        )

        # ====================================================
        # SAVE PRODUCT
        # ====================================================

        if name:

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

                "image_url": image_url

            }

            products.append(
                product
            )

    return products


# ============================================================
# SAVE PRODUCT TO CATEGORY DATABASE
# ============================================================

def save_product(
    product
):

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

    # --------------------------------------------------------
    # Insert / update
    # --------------------------------------------------------

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

    connection.commit()

    connection.close()


# ============================================================
# SAVE ALL PRODUCTS
# ============================================================

def save_products(products):

    # --------------------------------------------------------
    # Counters
    # --------------------------------------------------------

    category_counts = {}

    # --------------------------------------------------------
    # Save each product
    # --------------------------------------------------------

    for product in products:

        category = product[
            "category"
        ]

        save_product(
            product
        )

        if category not in category_counts:

            category_counts[
                category
            ] = 0

        category_counts[
            category
        ] += 1

    # --------------------------------------------------------
    # Display results
    # --------------------------------------------------------

    print(
        "\nProducts saved by category:"
    )

    print(
        "-" * 45
    )

    for category in sorted(
        category_counts
    ):

        count = category_counts[
            category
        ]

        print(
            f"{category:<25} {count}"
        )

    print(
        "-" * 45
    )

    print(
        f"Total products: {len(products)}"
    )


# ============================================================
# DATABASE STATISTICS
# ============================================================

def show_database_statistics():

    print(
        "\nDatabase statistics:"
    )

    print(
        "=" * 50
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

    total_products = 0

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

            cursor.execute("""
                SELECT COUNT(*)
                FROM products
            """)

            count = cursor.fetchone()[0]

            connection.close()

            total_products += count

            print(
                f"{filename:<30} {count} products"
            )

        except sqlite3.Error as error:

            print(
                f"{filename:<30} ERROR: {error}"
            )

    print(
        "=" * 50
    )

    print(
        f"TOTAL: {total_products} products"
    )


# ============================================================
# MAIN
# ============================================================

async def main():

    print(
        "=" * 60
    )

    print(
        "SHOPRITE MULTI-DATABASE PRODUCT SCRAPER"
    )

    print(
        "=" * 60
    )

    print(
        f"\nDatabase folder:"
    )

    print(
        DATABASE_FOLDER
    )

    # --------------------------------------------------------
    # Create databases
    # --------------------------------------------------------

    create_all_databases()

    # --------------------------------------------------------
    # Download page
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
            "\nSaving products..."
        )

        save_products(
            products
        )

        # ----------------------------------------------------
        # Show statistics
        # ----------------------------------------------------

        show_database_statistics()

        print(
            "\nProducts successfully saved!"
        )

    else:

        print(
            "\nWARNING:"
        )

        print(
            "No products were detected."
        )

        print(
            "\nOpen this file and inspect the HTML:"
        )

        print(
            RENDERED_HTML
        )

    # --------------------------------------------------------
    # Finished
    # --------------------------------------------------------

    print(
        "\nFinished."
    )


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    asyncio.run(
        main()
    )