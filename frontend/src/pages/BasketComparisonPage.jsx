import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowLeft, ArrowRight, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  MapPin, RefreshCw, ShoppingBasket, Store, Tag, Search, XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCart } from '../utils/cart';
import { isVisibleProduct } from '../utils/ProductVisibility';
import { buildBasketComparison } from '../utils/BasketComparison.mjs';
import { getShoppingLocation, LOCATION_EVENT } from '../utils/ShoppingLocation';
import NearbyBasketSection from '../components/NearbyBasketSection';
import { Button } from '@/components/ui/button';

const money = (amount) => `R ${Number(amount || 0).toFixed(2)}`;

// Safe suggestions from the real retailer search endpoint. We don't invent
// substitutes or present a differently-sized item as the same product.
const rowId = (row) => String(row.item?.id ?? row.item?.name ?? '');
const normaliseStore = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const offerPrice = (offer) => {
  const amount = Number(offer?.price);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};
const packSize = (name) => {
  const match = String(name || '').toLowerCase().match(/\b(\d+(?:\.\d+)?)\s*(kg|g|l|litres?|ml|cl|pack|pk|pcs?|pieces?)\b/);
  if (!match) return null;
  const unit = match[2];
  const scale = unit === 'kg' || unit === 'l' || unit.startsWith('litre') ? 1000 : unit === 'cl' ? 10 : 1;
  const kind = ['kg', 'g'].includes(unit) ? 'mass' : ['l', 'ml', 'cl'].includes(unit) || unit.startsWith('litre') ? 'volume' : 'count';
  return `${kind}:${Number(match[1]) * scale}`;
};
const candidateOffers = (items, row, retailer, user) => {
  const sourceName = String(row.item?.name || '');
  const originalSize = packSize(sourceName);
  const meaningful = new Set(sourceName.toLowerCase().match(/[a-z]{4,}/g) || []);
  const matches = (Array.isArray(items) ? items : []).filter((offer) => {
    if (!offer?.id || !isVisibleProduct(offer, user) || offerPrice(offer) === null) return false;
    if (normaliseStore(offer.store) !== normaliseStore(retailer)) return false;
    const foundSize = packSize(offer.name);
    // If the original has a known pack size, require the same pack size.
    if (originalSize && (!foundSize || originalSize !== foundSize)) return false;
    const words = (String(offer.name || '').toLowerCase().match(/[a-z]{4,}/g) || []);
    return words.some((word) => meaningful.has(word));
  });
  return [...new Map(matches.map((offer) => [String(offer.id), offer])).values()]
    .sort((a, b) => offerPrice(a) - offerPrice(b)).slice(0, 4);
};

// A replacement is presented using its OWN name/photo, never the original's.
// Avoid displaying the original picture if an equivalent does not have one.
const offerImage = (offer) => {
  const value = offer?.imageUrl || offer?.image_url || offer?.thumbnailUrl || offer?.image || '';
  if (typeof value !== 'string' || !value.trim()) return '';
  if (/^\/\/[^/]/.test(value)) return `https:${value}`;
  return /^(https?:\/\/|\/(?!\/))/i.test(value) ? value : '';
};

function ProductThumbnail({ offer, name, size = 'medium' }) {
  const [broken, setBroken] = useState(false);
  const url = offerImage(offer);
  useEffect(() => setBroken(false), [url]);
  const dimensions = size === 'small' ? 'h-12 w-12 sm:h-14 sm:w-14' : 'h-16 w-16 sm:h-[72px] sm:w-[72px]';
  return (
    <div className={`flex ${dimensions} shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5`}>
      {url && !broken ? (
        <img src={url} alt={name || 'Product'} loading="lazy"
          onError={() => setBroken(true)} className="h-full w-full object-contain" />
      ) : <ShoppingBasket aria-hidden="true" className="h-6 w-6 text-slate-300" />}
    </div>
  );
}

function ComparisonRow({ row, storeName, current, onSelect, onSkip, onFind, suggestions, finding, searchError }) {
  const { item, quantity, exact } = row;
  const original = row.offer;
  const selected = current?.kind === 'offer' ? current.offer : (current ? null : exact ? original : null);
  const skipped = current?.kind === 'skip';
  const waiting = !selected && !skipped;
  const isEquivalent = selected && !(exact && String(selected.id) === String(original?.id));
  const display = selected || item;
  const displayName = String(display?.name || item.name || 'Unnamed product');
  const activeId = selected?.id != null ? String(selected.id) : null;

  return (
    <div className={`min-w-0 px-3 py-4 sm:px-6 ${waiting ? 'bg-amber-50/40' : ''}`}>
      <div className="flex min-w-0 items-start gap-3 sm:items-center">
        <ProductThumbnail offer={display} name={displayName} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-extrabold leading-snug text-slate-900 sm:text-base">{displayName}</p>
          {isEquivalent && String(item.name || '').toLowerCase() !== displayName.toLowerCase() && (
            <p className="mt-1 break-words text-[11px] text-slate-500 sm:text-xs">Replacing: {item.name}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 sm:text-xs">
            <span>Qty: {quantity}</span>
            {skipped ? <span className="rounded-md bg-slate-100 px-2 py-0.5 font-bold text-slate-600">Skipped</span>
              : selected ? <span className={`rounded-md px-2 py-0.5 font-bold ${isEquivalent ? 'bg-blue-50 text-blue-800' : 'bg-emerald-50 text-emerald-700'}`}>{isEquivalent ? 'Selected equivalent' : 'Exact match'}</span>
              : <span className="rounded-md bg-amber-100 px-2 py-0.5 font-bold text-amber-800">Choose a replacement or skip</span>}
          </div>
          <div className="mt-1.5">
            <p className="text-sm font-black text-emerald-800 sm:text-base">{selected ? money(offerPrice(selected) * quantity) : skipped ? 'Not included' : 'Needs a choice'}</p>
            {selected && <p className="text-[11px] text-slate-500">{money(offerPrice(selected))} each · {storeName}</p>}
          </div>
        </div>
      </div>

      {!exact && original && !skipped && (
        <div className={`mt-3 flex min-w-0 items-center gap-3 rounded-xl border p-2.5 sm:p-3 ${activeId === String(original.id) ? 'border-emerald-300 bg-emerald-50/60' : 'border-blue-100 bg-blue-50/60'}`}>
          <ProductThumbnail offer={original} name={original.name} size="small" />
          <div className="min-w-0 flex-1">
            <p className="break-words text-xs font-bold text-slate-900 sm:text-sm">{original.name}</p>
            <p className="mt-0.5 text-xs font-bold text-slate-700">{money(offerPrice(original))} each</p>
            <p className="text-[11px] text-slate-500">Suggested retailer equivalent · confirm before using</p>
          </div>
          <button type="button" onClick={() => onSelect(original)} aria-pressed={activeId === String(original.id)}
            className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-bold text-white ${activeId === String(original.id) ? 'bg-emerald-700' : 'bg-blue-700 hover:bg-blue-800'}`}>
            {activeId === String(original.id) ? 'Selected' : 'Use'}
          </button>
        </div>
      )}

      {(!exact || skipped) && (
        <div className="mt-3 grid min-w-0 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap">
          <button type="button" onClick={onFind} disabled={finding}
            className="inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-center text-xs font-bold text-emerald-800 disabled:opacity-50">
            {finding ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <Search className="h-4 w-4 shrink-0" />}
            <span className="break-words">{finding ? 'Finding alternatives…' : `Find more at ${storeName}`}</span>
          </button>
          {!skipped && <button type="button" onClick={onSkip}
            className="inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-xs font-bold text-slate-700">
            <XCircle className="h-4 w-4 shrink-0" />Skip this product
          </button>}
        </div>
      )}
      {skipped && <p className="mt-2 text-xs text-slate-500">Not included in this order; your original saved basket remains unchanged.</p>}
      {searchError && <p className="mt-2 text-xs text-amber-800" role="status">{searchError}</p>}

      {suggestions?.length > 0 && (
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2" aria-label={`Suggested substitutes for ${item.name}`}>
          {suggestions.map((offer) => {
            const isSelected = activeId === String(offer.id);
            return <button key={String(offer.id)} type="button" onClick={() => onSelect(offer)}
              aria-pressed={isSelected}
              className={`flex min-w-0 items-center gap-3 rounded-xl border p-2.5 text-left transition-colors sm:p-3 ${isSelected ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-300' : 'border-slate-200 bg-white hover:border-emerald-400'}`}>
              <ProductThumbnail offer={offer} name={offer.name} size="small" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-xs font-bold leading-snug text-slate-900 sm:text-sm">{offer.name}</span>
                <span className="mt-1 block text-[11px] text-slate-500">Possible equivalent · confirm brand and size</span>
                <span className="mt-1 block text-xs font-black text-emerald-800">{money(offerPrice(offer))} each</span>
              </span>
              {isSelected && <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-700" />}
            </button>;
          })}
        </div>
      )}
    </div>
  );
}

function StoreAccordion({ store, highlighted, defaultOpen, itemCount, onChoose, user }) {
  const [open, setOpen] = useState(defaultOpen);
  const [choices, setChoices] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [finding, setFinding] = useState({});
  const [lookupErrors, setLookupErrors] = useState({});
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);

  const decisions = store.rows.map((row) => {
    const selected = choices[rowId(row)];
    const offer = selected?.kind === 'offer' ? selected.offer : selected ? null : row.exact ? row.offer : null;
    return { ...row, chosenOffer: offer, skipped: selected?.kind === 'skip', pending: !selected && !(row.exact && row.offer),
      subtotal: offer ? offerPrice(offer) * row.quantity : 0 };
  });
  const included = decisions.filter((row) => row.chosenOffer);
  const skipped = decisions.filter((row) => row.skipped).length;
  const pending = decisions.filter((row) => row.pending).length;
  const total = included.reduce((sum, row) => sum + row.subtotal, 0);
  const choose = (row, offer) => setChoices((old) => ({ ...old, [rowId(row)]: { kind: 'offer', offer } }));
  const skip = (row) => setChoices((old) => ({ ...old, [rowId(row)]: { kind: 'skip' } }));

  const findAlternatives = async (row) => {
    const key = rowId(row);
    if (finding[key]) return;
    setFinding((old) => ({ ...old, [key]: true }));
    setLookupErrors((old) => ({ ...old, [key]: '' }));
    try {
      const { data } = await axios.get('/api/search', { params: { q: row.item.name }, withCredentials: true, timeout: 20000 });
      const candidates = candidateOffers(data, row, store.name, user);
      setSuggestions((old) => ({ ...old, [key]: candidates }));
      if (!candidates.length) setLookupErrors((old) => ({ ...old, [key]: 'No compatible retailer suggestions found. You can skip this product and continue.' }));
    } catch {
      setLookupErrors((old) => ({ ...old, [key]: 'Suggestions are temporarily unavailable. You can still skip this product.' }));
    } finally { setFinding((old) => ({ ...old, [key]: false })); }
  };

  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-all ${highlighted ? 'border-2 border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200'}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
        className={`flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-emerald-50/30 sm:p-5 ${highlighted ? 'bg-emerald-50/50' : ''}`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${highlighted ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}><Store className="h-5 w-5" /></div>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-black text-slate-900 sm:text-lg">{store.name}</h3>{highlighted && <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase text-white">Best match</span>}</div>
            <p className="mt-0.5 text-xs text-slate-500">{store.found}/{itemCount} retailer matches · {store.exactFound} exact · {store.missing} unavailable</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3"><div className="text-right"><p className="text-lg font-black text-emerald-700 sm:text-xl">{included.length ? money(total) : 'No selected items'}</p><p className="text-[11px] font-bold text-slate-500">{pending ? `${pending} choice(s) needed` : skipped ? `${skipped} skipped · partial total` : 'Selected total'}</p></div>{open ? <ChevronUp className="h-5 w-5 text-slate-500"/> : <ChevronDown className="h-5 w-5 text-slate-500"/>}</div>
      </button>
      {open && <div className="divide-y divide-slate-100 border-t border-slate-100">
        {store.rows.map((row, index) => <ComparisonRow key={`${rowId(row)}-${index}`} row={row} storeName={store.name}
          current={choices[rowId(row)]} onSelect={(offer) => choose(row, offer)} onSkip={() => skip(row)}
          onFind={() => findAlternatives(row)} suggestions={suggestions[rowId(row)] || []} finding={Boolean(finding[rowId(row)])} searchError={lookupErrors[rowId(row)]} />)}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-4 sm:px-6">
          <div><p className="text-sm font-black text-slate-800">{skipped ? 'Subtotal (skipped items excluded)' : 'Selected basket total'}</p><p className="mt-1 text-xs text-slate-600">{included.length} selected · {skipped} skipped · {pending} awaiting a choice. Prices rechecked at checkout.</p></div>
          <p className="text-xl font-black text-emerald-700">{money(total)}</p>
        </div>
        <div className="border-t border-slate-100 bg-white px-4 py-4 sm:px-6">
          <button type="button" disabled={pending > 0 || included.length === 0}
            onClick={() => onChoose({ name: store.name, rows: included.map((row) => ({ ...row, offer: row.chosenOffer })) , skipped })}
            className="min-h-12 w-full break-words rounded-xl bg-emerald-700 px-3 py-3 text-sm font-black text-white hover:bg-emerald-800 sm:px-5 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
            {pending > 0 ? `Choose an equivalent or skip ${pending} item(s)` : included.length ? `Continue with ${included.length} item(s)${skipped ? ` · ${skipped} skipped` : ''} →` : 'Select at least one product to continue'}
          </button>
        </div>
      </div>}
    </section>
  );
}

export default function BasketComparisonPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState(() => getCart());
  const [offers, setOffers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [profile, setProfile] = useState(null);
  const [shoppingLocation, setLocalShoppingLocation] = useState(() => getShoppingLocation());

  const visible = useMemo(() => items.filter((item) => isVisibleProduct(item, user)), [items, user]);
  const basketKey = useMemo(() => visible.map((item) => `${item.id ?? item.name}:${item.name}:${item.quantity || 1}`).join('|'), [visible]);
  const report = useMemo(() => offers ? buildBasketComparison(visible, offers) : null, [visible, offers]);
  const bestFullShop = report?.winner || null;
  // Prefer the header map selection; fall back to the signed-in profile location.
  const nearbyLocation = useMemo(() => {
    if (shoppingLocation) return shoppingLocation;
    const lat = Number(profile?.latitude);
    const lng = Number(profile?.longitude);
    if (profile?.latitude == null || profile?.longitude == null ||
        !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { name: profile.location || 'Your saved shopping area', lat, lng,
      radius_km: Number(profile.radius_km) || 15 };
  }, [shoppingLocation, profile]);
  const shoppingLocationKey = shoppingLocation
    ? `${shoppingLocation.lat}:${shoppingLocation.lng}:${shoppingLocation.radius_km}` : 'profile';
  const leadingStore = bestFullShop || report?.stores.find((shop) => shop.found > 0) || null;

  useEffect(() => {
    const sync = () => setItems(getCart());
    window.addEventListener('smartbasket:cart-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('smartbasket:cart-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const syncLocation = (event) => {
      if (event?.type === 'storage' && event.key !== 'smartbasket:shopping-location') return;
      const current = getShoppingLocation();
      setLocalShoppingLocation(current);
      // A switch back to National view also clears the saved profile location.
      // Reload it so the nearby recommendation never shows the previous area.
      if (!current) setProfile(null);
      if (user?.id) {
        axios.get('/api/profile', { withCredentials: true })
          .then(({ data }) => { if (active) setProfile(data); })
          .catch(() => {});
      }
    };
    window.addEventListener(LOCATION_EVENT, syncLocation);
    window.addEventListener('storage', syncLocation);
    return () => {
      active = false;
      window.removeEventListener(LOCATION_EVENT, syncLocation);
      window.removeEventListener('storage', syncLocation);
    };
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user) {
      navigate('/login?next=%2Fbasket%2Fcompare', { replace: true });
      return undefined;
    }
    if (!visible.length) { setOffers(null); setLoading(false); return undefined; }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    setOffers(null);
    axios.post('/api/batch-compare', {
      queries: visible.map((item) => item.name),
    }, {
      withCredentials: true,
      signal: controller.signal,
      // The batch comparison and the nearby branch picker must use the same
      // selected shopping area. Flask checks these coordinates on the server.
      params: shoppingLocation ? {
        lat: shoppingLocation.lat,
        lng: shoppingLocation.lng,
        radius_km: shoppingLocation.radius_km,
      } : undefined,
    })
      .then(({ data }) => { if (!controller.signal.aborted) setOffers(data || {}); })
      .catch((err) => {
        if (controller.signal.aborted || axios.isCancel(err)) return;
        if (err?.response?.status === 401) {
          navigate('/login?next=%2Fbasket%2Fcompare', { replace: true });
          return;
        }
        setError(err?.response?.data?.error || 'The retailer comparison could not be loaded. Please try again.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user?.id, authLoading, basketKey, refreshKey, navigate, shoppingLocationKey]);

  useEffect(() => {
    if (!user) return undefined;
    const controller = new AbortController();
    axios.get('/api/profile', { withCredentials: true, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setProfile(data); })
      .catch(() => {});
    return () => controller.abort();
  }, [user?.id]);

  const orderedStores = useMemo(() => {
    if (!report) return [];
    if (!leadingStore) return report.stores;
    return [leadingStore, ...report.stores.filter((s) => s.name !== leadingStore.name)];
  }, [report, leadingStore]);

  const chooseStore = (store) => {
    if (!store.rows?.length) return;
    // A quote must be verified from retailer-owned product IDs by the backend.
    // Never send scraper/browser-submitted price amounts to the order API.
    const missingIds = store.rows.some((row) => !String(row.offer?.id || (row.exact ? row.item?.id : '') || '').trim());
    if (missingIds) {
      setError('One selected substitute has no valid retailer product ID. Choose a different offer or skip it.');
      return;
    }
    const selection = { retailer: store.name,
      skippedCount: store.skipped || 0,
      items: store.rows.map((row) => ({
        id: String(row.offer?.id || row.item?.id),
        name: row.offer?.name || row.item?.name,
        quantity: row.quantity,
        price: Number(row.offer?.price),
        store: store.name,
        imageUrl: offerImage(row.offer) || ''
      }))
    };
    sessionStorage.setItem('smartbasket:checkout-retailer', JSON.stringify(selection));
    navigate('/checkout');
  };

  return (
    <main className="min-h-screen bg-[#F8FAF8] px-4 py-6 sm:px-6 sm:py-9">
      <div className="mx-auto max-w-5xl space-y-6">
        <button type="button" onClick={() => navigate('/basket')} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-emerald-700">
          <ArrowLeft className="h-4 w-4" /> Back to shopping basket
        </button>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-emerald-700">SmartBasket · Retailer comparison</span>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Best shop for your list</h1>
            <p className="mt-2 text-sm text-slate-500">Compare all four supermarkets. Approve suggested equivalents or skip unavailable items here, without returning to search. Only your selected items go to checkout.</p>
          </div>
          <Button variant="outline" disabled={loading || !visible.length} onClick={() => setRefreshKey((v) => v + 1)} className="rounded-xl border-slate-200 bg-white font-bold">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh prices
          </Button>
        </div>

        {nearbyLocation && (
          <p className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-slate-600">
            <MapPin className="h-4 w-4 text-emerald-700" /> Checking nearby retailer chains around {nearbyLocation.name || 'your selected area'} ({nearbyLocation.radius_km || 15} km)
          </p>
        )}

        {loading && <section role="status" className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
          <p className="mt-3 text-sm font-bold text-slate-600">Comparing the prices for your basket...</p>
        </section>}
        {error && <section role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-800">
          {error} <button type="button" onClick={() => setRefreshKey((n) => n + 1)} className="ml-2 underline">Try again</button>
        </section>}
        {!loading && !visible.length && <section className="rounded-2xl border bg-white p-10 text-center">
          <ShoppingBasket className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-3 text-lg font-extrabold text-slate-900">Your basket is empty</h2>
          <Button className="mt-4 rounded-xl bg-emerald-700" onClick={() => navigate('/search')}>Browse products</Button>
        </section>}

        {report && (
          <>
            {bestFullShop ? (
              <section className="rounded-3xl border-2 border-emerald-500 bg-gradient-to-br from-emerald-100 to-white p-6 shadow-sm sm:p-8">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-800">
                  <CheckCircle2 className="h-5 w-5" /> Lowest total price for your complete basket
                </div>
                <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-black text-emerald-950">{bestFullShop.name}</h2>
                    <p className="mt-2 text-sm font-semibold text-emerald-800">
                      {bestFullShop.found}/{report.itemCount} items available · {bestFullShop.hasEquivalents ? 'Includes clearly labelled store equivalents' : 'Exact product matches'}
                    </p>
                  </div>
                  <p className="text-4xl font-black tracking-tight text-emerald-800">{money(bestFullShop.total)}</p>
                </div>
                <p className="mt-4 text-xs text-emerald-900">The highlighted store and its product-by-product prices are displayed first below.</p>
              </section>
            ) : leadingStore ? (
              <section className="rounded-3xl border border-amber-300 bg-amber-50 p-6 sm:p-8">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-800">
                  <AlertTriangle className="h-5 w-5" /> No shop covers your entire basket
                </div>
                <h2 className="mt-3 text-2xl font-black text-slate-900">Most products found: {leadingStore.name}</h2>
                <p className="mt-2 text-sm text-amber-900">
                  {leadingStore.found}/{report.itemCount} products matched · {money(leadingStore.total)} is a <strong>partial subtotal</strong>, not the full basket price.
                </p>
                <p className="mt-2 text-xs text-amber-800">The store with the most matched items is highlighted below. Expand other stores to compare their individual products.</p>
              </section>
            ) : (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-900">
                No matching offers were found for this basket. If you've selected a shopping area, try increasing the search radius or switching to National view.
              </section>
            )}

            {!!orderedStores.length && <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-black text-slate-900">Retailer price breakdown</h2>
                <span className="text-xs font-semibold text-slate-500">All four shops · tap to expand</span>
              </div>
              {orderedStores.map((store, index) => <StoreAccordion
                key={`${store.name}-${refreshKey}-${basketKey}`}
                user={user}
                store={store}
                highlighted={Boolean(bestFullShop && store.name === bestFullShop.name)}
                defaultOpen={index === 0}
                itemCount={report.itemCount}
                onChoose={chooseStore}
              />)}
            </section>}

            {/* Keep the main retailer accordions above the nearby location-based recommendation. */}
            <NearbyBasketSection report={report} location={nearbyLocation} />

            {report.splitCovered > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center gap-2"><Tag className="h-5 w-5 text-emerald-700" /><h2 className="text-base font-black text-slate-900">Shopping at multiple stores</h2></div>
              <p className="mt-1 text-xs text-slate-500">Optional: individual lowest prices if you're willing to visit more than one store. This is not a single-shop quote.</p>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-xl bg-slate-50 p-4">
                <span className="text-sm font-bold text-slate-700">{report.splitCovered}/{report.itemCount} products found</span>
                <strong className="text-xl font-black text-emerald-700">{money(report.splitTotal)}{report.splitCovered < report.itemCount ? ' (partial)' : ''}</strong>
              </div>
            </section>}
            <p className="text-xs leading-relaxed text-slate-500">Prices may change at the retailer. Offers are scraped at retailer-chain level; a nearby branch may not stock the same products.</p>
          </>
        )}

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => navigate('/basket')} className="rounded-xl"><ArrowLeft className="mr-2 h-4 w-4" /> Edit my basket</Button>
          <Button onClick={() => navigate('/search')} className="rounded-xl bg-emerald-700 hover:bg-emerald-800">Continue shopping <ArrowRight className="ml-2 h-4 w-4" /></Button>
        </div>
      </div>
    </main>
  );
}