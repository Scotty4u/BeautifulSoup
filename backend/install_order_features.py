"""Patch your existing backend/app.py safely without replacing other API routes.

Run in backend/ with:  py install_order_features.py
"""
from pathlib import Path
import ast
import shutil
from datetime import datetime

here = Path(__file__).resolve().parent
app_file = here / 'app.py'
module_file = here / 'order_features.py'
if not app_file.is_file() or not module_file.is_file():
    raise SystemExit('Both app.py and order_features.py must be in backend/ before running this script.')
source = app_file.read_text(encoding='utf-8')
marker = '# SMARTBASKET ORDER FEATURES - installed'
if marker in source:
    print('Order features already installed. No changes necessary.')
    raise SystemExit(0)
anchor = "if __name__ == '__main__':"
if anchor not in source:
    raise SystemExit('Cannot safely find Flask startup anchor. Your app.py was not changed.')
block = '''# SMARTBASKET ORDER FEATURES - installed
from order_features import register_order_features
register_order_features(
    app, db, User, Product, recent_indexed_offer,
    product_is_adult, product_is_clothing, age_from_date,
)

'''
modified = source.replace(anchor, block + anchor, 1)
ast.parse(modified)
backup = here / f'app.py.before_orders_{datetime.now():%Y%m%d_%H%M%S}.bak'
shutil.copy2(app_file, backup)
app_file.write_text(modified, encoding='utf-8')
print(f'Installed checkout, order history, savings and admin analytics. Backup: {backup.name}')
print('Existing scraper, list-sharing and location endpoints were not replaced.')
