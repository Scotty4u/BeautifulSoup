import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Bell, BellOff } from 'lucide-react';

export default function PriceWatchControl({ productId, user }) {
  const [watching, setWatching] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!productId || !user) return;
    let live = true;
    axios.get(`/api/price-watches/${encodeURIComponent(productId)}`).then(({ data }) => {
      if (live) { setWatching(Boolean(data.watching)); setTarget(data.target_price == null ? '' : String(data.target_price)); }
    }).catch(() => { if (live) setError('Could not load your price alert.'); });
    return () => { live = false; };
  }, [productId, user]);
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (watching) {
        await axios.delete(`/api/price-watches/${encodeURIComponent(productId)}`);
        setWatching(false); setNotice('Price alert turned off.');
      } else {
        await axios.post(`/api/price-watches/${encodeURIComponent(productId)}`, { target_price: target || null });
        setWatching(true); setNotice('You will be notified when a new lower price is recorded.');
      }
    } catch (e) { setError(e.response?.data?.error || 'Could not update price alert.'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-3xl border border-emerald-200 bg-emerald-50/40 p-5 sm:p-6">
    <h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><Bell className="h-5 w-5 text-emerald-700"/> Price-drop alert</h2>
    <p className="mt-1 text-sm text-slate-600">Watch this exact retailer listing. Alerts use newly indexed price reductions, not guaranteed real-time retailer prices.</p>
    {!user ? <Link to="/login" className="mt-3 inline-block text-sm font-bold text-emerald-700 underline">Sign in to follow this price</Link> : <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs font-bold text-slate-600">Optional target price (R)<input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="Alert me on any drop" value={target} disabled={watching || busy} onChange={e => setTarget(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"/></label><button type="button" disabled={busy} onClick={save} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-extrabold text-white disabled:opacity-50 ${watching ? 'bg-slate-700 hover:bg-slate-800' : 'bg-emerald-700 hover:bg-emerald-800'}`}>{watching ? <BellOff size={17}/> : <Bell size={17}/>} {watching ? 'Stop alert' : 'Set alert'}</button></div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
  </section>;
}
