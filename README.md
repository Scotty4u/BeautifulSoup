# SmartBasket 🛒

SmartBasket is a South African grocery price comparison web application. It allows users to search items, compare prices side-by-side across major local retailers (such as Pick n Pay and Shoprite), view loyalty pricing toggles, and manage shopping lists seamlessly through a responsive web interface.

## Features
- **Live Product Search & Filtering:** Search for grocery items with instant multi-store filtering and price sorting.
- **Full-Page Product Detail Views:** Inspect individual items, see store-specific badges, and check for cheaper alternative prices at competing stores.
- **Dynamic Store Cost Comparison:** Add items to your basket to instantly calculate and compare total basket costs across retailers.
- **Saved Baskets:** Save, name, and reload your custom grocery lists locally.
- **Mobile-Friendly Web UI:** Built with Tailwind CSS for smooth browsing on mobile and desktop browsers.

## Tech Stack
- **Frontend:** HTML5, JavaScript (ES6+), Tailwind CSS (via CDN)
- **Backend:** Python, Flask, Flask-CORS
- **Data Scraping / Processing:** BeautifulSoup4, Requests

---

## Getting Started

### Prerequisites
Make sure you have **Python 3.8+** installed on your system.

### 1. Clone the Repository & Setup Backend
Open your terminal and navigate to the project directory, then install the required Python dependencies:

```bash
pip install -r requirements.txt