import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  Trash2, 
  Share2, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  ArrowLeft, 
  Store,
  CheckCircle2
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { getCart, saveCart } from '../utils/cart';
import { Button } from '@/components/ui/button';

export default function BasketPage() {
  const [items, setItems] = useState([]);
  const [storeTotals, setStoreTotals] = useState([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  
  // Toggle between 'list' (shopping-list-page) and 'comparison' (basket-comparison desktop)
  const [viewMode, setViewMode] = useState('list');

  // Saving list modal / inline form
  const [isSaving, setIsSaving] = useState(false);
  const [listName, setListName] = useState('My Saved Basket');

  const [expandedStores, setExpandedStores] = useState({
    Checkers: true,
    Shoprite: true,
    'Pick n Pay': false,
    Woolworths: false
  });

  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const currentItems = getCart();
    setItems(currentItems);
    if (currentItems.length > 0) {
      calculateStoreBreakdown(currentItems);
    }
  }, []);

  const updateQty = (id, delta) => {
    const updated = items.map(i => i.id === id ? { ...i, quantity: Math.max(1, (i.quantity || 1) + delta) } : i);
    setItems(updated);
    saveCart(updated);
    calculateStoreBreakdown(updated);
  };

  const removeItem = (id) => {
    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    saveCart(updated);
    calculateStoreBreakdown(updated);
    showToast("Item removed from basket.");
  };

  const handleClearCart = () => {
    localStorage.removeItem('cart');
    window.dispatchEvent(new Event('storage'));
    setItems([]);
    setStoreTotals([]);
    showToast("Whole list cleared from basket.");
  };

  const calculateStoreBreakdown = async (cartItems) => {
    setLoadingComparison(true);
    try {
      const queries = cartItems.map(item => item.name);
      const res = await axios.post('/api/batch-compare', { queries });
      const batchData = res.data || {};

      const stores = ['Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths'];
      const breakdown = stores.map(store => {
        let storeTotal = 0;
        const storeItems = cartItems.map(item => {
          const competitors = batchData[item.name] || [];
          const storeMatch = competitors.find(c => c.store?.toLowerCase() === store.toLowerCase());

          const itemPrice = storeMatch ? storeMatch.price : item.price;
          const itemImage = storeMatch ? storeMatch.imageUrl : item.imageUrl;
          const itemName = storeMatch ? storeMatch.name : item.name;
          const itemId = storeMatch ? storeMatch.id : item.id;

          storeTotal += (itemPrice * (item.quantity || 1));

          return {
            ...item,
            id: itemId,
            name: itemName,
            imageUrl: itemImage,
            price: itemPrice,
            store: store,
            calculatedPrice: itemPrice,
            storeMatch: !!storeMatch
          };
        });

        return { store, total: storeTotal, items: storeItems };
      }).sort((a, b) => a.total - b.total);

      setStoreTotals(breakdown);
    } catch (err) {
      showToast("Failed to fetch live store comparisons.", "error");
    } finally {
      setLoadingComparison(false);
    }
  };

  const toggleStoreExpansion = (storeName) => {
    setExpandedStores(prev => ({
      ...prev,
      [storeName]: !prev[storeName]
    }));
  };

  const handleSaveSubmit = (e) => {
    e.preventDefault();
    if (!listName.trim()) return;

    axios.post('/api/db/save-basket', { name: listName.trim(), items })
      .then(() => {
        showToast(`"${listName.trim()}" successfully saved to your profile!`);
        setIsSaving(false);
      })
      .catch(() => showToast("Please log in to save baskets to your profile.", "error"));
  };

  // Automatically saves/syncs the cart to the backend first to generate a token, then copies link
  const handleShareLink = async () => {
    try {
      const response = await axios.post('/api/db/save-basket', { 
        name: listName.trim() || 'My Shared Shopping List', 
        items 
      });

      const shareToken = response.data.share_token;
      if (!shareToken) {
        throw new Error('Share token missing from response');
      }

      const shareUrl = `${window.location.origin}/shared/basket/${shareToken}`;
      await navigator.clipboard.writeText(shareUrl);
      showToast("Share link copied to clipboard!");
    } catch (err) {
      if (err.response && err.response.status === 401) {
        showToast("Please log in to your account to share lists.", "error");
      } else {
        showToast("Failed to generate share link. Please try again.", "error");
      }
    }
  };

  // Metrics
  const totalItemsCount = items.length;
  const totalUnitsCount = items.reduce((acc, item) => acc + (item.quantity || 1), 0);
  const estimatedTotal = items.reduce((acc, item) => acc + (item.price * (item.quantity || 1)), 0);

  const cheapestStore = storeTotals.length > 0 ? storeTotals[0] : null;
  const secondCheapestStore = storeTotals.length > 1 ? storeTotals[1] : null;
  const potentialSavings = (secondCheapestStore && cheapestStore) 
    ? Math.max(0, secondCheapestStore.total - cheapestStore.total) 
    : 12.50;

  if (items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="bg-white rounded-3xl border border-[#E0E8E1] p-12 shadow-sm">
          <div className="w-16 h-16 bg-[#FFF3EB] rounded-full flex items-center justify-center mx-auto mb-4 text-[#FF8C38]">
            <Store className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Your basket is empty</h2>
          <p className="text-slate-500 text-sm mt-1 max-w-sm mx-auto">
            Explore items across retailers and compare real-time prices to find the best savings.
          </p>
          <Link to="/search">
            <Button className="mt-6 bg-[#FF8C38] hover:brightness-95 text-white font-bold rounded-xl px-6">
              Start Shopping
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* VIEW 1: MY SHOPPING LIST */}
      {viewMode === 'list' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">My Shopping List</h1>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">
                {totalItemsCount} items added • {totalUnitsCount} total units
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => showToast("Exporting shopping list as PDF/CSV...")}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#E0E8E1] text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
              <button 
                onClick={handleShareLink}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#E0E8E1] text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm"
              >
                <Share2 className="w-3.5 h-3.5" />
                Share
              </button>
              <button 
                onClick={handleClearCart}
                className="p-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-colors ml-1 cursor-pointer"
                title="Clear all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2 flex flex-col gap-3">
              {items.map(item => (
                <div 
                  key={item.id} 
                  className="bg-white rounded-2xl border border-[#E0E8E1] p-4 flex items-center justify-between gap-4 shadow-sm hover:border-[#bfe0c2] transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div 
                      className="w-16 h-16 bg-[#F4F7F4] rounded-xl flex items-center justify-center p-2 shrink-0 cursor-pointer"
                      onClick={() => navigate(`/product/${item.id}`, { state: { product: item } })}
                    >
                      <img 
                        src={item.imageUrl || 'https://placehold.co/60x60/f8fafc/94a3b8?text=Item'} 
                        alt={item.name} 
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <div className="min-w-0">
                      <h4 
                        onClick={() => navigate(`/product/${item.id}`, { state: { product: item } })}
                        className="text-sm font-bold text-slate-800 truncate cursor-pointer hover:text-[#FF8C38] transition-colors"
                      >
                        {item.name}
                      </h4>
                      <span className="inline-block text-[10px] font-bold text-[#FF8C38] bg-[#FFF3EB] px-2 py-0.5 rounded mt-1">
                        {item.store}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                    <div className="flex items-center bg-[#FF8C38] text-white rounded-lg p-0.5 shadow-sm">
                      <button 
                        onClick={() => updateQty(item.id, -1)} 
                        className="w-6 h-6 flex items-center justify-center hover:bg-black/10 rounded font-bold text-sm cursor-pointer"
                      >
                        -
                      </button>
                      <span className="px-2 text-xs font-black min-w-[20px] text-center">
                        {item.quantity || 1}
                      </span>
                      <button 
                        onClick={() => updateQty(item.id, 1)} 
                        className="w-6 h-6 flex items-center justify-center hover:bg-black/10 rounded font-bold text-sm cursor-pointer"
                      >
                        +
                      </button>
                    </div>

                    <span className="text-sm font-black text-slate-800 min-w-[65px] text-right">
                      R {(item.price * (item.quantity || 1)).toFixed(2)}
                    </span>

                    <button 
                      onClick={() => removeItem(item.id)}
                      className="text-slate-300 hover:text-red-500 transition-colors p-1 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-[#E0E8E1] p-6 shadow-sm flex flex-col gap-5">
              <div>
                <h3 className="text-base font-black text-slate-900">List Stats</h3>
                <p className="text-xs text-slate-400 mt-0.5">Keep track of your items and quantities</p>
              </div>

              <div className="space-y-2.5 text-xs font-semibold text-slate-600 border-b border-slate-100 pb-4">
                <div className="flex justify-between">
                  <span>Total Items</span>
                  <span className="font-bold text-slate-900">{totalItemsCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Units</span>
                  <span className="font-bold text-slate-900">{totalUnitsCount}</span>
                </div>
              </div>

              <div className="flex justify-between items-baseline">
                <span className="text-xs font-bold text-slate-700">Estimated Total</span>
                <span className="text-xl font-black text-[#FF8C38]">
                  R {estimatedTotal.toFixed(2)}
                </span>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed bg-[#F4F7F4] p-3 rounded-xl">
                Ready to go shopping? Compare across retailers to discover the cheapest combination!
              </p>

              <button 
                onClick={() => setViewMode('comparison')}
                className="w-full py-3 rounded-xl bg-[#FF8C38] hover:brightness-95 text-white font-bold text-sm transition-colors shadow-sm cursor-pointer"
              >
                Compare Retailer Prices →
              </button>

              <button 
                onClick={() => setIsSaving(!isSaving)}
                className="w-full py-2.5 rounded-xl border border-[#E0E8E1] text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Save List to Account
              </button>

              {isSaving && (
                <form onSubmit={handleSaveSubmit} className="pt-2 border-t border-slate-100 flex flex-col gap-2">
                  <input 
                    type="text" 
                    value={listName} 
                    onChange={(e) => setListName(e.target.value)} 
                    placeholder="List title..." 
                    className="w-full text-xs p-2 rounded-lg border border-[#E0E8E1] bg-[#F4F7F4] focus:outline-none"
                    autoFocus
                  />
                  <button type="submit" className="w-full py-2 bg-[#FF8C38] hover:brightness-95 text-white rounded-lg text-xs font-bold transition-colors">
                    Confirm Save
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: BASKET COMPARISON */}
      {viewMode === 'comparison' && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <button 
              onClick={() => setViewMode('list')}
              className="p-2 rounded-xl bg-white border border-[#E0E8E1] hover:bg-slate-50 transition-colors cursor-pointer text-slate-600"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Basket Comparison</h1>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">
                Your list priced at {storeTotals.length} stores • {totalItemsCount} items ({totalUnitsCount} units)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2 flex flex-col gap-4">
              {loadingComparison ? (
                <div className="bg-white rounded-2xl border border-[#FF8C38] p-8 text-center text-slate-500 font-medium">
                  Calculating real-time comparison across Shoprite, Checkers, Woolworths, and Pick n Pay...
                </div>
              ) : (
                storeTotals.map((st, idx) => {
                  const isExpanded = !!expandedStores[st.store];
                  const isBest = idx === 0;

                  return (
                    <div 
                      key={st.store} 
                      className={`bg-white rounded-2xl border transition-all overflow-hidden ${
                        isBest ? 'border-[#FF8C38] ring-1 ring-[#FF8C38] shadow-sm' : 'border-[#E0E8E1]'
                      }`}
                    >
                      <div 
                        onClick={() => toggleStoreExpansion(st.store)}
                        className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 select-none"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-2.5 h-2.5 rounded-full ${isBest ? 'bg-[#FF8C38]' : 'bg-slate-300'}`} />
                          <span className="font-extrabold text-sm text-slate-800">{st.store}</span>
                          {isBest && (
                            <span className="text-[10px] font-bold text-[#FF8C38] bg-[#FFF3EB] px-2 py-0.5 rounded">
                              CHEAPEST
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-4">
                          <span className="font-black text-sm text-slate-900">
                            R {st.total.toFixed(2)}
                          </span>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 border-t border-slate-100 flex flex-col gap-2.5 bg-slate-50/40">
                          {st.items.map(item => (
                            <div 
                              key={item.id} 
                              onClick={() => navigate(`/product/${item.id}`, { state: { product: item } })}
                              className="flex justify-between items-center text-xs py-2 px-2 -mx-2 rounded-lg cursor-pointer hover:bg-white hover:shadow-sm transition-all"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-white rounded border border-[#E0E8E1] flex items-center justify-center p-0.5 shrink-0">
                                  <img 
                                    src={item.imageUrl || 'https://placehold.co/60x60/f8fafc/94a3b8?text=Item'} 
                                    alt={item.name} 
                                    className="max-h-full max-w-full object-contain"
                                  />
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-800 hover:text-[#FF8C38] transition-colors">{item.name}</span>
                                  <span className="text-slate-400 ml-2">Qty: {item.quantity || 1}</span>
                                </div>
                              </div>
                              <span className="font-bold text-slate-700">
                                R {(item.calculatedPrice * (item.quantity || 1)).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="bg-white rounded-2xl border border-[#E0E8E1] p-6 shadow-sm flex flex-col gap-5">
              <div>
                <h3 className="text-base font-black text-slate-900">Best Deal Result</h3>
                <p className="text-xs text-slate-400 mt-0.5">Comparison is based on your current shopping basket</p>
              </div>

              {cheapestStore && (
                <div className="bg-[#FFF3EB] border border-[#FF8C38]/40 p-4 rounded-xl flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#FF8C38] shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-bold text-[#FF8C38]">
                      {cheapestStore.store} is Cheaper!
                    </p>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">
                      You save <strong className="text-[#FF8C38]">R {potentialSavings.toFixed(2)}</strong> by choosing to shop your basket at {cheapestStore.store}.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-2 border-b border-slate-100 pb-4 text-xs">
                {storeTotals.slice(0, 3).map(st => (
                  <div key={st.store} className="flex justify-between text-slate-600">
                    <span>{st.store} Basket</span>
                    <span className="font-bold text-slate-900">R {st.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-baseline">
                <span className="text-xs font-bold text-slate-700">Best Basket Price</span>
                <span className="text-xl font-black text-[#FF8C38]">
                  {cheapestStore ? `R ${cheapestStore.total.toFixed(2)}` : 'R 0.00'}
                </span>
              </div>

              <button 
                onClick={() => showToast(`Selected ${cheapestStore?.store || 'store'}! Saving order...`)}
                className="w-full py-3 rounded-xl bg-[#FF8C38] hover:brightness-95 text-white font-bold text-sm transition-colors shadow-sm cursor-pointer"
              >
                Save & Go To Store →
              </button>

              <button 
                onClick={handleShareLink}
                className="w-full py-2.5 rounded-xl border border-[#E0E8E1] text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                Share Comparison
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}