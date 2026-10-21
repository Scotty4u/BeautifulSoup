import { LOCATION_EVENT } from '../utils/ShoppingLocation';
import { useState, useEffect, useMemo } from 'react';

import { Link, useNavigate } from 'react-router-dom';

import axios from 'axios';

import { addToCart } from '../utils/cart';

import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { canViewAdultProducts, isVisibleProduct } from '../utils/ProductVisibility';

import { Card, CardContent } from '@/components/ui/card';

import { Button } from '@/components/ui/button';

import { Separator } from '@/components/ui/separator';

import { ShoppingCart, Sparkles, ArrowRight, Store, ChevronRight } from 'lucide-react';



import picknpayLogo from '../assets/imgs/picknpay.png';

import shopriteLogo from '../assets/imgs/shoprite.png';

import checkersLogo from '../assets/imgs/checkers.png';

import woolworthsLogo from '../assets/imgs/woolworths.png';



const STORE_INFO = {

  'Pick n Pay':  { logo: picknpayLogo,   bg: 'bg-white', text: 'text-blue-700', border: 'border-blue-200' },

  'Shoprite':    { logo: shopriteLogo,   bg: 'bg-white', text: 'text-red-600', border: 'border-red-200' },

  'Checkers':    { logo: checkersLogo,   bg: 'bg-white', text: 'text-emerald-700', border: 'border-emerald-200' },

  'Woolworths':  { logo: woolworthsLogo, bg: 'bg-white', text: 'text-slate-950', border: 'border-slate-300' },

};



const ALL_CATEGORIES = ['Grocery', 'Liquor', 'Pharmacy', 'Electronics', 'Baby', 'Personal Care', 'Household'];

const RETAILER_LINKS = [
  { name: 'Checkers', slug: 'checkers', caption: 'Browse Checkers' },
  { name: 'Shoprite', slug: 'shoprite', caption: 'Browse Shoprite' },
  { name: 'Pick n Pay', slug: 'pick-n-pay', caption: 'Browse Pick n Pay' },
  { name: 'Woolworths', slug: 'woolworths', caption: 'Browse Woolworths' },
];

function StoreBadge({ store }) {

  const info = STORE_INFO[store] || { logo: '', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };

  return (

    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${info.bg} ${info.text} ${info.border}`}>

      {info.logo && (

        <img src={info.logo} alt={`${store} logo`} className="w-5 h-5 object-contain" />

      )}

      {store}

    </span>

  );

}



function SkeletonCard() {

  return (

    <div className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3 animate-pulse">

      <div className="h-44 sm:h-52 bg-slate-100 rounded-xl" />

      <div className="h-3 bg-slate-100 rounded w-20" />

      <div className="h-4 bg-slate-100 rounded w-3/4" />

      <div className="h-3 bg-slate-100 rounded w-1/2" />

      <Separator />

      <div className="flex justify-between items-center">

        <div className="h-5 bg-slate-100 rounded w-16" />

        <div className="h-8 bg-slate-100 rounded w-16" />

      </div>

    </div>

  );

}



export default function Home() {

  const [products, setProducts] = useState([]);

  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  const { showToast } = useToast();
  const { user } = useAuth();
  // Guest and unknown-age users never see restricted categories.
  const canViewRestricted = canViewAdultProducts(user);

  const { visibleProducts, productGridClasses } = useMemo(() => {
    const allowed = products.filter((item) => isVisibleProduct(item, user));
    const count = allowed.length >= 12 ? 12 : allowed.length >= 6 ? 6
      : allowed.length >= 4 ? 4 : allowed.length;
    return {
      visibleProducts: allowed.slice(0, count),
      productGridClasses: count >= 12 ? 'grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
        : count === 6 ? 'grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3'
        : count === 4 ? 'grid-cols-1 min-[430px]:grid-cols-2'
        : 'grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3',
    };
  }, [products, user]);


  useEffect(() => {
    let alive = true;
    let controller = null;
    const load = () => {
      if (!alive) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setLoading(true);
      axios.get('/api/popular', { withCredentials: true, signal: request.signal })
        .then(res => { if (alive && !request.signal.aborted) setProducts(Array.isArray(res.data) ? res.data : []); })
        .catch(error => { if (alive && !request.signal.aborted && !axios.isCancel(error)) setProducts([]); })
        .finally(() => { if (alive && !request.signal.aborted) setLoading(false); });
    };
    load();
    window.addEventListener(LOCATION_EVENT, load);
    return () => { alive = false; controller?.abort(); window.removeEventListener(LOCATION_EVENT, load); };
  }, []);



  return (

    <div className="min-h-screen bg-[#F8FAF8] pb-16">



      <div className="mx-auto max-w-6xl min-w-0 px-3 pt-5 space-y-9 min-[430px]:px-4 sm:pt-7 sm:space-y-12">




        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">



          <div className="min-w-0 lg:col-span-5 bg-gradient-to-br from-[#059669] via-[#047857] to-[#065f46] rounded-3xl p-5 min-[430px]:p-7 md:p-10 text-white flex flex-col justify-between shadow-lg shadow-emerald-500/10">

            <div className="space-y-4">

              <span className="inline-block text-xs font-black tracking-widest uppercase opacity-90">

                DAILY DEALS

              </span>

              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black leading-tight tracking-tight break-words">

                Wanna buy cheap? Come browse

              </h1>

              <p className="text-white/90 text-sm leading-relaxed pt-2">

                SmartBasket makes grocery shopping simple, fast, and affordable.

                Browse fresh produce, pantry essentials, beverages, and household

                items all in one place.

              </p>

            </div>



            <div className="pt-8">

              <Button

                onClick={() => navigate('/search?q=deals', { state: { selectedCategories: ALL_CATEGORIES.filter((cat) => canViewRestricted || cat !== 'Liquor') } })}

                className="bg-white text-slate-900 hover:bg-slate-100 font-bold px-6 py-2.5 rounded-xl text-sm shadow-md cursor-pointer border-0"

              >

                Explore offers

              </Button>

            </div>

          </div>



          <div className="min-w-0 lg:col-span-7 bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">

            <div className="w-full h-44 min-[430px]:h-56 md:h-80 overflow-hidden bg-slate-100">

              <img

                src="/fresh-picks.png"

                alt="Fresh picks grocery basket"

                className="w-full h-full object-cover"

              />

            </div>



            <div className="p-4 sm:p-6 md:p-8 space-y-4">

              <div>

                <h3 className="text-lg font-black text-slate-900">Fresh picks for your basket</h3>

                <p className="text-slate-500 text-xs md:text-sm mt-1">

                  Discover seasonal produce, weekly essentials and curated bundles delivered fast.

                </p>

              </div>



              <div className="flex flex-col items-start gap-3 pt-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">

                <Button

                  onClick={() => navigate('/basket')}

                  className="bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs rounded-xl px-4 py-2 flex items-center gap-2 cursor-pointer"

                >

                  <ShoppingCart className="w-3.5 h-3.5" />

                  View Shopping List

                </Button>



                <button 

                  onClick={() => navigate('/search?q=all', { state: { selectedCategories: ALL_CATEGORIES.filter((cat) => canViewRestricted || cat !== 'Liquor') } })}

                  className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1.5 transition-colors cursor-pointer"

                >

                  Browse all items <ArrowRight className="w-3.5 h-3.5" />

                </button>

              </div>

            </div>

          </div>



        </div>



        <section aria-labelledby="browse-by-store-heading" className="min-w-0 space-y-4">
          <div>
            <h2 id="browse-by-store-heading" className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900 sm:text-xl"><Store aria-hidden="true" className="h-5 w-5 text-emerald-700" /> Browse by supermarket</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">Explore products from your preferred retailer.</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4 sm:gap-4">
            {RETAILER_LINKS.map(({ name, slug, caption }) => {
              const retailer = STORE_INFO[name];
              return (
                <Link
                  key={slug}
                  to={`/store/${slug}`}
                  aria-label={caption}
                  className={`group flex min-w-0 items-center gap-2 rounded-2xl border ${retailer.border} bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:gap-3 sm:p-4`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 p-2 sm:h-12 sm:w-12"><img src={retailer.logo} alt="" className="max-h-full max-w-full object-contain" /></span>
                  <span className="min-w-0 flex-1"><span className={`block break-words text-xs font-black leading-snug sm:text-sm ${retailer.text}`}>{name}</span><span className="mt-1 hidden text-[11px] text-slate-500 sm:block">View products</span></span>
                  <ChevronRight aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-slate-400 group-hover:text-emerald-700 min-[430px]:block" />
                </Link>
              );
            })}
          </div>
        </section>


        <div className="space-y-6">

          <div className="flex flex-wrap items-center justify-between gap-3">

            <div className="flex min-w-0 items-center gap-2">

              <Sparkles className="w-5 h-5 text-[#059669]" />

              <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Popular Essentials</h2>

            </div>

            <button type="button" onClick={() => navigate('/search?q=all')} className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs sm:text-sm font-bold text-emerald-700 hover:bg-emerald-50">
              View all <ArrowRight className="h-4 w-4" />
            </button>

          </div>



          <div className={`grid min-w-0 gap-3 sm:gap-4 ${productGridClasses}`}>

            {loading

              ? [...Array(6)].map((_, i) => <SkeletonCard key={i} />)

              : visibleProducts.map(product => (

                <Card

                  key={product.id}

                  className="min-w-0 border border-emerald-100 hover:border-[#059669] hover:shadow-lg transition-all duration-200 overflow-hidden group bg-white rounded-2xl"

                >

                  <CardContent className="min-w-0 p-3 min-[430px]:p-4 sm:p-5 flex flex-col justify-between h-full gap-3">

                    <div

                      className="h-40 min-[430px]:h-36 sm:h-44 lg:h-48 flex items-center justify-center overflow-hidden bg-slate-50 rounded-xl cursor-pointer group-hover:bg-emerald-50/50 transition-colors p-3"

                      onClick={() => navigate(`/product/${product.id}`, { state: { product } })}

                    >

                      <img

                        src={product.imageUrl || 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'}

                        alt={product.name}

                        onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'; }}

                        className="max-h-full max-w-full object-contain drop-shadow-xs"

                      />

                    </div>



                    <div className="min-w-0 space-y-1.5">

                      <StoreBadge store={product.store} />

                      <h3

                        onClick={() => navigate(`/product/${product.id}`, { state: { product } })}

                        className="min-w-0 text-sm sm:text-base font-bold text-slate-800 line-clamp-2 leading-snug cursor-pointer hover:text-emerald-700 transition-colors break-words"

                      >

                        {product.name}

                      </h3>

                    </div>



                    <div>

                      <Separator className="mb-3" />

                      <div className="flex min-w-0 flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:justify-between">

                        <span className="block min-w-0 break-words text-lg sm:text-xl font-black text-slate-900 leading-tight">

                          {product.formattedPrice || (Number.isFinite(Number(product.price)) ? `R ${Number(product.price).toFixed(2)}` : 'Price unavailable')}

                        </span>

                        <Button

                          size="sm"

                          variant="outline"

                          onClick={() => { addToCart(product); showToast(`Added ${product.name} to basket!`); }}

                          className="h-11 w-full lg:w-auto justify-center px-4 text-sm font-bold hover:bg-emerald-50 hover:border-[#059669] hover:text-[#059669] rounded-xl shrink-0 cursor-pointer whitespace-nowrap"

                        >

                          <ShoppingCart className="w-3 h-3 mr-1" />

                          Add

                        </Button>

                      </div>

                    </div>

                  </CardContent>

                </Card>

              ))

            }

          </div>

        </div>



      </div>

    </div>

  );

}
