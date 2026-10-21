import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Activity, RefreshCw } from 'lucide-react';

const statusStyle = { ok: 'bg-emerald-50 text-emerald-800', warning: 'bg-amber-50 text-amber-800', error: 'bg-red-50 text-red-800', stale: 'bg-orange-50 text-orange-800', not_checked: 'bg-slate-100 text-slate-600' };
const when = (iso) => iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' }) : 'Never';
export default function ScraperHealthPanel() {
  const [rows, setRows] = useState([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get('/api/admin/scraper-health'); setRows(Array.isArray(data) ? data : []); setError(''); }
    catch (e) { setError(e.response?.data?.error || 'Scraper health is unavailable.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-black"><Activity size={22} className="text-emerald-700"/> Scraper health</h2><p className="mt-1 text-xs text-slate-500">Search-result monitoring; cached results are not proof of live retailer connectivity. Empty searches may be normal.</p></div><button type="button" onClick={refresh} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50"><RefreshCw size={16}/> Refresh</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {loading ? <p className="mt-5 text-sm text-slate-500">Checking scraper logs…</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{rows.map(row => <article key={row.store} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">{row.store}</h3><span className={`rounded-full px-3 py-1 text-xs font-black ${statusStyle[row.status] || statusStyle.not_checked}`}>{row.status.replace('_', ' ')}</span></div><dl className="mt-3 space-y-1 text-xs text-slate-600"><div>Last attempt: <strong>{when(row.last_attempt_at)}</strong></div><div>Last non-empty result: <strong>{when(row.last_nonempty_at)}</strong></div><div>Consecutive errors: <strong>{row.consecutive_errors || 0}</strong> · Empty: <strong>{row.consecutive_empty || 0}</strong></div>{row.last_error_type && <div>Last error type: <strong>{row.last_error_type}</strong></div>}</dl></article>)}</div>}
  </section>;
}
