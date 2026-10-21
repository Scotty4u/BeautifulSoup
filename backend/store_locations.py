"""Verified OSM branch coordinates, persisted locally for SmartBasket.

Never invent branch coordinates. Only store OSM POIs belonging to the four
chains supported by the product scrapers. Prices are chain-level, NOT branch
stock/price guarantees. Public OSM services suit low-volume development only.
"""
import json
import math
import os
import re
import sqlite3
import threading
from contextlib import contextmanager, closing
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SUPPORTED = ('Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths')
# SmartBasket's active supermarket map/collection scope is Gqeberha ONLY.
# City-centre radius is deliberately conservative: approximate Gqeberha coverage,
# NOT an administrative boundary. An official boundary polygon can replace this
# gate if stricter cadastral precision is needed later.
GQEBERHA_CENTRE = (-33.958, 25.615)
GQEBERHA_MAX_DISTANCE_KM = 25.0
# Secondary guard against mislabeled source data. Geographic gate handles
# Uitenhage/Kariega; do not reject 'Uitenhage Road' in Gqeberha addresses.
_OUTSIDE_CITY = re.compile(r'\b(?:Kariega|East London|Qumbu|Mthatha|Jeffreys Bay|Despatch)\b', re.I)

_LOCK = threading.RLock()
_CACHE = {}
_LAST_GEOCODE = [0.0]
# 7 days avoids repeated public Overpass requests, even across Flask restarts.
BRANCH_TTL_SECONDS = 7 * 24 * 3600
DB_PATH = Path(os.getenv('SMARTBASKET_BRANCH_CACHE_DB', str(Path(__file__).parent / 'branch_coordinates.sqlite3')))
# Kumi Systems moved to private.coffee; use maintained public alternatives.
_DEFAULT_OVERPASS_URLS = (
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
)
_OVERPASS_URL = os.getenv('SMARTBASKET_OVERPASS_URL', _DEFAULT_OVERPASS_URLS[0])
_OVERPASS_URLS = tuple(dict.fromkeys((
    _OVERPASS_URL,
    *(item.strip() for item in os.getenv('SMARTBASKET_OVERPASS_FALLBACKS', ','.join(_DEFAULT_OVERPASS_URLS)).split(',') if item.strip()),
)))
_FAILURE_COOLDOWN_SECONDS = 90
_RECENT_FAILURES = {}
_OSM_USER_AGENT = 'SmartBasket-SouthAfrica-StoreLocator/1.0 (' + os.getenv('SMARTBASKET_OSM_CONTACT', 'local-development') + ')'


# Verified OpenStreetMap supermarket nodes. The place coordinates and node IDs
# can be checked at https://www.openstreetmap.org/node/<ID>. These are not
# fabricated addresses or proof of current store stock. Excludes clothing and
# liquor-only outlets. Publicly available OSM records; © OpenStreetMap contributors.
# Format: (OSM node ID, scraped retailer name, mapped branch name,
#          locality as address, latitude, longitude)
_VERIFIED_GQEBERHA = (
    ('osm-node-4531148091', 'Shoprite', 'Shoprite — Stanford Road, Korsten', 'Korsten, Gqeberha, Eastern Cape', -33.92666, 25.56957),
    ('osm-node-1750846241', 'Shoprite', 'Shoprite — Govan Mbeki Street', 'Gqeberha, Eastern Cape', -33.96093, 25.62168),
    ('osm-node-25338659', 'Pick n Pay', 'Pick n Pay — Newton Park', 'Newton Park, Gqeberha, Eastern Cape', -33.94917, 25.56408),
    ('osm-node-305197442', 'Checkers', 'Checkers — Newton Park', 'Newton Park, Gqeberha, Eastern Cape', -33.94887, 25.55761),
    ('osm-node-1729709905', 'Checkers', 'Checkers — Moffett-on-Main', 'Gqeberha, Eastern Cape', -33.98378, 25.55436),
    ('osm-node-613380814', 'Woolworths', 'Woolworths Food', 'Gqeberha, Eastern Cape', -33.95177, 25.52687),
)
_SEEDS_READY = False


def valid_coordinates(lat, lng):
    return math.isfinite(lat) and math.isfinite(lng) and -35.5 <= lat <= -21.5 and 16 <= lng <= 34


def validate_location(lat, lng, radius=15):
    try:
        lat, lng, radius = float(lat), float(lng), int(radius)
    except (TypeError, ValueError, OverflowError):
        raise ValueError('Provide valid latitude, longitude and radius')
    if not valid_coordinates(lat, lng):
        raise ValueError('Select a location inside South Africa')
    if radius not in (5, 10, 15, 20, 30, 50):
        raise ValueError('Radius must be 5, 10, 15, 20, 30 or 50 km')
    return lat, lng, radius


def retailer_from_osm(tags):
    """Recognize grocery outlets of the four scraped chains; reject other shops."""
    if not isinstance(tags, dict):
        return None
    shop = str(tags.get('shop', '')).casefold().strip()
    name = ' '.join(str(tags.get(key) or '') for key in
                    ('name', 'brand', 'operator', 'official_name')).casefold()
    if shop in ('alcohol', 'clothes', 'fashion', 'shoes', 'chemist', 'pharmacy'):
        return None
    if re.search(r'liquor\s*(?:shop|store)|liquorshop|distribution\s*(?:centre|center)|warehouse', name):
        return None
    if re.search(r'\bcheckers\b', name):
        store = 'Checkers'
    elif re.search(r'\bshoprite\b', name):
        store = 'Shoprite'
    elif re.search(r'\bpick\s*(?:n|and|&)\s*pay\b|\bpnp\b', name):
        store = 'Pick n Pay'
    elif re.search(r'\bwoolworths\b', name):
        store = 'Woolworths'
    else:
        return None
    if shop in ('supermarket', 'convenience', 'grocery', 'general'):
        return store
    # Woolworths Food sometimes uses department_store in OSM; standalone
    # Woolworths clothes/dept outlets cannot count as grocery branches.
    if shop == 'department_store' and store == 'Woolworths' and 'food' in name:
        return store
    return None


def haversine(lat1, lon1, lat2, lon2):
    r1, r2 = math.radians(lat1), math.radians(lat2)
    dr, dl = r2-r1, math.radians(lon2-lon1)
    a = math.sin(dr/2)**2 + math.cos(r1)*math.cos(r2)*math.sin(dl/2)**2
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(a)))


def is_gqeberha_branch(lat, lng, name='', address=''):
    """Conservative coordinate check: local grocery POIs, never nearby towns.

    Old out-of-area rows may stay in the cache for backup/history but are not
    exposed by public endpoints or collection selection.
    """
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError, OverflowError):
        return False
    if not valid_coordinates(lat, lng):
        return False
    if _OUTSIDE_CITY.search(f'{name} {address}'):
        return False
    return haversine(*GQEBERHA_CENTRE, lat, lng) <= GQEBERHA_MAX_DISTANCE_KM


def _read_url(url, *, payload=None, timeout=12):
    headers = {'User-Agent': _OSM_USER_AGENT, 'Accept': 'application/json'}
    if payload is not None: headers['Content-Type'] = 'application/x-www-form-urlencoded'
    with urlopen(Request(url, data=payload, headers=headers), timeout=timeout) as response:
        return json.load(response)


def search_places(query):
    """Explicit button searches only; Nominatim autocomplete is not allowed."""
    query = ' '.join(str(query or '').strip().split())[:110]
    if len(query) < 3: return []
    key = ('geo', query.casefold())
    with _LOCK:
        cache = _CACHE.get(key)
        if cache and cache[0] > time.time(): return cache[1]
        delta = time.monotonic() - _LAST_GEOCODE[0]
        if delta < 1.1: raise RuntimeError('Please allow a moment between location searches.')
        _LAST_GEOCODE[0] = time.monotonic()
    params = urlencode({'q': query, 'countrycodes': 'za', 'format': 'jsonv2', 'limit': 5,
                        'addressdetails': 1, 'accept-language': 'en'})
    data = _read_url('https://nominatim.openstreetmap.org/search?' + params, timeout=9)
    result = []
    for place in data:
        try:
            lat, lng = float(place['lat']), float(place['lon'])
            if valid_coordinates(lat, lng):
                result.append({'name': str(place['display_name'])[:180], 'lat': lat, 'lng': lng,
                               'address': {
                                   'street': ' '.join((str((place.get('address') or {}).get('house_number') or ''),
                                                     str((place.get('address') or {}).get('road') or ''))).strip(),
                                   'suburb': (place.get('address') or {}).get('suburb') or (place.get('address') or {}).get('neighbourhood') or '',
                                   'city': (place.get('address') or {}).get('city') or (place.get('address') or {}).get('town') or (place.get('address') or {}).get('village') or '',
                                   'province': (place.get('address') or {}).get('state') or '',
                                   'postal_code': (place.get('address') or {}).get('postcode') or ''}})
        except (ValueError, KeyError, TypeError): pass
    with _LOCK: _CACHE[key] = (time.time() + 3600, result)
    return result


def parse_branches(payload, lat, lng, radius):
    branches, seen = [], set()
    for element in payload.get('elements', []):
        tags = element.get('tags') or {}
        store = retailer_from_osm(tags)
        if not store: continue
        coords = element.get('center') if element.get('type') != 'node' else element
        try:
            x, y = float(coords['lat']), float(coords['lon'])
            if not valid_coordinates(x, y): continue
        except (ValueError, KeyError, TypeError): continue
        distance = haversine(lat, lng, x, y)
        if distance > radius: continue
        if not is_gqeberha_branch(x, y, tags.get('name', ''),
                                   ' '.join(str(tags.get(k) or '') for k in
                                            ('addr:city', 'addr:suburb'))):
            continue
        unique = (store, round(x, 5), round(y, 5))
        if unique in seen: continue
        seen.add(unique)
        address_parts = [tags[k] for k in ('addr:housenumber','addr:street','addr:suburb','addr:city') if tags.get(k)]
        branches.append({'id': f"osm-{element.get('type', 'node')}-{element.get('id')}",
                         'store': store, 'name': str(tags.get('name') or store)[:100],
                         'address': ', '.join(address_parts), 'lat': x, 'lng': y,
                         'distanceKm': round(distance, 1)})
    return sorted(branches, key=lambda b: (b['distanceKm'], b['store']))


@contextmanager
def _connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    conn.execute('''CREATE TABLE IF NOT EXISTS branches (
        osm_id TEXT PRIMARY KEY, retailer TEXT NOT NULL, name TEXT NOT NULL,
        address TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
        last_seen REAL NOT NULL)''')
    conn.execute('''CREATE INDEX IF NOT EXISTS branch_coords ON branches(latitude, longitude)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS searched_regions (
        grid_lat REAL NOT NULL, grid_lng REAL NOT NULL, radius_km INTEGER NOT NULL,
        updated_at REAL NOT NULL,
        PRIMARY KEY(grid_lat,grid_lng,radius_km))''')
    # Warm verified Eastern Cape POIs immediately. All records have actual OSM
    # node identifiers and are inserted only when absent. Existing OSM updates
    # and user-imported rows are NEVER overwritten.
    global _SEEDS_READY
    if not _SEEDS_READY:
        conn.executemany("""INSERT OR IGNORE INTO branches
            (osm_id, retailer, name, address, latitude, longitude, last_seen)
            VALUES (?,?,?,?,?,?,?)""",
            [(*row, 0.0) for row in _VERIFIED_GQEBERHA if is_gqeberha_branch(row[4], row[5], row[2], row[3])])
        conn.commit()
        _SEEDS_READY = True
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _local_branches(conn, lat, lng, radius):
    # Rough bounding box lets SQLite avoid checking distant coordinates.
    delta_lat = (radius + 2) / 110.6
    delta_lng = (radius + 2) / max(40.0, 111.0 * math.cos(math.radians(lat)))
    rows = conn.execute('''SELECT osm_id,retailer,name,address,latitude,longitude FROM branches
        WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?''',
        (lat-delta_lat, lat+delta_lat, lng-delta_lng, lng+delta_lng))
    found = []
    for osm_id, store, name, address, x, y in rows:
        distance = haversine(lat, lng, x, y)
        if (distance <= radius and store in SUPPORTED
                and is_gqeberha_branch(x, y, name, address)):
            found.append({'id': osm_id, 'store': store, 'name': name, 'address': address,
                          'lat': x, 'lng': y, 'distanceKm': round(distance, 1)})
    return sorted(found, key=lambda b: (b['distanceKm'], b['store']))[:120]


def _answer(conn, lat, lng, radius, updated_at, status='ok', cache_hit=True):
    branches = _local_branches(conn, lat, lng, radius)
    return {'status': status, 'filterActive': True, 'stores': branches,
            'scope': 'Gqeberha only',
            'retailers': sorted({b['store'] for b in branches}), 'radiusKm': radius,
            'source': 'OpenStreetMap / Overpass (persisted branch coordinates)',
            'updatedAt': datetime.fromtimestamp(updated_at, timezone.utc).isoformat(),
            'cacheHit': cache_hit,
            'warning': 'Branch locations are mapped data; product prices and stock are not branch-specific.'}


def _overpass_query(lat, lng, radius):
    """Search name/brand/operator: OSM tags are inconsistent across EC."""
    meters = int(radius * 1000 + 1500)
    coords = f'(around:{meters},{lat:.5f},{lng:.5f})'
    regex = '(Checkers|Shoprite|Pick.*Pay|PnP|Woolworths)'
    return ('[out:json][timeout:18];('
            + ''.join(f'nwr["{tag}"~"{regex}",i]{coords};'
                      for tag in ('name', 'brand', 'operator'))
            + ');out center tags;')


def _fetch_overpass(query):
    """Fallback mirrors: one old/down server must not blank the map."""
    problems = []
    for url in _OVERPASS_URLS:
        try:
            payload = _read_url(url, payload=urlencode({'data': query}).encode('utf-8'), timeout=12)
            if not isinstance(payload, dict) or not isinstance(payload.get('elements'), list):
                raise ValueError('Overpass response has no valid elements array')
            if payload.get('remark') and not payload['elements']:
                raise RuntimeError(str(payload['remark'])[:120])
            return payload
        except Exception as exc:
            problems.append(f'{url}: {type(exc).__name__}')
    raise RuntimeError('All configured OpenStreetMap Overpass providers failed: ' + '; '.join(problems))


def nearby_branches(lat, lng, radius=15, refresh=False):
    lat, lng, radius = validate_location(lat, lng, radius)
    if not is_gqeberha_branch(lat, lng):
        return {'status': 'outside_gqeberha', 'scope': 'Gqeberha only',
                'filterActive': True, 'stores': [], 'retailers': [],
                'radiusKm': radius, 'cacheHit': True,
                'warning': 'SmartBasket currently maps supermarket branches in Gqeberha only.'}
    grid_lat, grid_lng = round(lat, 2), round(lng, 2)
    key = (grid_lat, grid_lng, radius)
    now = time.time()
    with _LOCK:
        with _connection() as conn:
            row = conn.execute('''SELECT updated_at FROM searched_regions WHERE
                grid_lat=? AND grid_lng=? AND radius_km=?''', key).fetchone()
            cached_branches = _local_branches(conn, lat, lng, radius)
            if not refresh:
                if row:
                    # An old negative cached search must not hide newly seeded
                    # Eastern Cape branches, and empty matches expire quickly.
                    ttl = BRANCH_TTL_SECONDS if cached_branches else 1800
                    if now - row[0] < ttl:
                        result = _answer(conn, lat, lng, radius, row[0], cache_hit=True)
                        if cached_branches and all(b['id'].startswith('osm-node-') for b in cached_branches):
                            result['source'] = 'OpenStreetMap mapped branches (local cache)'
                        return result
                if cached_branches:
                    # Return real, verified nodes right away when live Overpass
                    # is offline/slow. A refresh may be requested explicitly
                    # by the optional cache-warming script.
                    result = _answer(conn, lat, lng, radius, now, status='cached', cache_hit=True)
                    result['warning'] = ('Showing mapped branches saved locally. '
                                         'Other nearby shops may not yet be mapped.')
                    return result
            if now - _RECENT_FAILURES.get(key, 0) < _FAILURE_COOLDOWN_SECONDS:
                if row or _local_branches(conn, lat, lng, radius):
                    old_time = row[0] if row else now
                    result = _answer(conn, lat, lng, radius, old_time, status='stale')
                    result['warning'] = 'Using cached branch locations. Live map lookup is temporarily unavailable.'
                    return result
                raise RuntimeError('Store lookup is temporarily unavailable. Please retry shortly.')
            try:
                query = _overpass_query(grid_lat, grid_lng, radius)
                payload = _fetch_overpass(query)
                # No synthetic store coordinates; only real OSM elements.
                parsed = parse_branches(payload, grid_lat, grid_lng, radius + 1.5)
                for b in parsed:
                    conn.execute('''INSERT INTO branches (osm_id,retailer,name,address,latitude,longitude,last_seen)
                        VALUES (?,?,?,?,?,?,?) ON CONFLICT(osm_id) DO UPDATE SET
                        retailer=excluded.retailer,name=excluded.name,address=excluded.address,
                        latitude=excluded.latitude,longitude=excluded.longitude,last_seen=excluded.last_seen''',
                        (b['id'], b['store'], b['name'], b['address'], b['lat'], b['lng'], now))
                conn.execute('''INSERT INTO searched_regions (grid_lat,grid_lng,radius_km,updated_at)
                    VALUES (?,?,?,?) ON CONFLICT(grid_lat,grid_lng,radius_km) DO UPDATE SET
                    updated_at=excluded.updated_at''', (*key, now))
                _RECENT_FAILURES.pop(key, None)
                return _answer(conn, lat, lng, radius, now, cache_hit=False)
            except Exception:
                _RECENT_FAILURES[key] = now
                # Other nearby grid searches may have already saved real OSM
                # branches. Use them instead of dropping every marker.
                if row or _local_branches(conn, lat, lng, radius):
                    old_time = row[0] if row else now
                    result = _answer(conn, lat, lng, radius, old_time, status='stale')
                    result['warning'] = ('Using older verified branch locations. '
                                         'Live OpenStreetMap data is unavailable.')
                    return result
                raise

def available_collection_branches(retailer, lat=None, lng=None, *, limit=200):
    """List only persisted real map branches for a selected retailer.

    No fallback to unverified directories; caller must choose from this list.
    Coordinates are for display/distance only; not a stock guarantee.
    """
    if retailer not in SUPPORTED:
        raise ValueError('Choose one of the supported supermarkets')
    if lat is not None or lng is not None:
        try:
            lat, lng = float(lat), float(lng)
            if not valid_coordinates(lat, lng):
                lat, lng = None, None
        except (TypeError, ValueError, OverflowError):
            lat, lng = None, None
    count = max(1, min(int(limit), 300))
    with _LOCK:
        with _connection() as conn:
            rows = conn.execute("""SELECT osm_id, retailer, name, address, latitude, longitude
                FROM branches WHERE retailer=? ORDER BY name COLLATE NOCASE, address COLLATE NOCASE LIMIT 500""",
                (retailer,)).fetchall()
    result=[]
    for osm_id, store, name, address, x, y in rows:
        if not osm_id or not is_gqeberha_branch(x, y, name, address):
            continue
        entry = {'id': str(osm_id), 'store': store, 'name': str(name), 'address': str(address or ''),
                 'lat': float(x), 'lng': float(y)}
        if lat is not None and lng is not None:
            entry['distanceKm'] = round(haversine(lat, lng, float(x), float(y)), 1)
        result.append(entry)
    if lat is not None and lng is not None:
        result.sort(key=lambda b: (b['distanceKm'], b['name']))
    return result[:count]
