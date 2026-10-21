export const LOCATION_KEY = 'smartbasket:shopping-location';
export const LOCATION_EVENT = 'smartbasket:location-changed';
export const STORE_NAMES = ['Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths'];
export const RADII = [5, 10, 15, 20, 30, 50];

export function validShoppingLocation(value) {
  return value && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng)) &&
    Number(value.lat) >= -35.5 && Number(value.lat) <= -21.5 &&
    Number(value.lng) >= 16 && Number(value.lng) <= 34 && RADII.includes(Number(value.radius_km));
}
export function getShoppingLocation() {
  try {
    const candidate = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null');
    return validShoppingLocation(candidate) ? candidate : null;
  } catch { return null; }
}
export function setShoppingLocation(value) {
  const data = validShoppingLocation(value) ? {
    name: String(value.name || 'Selected location').slice(0, 100),
    lat: Number(value.lat), lng: Number(value.lng), radius_km: Number(value.radius_km),
  } : null;
  try {
    if (data) localStorage.setItem(LOCATION_KEY, JSON.stringify(data));
    else localStorage.removeItem(LOCATION_KEY);
  } catch { /* storage disabled; event still updates active tab */ }
  window.dispatchEvent(new CustomEvent(LOCATION_EVENT, { detail: data }));
  return data;
}
