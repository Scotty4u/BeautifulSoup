import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { isVisibleProduct } from '../utils/ProductVisibility';
import { useToast } from '../context/ToastContext';
import { storeSlugFor } from '../utils/retailers';
import { addToCart } from '../utils/cart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import PriceHistoryChart from '../components/PriceHistoryChart';
import PriceWatchControl from '../components/PriceWatchControl';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, ArrowRight, Check, ChevronRight, ExternalLink, Package, ShoppingCart, Star, TrendingDown } from 'lucide-react';

import picknpayLogo from '../assets/imgs/picknpay.png';
import shopriteLogo from '../assets/imgs/shoprite.png';
import checkersLogo from '../assets/imgs/checkers.png';
import woolworthsLogo from '../assets/imgs/woolworths.png';

const FALLBACK_IMAGE = 'https://placehold.co/500x500/f8fafc/94a3b8?text=No+Image';
const STORE_INFO = {
  'Pick n Pay': { logo: picknpayLogo },
  Shoprite: { logo: shopriteLogo },
  Checkers: { logo: checkersLogo },
  Woolworths: { logo: woolworthsLogo },
};

const priceValue = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
// Only a real product page supplied by that retailer gets a direct store link.
const RETAILER_HOSTS = {
  'Pick n Pay': 'pnp.co.za',
  Shoprite: 'shoprite.co.za',
  Checkers: 'checkers.co.za',
  Woolworths: 'woolworths.co.za',
};
const safeProductUrl = (item) => {
  const host = RETAILER_HOSTS[item?.store];
  if (!host || !item?.productUrl) return null;
  try {
    const url = new URL(item.productUrl);
    if (url.protocol !== 'https:' || !(url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    if (!['/p/', '/product/', '/products/', '/prod/', '/pdp/'].some((part) => url.pathname.toLowerCase().includes(part))) return null;
    return url.href;
  } catch { return null; }
};
const money = (item) => {
  const value = priceValue(item?.price);
  return item?.formattedPrice || (value !== null ? `R ${value.toFixed(2)}` : 'Price unavailable');
};

function ProductImage({ item, className = '' }) {
  return (
    <img
      src={item?.imageUrl || FALLBACK_IMAGE}
      alt={item?.name || 'Product image'}
      loading="lazy"
      onError={(e) => { if (e.currentTarget.src !== FALLBACK_IMAGE) e.currentTarget.src = FALLBACK_IMAGE; }}
      className={`max-h-full max-w-full object-contain ${className}`}
    />
  );
}

function StoreLabel({ store, large = false }) {
  const info = STORE_INFO[store];
  const slug = storeSlugFor(store);
  const styles = `inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-white font-bold text-emerald-800 shadow-sm ${large ? 'px-3 py-2 text-base sm:text-lg' : 'px-2.5 py-1 text-xs'}`;
  const content = (
    <>
      {info?.logo && <img src={info.logo} alt="" className={`${large ? 'h-7 w-7' : 'h-5 w-5'} object-contain`} />}
      <span className="truncate">{store || 'Retailer'}</span>
      {slug && <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    </>
  );
  if (!slug) return <span className={styles}>{content}</span>;
  return (
    <Link
      to={`/store/${slug}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className={`${styles} relative z-10 transition-colors hover:border-emerald-500 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600`}
      title={`Browse all indexed ${store} products`}
      aria-label={`Browse products from ${store}`}
    >
      {content}
    </Link>
  );
}

function StarRating({ rating, large = false }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${Number(rating) || 0} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((number) => (
        <Star
          key={number}
          aria-hidden="true"
          className={`${large ? 'h-5 w-5' : 'h-4 w-4'} ${number <= Number(rating) ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`}
        />
      ))}
    </div>
  );
}

export default function ProductPage() {
  const params = useParams();
  const productId = String(params.productId || params.id || params.sku || '');
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, loading: authLoading } = useAuth();

  // The URL retains the original retailer's product ID; compare is a separate
  // URL/view of that same product, so the browser's Back button works naturally.
  const isCompareView = new URLSearchParams(location.search).get('view') === 'compare';
  const routeProduct = String(location.state?.product?.id || '') === productId && isVisibleProduct(location.state.product, user) ? location.state.product : null;
  const [product, setProduct] = useState(routeProduct);
  const [comparison, setComparison] = useState(location.state?.comparison || null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [loading, setLoading] = useState(!routeProduct);
  const [reviews, setReviews] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [newRating, setNewRating] = useState('5');
  const [submitting, setSubmitting] = useState(false);
  const [productError, setProductError] = useState('');
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const [compareNonce, setCompareNonce] = useState(0);
  const comparisonRequestId = useRef('');

  useEffect(() => {
    let active = true;
    const selected = String(location.state?.product?.id || '') === productId && isVisibleProduct(location.state.product, user) ? location.state.product : null;
    setProduct(selected);
    setLoading(!selected);
    setProductError('');
    setComparison(location.state?.comparison && selected ? location.state.comparison : null);
    comparisonRequestId.current = '';
    setReviews([]);
    setRelatedProducts([]);
    setNewComment('');
    setNewRating('5');
    window.scrollTo({ top: 0 });

    if (!selected) {
      // Critical: Look up the selected retailer ID, NEVER the cheapest text match.
      axios.get(`/api/products/${encodeURIComponent(productId)}`)
        .then(({ data }) => { if (active && String(data?.id) === productId && isVisibleProduct(data, user)) setProduct(data); })
        .catch((error) => {
          if (!active) return;
          setProduct(null);
          setProductError(error?.response?.status === 404
            ? 'This exact retailer listing is unavailable or has not been indexed yet. Please return to search and open the product again.'
            : 'Could not load this product. Check your backend connection and retry.');
        })
        .finally(() => { if (active) setLoading(false); });
    }

    axios.get('/api/popular')
      .then(({ data }) => {
        if (active) setRelatedProducts((Array.isArray(data) ? data : [])
          .filter((p) => p.id && String(p.id) !== String(productId) && isVisibleProduct(p, user)).slice(0, 4));
      }).catch(() => {});

    axios.get(`/api/reviews/${encodeURIComponent(productId || '')}`)
      .then(({ data }) => { if (active) setReviews(Array.isArray(data) ? data : []); })
      .catch(() => {});

    return () => { active = false; };
  }, [productId, user?.id, user?.age_group, user?.is_admin]);

  useEffect(() => {
    // Keep the clicked product instantly visible while comparison runs in the
    // background. Logged-in users see the winning price/cards directly below
    // the product, without needing a second navigation step.
    // Individual comparisons are public; basket-wide comparison requires login.
    if (authLoading || !product?.name || String(product.id) !== productId) return;
    const requestId = `${productId}:${product.name}:${product.barcode || ''}`;
    if (comparisonRequestId.current === requestId && comparison) return;
    const controller = new AbortController();
    comparisonRequestId.current = requestId;
    setComparisonLoading(true);
    setComparisonError('');
    axios.get('/api/compare', {
      params: {
        q: product.name, mode: 'mixed', product_id: product.id,
        ...(product.barcode ? { barcode: product.barcode } : {}),
      },
      signal: controller.signal,
    }).then(({ data }) => { setComparison(data); })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setComparisonError(error?.response?.status === 401 ? 'Sign in to compare prices.' : 'The retailer comparison could not be loaded. You can retry without losing this product.');
        comparisonRequestId.current = '';
      })
      .finally(() => { if (!controller.signal.aborted) setComparisonLoading(false); });
    return () => controller.abort();
  }, [productId, product?.name, product?.barcode, isCompareView, compareNonce, user]);

  const offers = Array.isArray(comparison?.products) ? comparison.products.filter((item) => isVisibleProduct(item, user)) : [];
  // One winner: the cheapest VERIFIED EXACT item, with a clearly labelled
  // store-equivalent fallback only when no exact item is available. Never
  // compare 1L with 2L or treat another flavour as the same SKU here.
  const eligibleOffers = offers.filter((p) => {
    const price = priceValue(p.price);
    return price !== null && price > 0 && Number.isFinite(price);
  });
  const exactOffers = eligibleOffers.filter((p) => p.matchType !== 'equivalent');
  const winningPool = exactOffers.length ? exactOffers : eligibleOffers;
  const cheapestOffer = winningPool.reduce((best, offer) => {
    if (!best) return offer;
    const difference = priceValue(offer.price) - priceValue(best.price);
    return difference < 0 || (difference === 0 && String(offer.id) < String(best.id)) ? offer : best;
  }, null);
  // The price, retailer badge and primary basket action share one offer.
  const displayedOffer = cheapestOffer || product;
  const showingDifferentOffer = Boolean(cheapestOffer && product && String(cheapestOffer.id) !== String(product.id));
  const lowestPrice = cheapestOffer ? priceValue(cheapestOffer.price) : null;
  const lowestEquivalent = eligibleOffers
    .filter((p) => p.matchType === 'equivalent')
    .reduce((best, offer) => (!best || priceValue(offer.price) < priceValue(best.price) ? offer : best), null);
  const cheaperAlternative = exactOffers.length && lowestEquivalent && cheapestOffer
    && priceValue(lowestEquivalent.price) < priceValue(cheapestOffer.price)
    ? lowestEquivalent : null;

  const comparePath = `/product/${encodeURIComponent(productId || '')}?view=compare`;
  const showComparison = () => {
    if (!product) return;
    navigate(comparePath, { state: { product, comparison } });
  };
  const retryProduct = () => { window.location.reload(); };
  const retryComparison = () => {
    comparisonRequestId.current = '';
    setComparison(null);
    setComparisonError('');
    // Retry in-place, preserving the current product and comparison route.
    setCompareNonce((previous) => previous + 1);
  };
  const backToPrevious = () => {
    const returnTo = location.state?.returnTo;
    if (!isCompareView && typeof returnTo === 'string' && /^\/product\/[^?#]+\?view=compare$/.test(returnTo)) {
      if ((window.history.state?.idx || 0) > 0) navigate(-1);
      else navigate(returnTo, { state: { product: location.state?.compareOrigin, comparison: location.state?.compareSnapshot } });
    } else if (isCompareView) {
      if ((window.history.state?.idx || 0) > 0) navigate(-1);
      else navigate(`/product/${encodeURIComponent(productId || '')}`, { state: { product } });
    } else if ((window.history.state?.idx || 0) > 0) {
      navigate(-1);
    } else {
      navigate('/search');
    }
  };

  const addItem = (item) => {
    if (!item) return;
    addToCart(item);
    showToast(`Added ${item.name} from ${item.store} at ${money(item)} to basket!`);
  };
  const openProduct = (item, fromComparison = false) => {
    if (!item?.id) return;
    navigate(`/product/${encodeURIComponent(item.id)}`, {
      state: {
        product: item,
        ...(fromComparison ? {
          returnTo: comparePath,
          compareOrigin: product,
          compareSnapshot: comparison,
        } : {}),
      },
    });
  };
  const cardKeyDown = (event, item, fromComparison = false) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openProduct(item, fromComparison);
    }
  };

  const handleReviewSubmit = async (event) => {
    event.preventDefault();
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      await axios.post(`/api/reviews/${encodeURIComponent(productId || '')}`, {
        rating: Number(newRating), comment: newComment.trim(),
      });
      showToast('Review submitted!');
      setNewComment('');
      setNewRating('5');
      const { data } = await axios.get(`/api/reviews/${encodeURIComponent(productId || '')}`);
      setReviews(Array.isArray(data) ? data : []);
    } catch {
      showToast('Could not post review. Please log in and try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen min-w-0 overflow-x-clip bg-[#f7f9fb] text-slate-900">
      <div className="mx-auto max-w-7xl min-w-0 space-y-6 px-3 py-4 min-[430px]:px-4 sm:space-y-9 sm:px-6 sm:py-10 lg:px-8">
        <nav className="flex flex-wrap items-center gap-2 text-sm text-slate-500" aria-label="Breadcrumb">
          <button type="button" onClick={backToPrevious} className="inline-flex items-center gap-1 font-medium transition hover:text-emerald-700">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
          <span className="min-w-0 max-w-[65vw] truncate font-medium text-slate-800 sm:max-w-none">{isCompareView ? `Compare prices: ${product?.name || 'Product'}` : (product?.name || 'Product details')}</span>
        </nav>

        {!isCompareView && (loading && !product ? (
          <div className="grid animate-pulse gap-6 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm md:grid-cols-2">
            <div className="h-80 rounded-2xl bg-slate-100" />
            <div className="space-y-5 py-6"><div className="h-6 w-32 rounded bg-slate-100" /><div className="h-12 w-4/5 rounded bg-slate-100" /><div className="h-12 w-40 rounded bg-slate-100" /><div className="h-12 rounded bg-slate-100" /></div>
          </div>
        ) : !product ? (
          <Card className="rounded-3xl border-slate-200"><CardContent className="space-y-4 p-8 text-center">
            <Package className="mx-auto h-10 w-10 text-slate-400" />
            <h1 className="text-xl font-bold">Product not found</h1>
            <p className="text-slate-500">{productError || 'We could not load the selected retailer product.'}</p>
            <Button variant="outline" onClick={retryProduct}>Retry</Button>
            <Button variant="outline" onClick={backToPrevious}>Go back</Button>
          </CardContent></Card>
        ) : (
          <section className="grid min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lg shadow-slate-200/40 sm:rounded-[28px] lg:grid-cols-[1.03fr_1fr]">
            <div className="relative flex min-h-[245px] min-w-0 items-center justify-center bg-[radial-gradient(ellipse_at_28%_40%,rgba(209,250,229,0.65)_0%,rgba(236,253,245,0.45)_38%,rgba(255,255,255,0)_72%)] p-5 sm:min-h-[460px] sm:p-12">
              <ProductImage item={product} className="h-52 w-full drop-shadow-lg transition-transform duration-500 hover:scale-105 sm:h-80" />
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-4 p-4 min-[430px]:p-5 sm:gap-7 sm:p-10 lg:p-12">
              <div className="space-y-3">
                <h1 className="break-words text-2xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-4xl">{product.name}</h1>
              </div>
              <div className="min-w-0 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 sm:p-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {cheapestOffer ? (exactOffers.length ? 'Lowest price for this exact product' : 'Lowest price for a store equivalent') : 'Selected retailer price'}
                </p>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-center gap-1.5 min-[390px]:gap-2 sm:gap-4">
                  <span className="min-w-0 whitespace-nowrap text-[clamp(1.2rem,5.7vw,2.5rem)] font-black tracking-tight text-slate-950 sm:text-[clamp(1.8rem,4vw,2.5rem)]">{money(displayedOffer)}</span>
                  <div className="min-w-0 max-w-[135px] justify-self-end sm:max-w-none [&_a]:gap-1 [&_a]:px-2 [&_a]:py-1.5 [&_a]:text-[10px] min-[390px]:[&_a]:text-xs sm:[&_a]:gap-2 sm:[&_a]:px-3 sm:[&_a]:py-2 sm:[&_a]:text-base [&_a_img]:!h-4 [&_a_img]:!w-4 sm:[&_a_img]:!h-7 sm:[&_a_img]:!w-7 [&_a_svg]:hidden sm:[&_a_svg]:block [&_a_span]:min-w-0">
                    <StoreLabel store={displayedOffer.store} large />
                  </div>
                </div>
                {cheapestOffer && <Badge className="mt-3 border-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><Check className="mr-1 h-3.5 w-3.5" /> {exactOffers.length ? 'Best exact-match price' : 'Store equivalent — not identical'}</Badge>}
                {showingDifferentOffer && (
                  <div className="mt-4 flex items-center gap-3 rounded-xl bg-white p-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center"><ProductImage item={displayedOffer} className="h-full w-full" /></div>
                    <div className="min-w-0"><p className="text-xs font-semibold text-slate-500">Product added with the button below</p><p className="mt-1 break-words text-sm font-bold text-slate-800">{displayedOffer.name}</p></div>
                  </div>
                )}
                {comparisonLoading && !cheapestOffer && <p className="mt-2 text-xs text-emerald-700">Checking the same product and size across stores…</p>}
                {cheaperAlternative && <p className="mt-2 text-xs text-amber-800">A cheaper store equivalent is available below, but it is not the identical product.</p>}
                <p className="mt-2 text-xs text-slate-500">Prices may change at the retailer.</p>
              </div>
              <div className="sb-product-main-actions flex min-w-0 flex-col gap-3 sm:flex-row">
                <Button onClick={() => addItem(displayedOffer)} disabled={comparisonLoading || !displayedOffer?.id || !(priceValue(displayedOffer?.price) > 0)}
                  aria-label={`Add ${displayedOffer?.name || 'product'} from ${displayedOffer?.store || 'retailer'} for ${money(displayedOffer)} to basket`}
                  className="h-auto min-h-12 w-full min-w-0 flex-1 whitespace-normal rounded-xl bg-emerald-600 px-3 py-3 text-sm font-bold leading-5 text-white shadow-md shadow-emerald-100 hover:bg-emerald-700 sm:w-auto">
                  <ShoppingCart className="mr-2 h-5 w-5 shrink-0" /> {comparisonLoading ? 'Checking prices…' : `Add from ${displayedOffer.store}`}
                </Button>
                <Button variant="outline" className="h-auto min-h-12 w-full min-w-0 flex-1 whitespace-normal rounded-xl border-slate-200 px-3 py-3 text-sm font-semibold leading-5 sm:w-auto" onClick={showComparison}>
                  Compare retailer prices <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
              {showingDifferentOffer && (
                <button type="button" onClick={() => addItem(product)} className="self-start rounded-lg text-left text-sm font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
                  Add original {product.name} from {product.store} · {money(product)}
                </button>
              )}
              {safeProductUrl(product) && (
                <a href={safeProductUrl(product)} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center justify-center gap-2 self-start text-sm font-semibold text-emerald-700 hover:text-emerald-900">
                  View this exact listing at {product.store} <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </section>
        ))}

        {!isCompareView && product && <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <PriceHistoryChart productId={product.id} />
          <PriceWatchControl productId={product.id} user={user} />
        </div>}

        {isCompareView && !loading && !product && (
          <div className="rounded-2xl border border-amber-200 bg-white p-6 text-center">
            <Package className="mx-auto h-8 w-8 text-amber-700" />
            <p className="mt-3 text-sm text-slate-700">{productError || 'Could not load this retailer product.'}</p>
            <Button className="mt-4" variant="outline" onClick={backToPrevious}>Back to product search</Button>
          </div>
        )}
        {isCompareView && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Same product or verified store equivalent · same size</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Price comparison</h1>
            <p className="mt-2 text-sm text-slate-600">{product?.name || 'Loading selected product…'}</p>
            <p className="mt-2 text-xs text-slate-500">Exact products are listed first when available. Other stores may show clearly labelled equivalents of the same type and pack size. Prices may change at the retailer.</p>
          </section>
        )}

        {comparisonLoading && offers.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6" role="status">
            <div className="mb-4 flex items-center gap-3 text-slate-600"><span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /> Checking retailers for the exact same size…</div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map((n) => <div key={n} className="h-52 animate-pulse rounded-xl bg-slate-100" />)}</div>
          </div>
        )}
        {comparisonError && (
          <div className="rounded-2xl border border-amber-200 bg-white p-5">
            <p className="text-sm text-amber-800">{comparisonError}</p>
            <Button className="mt-3" variant="outline" onClick={retryComparison}>Retry comparison</Button>
          </div>
        )}
        {cheapestOffer && (
          <div className="flex flex-col gap-4 rounded-3xl border-2 border-emerald-300 bg-emerald-50/80 p-5 shadow-sm sm:flex-row sm:items-center sm:p-7">
            <div className="flex h-28 w-full shrink-0 items-center justify-center rounded-2xl bg-white p-3 sm:w-32"><ProductImage item={cheapestOffer} className="h-full w-full" /></div>
            <div className="min-w-0 flex-1 space-y-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-3 py-1 text-xs font-bold text-white"><TrendingDown className="h-4 w-4" /> {exactOffers.length ? 'Lowest exact-product price' : 'Lowest store-equivalent price'}</span>
              <h2 className="break-words text-lg font-extrabold text-slate-900">{cheapestOffer.name}</h2>
              <div className="flex flex-wrap items-center gap-3"><span className="text-2xl font-black text-emerald-800">{money(cheapestOffer)}</span><StoreLabel store={cheapestOffer.store} /><span className="text-xs font-semibold text-slate-600">{cheapestOffer.matchType === 'equivalent' ? 'Store equivalent · same type and pack size' : 'Exact product'}</span></div>
              <p className="text-xs text-slate-500">Prices may change at the retailer. {cheaperAlternative ? 'A cheaper non-identical store equivalent is shown below.' : ''}</p>
            </div>
          </div>
        )}
        {offers.length > 0 && (
          <section id="retailer-comparison" className="scroll-mt-6 space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Find your best deal</p>
                <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Compare retailer prices</h2>
                <p className="mt-1 text-sm text-slate-500">Select an offer to open that retailer's listing. Store equivalents are clearly marked. Back returns here.</p>
              </div>
              <Badge variant="secondary" className="rounded-full px-3 py-1">{offers.length} offers</Badge>
            </div>
            <div className="grid min-w-0 gap-3 min-[430px]:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
              {offers.map((item, index) => {
                const best = cheapestOffer && String(item.id) === String(cheapestOffer.id);
                return (
                  <div key={item.id || `${item.store}-${index}`} role={item.id ? 'link' : undefined} tabIndex={item.id ? 0 : undefined} onKeyDown={(e) => cardKeyDown(e, item, true)} onClick={() => openProduct(item, true)}
                    aria-label={item.id ? `View ${item.name} from ${item.store}` : undefined}
                    className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white transition-all duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${best ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-slate-200 hover:border-emerald-300'}`}>
                    {best && <div className="flex items-center justify-center gap-1.5 bg-emerald-600 py-2 text-xs font-bold text-white"><TrendingDown className="h-3.5 w-3.5" /> LOWEST PRICE</div>}
                    <div className="flex flex-1 flex-col p-4">
                      <div className="mb-4 flex h-40 items-center justify-center rounded-xl bg-slate-50 p-5"><ProductImage item={item} className="h-full w-full transition-transform duration-300 group-hover:scale-105" /></div>
                      <div className="mb-3"><StoreLabel store={item.store} /></div>
                      <h3 className="mb-2 line-clamp-2 min-h-[40px] text-sm font-bold leading-5 text-slate-800 group-hover:text-emerald-700">{item.name}</h3>
                      <span className={`mb-3 inline-flex w-fit rounded-full px-2 py-1 text-[11px] font-bold ${item.matchType === 'equivalent' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{item.matchType === 'equivalent' ? 'Store equivalent · same type & size' : 'Exact product'}</span>
                      <div className="mt-auto min-w-0 border-t border-slate-100 pt-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <p
                            className={`min-w-0 flex-1 whitespace-nowrap text-base font-black tracking-tight sm:text-lg ${best ? 'text-emerald-700' : 'text-slate-950'}`}
                            title={money(item)}
                          >
                            {money(item)}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!item.id}
                            onClick={(e) => { e.stopPropagation(); openProduct(item, true); }}
                            className="h-9 shrink-0 gap-1 rounded-lg px-2.5 text-xs font-bold sm:px-3"
                          >
                            View <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            aria-label={`Add ${item.name} to basket`}
                            onClick={(e) => { e.stopPropagation(); addItem(item); }}
                            className="h-9 w-9 shrink-0 rounded-lg bg-emerald-600 p-0 text-white hover:bg-emerald-700"
                          >
                            <ShoppingCart className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!loading && !comparisonLoading && !comparisonError && comparison && offers.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
            <Package className="mx-auto mb-3 h-8 w-8 text-slate-400" />
            <h2 className="text-lg font-bold">No verified retailer matches found</h2>
            <p className="mt-2 text-sm text-slate-500">We could not verify an exact match or a store equivalent with the same category and pack size.</p>
          </div>
        )}

        {!isCompareView && relatedProducts.length > 0 && (
          <section className="space-y-5">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Discover more</p>
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">You might also like</h2>
              <p className="mt-1 text-sm text-slate-500">Explore other popular products and compare prices.</p>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[430px]:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
              {relatedProducts.map((item) => (
                <div key={item.id} role="link" tabIndex={0} onClick={() => openProduct(item)} onKeyDown={(e) => cardKeyDown(e, item)} aria-label={`View ${item.name}`}
                  className="group flex min-w-0 cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-3 transition-all duration-200 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 sm:p-4">
                  <div className="mb-4 flex h-36 items-center justify-center rounded-xl bg-slate-50 p-3 sm:h-44"><ProductImage item={item} className="h-full w-full transition-transform duration-300 group-hover:scale-105" /></div>
                  <div className="mb-3"><StoreLabel store={item.store} /></div>
                  <h3 className="mb-3 line-clamp-2 min-h-[40px] text-sm font-bold leading-5 text-slate-800 group-hover:text-emerald-700">{item.name}</h3>
                  <div className="mt-auto min-w-0 border-t border-slate-100 pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="min-w-0 flex-1 whitespace-nowrap text-base font-black tracking-tight text-slate-950 sm:text-lg" title={money(item)}>
                        {money(item)}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); openProduct(item); }}
                        className="h-9 shrink-0 gap-1 rounded-lg px-2.5 text-xs font-bold"
                      >
                        View <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        aria-label={`Add ${item.name} to basket`}
                        onClick={(e) => { e.stopPropagation(); addItem(item); }}
                        className="h-9 w-9 shrink-0 rounded-lg bg-emerald-600 p-0 text-white hover:bg-emerald-700"
                      >
                        <ShoppingCart className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!isCompareView && <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardContent className="p-6 sm:p-8">
              <div className="mb-6 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Community feedback</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight">Customer reviews</h2></div><Badge variant="secondary" className="rounded-full">{reviews.length} reviews</Badge></div>
              {reviews.length ? <div className="space-y-4">{reviews.map((review, index) => <div key={review.id || index} className="rounded-2xl bg-slate-50 p-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><strong className="min-w-0 break-all text-sm text-slate-900">{review.author_name || 'Customer'}</strong><span className="shrink-0"><StarRating rating={review.rating} /></span></div><p className="text-sm leading-6 text-slate-600">{review.comment}</p>{review.date && <p className="mt-2 text-xs text-slate-400">{review.date}</p>}</div>)}</div> : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center"><Star className="mx-auto mb-3 h-7 w-7 text-slate-300" /><p className="font-semibold text-slate-700">No reviews yet</p><p className="mt-1 text-sm text-slate-500">Be the first to share your experience.</p></div>}
            </CardContent>
          </Card>
          <Card className="h-fit rounded-3xl border-slate-200 shadow-sm">
            <CardContent className="p-6 sm:p-8">
              <h2 className="text-xl font-extrabold tracking-tight">Write a review</h2><p className="mb-5 mt-1 text-sm text-slate-500">Help other shoppers make a choice.</p>
              <Separator className="mb-5" />
              <form onSubmit={handleReviewSubmit} className="space-y-4">
                <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-semibold text-slate-800">Your rating</legend><div className="flex flex-wrap items-center gap-2" role="group" aria-label="Review rating">{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} aria-label={`${value} out of 5 stars`} aria-pressed={Number(newRating) === value} onClick={() => setNewRating(String(value))} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition ${Number(newRating) === value ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-100' : 'border-slate-200 bg-white hover:border-amber-300'}`}><Star className={`h-6 w-6 ${value <= Number(newRating) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>)}</div><p className="text-xs font-medium text-slate-500">{newRating} of 5 stars</p></fieldset>
                <div className="space-y-2"><label className="text-sm font-semibold" htmlFor="review-comment">Your review</label><Textarea id="review-comment" value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="What did you think of this product?" rows={5} required className="resize-none rounded-xl" /></div>
                <Button type="submit" disabled={submitting || !newComment.trim()} className="h-11 w-full rounded-xl bg-slate-950 font-bold text-white hover:bg-emerald-700">{submitting ? 'Posting...' : 'Post review'} <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </form>
            </CardContent>
          </Card>
        </section>}
      </div>
    </main>
  );
}
