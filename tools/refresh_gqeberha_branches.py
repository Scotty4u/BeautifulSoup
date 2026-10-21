"""Warm SmartBasket's existing verified OSM branch cache for Gqeberha.

Run manually from the backend folder or with PYTHONPATH=backend.
No coordinates are guessed: results are actual OpenStreetMap POI records.
The existing store_locations.py handles throttling, caching, and filtering.
"""
import csv
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from store_locations import nearby_branches  # noqa: E402

# These centres are existing verified OSM node coordinates in store_locations.py.
CENTRES = [
    ('Newton Park', -33.94917, 25.56408, 20),
    ('Central Gqeberha', -33.96093, 25.62168, 20),
    ('Korsten', -33.92666, 25.56957, 20),
    ('Moffett', -33.98378, 25.55436, 20),
]


def main():
    found = {}
    for label, lat, lng, radius in CENTRES:
        print(f'Checking {label} (radius {radius}km)...')
        try:
            data = nearby_branches(lat, lng, radius, refresh=True)
        except Exception as exc:
            print(f'  Live provider unavailable: {type(exc).__name__}: {exc}')
            continue
        print(f'  {len(data.get("stores", []))} mapped branches; status={data.get("status")}')
        for branch in data.get('stores', []):
            if str(branch.get('id', '')).startswith('osm-'):
                found[branch['id']] = branch
        time.sleep(5)  # Respect shared public Overpass resources.
    destination = Path(__file__).resolve().parents[1] / 'data' / 'gqeberha_verified_osm_branches.csv'
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=['id', 'store', 'name', 'address', 'lat', 'lng'])
        writer.writeheader()
        for branch in sorted(found.values(), key=lambda item: (item['store'], item['name'])):
            writer.writerow({key: branch.get(key, '') for key in writer.fieldnames})
    print(f'Wrote {len(found)} mapped OSM branch records to {destination}')
    print('The app already reads these same verified records from its local branch cache.')
    print('OSM attribution: © OpenStreetMap contributors, ODbL. Validate trading status separately.')


if __name__ == '__main__':
    main()
