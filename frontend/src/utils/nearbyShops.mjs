
import { storeName } from './BasketComparison.mjs';

// Maps only verified OpenStreetMap branches of retailers present in the
// scraper's basket comparison. A match is for the retailer chain, not a
// branch-level stock or branch-specific price guarantee.
export function nearbyBasketChoices(report, branches) {
  const stores = Array.isArray(report?.stores) ? report.stores : [];
  const points = Array.isArray(branches) ? branches : [];
  const nearestByChain = new Map();

  for (const branch of points) {
    const retailer = storeName(branch?.store);
    const distanceKm = Number(branch?.distanceKm);
    const lat = Number(branch?.lat);
    const lng = Number(branch?.lng);

    if (!retailer || !Number.isFinite(distanceKm) || distanceKm < 0 ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const nearest = nearestByChain.get(retailer);

    if (!nearest || distanceKm < nearest.distanceKm) {
      nearestByChain.set(retailer, {
        id: branch.id,
        name: String(branch.name || retailer),
        address: String(branch.address || ''),
        lat,
        lng,
        distanceKm,
      });
    }
  }

  const options = stores
    .filter((store) => store.found > 0)
    .filter((store) => nearestByChain.has(storeName(store.name)))
    .map((store) => ({
      ...store,
      branch: nearestByChain.get(storeName(store.name))
    }));

  // A partial subtotal must NEVER outrank a complete basket total.
  // Among complete baskets, lowest price wins; distance breaks ties.
  // When nothing covers the basket, show the most complete nearby option,
  // but prominently mark its quoted subtotal as partial.
  options.sort((a, b) =>
    Number(b.complete) - Number(a.complete) ||
    (a.complete && b.complete
      ? a.total - b.total || a.branch.distanceKm - b.branch.distanceKm
      : b.found - a.found || a.total - b.total || a.branch.distanceKm - b.branch.distanceKm)
  );

  return {
    options,
    bestComplete: options.find((option) => option.complete) || null,
    bestPartial: options.find((option) => !option.complete) || null,
  };
}
