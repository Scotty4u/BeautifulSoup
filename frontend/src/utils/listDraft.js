const KEY = 'smartbasket:editing-list';
export function getListDraft() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return value && Number.isInteger(Number(value.id)) ? value : null;
  } catch { return null; }
}
export function startListDraft(basket) {
  const draft = { id: Number(basket.id), name: basket.name,
    base_revision: Number(basket.revision || 0),
    owner_id: basket.owner_id != null ? Number(basket.owner_id) : null };
  sessionStorage.setItem(KEY, JSON.stringify(draft));
  return draft;
}
export function finishListDraft() { sessionStorage.removeItem(KEY); }
