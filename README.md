# SmartBasket 🛒

SmartBasket is a South African grocery price comparison web application. It allows users to search items, compare prices side-by-side across major local retailers (such as Pick n Pay and Shoprite), view loyalty pricing toggles, and manage shopping lists seamlessly through a responsive web interface.

## Features
1. **Live Product Search & Filtering:** Search for grocery items with instant multi-store filtering and price sorting.
2. **Full-Page Product Detail Views:** Inspect individual items, see store-specific badges, and check for cheaper alternative prices at competing stores.
3. **Dynamic Store Cost Comparison:** Add items to your basket to instantly calculate and compare total basket costs across retailers.
4. **Saved Baskets:** Save, name, and reload your custom grocery lists locally or via database storage.
5. **Mobile-Friendly Web UI:** Built with Tailwind CSS for smooth browsing on mobile and desktop browsers.

## Tech Stack
- **Frontend:** HTML5, JavaScript (ES6+), Tailwind CSS (via CDN)
- **Backend:** Python, Flask, Flask-CORS, Flask-SQLAlchemy, SQLite
- **Data Scraping / Processing:** BeautifulSoup4, Requests, Playwright

---

## Getting Started

### Prerequisites
Make sure you have **Python 3.8+** installed on your system.

### 1. Clone the Repository & Set Up Your Environment
Open your terminal and navigate to the directory where you want to store the project. Before installing dependencies, it is highly recommended to create a virtual environment to keep your packages isolated.

```bash
# Clone the repository and navigate into it
git clone [https://github.com/Scotty4u/BeautifulSoup.git]
cd smartbasket

# Create a virtual environment
python -m venv .venv

# Activate the virtual environment (Windows)
.\.venv\Scripts\activate

# Activate the virtual environment (macOS/Linux)
source .venv/bin/activate

#Installing Dependencies
pip install flask flask-cors flask-sqlalchemy apscheduler fake-useragent httpx playwright