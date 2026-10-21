import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { PiggyBank, Wallet, ShoppingBag, TrendingUp } from 'lucide-react';
const money = (v) => `R ${Number(v || 0).toFixed(2)}`;
function Stat({ icon: Icon, label, value }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5"><Icon className="mb-4 h-6 w-6 text-emerald-700"/><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-900">{value}</p></div>; }
export default function SavingsDashboard() {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); axios.get('/api/insights/me', { signal: controller.signal, withCredentials: true }).then((response) => setData(response.data)).catch((e) => { if (!controller.signal.aborted) setError(e.response?.data?.error || 'Unable to load insights.'); }); return () => controller.abort(); }, []);
  return <main className="min-h-screen bg-[#F7FAF7] px-4 py-9"><div className="mx-auto max-w-6xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-black text-slate-900">My shopping insights</h1><p className="mt-1 text-sm text-slate-600">Learn from your saved shopping plans and indexed supermarket prices.</p></div><Link to="/account/orders" className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white">View my orders</Link></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p>}
    {!data ? <p className="text-slate-500">Loading insights…</p> : <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Stat icon={ShoppingBag} label="Active simulated orders" value={data.simulatedOrders}/><Stat icon={Wallet} label="Estimated planned spending" value={money(data.estimatedPlannedSpend)}/><Stat icon={PiggyBank} label="Estimated savings (comparable plans only)" value={money(data.estimatedSavings)}/><Stat icon={TrendingUp} label="Most selected retailer" value={data.favoriteRetailer || 'Not enough data'}/></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{data.ordersWithoutSavingsComparison} of {data.simulatedOrders} plans lacked a complete, exact-match store comparison. No savings have been guessed for those plans.</div>
      <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border bg-white p-6"><h2 className="mb-4 text-lg font-black">Frequently planned products</h2>{data.topProducts.length ? data.topProducts.map((p, i) => <div key={i} className="flex justify-between gap-4 border-t py-3 text-sm"><span>{p.name}</span><strong>{p.units} units</strong></div>) : <p className="text-slate-500">No plans yet.</p>}</section>
      <section className="rounded-2xl border bg-white p-6"><h2 className="mb-4 text-lg font-black">Monthly planned spend</h2>{data.monthly.length ? data.monthly.map((p) => <div key={p.month} className="flex items-center justify-between gap-4 border-t py-3 text-sm"><span>{p.month}</span><strong>{money(p.plannedSpend)}</strong></div>) : <p className="text-slate-500">No plans yet.</p>}</section></div>
      <p className="text-xs leading-5 text-slate-500">{data.disclaimer}</p>
    </>}
  </div></main>;
}