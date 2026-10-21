import importlib.util
import sqlite3
from contextlib import closing
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).parent / 'backend' / 'store_locations.py'
with TemporaryDirectory() as tmp:
    spec = importlib.util.spec_from_file_location('sb_ec_location_fix', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.DB_PATH = Path(tmp) / 'branches.sqlite3'
    with patch.object(m, '_fetch_overpass', side_effect=RuntimeError('OSM unreachable')):
        # New Brighton / Gqeberha: all four chains returned from cached real OSM nodes.
        r = m.nearby_branches(-33.91, 25.62, 15)
        chains = set(r['retailers'])
        assert chains == set(m.SUPPORTED), chains
        assert len(r['stores']) >= 4, r
        assert r['cacheHit'] and r['status'] == 'cached'
        assert all(row['id'].startswith('osm-node-') for row in r['stores'])
        assert all(row['distanceKm'] <= 15 for row in r['stores'])
        print('PASS Gqeberha: %d verified branches; all four chains; no network needed' % len(r['stores']))

        r2 = m.nearby_branches(-33.91, 25.62, 15)
        assert r2['stores'] == r['stores']
        print('PASS repeated searches: local cache, same results')

        east = m.nearby_branches(-33.01, 27.89, 15)
        assert east['status'] == 'outside_gqeberha' and not east['stores']
        print('PASS East London is excluded by the Gqeberha-only map scope')

        # Empty negative results previously cached must not hide new seeded nodes.
        with closing(sqlite3.connect(m.DB_PATH)) as conn, conn:
            conn.execute('INSERT INTO searched_regions VALUES (?,?,?,?)', (-33.91,25.62,15, m.time.time()))
        preseed = m.nearby_branches(-33.91, 25.62, 15)
        assert len(preseed['stores']) >= 4
        print('PASS previously empty cached region now returns seeded shops')

        # Forced refresh fails, but no verified shops are erased.
        forced = m.nearby_branches(-33.91, 25.62, 15, refresh=True)
        assert forced['status'] == 'stale' and len(forced['stores']) >= 4
        print('PASS live provider failure retains cached markers')

        # No counterfeit stock/chain names in local DB
        with closing(sqlite3.connect(m.DB_PATH)) as conn, conn:
            names = {row[0] for row in conn.execute('SELECT DISTINCT retailer FROM branches')}
        assert names == set(m.SUPPORTED)
        print('PASS stored retailer restriction: exactly 4 scraped chains')
print('ALL 6 TESTS PASSED')
