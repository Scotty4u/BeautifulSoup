import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowRight, Bookmark, Check, ChevronRight, ClipboardList, Copy, LoaderCircle,
  Plus, RefreshCw, Search, Share2, ShoppingBasket, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { isVisibleProduct } from '../utils/ProductVisibility';
import ListMemberAvatars from './ListMemberAvatars';

const money = (amount) => `R ${Number(amount || 0).toFixed(2)}`;
const countUnits = (items) => items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
const calcTotal = (items) => items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0);

function ListCard({ basket, onInvite, onDelete, user }) {
  const items = (basket.items || []).filter((item) => isVisibleProduct(item, user));
  const isOwner = Boolean(basket.is_owner || (basket.owner_id && user?.id && Number(basket.owner_id) === Number(user.id)));
  const owner = basket.owner_profile || { id: basket.owner_id, username: basket.inviter_name || (isOwner ? user?.username : 'Owner') || 'Owner' };
  const people = Array.isArray(basket.collaborators) ? basket.collaborators : [];
  const total = calcTotal(items);
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-3xl border border-[#E1EAE2] bg-white shadow-sm transition hover:border-emerald-300 hover:shadow-lg">
      <div className="flex-1 space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${basket.is_collab || basket.is_shared ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {basket.is_shared ? 'Shared with you' : basket.is_public ? 'Public link enabled' : basket.is_collab ? 'Private collaborative list' : 'Private personal list'}
          </span>
          {basket.date && <span className="text-xs text-slate-400">{basket.date}</span>}
        </div>
        <div className="min-w-0 space-y-1">
          <Link to={`/saved/${encodeURIComponent(basket.id)}`} className="inline-flex max-w-full items-center gap-2 text-lg font-black text-slate-900 hover:text-emerald-700">
            <span className="truncate">{basket.name || 'Untitled list'}</span><ChevronRight className="h-4 w-4 shrink-0" />
          </Link>
          <p className="text-sm text-slate-500">{items.length} products · {countUnits(items)} units{basket.is_shared ? ` · By ${basket.inviter_name || owner.username}` : ''}</p>
        </div>
        <div className="rounded-2xl bg-[#F4F9F4] px-4 py-3">
          <p className="text-xs font-semibold text-slate-500">Estimated list total</p>
          <p className="mt-1 text-2xl font-black text-[#047857]">{money(total)}</p>
          <p className="mt-1 text-[11px] text-slate-500">Based on saved prices; prices can change at the retailer</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">People in this list</p>
          <ListMemberAvatars owner={owner} members={people} compact canInvite={isOwner} onInvite={() => onInvite(basket)} />
          {isOwner && <button type="button" onClick={() => onInvite(basket)} className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 hover:underline"><UserPlus className="h-3.5 w-3.5" /> Add person</button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/60 p-4 sm:px-6">
        <Link to={`/saved/${encodeURIComponent(basket.id)}`} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-extrabold text-white transition hover:bg-emerald-700">
          Open list <ArrowRight className="h-4 w-4" />
        </Link>
        {isOwner && <button type="button" onClick={() => onDelete(basket)} aria-label={`Delete ${basket.name}`} title="Delete entire list" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-xs font-extrabold text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">Delete</span></button>}
      </div>
    </article>
  );
}

export default function ListOverview({ collaborativeOnly = false }) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const listType = collaborativeOnly ? 'collaborative' : ['personal', 'collaborative'].includes(searchParams.get('type')) ? searchParams.get('type') : 'all';
  const showingCollaborative = listType === 'collaborative';
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [inviteList, setInviteList] = useState(null);
  const [userQuery, setUserQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [invitingUser, setInvitingUser] = useState(null);
  const [deleteList, setDeleteList] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async (signal) => {
    try {
      const { data } = await axios.get('/api/db/saved-baskets', { signal, withCredentials: true });
      if (!signal?.aborted) { setLists(Array.isArray(data) ? data : []); setFetchError(''); }
    } catch (err) {
      if (!signal?.aborted) setFetchError(err?.response?.status === 401 ? 'Sign in to manage saved baskets.' : 'Unable to load your lists. Please retry.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const check = () => { if (document.visibilityState === 'visible') refresh(controller.signal); };
    window.addEventListener('focus', check);
    const interval = window.setInterval(check, 12000);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener('focus', check); };
  }, [refresh]);

  useEffect(() => {
    if (!inviteList || userQuery.trim().length < 2) { setCandidates([]); return; }
    const controller = new AbortController();
    const debounce = window.setTimeout(async () => {
      try {
        const { data } = await axios.get('/api/users/search', { params: { q: userQuery.trim() }, signal: controller.signal, withCredentials: true });
        if (!controller.signal.aborted) setCandidates(Array.isArray(data) ? data : []);
      } catch { if (!controller.signal.aborted) setCandidates([]); }
    }, 260);
    return () => { controller.abort(); window.clearTimeout(debounce); };
  }, [inviteList, userQuery]);

  const visibleLists = useMemo(() => lists.filter((list) => {
    const isCollaborative = Boolean(list.is_collab || list.is_shared);
    if (listType === 'collaborative' && !isCollaborative) return false;
    if (listType === 'personal' && isCollaborative) return false;
    if (!String(list.name || '').toLowerCase().includes(keyword.trim().toLowerCase())) return false;
    return true;
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id) - Number(a.id)), [lists, listType, keyword]);

  const sendInvite = async (candidate) => {
    if (!inviteList || invitingUser) return;
    setInvitingUser(candidate.id);
    try {
      await axios.post(`/api/saved-baskets/${encodeURIComponent(inviteList.id)}/invite`, { user_id: candidate.id }, { withCredentials: true });
      showToast(`Invitation sent to ${candidate.username}. They can accept in Notifications.`);
      setInviteList(null); setUserQuery(''); setCandidates([]);
      await refresh();
    } catch (error) { showToast(error?.response?.data?.error || 'Could not send the invitation.', 'error'); }
    finally { setInvitingUser(null); }
  };

  const confirmDeletion = async () => {
    if (!deleteList || deleting) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/db/saved-baskets/${encodeURIComponent(deleteList.id)}`, { withCredentials: true });
      setLists((previous) => previous.filter((item) => String(item.id) !== String(deleteList.id)));
      showToast(`Deleted ${deleteList.name}.`);
      setDeleteList(null);
    } catch (error) { showToast(error?.response?.data?.error || 'Unable to delete the list.', 'error'); }
    finally { setDeleting(false); }
  };

  const title = 'Saved Lists';
  const subtitle = 'Your personal and collaborative grocery lists, together in one place.';
  return (
    <main className="min-h-screen bg-[#F8FAF8] pb-16">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-6 sm:py-10">
        <header className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-[#DFF3E3] to-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div><span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700">{showingCollaborative ? <Users className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}{showingCollaborative ? 'Shop together' : 'Your collections'}</span>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{subtitle}</p>
            </div>

          </div>
        </header>
        <nav aria-label="List types" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {[{ type: 'all', label: 'All Lists', icon: ClipboardList }, { type: 'personal', label: 'Personal Lists', icon: Bookmark }, { type: 'collaborative', label: 'Collaborative Lists', icon: Users }].map(({ type, label, icon: Icon }) => (
            <Link key={type} to={type === 'all' ? '/saved' : `/saved?type=${type}`}
              aria-current={listType === type ? 'page' : undefined}
              className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${listType === type ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-emerald-50'}`}>
              <Icon className="h-4 w-4 shrink-0" /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search your lists" aria-label="Search your saved lists" className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-emerald-500" /></div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Refresh lists" title="Refresh lists" onClick={() => refresh()} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /></button>
          </div>
        </div>
        {fetchError && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{fetchError} <button type="button" className="ml-2 underline" onClick={() => refresh()}>Retry</button></div>}
        {loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <div key={i} className="h-72 animate-pulse rounded-3xl bg-slate-100" />)}</div>
          : visibleLists.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{visibleLists.map((basket) => <ListCard key={basket.id} basket={basket} user={user} onInvite={(list) => { setUserQuery(''); setCandidates([]); setInviteList(list); }} onDelete={setDeleteList} />)}</div>
            : <div className="rounded-3xl border border-dashed border-emerald-200 bg-white px-6 py-14 text-center"><ClipboardList className="mx-auto h-12 w-12 text-emerald-300" /><h2 className="mt-3 text-xl font-black text-slate-900">{keyword ? 'No matching lists' : showingCollaborative ? 'No collaborative lists yet' : listType === 'personal' ? 'No personal lists yet' : 'No saved lists yet'}</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{showingCollaborative ? 'Invite someone to a list you own. Once they accept, it will appear here.' : 'Add groceries to your basket, then save the basket to create a list.'}</p><Button type="button" onClick={() => navigate(showingCollaborative ? '/saved' : '/basket')} className="mt-5 rounded-xl bg-emerald-600 text-white">{showingCollaborative ? 'View saved lists' : 'Open basket'}</Button></div>}
        {inviteList && <div role="dialog" aria-modal="true" aria-labelledby="invite-list-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4">
          <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3"><h2 id="invite-list-title" className="text-xl font-black text-slate-900">Add person to {inviteList.name}</h2><button type="button" onClick={() => setInviteList(null)} aria-label="Close dialog"><X className="h-5 w-5" /></button></div>
            <p className="mt-2 text-sm leading-6 text-slate-500">Search registered usernames to send an invitation. They'll receive it in Notifications and must accept before editing.</p>
            <input autoFocus value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Type at least two letters" className="mt-4 h-12 w-full rounded-xl border border-slate-200 px-4 text-sm focus:border-emerald-500 focus:outline-none" />
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {candidates.filter((c) => !(inviteList.collaborators || []).some((p) => Number(p.id) === Number(c.id))).map((candidate) => <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><span className="truncate text-sm font-bold text-slate-900">{candidate.username}</span><Button type="button" disabled={Boolean(invitingUser)} onClick={() => sendInvite(candidate)} className="rounded-lg bg-emerald-600 text-white">{invitingUser === candidate.id ? 'Inviting...' : 'Invite'}</Button></div>)}
              {userQuery.trim().length >= 2 && candidates.length === 0 && <p className="py-3 text-center text-sm text-slate-500">No users found.</p>}
            </div>
          </section>
        </div>}
        {deleteList && <div role="dialog" aria-modal="true" aria-labelledby="delete-list-title" className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/65 p-4"><section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600"><Trash2 className="h-6 w-6" /></div><h2 id="delete-list-title" className="mt-4 text-xl font-black text-slate-900">Delete the entire list?</h2><p className="mt-2 text-sm leading-6 text-slate-600">Deleting <strong>{deleteList.name}</strong> removes its products, collaborators, invitations, and activity history for everyone. This cannot be undone.</p><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" disabled={deleting} onClick={() => setDeleteList(null)}>Cancel</Button><Button type="button" disabled={deleting} onClick={confirmDeletion} className="bg-red-600 text-white hover:bg-red-700">{deleting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Delete list</Button></div></section></div>}
      </div>
    </main>
  );
}