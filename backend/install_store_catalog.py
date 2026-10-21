"""Run once from backend/ to register the new store products API.

Keeps all existing app.py changes (sharing, equivalents, notifications, maps).
"""
from pathlib import Path
import shutil

base = Path(__file__).resolve().parent
app_file = base / 'app.py'
module = base / 'store_catalog.py'
if not app_file.is_file():
    raise SystemExit('Missing backend/app.py. Run this script inside your project backend folder.')
if not module.is_file():
    raise SystemExit('Missing backend/store_catalog.py. Copy it alongside this script first.')
source = app_file.read_text(encoding='utf-8')
registration = ('\n# SmartBasket: browsable, visibility-filtered retailer catalogues.\n'
                'from store_catalog import register_store_catalog\n'
                'register_store_catalog(app, Product, filter_catalog_for_viewer)\n')
if 'register_store_catalog(app, Product, filter_catalog_for_viewer)' in source:
    print('Store catalogue already installed; app.py unchanged.')
else:
    marker = "if __name__ == '__main__':"
    if marker not in source or 'class Product(db.Model)' not in source or 'def filter_catalog_for_viewer(' not in source:
        raise SystemExit('Could not safely locate SmartBasket backend startup or product model. app.py unchanged.')
    backup = base / 'app.py.before_store_page.bak'
    if not backup.exists():
        shutil.copy2(app_file, backup)
    app_file.write_text(source.replace(marker, registration + '\n' + marker, 1), encoding='utf-8')
    print('Registered /api/stores/<store_slug>/products in app.py; backup:', backup.name)
print('Restart the Flask backend after installation.')
