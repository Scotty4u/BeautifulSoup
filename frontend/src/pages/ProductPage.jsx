import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useToast } from '../context/ToastContext';
import { addToCart } from '../utils/cart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShoppingCart, Star, TrendingDown, ChevronLeft, Package } from 'lucide-react';

// --- Store badge color map ---
const STORE_COLORS = {
  'Pick n Pay':  { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  'Shoprite':    { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  'Checkers':    { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  'Woolworths':  { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

function StoreBadge({ store }) {
  const colors = STORE_COLORS[store] || { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${colors.bg} ${colors.text} ${colors.border}`}>
      {store}
    </span>
  );
}

function StarRating({ rating, size = 'sm' }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`${size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'} ${i <= rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`}
        />
      ))}
    </div>
  );
}

function PriceBadge({ price, isLowest }) {
  return (
    <div className={`flex items-center gap-1.5 ${isLowest ? 'text-emerald-600' : 'text-slate-800'}`}>
      {isLowest && <TrendingDown className="w-4 h-4 text-emerald-500" />}
      <span className={`text-xl font-black ${isLowest ? 'text-emerald-600' : 'text-slate-800'}`}>
        {price}
      </span>
      {isLowest && (
        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
          Best Price
        </span>
      )}
    </div>
  );
}

export default function ProductPage() {
  const { productId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [product, setProduct] = useState(location.state?.product || null);
  const [comparison, setComparison] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [loading, setLoading] = useState(!location.state?.product);
  const [reviews, setReviews] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [newRating, setNewRating] = useState('5');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const productName = product?.name || productId.replace(/^(pnp|shoprite|checkers|woolworths)_/, '').replace(/-/g, ' ');

    axios.get(`/api/compare?q=${encodeURIComponent(productName)}`)
      .then(res => {
        setComparison(res.data);
        if (!product && res.data?.found && res.data.cheapest) setProduct(res.data.cheapest);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    axios.get('/api/popular')
      .then(res => {
        const filtered = (res.data || []).filter(p => p.id !== productId);
        setRelatedProducts(filtered.slice(0, 4));
      })
      .catch(() => {});

    axios.get(`/api/reviews/${productId}`)
      .then(res => setReviews(res.data || []))
      .catch(() => {});
  }, [productId]);

  const handleReviewSubmit = (e) => {
    e.preventDefault();
    setSubmitting(true);
    axios.post(`/api/reviews/${productId}`, { rating: Number(newRating), comment: newComment })
      .then(() => {
        showToast('Review submitted!');
        setNewComment('');
        setNewRating('5');
        return axios.get(`/api/reviews/${productId}`);
      })
      .then(res => setReviews(res.data))
      .catch(() => showToast('Please log in to submit reviews.', 'error'))
      .finally(() => setSubmitting(false));
  };

  const lowestPrice = comparison?.products?.length
    ? Math.min(...comparison.products.map(p => p.price))
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-600 transition-colors font-medium"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>

        {/* ── HERO CARD ── */}
        {loading && !product ? (
          <Card className="animate-pulse">
            <CardContent className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="h-72 bg-slate-200 rounded-2xl" />
                <div className="space-y-4">
                  <div className="h-4 bg-slate-200 rounded w-24" />
                  <div className="h-8 bg-slate-200 rounded w-3/4" />
                  <div className="h-10 bg-slate-200 rounded w-32" />
                  <div className="h-12 bg-slate-200 rounded" />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden border-0 shadow-lg shadow-slate-200/80">
            <CardContent className="p-0">
              <div className="grid grid-cols-1 md:grid-cols-2">
                {/* Image panel */}
                <div className="relative bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-10 min-h-[300px]">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-50/60 via-transparent to-transparent" />
                  <img
                    src={product?.imageUrl || 'https://placehold.co/400x400/f8fafc/94a3b8?text=No+Image'}
                    alt={product?.name}
                    onError={e => { e.target.src = 'https://placehold.co/400x400/f8fafc/94a3b8?text=No+Image'; }}
                    className="relative z-10 max-h-64 max-w-full object-contain drop-shadow-md"
                  />
                </div>

                {/* Info panel */}
                <div className="p-8 flex flex-col justify-between gap-6 bg-white">
                  <div className="space-y-3">
                    <StoreBadge store={product?.store || 'Retailer'} />
                    <h1 className="text-2xl font-black text-slate-900 leading-tight">
                      {product?.name || productId}
                    </h1>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-black text-emerald-600">
                        {product?.formattedPrice || (product?.price ? `R ${product.price.toFixed(2)}` : '—')}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      Live price data from South African retailers. Compare alternatives below.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Button
                      onClick={() => { if (product) { addToCart(product); showToast(`Added ${product.name} to basket!`); } }}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 text-base rounded-xl shadow-md shadow-emerald-200 transition-all hover:-translate-y-0.5"
                    >
                      <ShoppingCart className="w-5 h-5 mr-2" />
                      Add to Basket
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── PRICE COMPARISON ── */}
        {comparison?.found && comparison.products.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-emerald-600" />
              <h2 className="text-lg font-black text-slate-900">Compare Across Retailers</h2>
              <Badge variant="secondary" className="ml-auto text-xs">
                {comparison.products.length} stores
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {comparison.products.map(p => {
                const isLowest = p.price === lowestPrice;
                return (
                  <Card
                    key={p.id}
                    className={`overflow-hidden border transition-all hover:-translate-y-1 hover:shadow-md ${
                      isLowest ? 'border-emerald-300 shadow-emerald-100 shadow-md ring-1 ring-emerald-200' : 'border-slate-200'
                    }`}
                  >
                    {isLowest && (
                      <div className="bg-emerald-600 text-white text-[10px] font-bold text-center py-1 uppercase tracking-widest">
                        Best Price
                      </div>
                    )}
                    <CardContent className="p-4 space-y-3">
                      <div className="h-24 flex items-center justify-center bg-slate-50 rounded-xl">
                        <img
                          src={p.imageUrl || 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'}
                          alt={p.name}
                          onError={e => { e.target.src = 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'; }}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <StoreBadge store={p.store} />
                      <p className="text-sm font-semibold text-slate-800 line-clamp-2 leading-snug">{p.name}</p>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <PriceBadge price={p.formattedPrice || `R ${p.price.toFixed(2)}`} isLowest={isLowest} />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { addToCart(p); showToast(`Added ${p.name} to basket!`); }}
                          className="h-8 text-xs font-bold border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700"
                        >
                          Add
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* ── REVIEWS ── */}
        <Card className="border-0 shadow-lg shadow-slate-200/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg font-black text-slate-900">
              <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
              Customer Reviews
              {reviews.length > 0 && (
                <Badge variant="secondary" className="ml-auto font-bold">{reviews.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {reviews.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No reviews yet. Be the first!</p>
            ) : (
              <div className="space-y-3">
                {reviews.map(r => (
                  <div key={r.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-800">{r.author_name}</span>
                      <div className="flex items-center gap-2">
                        <StarRating rating={r.rating} />
                        <span className="text-xs text-slate-400">{r.date}</span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">{r.comment}</p>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            {/* Review form */}
            <form onSubmit={handleReviewSubmit} className="space-y-3 pt-2">
              <h4 className="font-bold text-sm text-slate-900">Leave a Review</h4>
              <Select value={newRating} onValueChange={setNewRating}>
                <SelectTrigger className="w-full border-slate-200 focus:ring-emerald-500">
                  <SelectValue placeholder="Select rating" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">⭐⭐⭐⭐⭐ Excellent</SelectItem>
                  <SelectItem value="4">⭐⭐⭐⭐ Good</SelectItem>
                  <SelectItem value="3">⭐⭐⭐ Average</SelectItem>
                  <SelectItem value="2">⭐⭐ Poor</SelectItem>
                  <SelectItem value="1">⭐ Terrible</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Share your experience with this product..."
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                className="resize-none border-slate-200 focus:ring-emerald-500 focus:border-emerald-400"
                rows={3}
                required
              />
              <Button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm shadow-emerald-200"
              >
                {submitting ? 'Posting...' : 'Post Review'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── RELATED PRODUCTS (Modernized Layout) ── */}
        {relatedProducts.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">You Might Also Need</h2>
                  <p className="text-xs text-slate-500 font-medium">Alternative options and equivalents from other stores</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {relatedProducts.map(rp => (
                <Card
                  key={rp.id}
                  className="group relative bg-white border border-slate-200/80 rounded-2xl hover:border-emerald-500/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col justify-between"
                  onClick={() => navigate(`/product/${rp.id}`, { state: { product: rp } })}
                >
                  <CardContent className="p-4 flex flex-col h-full justify-between gap-4">
                    
                    {/* Top Section: Image & Store Badge */}
                    <div className="space-y-3">
                      <div className="relative h-36 w-full flex items-center justify-center bg-slate-50/80 rounded-xl p-2 overflow-hidden group-hover:bg-emerald-50/20 transition-colors">
                        <img
                          src={rp.imageUrl || 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'}
                          alt={rp.name}
                          onError={e => { e.target.src = 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'; }}
                          className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute top-2 left-2">
                          <StoreBadge store={rp.store} />
                        </div>
                      </div>

                      <p className="text-sm font-bold text-slate-800 line-clamp-2 leading-snug group-hover:text-emerald-700 transition-colors">
                        {rp.name}
                      </p>
                    </div>

                    {/* Bottom Section: Price & Modern CTA */}
                    <div className="space-y-3 pt-2">
                      <Separator className="bg-slate-100" />
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Best Price</span>
                          <span className="font-black text-slate-900 text-base">
                            {rp.formattedPrice || `R ${rp.price.toFixed(2)}`}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          onClick={e => { e.stopPropagation(); navigate(`/product/${rp.id}`, { state: { product: rp } }); }}
                          className="h-8 px-3 text-xs font-extrabold bg-slate-900 hover:bg-emerald-600 text-white rounded-xl shadow-sm transition-colors"
                        >
                          Compare
                        </Button>
                      </div>
                    </div>

                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}