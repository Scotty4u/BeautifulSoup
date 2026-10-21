import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import ScraperHealthPanel from '../../components/ScraperHealthPanel';
import { Link } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Activity, AlertCircle, BarChart3, CheckCircle2, CircleHelp,
  Clock3, Database, Filter, Gauge, LockKeyhole, RefreshCw, Search,
  ShieldCheck, ShoppingBag,
  Trash2, UserPlus, Users, X, Zap,
} from 'lucide-react';

const RETAILERS = [
  { name: 'Checkers', key: 'checkers' },
  { name: 'Shoprite', key: 'shoprite' },
  { name: 'Pick n Pay', key: 'pnp' },
  { name: 'Woolworths', key: 'woolworths' },
];
const fieldClass = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-400';
const emptyStats = { usersCount: 0, activeUsers: 0, productsCount: 0, basketsCount: 0, searchesCount: 0, activeScrapers: 0 };
const defaultNewUser = { username: '', email: '', password: '', is_admin: false };

function StatCard({ icon: Icon, title, value, helper, bg = 'bg-emerald-50', fg = 'text-emerald-700' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
        <span className={`rounded-xl p-2.5 ${bg} ${fg}`}><Icon className="h-5 w-5" /></span>
      </div>
      <div className="text-3xl font-extrabold tracking-tight text-slate-950">{value}</div>
      <p className="mt-2 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function ProgressRow({ label, count, max, annotation }) {
  const progress = max > 0 ? Math.min(100, Math.max(0, (count / max) * 100)) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="truncate font-semibold text-slate-700">{label}</span>
        <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">{count}{annotation ? ` ${annotation}` : ''}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function StatePill({ active }) {
  return active
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Suspended</span>;
}

export default function AdminDashboard() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(emptyStats);
  const [users, setUsers] = useState([]);
  const [insights, setInsights] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [newUser, setNewUser] = useState(defaultNewUser);
  const [submitting, setSubmitting] = useState(false);
  const [workingStore, setWorkingStore] = useState('');
  const [workingUser, setWorkingUser] = useState(null);

  const loadData = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const auth = await axios.get('/api/me', { withCredentials: true });
      if (!auth.data?.is_admin) {
        window.location.assign(
  import.meta.env.DEV
    ? 'http://localhost:5000/login'
    : '/login'
);
        return;
      }
      const results = await Promise.allSettled([
        axios.get('/api/admin/stats', { withCredentials: true }),
        axios.get('/api/admin/users', { withCredentials: true }),
        axios.get('/api/admin/insights', { withCredentials: true }),
      ]);
      if (results[0].status === 'fulfilled') setStats(results[0].value.data || emptyStats);
      if (results[1].status === 'fulfilled') setUsers(results[1].value.data || []);
      if (results[2].status === 'fulfilled') setInsights(results[2].value.data || null);
      if (results.some((result) => result.status === 'rejected')) setError('Some analytics are unavailable. Refresh to retry.');
    } catch (e) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        window.location.assign(
  import.meta.env.DEV
    ? 'http://localhost:5000/login'
    : '/login'
);
      } else {
        setError('Unable to reach SmartBasket backend. Check your Flask server and retry.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(true); }, [loadData]);

  const visibleUsers = useMemo(() => users.filter((user) => {
    const text = `${user.username} ${user.email} ${user.location || ''}`.toLowerCase();
    if (!text.includes(query.trim().toLowerCase())) return false;
    if (filter === 'admins') return user.role === 'Admin';
    if (filter === 'active') return user.is_active;
    if (filter === 'suspended') return !user.is_active;
    if (filter === 'incomplete') return !user.profile_complete;
    return true;
  }), [users, query, filter]);

  const triggerScraper = async (store = 'all') => {
    setWorkingStore(store);
    try {
      await axios.post('/api/admin/system/trigger-job', { store }, { withCredentials: true });
      showToast(`Refresh requested for ${store === 'all' ? 'all retailers' : store}. This starts a token-refresh job, not proof the store scraper is healthy.`);
    } catch (e) {
      showToast(e?.response?.data?.error || 'Could not request retailer refresh.', 'error');
    } finally { setWorkingStore(''); }
  };
  const clearCache = async () => {
    if (!window.confirm('Clear cached retailer searches and product comparisons? The next searches may be slower.')) return;
    try {
      await axios.post('/api/admin/system/clear-cache', {}, { withCredentials: true });
      showToast('Search and comparison caches cleared.');
      loadData();
    } catch (e) { showToast(e?.response?.data?.error || 'Cache could not be cleared.', 'error'); }
  };
  const createUser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await axios.post('/api/admin/users', newUser, { withCredentials: true });
      showToast('Account created. The user can complete their shopping profile after signing in.');
      setModalOpen(false);
      setNewUser(defaultNewUser);
      await loadData();
    } catch (e) { showToast(e?.response?.data?.error || 'Unable to create account.', 'error'); }
    finally { setSubmitting(false); }
  };
  const toggleUser = async (user) => {
    setWorkingUser(user.id);
    try {
      await axios.post(`/api/admin/users/${user.id}/toggle-status`, {}, { withCredentials: true });
      setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, is_active: !entry.is_active } : entry));
      showToast(`Account ${user.is_active ? 'suspended' : 'activated'}.`);
      loadData();
    } catch (e) { showToast(e?.response?.data?.error || 'Status could not be changed.', 'error'); }
    finally { setWorkingUser(null); }
  };
  const removeUser = async (user) => {
    if (!window.confirm(`Permanently delete the account for ${user.username}? This action cannot be undone.`)) return;
    setWorkingUser(user.id);
    try {
      await axios.delete(`/api/admin/users/${user.id}`, { withCredentials: true });
      setUsers((current) => current.filter((entry) => entry.id !== user.id));
      showToast('Account deleted.');
      loadData();
    } catch (e) { showToast(e?.response?.data?.error || 'Account could not be deleted.', 'error'); }
    finally { setWorkingUser(null); }
  };

  const ageTotal = (insights?.adultUsers || 0) + (insights?.underageUsers || 0) + (insights?.unknownAgeUsers || 0);
  const highestStoreCount = Math.max(1, ...(insights?.storeCounts || []).map((entry) => entry.count));
  const highestSearchCount = Math.max(1, ...(insights?.topSearches || []).map((entry) => entry.count));

  return (
    <main className="min-h-screen bg-[#f6f8fa] pb-16 text-slate-900">
      <div className="mx-auto max-w-[1440px] space-y-7 px-4 py-7 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-4 rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-8 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-emerald-600 p-3 text-white shadow-md shadow-emerald-100"><ShieldCheck className="h-7 w-7" /></div>
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-emerald-700">SmartBasket / Administration</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">Platform overview</h1>
              <p className="mt-2 max-w-xl text-sm text-slate-500">Customers, indexed prices, privacy and retailer controls in one place.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={refreshing} onClick={() => loadData()} className="h-10 rounded-xl border-slate-200 font-semibold">
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" onClick={clearCache} className="h-10 rounded-xl border-slate-200 font-semibold"><Trash2 className="mr-2 h-4 w-4" /> Clear cache</Button>
            <Button onClick={() => triggerScraper('all')} disabled={Boolean(workingStore)} className="h-10 rounded-xl bg-emerald-600 px-5 font-semibold text-white hover:bg-emerald-700"><Zap className="mr-2 h-4 w-4" /> Refresh retailers</Button>
          </div>
        </header>
        <nav aria-label="Admin tools" className="grid gap-3 sm:grid-cols-2">
          <Link to="/admin/orders" className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
            <ShoppingBag className="h-6 w-6 shrink-0 text-emerald-700" />
            <span><span className="block font-extrabold">Customer Orders</span><span className="mt-1 block text-sm text-slate-500">View customers, selected stores and products in each order plan.</span></span>
          </Link>
          <Link to="/admin/order-analytics" className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
            <BarChart3 className="h-6 w-6 shrink-0 text-emerald-700" />
            <span><span className="block font-extrabold">Order Analytics</span><span className="mt-1 block text-sm text-slate-500">Compare order activity by supermarket and region.</span></span>
          </Link>
        </nav>
        <ScraperHealthPanel />
        {error && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900" role="alert"><AlertCircle className="h-4 w-4 shrink-0" /> {error}</div>}
        {loading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status">{[0, 1, 2, 3].map((n) => <div key={n} className="h-36 animate-pulse rounded-2xl bg-slate-200/70" />)}</div> : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Users} title="Registered users" value={stats.usersCount.toLocaleString()} helper={`${stats.activeUsers} currently active`} bg="bg-blue-50" fg="text-blue-600" />
            <StatCard icon={ShoppingBag} title="Indexed products" value={stats.productsCount.toLocaleString()} helper="Products recorded from retailer searches" />
            <StatCard icon={Search} title="Recorded searches" value={stats.searchesCount.toLocaleString()} helper="Search-history records" bg="bg-violet-50" fg="text-violet-600" />
            <StatCard icon={Gauge} title="Comparison average" value={insights?.comparison?.averageMs != null ? `${(insights.comparison.averageMs / 1000).toFixed(1)} s` : '—'} helper={`${insights?.comparison?.cacheHits || 0} comparison cache hits since server startup`} bg="bg-amber-50" fg="text-amber-700" />
          </div>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-100 px-6 py-5"><CardTitle className="flex items-center gap-2 text-lg font-extrabold"><Database className="h-5 w-5 text-emerald-700" /> Retailer coverage</CardTitle><p className="text-xs text-slate-500">Product counts are indexed data, not guaranteed live store availability.</p></CardHeader>
            <CardContent className="space-y-5 p-6">
              {(insights?.storeCounts || []).length ? (insights.storeCounts.map((store) => <ProgressRow key={store.store} label={store.store} count={store.count} max={highestStoreCount} annotation="items" />)) : <p className="text-sm text-slate-500">No products indexed yet.</p>}
              <div className="grid gap-2 border-t border-slate-100 pt-5 sm:grid-cols-2">
                {RETAILERS.map((store) => <button type="button" key={store.key} disabled={Boolean(workingStore)} onClick={() => triggerScraper(store.key)} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60"><span>{store.name}</span><RefreshCw className={`h-4 w-4 text-emerald-700 ${workingStore === store.key ? 'animate-spin' : ''}`} /></button>)}
              </div>
              <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" /> These controls request a token refresh. Store connectivity cannot be marked healthy until real health checks exist.</p>
            </CardContent>
          </Card>
          <Card className="overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-100 px-6 py-5"><CardTitle className="flex items-center gap-2 text-lg font-extrabold"><LockKeyhole className="h-5 w-5 text-emerald-700" /> Age & profile coverage</CardTitle><p className="text-xs text-slate-500">Users with unknown age are restricted. Admins bypass the catalogue filter.</p></CardHeader>
            <CardContent className="space-y-5 p-6">
              <ProgressRow label="Adults (18+)" count={insights?.adultUsers || 0} max={ageTotal} annotation="users" />
              <ProgressRow label="Under 18" count={insights?.underageUsers || 0} max={ageTotal} annotation="users" />
              <ProgressRow label="Age not provided" count={insights?.unknownAgeUsers || 0} max={ageTotal} annotation="users" />
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
                <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">Profiles completed</p><p className="mt-1 text-2xl font-extrabold">{insights?.profileCompletion || 0}</p></div>
                <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">Restricted listings</p><p className="mt-1 text-2xl font-extrabold">{insights?.restrictedProducts || 0}</p></div>
              </div>
              <p className="text-xs text-slate-500">Age is based on self-reported birth dates and product classification; it is not verified identity or proof of compliance.</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-6 py-5"><CardTitle className="flex items-center gap-2 text-lg font-extrabold"><BarChart3 className="h-5 w-5 text-emerald-700" /> Searches in the last 7 days</CardTitle></CardHeader>
            <CardContent className="space-y-4 p-6">
              {(insights?.topSearches || []).length ? insights.topSearches.map((item) => <ProgressRow key={item.query} label={item.query} count={item.count} max={highestSearchCount} annotation="searches" />) : <p className="text-sm text-slate-500">No search history in this period.</p>}
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-6 py-5"><CardTitle className="flex items-center gap-2 text-lg font-extrabold"><Activity className="h-5 w-5 text-emerald-700" /> Recent platform activity</CardTitle></CardHeader>
            <CardContent className="divide-y divide-slate-100 p-2">
              {(insights?.recentLogs || []).length ? insights.recentLogs.map((log, index) => <div className="flex gap-3 px-4 py-3" key={`${log.date}-${index}`}><span className="mt-1 rounded-lg bg-slate-100 p-2"><Clock3 className="h-4 w-4 text-slate-500" /></span><div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-800">{log.action}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{log.details || 'No additional detail'}</p></div><time className="shrink-0 text-[11px] text-slate-400">{log.date ? new Date(log.date).toLocaleDateString() : ''}</time></div>) : <p className="p-6 text-sm text-slate-500">No system events recorded.</p>}
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="space-y-4 border-b border-slate-100 bg-white px-5 py-5 sm:px-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div><CardTitle className="flex items-center gap-2 text-xl font-extrabold"><Users className="h-5 w-5 text-emerald-700" /> User management</CardTitle><p className="mt-1 text-xs text-slate-500">{visibleUsers.length} of {users.length} users · suspend, create or remove accounts</p></div>
              <Button onClick={() => setModalOpen(true)} className="h-10 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700"><UserPlus className="mr-2 h-4 w-4" /> Add user</Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, location…" className="h-11 rounded-xl border-slate-200 pl-10" /></label>
              <label className="relative"><Filter className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" /><select className={`${fieldClass} min-w-[180px] pl-9 pr-8`} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All users</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="admins">Administrators</option><option value="incomplete">Profile incomplete</option></select></label>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-extrabold uppercase tracking-wide text-slate-500"><th className="px-6 py-4">Member</th><th className="px-4 py-4">Age group</th><th className="px-4 py-4">Location</th><th className="px-4 py-4">Profile</th><th className="px-4 py-4">Status</th><th className="px-4 py-4 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {visibleUsers.length ? visibleUsers.map((user) => <tr key={user.id} className="hover:bg-slate-50/70">
                  <td className="px-6 py-4"><div className="font-bold text-slate-900">{user.username} {user.role === 'Admin' && <Badge variant="secondary" className="ml-1">Admin</Badge>}</div><div className="mt-1 text-xs text-slate-500">{user.email}</div><div className="mt-1 text-[11px] text-slate-400">Joined {user.joined}</div></td>
                  <td className="px-4 py-4 text-slate-600">{user.age_group === 'adult' ? '18+' : user.age_group === 'under_18' ? 'Under 18' : 'Not supplied'}</td>
                  <td className="max-w-44 truncate px-4 py-4 text-slate-600">{user.location || '—'}</td>
                  <td className="px-4 py-4">{user.profile_complete ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Complete</span> : <span className="text-amber-700">Incomplete</span>}</td>
                  <td className="px-4 py-4"><StatePill active={user.is_active} /></td>
                  <td className="space-x-2 whitespace-nowrap px-4 py-4 text-right">
                    {user.role !== 'Admin' && <Button variant="outline" size="sm" disabled={workingUser === user.id} onClick={() => toggleUser(user)} className="rounded-lg border-slate-200">{user.is_active ? 'Suspend' : 'Activate'}</Button>}
                    <Button variant="ghost" size="sm" aria-label={`Delete ${user.username}`} disabled={workingUser === user.id} onClick={() => removeUser(user)} className="rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></Button>
                  </td></tr>) : <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500">No accounts match your filters.</td></tr>}
              </tbody></table></div>
          </CardContent>
        </Card>
        <div className="rounded-xl bg-slate-100 p-4 text-xs text-slate-500">Data minimization: only collect what helps search, shopping preferences or access controls. Admin reporting shows age groups rather than full birth dates. Product prices and retailer availability remain subject to change.</div>
      </div>

      {modalOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget && !submitting) setModalOpen(false); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="create-user-title" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-6 flex items-center justify-between"><h2 id="create-user-title" className="text-xl font-extrabold">Create a new user</h2><button aria-label="Close" type="button" onClick={() => setModalOpen(false)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
          <form className="space-y-4" onSubmit={createUser}>
            <label className="block text-xs font-bold text-slate-600">Username<input className={`mt-1.5 ${fieldClass}`} minLength={3} maxLength={80} required value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} /></label>
            <label className="block text-xs font-bold text-slate-600">Email<input className={`mt-1.5 ${fieldClass}`} type="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></label>
            <label className="block text-xs font-bold text-slate-600">Temporary password<input className={`mt-1.5 ${fieldClass}`} type="password" autoComplete="new-password" minLength={12} required value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={newUser.is_admin} onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })} className="h-4 w-4 accent-emerald-600" /> Grant administrator access</label>
            <p className="text-xs leading-5 text-slate-500">Date of birth, location and shopping preferences can be supplied by this user in Account Settings.</p>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-5"><Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button><Button disabled={submitting} type="submit" className="bg-emerald-600 text-white hover:bg-emerald-700">{submitting ? 'Creating…' : 'Create user'}</Button></div>
          </form>
        </div>
      </div>}
    </main>
  );
}
