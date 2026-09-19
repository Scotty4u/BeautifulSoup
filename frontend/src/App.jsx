import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useSearchParams, useParams, useLocation } from 'react-router-dom';
import axios from 'axios';

axios.defaults.withCredentials = true;
axios.defaults.baseURL = 'http://localhost:5000';

// --- CART HELPERS (localStorage) ---
const CART_KEY = 'smartbasket_cart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

function addToCart(product) {
  const items = getCart();
  const existing = items.find(i => i.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    items.push({ ...product, quantity: 1 });
  }
  saveCart(items);
}

// --- TOAST NOTIFICATION CONTEXT ---
const ToastContext = createContext();
export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 4000);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <span>{toast.message}</span>
            <button onClick={() => removeToast(toast.id)}>&times;</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// --- SKELETON LOADER COMPONENT ---
function SkeletonCard() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '340px' }}>
      <div>
        <div className="skeleton-box" style={{ height: '160px', borderRadius: '12px', marginBottom: '16px' }}></div>
        <div className="skeleton-box" style={{ width: '35%', height: '18px', borderRadius: '6px', marginBottom: '12px' }}></div>
        <div className="skeleton-box" style={{ width: '90%', height: '16px', borderRadius: '4px', marginBottom: '8px' }}></div>
        <div className="skeleton-box" style={{ width: '70%', height: '16px', borderRadius: '4px' }}></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
        <div className="skeleton-box" style={{ width: '35%', height: '24px', borderRadius: '4px' }}></div>
        <div className="skeleton-box" style={{ width: '80px', height: '32px', borderRadius: '12px' }}></div>
      </div>
    </div>
  );
}

// --- HOME PAGE ---
function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/popular')
      .then(res => {
        setProducts(res.data || []);
        setLoading(false);
      })
      .catch(() => {
        setProducts([]);
        setLoading(false);
      });
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <div style={{ textAlign: 'center', background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: 'white', padding: '50px 20px', borderRadius: '24px', marginBottom: '40px', boxShadow: '0 10px 25px rgba(5, 150, 105, 0.2)' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '900', marginBottom: '16px' }}>Smart Grocery Shopping Made Simple</h1>
        <p style={{ fontSize: '1.1rem', opacity: '0.9', maxWidth: '600px', margin: '0 auto 24px' }}>Compare real-time prices across major South African retailers instantly.</p>

        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', maxWidth: '500px', margin: '0 auto', background: 'white', padding: '8px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <input
            type="text"
            placeholder="Search for milk, sugar, bread..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flexGrow: 1, border: 'none', padding: '12px 16px', fontSize: '1rem', outline: 'none', borderRadius: '12px', color: '#0f172a' }}
          />
          <button type="submit" className="btn-primary">Search</button>
        </form>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '800', margin: 0 }}>Popular Essentials</h2>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
          {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
          {products.map(product => (
            <div key={product.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '12px', marginBottom: '16px', padding: '10px', cursor: 'pointer' }} onClick={() => navigate(`/product/${product.id}`, { state: { product } })}>
                  <img src={product.imageUrl || 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'} alt={product.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', color: '#059669', background: '#d1fae5', padding: '4px 8px', borderRadius: '6px' }}>{product.store}</span>
                <h3 onClick={() => navigate(`/product/${product.id}`, { state: { product } })} style={{ fontSize: '0.95rem', fontWeight: '700', margin: '10px 0', color: '#1e293b', height: '40px', overflow: 'hidden', cursor: 'pointer' }}>{product.name}</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: '900', color: '#0f172a' }}>{product.formattedPrice || `R ${product.price.toFixed(2)}`}</span>
                <button onClick={() => { addToCart(product); }} className="btn-secondary" style={{ fontSize: '0.8rem', padding: '8px 14px' }}>
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- SEARCH PAGE ---
function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!query) return;
    setLoading(true);
    axios.get(`/api/search?q=${encodeURIComponent(query)}`)
      .then(res => {
        setResults(res.data || []);
        setLoading(false);
      })
      .catch(() => {
        setResults([]);
        setLoading(false);
        showToast("Failed to fetch search results.", "error");
      });
  }, [query]);

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '8px' }}>Results for "{query}"</h1>
      <p style={{ color: '#64748b', marginBottom: '30px' }}>Found {results?.length || 0} matching products across stores.</p>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
          {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
          {results.map(product => (
            <div key={product.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '12px', marginBottom: '16px', padding: '10px', cursor: 'pointer' }} onClick={() => navigate(`/product/${product.id}`, { state: { product } })}>
                  <img src={product.imageUrl} alt={product.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', color: '#059669', background: '#d1fae5', padding: '4px 8px', borderRadius: '6px' }}>{product.store}</span>
                <h3 onClick={() => navigate(`/product/${product.id}`, { state: { product } })} style={{ fontSize: '0.95rem', fontWeight: '700', margin: '10px 0', color: '#1e293b', cursor: 'pointer' }}>{product.name}</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: '900', color: '#0f172a' }}>{product.formattedPrice || `R ${product.price.toFixed(2)}`}</span>
                <button onClick={() => { addToCart(product); showToast(`Added ${product.name} to basket!`); }} className="btn-primary" style={{ fontSize: '0.8rem', padding: '8px 14px' }}>
                  Add to Basket
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- PRODUCT DETAIL PAGE ---
function ProductPage() {
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
  const [newRating, setNewRating] = useState(5);

  useEffect(() => {
    const productName = product?.name || productId.replace(/^(pnp|shoprite|checkers|woolworths)_/, '').replace(/-/g, ' ');

    axios.get(`/api/compare?q=${encodeURIComponent(productName)}`)
      .then(res => {
        setComparison(res.data);
        if (!product && res.data?.found && res.data.cheapest) {
          setProduct(res.data.cheapest);
        }
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
    axios.post(`/api/reviews/${productId}`, { rating: newRating, comment: newComment })
      .then(() => {
        showToast("Review submitted successfully!");
        setNewComment('');
        return axios.get(`/api/reviews/${productId}`);
      })
      .then(res => setReviews(res.data))
      .catch(() => showToast("Please log in to submit reviews.", "error"));
  };

  return (
    <div className="container" style={{ padding: '40px 20px', maxWidth: '1000px' }}>
      {loading && !product ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>Loading product details...</div>
      ) : (
        <div className="card" style={{ background: 'white', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', padding: '32px', marginBottom: '40px', alignItems: 'center' }}>
          <div style={{ height: '320px', background: '#f8fafc', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <img 
              src={product?.imageUrl || 'https://placehold.co/400x400/f8fafc/94a3b8?text=Product+Image'} 
              alt={product?.name || 'Product'} 
              onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/400x400/f8fafc/94a3b8?text=Product+Image'; }}
              style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} 
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', color: '#059669', background: '#d1fae5', padding: '4px 10px', borderRadius: '6px' }}>
                {product?.store || 'Retailer Item'}
              </span>
              <h1 style={{ fontSize: '1.75rem', fontWeight: '900', color: '#0f172a', margin: '12px 0 8px', lineHeight: '1.2' }}>
                {product?.name || productId}
              </h1>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: '900', color: '#059669' }}>
              {product?.formattedPrice || (product?.price ? `R ${product.price.toFixed(2)}` : 'Price unavailable')}
            </div>
            <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: '1.5', margin: 0 }}>
              Real-time store data verified. Compare alternative prices across competing South African retailers below.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
              <button 
                onClick={() => { if (product) { addToCart(product); showToast(`Added ${product.name} to basket!`); } }} 
                className="btn-primary" 
                style={{ flexGrow: 1, textAlign: 'center', padding: '12px 20px' }}
              >
                Add to Basket
              </button>
            </div>
          </div>
        </div>
      )}

      {comparison?.found && comparison.products.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', marginBottom: '16px' }}>Compare Across Other Retailers</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
            {comparison.products.map(p => (
              <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#fff' }}>
                <div>
                  <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '8px', marginBottom: '8px', padding: '4px' }}>
                    <img 
                      src={p.imageUrl || 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'} 
                      alt={p.name} 
                      onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'; }}
                      style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} 
                    />
                  </div>
                  <span style={{ fontSize: '0.7rem', fontWeight: '800', color: '#059669', textTransform: 'uppercase' }}>{p.store}</span>
                  <h4 style={{ margin: '6px 0', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', height: '36px', overflow: 'hidden' }}>{p.name}</h4>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                  <span style={{ fontWeight: '900', fontSize: '1rem', color: '#0f172a' }}>{p.formattedPrice || `R ${p.price.toFixed(2)}`}</span>
                  <button onClick={() => { addToCart(p); showToast(`Added ${p.name} to basket!`); }} className="btn-secondary" style={{ fontSize: '0.75rem', padding: '6px 10px' }}>
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ background: 'white', marginBottom: '40px' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: '900', marginBottom: '16px' }}>Customer Reviews</h3>
        {reviews.length === 0 ? <p style={{ color: '#64748b', marginBottom: '20px' }}>No reviews for this product yet. Be the first to share your thoughts!</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
            {reviews.map(r => (
              <div key={r.id} style={{ padding: '12px', background: '#f8fafc', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontWeight: '800', fontSize: '0.9rem' }}>{r.author_name}</span>
                  <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>{'★'.repeat(r.rating)}</span>
                </div>
                <p style={{ margin: 0, color: '#334155', fontSize: '0.9rem' }}>{r.comment}</p>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{r.date}</span>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleReviewSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
          <h4 style={{ margin: 0, fontWeight: '800' }}>Leave a Review</h4>
          <select value={newRating} onChange={(e) => setNewRating(Number(e.target.value))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
            <option value={5}>5 Stars - Excellent</option>
            <option value={4}>4 Stars - Good</option>
            <option value={3}>3 Stars - Average</option>
            <option value={2}>2 Stars - Poor</option>
            <option value={1}>1 Star - Terrible</option>
          </select>
          <textarea placeholder="Write your experience with this product..." value={newComment} onChange={(e) => setNewComment(e.target.value)} rows={3} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} required />
          <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start' }}>Post Review</button>
        </form>
      </div>

      {relatedProducts.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', marginBottom: '16px' }}>Related Products</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
            {relatedProducts.map(rp => (
              <div key={rp.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => navigate(`/product/${rp.id}`, { state: { product: rp } })}>
                <div>
                  <div style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '10px', marginBottom: '12px', padding: '8px' }}>
                    <img 
                      src={rp.imageUrl || 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'} 
                      alt={rp.name} 
                      onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/200x200/f8fafc/94a3b8?text=No+Image'; }}
                      style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} 
                    />
                  </div>
                  <span style={{ fontSize: '0.7rem', fontWeight: '800', color: '#059669', textTransform: 'uppercase' }}>{rp.store}</span>
                  <h4 style={{ margin: '6px 0', fontSize: '0.9rem', fontWeight: '700', color: '#1e293b', height: '36px', overflow: 'hidden' }}>{rp.name}</h4>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                  <span style={{ fontWeight: '900', fontSize: '1rem', color: '#0f172a' }}>{rp.formattedPrice || `R ${rp.price.toFixed(2)}`}</span>
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/product/${rp.id}`, { state: { product: rp } }); }} className="btn-secondary" style={{ fontSize: '0.75rem', padding: '6px 10px' }}>
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- BASKET PAGE ---
function BasketPage() {
  const [items, setItems] = useState([]);
  const { showToast } = useToast();

  useEffect(() => {
    setItems(getCart());
  }, []);

  const updateQty = (id, delta) => {
    const updated = items.map(i => i.id === id ? { ...i, quantity: Math.max(1, (i.quantity || 1) + delta) } : i);
    setItems(updated);
    saveCart(updated);
  };

  const removeItem = (id) => {
    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    saveCart(updated);
    showToast("Item removed from basket.");
  };

  const saveToProfile = () => {
    axios.post('/api/db/save-basket', { name: 'My Saved Basket', items })
      .then(() => showToast("Basket successfully saved to your profile!"))
      .catch(() => showToast("Please log in to save baskets to your profile.", "error"));
  };

  const calculateTotal = () => items.reduce((sum, i) => sum + (i.price * (i.quantity || 1)), 0).toFixed(2);

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '24px' }}>Shopping Basket</h1>
      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <p style={{ color: '#64748b', fontWeight: '600' }}>Your basket is empty.</p>
          <Link to="/" style={{ textDecoration: 'none' }}><button className="btn-primary" style={{ marginTop: '12px' }}>Start Shopping</button></Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '30px', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {items.map(item => (
              <div key={item.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <img src={item.imageUrl} alt={item.name} style={{ width: '60px', height: '60px', objectFit: 'contain' }} />
                  <div>
                    <span style={{ fontSize: '0.7rem', fontWeight: '800', color: '#059669', textTransform: 'uppercase' }}>{item.store}</span>
                    <h4 style={{ margin: '2px 0', fontWeight: 700, fontSize: '0.95rem' }}>{item.name}</h4>
                    <p style={{ margin: 0, color: '#64748b', fontWeight: '800' }}>{item.formattedPrice || `R ${item.price}`}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button onClick={() => updateQty(item.id, -1)} className="btn-secondary" style={{ padding: '4px 10px' }}>-</button>
                  <span style={{ fontWeight: 800 }}>{item.quantity || 1}</span>
                  <button onClick={() => updateQty(item.id, 1)} className="btn-secondary" style={{ padding: '4px 10px' }}>+</button>
                  <button onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 'bold' }}>&times;</button>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ background: '#fff' }}>
            <h3 style={{ margin: '0 0 16px', fontWeight: '900' }}>Summary</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', paddingTop: '16px', marginBottom: '20px' }}>
              <span style={{ fontWeight: '900' }}>Total</span>
              <span style={{ fontWeight: '900', color: '#059669', fontSize: '1.2rem' }}>R {calculateTotal()}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button onClick={saveToProfile} className="btn-primary" style={{ width: '100%' }}>Save to Profile</button>
              <button onClick={() => showToast("Shared with group members successfully!")} className="btn-secondary" style={{ width: '100%' }}>Share with Group</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- SAVED BASKETS PAGE ---
function SavedBasketsPage() {
  const [baskets, setBaskets] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/db/saved-baskets')
      .then(res => {
        setBaskets(res.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '24px' }}>Saved Shopping Baskets</h1>
      {loading ? <p>Loading saved baskets...</p> : baskets.length === 0 ? (
        <p style={{ color: '#64748b' }}>No saved baskets found in your profile.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
          {baskets.map(b => (
            <div key={b.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: '0 0 8px', fontWeight: '800' }}>{b.name}</h3>
                <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: '#64748b' }}>{b.items.length} items &bull; {b.date}</p>
              </div>
              <button onClick={() => navigate(`/saved/${b.id}`)} className="btn-secondary" style={{ width: '100%' }}>View Details</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- SAVED BASKET DETAIL PAGE ---
function SavedBasketDetailPage() {
  const { basketId } = useParams();
  const [basket, setBasket] = useState(null);
  const [users, setUsers] = useState([]);
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    axios.get('/api/db/saved-baskets')
      .then(res => {
        const found = (res.data || []).find(b => b.id === Number(basketId));
        setBasket(found);
      })
      .catch(() => {});
  }, [basketId]);

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

  const inviteUser = (userId) => {
    axios.post(`/api/saved-baskets/${basketId}/invite`, { user_id: userId })
      .then(() => showToast("Collaboration invite sent successfully!"))
      .catch(() => showToast("Failed to send invite.", "error"));
  };

  if (!basket) return <div className="container" style={{ padding: '40px' }}>Loading basket details...</div>;

  return (
    <div className="container" style={{ padding: '40px 20px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '8px' }}>{basket.name}</h1>
      <p style={{ color: '#64748b', marginBottom: '24px' }}>Created on {basket.date}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '40px' }}>
        {basket.items.map(item => (
          <div key={item.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: '700' }}>{item.name} ({item.store})</span>
            <span style={{ fontWeight: '900', color: '#059669' }}>{item.formattedPrice || `R ${item.price}`} x {item.quantity}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ background: 'white' }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: '900', marginBottom: '16px' }}>Invite Collaborators</h3>
        <input type="text" placeholder="Search user by username..." value={searchUserQuery} onChange={handleUserSearch} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', marginBottom: '12px' }} />
        {users.map(u => (
          <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#f8fafc', borderRadius: '8px', marginBottom: '8px', alignItems: 'center' }}>
            <span style={{ fontWeight: '700' }}>{u.username}</span>
            <button onClick={() => inviteUser(u.id)} className="btn-primary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>Invite</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- COLLABORATIVE LISTS PAGE ---
function CollaborativeListsPage() {
  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '16px' }}>Collaborative Group Lists</h1>
      <p style={{ color: '#64748b', marginBottom: '24px' }}>Collaborate on grocery budgets with your team members in real-time.</p>
      <Link to="/saved" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>View My Saved & Shared Lists</Link>
    </div>
  );
}

// --- NOTIFICATIONS PAGE ---
function NotificationsPage() {
  const [notifs, setNotifs] = useState([]);
  const { showToast } = useToast();

  useEffect(() => {
    axios.get('/api/notifications')
      .then(res => setNotifs(res.data || []))
      .catch(() => {});
  }, []);

  const respond = (id, action) => {
    axios.post(`/api/notifications/${id}/respond`, { action })
      .then(() => {
        showToast(`Invite ${action}ed!`);
        setNotifs(notifs.map(n => n.id === id ? { ...n, status: 'read' } : n));
      })
      .catch(() => showToast("Action failed.", "error"));
  };

  return (
    <div className="container" style={{ padding: '40px 20px', maxWidth: '800px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '24px' }}>Notifications</h1>
      {notifs.length === 0 ? <p style={{ color: '#64748b' }}>No notifications found.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {notifs.map(n => (
            <div key={n.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: n.status === 'unread' ? '#f0fdf4' : '#fff' }}>
              <div>
                <p style={{ margin: '0 0 4px', fontWeight: '700' }}>{n.message}</p>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{n.date}</span>
              </div>
              {n.message.includes('invited you') && n.status === 'unread' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => respond(n.id, 'accept')} className="btn-primary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>Accept</button>
                  <button onClick={() => respond(n.id, 'decline')} className="btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>Decline</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- ACCOUNT PAGE ---
function AccountPage() {
  const navigate = useNavigate();
  return (
    <div className="container" style={{ padding: '40px 20px', maxWidth: '800px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '8px' }}>Account Dashboard</h1>
      <p style={{ color: '#64748b', marginBottom: '32px' }}>Manage your lists and preferences.</p>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/saved')} className="btn-primary">View Saved Baskets</button>
        <button onClick={() => navigate('/collaborative')} className="btn-secondary">Collaborative Lists</button>
        <button onClick={() => navigate('/notifications')} className="btn-secondary">Notifications</button>
        <a href="http://localhost:5000/logout" className="btn-secondary" style={{ textDecoration: 'none', color: '#dc2626' }}>Log Out</a>
      </div>
    </div>
  );
}

// --- ONBOARDING PAGE ---
function OnboardingPage() {
  const navigate = useNavigate();
  const [store, setStore] = useState('Checkers');

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('preferred_stores', store);
    axios.post('/onboarding', formData)
      .then(() => navigate('/account'))
      .catch(() => navigate('/account'));
  };

  return (
    <div className="container" style={{ padding: '60px 20px', maxWidth: '500px' }}>
      <div className="card" style={{ background: 'white' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '900', marginBottom: '8px' }}>Welcome! Choose Preferences</h1>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px' }}>
          <label style={{ fontWeight: '700' }}>Preferred Store:</label>
          <select value={store} onChange={(e) => setStore(e.target.value)} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
            <option value="Checkers">Checkers</option>
            <option value="Shoprite">Shoprite</option>
            <option value="Pick n Pay">Pick n Pay</option>
            <option value="Woolworths">Woolworths</option>
          </select>
          <button type="submit" className="btn-primary" style={{ width: '100%' }}>Save & Continue</button>
        </form>
      </div>
    </div>
  );
}

// --- MAIN SHELL / ROUTER ---
export default function App() {
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    const update = () => {
      const items = getCart();
      setCartCount(items.reduce((acc, i) => acc + (i.quantity || 1), 0));
    };
    update();
    window.addEventListener('storage', update);
    const interval = setInterval(update, 1000);
    return () => {
      window.removeEventListener('storage', update);
      clearInterval(interval);
    };
  }, []);

  return (
    <ToastProvider>
      <Router>
        <style>{`
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
          .skeleton-box { animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite; background-color: #e2e8f0; }
        `}</style>

        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <nav style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <Link to="/" style={{ textDecoration: 'none', fontWeight: '900', fontSize: '1.25rem', color: '#0f172a' }}>🛒 SmartBasket</Link>
            <div style={{ display: 'flex', gap: '24px', fontWeight: '700', fontSize: '0.9rem', alignItems: 'center' }}>
              <Link to="/" style={{ textDecoration: 'none', color: '#334155' }}>Home</Link>
              <Link to="/basket" style={{ textDecoration: 'none', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                My Basket
                {cartCount > 0 && <span style={{ background: '#059669', color: 'white', borderRadius: '999px', fontSize: '0.7rem', fontWeight: '900', padding: '2px 7px' }}>{cartCount}</span>}
              </Link>
              <Link to="/collaborative" style={{ textDecoration: 'none', color: '#334155' }}>Group Lists</Link>
              <Link to="/notifications" style={{ textDecoration: 'none', color: '#334155' }}>Notifications</Link>
              <Link to="/account" style={{ textDecoration: 'none', color: '#334155' }}>Account</Link>
            </div>
          </nav>

          <main style={{ flexGrow: 1 }}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/product/:productId" element={<ProductPage />} />
              <Route path="/basket" element={<BasketPage />} />
              <Route path="/saved" element={<SavedBasketsPage />} />
              <Route path="/saved/:basketId" element={<SavedBasketDetailPage />} />
              <Route path="/collaborative" element={<CollaborativeListsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
            </Routes>
          </main>
        </div>
      </Router>
    </ToastProvider>
  );
}