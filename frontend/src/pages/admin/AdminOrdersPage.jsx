import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { ClipboardList, RefreshCw, Store, Truck } from 'lucide-react';
import OrderProductImage from '../../components/OrderProductImage';

const money = amount => `R ${Number(amount || 0).toFixed(2)}`;
const STATUS_NAMES = {
  simulated_placed: 'Placed', simulated_confirmed: 'Confirmed', simulated_preparing: 'Preparing',
  simulated_out_for_delivery: 'Out for delivery', simulated_ready_for_collection: 'Ready for collection',
  simulated_delivered: 'Delivered', simulated_collected: 'Collected', simulated_cancelled: 'Canceled',
};
const fmt = status => `${STATUS_NAMES[status] || status?.replaceAll('_',' ')} (demo)`;
export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    axios.get('/api/admin/orders', { withCredentials: true, signal: controller.signal })
      .then(({data}) => { if (!controller.signal.aborted) setOrders(Array.isArray(data) ? data : []); })
      .catch(error => { if (!controller.signal.aborted) setError(error.response?.data?.error || 'Could not load orders.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const updateStatus = async (order, status) => {
    if (!window.confirm(`Mark demo order #${order.id} as "${STATUS_NAMES[status]}"?`)) return;
    setBusy(order.id); setError(''); setNotice('');
    try {
      const { data } = await axios.patch(`/api/admin/orders/${order.id}/status`, { status, expectedStatus: order.status }, { withCredentials: true });
      setOrders(current => current.map(item => item.id === order.id ? { ...item, ...data, customer: item.customer, province: item.province } : item));
      setNotice(`Order #${order.id}: ${fmt(status)}. This does not contact the retailer or courier.`);
    } catch (error) { setError(error.response?.data?.error || 'Could not update order progress.'); }
    finally { setBusy(null); }
  };
  return <main className="min-h-screen min-w-0 bg-[#F7FAF7] px-3 py-6 sm:px-6 sm:py-9"><div className="mx-auto max-w-6xl space-y-6">
    <nav className="flex flex-wrap gap-4 text-sm font-bold text-emerald-800"><Link to="/admin">← Admin dashboard</Link><Link to="/admin/order-analytics">Order analytics</Link></nav>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-3 text-2xl font-black text-slate-900 sm:text-3xl"><ClipboardList className="h-7 w-7 text-emerald-700"/> Customer order plans</h1><p className="mt-2 text-sm text-slate-600">Manage simulated delivery and collection progress. No real purchases or deliveries are arranged.</p></div><button type="button" onClick={() => setRefresh(n => n + 1)} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4"/> Refresh</button></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-900">{notice}</p>}
    {loading ? <p role="status" className="text-slate-500">Loading orders…</p> : !orders.length ? <p className="rounded-2xl bg-white p-6 text-slate-500">No simulated orders recorded yet.</p> : <div className="space-y-3">{orders.map(o => <section key={o.id} className="min-w-0 rounded-2xl border bg-white shadow-sm">
      <button type="button" aria-expanded={expanded === o.id} onClick={() => setExpanded(expanded === o.id ? null : o.id)} className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 p-4 text-left sm:p-5"><div className="min-w-0"><strong className="block break-words text-base">Order #{o.id} · {o.retailer || 'Legacy mixed basket'}</strong><p className="mt-1 break-words text-xs text-slate-600">{o.customer?.username} · {o.customer?.email} · {new Date(o.placedAt).toLocaleString()}</p><p className="mt-2 flex items-center gap-2 text-xs font-bold text-emerald-800">{o.fulfillmentType === 'collection' ? <Store className="h-4 w-4"/> : <Truck className="h-4 w-4"/>}{o.fulfillmentType === 'collection' ? 'Collection' : 'Delivery'}</p></div><div className="text-right"><strong className="block whitespace-nowrap text-xl text-emerald-700">{money(o.total)}</strong><span className="text-xs text-slate-500">{fmt(o.status)}</span></div></button>
      {expanded === o.id && <div className="min-w-0 space-y-4 border-t p-4 sm:p-5"><p className="text-xs leading-5 text-slate-600">{o.fulfillmentType === 'collection' ? `Preferred collection branch: ${o.pickupBranch || 'Not supplied'}. Customer contact area` : 'Delivery contact area'}: {o.address?.street}, {o.address?.suburb}, {o.address?.city}, {o.address?.province}</p>
        <div className="divide-y">{(o.items || []).map((item,i) => <div key={i} className="flex min-w-0 items-center gap-3 py-3 text-sm"><OrderProductImage src={item.imageUrl} name={item.name}/><div className="min-w-0 flex-1"><strong className="block break-words">{item.name}</strong><p className="text-xs text-slate-500">{item.store} · Qty {item.quantity}</p></div><strong className="shrink-0 text-xs sm:text-sm">{money(item.subtotal)}</strong></div>)}</div>
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h2 className="font-bold text-slate-900">Tracking history</h2><ol className="mt-2 space-y-2">{(o.timeline || []).map((item, i) => <li key={`${item.status}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700"><span>{fmt(item.status)}</span><time>{new Date(item.createdAt).toLocaleString()}</time></li>)}</ol>
          {(o.nextStatuses || []).length > 0 && <div className="mt-4 border-t pt-4"><p className="mb-2 text-xs font-bold text-slate-600">Update simulated progress</p><div className="flex flex-wrap gap-2">{o.nextStatuses.map(status => <button key={status} type="button" disabled={busy === o.id} onClick={() => updateStatus(o,status)} className={`min-h-10 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50 ${status === 'simulated_cancelled' ? 'border border-rose-200 bg-white text-rose-700' : 'bg-emerald-700 text-white hover:bg-emerald-800'}`}>{busy === o.id ? 'Saving…' : fmt(status)}</button>)}</div></div>}
        </section>
      </div>}
    </section>)}</div>}
  </div></main>;
}
