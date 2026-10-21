// Only retailers supported by SmartBasket's scraper.
export const RETAILERS = [
  { slug: 'pick-n-pay', name: 'Pick n Pay', query: 'pnp' },
  { slug: 'shoprite', name: 'Shoprite', query: 'shoprite' },
  { slug: 'checkers', name: 'Checkers', query: 'checkers' },
  { slug: 'woolworths', name: 'Woolworths', query: 'woolworths' },
];

export function retailerBySlug(slug) {
  return RETAILERS.find((store) => store.slug === slug) || null;
}

export function storeSlugFor(name) {
  const plain = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['picknpay', 'pnp', 'pickandpay'].includes(plain)) return 'pick-n-pay';
  return RETAILERS.find((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === plain)?.slug || null;
}
