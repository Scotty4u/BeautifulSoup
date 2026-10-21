// Honest store-level basket aggregation from actual scraper offers.
// No invented prices or stock, no confusing a partial basket with a full basket.
export const RETAILERS = ['Pick n Pay', 'Shoprite', 'Checkers', 'Woolworths'];
export function storeName(name) {
  const lower = String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (lower === 'pnp' || lower === 'picknpay' || lower === 'pickandpay') return 'Pick n Pay';
  return RETAILERS.find((s) => s.replace(/[^a-z0-9]/gi, '').toLowerCase() === lower) || null;
}
export function priceOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) && valueNumber > 0 ? valueNumber : null;
}
export function quantityOf(item) {
  return Math.max(1, Math.min(1000, Math.trunc(Number(item?.quantity) || 1)));
}
const isExact = (offer) => offer?.isExact !== false && offer?.is_exact_match !== false &&
  !['equivalent', 'store_equivalent', 'family'].includes(String(offer?.matchType || '').toLowerCase());

export function buildBasketComparison(items, response) {
  const list = Array.isArray(items) ? items.filter((item) => item?.name) : [];
  const unique = [...new Map(list.map((item) => [String(item.id ?? item.name), item])).values()];
  const offersByName = response && typeof response === 'object' ? response : {};
  const stores = RETAILERS.map((name) => {
    const rows = unique.map((item) => {
      const options = Array.isArray(offersByName[item.name]) ? offersByName[item.name] : [];
      const matching = options.filter((offer) => storeName(offer?.store) === name && priceOf(offer?.price) !== null);
      // Prefer exact product, even when an equivalent is cheaper.
      matching.sort((a, b) => Number(!isExact(a)) - Number(!isExact(b)) || priceOf(a.price) - priceOf(b.price));
      const offer = matching[0] || null;
      const quantity = quantityOf(item);
      return { item, quantity, offer, exact: offer ? isExact(offer) : false,
        subtotal: offer ? priceOf(offer.price) * quantity : null };
    });
    const found = rows.filter((row) => row.offer).length;
    const exactFound = rows.filter((row) => row.exact).length;
    const total = rows.reduce((sum, row) => sum + (row.subtotal || 0), 0);
    const complete = Boolean(unique.length) && found === unique.length;
    return { name, rows, found, exactFound, missing: unique.length - found, total,
      complete, hasEquivalents: rows.some((row) => row.offer && !row.exact) };
  });
  // Keep ALL four retailer panels, even if their scraper returned no offers.
  // Full-basket offers lead, then partial coverage; empty stores come last.
  const comparedStores = [...stores].sort((a, b) =>
    Number(b.complete) - Number(a.complete) ||
    b.found - a.found ||
    (a.found && b.found ? a.total - b.total : 0) ||
    RETAILERS.indexOf(a.name) - RETAILERS.indexOf(b.name));
  const completeStores = comparedStores.filter((store) => store.complete).sort((a, b) => a.total - b.total);
  const winner = completeStores[0] || null;
  const availableFor = unique.map((item) => {
    const alternatives = stores.flatMap((store) => {
      const row = store.rows.find((entry) => String(entry.item.id ?? entry.item.name) === String(item.id ?? item.name));
      return row?.offer ? [{ ...row, store: store.name }] : [];
    }).sort((a, b) => Number(!a.exact) - Number(!b.exact) || a.subtotal - b.subtotal);
    return { item, chosen: alternatives[0] || null };
  });
  const splitCovered = availableFor.filter((entry) => entry.chosen).length;
  const splitTotal = availableFor.reduce((sum, entry) => sum + (entry.chosen?.subtotal || 0), 0);
  return { stores: comparedStores, winner, itemCount: unique.length, splitCovered, splitTotal, splitRows: availableFor };
}