import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useSearchParams } from 'react-router-dom';
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

// --- HOME PAGE COMPONENT ---
function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/popular')
      .then(res => {
        setProducts(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching popular products:", err);
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
      {/* Hero Section */}
      <div style={{ textAlign: 'center', background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: 'white', padding: '50px 20px', borderRadius: '24px', marginBottom: '40px', boxShadow: '0 10px 25px rgba(5, 150, 105, 0.2)' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '900', marginBottom: '16px' }}>Smart Grocery Shopping Made Simple</h1>
        <p style={{ fontSize: '1.1rem', opacity: '0.9', maxWidth: '600px', margin: '0 auto 24px' }}>Compare real-time prices across major South African retailers instantly.</p>

        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', maxWidth: '500px', margin: '0 auto', background: 'white', padding: '8px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <input
            type="text"
            placeholder="Search for milk, sugar, bread..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flexGrow: 1, border: 'none', padding: '12px 16px', fontSize: '1rem', outline: 'none', borderRadius: '12px' }}
          />
          <button type="submit" className="btn-primary">Search</button>
        </form>
      </div>

      <h2 style={{ fontSize: '1.5rem', fontWeight: '800', marginBottom: '24px' }}>Popular Essentials</h2>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading products...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
          {products.map(product => (
            <div key={product.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '12px', marginBottom: '16px', padding: '10px' }}>
                  <img src={product.imageUrl || 'https://via.placeholder.com/150'} alt={product.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', color: '#059669', background: '#d1fae5', padding: '4px 8px', borderRadius: '6px' }}>{product.store}</span>
                <h3 style={{ fontSize: '0.95rem', fontWeight: '700', margin: '10px 0', color: '#1e293b', height: '40px', overflow: 'hidden' }}>{product.name}</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: '900', color: '#0f172a' }}>{product.formattedPrice || `R ${product.price.toFixed(2)}`}</span>
                <button onClick={() => navigate(`/search?q=${encodeURIComponent(product.name)}`)} className="btn-secondary" style={{ fontSize: '0.8rem', padding: '8px 14px' }}>
                  Compare
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- SEARCH PAGE COMPONENT ---
function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [results, setResults] = useState(null);
  const [fetchedQuery, setFetchedQuery] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    if (!query) return;

    axios.get(`/api/search?q=${encodeURIComponent(query)}`)
      .then(res => {
        setResults(res.data);
        setFetchedQuery(query);
      })
      .catch(() => {
        setResults([]);
        setFetchedQuery(query);
      });
  }, [query]);

  const loading = Boolean(query) && fetchedQuery !== query;
  const displayResults = query ? (results ?? []) : [];

  const handleAddToCart = (product) => {
    addToCart(product);
    setToastMsg(`Added ${product.name} to basket!`);
    setTimeout(() => setToastMsg(''), 2500);
  };

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      {/* Toast notification */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: '#059669', color: 'white', padding: '12px 24px', borderRadius: '12px',
          fontWeight: '700', fontSize: '0.9rem', zIndex: 999, boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          {toastMsg}
        </div>
      )}

      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '8px' }}>Results for "{query}"</h1>
      <p style={{ color: '#64748b', marginBottom: '30px' }}>Found {displayResults.length} matching products across stores.</p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>Searching live stores...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
          {displayResults.map(product => (
            <div key={product.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '12px', marginBottom: '16px', padding: '10px' }}>
                  <img src={product.imageUrl} alt={product.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', color: '#059669', background: '#d1fae5', padding: '4px 8px', borderRadius: '6px' }}>{product.store}</span>
                <h3 style={{ fontSize: '0.95rem', fontWeight: '700', margin: '10px 0', color: '#1e293b' }}>{product.name}</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: '900', color: '#0f172a' }}>{product.formattedPrice || `R ${product.price.toFixed(2)}`}</span>
                <button onClick={() => handleAddToCart(product)} className="btn-primary" style={{ fontSize: '0.8rem', padding: '8px 14px' }}>
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

// --- BASKET PAGE COMPONENT ---
function BasketPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = getCart();
    setItems(saved);
    setLoading(false);
  }, []);

  const updateQty = (id, delta) => {
    const updated = items.map(i => {
      if (i.id === id) {
        const newQty = (i.quantity || 1) + delta;
        return newQty > 0 ? { ...i, quantity: newQty } : null;
      }
      return i;
    }).filter(Boolean);

    setItems(updated);
    saveCart(updated);
  };

  const clearCart = () => {
    setItems([]);
    saveCart([]);
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0).toFixed(2);
  };

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '900', margin: 0 }}>Shopping Basket</h1>
        {items.length > 0 && (
          <button onClick={clearCart} className="btn-secondary" style={{ fontSize: '0.85rem' }}>
            Clear Basket
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading basket...</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 40px', background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <p style={{ fontSize: '2rem', marginBottom: '12px' }}>🛒</p>
          <p style={{ color: '#64748b', fontWeight: '600', fontSize: '1.1rem', marginBottom: '20px' }}>Your basket is currently empty.</p>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <button className="btn-primary">Start Shopping</button>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '30px', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {items.map(item => (
              <div key={item.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ width: '60px', height: '60px', background: '#f8fafc', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', flexShrink: 0 }}>
                    <img src={item.imageUrl} alt={item.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', fontWeight: '800', color: '#059669', textTransform: 'uppercase' }}>{item.store}</span>
                    <h4 style={{ margin: '2px 0 4px', fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>{item.name}</h4>
                    <p style={{ margin: 0, color: '#64748b', fontWeight: '800', fontSize: '0.9rem' }}>{item.formattedPrice || `R ${item.price.toFixed(2)}`}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button onClick={() => updateQty(item.id, -1)} className="btn-secondary" style={{ padding: '6px 12px' }}>-</button>
                  <span style={{ fontWeight: 800, minWidth: '20px', textAlign: 'center' }}>{item.quantity || 1}</span>
                  <button onClick={() => updateQty(item.id, 1)} className="btn-secondary" style={{ padding: '6px 12px' }}>+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ background: '#fff', position: 'sticky', top: '90px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.2rem', fontWeight: '900' }}>Order Summary</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', color: '#64748b', fontSize: '0.9rem', fontWeight: '600' }}>
              <span>Total Items</span>
              <span style={{ color: '#0f172a', fontWeight: '800' }}>{items.reduce((acc, i) => acc + (i.quantity || 1), 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', paddingTop: '16px', marginBottom: '20px' }}>
              <span style={{ fontWeight: '900', fontSize: '1.1rem' }}>Total</span>
              <span style={{ fontWeight: '900', fontSize: '1.2rem', color: '#059669' }}>R {calculateTotal()}</span>
            </div>
            <button onClick={() => alert("Proceeding to store comparison...")} className="btn-primary" style={{ width: '100%', textAlign: 'center' }}>
              Compare Store Totals
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- MAIN SHELL ---
export default function App() {
  const [cartCount, setCartCount] = useState(0);

  // Keep nav cart count in sync
  useEffect(() => {
    const update = () => {
      const items = getCart();
      setCartCount(items.reduce((acc, i) => acc + (i.quantity || 1), 0));
    };
    update();
    window.addEventListener('storage', update);
    // Poll every second to catch updates from same tab
    const interval = setInterval(update, 1000);
    return () => {
      window.removeEventListener('storage', update);
      clearInterval(interval);
    };
  }, []);

  return (
    <Router>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <nav style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
          <Link to="/" style={{ textDecoration: 'none', fontWeight: '900', fontSize: '1.25rem', color: '#0f172a' }}>🛒 SmartBasket</Link>
          <div style={{ display: 'flex', gap: '24px', fontWeight: '700', fontSize: '0.9rem', alignItems: 'center' }}>
            <Link to="/" style={{ textDecoration: 'none', color: '#334155' }}>Home</Link>
            <Link to="/basket" style={{ textDecoration: 'none', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
              My Basket
              {cartCount > 0 && (
                <span style={{ background: '#059669', color: 'white', borderRadius: '999px', fontSize: '0.7rem', fontWeight: '900', padding: '2px 7px', lineHeight: 1.4 }}>
                  {cartCount}
                </span>
              )}
            </Link>
          </div>
        </nav>
        <main style={{ flexGrow: 1 }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/basket" element={<BasketPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}