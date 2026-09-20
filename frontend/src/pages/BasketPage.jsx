import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useToast } from '../context/ToastContext';
import { getCart, saveCart } from '../utils/cart';

export default function BasketPage() {
  const [items, setItems] = useState([]);
  const [storeTotals, setStoreTotals] = useState([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  
  // State for controlling the inline save list tab/form
  const [isSaving, setIsSaving] = useState(false);
  const [listName, setListName] = useState('My Saved Basket');

  const [expandedStores, setExpandedStores] = useState({
    Checkers: true,
    Shoprite: false,
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

  const cheapestStore = storeTotals.length > 0 ? storeTotals[0] : null;

  return (
    <div className="container" style={{ padding: '40px 20px', maxWidth: '1280px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '20px' }}>Shopping Basket & Price Comparison</h1>
      
      {/* TOP DYNAMIC CHEAPEST SHOP TAB */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', background: '#f0fdf4', padding: '16px 24px', borderRadius: '16px', border: '1px solid #059669', marginBottom: '28px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', gap: '14px' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: '800', color: '#047857', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Best Total Price</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <h3 style={{ margin: 0, fontWeight: '900', fontSize: '1.25rem', color: '#065f46' }}>
                  {loadingComparison ? 'Calculating...' : cheapestStore ? cheapestStore.store : 'Analyzing...'}
                </h3>
                {!loadingComparison && cheapestStore && (
                  <span style={{ fontWeight: '800', fontSize: '1.1rem', color: '#059669' }}>
                    R {cheapestStore.total.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setIsSaving(!isSaving)} className="btn-primary" style={{ padding: '10px 16px', fontSize: '0.85rem' }}>Save List</button>
              <button onClick={() => showToast("Shared with group members successfully!")} className="btn-secondary" style={{ padding: '10px 16px', fontSize: '0.85rem' }}>Share with Group</button>
            </div>
          </div>

          {/* INLINE ON-SCREEN SAVE TAB/FORM */}
          {isSaving && (
            <form onSubmit={handleSaveSubmit} style={{ display: 'flex', gap: '10px', paddingTop: '12px', borderTop: '1px solid #d1fae5', alignItems: 'center' }}>
              <input 
                type="text" 
                value={listName} 
                onChange={(e) => setListName(e.target.value)} 
                placeholder="Enter list name..." 
                autoFocus
                style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid #059669', background: '#fff', fontSize: '0.9rem', outline: 'none' }}
              />
              <button type="submit" className="btn-primary" style={{ padding: '10px 18px', fontSize: '0.85rem' }}>Confirm Save</button>
              <button type="button" onClick={() => setIsSaving(false)} style={{ background: 'none', border: 'none', color: '#047857', fontWeight: 'bold', cursor: 'pointer', padding: '8px' }}>Cancel</button>
            </form>
          )}

        </div>
      )}

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <p style={{ color: '#64748b', fontWeight: '600' }}>Your basket is empty.</p>
          <Link to="/" style={{ textDecoration: 'none' }}><button className="btn-primary" style={{ marginTop: '12px' }}>Start Shopping</button></Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 480px', gap: '32px', alignItems: 'start' }}>
          
          {/* LEFT COLUMN: ITEMS IN BASKET WITH TOP-RIGHT BIN ICON */}
          <div className="card" style={{ background: '#fff', padding: '24px 28px 28px 28px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 18px 0', height: '36px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                Items in Basket ({items.length})
              </h3>
              <button 
                onClick={handleClearCart} 
                title="Clear entire list"
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#ef4444', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  padding: '6px',
                  borderRadius: '8px',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {items.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' }} onClick={() => navigate(`/product/${item.id}`, { state: { product: item } })}>
                    <img 
                      src={item.imageUrl || 'https://placehold.co/60x60/f8fafc/94a3b8?text=Img'} 
                      alt={item.name} 
                      loading="lazy"
                      decoding="async"
                      style={{ width: '48px', height: '48px', objectFit: 'contain', background: '#fff', borderRadius: '8px', padding: '2px', border: '1px solid #e2e8f0' }} 
                    />
                    <div>
                      <span style={{ fontSize: '0.65rem', fontWeight: '800', color: '#059669', textTransform: 'uppercase' }}>{item.store}</span>
                      <h4 style={{ margin: '1px 0', fontWeight: 700, fontSize: '0.9rem', color: '#0f172a', maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</h4>
                      <p style={{ margin: 0, color: '#64748b', fontWeight: '800', fontSize: '0.85rem' }}>{item.formattedPrice || `R ${item.price}`}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button onClick={() => updateQty(item.id, -1)} className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.8rem' }}>-</button>
                    <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{item.quantity || 1}</span>
                    <button onClick={() => updateQty(item.id, 1)} className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.8rem' }}>+</button>
                    <button onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.2rem', padding: '0 4px' }}>&times;</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT COLUMN: STORE COST BREAKDOWN */}
          <div className="card" style={{ background: '#fff', padding: '24px 28px 28px 28px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '800', margin: '0 0 18px 0', height: '36px', display: 'flex', alignItems: 'center', color: '#0f172a' }}>
              Store Cost Breakdown
            </h3>
            
            {loadingComparison ? (
              <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '14px' }}>Analyzing store inventories and matching images...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {storeTotals.map((st, index) => {
                  const isExpanded = !!expandedStores[st.store];
                  return (
                    <div 
                      key={st.store} 
                      style={{ 
                        borderRadius: '12px',
                        background: index === 0 ? '#f0fdf4' : '#f8fafc',
                        border: index === 0 ? '1px solid #059669' : '1px solid #e2e8f0',
                        overflow: 'hidden',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div 
                        onClick={() => toggleStoreExpansion(st.store)}
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          padding: '16px 20px',
                          cursor: 'pointer',
                          userSelect: 'none'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: '800', fontSize: '1rem', color: index === 0 ? '#065f46' : '#1e293b' }}>{st.store}</span>
                            {index === 0 && (
                              <span style={{ fontSize: '0.65rem', background: '#059669', color: 'white', padding: '2px 8px', borderRadius: '4px', fontWeight: '900' }}>
                                CHEAPEST
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{isExpanded ? 'Hide items' : 'View item breakdown'}</span>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontWeight: '900', fontSize: '1.15rem', color: index === 0 ? '#065f46' : '#0f172a' }}>
                            R {st.total.toFixed(2)}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#64748b', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                            ▼
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '0 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '14px' }}>
                          {st.items.map(item => (
                            <div 
                              key={item.id} 
                              onClick={() => navigate(`/product/${item.id}`, { state: { product: { ...item, store: st.store, price: item.calculatedPrice } } })}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between', 
                                background: 'white', 
                                padding: '10px 14px', 
                                borderRadius: '10px', 
                                border: '1px solid #e2e8f0',
                                cursor: 'pointer',
                                transition: 'transform 0.15s, border-color 0.15s'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#059669'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <img 
                                  src={item.imageUrl || 'https://placehold.co/60x60/f8fafc/94a3b8?text=Img'} 
                                  alt={item.name} 
                                  loading="lazy"
                                  decoding="async"
                                  style={{ width: '42px', height: '42px', objectFit: 'contain', background: '#f8fafc', borderRadius: '6px', padding: '2px' }} 
                                />
                                <div>
                                  <h5 style={{ margin: 0, fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</h5>
                                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Qty: {item.quantity || 1} &bull; <strong style={{ color: '#059669' }}>{st.store}</strong></span>
                                </div>
                              </div>
                              <span style={{ fontWeight: '800', fontSize: '0.9rem', color: '#0f172a' }}>
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
          </div>

        </div>
      )}
    </div>
  );
}