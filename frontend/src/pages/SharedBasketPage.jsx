import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Copy,
  LockKeyhole,
  Package,
  RefreshCw,
  Share2,
  ShieldCheck,
  ShoppingBasket,
  Users,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { isVisibleProduct } from '../utils/ProductVisibility';
import {
  BasketEmpty,
  BasketItemRow,
  BasketLoading,
  BasketSummaryCard,
} from '../components/BasketPresentation';
import BasketActivityFeed from '../components/BasketActivityFeed';

const price = (value) =>
  `R ${Number(value).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const quantity = (item) => Math.max(1, Math.floor(Number(item?.quantity) || 1));
const hasPrice = (item) => Number.isFinite(Number(item?.price)) && Number(item.price) > 0;

function accessError(status) {
  if (status === 401) return 'This list is private. Sign in if you were invited.';
  if (status === 403) return 'Only the owner and accepted collaborators can see this private list.';
  if (status === 404) return 'This link is unavailable, expired, or the list was removed.';
  return 'We couldn’t load this list right now. Please try again.';
}

export default function SharedBasketPage() {
  const { token } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [basket, setBasket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let requestInProgress = false;
    setBasket(null);
    setLoading(true);
    setError('');
    setRefreshError(false);

    const fetchBasket = async (initial = false) => {
      if (controller.signal.aborted || requestInProgress) return;
      requestInProgress = true;

      try {
        const { data } = await axios.get(
          `/api/shared/basket/${encodeURIComponent(token || '')}`,
          { withCredentials: true, signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setBasket(data);
        setError('');
        setRefreshError(false);
      } catch (err) {
        if (controller.signal.aborted || axios.isCancel(err)) return;
        const status = err?.response?.status;
        if ([401, 403, 404].includes(status)) {
          // Hide previously loaded details if the owner revokes permission.
          setBasket(null);
          setError(accessError(status));
        } else if (initial) {
          setError(accessError(status));
        } else {
          // A temporary connectivity error shouldn't erase a loaded list.
          setRefreshError(true);
        }
      } finally {
        requestInProgress = false;
        if (initial && !controller.signal.aborted) setLoading(false);
      }
    };

    fetchBasket(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchBasket();
    }, 20000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [token, retry]);

  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const items = useMemo(
    () => (Array.isArray(basket?.items) ? basket.items : []).filter((item) => isVisibleProduct(item, user)),
    [basket, user],
  );
  const totalUnits = items.reduce((count, item) => count + quantity(item), 0);
  const missingPrices = items.some((item) => !hasPrice(item));
  const estimatedTotal = items.reduce(
    (total, item) => total + (hasPrice(item) ? Number(item.price) * quantity(item) : 0),
    0,
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      showToast('Basket link copied.');
    } catch {
      showToast('Could not copy the link. Please copy it from your address bar.', 'error');
    }
  };

  const share = async () => {
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: basket?.name || 'SmartBasket list',
        url: window.location.href,
      });
    } catch (err) {
      if (err?.name !== 'AbortError') await copyLink();
    }
  };

  if (loading) return <BasketLoading />;

  if (error || !basket) {
    return (
      <main className="flex min-h-[65vh] items-center justify-center bg-[#F8FAF8] px-4 py-12 sm:py-16">
        <section className="w-full max-w-lg rounded-3xl border border-[#E0E8E1] bg-white px-5 py-9 text-center shadow-sm sm:px-9">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <LockKeyhole className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-black tracking-tight text-slate-900">Shared list unavailable</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
            {error || 'This shared list can’t be opened.'}
          </p>
          <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {!user && (
              <Link
                to={`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#047857] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-emerald-800"
              >
                Sign in if invited <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#E0E8E1] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
            </button>
            <Link
              to={user ? '/collaborative' : '/'}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#E0E8E1] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8FAF8] pb-14 text-slate-900 sm:pb-20">
      <div className="mx-auto max-w-6xl space-y-5 px-3 py-5 min-[380px]:px-4 sm:space-y-6 sm:px-6 sm:py-8">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to={user ? '/collaborative' : '/'}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-bold text-slate-600 transition hover:text-[#047857]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {user ? 'Back to my lists' : 'Back to SmartBasket'}
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D9EADD] bg-white px-3 py-1.5 text-[11px] font-extrabold text-[#047857] sm:text-xs">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Preview only
          </span>
        </nav>

        <header className="overflow-hidden rounded-3xl border border-[#D9EADD] bg-white shadow-sm">
          <div className="h-1.5 bg-[#059669]" aria-hidden="true" />
          <div className="p-4 min-[380px]:p-5 sm:p-7 lg:p-8">
            <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-extrabold text-[#047857] sm:text-xs">
                    {basket.is_public ? <Share2 className="h-3.5 w-3.5" aria-hidden="true" /> : <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />}
                    {basket.is_public ? 'Public shared list' : 'Private shared list'}
                  </span>
                </div>
                <h1 className="mt-3 break-words text-2xl font-black leading-tight tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
                  {basket.name || 'Shared grocery list'}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  A grocery list shared by <strong className="font-extrabold text-slate-900">{basket.owner || 'a SmartBasket member'}</strong>.
                  {' '}Explore the products without changing their list.
                </p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-[#059669]" aria-hidden="true" />
                    {basket.owner || 'SmartBasket member'}
                  </span>
                  {basket.date && (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4 text-[#059669]" aria-hidden="true" /> {basket.date}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 lg:w-auto lg:shrink-0">
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-[#CFE6D5] bg-white px-3 py-2.5 text-sm font-extrabold text-[#047857] transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 sm:px-4"
                >
                  {copied ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={share}
                  className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl bg-[#047857] px-3 py-2.5 text-sm font-extrabold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 sm:px-4"
                >
                  <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Share list
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 border-t border-[#E0E8E1] pt-5 sm:mt-6 sm:grid-cols-3 sm:gap-3 sm:pt-6">
              <div className="rounded-2xl bg-[#F4F7F4] px-4 py-3 sm:px-5 sm:py-4">
                <p className="text-xs font-bold text-slate-500">Products</p>
                <p className="mt-1 text-xl font-black text-slate-900 sm:text-2xl">{items.length}</p>
              </div>
              <div className="rounded-2xl bg-[#F4F7F4] px-4 py-3 sm:px-5 sm:py-4">
                <p className="text-xs font-bold text-slate-500">Total units</p>
                <p className="mt-1 text-xl font-black text-slate-900 sm:text-2xl">{totalUnits}</p>
              </div>
              <div className="col-span-2 rounded-2xl bg-emerald-50 px-4 py-3 sm:col-span-1 sm:px-5 sm:py-4">
                <p className="text-xs font-bold text-emerald-800">Estimated list value</p>
                <p className="mt-1 break-words text-xl font-black text-[#047857] sm:text-2xl">{price(estimatedTotal)}</p>
                {missingPrices && <p className="mt-1 text-[11px] text-amber-800">Items without prices excluded</p>}
              </div>
            </div>
          </div>
        </header>

        {refreshError && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
            <span>We couldn’t refresh this list. Showing the last loaded version.</span>
            <button type="button" onClick={() => setRetry((value) => value + 1)} className="inline-flex items-center gap-1.5 font-extrabold underline underline-offset-2">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
          <section aria-labelledby="shared-items-title" className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2 px-1 pb-1">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-[#047857]">Basket contents</p>
                <h2 id="shared-items-title" className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Products in this list</h2>
              </div>
              <span className="text-xs font-bold text-slate-500">{items.length} {items.length === 1 ? 'product' : 'products'}</span>
            </div>
            {items.length ? (
              <div className="space-y-3">
                {items.map((item, index) => (
                  <BasketItemRow key={item.id || index} item={item} />
                ))}
              </div>
            ) : (
              <BasketEmpty title="No visible products" description="This list has no products available to your account." />
            )}
            <BasketActivityFeed shared activities={basket.activities || []} />
          </section>

          <div className="min-w-0 space-y-4 lg:sticky lg:top-24">
            <BasketSummaryCard items={items} caption="Estimated saved-price total">
              <Link
                to="/search"
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#047857] px-4 py-3 text-sm font-extrabold text-white transition hover:bg-emerald-800"
              >
                <ShoppingBasket className="h-4 w-4" aria-hidden="true" /> Browse groceries
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Saved prices are estimates. Retailer prices and availability may change.
              </p>
            </BasketSummaryCard>

            <aside className="rounded-3xl border border-[#E0E8E1] bg-white p-5 shadow-sm sm:p-6" aria-label="Sharing and privacy information">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#047857]">
                  <LockKeyhole className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="text-base font-black text-slate-900">Sharing & privacy</h3>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                {basket.is_public
                  ? 'Anyone with the link can view this list. Only authorised members can make changes.'
                  : 'This list is private. Only the owner and accepted collaborators can view it.'}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                To collaborate, ask the owner for an invitation. Having a link doesn’t grant editing access.
              </p>
              {user && (
                <Link to="/collaborative" className="mt-4 inline-flex min-h-9 items-center gap-1.5 text-sm font-extrabold text-[#047857] hover:underline">
                  My collaborative lists <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
