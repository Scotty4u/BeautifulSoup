"""Shared broad product categories. No network calls or client query guessing.

Specific product types resolve ambiguous words; retailer taxonomy is preferred
for remaining items. Unknown products remain Other. Age/clothing policy stays
in app.classify_product and runs before this module.
"""
import re

SOURCE_FIELDS = (
    'sourceCategories', 'category', 'categoryName', 'category_name',
    'department', 'departmentName', 'department_name', 'subCategory',
    'subcategory', 'subCategoryName', 'productType', 'product_type',
    'breadcrumbs', 'categories', 'hierarchy', 'taxonomy', 'categoryPath',
    'categoryLabel', 'aisle', 'aisleName', 'departments',
)


def _labels(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        return [label for part in value for label in _labels(part)]
    if isinstance(value, dict):
        return [label for key, part in value.items()
                if key.lower() not in {'id', 'code', 'url', 'image', 'imageurl'}
                for label in _labels(part)]
    return []


def retailer_categories(item):
    """Preserve only category labels from the retailer, not the entire payload."""
    if not isinstance(item, dict):
        return []
    return list(dict.fromkeys(label.strip()[:200] for field in SOURCE_FIELDS
                             for label in _labels(item.get(field)) if label.strip()))[:40]


def _matches(pattern, value):
    return re.search(r'\b(?:' + pattern + r')\b', value, re.I) is not None


# Exact product phrases precede broad departments and ambiguous words such as
# baby, tablets, cream, oil and food. Order is intentional.
SPECIFIC_RULES = (
    ('Electronics', r'tablet\s+(?:computer|pc)|(?:android|samsung|lenovo)\s+tablet|ipad|power\s*bank|usb\s+(?:cable|charger)|earbuds'),
    ('Household', r'dishwash(?:er|ing)|laundry|washing\s+(?:powder|liquid|capsules)|cleaning\s+wipes|toilet\s+(?:paper|rolls?|cleaner)|kitchen\s+(?:towels?|rolls?)|paper\s+towels?|methylated\s+spirits|rubbing\s+alcohol|surgical\s+spirits|rubber\s+gloves'),
    ('Pet Care', r'(?:dog|cat|puppy|kitten|pet|bird|fish)\s+(?:food|treats?|biscuits?|pellets?|litter|shampoo)|cat\s+litter|whiskas|pedigree|catmor|dogmor|bobtail'),
    ('Grocery', r'baby\s+(?:spinach|marrow|carrots?|potatoes|corn|beetroot)|ginger\s+ale|wine\s+(?:gums?|vinegar)|ice\s*cream|cream\s+(?:cheese|crackers)|coconut\s+(?:milk|cream)|peanut\s+butter|(?:olive|sunflower|canola|cooking)\s+oil|(?:protein|energy|cereal|chocolate)\s+bars?'),
    ('Baby', r'napp(?:y|ies)|diapers?|infant\s+formula|baby\s+(?:formula|food|cereal|wipes|lotion|shampoo|oil|powder|bottles?)|follow[- ]on\s+formula|huggies|pampers|cerelac|purity\s+(?:baby|junior)'),
    ('Pharmacy', r'paracetamol|ibuprofen|panado|disprin|allergex|painkillers?|cough\s+syrup|antacid|multivitamins?|vitamin\s*[a-dk0-9]|dietary\s+supplements?|first\s+aid|antiseptic|bandages?|medicated|medicine'),
    ('Personal Care', r'body\s+(?:wash|lotion|butter|cream)|hand\s+(?:wash|cream|soap)|face\s+(?:wash|cream|cleanser)|shaving\s+(?:cream|gel)|hair\s+(?:oil|conditioner|dye)|toothpaste|toothbrush|mouthwash|deodorant|shampoo|sunscreen|sanitary\s+pads?|tampons'),
)

METADATA_RULES = (
    ('Pet Care', r'pet(?:s|\s+care|\s+food)?'),
    ('Baby', r'baby(?:\s+care|\s+food)?|infant|maternity|nappies'),
    ('Pharmacy', r'pharmacy|medicines?|healthcare|vitamins?|supplements?|first\s+aid'),
    ('Electronics', r'electronics?|computers?|mobile\s+phones?|electrical|appliances?|technology'),
    ('Household', r'household|cleaning|laundry|homeware|kitchenware|home\s+(?:care|living)|garden'),
    ('Personal Care', r'personal\s+care|beauty|toiletries|skin\s*care|hair\s*care|oral\s*care|bath\s*(?:and|&)\s*body'),
    ('Grocery', r'grocery|groceries|food|beverages?|drinks?|bakery|dairy|eggs?|fresh\s+produce|fruit|vegetables?|meat|poultry|seafood|frozen|pantry|snacks?|confectionery|deli'),
)

NAME_RULES = (
    ('Electronics', r'phones?|laptops?|computers?|televisions?|chargers?|headphones?|speakers?|batteries|kettles?|toasters?|microwaves?|air\s+fryers?'),
    ('Household', r'detergent|bleach|cleaners?|disinfectant|dishcloth|sponges?|bin\s+bags?|refuse\s+bags?|foil|cling\s+wrap|candles?|insecticide|air\s+freshener|serviettes?|napkins?|tissues'),
    ('Personal Care', r'conditioner|lotion|soap|razors?|perfume|cosmetics?|makeup|lipstick|cotton\s+(?:buds|pads)|shower\s+gel|sanitisers?|sanitizers?'),
    ('Pharmacy', r'vitamins?|supplements?|lozenges?|plasters?|capsules?|tablets'),
    ('Grocery', r'milk|bread|rice|eggs?|juice|meat|chicken|beef|pork|lamb|fish|tuna|salmon|prawns?|sausage|boerewors|bacon|ham|biltong|fruit|vegetables?|apples?|bananas?|oranges?|tomatoes|potatoes|onions?|carrots?|spinach|lettuce|avocado|sugar|coffee|tea|flour|pasta|butter|cheese|yog[uh]urt|cream|oats|cereal|maize|mealie|pap|samp|beans?|lentils?|chickpeas?|peas|soup|sauce|ketchup|mayonnaise|chutney|spices?|salt|pepper|vinegar|jam|honey|chocolate|biscuits?|cookies|crackers?|chips|crisps|popcorn|nuts?|raisins?|sweets?|candy|marshmallows?|water|cola|lemonade|soda|cooldrink|soft\s+drink|rooibos|noodles?|couscous|quinoa|pizza|pies?|pastry|croissants?|muffins?|cake|rusks|rolls?|fanta|sprite|coca[- ]cola|pepsi|appletiser|red\s+bull|energade|powerade'),
)


def display_category(item):
    if isinstance(item, dict):
        name = str(item.get('name') or item.get('title') or '')
        labels = retailer_categories(item)
        previous = item.get('catalogCategory')
    else:
        name = str(item if isinstance(item, str) else getattr(item, 'name', '') or '')
        labels = []
        previous = getattr(item, 'catalog_category', None)
    for category, pattern in SPECIFIC_RULES:
        if _matches(pattern, name):
            return category
    # Prefer the deepest retailer breadcrumb when a hierarchy is supplied.
    for label in reversed(labels):
        for category, pattern in METADATA_RULES:
            if _matches(pattern, label):
                return category
    for category, pattern in NAME_RULES:
        if _matches(pattern, name):
            return category
    known = {category for category, _ in METADATA_RULES}
    return previous if previous in known else 'Other'
