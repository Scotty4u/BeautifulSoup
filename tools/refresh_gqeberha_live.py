#!/usr/bin/env python3
"""One-time Railway run: warm real OSM grocery POIs for Gqeberha only.

Use on the deployed service, NOT `railway run` locally. Non-destructive;
creates a SQLite online backup on the volume before any refresh.
Never makes up addresses or OSM IDs, and never edits smartbasket.db.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from store_locations import DB_PATH, is_gqeberha_branch, nearby_branches  # noqa: E402

CENTRES = [
    ('Newton Park', -33.94917, 25.56408, 20),
    ('Central Gqeberha', -33.96093, 25.62168, 20),
    ('Korsten', -33.92666, 25.56957, 20),
    ('Moffett', -33.98378, 25.55436, 20),
    ('Motherwell', -33.813, 25.614, 15),
]


def rows_in_scope():
    with sqlite3.connect(str(DB_PATH), timeout=15) as conn:
        schema = {row[1] for row in conn.execute('PRAGMA table_info(branches)')}
        expected = {'osm_id', 'retailer', 'name', 'address', 'latitude', 'longitude', 'last_seen'}
        if not expected.issubset(schema):
            raise RuntimeError('Branch cache schema mismatch; refusing import')
        rows = list(conn.execute(
            'SELECT osm_id,retailer,name,address,latitude,longitude FROM branches'))
    return {row[0]: row for row in rows if is_gqeberha_branch(row[4], row[5], row[2], row[3])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Inspect DB and count only; no network or write')
    args = parser.parse_args()
    db = DB_PATH.expanduser().resolve()
    if db.name.lower() in ('smartbasket.db','smartbasket.sqlite3'):
        raise SystemExit('ERROR: Refusing to touch main SmartBasket DB')
    # Protect against accidentally running on a local temporary copy; Railway volume is /data.
    mount = Path(os.getenv('RAILWAY_VOLUME_MOUNT_PATH', '/data')).resolve()
    if not db.is_relative_to(mount):
        raise SystemExit(f'ERROR: DB {db} is not inside expected Railway volume {mount}')
    if not db.is_file():
        raise SystemExit(f'ERROR: Branch cache missing: {db}; check SMARTBASKET_BRANCH_CACHE_DB')
    previous = rows_in_scope()
    print(f'Volume database: {db}')
    print(f'Previously cached Gqeberha branch POIs: {len(previous)}')
    print('By store:', dict(Counter(row[1] for row in previous.values())))
    if args.dry_run:
        print('DRY RUN: no modifications. Existing out-of-area records stay hidden by the updated code.')
        return
    filename = db.with_name(db.name + '.backup-before-gqeberha-' +
                             datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.db')
    with sqlite3.connect(str(db), timeout=30) as source:
        with sqlite3.connect(str(filename)) as target:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity check failed')
    print(f'Created backup: {filename}')
    for label, lat, lng, radius in CENTRES:
        try:
            result = nearby_branches(lat, lng, radius, refresh=True)
            print(f'{label}: {result["status"]}, {len(result.get("stores", []))} in-range points')
        except Exception as error:
            print(f'{label}: live OSM lookup unavailable: {type(error).__name__}: {error}')
        time.sleep(2)  # Public Overpass fair-use spacing
    current = rows_in_scope()
    added = set(current) - set(previous)
    print(f'Gqeberha branch POIs now cached: {len(current)}; NEW this run: {len(added)}')
    print('By store:', dict(Counter(row[1] for row in current.values())))
    for ident in sorted(added):
        row=current[ident]
        print(f'ADDED {row[1]} | {row[2]} | {row[3]} | {row[4]:.5f}, {row[5]:.5f}')
    print('No non-Gqeberha branches are returned by the updated API or collection picker.')
    if not added:
        print('NOTE: Zero new points: OSM may be missing these stores or Overpass is unavailable. '
              'The directory candidate CSV cannot be automatically imported without verified POI coordinates.')


if __name__ == '__main__':
    main()
