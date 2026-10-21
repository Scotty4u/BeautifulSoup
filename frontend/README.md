# SmartBasket Frontend

React and Vite power SmartBasket's browser experience. This directory contains the single-page application that Flask serves in production.

## Folder guide

- `src/main.jsx` mounts React and loads styles.
- `src/App.jsx` defines shared navigation, routes, and providers.
- `src/pages/` contains full-page routes such as Home, Search, Product, Basket Comparison, Checkout, Profile and Admin.
- `src/components/` holds reusable controls, cards, location pickers and category navigation.
- `src/context/` manages authentication and toast state on the client.
- `src/utils/` contains basket persistence, product filtering, retailer and matching helpers.
- `src/assets/` and `public/` contain images and public assets.

## Local development

Run the Flask backend separately, then from `BeautifulSoup/frontend/`:

```bash
npm install
npm run dev
```

Vite typically runs on `http://localhost:5173`. The frontend sends development API requests to the local Flask backend.

## Validation and build

```bash
npm run build
npm run lint
```

The production build is written to `dist/` and copied into the Docker image. Always edit `src/`, not generated files.

## Important behaviors

Grocery, Pharmacy, Liquor, and Electronics are broad navigation categories. Product visibility and age eligibility must still be enforced by the backend. Basket substitutes should be clearly labeled, and checkout uses different fields for delivery and mapped-store collection. SmartBasket orders are simulated rather than retailer purchases.

See `../README.md` for architecture, backend setup, database paths, deployment, and limitations.
