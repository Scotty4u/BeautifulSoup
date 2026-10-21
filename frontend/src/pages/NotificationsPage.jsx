import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Bell, Check, CheckCheck, Inbox, X, Users, TrendingDown, ShoppingBag, CalendarDays, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '../context/ToastContext';

export function groupListNotifications(notifications = []) {
  const groups = new Map();
  for (const entry of notifications) {
    const key = entry.group_key || (entry.basket_id != null ? `list-${entry.basket_id}` : `single-${entry.id}`);
    if (!groups.has(key)) groups.set(key, { key, basketId: entry.basket_id, items: [], unread: false, invite: null });
    const group = groups.get(key);
    group.items.push(entry);
    if (entry.status === 'unread') group.unread = true;
    if (entry.type === 'invitation' && !group.invite) group.invite = entry;
  }
  return [...groups.values()].map((group) => ({
    ...group, latest: group.items[0], count: group.items.length,
  }));
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [filter, setFilter] = useState('all');
  const groups = useMemo(() => groupListNotifications(notifications), [notifications]);
  const visibleGroups = groups.filter((group) => filter === 'all' || (filter === 'unread' ? group.unread : filter === 'lists' ? Boolean(group.basketId) : filter === 'prices' ? ['price_drops', 'basket_savings'].includes(group.latest.type) : group.latest.type === filter));
  const unreadGroups = groups.filter((group) => group.unread).length;

  const refresh = useCallback(async (signal) => {
    try {
      const { data } = await axios.get('/api/notifications', { withCredentials: true, signal });
      if (!signal?.aborted) { setNotifications(Array.isArray(data) ? data : []); setError(''); }
    } catch { if (!signal?.aborted) setError('Could not refresh your notifications.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(controller.signal); };
    const interval = window.setInterval(onFocus, 7000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      controller.abort(); window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    axios.get('/api/notifications/preferences', { withCredentials: true, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setPreferences(data); })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load notification preferences. Refresh to retry.'); });
    return () => controller.abort();
  }, []);
  const changePreference = async (key, enabled) => {
    setSavingPreference(true);
    try {
      const { data } = await axios.put('/api/notifications/preferences', { [key]: enabled }, { withCredentials: true });
      setPreferences(data);
      await refresh();
      updateBell();
    } catch { showToast('Could not save notification preferences.', 'error'); }
    finally { setSavingPreference(false); }
  };

  const updateBell = () => window.dispatchEvent(new Event('smartbasket:notifications-updated'));
  const markGroupRead = async (group) => {
    if (!group?.unread) return;
    try {
      const url = String(group.latest.id).startsWith('alert-') ? `/api/notifications/alerts/${String(group.latest.id).slice(6)}/read` : `/api/notifications/${group.latest.id}/read`;
      await axios.post(url, {}, { withCredentials: true });
      setNotifications((current) => current.map((n) => group.items.some((entry) => entry.id === n.id) ? { ...n, status: 'read' } : n));
      updateBell();
    } catch { showToast('Could not mark this notification as read.', 'error'); }
  };
  const respond = async (group, action) => {
    if (!group.invite) return;
    setBusyId(group.invite.id);
    try {
      await axios.post(`/api/notifications/${group.invite.id}/respond`, { action }, { withCredentials: true });
      showToast(action === 'accept' ? 'You joined the list!' : 'Invitation declined.');
      await refresh();
      updateBell();
    } catch (err) { showToast(err?.response?.data?.error || 'Could not respond to invitation.', 'error'); }
    finally { setBusyId(null); }
  };
  const markAllRead = async () => {
    try {
      await axios.post('/api/notifications/mark-all-read', {}, { withCredentials: true });
      setNotifications((current) => current.map((n) => ({ ...n, status: 'read' })));
      updateBell();
    } catch { showToast('Could not mark notifications as read.', 'error'); }
  };

  return <main className="min-h-screen bg-[#F8FAF8] px-4 py-8 sm:px-6"><div className="mx-auto max-w-4xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-100 to-white p-6 sm:p-8">
      <div><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><Bell className="h-6 w-6 text-emerald-700" /> Notifications</h1><p className="mt-2 text-sm text-slate-600">{unreadGroups} unread {unreadGroups === 1 ? 'group' : 'groups'} · Related updates are grouped together</p></div>
      <Button variant="outline" disabled={unreadGroups === 0} onClick={markAllRead} className="rounded-xl"><CheckCheck className="mr-2 h-4 w-4" /> Mark all read</Button>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">Show
        <select value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-800">
          <option value="all">All notifications</option><option value="unread">Unread</option><option value="prices">Prices & savings</option><option value="order_updates">Orders</option><option value="lists">Lists & invitations</option><option value="reminders">Reminders</option><option value="security_alerts">Security</option>
        </select>
      </label>
      <Button variant="outline" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} className="rounded-xl"><Settings className="mr-2 h-4 w-4"/> Preferences</Button>
    </div>
    {settingsOpen && <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-extrabold">Choose your notifications</h2>
      <p className="text-xs leading-5 text-slate-500">Price alerts use prices indexed within the last 48 hours for lists you own. Checks run while you use SmartBasket. Weekly reminders appear when you return; these are in-app notifications.</p>
      {!preferences ? <p className="text-sm text-slate-500">Preferences unavailable. Refresh this page to retry.</p> : [['price_drops', 'Price drops on saved products'], ['basket_savings', 'Cheaper complete baskets at another store'], ['order_updates', 'Order saved and cancelled'], ['list_activity', 'Collaborative list changes'], ['reminders', 'Weekly shopping reminders']].map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 text-sm font-semibold text-slate-700"><span>{label}</span><input type="checkbox" checked={Boolean(preferences[key])} disabled={savingPreference} onChange={(event) => changePreference(key, event.target.checked)} className="h-5 w-5 accent-emerald-600" /></label>)}
      <p className="text-xs text-slate-500">List invitations remain available so you can accept or decline them.</p>
    </section>}
    {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">{error} <button type="button" onClick={() => refresh()} className="font-bold underline">Retry</button></p>}
    {loading ? <p className="py-14 text-center text-sm text-slate-500">Loading notifications...</p> : visibleGroups.length === 0 ?
      <section className="rounded-3xl bg-white p-12 text-center"><Inbox className="mx-auto h-12 w-12 text-slate-300" /><h2 className="mt-4 font-extrabold">No notifications yet</h2><p className="mt-2 text-sm text-slate-500">No updates in this view. Use Preferences to enable price alerts and reminders.</p></section> :
      <section className="space-y-3">{visibleGroups.map((group) => <article key={group.key} className={`rounded-2xl border bg-white p-5 shadow-sm ${group.unread ? 'border-emerald-300' : 'border-slate-200'}`}>
        <div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-50 p-2">{['price_drops', 'basket_savings'].includes(group.latest.type) ? <TrendingDown className="h-5 w-5 text-emerald-700" /> : group.latest.type === 'order_updates' ? <ShoppingBag className="h-5 w-5 text-emerald-700" /> : group.latest.type === 'reminders' ? <CalendarDays className="h-5 w-5 text-emerald-700" /> : <Users className="h-5 w-5 text-emerald-700" />}</div><div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2"><h2 className="text-sm font-bold text-slate-900">{group.latest.message}</h2>{group.unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}</div>
          <p className="mt-1 text-xs text-slate-500">{group.latest.date} · {group.count} {group.count === 1 ? 'update' : 'related updates'}</p>
          {group.count > 1 && <div className="mt-3 space-y-1 rounded-xl bg-slate-50 px-3 py-2">{group.items.slice(1, 4).map((n) => <p key={n.id} className="text-xs text-slate-600">{n.message}</p>)}</div>}
          <div className="mt-4 flex flex-wrap gap-2">
            {group.invite && <><Button disabled={busyId === group.invite.id} onClick={() => respond(group, 'accept')} className="rounded-xl bg-emerald-700"><Check className="mr-2 h-4 w-4" /> Accept invite</Button><Button disabled={busyId === group.invite.id} onClick={() => respond(group, 'decline')} variant="outline" className="rounded-xl"><X className="mr-2 h-4 w-4" /> Decline</Button></>}
            {!group.invite && group.basketId && <Button variant="outline" className="rounded-xl" onClick={() => { markGroupRead(group); navigate(`/saved/${group.basketId}`); }}>Open list</Button>}
            {group.latest.url && <Button variant="outline" className="rounded-xl" onClick={() => { markGroupRead(group); navigate(group.latest.url); }}>{group.latest.type === 'order_updates' ? 'View orders' : group.latest.type === 'security_alerts' ? 'Review security' : 'View product or list'}</Button>}
            {group.unread && !group.invite && <Button variant="ghost" onClick={() => markGroupRead(group)}>Mark read</Button>}
          </div>
        </div></div>
      </article>)}</section>}
    <Link to="/collaborative" className="inline-block text-sm font-bold text-emerald-700 hover:underline">Browse collaborative lists</Link>
  </div></main>;
}
