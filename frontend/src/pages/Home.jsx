import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { addToCart } from '../utils/cart';
import { useToast } from '../context/ToastContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ShoppingCart, Sparkles, TrendingDown, Store } from 'lucide-react';

const STORE_COLORS = {
  'Pick n Pay':  { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  'Shoprite':    { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  'Checkers':    { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  'Woolworths':  { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

function StoreBadge({ store }) {
  const colors = STORE_COLORS[store] || { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${colors.bg} ${colors.text} ${colors.border}`}>
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

const STATS = [
  { icon: Store, label: '4 Retailers', sub: 'PnP, Shoprite, Checkers, Woolworths' },
  { icon: TrendingDown, label: 'Live Prices', sub: 'Updated in real-time' },
  { icon: Sparkles, label: 'Smart Compare', sub: 'Find the best deal instantly' },
];

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    axios.get('/api/popular')
      .then(res => { setProducts(res.data || []); setLoading(false); })
      .catch(() => { setProducts([]); setLoading(false); });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-10">

        {/* ── HERO ── */}
        <div className="relative rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-8 py-12 overflow-hidden shadow-xl shadow-emerald-200">
          {/* decorative blobs */}
          <div className="absolute -top-10 -right-10 w-64 h-64 bg-white/5 rounded-full" />
          <div className="absolute -bottom-16 -left-10 w-80 h-80 bg-white/5 rounded-full" />

          <div className="relative z-10 max-w-xl space-y-4">
            <Badge className="bg-white/20 text-white border-0 font-bold text-xs hover:bg-white/20">
              🇿🇦 South Africa's Smart Grocery Tool
            </Badge>
            <h1 className="text-4xl md:text-5xl font-black text-white leading-tight">
              Shop Smarter.<br />Save More.
            </h1>
            <p className="text-emerald-100 text-base leading-relaxed">
              Compare real-time grocery prices across Pick n Pay, Shoprite, Checkers and Woolworths — all from one place.
            </p>
          </div>

          {/* Stats row */}
          <div className="relative z-10 mt-8 flex flex-wrap gap-4">
            {STATS.map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/20">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-white font-bold text-sm">{label}</div>
                  <div className="text-emerald-200 text-xs">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── POPULAR ESSENTIALS ── */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-600" />
              <h2 className="text-xl font-black text-slate-900">Popular Essentials</h2>
            </div>
            <Badge variant="secondary" className="text-xs font-bold">
              {loading ? '...' : `${products.length} products`}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {loading
              ? [...Array(10)].map((_, i) => <SkeletonCard key={i} />)
              : products.map(product => (
                <Card
                  key={product.id}
                  className="border border-slate-200 hover:border-emerald-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 overflow-hidden group"
                >
                  <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
                    {/* Image */}
                    <div
                      className="h-40 flex items-center justify-center bg-slate-50 rounded-xl cursor-pointer group-hover:bg-emerald-50/50 transition-colors"
                      onClick={() => navigate(`/product/${product.id}`, { state: { product } })}
                    >
                      <img
                        src={product.imageUrl || 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'}
                        alt={product.name}
                        onError={e => { e.target.src = 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'; }}
                        className="max-h-full max-w-full object-contain drop-shadow-sm"
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
                          className="h-8 text-xs font-bold border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 shrink-0"
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