import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, ArrowRight, CalendarDays, ClipboardList, Copy, Minus, Plus, Share2, ShoppingCart, Trash2, Users, UserPlus, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { getCart, saveCart } from '../utils/cart';
import { startListDraft } from '../utils/listDraft';
import { isVisibleProduct } from '../utils/ProductVisibility';
import { Button } from '@/components/ui/button';
import { BasketEmpty, BasketItemRow, BasketLoading, BasketSummaryCard, quantityOf } from '../components/BasketPresentation';
import BasketActivityFeed from '../components/BasketActivityFeed';
import ListMemberAvatars from '../components/ListMemberAvatars';

export default function SavedBasketDetailPage() {
  const { basketId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const [basket, setBasket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyItem, setBusyItem] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [people, setPeople] = useState([]);
  const [searchUsers, setSearchUsers] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [inviteBusy, setInviteBusy] = useState(false);

  const loadBasket = useCallback(async (signal) => {
    try {
      const { data } = await axios.get('/api/db/saved-baskets', { withCredentials: true, signal });
      const selected = (Array.isArray(data) ? data : []).find((item) => String(item.id) === String(basketId));
      if (!signal?.aborted) {
        setBasket(selected || null);
        if (selected?.collaborators) setPeople(selected.collaborators);
        setError(selected ? '' : 'This saved basket was not found or is not available to your account.');
      }
    } catch (err) {
      if (!signal?.aborted) setError(err?.response?.status === 401 ? 'Sign in to see your saved baskets.' : 'We could not load this basket. Please retry.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [basketId]);

  useEffect(() => {
    const controller = new AbortController();
    setBasket(null);
    setError('');
    setLoading(true);
    loadBasket(controller.signal);
    const refresh = () => { if (document.visibilityState === 'visible') loadBasket(controller.signal); };
    const interval = window.setInterval(refresh, 6000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [loadBasket]);

  useEffect(() => {
    if (!basketId) return;
    let mounted = true;
    const load = async () => {
      try {
        const { data } = await axios.get(`/api/saved-baskets/${encodeURIComponent(basketId)}/collaborators`, { withCredentials: true });
        if (mounted) setPeople(Array.isArray(data) ? data : []);
      } catch { if (mounted) setPeople([]); }
    };
    load();
    const interval = window.setInterval(load, 10000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [basketId]);
  useEffect(() => {
    if (searchUsers.trim().length < 2 || !inviting) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get('/api/users/search', {
          params: { q: searchUsers.trim() }, signal: controller.signal, withCredentials: true
        });
        setSuggestions(Array.isArray(data) ? data : []);
      } catch { if (!controller.signal.aborted) setSuggestions([]); }
    }, 260);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [searchUsers, inviting]);

  const sendInvite = async (candidate) => {
    if (inviteBusy) return;
    setInviteBusy(true);
    try {
      await axios.post(`/api/saved-baskets/${encodeURIComponent(basketId)}/invite`, { user_id: candidate.id }, { withCredentials: true });
      setPeople((list) => [...list, { ...candidate, status: 'pending', role: 'editor' }]);
      await loadBasket();
      setSearchUsers(''); setInviting(false);
      showToast(`Invitation sent to ${candidate.username}. They can accept in Notifications.`);
    } catch (err) { showToast(err?.response?.data?.error || 'Could not invite this user.', 'error'); }
    finally { setInviteBusy(false); }
  };

  const visibleItems = useMemo(() => (basket?.items || []).filter((item) => isVisibleProduct(item, user)), [basket, user]);
  const hiddenCount = Math.max(0, (basket?.items?.length || 0) - visibleItems.length);
  const isOwner = Boolean(basket?.is_owner || (basket?.owner_id && user?.id && Number(basket.owner_id) === Number(user.id)));
  const ownerProfile = basket?.owner_profile || { id: basket?.owner_id || (isOwner ? user?.id : null), username: isOwner ? (user?.username || 'You') : (basket?.inviter_name || 'List owner') };


  const changeQuantity = async (item, change) => {
    if (!item?.id || busyItem || quantityOf(item) + change < 1) return;
    setBusyItem(String(item.id));
    try {
      await axios.patch(`/api/db/saved-baskets/${encodeURIComponent(basketId)}/items/${encodeURIComponent(item.id)}`, { change }, { withCredentials: true });
      await loadBasket();
    } catch (err) {
      showToast(err?.response?.data?.error || 'Could not update quantity.', 'error');
    } finally {
      setBusyItem('');
    }
  };

  const removeProduct = async (item) => {
    if (!item?.id || busyItem || !window.confirm(`Remove ${item.name} from this basket?`)) return;
    setBusyItem(String(item.id));
    try {
      await axios.delete(`/api/db/saved-baskets/${encodeURIComponent(basketId)}/items/${encodeURIComponent(item.id)}`, { withCredentials: true });
      await loadBasket();
      showToast('Item removed from your basket.');
    } catch (err) {
      showToast(err?.response?.data?.error || 'Could not remove item.', 'error');
    } finally {
      setBusyItem('');
    }
  };

  const copyShareLink = async () => {
    if (sharing || (!isOwner && !basket?.is_public)) return;
    setSharing(true);
    try {
      // Publishing happens only after an explicit click by the owner.
      const token = isOwner
        ? (await axios.post(`/api/saved-baskets/${encodeURIComponent(basketId)}/share`, {}, { withCredentials: true })).data.share_token
        : basket.share_token;
      if (!token) throw new Error('No share link returned.');
      const url = `${window.location.origin}/shared/basket/${encodeURIComponent(token)}`;
      setBasket((previous) => previous && { ...previous, is_public: true, share_token: token });
      try {
        await navigator.clipboard.writeText(url);
        showToast('Public link copied. Anyone with this link can view, but only list members can edit.');
      } catch {
        window.prompt('Your list is public. Copy this link:', url);
      }
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Could not share this list.', 'error');
    } finally { setSharing(false); }
  };

  const makePrivate = async () => {
    if (!isOwner || sharing || !window.confirm('Make this list private? Everyone with the public link will lose access. Your accepted collaborators will keep access through their accounts.')) return;
    setSharing(true);
    try {
      await axios.delete(`/api/saved-baskets/${encodeURIComponent(basketId)}/share`, { withCredentials: true });
      setBasket((previous) => previous && { ...previous, is_public: false, share_token: null });
      showToast('List is private again. Previously shared public links no longer work.');
      await loadBasket();
    } catch (err) { showToast(err?.response?.data?.error || 'Could not change list privacy.', 'error'); }
    finally { setSharing(false); }
  };

  const addAllToCart = () => {
    if (!visibleItems.length) return;
    if (getCart().length && !window.confirm('Replace your current basket with the items from this saved list?')) return;
    saveCart(visibleItems);
    startListDraft(basket);
    showToast('This basket is linked to your saved list. Add products, then press Save changes.');
    navigate('/basket');
  };

  const deleteBasket = async () => {
    if (!basket || deleting) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/db/saved-baskets/${encodeURIComponent(basketId)}`, { withCredentials: true });
      showToast('Saved basket deleted.');
      navigate('/saved', { replace: true });
    } catch (err) {
      showToast(err?.response?.data?.error || 'Could not delete this basket.', 'error');
      setDeleting(false);
    }
  };

  if (loading) return <BasketLoading />;
  if (error || !basket) return <div className="mx-auto max-w-2xl px-4 py-16 text-center"><div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><ClipboardList className="mx-auto h-12 w-12 text-slate-300" /><h1 className="mt-4 text-xl font-black text-slate-900">Basket unavailable</h1><p className="mt-2 text-sm text-slate-600">{error || 'Basket not found.'}</p><Button className="mt-6 rounded-xl bg-emerald-700" onClick={() => navigate('/saved')}>Back to saved baskets</Button></div></div>;

  return (
    <main className="min-h-screen bg-[#F8FAF8] pb-16">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-6 sm:py-9">
        <Link to="/saved" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-emerald-700"><ArrowLeft className="h-4 w-4" /> Saved baskets</Link>
        <header className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-[#DFF3E3] via-[#F2FAF3] to-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div className="min-w-0 space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-[#047857]"><ClipboardList className="h-4 w-4" /> Saved grocery list</span>
              <span className={`ml-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold ${basket.is_public ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                {basket.is_public ? 'Public to anyone with link · view only' : 'Private list'}
              </span>
              <h1 className="break-words text-2xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl">{basket.name || 'My saved basket'}</h1>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-600">
                {basket.date && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> Saved {basket.date}</span>}
                <span className="inline-flex items-center gap-1.5"><ShoppingCart className="h-4 w-4" /> {visibleItems.length} products</span>
                {basket.is_collab && <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" /> {basket.is_shared ? `Shared by ${basket.inviter_name || 'another user'}` : 'Collaborative basket'}</span>}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {isOwner && <Button type="button" variant="outline" onClick={() => setInviting(true)} className="rounded-xl border-emerald-200 bg-white font-bold"><UserPlus className="mr-2 h-4 w-4" /> Add person</Button>}
              {(isOwner || basket.is_public) && <Button type="button" variant="outline" disabled={sharing} onClick={copyShareLink} className="rounded-xl border-emerald-200 bg-white font-bold"><Share2 className="mr-2 h-4 w-4" /> {sharing ? 'Sharing...' : basket.is_public ? 'Copy public link' : 'Share list publicly'}</Button>}
              {isOwner && basket.is_public && <Button type="button" variant="outline" disabled={sharing} onClick={makePrivate} className="rounded-xl border-slate-200 bg-white font-bold">Make private</Button>}
              {isOwner && <Button type="button" variant="outline" disabled={deleting} onClick={() => setShowDeleteConfirm(true)} className="rounded-xl border-red-200 bg-white font-bold text-red-700 hover:bg-red-50"><Trash2 className="mr-2 h-4 w-4" /> Delete entire list</Button>}
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-sm font-extrabold text-slate-900">People in this list</h2><p className="mt-1 text-xs text-slate-500">Member profiles and pending invitations</p></div>
          </div>
          <ListMemberAvatars owner={ownerProfile} members={people} canInvite={isOwner} onInvite={() => setInviting(true)} />
        </section>
        {hiddenCount > 0 && <p className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{hiddenCount} product(s) are not displayed because of your account's content settings.</p>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-1"><h2 className="text-xl font-black text-slate-900">Items in this basket</h2><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700">{visibleItems.length} items</span></div>
            {visibleItems.length ? visibleItems.map((item) => (
              <BasketItemRow key={item.id} item={item} controls={
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center overflow-hidden rounded-xl border border-[#E0E8E1] bg-white">
                    <button type="button" disabled={Boolean(busyItem) || quantityOf(item) <= 1} onClick={() => changeQuantity(item, -1)} aria-label={`Decrease quantity of ${item.name}`} className="p-2.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                    <span className="w-7 text-center text-sm font-extrabold text-slate-900">{quantityOf(item)}</span>
                    <button type="button" disabled={Boolean(busyItem)} onClick={() => changeQuantity(item, 1)} aria-label={`Increase quantity of ${item.name}`} className="p-2.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                  </div>
                  <button type="button" disabled={Boolean(busyItem)} onClick={() => removeProduct(item)} className="rounded-xl border border-red-100 p-2.5 text-red-500 hover:bg-red-50 disabled:opacity-40" aria-label={`Remove ${item.name}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              } />
            )) : <BasketEmpty />}
            <BasketActivityFeed activities={basket.activities || []} />
          </section>
          <BasketSummaryCard items={visibleItems} caption="Saved estimated total">
            <div className="space-y-2">
              <Button type="button" disabled={!visibleItems.length} onClick={addAllToCart} className="h-12 w-full rounded-xl bg-[#059669] font-extrabold text-white hover:bg-[#047857]"><ShoppingCart className="mr-2 h-4 w-4" /> Add all to basket <ArrowRight className="ml-2 h-4 w-4" /></Button>
              <p className="text-xs text-slate-500">{basket.is_public ? 'People with your link can view this list. Only accepted collaborators can edit it.' : 'Private until you choose Share list publicly above.'}</p>
              <p className="text-xs leading-5 text-slate-500">You can compare retailer prices from your shopping basket after adding these items.</p>
            </div>
          </BasketSummaryCard>
        </div>
        {showDeleteConfirm && <div role="dialog" aria-modal="true" aria-labelledby="delete-list-title" className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/65 p-4">
          <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600"><Trash2 className="h-6 w-6" /></div>
            <h2 id="delete-list-title" className="text-xl font-black text-slate-950">Delete this entire list?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">This permanently deletes <strong>{basket.name}</strong>, its items, invitations, and activity history for every member. This cannot be undone.</p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={deleting} onClick={() => setShowDeleteConfirm(false)} className="rounded-xl">Cancel</Button>
              <Button type="button" disabled={deleting} onClick={deleteBasket} className="rounded-xl bg-red-600 text-white hover:bg-red-700"><Trash2 className="mr-2 h-4 w-4" /> {deleting ? 'Deleting...' : 'Delete entire list'}</Button>
            </div>
          </section>
        </div>}
        {inviting && <div role="dialog" aria-modal="true" aria-label="Invite person" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4">
          <section className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <header className="flex items-center justify-between"><h2 className="text-lg font-black">Add person to list</h2><button type="button" onClick={() => setInviting(false)} aria-label="Close invitation dialog"><X className="h-5 w-5" /></button></header>
            <p className="text-sm text-slate-600">Search for a registered user. They will receive an invitation to accept in Notifications.</p>
            <input autoFocus value={searchUsers} onChange={(e) => setSearchUsers(e.target.value)} placeholder="Search username (2+ characters)" className="w-full rounded-xl border border-slate-200 p-3" />
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {suggestions.filter((candidate) => !people.some((p) => p.id === candidate.id)).map((candidate) => <div key={candidate.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="font-bold">{candidate.username}</span><Button disabled={inviteBusy} onClick={() => sendInvite(candidate)} className="bg-emerald-700">Invite</Button></div>)}
              {searchUsers.length >= 2 && suggestions.length === 0 && <p className="text-sm text-slate-500">No matching users found.</p>}
            </div>
          </section>
        </div>}
      </div>
    </main>
  );
}
