"""Optional: refresh real mapped shops in major Eastern Cape towns.
Run from the backend directory: py refresh_eastern_cape_branches.py
Uses public Overpass endpoints. Public services can be slow/temporarily down.
"""
from store_locations import nearby_branches

TOWNS = (
    ('Gqeberha', -33.952, 25.601),
    ('Ibhayi / New Brighton', -33.905, 25.621),
    ('Kariega', -33.768, 25.403),
    ('East London', -33.015, 27.906),
    ('Qonce', -32.876, 27.392),
    ('Mthatha', -31.589, 28.784),
    ('Jeffreys Bay', -34.050, 24.919),
)

if __name__ == '__main__':
    for name, lat, lng in TOWNS:
        try:
            result = nearby_branches(lat, lng, 15, refresh=True)
            print(f"{name}: {len(result['stores'])} mapped branches | {result['status']}")
        except Exception as exc:
            print(f"{name}: lookup unavailable ({exc}). Cached verified nodes remain available.")
