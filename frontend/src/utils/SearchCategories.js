// Shared categories for SmartBasket search and its navigation strip.
// Keep these consistent with the product.catalogCategory values returned by the API.ii
export const ALL_CATEGORIES = [
  'Grocery', 'Liquor', 'Pharmacy', 'Electronics', 'Baby',
  'Personal Care', 'Household', 'Pet Care', 'Other',
  'Tobacco', 'Age Restricted',
];

export const RESTRICTED_CATEGORIES = ['Liquor', 'Tobacco', 'Age Restricted'];

export function canBrowseRestrictedCategories(user) {
  return Boolean(user && (user.is_admin || user.isAdmin || user.age_group === 'adult'));
}

export function visibleCategories(user) {
  const canViewRestricted = canBrowseRestrictedCategories(user);
  return ALL_CATEGORIES.filter((category) =>
    canViewRestricted || !RESTRICTED_CATEGORIES.includes(category));
}

export function normalizeCatalogCategory(raw) {
  const candidate = String(raw ?? '').trim().toLowerCase();
  return ALL_CATEGORIES.find((category) => category.toLowerCase() === candidate) || null;
}

// Determine the most common *known* category in real search results.
// A missing backend category never becomes a made-up "Other" match.
export function inferSearchCategory(products, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle || ['all', 'deals'].includes(needle)) return null;

  const exactQueryCategory = normalizeCatalogCategory(needle);
  if (exactQueryCategory) return exactQueryCategory;

  const counts = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const category = normalizeCatalogCategory(product?.catalogCategory ?? product?.catalog_category);
    if (category) counts.set(category, (counts.get(category) || 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return null;
  return ranked[0][0];
}
