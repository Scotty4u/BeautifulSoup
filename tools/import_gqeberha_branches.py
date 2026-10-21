#!/usr/bin/env python3
"""Safely merge the local refresh script's verified OSM CSV into Railway's
persisted SmartBasket branch-coordinate cache.

Requires only Python's standard library. Never reads or writes smartbasket.db.
Run on Railway with SMARTBASKET_BRANCH_CACHE_DB set to the branch cache on its
persisted volume, not SMARTBASKET_DB_PATH.

CSV columns: id,store,name,address,lat,lng
"""

import argparse
import csv
from datetime import datetime, timezone
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

STORES = frozenset(('Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths'))
OSM_ID = re.compile(r'^osm-(?:node|way|relation)-[0-9]+$')
FIELDS = frozenset(('id', 'store', 'name', 'address', 'lat', 'lng'))
BRANCH_COLUMNS = frozenset(('osm_id', 'retailer', 'name', 'address',
                            'latitude', 'longitude', 'last_seen'))


def load_csv(path):
    if not path.is_file():
        raise ValueError(f'Cannot find CSV: {path}')
    entries = {}
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or not FIELDS.issubset(reader.fieldnames):
            raise ValueError('Expected CSV columns: id,store,name,address,lat,lng')
        for line, record in enumerate(reader, start=2):
            ident = str(record['id'] or '').strip()
            store = str(record['store'] or '').strip()
            name = str(record['name'] or '').strip()
            address = str(record['address'] or '').strip()
            if not OSM_ID.fullmatch(ident):
                raise ValueError(f'Line {line}: invalid OSM ID {ident!r}')
            if store not in STORES:
                raise ValueError(f'Line {line}: unsupported retailer {store!r}')
            if not name or len(name) > 100 or len(address) > 500:
                raise ValueError(f'Line {line}: missing/oversized branch name or address')
            try:
                lat = float(record['lat'])
                lng = float(record['lng'])
            except (ValueError, TypeError, OverflowError) as exc:
                raise ValueError(f'Line {line}: invalid coordinates') from exc
            if not (math.isfinite(lat) and math.isfinite(lng) and
                    -35.5 <= lat <= -21.5 and 16 <= lng <= 34):
                raise ValueError(f'Line {line}: coordinate outside supported SA bounds')
            row = (ident, store, name, address, lat, lng)
            if ident in entries and entries[ident] != row:
                raise ValueError(f'Line {line}: conflicting duplicate OSM ID {ident}')
            entries[ident] = row
    if not entries:
        raise ValueError('CSV has no branches. Nothing imported.')
    return list(entries.values())


def select_paths(csv_path, explicit_db=None):
    db_value = explicit_db or os.environ.get('SMARTBASKET_BRANCH_CACHE_DB', '').strip()
    if not db_value:
        raise ValueError('SMARTBASKET_BRANCH_CACHE_DB must point to the branch-cache SQLite file on the Railway volume')
    db_path = Path(db_value).expanduser().resolve()
    main_db = os.environ.get('SMARTBASKET_DB_PATH', '').strip()
    if (db_path.name.lower() in ('smartbasket.db', 'smartbasket.sqlite', 'smartbasket.sqlite3')
            or (main_db and db_path == Path(main_db).expanduser().resolve())):
        raise ValueError('Refusing to write the main SmartBasket customer/orders database')
    mount = os.environ.get('RAILWAY_VOLUME_MOUNT_PATH', '').strip()
    if mount and not db_path.is_relative_to(Path(mount).resolve()):
        raise ValueError(f'Configured branch-cache path {db_path} is NOT inside Railway volume {mount}. Refusing nonpersistent write.')
    return Path(csv_path).expanduser().resolve(), db_path


def import_rows(rows, db_path):
    if not db_path.parent.exists():
        raise ValueError(f'Database parent folder does not exist: {db_path.parent}')
    existed = db_path.exists()
    with sqlite3.connect(str(db_path), timeout=20) as conn:
        # Check existing schema before any changes; stop rather than guessing.
        if existed:
            result = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='branches'").fetchone()
            if result:
                actual = {row[1] for row in conn.execute('PRAGMA table_info(branches)')}
                if not BRANCH_COLUMNS.issubset(actual):
                    raise ValueError('Existing branches table has an unexpected schema; no changes made')
            else:
                tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if tables and ('users' in tables or 'orders' in tables):
                    raise ValueError('Target contains customer/order tables, not a branch cache; no changes made')
            # sqlite backup is safe even when an app has the file open.
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup_path = db_path.with_name(db_path.name + f'.pre-gqeberha-{stamp}.bak')
            with sqlite3.connect(str(backup_path)) as backup:
                conn.backup(backup)
            print(f'Branch-cache backup saved: {backup_path}')
        conn.execute('''CREATE TABLE IF NOT EXISTS branches (
            osm_id TEXT PRIMARY KEY, retailer TEXT NOT NULL, name TEXT NOT NULL,
            address TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
            last_seen REAL NOT NULL)''')
        conn.execute('CREATE INDEX IF NOT EXISTS branch_coords ON branches(latitude, longitude)')
        conn.execute('''CREATE TABLE IF NOT EXISTS searched_regions (
            grid_lat REAL NOT NULL, grid_lng REAL NOT NULL, radius_km INTEGER NOT NULL,
            updated_at REAL NOT NULL,
            PRIMARY KEY(grid_lat,grid_lng,radius_km))''')
        before = conn.execute('SELECT COUNT(*) FROM branches').fetchone()[0]
        now = time.time()
        conn.executemany('''INSERT OR IGNORE INTO branches
            (osm_id, retailer, name, address, latitude, longitude, last_seen)
            VALUES (?,?,?,?,?,?,?)''', [(*row, now) for row in rows])
        after = conn.execute('SELECT COUNT(*) FROM branches').fetchone()[0]
        conn.commit()
        print(f'Imported {after-before} NEW branches. Skipped {len(rows)-(after-before)} already present.')
        print(f'Branch cache now has {after} records at: {db_path}')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('csv_file', help='Verified CSV made by refresh_gqeberha_branches.py')
    p.add_argument('--db', help='Explicit branch cache location (normally use Railway env variable)')
    p.add_argument('--dry-run', action='store_true', help='Validate without changing SQLite')
    args = p.parse_args()
    try:
        csv_path, db_path = select_paths(args.csv_file, args.db)
        rows = load_csv(csv_path)
        print(f'Validated {len(rows)} unique OSM branches from {csv_path}')
        print(f'Target branch cache: {db_path}')
        if args.dry_run:
            print('DRY RUN successful: no database changes made.')
            return 0
        import_rows(rows, db_path)
        return 0
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
