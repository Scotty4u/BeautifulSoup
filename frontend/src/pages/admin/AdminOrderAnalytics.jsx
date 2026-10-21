import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { BarChart3, ShoppingBag, Wallet, Users } from 'lucide-react';
const money = (n) => `R ${Number(n || 0).toFixed(2)}`;
function Tile({ icon: Icon, label, value }) { return <div className="rounded-2xl border bg-white p-5"><Icon className="mb-3 h-6 w-6 text-emerald-700"/><p className="text-xs font-bold text-slate-500">{label}</p><strong className="mt-2 block text-2xl text-slate-900">{value}</strong></div>; }
function Table({ title, rows, nameKey, valueKey, valueFormat }) { return <section className="rounded-2xl border bg-white p-5"><h2 className="mb-4 text-lg font-black">{title}</h2>{!rows?.length ? <p className="text-sm text-slate-500">No simulated orders recorded yet.</p> : <div className="divide-y">{rows.map((r, i) => <div key={i} className="flex justify-between gap-3 py-3 text-sm"><span className="break-words">{r[nameKey]}</span><strong className="shrink-0">{valueFormat ? valueFormat(r[valueKey]) : r[valueKey]}</strong></div>)}</div>}</section>; }
export default function AdminOrderAnalytics() {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); axios.get('/api/admin/order-analytics', { signal: controller.signal, withCredentials: true }).then((res) => setData(res.data)).catch((e) => { if (!controller.signal.aborted) setError(e.response?.data?.error || 'Unable to load admin analytics.'); }); return () => controller.abort(); }, []);
  return <main className="min-h-screen bg-[#F7FAF7] px-4 py-9"><div className="mx-auto max-w-6xl space-y-6">
    <nav className="flex flex-wrap gap-4 text-sm font-bold text-emerald-700"><Link to="/admin">← Admin dashboard</Link><Link to="/admin/orders">View all customer order plans →</Link></nav><h1 className="flex items-center gap-2 text-3xl font-black"><BarChart3 className="text-emerald-700"/> Shopping activity analytics</h1><p className="text-sm text-slate-500">Aggregate insights from saved simulated orders. Not actual retailer sales.</p>
    {error && <p className="rounded-xl bg-red-50 p-4 text-red-700" role="alert">{error}</p>}
    {!data ? <p>Loading analytics…</p> : <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Tile icon={ShoppingBag} label="Active simulated orders" value={data.simulatedOrders}/><Tile icon={Users} label="Customers with plans" value={data.usersWithPlans}/><Tile icon={Wallet} label="Estimated planned spend" value={money(data.plannedSpend)}/><Tile icon={BarChart3} label="Estimated savings on comparable plans" value={money(data.estimatedSavings)}/></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{data.comparablePlans} plans have complete indexed comparisons; {data.incomparablePlans} do not. Cancelled plans: {data.cancelledPlans}. Counts are not verified purchases.</div>
      <div className="grid gap-5 lg:grid-cols-2"><Table title="Simulated orders by chosen retailer" rows={data.stores} nameKey="name" valueKey="orders"/><Table title="Most frequently selected products" rows={data.products} nameKey="name" valueKey="units"/><Table title="Orders by province" rows={data.provinces} nameKey="name" valueKey="orders"/><Table title="Monthly planned spending" rows={data.monthly} nameKey="month" valueKey="plannedSpend" valueFormat={money}/></div>
      <p className="text-xs leading-5 text-slate-500">{data.disclaimer}</p>
    </>}
  </div></main>;
}
