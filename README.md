# SmartBasket 🛒

SmartBasket is a South African grocery price comparison web application. It allows users to search items, compare prices side-by-side across major local retailers (such as Pick n Pay, Shoprite, Checkers, and Woolworths), view loyalty pricing toggles, and manage shopping lists seamlessly through a responsive web interface.

## Features
1. **Live Product Search & Filtering:** Search for grocery items with instant multi-store filtering and price sorting.
2. **Full-Page Product Detail Views:** Inspect individual items, see store-specific badges, and check for cheaper alternative prices at competing stores.
3. **Dynamic Store Cost Comparison:** Add items to your basket to instantly calculate and compare total basket costs across retailers.
4. **Saved & Collaborative Baskets:** Save, name, and reload custom grocery lists locally or via database storage, and share them with team members.
5. **Modern Single Page Application (SPA):** Lightning-fast browsing and state management built on React.

## Tech Stack
- **Frontend:** React.js, React Router DOM, Axios, Vite, Tailwind CSS
- **Backend:** Python, Flask, Flask-CORS, Flask-SQLAlchemy, SQLite
- **Data Scraping & Processing:** Playwright (Async), HTTPX, RapidFuzz, APScheduler

---

## Getting Started

### Prerequisites
Make sure you have the following installed on your system:
- **Python 3.13+**
- **Node.js & npm** (v16+)

### 1. Clone the Repository
Open your terminal and navigate to the directory where you want to store the project.
```bash
git clone [https://github.com/Scotty4u/BeautifulSoup.git](https://github.com/Scotty4u/BeautifulSoup.git)
cd smartbasket

# Create a virtual environment
python -m venv .venv

# Activate the virtual environment (Windows)
.\.venv\Scripts\activate

# Activate the virtual environment (macOS/Linux)
source .venv/bin/activate

# Install Python dependencies from the requirements file
pip install -r requirements.txt

# Install required Playwright browsers (Chromium)
playwright install chromium

# Run the Flask backend (Runs on [http://127.0.0.1:5000](http://127.0.0.1:5000))
python app.py

# Navigate into the frontend folder
cd frontend

# Install Node.js dependencies
npm install

# Start the Vite development server
npm run dev