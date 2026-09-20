import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom';
import axios from 'axios';
import { 
  ShoppingCart, 
  Bookmark, 
  Bell, 
  User, 
  Search, 
  Menu, 
  X,
  ShieldCheck
} from 'lucide-react';

// --- CONTEXT & UTILS ---
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { getCart } from './utils/cart';

// --- PAGES ---
import Home from './pages/Home';
import SearchPage from './pages/SearchPage';
import ProductPage from './pages/ProductPage';
import BasketPage from './pages/BasketPage';
import SavedBasketsPage from './pages/SavedBasketsPage';
import SavedBasketDetailPage from './pages/SavedBasketDetailPage';
import CollaborativeListsPage from './pages/CollaborativeListsPage';
import NotificationsPage from './pages/NotificationsPage';
import AccountPage from './pages/AccountPage';
import OnboardingPage from './pages/OnboardingPage';
import AdminDashboard from './pages/admin/AdminDashboard';

// --- GLOBAL AXIOS CONFIG ---
axios.defaults.withCredentials = true;
axios.defaults.baseURL = 'http://localhost:5000';

// --- NAVIGATION BAR COMPONENT ---
function NavigationBar({ cartCount }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useAuth(); // Consume global user state instantly without reloading
  const navigate = useNavigate();

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setMobileMenuOpen(false);
    }
  };

  const getNavLinkClass = ({ isActive }) => 
    `flex items-center justify-center p-3 rounded-2xl transition-all ${
      isActive 
        ? 'bg-emerald-50 text-emerald-600 shadow-sm' 
        : 'text-slate-500 hover:text-emerald-600 hover:bg-slate-50'
    }`;

  const getMobileNavLinkClass = ({ isActive }) => 
    `flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-colors ${
      isActive 
        ? 'bg-emerald-50 text-emerald-700' 
        : 'text-slate-700 hover:bg-slate-50 hover:text-emerald-600'
    }`;

  return (
    <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-8 py-3.5 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        
        {/* 1. Logo */}
        <NavLink to="/" className="flex items-center gap-2 text-slate-900 font-black text-xl tracking-tight shrink-0">
          <span className="text-2xl">🛒</span> 
          <span>SmartBasket</span>
        </NavLink>

        {/* 2. Global Search Bar */}
        <form 
          onSubmit={handleSearchSubmit} 
          className="hidden md:flex flex-grow max-w-md items-center bg-slate-50 border border-slate-200 rounded-full overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition-all shadow-sm"
        >
          <input
            type="text"
            placeholder="Search for groceries across stores..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-grow bg-transparent px-4 py-2 text-sm text-slate-800 focus:outline-none placeholder:text-slate-400 font-medium"
          />
          <button 
            type="submit" 
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Search className="w-4 h-4 stroke-[2.5]" />
          </button>
        </form>

        {/* 3. Desktop Navigation Icons */}
        <div className="hidden md:flex items-center gap-2">
          {user?.is_admin && (
            <NavLink 
              to="/admin" 
              className={({ isActive }) => `flex items-center gap-1.5 px-3.5 py-2 rounded-2xl font-bold text-xs transition-all border ${
                isActive ? 'bg-purple-100 text-purple-800 border-purple-300 shadow-sm' : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
              }`}
              title="Admin Dashboard"
            >
              <ShieldCheck className="w-4 h-4 stroke-[2.5]" /> Admin
            </NavLink>
          )}

          <NavLink to="/basket" className={({ isActive }) => `relative ${getNavLinkClass({ isActive })}`} title="My Basket">
            <ShoppingCart className="w-6 h-6 stroke-[2.2]" />
            {cartCount > 0 && (
              <span className="absolute top-1 right-1 bg-emerald-600 text-white rounded-full text-[10px] font-black px-1.5 py-0.2 border-2 border-white shadow-sm">
                {cartCount}
              </span>
            )}
          </NavLink>

          <NavLink to="/saved" className={getNavLinkClass} title="Saved Lists">
            <Bookmark className="w-6 h-6 stroke-[2.2]" />
          </NavLink>

          <NavLink to="/notifications" className={getNavLinkClass} title="Notifications">
            <Bell className="w-6 h-6 stroke-[2.2]" />
          </NavLink>

          <NavLink to="/account" className={getNavLinkClass} title="Account">
            <User className="w-6 h-6 stroke-[2.2]" />
          </NavLink>
        </div>

        {/* 4. Mobile Burger Toggle Button */}
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 text-slate-700 hover:text-emerald-600 hover:bg-slate-100 rounded-xl transition-colors focus:outline-none"
          aria-label="Toggle Menu"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>

      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-slate-100 flex flex-col gap-4 animate-in slide-in-from-top duration-200 pb-2">
          <form onSubmit={handleSearchSubmit} className="flex items-center bg-slate-50 border border-slate-200 rounded-full overflow-hidden shadow-sm">
            <input
              type="text"
              placeholder="Search for groceries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-grow bg-transparent px-4 py-2.5 text-sm text-slate-800 focus:outline-none"
            />
            <button type="submit" className="bg-emerald-600 text-white px-4 py-2.5 flex items-center justify-center">
              <Search className="w-4 h-4 stroke-[2.5]" />
            </button>
          </form>

          <div className="flex flex-col gap-1">
            {user?.is_admin && (
              <NavLink 
                to="/admin" 
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl font-bold bg-purple-50 text-purple-700 border border-purple-200 mb-1"
              >
                <ShieldCheck className="w-5 h-5 text-purple-600" /> Admin Dashboard
              </NavLink>
            )}

            <NavLink 
              to="/basket" 
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) => `justify-between ${getMobileNavLinkClass({ isActive })}`}
            >
              <div className="flex items-center gap-3">
                <ShoppingCart className="w-5 h-5 text-emerald-600" /> My Basket
              </div>
              {cartCount > 0 && (
                <span className="bg-emerald-600 text-white rounded-full text-xs font-black px-2.5 py-0.5">
                  {cartCount} items
                </span>
              )}
            </NavLink>

            <NavLink to="/saved" onClick={() => setMobileMenuOpen(false)} className={getMobileNavLinkClass}>
              <Bookmark className="w-5 h-5 text-emerald-600" /> Saved Lists
            </NavLink>

            <NavLink to="/notifications" onClick={() => setMobileMenuOpen(false)} className={getMobileNavLinkClass}>
              <Bell className="w-5 h-5 text-emerald-600" /> Notifications
            </NavLink>

            <NavLink to="/account" onClick={() => setMobileMenuOpen(false)} className={getMobileNavLinkClass}>
              <User className="w-5 h-5 text-emerald-600" /> Account Dashboard
            </NavLink>
          </div>
        </div>
      )}
    </nav>
  );
}

// Protected route wrapper using the global AuthContext
function AdminRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="py-20 text-center font-bold text-slate-500">Checking security clearance...</div>;
  }

  return user && user.is_admin ? children : <Navigate to="/" replace />;
}

// --- MAIN SHELL ---
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
    <AuthProvider>
      <ToastProvider>
        <Router>
          <style>{`
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
            .skeleton-box { animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite; background-color: #e2e8f0; }
          `}</style>

          <div className="min-h-screen flex flex-col bg-slate-50">
            <NavigationBar cartCount={cartCount} />

            <main className="flex-grow">
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
                <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
              </Routes>
            </main>
          </div>
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}