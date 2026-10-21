import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Save, ShoppingCart, Trash2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { getCart, saveCart, clearCart } from '../utils/cart';
import { getListDraft, finishListDraft } from '../utils/listDraft';
import { isVisibleProduct } from '../utils/ProductVisibility';
import { BasketItemRow, BasketEmpty, BasketSummaryCard } from '../components/BasketPresentation';
import { Button } from '@/components/ui/button';

export default function BasketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState(() => getCart());
  const [draft, setDraft] = useState(() => getListDraft());
  const [name, setName] = useState(() => getListDraft()?.name || 'My grocery list');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingList, setDeletingList] = useState(false);
  const visibleItems = useMemo(() => items.filter((item) => isVisibleProduct(item, user)), [items, user]);

  useEffect(() => {
    const sync = () => setItems(getCart());
    window.addEventListener('smartbasket:cart-changed', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('smartbasket:cart-changed', sync); window.removeEventListener('storage', sync); };
  }, []);
  const changeCart = (next) => { saveCart(next); setItems(getCart()); };
  const quantity = (item, change) => changeCart(items.map((p) => p.id === item.id ? { ...p, quantity: Math.max(1, (Number(p.quantity) || 1) + change) } : p));
  const remove = (item) => changeCart(items.filter((p) => p.id !== item.id));
  const saveList = async () => {
    if (!user) { navigate('/login?next=%2Fbasket'); return; }
    if (saving || !visibleItems.length) return;
    setSaving(true);
    try {
      const { data } = await axios.post('/api/db/save-basket', {
        ...(draft ? { basket_id: draft.id, base_revision: draft.base_revision } : {}),
        name: name.trim() || 'My grocery list', items: visibleItems
      }, { withCredentials: true });
      finishListDraft(); setDraft(null);
      showToast(data.changes ? `${data.changes} changes saved and shared with list members.` : 'List is up to date.');
      navigate(`/saved/${data.basket_id}`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409 && err?.response?.data?.code === 'DUPLICATE_LIST_NAME') showToast('You already have a saved list with this name. Please choose another.', 'error');
      else if (status === 409) showToast('Another member updated this list. Open the saved list to see changes before saving.', 'error');
      else showToast(err?.response?.data?.error || 'Could not save this list.', 'error');
    } finally { setSaving(false); }
  };
  const deleteEntireList = async () => {
    if (!draft?.id || deletingList) return;
    setDeletingList(true);
    try {
      await axios.delete(`/api/db/saved-baskets/${encodeURIComponent(draft.id)}`, { withCredentials: true });
      clearCart();
      finishListDraft();
      setDraft(null);
      setItems([]);
      setConfirmDelete(false);
      showToast('The saved list has been deleted for all members.');
      navigate('/saved', { replace: true });
    } catch (err) {
      showToast(err?.response?.data?.error || 'Unable to delete this saved list.', 'error');
    } finally { setDeletingList(false); }
  };
  const clearLocalBasket = () => {
    if (!window.confirm('Remove every item from your shopping basket?')) return;
    clearCart();
    setItems([]);
    showToast('Shopping basket cleared.');
  };
  const canDeleteList = Boolean(draft?.id && user && (draft.owner_id != null && Number(draft.owner_id) === Number(user.id)));

  const compare = () => {
    if (!user) { navigate('/login?next=%2Fbasket%2Fcompare'); return; }
    if (!visibleItems.length) return;
    navigate('/basket/compare');
  };

  return <main className="min-h-screen bg-[#F8FAF8] px-4 py-8 sm:px-6">
    <div className="mx-auto max-w-6xl space-y-6">
      <button type="button" onClick={() => navigate(draft ? `/saved/${draft.id}` : '/search')} className="flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" /> {draft ? 'Back to saved list' : 'Continue shopping'}</button>
      <header className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-100 to-white p-6 sm:p-8">
        <h1 className="flex items-center gap-3 text-2xl font-black text-slate-950 sm:text-3xl"><ShoppingCart className="h-7 w-7 text-emerald-700" /> {draft ? `Editing: ${draft.name}` : 'My basket'}</h1>
        <p className="mt-2 text-sm text-slate-600">{draft ? 'Add products from Search, then press Save changes. Everyone on the list will see your update.' : 'Add groceries freely. Sign in to save your basket or compare the whole list.'}</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-black text-slate-900">Basket products ({visibleItems.length})</h2><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigate('/search')} className="rounded-xl">Add products <Plus className="ml-2 h-4 w-4" /></Button>{!draft && items.length > 0 && <Button variant="outline" onClick={clearLocalBasket} className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"><Trash2 className="mr-2 h-4 w-4" /> Clear basket</Button>}</div></div>
          {visibleItems.length ? visibleItems.map((item) => <BasketItemRow key={item.id} item={item} controls={<div className="flex items-center gap-2">
            <button type="button" aria-label={`Decrease ${item.name}`} onClick={() => quantity(item, -1)} className="rounded-lg border p-2"><Minus className="h-4 w-4" /></button>
            <span className="min-w-6 text-center font-extrabold">{item.quantity || 1}</span>
            <button type="button" aria-label={`Increase ${item.name}`} onClick={() => quantity(item, 1)} className="rounded-lg border p-2"><Plus className="h-4 w-4" /></button>
            <button type="button" aria-label={`Remove ${item.name}`} onClick={() => remove(item)} className="rounded-lg border border-red-200 p-2 text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>}/>) : <BasketEmpty />}
          {items.length > visibleItems.length && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Some items are not shown because of account restrictions. They are not sent when you save this basket.</p>}
        </section>
        <BasketSummaryCard items={visibleItems}>
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-800" htmlFor="saved-list-name">List name</label>
            <input id="saved-list-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-emerald-500" />
            <Button onClick={saveList} disabled={saving || !visibleItems.length} className="h-11 w-full rounded-xl bg-emerald-600 font-bold hover:bg-emerald-700"><Save className="mr-2 h-4 w-4" /> {saving ? 'Saving...' : draft ? 'Save changes to this list' : 'Save basket'}</Button>
            <Button onClick={compare} disabled={!visibleItems.length} className="h-11 w-full rounded-xl bg-emerald-700 text-white font-bold hover:bg-emerald-800">{user ? 'Compare Retailer Prices' : 'Sign in to Compare Retailer Prices'} <ArrowRight className="ml-2 h-4 w-4" /></Button>
            <Button type="button" onClick={() => navigate(user ? "/checkout" : "/login?next=%2Fcheckout")} disabled={!visibleItems.length} className="h-11 w-full rounded-xl bg-slate-900 font-bold text-white hover:bg-slate-800">{user ? "Place simulated order" : "Sign in to place a simulated order"} <ArrowRight className="ml-2 h-4 w-4" /></Button>
            {canDeleteList && <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)} className="h-11 w-full rounded-xl border-red-200 font-extrabold text-red-700 hover:bg-red-50"><Trash2 className="mr-2 h-4 w-4" /> Delete entire saved list</Button>}
            {draft && <button type="button" className="text-xs font-bold text-red-600" onClick={() => { if (window.confirm('Stop editing the saved list?')) { finishListDraft(); setDraft(null); } }}>Stop editing this list</button>}
            <p className="text-xs text-slate-500">Prices are estimates and may change at the retailer.</p>
          </div>
        </BasketSummaryCard>
      </div>
      {confirmDelete && createPortal(<div role="dialog" aria-modal="true" aria-labelledby="cart-delete-title" className="fixed inset-0 z-[9999] flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-slate-950/65 p-4">
        <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
          <div className="mb-3 inline-flex rounded-xl bg-rose-50 p-3 text-rose-600"><Trash2 className="h-6 w-6" /></div>
          <h2 id="cart-delete-title" className="text-xl font-black text-slate-900">Delete this entire saved list?</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">This permanently deletes <strong>{draft?.name}</strong> for everyone who shares it, including all products, invitations and activity history. This cannot be undone.</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={deletingList} onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button type="button" disabled={deletingList} onClick={deleteEntireList} className="bg-red-600 text-white hover:bg-red-700">{deletingList ? 'Deleting...' : 'Delete entire list'}</Button>
          </div>
        </section>
      </div>, document.body)}

    </div>
  </main>;
}
