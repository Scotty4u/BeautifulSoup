import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { addToCart } from '../utils/cart';
import { useToast } from '../context/ToastContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ShoppingCart, Sparkles, ArrowRight } from 'lucide-react';

import picknpayLogo from '../assets/imgs/picknpay.png';
import shopriteLogo from '../assets/imgs/shoprite.png';
import checkersLogo from '../assets/imgs/checkers.png';
import woolworthsLogo from '../assets/imgs/woolworths.png';

const STORE_INFO = {
  'Pick n Pay':  { logo: picknpayLogo,   bg: 'bg-white', text: 'text-red-500',    border: 'border-red-200' },
  'Shoprite':    { logo: shopriteLogo,   bg: 'bg-white', text: 'text-blue-500',   border: 'border-blue-200' },
  'Checkers':    { logo: checkersLogo,   bg: 'bg-white', text: 'text-amber-500',  border: 'border-amber-200' },
  'Woolworths':  { logo: woolworthsLogo, bg: 'bg-white', text: 'text-purple-500', border: 'border-purple-200' },
};

const ALL_CATEGORIES = ['Grocery', 'Liquor', 'Pharmacy', 'Electronics'];

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
      <div className="h-40 bg-slate-100 rounded-xl" />
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

  const categories = ['Grocery', 'Liquor', 'Pharmacy', 'Electronics'];

  useEffect(() => {
    axios.get('/api/popular')
      .then(res => { setProducts(res.data || []); setLoading(false); })
      .catch(() => { setProducts([]); setLoading(false); });
  }, []);

  return (
    <div className="min-h-screen bg-[#F8FAF8] pb-16">
      
      {/* ── 1. CATEGORY TOGGLE BAR ── */}
      <div className="bg-[#E7F3E8] border-b border-slate-200 py-3 mb-8 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 flex justify-center items-center gap-8 md:gap-14 overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => navigate(`/search?category=${encodeURIComponent(cat.toLowerCase())}`, {
                state: {selectedCategories: [cat]}
              })}
              className="text-sm font-semibold text-slate-700 hover:text-[#FF8C38] transition-colors whitespace-nowrap cursor-pointer"
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 space-y-12">

        {/* ── 2. HERO SECTION: ORANGE PROMO CARD + SHOPPING CART CARD ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* Left: Orange Daily Deals Card */}
          <div className="lg:col-span-5 bg-gradient-to-br from-[#FF9800] via-[#FF8008] to-[#FF6B00] rounded-3xl p-8 md:p-10 text-white flex flex-col justify-between shadow-lg shadow-orange-500/10">
            <div className="space-y-4">
              <span className="inline-block text-xs font-black tracking-widest uppercase opacity-90">
                DAILY DEALS
              </span>
              <h1 className="text-3xl md:text-4xl font-black leading-tight tracking-tight">
                Wanna buy cheap? Come browse
              </h1>
              <p className="text-white/90 text-sm leading-relaxed pt-2">
                SmartBasket makes grocery shopping simple, fast, and affordable.
                Browse fresh produce, pantry essentials, beverages, and household
                items all in one place, with quality products and great daily deals
                delivered right to your doorstep.
              </p>
            </div>

            <div className="pt-8">
              <Button
                onClick={() => navigate('/search?q=deals', { state: { selectedCategories: ALL_CATEGORIES } })}
                className="bg-white text-slate-900 hover:bg-slate-100 font-bold px-6 py-2.5 rounded-xl text-sm shadow-md cursor-pointer border-0"
              >
                Explore offers
              </Button>
            </div>
          </div>

          {/* Right: Fresh Picks Image Card */}
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
            <div className="w-full h-72 md:h-80 overflow-hidden bg-slate-100">
              <img
                src="/fresh-picks.png"
                alt="Fresh picks grocery basket"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="p-6 md:p-8 space-y-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Fresh picks for your basket</h3>
                <p className="text-slate-500 text-xs md:text-sm mt-1">
                  Discover seasonal produce, weekly essentials and curated bundles delivered fast.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  onClick={() => navigate('/basket')}
                  className="bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs rounded-xl px-4 py-2 flex items-center gap-2 cursor-pointer"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  View Shopping List
                </Button>

                <button 
                  onClick={() => navigate('/search?q=all', { state: { selectedCategories: ALL_CATEGORIES } })}
                  className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  1245+ items <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* ── 3. POPULAR ESSENTIALS (PRODUCTS GRID) ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#FF8C38]" />
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Popular Essentials</h2>
            </div>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              {loading ? '...' : `${products.length} products`}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {loading
              ? [...Array(10)].map((_, i) => <SkeletonCard key={i} />)
              : products.map(product => (
                <Card
                  key={product.id}
                  className="border border-[#FFF3EB] hover:border-[#FF8C38] hover:shadow-lg hover:-translate-y-1 transition-all duration-200 overflow-hidden group bg-white rounded-2xl"
                >
                  <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
                    <div
                      className="h-40 flex items-center justify-center bg-slate-50 rounded-xl cursor-pointer group-hover:bg-emerald-50/50 transition-colors"
                      onClick={() => navigate(`/product/${product.id}`, { state: { product } })}
                    >
                      <img
                        src={product.imageUrl || 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'}
                        alt={product.name}
                        onError={e => { e.target.src = 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'; }}
                        className="max-h-full max-w-full object-contain drop-shadow-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <StoreBadge store={product.store} />
                      <h3
                        onClick={() => navigate(`/product/${product.id}`, { state: { product } })}
                        className="text-sm font-bold text-slate-800 line-clamp-2 leading-snug cursor-pointer hover:text-emerald-700 transition-colors"
                      >
                        {product.name}
                      </h3>
                    </div>

                    <div>
                      <Separator className="mb-3" />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-base font-black text-slate-900">
                          {product.formattedPrice || `R ${product.price?.toFixed(2)}`}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { addToCart(product); showToast(`Added ${product.name} to basket!`); }}
                          className="h-8 text-xs font-bold hover:bg-[#FFF3EB] hover:border-[#FF8C38] hover:text-[#FF8C38] rounded-xl shrink-0 cursor-pointer"
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