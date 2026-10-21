// SmartBasket's local cart is available before login. Existing carts using older
// key names are read on the first visit and migrated without dropping items.
const CART_KEY = 'smartbasket_cart';
const LEGACY_KEYS = ['smartbasket-cart', 'smartBasketCart', 'cartItems', 'cart'];

const readList = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : null;
  } catch { return null; }
};
const normalize = (items) => (Array.isArray(items) ? items : [])
  .filter((item) => item?.id && item?.name)
  .map((item) => ({ ...item, quantity: Math.max(1, Math.min(1000, Math.floor(Number(item.quantity) || 1))) }));

export function getCart() {
  let list = readList(CART_KEY);
  if (!list) {
    for (const key of LEGACY_KEYS) {
      list = readList(key);
      if (list) { localStorage.setItem(CART_KEY, JSON.stringify(normalize(list))); break; }
    }
  }
  return normalize(list);
}

export function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(normalize(items)));
  window.dispatchEvent(new Event('smartbasket:cart-changed'));
  return getCart();
}

export const setCart = saveCart;
export function addToCart(item) {
  if (!item?.id) return getCart();
  const cart = getCart();
  const index = cart.findIndex((existing) => String(existing.id) === String(item.id));
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  if (index >= 0) cart[index] = { ...cart[index], quantity: Math.min(1000, cart[index].quantity + quantity) };
  else cart.push({ ...item, quantity });
  return saveCart(cart);
}
export function removeFromCart(id) {
  return saveCart(getCart().filter((item) => String(item.id) !== String(id)));
}
export function updateQuantity(id, quantity) {
  return saveCart(getCart().map((item) => String(item.id) === String(id) ? { ...item, quantity } : item).filter((item) => Number(item.quantity) > 0));
}
export function clearCart() { return saveCart([]); }
