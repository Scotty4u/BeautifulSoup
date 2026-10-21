import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, MapPin, PackageCheck, Plus, ShieldCheck, RefreshCw, AlertCircle, CheckCircle2, Truck, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCart } from '../utils/cart';
import OrderProductImage from '../components/OrderProductImage';
import AddressLookup from '../components/AddressLookup';
import { isVisibleProduct } from '../utils/ProductVisibility';

const PROVINCES = ['Eastern Cape', 'Western Cape', 'Northern Cape', 'Gauteng', 'KwaZulu-Natal', 'Free State', 'North West', 'Limpopo', 'Mpumalanga'];
const INPUT = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const BLANK = { label: 'Home', recipient: '', phone: '', street: '', suburb: '', city: '', province: 'Eastern Cape', postal_code: '', notes: '' };
const money = (value) => `R ${Number(value || 0).toFixed(2)}`;
const newRequestId = () => `sb_${crypto.randomUUID().replace(/-/g, '')}`;

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selection] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('smartbasket:checkout-retailer') || 'null'); }
    catch { return null; }
  });
  const selectedRetailer = selection?.retailer || '';
  const [items] = useState(() => selection?.items?.length ? selection.items : getCart());
  const visible = useMemo(() => items.filter((product) => isVisibleProduct(product, user)), [items, user]);
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState('delivery');
  const [pickupBranch, setPickupBranch] = useState(''); // Verified OSM branch ID, not typed text
  const [collectionBranches, setCollectionBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState('');
  const [branchReload, setBranchReload] = useState(0);
  const [editingAddress, setEditingAddress] = useState(false);
  const [address, setAddress] = useState(BLANK);
  const [loading, setLoading] = useState(true);
  const [addressError, setAddressError] = useState('');
  const [saving, setSaving] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [unavailableIds, setUnavailableIds] = useState([]);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(newRequestId());
  const quotedLines = useMemo(() => new Map((quote?.items || []).map((item) => [String(item.id), item])), [quote]);
  const changedLines = useMemo(() => visible.filter((item) => {
    const fresh = quotedLines.get(String(item.id));
    return fresh && Math.abs(Number(fresh.unitPrice) - Number(item.price)) >= 0.01;
  }), [visible, quotedLines]);

  // A delivery address is required only for home delivery. Collection can proceed
  // with the selected supermarket branch, even for users with no saved address.
  useEffect(() => {
    if (fulfillmentType !== 'delivery') {
      setLoading(false);
      setAddressError('');
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setAddressError('');
    axios.get('/api/orders/addresses', { signal: controller.signal, withCredentials: true })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const saved = Array.isArray(data) ? data : [];
        setAddresses(saved);
        setAddressId((previous) => saved.some((item) => String(item.id) === previous)
          ? previous : saved.length ? String(saved[0].id) : '');
        if (!saved.length) setEditingAddress(true);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setAddressError(err.response?.data?.error || 'Could not load delivery addresses.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [fulfillmentType]);

  useEffect(() => {
    if (!user || !selectedRetailer || !visible.length) {
      setQuote(null); setQuoteLoading(false); return undefined;
    }
    const controller = new AbortController();
    setQuote(null);
    setQuoteError('');
    setUnavailableIds([]);
    setQuoteLoading(true);
    // On first checkout and each Retry, backend checks current indexed prices,
    // then attempts exact-SKU retailer refreshes for stale items.
    axios.post('/api/orders/quote', {
      retailer: selectedRetailer,
      items: visible.map((item) => ({
        id: String(item.id),
        quantity: Math.round(Number(item.quantity) || 1),
        // Server uses the name ONLY as a retailer search hint.
        name: String(item.name || '').slice(0, 180),
      }))
    }, { withCredentials: true, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setQuote(data); })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setQuoteError(err.response?.data?.error || 'Could not verify product prices.');
        setUnavailableIds(Array.isArray(err.response?.data?.unavailableIds) ? err.response.data.unavailableIds : []);
      })
      .finally(() => { if (!controller.signal.aborted) setQuoteLoading(false); });
    return () => controller.abort();
  }, [user?.id, visible, selectedRetailer, quoteRetry]);

  useEffect(() => {
    if (fulfillmentType !== 'collection' || !selectedRetailer) return undefined;
    const controller = new AbortController();
    setPickupBranch('');
    setCollectionBranches([]);
    setBranchesLoading(true);
    setBranchesError('');
    axios.get('/api/orders/collection-branches', { params: { retailer: selectedRetailer },
      withCredentials: true, signal: controller.signal })
      .then(({data}) => {
        if (controller.signal.aborted) return;
        setCollectionBranches(Array.isArray(data?.branches) ? data.branches : []);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setBranchesError(err?.response?.data?.error || 'Could not load mapped branches.');
      })
      .finally(() => { if (!controller.signal.aborted) setBranchesLoading(false); });
    return () => controller.abort();
  }, [fulfillmentType, selectedRetailer, branchReload]);

  const saveAddress = async (event) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const { data } = await axios.post('/api/orders/addresses', address, { withCredentials: true });
      setAddresses((old) => [data, ...old]);
      setAddressId(String(data.id)); setAddress(BLANK); setEditingAddress(false);
    } catch (err) { setError(err.response?.data?.error || 'Could not save address.'); }
    finally { setSaving(false); }
  };

  const validCollectionBranch = collectionBranches.some((branch) => String(branch.id) === String(pickupBranch));
  const canConfirm = Boolean(selectedRetailer && visible.length && quote && !placing && !quoteLoading
    && (fulfillmentType === 'collection' ? (!branchesLoading && validCollectionBranch) : (!loading && !!addressId)));

  const placeOrder = async () => {
    if (!canConfirm) return;
    setError(''); setPlacing(true);
    try {
      const { data } = await axios.post('/api/orders', {
        requestId: requestId.current, retailer: selectedRetailer,
        ...(fulfillmentType === 'delivery' ? { addressId: Number(addressId) } : {}),
        fulfillmentType, pickupBranchId: fulfillmentType === 'collection' ? String(pickupBranch) : '',
        items: visible.map((item) => ({
        id: String(item.id),
        quantity: Math.round(Number(item.quantity) || 1),
        // Server uses the name ONLY as a retailer search hint.
        name: String(item.name || '').slice(0, 180),
      })),
        quoteTotal: quote.total
      }, { withCredentials: true });
      sessionStorage.removeItem('smartbasket:checkout-retailer');
      navigate('/account/orders', { replace: true, state: { justPlaced: data.id } });
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to place this simulated order.');
      if (['PRICE_CHANGED', 'PRICE_UNAVAILABLE'].includes(err.response?.data?.code)) {
        // Never submit an order against a changed/unavailable quote.
        setQuote(null);
        setQuoteRetry((retry) => retry + 1);
      }
    } finally { setPlacing(false); }
  };

  const estimated = visible.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.quantity) || 1), 0);
  return <main className="min-h-screen bg-[#F7FAF7] px-4 py-9 sm:px-6">
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/basket" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-emerald-700"><ArrowLeft className="h-4 w-4"/> Back to basket</Link>
      <div className="rounded-3xl border border-emerald-100 bg-gradient-to-r from-emerald-100 to-white p-6 sm:p-8">
        <h1 className="text-3xl font-black text-slate-900">Place a simulated order</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">For the SmartBasket university prototype. Your order is saved in SmartBasket only—no supermarket receives it, no payment is charged, and no delivery is arranged.</p>
      </div>
      {!selectedRetailer && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Choose a retailer on the <Link to="/basket/compare" className="underline">Best Shop comparison page</Link> before placing an order.</div>}
      {selectedRetailer && <div className="rounded-xl border border-emerald-200 bg-white p-4 text-sm font-bold text-emerald-900">Selected shop: <strong>{selectedRetailer}</strong> · <Link to="/basket/compare" className="ml-2 underline">Change retailer</Link></div>}
      <section aria-label="Order fulfillment" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-3 text-lg font-extrabold text-slate-900">How would you like to receive your basket plan?</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[{type:'delivery',label:'Home delivery',Icon:Truck,desc:'Demo delivery progress'}, {type:'collection',label:'Supermarket collection',Icon:Store,desc:'Demo pickup progress'}].map(({type,label,Icon,desc}) => (
            <button key={type} type="button" aria-pressed={fulfillmentType === type} onClick={() => setFulfillmentType(type)} className={`flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left transition ${fulfillmentType === type ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-emerald-300'}`}>
              <Icon className="h-6 w-6 shrink-0 text-emerald-700"/><span><strong className="block text-sm">{label}</strong><span className="text-xs text-slate-600">{desc}</span></span>
            </button>
          ))}
        </div>
        {fulfillmentType === 'collection' && <div className="mt-4 space-y-3">
          <label htmlFor="checkout-collection-branch" className="block text-sm font-bold text-slate-900">Choose a {selectedRetailer} branch for collection</label>
          {branchesLoading ? <p role="status" className="text-sm text-slate-600">Loading mapped supermarkets…</p> : null}
          {branchesError ? <p role="alert" className="text-sm text-rose-700">{branchesError}</p> : null}
          <select id="checkout-collection-branch" className={INPUT} required disabled={branchesLoading || !collectionBranches.length}
            value={pickupBranch} onChange={event => setPickupBranch(event.target.value)}>
            <option value="">{collectionBranches.length ? 'Select an available branch' : 'No mapped branches available'}</option>
            {collectionBranches.map(branch => <option key={branch.id} value={branch.id}>
              {branch.name}{branch.address ? ` — ${branch.address}` : ''}{branch.distanceKm != null ? ` (${branch.distanceKm} km)` : ''}
            </option>)}
          </select>
          {collectionBranches.length === 0 && !branchesLoading && <p className="text-xs text-amber-800">No mapped {selectedRetailer} branches are available in SmartBasket's current branch database. Try reloading locations or select Home delivery.</p>}
          <button type="button" onClick={() => setBranchReload(n => n + 1)} disabled={branchesLoading} className="min-h-10 rounded-xl border border-emerald-200 bg-white px-4 text-sm font-bold text-emerald-800 disabled:opacity-40">Reload branch list</button>
          <p className="text-xs leading-5 text-slate-500">Only the selected retailer's mapped supermarket branches appear here. This doesn't confirm store pickup availability or reserve stock.</p>
        </div>}
        <p className="mt-3 text-xs leading-5 text-slate-600">This is a SmartBasket simulation. Choosing a method does not schedule real delivery or reserve collection with a retailer.</p>
      </section>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
        <section className="space-y-5">
          {fulfillmentType === 'delivery' && <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-xl font-extrabold text-slate-900"><MapPin className="h-5 w-5 text-emerald-700"/> Delivery address</h2>
              <button type="button" onClick={() => setEditingAddress((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700"><Plus className="h-4 w-4"/> {editingAddress ? 'Cancel' : 'Add address'}</button>
            </div>
            {addressError && <p role="alert" className="mt-3 text-sm text-red-700">{addressError}</p>}
            {loading ? <p className="mt-4 text-slate-500">Loading saved addresses…</p> : <>
              {addresses.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2">{addresses.map((saved) => <label key={saved.id} className={`cursor-pointer rounded-xl border p-4 text-sm ${String(saved.id) === addressId ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                <input type="radio" name="checkout-address" className="mr-2 accent-emerald-600" checked={String(saved.id) === addressId} onChange={() => setAddressId(String(saved.id))}/><strong>{saved.label} · {saved.recipient}</strong>
                <span className="mt-2 block text-slate-600">{saved.street}, {saved.suburb}, {saved.city}, {saved.province}, {saved.postal_code}</span><span className="block text-slate-500">{saved.phone}</span>
              </label>)}</div>}
              {editingAddress && <form onSubmit={saveAddress} className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
                <div className="sm:col-span-2"><AddressLookup autoFromShoppingLocation={addresses.length === 0} onSelect={(fields) => setAddress((old) => ({ ...old, ...fields }))}/></div>
                {['label','recipient','phone','street','suburb','city','postal_code'].map((field) => <label key={field} className="space-y-1 text-xs font-bold text-slate-600"><span className="capitalize">{field.replace('_', ' ')}</span><input required={field !== 'label'} value={address[field]} onChange={(e) => setAddress((old) => ({ ...old, [field]: e.target.value }))} className={INPUT} maxLength={field === 'street' ? 180 : 100}/></label>)}
                <label className="space-y-1 text-xs font-bold text-slate-600"><span>Province</span><select value={address.province} onChange={(e) => setAddress((old) => ({ ...old, province: e.target.value }))} className={INPUT}>{PROVINCES.map((province) => <option key={province}>{province}</option>)}</select></label>
                <label className="space-y-1 text-xs font-bold text-slate-600 sm:col-span-2"><span>Delivery notes (optional)</span><input value={address.notes} onChange={(e) => setAddress((old) => ({ ...old, notes: e.target.value }))} className={INPUT} maxLength={250}/></label>
                <button disabled={saving} type="submit" className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Saving address…' : 'Save delivery address'}</button>
              </form>}
            </>}
          </div>}
          {fulfillmentType === 'collection' && <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 sm:p-5">
            <div className="flex items-center gap-2 font-bold"><Store className="h-5 w-5"/> No home address needed</div>
            <p className="mt-2 leading-6">Choose your supermarket branch above. Your collection plan will be saved for that branch—no delivery address is requested.</p>
            {validCollectionBranch && <p className="mt-2 font-semibold">Selected branch: {collectionBranches.find((branch) => String(branch.id) === String(pickupBranch))?.name}</p>}
          </div>}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 text-xl font-extrabold text-slate-900">Items in your plan</h2>
            {visible.length === 0 ? <p className="text-sm text-slate-500">Your basket is empty. <Link to="/search" className="font-bold text-emerald-700">Browse products</Link>.</p> : visible.map((item) => {
              const live = quotedLines.get(String(item.id));
              const qty = Math.max(1, Number(item.quantity) || 1);
              const amount = live ? Number(live.subtotal) : Number(item.price) * qty;
              const changed = live && Math.abs(Number(live.unitPrice) - Number(item.price)) >= 0.01;
              const unavailable = unavailableIds.includes(String(item.id));
              return <div key={item.id} className="flex min-w-0 flex-wrap items-center gap-3 border-t border-slate-100 py-3 text-sm">
                <OrderProductImage src={item.imageUrl} name={item.name} />
                <div className="min-w-0 flex-1"><strong className="block break-words text-slate-900">{item.name}</strong><span className="text-xs text-slate-500">{live?.store || item.store} · Qty {qty}</span>
                  {changed && <span className="mt-1 block text-xs font-bold text-amber-700">Updated from {money(item.price)} to {money(live.unitPrice)} each</span>}
                  {unavailable && <span className="mt-1 block text-xs font-bold text-red-700">The retailer could not confirm this exact item's current price. Use Retry prices below.</span>}
                </div>
                <strong className="shrink-0 tabular-nums">{money(amount)}</strong>
              </div>;
            })}
          </section>
        </section>
        <aside className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm lg:sticky lg:top-24">
          <div className="mb-4 flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-emerald-700"/><h2 className="text-lg font-black">Order summary</h2></div>
          <p className="text-sm text-slate-500">{visible.length} different products</p>
          <div className="my-5 border-b pb-5"><span className="text-xs font-bold text-slate-600">{quote ? 'Verified price estimate' : 'Basket estimate'} · {selectedRetailer || 'No shop selected'}</span><strong className="mt-2 block whitespace-nowrap text-3xl font-black tabular-nums tracking-tight text-emerald-700 sm:text-4xl">{money(quote ? quote.total : estimated)}</strong></div>
          {quoteLoading && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800"><RefreshCw className="h-4 w-4 animate-spin"/> Checking prices and refreshing stale products automatically…</div>}
          {quoteError && <div role="alert" className="mb-3 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-800">
            <p className="flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0"/>{quoteError}</p>
            {unavailableIds.length > 0 && <p className="mt-2">{unavailableIds.length} product(s) could not be verified. They are marked in your item list.</p>}
            <button type="button" disabled={quoteLoading} onClick={() => setQuoteRetry((retry) => retry + 1)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 font-bold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-50"><RefreshCw className="h-4 w-4"/> Retry prices</button>
          </div>}
          {quote && <div className="mb-3 space-y-2">
            <p className="flex items-center gap-2 text-xs font-bold text-emerald-800"><CheckCircle2 className="h-4 w-4"/> {quote.items?.length || visible.length} products checked against recent retailer listings</p>
            {changedLines.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">{changedLines.length} product price(s) changed. Review the updated line totals before placing your order.</p>}
            <p className="text-xs text-emerald-800">{quote.estimatedSavings === null ? 'No reliable complete-store savings comparison available.' : `Estimated savings vs highest indexed full-store basket: ${money(quote.estimatedSavings)}.`}</p>
          </div>}
          <p className="mb-5 text-xs leading-5 text-slate-500">Prices are checked with the backend. They can change before saving; the final amount is shown in order history. No retailer order or payment occurs.</p>
          <button type="button" onClick={placeOrder} disabled={!canConfirm} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-extrabold text-white hover:bg-emerald-800 disabled:opacity-40"><PackageCheck className="h-5 w-5"/>{placing ? 'Saving your order…' : `Save ${fulfillmentType === 'collection' ? 'collection' : 'delivery'} plan`}</button>
          <Link to="/account/orders" className="mt-4 block text-center text-sm font-bold text-emerald-700">View order history</Link>
        </aside>
      </div>
    </div>
  </main>;
}
