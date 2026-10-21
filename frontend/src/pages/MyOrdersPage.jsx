import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import { ClipboardList, ArrowLeft, ArrowRight, ShoppingBasket, RefreshCw, Truck, Store, CircleCheck, Circle, Clock3 } from 'lucide-react';
import OrderProductImage from '../components/OrderProductImage';
import { storeSlugFor } from '../utils/retailers';
import picknpayLogo from '../assets/imgs/picknpay.png';
import shopriteLogo from '../assets/imgs/shoprite.png';
import checkersLogo from '../assets/imgs/checkers.png';
import woolworthsLogo from '../assets/imgs/woolworths.png';

const STORE_INFO = { 'Pick n Pay': picknpayLogo, Shoprite: shopriteLogo, Checkers: checkersLogo, Woolworths: woolworthsLogo };
const money = (n) => `R ${Number(n || 0).toFixed(2)}`;
const labelStatus = (value = '') => ({
  simulated_placed: 'Order plan placed', simulated_confirmed: 'Confirmed (demo)',
  simulated_preparing: 'Preparing (demo)', simulated_out_for_delivery: 'Out for delivery (demo)',
  simulated_ready_for_collection: 'Ready for collection (demo)', simulated_delivered: 'Delivered (demo)',
  simulated_collected: 'Collected (demo)', simulated_cancelled: 'Canceled',
}[value] || value.replaceAll('_', ' '));
const orderStores = (order) => order.retailer ? [order.retailer] : [...new Set((order.items || []).map(item => item.store).filter(Boolean))];

function StoreLabel({ store }) {
  const slug = storeSlugFor(store);
  return slug ? <Link to={`/store/${slug}`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-800">
    {STORE_INFO[store] && <img src={STORE_INFO[store]} className="h-6 w-6 object-contain" alt=""/>}<span className="truncate">{store}</span><ArrowRight className="h-3.5 w-3.5"/>
  </Link> : <span className="text-sm text-slate-600">{store || 'Retailer'}</span>;
}

function TrackingTimeline({ order }) {
  const collection = order.fulfillmentType === 'collection';
  const steps = collection ? [
    'simulated_placed', 'simulated_confirmed', 'simulated_preparing',
    'simulated_ready_for_collection', 'simulated_collected',
  ] : [
    'simulated_placed', 'simulated_confirmed', 'simulated_preparing',
    'simulated_out_for_delivery', 'simulated_delivered',
  ];
  const timestamps = new Map((order.timeline || []).map(event => [event.status, event.createdAt]));
  if (!timestamps.size && order.placedAt) timestamps.set('simulated_placed', order.placedAt);
  const currentStep = steps.indexOf(order.status);
  return <section aria-label={`Tracking progress for order ${order.id}`} className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold text-slate-900">{collection ? 'Collection' : 'Delivery'} progress</h3><span className="text-xs font-semibold text-slate-600">SmartBasket demo updates</span></div>
    {collection && <p className="mt-2 text-xs leading-5 text-slate-600">Preferred branch: <strong>{order.pickupBranch || 'Not specified'}</strong>. No pickup is reserved with the retailer.</p>}
    {order.status === 'simulated_cancelled' && <p role="status" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">This simulated order was canceled.</p>}
    <ol className="mt-4 space-y-3">
      {steps.map((step, index) => {
        const completed = timestamps.has(step) || (currentStep !== -1 && index <= currentStep);
        const date = timestamps.get(step);
        return <li key={step} className="flex min-w-0 gap-3">
          <span aria-hidden="true" className="mt-0.5">{completed ? <CircleCheck className="h-5 w-5 text-emerald-700"/> : <Circle className="h-5 w-5 text-slate-300"/>}</span>
          <div className="min-w-0"><p className={`text-sm font-bold ${completed ? 'text-slate-900' : 'text-slate-400'}`}>{labelStatus(step)}</p>
            {date && <p className="text-xs text-slate-500">{new Date(date).toLocaleString()}</p>}
            {!completed && index === currentStep + 1 && <p className="text-xs text-slate-500">Awaiting admin demo update</p>}
          </div>
        </li>;
      })}
    </ol>
    <p className="mt-4 border-t border-emerald-100 pt-3 text-xs leading-5 text-slate-600">These stages are updated manually by a SmartBasket administrator. They are not live retailer, courier, or collection confirmation.</p>
  </section>;
}

export default function MyOrdersPage() {
  const { state } = useLocation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [tracking, setTracking] = useState(state?.justPlaced || null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    axios.get('/api/orders', { withCredentials: true, signal: controller.signal })
      .then(({data}) => { if (!controller.signal.aborted) setOrders(Array.isArray(data) ? data : []); })
      .catch((error) => { if (!controller.signal.aborted) setError(error.response?.data?.error || 'Could not load orders.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const cancel = async (id) => {
    if (!window.confirm('Cancel this simulated order?')) return;
    setBusy(id); setError('');
    try {
      const { data } = await axios.post(`/api/orders/${id}/cancel`, {}, { withCredentials: true });
      setOrders(old => old.map(order => order.id === id ? data : order));
    } catch (error) { setError(error.response?.data?.error || 'Could not cancel order.'); }
    finally { setBusy(null); }
  };
  return <main className="min-h-screen min-w-0 bg-[#F7FAF7] px-3 py-6 sm:px-4 sm:py-9"><div className="mx-auto max-w-5xl space-y-6">
    <Link to="/account" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft className="h-4 w-4"/> Account</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl"><ClipboardList className="text-emerald-700"/> My order history</h1><p className="mt-1 text-sm text-slate-500">Track your delivery or collection demo plans. No supermarket orders are submitted.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setRefresh(n => n + 1)} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-bold text-emerald-800"><RefreshCw className="h-4 w-4"/> Refresh</button><Link to="/insights" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800">Spending insights</Link></div>
    </div>
    {state?.justPlaced && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">Plan #{state.justPlaced} was saved. A retailer has not been contacted.</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {loading ? <p role="status">Loading orders…</p> : orders.length === 0 ? <section className="rounded-2xl border bg-white p-10 text-center"><ShoppingBasket className="mx-auto mb-3 h-9 w-9 text-emerald-600"/><h2 className="text-xl font-bold">No simulated orders yet</h2><Link to="/basket" className="mt-3 inline-block font-bold text-emerald-700">Go to basket</Link></section> : orders.map(order => <section key={order.id} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4"><div className="min-w-0 space-y-2"><div className="flex flex-wrap gap-2">{orderStores(order).map(store => <StoreLabel key={store} store={store}/>)}</div><h2 className="text-lg font-extrabold">Order #{order.id} <span className="ml-1 inline-block rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">{labelStatus(order.status)}</span></h2><p className="text-xs text-slate-500">{new Date(order.placedAt).toLocaleString()} · {order.address?.city}, {order.address?.province}</p></div><strong className="text-xl font-black text-emerald-700">{money(order.total)}</strong></div>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-700">{order.fulfillmentType === 'collection' ? <Store className="h-4 w-4 text-emerald-700"/> : <Truck className="h-4 w-4 text-emerald-700"/>}{order.fulfillmentType === 'collection' ? 'Supermarket collection' : 'Home delivery'}</div>
      <div className="divide-y divide-slate-100">{(order.items || []).map((item, i) => <div key={`${item.id}-${i}`} className="flex min-w-0 items-center gap-3 py-3 text-sm"><OrderProductImage src={item.imageUrl} name={item.name}/><div className="min-w-0 flex-1"><strong className="block break-words">{item.name}</strong><p className="text-xs text-slate-500">{item.store} · {item.quantity} × {money(item.unitPrice)}</p></div><strong className="shrink-0 whitespace-nowrap text-xs tabular-nums sm:text-sm">{money(item.subtotal)}</strong></div>)}</div>
      {tracking === order.id && <TrackingTimeline order={order}/>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="max-w-lg text-xs leading-5 text-slate-500">{order.estimatedSavings === null ? 'A reliable exact-product savings comparison was unavailable.' : `Estimated savings against the highest indexed full-store basket: ${money(order.estimatedSavings)}`}</p>
        <div className="flex flex-wrap gap-2"><button type="button" aria-expanded={tracking === order.id} onClick={() => setTracking(current => current === order.id ? null : order.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-800"><Clock3 className="h-4 w-4"/>{tracking === order.id ? 'Hide tracking' : 'Track order'}</button>
          {order.status === 'simulated_placed' && <button disabled={busy === order.id} onClick={() => cancel(order.id)} className="min-h-10 rounded-xl border border-rose-200 px-3 py-2 text-xs font-extrabold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Cancel order</button>}</div></div>
    </section>)}
  </div></main>;
}
