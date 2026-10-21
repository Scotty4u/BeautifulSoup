import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, ArrowRight, Search, Store as StoreIcon, ShoppingCart, ArrowUpDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { addToCart } from '../utils/cart';
import { useToast } from '../context/ToastContext';
import { isVisibleProduct } from '../utils/ProductVisibility';
import { retailerBySlug, storeSlugFor } from '../utils/retailers';
import { normalizeCatalogCategory, ALL_CATEGORIES } from '../components/CategoryStrip';

const PAGE_SIZE = 24;
const FALLBACK_IMAGE = 'https://placehold.co/280x280/f8fafc/94a3b8?text=No+Image';

const money = (item) => {
  const value = Number(item?.price);
  return Number.isFinite(value) && value > 0 ? `R ${value.toFixed(2)}` : 'Price unavailable';
};

export default function StoreProductsPage() {
  const { storeSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const category = normalizeCatalogCategory(searchParams.get('category'));
  const [priceCap, setPriceCap] = useState('any');
  const retailer = retailerBySlug(storeSlug);
  const { user } = useAuth();
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('latest');
  const [catalog, setCatalog] = useState({ products: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveMode, setLiveMode] = useState(false);

  useEffect(() => {
    setPage(1);
    setSearch('');
    setQueryInput('');
    setLiveMode(false);
  }, [storeSlug]);

  useEffect(() => { setPage(1); }, [category]);

  useEffect(() => {
    if (!retailer) { setLoading(false); return undefined; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const isLiveBrowse = liveMode && (search || category);
    const request = isLiveBrowse
      ? axios.get('/api/search', { params: { q: search || 'all', category: category || undefined, store: retailer.query }, signal: controller.signal, withCredentials: true })
      : axios.get(`/api/stores/${retailer.slug}/products`, { params: { page, page_size: PAGE_SIZE, sort, q: search, category: category || undefined, max_price: priceCap === 'any' ? undefined : priceCap }, signal: controller.signal, withCredentials: true });
    request.then(async ({ data }) => {
      if (controller.signal.aborted) return;
      if (isLiveBrowse) {
        const visible = (Array.isArray(data) ? data : []).filter((item) => storeSlugFor(item?.store) === retailer.slug && isVisibleProduct(item, user) && (priceCap === 'any' || Number(item.price) <= Number(priceCap)));
        setCatalog({ products: visible, total: visible.length, pages: 1 });
      } else if (category && !search && page === 1 && !data?.total) {
        // Older SmartBasket installations may not have indexed Pharmacy or
        // Electronics yet. Try the existing live scraper instead of leaving an
        // empty category page. The API still enforces age/clothing restrictions.
        try {
          const fresh = await axios.get('/api/search', {
            params: { q: 'all', category, store: retailer.query },
            signal: controller.signal, withCredentials: true,
          });
          if (controller.signal.aborted) return;
          const visible = (Array.isArray(fresh.data) ? fresh.data : [])
            .filter((item) => storeSlugFor(item?.store) === retailer.slug && isVisibleProduct(item, user) && (priceCap === 'any' || Number(item.price) <= Number(priceCap)));
          setCatalog({ products: visible, total: visible.length, pages: 1 });
        } catch (fallbackError) {
          if (controller.signal.aborted || axios.isCancel(fallbackError)) return;
          setCatalog(data);
        }
      } else {
        setCatalog(data);
      }
    }).catch((err) => {
      if (controller.signal.aborted || axios.isCancel(err)) return;
      setError(err.response?.data?.error || 'Could not load this retailer’s catalogue. Please check the backend connection.');
      setCatalog({ products: [], total: 0, pages: 1 });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [storeSlug, retailer?.slug, page, sort, search, liveMode, category, priceCap, user?.id, user?.age_group, user?.is_admin]);

  const products = useMemo(() => (Array.isArray(catalog.products) ? catalog.products : [])
    .filter((item) => storeSlugFor(item.store) === retailer?.slug && isVisibleProduct(item, user)), [catalog, retailer?.slug, user]);

  const submitSearch = (event) => {
    event.preventDefault();
    setPage(1);
    setSearch(queryInput.trim());
    setLiveMode(Boolean(queryInput.trim()));
  };
  const showCatalog = () => { setSearch(''); setQueryInput(''); setPage(1); setLiveMode(false); };
  const clearFilters = () => { setSearch(''); setQueryInput(''); setPage(1); setPriceCap('any'); setLiveMode(false); setSearchParams(new URLSearchParams(), { replace: true }); };
  const addProduct = (item) => {
    addToCart(item);
    showToast(`Added ${item.name} to basket!`);
  };

  if (!retailer) return (
    <div className="mx-auto max-w-2xl px-5 py-24 text-center">
      <StoreIcon className="mx-auto h-12 w-12 text-slate-400" />
      <h1 className="mt-4 text-2xl font-black">Retailer not found</h1>
      <p className="mt-2 text-sm text-slate-500">SmartBasket currently supports four supermarket chains.</p>
      <Link to="/" className="mt-5 inline-block font-bold text-emerald-700">Back to home</Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F4F7F4] pb-16">
      <div className="border-b border-emerald-100 bg-gradient-to-br from-[#e4f4e7] to-[#f3faf4]">
        <div className="mx-auto max-w-7xl px-4 pb-9 pt-7 sm:px-6 sm:pt-10">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-800 hover:text-emerald-950"><ArrowLeft className="h-4 w-4" /> Back to SmartBasket</Link>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-700 text-white shadow-sm"><StoreIcon className="h-8 w-8" /></div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.15em] text-emerald-700">Browse by retailer</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">{retailer.name}</h1>
                <p className="mt-1 text-sm text-slate-600">Explore products available in your SmartBasket catalogue.</p>
              </div>
            </div>
            <span className="w-fit rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-bold text-emerald-800">Supported supermarket</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 pt-7 sm:px-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-[#DCE9DE] bg-white p-4 shadow-sm md:flex-row md:items-end md:justify-between md:p-5">
          <form onSubmit={submitSearch} className="min-w-0 flex-1">
            <label htmlFor="store-search" className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-600">Search only {retailer.name}</label>
            <div className="flex gap-2">
              <input id="store-search" type="search" value={queryInput} onChange={(e) => setQueryInput(e.target.value)}
                placeholder={`e.g. milk, rice, chocolate...`} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800"><Search className="h-4 w-4" /> Search</button>
            </div>
          </form>
          <div className="flex items-end gap-3">
            {liveMode && <button type="button" onClick={showCatalog} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">All available items</button>}
            {!liveMode && (
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><ArrowUpDown className="h-4 w-4" /> Sort
                <select value={sort} onChange={(e) => { setPage(1); setSort(e.target.value); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
                  <option value="latest">Recently available</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                  <option value="name">Name: A to Z</option>
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#DCE9DE] bg-white p-4 shadow-sm">
          <div className="min-w-[150px] flex-1 sm:max-w-[250px]">
            <label htmlFor="store-category" className="mb-1 block text-xs font-bold text-slate-600">Category</label>
            <select id="store-category" value={category || 'all'}
              onChange={(event) => { setPage(1); const next = new URLSearchParams(searchParams); if (event.target.value === 'all') next.delete('category'); else next.set('category', event.target.value.toLowerCase()); setSearchParams(next); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
              <option value="all">All categories</option>
              {ALL_CATEGORIES.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </div>
          <div className="min-w-[145px] flex-1 sm:max-w-[215px]">
            <label htmlFor="store-price" className="mb-1 block text-xs font-bold text-slate-600">Maximum price</label>
            <select id="store-price" value={priceCap} onChange={(event) => { setPage(1); setPriceCap(event.target.value); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
              <option value="any">Any price</option>
              <option value="50">Under R50</option>
              <option value="100">Under R100</option>
              <option value="250">Under R250</option>
              <option value="500">Under R500</option>
              <option value="1000">Under R1,000</option>
              <option value="5000">Under R5,000</option>
              <option value="15000">Under R15,000</option>
            </select>
          </div>
          <button type="button" onClick={clearFilters} className="min-h-10 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Clear filters</button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-black text-slate-900">{liveMode ? `Search results for “${search || category || 'all'}”` : category ? `${category} products` : 'Products'}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {loading ? 'Loading...' : `${catalog.total || 0} product${catalog.total === 1 ? '' : 's'} found`}
              {liveMode ? ' · Live retailer search' : ' · SmartBasket catalogue'}
            </p>
          </div>
          <Link to="/basket" className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50"><ShoppingCart className="h-4 w-4" /> View basket</Link>
        </div>

        {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error}</div>}
        {loading ? <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-white" />)}</div> : (
          products.length ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {products.map((item) => (
                <div key={item.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-emerald-300 hover:shadow-md sm:p-4">
                  <Link to={`/product/${encodeURIComponent(item.id)}`} state={{ product: item }} className="flex h-40 items-center justify-center rounded-xl bg-[#F4F7F4] p-3 sm:h-48">
                    <img loading="lazy" src={item.imageUrl || FALLBACK_IMAGE} alt={item.name} onError={(e) => { if (e.currentTarget.src !== FALLBACK_IMAGE) e.currentTarget.src = FALLBACK_IMAGE; }} className="max-h-full max-w-full object-contain" />
                  </Link>
                  <div className="mt-4 flex flex-1 flex-col">
                    <span className="mb-2 w-fit rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-800">{retailer.name}</span>
                    <Link to={`/product/${encodeURIComponent(item.id)}`} state={{ product: item }} className="line-clamp-2 text-sm font-bold text-slate-900 hover:text-emerald-700">{item.name}</Link>
                    <div className="mt-auto pt-4">
                      <p className="mb-3 text-lg font-black text-emerald-800">{money(item)}</p>
                      <div className="flex gap-2">
                        <Link to={`/product/${encodeURIComponent(item.id)}`} state={{ product: item }} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-200 px-2 py-2 text-xs font-extrabold text-emerald-700 hover:bg-emerald-50">View <ArrowRight className="h-3.5 w-3.5" /></Link>
                        <button type="button" onClick={() => addProduct(item)} aria-label={`Add ${item.name} to basket`} className="rounded-xl bg-emerald-700 px-3 text-white hover:bg-emerald-800"><ShoppingCart className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
              <StoreIcon className="mx-auto h-9 w-9 text-emerald-600" />
              <h2 className="mt-3 text-lg font-black text-slate-900">{liveMode ? 'No products found for those filters' : 'No products for those filters yet'}</h2>
              <p className="mt-2 text-sm text-slate-500">{liveMode ? 'Try another product name or clear a filter.' : category === 'Liquor' && !(user?.age_group === 'adult' || user?.is_admin) ? 'Age-restricted products are available only to verified adult accounts.' : 'Try clearing filters or searching this retailer for a specific product. The catalogue contains products SmartBasket has indexed so far.'}</p>
            </div>
          )
        )}

        {!liveMode && !loading && Number(catalog.pages) > 1 && (
          <div className="flex items-center justify-center gap-4 pt-3">
            <button type="button" disabled={page <= 1} onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold disabled:opacity-40">Previous</button>
            <span className="text-xs font-bold text-slate-600">Page {page} of {catalog.pages}</span>
            <button type="button" disabled={page >= catalog.pages} onClick={() => { setPage((p) => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Next</button>
          </div>
        )}
        <p className="text-xs leading-5 text-slate-500">The default listing contains products already available by SmartBasket, not the retailer’s entire live inventory. Search queries request fresh results from that retailer. Prices are retailer-wide and may differ at nearby branches. Clothing is excluded and age-restricted products are hidden from guests and users without a recorded adult birth date.</p>
      </div>
    </div>
  );
}