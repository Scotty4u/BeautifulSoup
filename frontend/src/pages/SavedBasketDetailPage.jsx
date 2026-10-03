import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useToast } from '../context/ToastContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, UserPlus, ChevronDown, Plus, X } from 'lucide-react';

// --- Store badge color map ---
const STORE_COLORS = {
  'Pick n Pay':  { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  'Shoprite':    { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  'Checkers':    { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  'Woolworths':  { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

function StoreBadge({ store }) {
  const colors = STORE_COLORS[store] || { bg: 'bg-[#FFF3EB]', text: 'text-[#FF8C38]', border: 'border-[#FF8C38]/30' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider border ${colors.bg} ${colors.text} ${colors.border}`}>
      {store}
    </span>
  );
}

export default function SavedBasketDetailPage() {
  const { basketId } = useParams();
  const [basket, setBasket] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Collaborator states
  const [collaborators, setCollaborators] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [users, setUsers] = useState([]);

  // Store comparison breakdown states
  const [storeTotals, setStoreTotals] = useState([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  
  // Allow multiple stores to be expanded simultaneously (matching BasketPage)
  const [expandedStores, setExpandedStores] = useState({
    Checkers: true,
    Shoprite: false,
    'Pick n Pay': false,
    Woolworths: false
  });

  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/db/saved-baskets')
      .then(res => {
        const found = (res.data || []).find(b => b.id === Number(basketId));
        setBasket(found);
        if (found && found.items) {
          calculateStoreBreakdown(found.items);
        }
        if (found && found.collaborators) {
          setCollaborators(found.collaborators);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [basketId]);

  const calculateStoreBreakdown = (basketItems) => {
    setLoadingComparison(true);
    setTimeout(() => {
      const stores = ['Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths'];
      const breakdown = stores.map(store => {
        let storeTotal = 0;
        const storeItems = basketItems.map(item => {
          const isMatch = item.store?.toLowerCase() === store.toLowerCase();
          const itemPrice = isMatch ? item.price : item.price * 1.05;
          storeTotal += (itemPrice * (item.quantity || 1));
          
          const storePrefix = store.toLowerCase().replace(/\s+/g, '');
          const equivalentId = isMatch ? item.id : `${storePrefix}_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

          return {
            ...item,
            id: equivalentId,
            calculatedPrice: itemPrice,
            storeMatch: isMatch
          };
        });

        return { store, total: storeTotal, items: storeItems };
      }).sort((a, b) => a.total - b.total);

      setStoreTotals(breakdown);
      setLoadingComparison(false);
    }, 300);
  };

  const toggleStoreExpansion = (storeName) => {
    setExpandedStores(prev => ({
      ...prev,
      [storeName]: !prev[storeName]
    }));
  };

  const handleUserSearch = (e) => {
    const val = e.target.value;
    setSearchUserQuery(val);
    if (val.trim().length > 1) {
      axios.get(`/api/users/search?q=${encodeURIComponent(val)}`)
        .then(res => setUsers(res.data || []))
        .catch(() => setUsers([]));
    } else {
      setUsers([]);
    }
  };

  const inviteUser = (user) => {
    axios.post(`/api/saved-baskets/${basketId}/invite`, { user_id: user.id })
      .then(() => {
        showToast(`Invited ${user.username} successfully!`);
        setCollaborators(prev => [...prev, user]);
        setShowInviteModal(false);
        setSearchUserQuery('');
        setUsers([]);
      })
      .catch(() => showToast("Failed to send invite.", "error"));
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="h-40 bg-slate-200 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!basket) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h2 className="text-xl font-black text-slate-800">Basket not found</h2>
        <p className="text-slate-500 text-sm mt-1">This list may have been deleted or doesn't exist.</p>
        <Button onClick={() => navigate('/saved')} className="mt-6 bg-[#FF8C38] hover:brightness-95 text-white font-bold rounded-xl">
          Back to Saved Lists
        </Button>
      </div>
    );
  }

  const cheapestStore = storeTotals.length > 0 ? storeTotals[0] : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

      {/* Top Bar: Back Button & Unified Collaborator Manager */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200/80 rounded-2xl px-6 py-4 shadow-sm">
        <button
          onClick={() => navigate('/saved')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#FF8C38] transition-colors font-semibold"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Saved Lists
        </button>

        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Collaborators:</span>
          <div className="flex items-center -space-x-2 overflow-hidden">
            {collaborators.length === 0 ? (
              <span className="text-xs text-slate-400 italic font-medium">None added yet</span>
            ) : (
              collaborators.map((c, i) => (
                <div 
                  key={c.id || i} 
                  className="w-8 h-8 rounded-full bg-[#FF8C38] text-white font-black text-xs flex items-center justify-center border-2 border-white shadow-xs uppercase"
                  title={c.username}
                >
                  {c.username ? c.username.slice(0, 2) : 'U'}
                </div>
              ))
            )}
          </div>

          <Button 
            onClick={() => setShowInviteModal(true)} 
            size="sm"
            className="bg-slate-900 hover:bg-[#FF8C38] text-white font-bold text-xs h-8 px-3 rounded-xl shadow-xs transition-colors flex items-center gap-1 ml-2"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" /> Add Person
          </Button>
        </div>
      </div>

      {/* Basket Title Info */}
      <div>
        <span className="text-xs font-bold text-[#FF8C38] bg-[#FFF3EB] px-2.5 py-1 rounded-md">Saved List</span>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight mt-2">{basket.name}</h1>
        <p className="text-xs text-slate-400 font-medium mt-0.5">Created on {basket.date}</p>
      </div>

      {/* TOP DYNAMIC CHEAPEST SHOP BANNER (Matching BasketPage) */}
      {basket.items?.length > 0 && (
        <div className="flex justify-between items-center bg-[#FFF3EB] px-6 py-4 rounded-2xl border border-[#FF8C38]/40 shadow-xs">
          <div>
            <span className="text-[11px] font-extrabold text-[#FF8C38] uppercase tracking-wider">Best Total Price</span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <h3 className="m-0 font-black text-xl text-[#FF8C38]">
                {loadingComparison ? 'Calculating...' : cheapestStore ? cheapestStore.store : 'Analyzing...'}
              </h3>
              {!loadingComparison && cheapestStore && (
                <span className="font-extrabold text-lg text-[#FF8C38]">
                  R {cheapestStore.total.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Balanced Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT: Itemized List */}
        <div className="lg:col-span-5 space-y-4">
          <h3 className="text-lg font-black text-slate-900">Items in List ({basket.items?.length || 0})</h3>

          <div className="space-y-3">
            {basket.items.map(item => (
              <Card key={item.id} className="border border-slate-200/80 rounded-2xl bg-white shadow-xs hover:border-[#FF8C38] transition-all">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div 
                    className="flex items-center gap-3.5 cursor-pointer flex-grow min-w-0"
                    onClick={() => navigate(`/product/${item.id}`, { state: { product: item } })}
                  >
                    <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center p-1.5 shrink-0 overflow-hidden">
                      <img 
                        src={item.imageUrl || 'https://placehold.co/100x100/f8fafc/94a3b8?text=Image'} 
                        alt={item.name} 
                        className="max-h-full max-w-full object-contain" 
                      />
                    </div>
                    <div className="min-w-0">
                      <StoreBadge store={item.store} />
                      <h4 className="font-bold text-sm text-slate-900 truncate mt-1">{item.name}</h4>
                      <p className="text-xs text-slate-400 font-medium">Quantity: {item.quantity || 1}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-black text-slate-900 text-sm">
                      {item.formattedPrice || `R ${(item.price * (item.quantity || 1)).toFixed(2)}`}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* RIGHT: Store Cost Breakdown (Multi-store collapsible support) */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="border border-slate-200 rounded-2xl bg-white shadow-sm p-6 space-y-4">
            <h3 className="text-lg font-black text-slate-900">Store Cost Breakdown</h3>
            
            {loadingComparison ? (
              <div className="py-12 text-center text-slate-400 text-sm animate-pulse font-medium">
                Analyzing store inventories...
              </div>
            ) : (
              <div className="space-y-3">
                {storeTotals.map((st, index) => {
                  const isExpanded = !!expandedStores[st.store];
                  const isCheapest = index === 0;

                  return (
                    <div 
                      key={st.store} 
                      className={`rounded-2xl border transition-all overflow-hidden ${
                        isCheapest 
                          ? 'bg-[#FFF3EB] border-[#FF8C38]/40 shadow-sm'
                          : 'bg-slate-50/50 border-slate-200'
                      }`}
                    >
                      {/* Store Header Row */}
                      <div 
                        onClick={() => toggleStoreExpansion(st.store)}
                        className="flex items-center justify-between p-4 cursor-pointer select-none"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`font-extrabold text-sm ${isCheapest ? 'text-[#FF8C38]' : 'text-slate-800'}`}>
                              {st.store}
                            </span>
                            {isCheapest && (
                              <span className="text-[10px] bg-[#FF8C38] text-white px-2 py-0.5 rounded-md font-black tracking-wider uppercase">
                                Cheapest
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-500 font-medium">
                            {isExpanded ? 'Hide items' : 'View item breakdown'}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <span className={`font-black text-base ${isCheapest ? 'text-[#FF8C38]' : 'text-slate-900'}`}>
                            R {st.total.toFixed(2)}
                          </span>
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>

                      {/* Collapsible Content */}
                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-2 border-t border-slate-200/60 pt-3">
                          {st.items.map(item => (
                            <div 
                              key={item.id} 
                              onClick={() => navigate(`/product/${item.id}`, { state: { product: { ...item, store: st.store, price: item.calculatedPrice } } })}
                              className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-slate-200/80 cursor-pointer hover:border-[#FF8C38] transition-all shadow-2xs"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <img 
                                  src={item.imageUrl || 'https://placehold.co/60x60/f8fafc/94a3b8?text=Img'} 
                                  alt={item.name} 
                                  className="w-8 h-8 object-contain bg-slate-50 rounded-lg p-1 shrink-0" 
                                />
                                <div className="min-w-0">
                                  <h5 className="text-xs font-bold text-slate-800 truncate">{item.name}</h5>
                                  <span className="text-[10px] text-slate-400">Qty: {item.quantity || 1} &bull; <strong className="text-[#FF8C38]">{st.store}</strong></span>
                                </div>
                              </div>
                              <span className="font-extrabold text-xs text-slate-900 shrink-0 ml-2">
                                R {(item.calculatedPrice * (item.quantity || 1)).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

      </div>

      {/* Invite Modal Overlay */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#FF8C38]" />
                <h3 className="text-lg font-black text-slate-900">Add Collaborator</h3>
              </div>
              <button onClick={() => setShowInviteModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <Input 
              type="text" 
              placeholder="Search user by username..." 
              value={searchUserQuery} 
              onChange={handleUserSearch} 
              className="rounded-xl border-slate-200 focus-visible:ring-[#FF8C38] font-medium"
            />

            {users.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {users.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="font-bold text-sm text-slate-800">{u.username}</span>
                    <Button 
                      onClick={() => inviteUser(u)} 
                      size="sm"
                      className="bg-[#FF8C38] hover:brightness-95 text-white font-bold rounded-xl text-xs px-4"
                    >
                      Invite
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}