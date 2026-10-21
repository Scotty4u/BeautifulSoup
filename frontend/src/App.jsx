import { useState, useEffect, useRef } from 'react';
import SearchHistoryDropdown from './components/SearchHistoryDropdown';
import CategoryStrip from './components/CategoryStrip';
import StoreLocationPicker from './components/StoreLocationPicker';
import { getShoppingLocation } from './utils/ShoppingLocation';

import { BrowserRouter as Router, Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom';

import axios from 'axios';
import ActiveSessionsPage from './pages/ActiveSessionsPage';
import './styles/smartbasket-mobile.css';

import { 

  ShoppingCart,
  House,
  List,
  ShoppingBasket,


  Bell, 

  User, 

  Search, 

  Menu, 

  X,

  ShieldCheck,
  AlertTriangle

} from 'lucide-react';




import { ToastProvider } from './context/ToastContext';

import { AuthProvider, useAuth } from './context/AuthContext';

import { getCart } from './utils/cart';




import Home from './pages/Home';

import SearchPage from './pages/SearchPage';

import ProductPage from './pages/ProductPage';
import StoreProductsPage from './pages/StoreProductsPage';
import CheckoutPage from './pages/CheckoutPage';
import MyOrdersPage from './pages/MyOrdersPage';
import DeliveryAddressesPage from './pages/DeliveryAdressesPage';
import SavingsDashboard from './pages/SavingsDashboard';
import AdminOrderAnalytics from './pages/admin/AdminOrderAnalytics';
import AdminOrdersPage from './pages/admin/AdminOrdersPage';
import Footer from './components/Footer';

import BasketPage from './pages/BasketPage';
import BasketComparisonPage from './pages/BasketComparisonPage';

import SavedBasketsPage from './pages/SavedBasketsPage';

import SavedBasketDetailPage from './pages/SavedBasketDetailPage';

import CollaborativeListsPage from './pages/CollaborativeListsPage';

import NotificationsPage from './pages/NotificationsPage';

import AccountPage from './pages/AccountPage';

import OnboardingPage from './pages/OnboardingPage';

import AdminDashboard from './pages/admin/AdminDashboard';

import SharedBasketPage from './pages/SharedBasketPage';

import LoginPage from './pages/LoginPage';

import SignupPage from './pages/SignupPage';

import ProfileSettings from './pages/ProfileSettings';




axios.defaults.withCredentials = true;

axios.defaults.baseURL = import.meta.env.DEV
  ? 'http://localhost:5000'
  : window.location.origin;

// Every authenticated mutation carries the CSRF token bound to the Flask session.
// The token cookie is intentionally readable by JavaScript; the auth cookie is HttpOnly.
axios.interceptors.request.use((config) => {
  if (['post', 'put', 'patch', 'delete'].includes((config.method || 'get').toLowerCase())) {
    const part = document.cookie.split('; ').find((entry) => entry.startsWith('sb_csrf='));
    if (part) {
      config.headers = config.headers || {};
      config.headers['X-SmartBasket-CSRF'] = decodeURIComponent(part.slice('sb_csrf='.length));
    }
  }
  return config;
});



// Stable action IDs: one deliberate search counts once even if /api/search is
// requested more than once for filters or React development re-renders.
axios.interceptors.request.use((config) => {
  if ((config.method || 'get').toLowerCase() !== 'get' && !/^(?:\/api\/batch-compare)(?:\?|$)/.test(config.url || '')) return config;
  // A location explicitly chosen by a guest or signed-in user is sent for
  // product discovery. The backend still enforces these retailer filters.
  if (/^\/api\/(?:search|popular|compare|batch-compare)(?:\?|\/|$)/.test(config.url || '')) {
    const shoppingArea = getShoppingLocation();
    if (shoppingArea) {
      config.params = { ...config.params, lat: shoppingArea.lat, lng: shoppingArea.lng,
        radius_km: shoppingArea.radius_km };
    }
  }
  if ((config.method || 'get').toLowerCase() !== 'get' || !/^\/api\/search\/?(?:\?.*)?$/.test(config.url || '')) return config;
  const currentUrl = new URL(window.location.href);
  if (currentUrl.pathname !== '/search') return config;
  const searchActionId = currentUrl.searchParams.get('search_id') ||
    (window.history.state?.key ? `nav_${window.history.state.key}` : null);
  if (searchActionId && /^[a-zA-Z0-9_-]{1,80}$/.test(searchActionId)) {
    config.params = { ...config.params, search_action_id: searchActionId };
  }
  return config;
});

// Fallback for existing BasketPage implementations: when the basket-wide
// comparison API rejects a guest, guide them to sign in. Their local basket
// remains stored; this never redirects for individual product comparisons.
function BasketCompareLoginRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const url = String(error?.config?.url || '');
        const isBasketCompare = /(?:^|\/)api\/batch-compare(?:\?|$)/.test(url);
        const isAuthError = error?.response?.status === 401 &&
          error?.response?.data?.code === 'LOGIN_REQUIRED';
        if (isBasketCompare && isAuthError) {
          const destination = window.location.pathname === '/basket/compare' ? '/basket/compare' : '/basket';
          navigate(`/login?next=${encodeURIComponent(destination)}`, {
            state: { from: destination, reason: 'basket-comparison' },
          });
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, [navigate]);
  return null;
}

function SessionSuspensionGuard() {
  const { user } = useAuth();
  const [seconds, setSeconds] = useState(null);
  const seen = useRef(false);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const markSuspended = () => {
      if (active && !seen.current) {
        seen.current = true;
        setSeconds(3);
      }
    };
    const onSuspendedEvent = () => markSuspended();
    window.addEventListener('smartbasket:account-suspended', onSuspendedEvent);
    const check = async () => {
      if (seen.current) return;
      try {
        await axios.get('/api/me', { withCredentials: true,
          headers: { 'Cache-Control': 'no-cache' } });
      } catch (err) {
        if (err.response?.status === 403 &&
            err.response?.data?.code === 'ACCOUNT_SUSPENDED') markSuspended();
      }
    };
    check();
    const poll = window.setInterval(check, 3500);
    return () => { active = false; window.clearInterval(poll);
      window.removeEventListener('smartbasket:account-suspended', onSuspendedEvent); };
  }, [user?.id]);

  useEffect(() => {
    if (seconds === null) return undefined;
    if (seconds === 0) {
      const backend = axios.defaults.baseURL || window.location.origin;
      // The backend clears the session cookie, then redirects to the frontend.
      window.location.replace(`${backend.replace(/\/$/, '')}/logout`);
      return undefined;
    }
    const countdown = window.setTimeout(() => setSeconds(s => s === null ? null : s - 1), 1000);
    return () => window.clearTimeout(countdown);
  }, [seconds]);

  if (seconds === null) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="suspension-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
        <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-amber-500" />
        <h2 id="suspension-title" className="text-2xl font-black text-slate-900">Account suspended</h2>
        <p className="mt-3 text-slate-600">Your account has been suspended by an administrator.
          You are being logged out automatically.</p>
        <p className="mt-5 font-bold text-red-600" aria-live="polite">
          Logging out in {seconds} second{seconds === 1 ? '' : 's'}…
        </p>
      </div>
    </div>
  );
}

axios.interceptors.response.use(response => response, error => {
  if (error?.response?.status === 403 &&
      error.response?.data?.code === 'ACCOUNT_SUSPENDED') {
    window.dispatchEvent(new Event('smartbasket:account-suspended'));
  }
  return Promise.reject(error);
});


function NavigationBar({ cartCount }) {

  const [searchQuery, setSearchQuery] = useState('');

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyField, setHistoryField] = useState('desktop');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyDesktopRef = useRef(null);
  const historyMobileRef = useRef(null);
  const historyFetchRef = useRef(0);
  const historyCacheRef = useRef({ userId: null, at: 0, data: [] });

  const { user } = useAuth(); //* Consume global user state instantly without reloading*

  const navigate = useNavigate();



  useEffect(() => {
    if (!user) { setUnreadNotifications(0); return undefined; }
    let active = true;
    let requestInFlight = false;
    const refresh = async () => {
      if (!active || requestInFlight || document.visibilityState === 'hidden') return;
      requestInFlight = true;
      try {
        const { data } = await axios.get('/api/notifications/count', {
          withCredentials: true,
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (active) setUnreadNotifications(Number(data?.count) || 0);
      } catch { /* Keep the last known count through network hiccups. */ }
      finally { requestInFlight = false; }
    };
    refresh();
    // The old 20-second interval made member changes look like missed notifications.
    // Poll only while the tab is visible, and refresh immediately on return/focus.
    const interval = window.setInterval(refresh, 5000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('smartbasket:notifications-updated', refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('smartbasket:notifications-updated', refresh);
    };
  }, [user?.id]);

  const isAdmin = user?.is_admin || user?.isAdmin || user?.role === 'admin';



  const readLocalHistory = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('smartbasket:recent-searches') || '[]');
      return Array.isArray(saved) ? saved.filter((q) => typeof q === 'string').slice(0, 8) : [];
    } catch { return []; }
  };

  const rememberSearch = (text) => {
    try {
      const next = [text, ...readLocalHistory().filter((q) => q.toLowerCase() !== text.toLowerCase())].slice(0, 8);
      localStorage.setItem('smartbasket:recent-searches', JSON.stringify(next));
    } catch { /* private browsing can deny storage */ }
  };

  const runSearch = (term) => {
    const text = String(term || '').trim();
    if (!text) return;
    rememberSearch(text);
    historyCacheRef.current.at = 0;
    const searchId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    navigate(`/search?q=${encodeURIComponent(text)}&search_id=${encodeURIComponent(searchId)}`);
    setSearchQuery('');
    setHistoryOpen(false);
    setMobileMenuOpen(false);
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    runSearch(searchQuery);
  };

  const openHistory = async (field) => {
    setHistoryField(field);
    setHistoryOpen(true);
    const id = ++historyFetchRef.current;
    const local = readLocalHistory().map((query) => ({ query, local: true }));
    setHistory(local);
    if (!user) return;
    const cache = historyCacheRef.current;
    if (cache.userId === user.id && Date.now() - cache.at < 30000) {
      const names = new Set(cache.data.map((x) => x.query?.toLowerCase()));
      setHistory([...cache.data, ...local.filter((x) => !names.has(x.query.toLowerCase()))].slice(0, 8));
      return;
    }
    setHistoryLoading(true);
    try {
      const { data } = await axios.get('/api/search/history', { withCredentials: true });
      if (historyFetchRef.current !== id) return;
      const server = Array.isArray(data) ? data : [];
      historyCacheRef.current = { userId: user.id, at: Date.now(), data: server };
      const names = new Set(server.map((x) => x.query?.toLowerCase()));
      setHistory([...server, ...local.filter((x) => !names.has(x.query.toLowerCase()))].slice(0, 8));
    } catch { /* retain the local suggestions */ }
    finally { if (historyFetchRef.current === id) setHistoryLoading(false); }
  };

  const removeHistoryItem = async (item) => {
    const key = String(item.query || '').toLowerCase();
    historyCacheRef.current.at = 0;
    setHistory((entries) => entries.filter((x) => x.query.toLowerCase() !== key));
    try { localStorage.setItem('smartbasket:recent-searches', JSON.stringify(readLocalHistory().filter((q) => q.toLowerCase() !== key))); } catch { /* ignore */ }
    if (item.id != null) {
      try { await axios.delete(`/api/search/history/${encodeURIComponent(item.id)}`, { withCredentials: true }); }
      catch { /* local removal remains, server can be retried later */ }
    }
  };

  useEffect(() => {
    const onOutside = (e) => {
      if (!historyDesktopRef.current?.contains(e.target) && !historyMobileRef.current?.contains(e.target)) setHistoryOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, []);

  const showHistory = (field) => historyOpen && historyField === field && (
    <SearchHistoryDropdown items={history} query={searchQuery} loading={historyLoading}
      onChoose={runSearch} onRemove={removeHistoryItem} onClose={() => setHistoryOpen(false)} />
  );



  const getNavLinkClass = ({ isActive }) => 

    `relative flex h-12 w-12 items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${

      isActive 

        ? 'bg-[#bfe0c2] text-[#1b4332] shadow-sm' 

        : 'text-[#2d5a37] hover:text-[#1b4332] hover:bg-[#cbe6ce]'

    }`;



  const getMobileNavLinkClass = ({ isActive }) => 

    `flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-colors ${

      isActive 

        ? 'bg-[#c2e4c5] text-[#1b4332]' 

        : 'text-[#2d5a37] hover:bg-[#cbe6ce] hover:text-[#1b4332]'

    }`;



  return (

    <nav className="sticky top-0 z-50 border-b border-white/50 bg-[#DDF0E0]/75 px-4 py-2.5 shadow-[0_10px_30px_rgba(16,70,39,0.12)] backdrop-blur-2xl supports-[backdrop-filter]:bg-[#DDF0E0]/70 sm:px-6">

      <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 xl:gap-5">



        {/** Brand and location belong to the same flex group so justify-between
             doesn't push the location selector away from the logo. **/}
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2.5">
          <NavLink to="/" aria-label="SmartBasket home" className="flex shrink-0 items-center gap-2.5 rounded-xl text-[#18472C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D8053] text-white shadow-sm" aria-hidden="true">
              <ShoppingBasket className="h-6 w-6" strokeWidth={2.15} />
            </span>
            <span className="whitespace-nowrap text-lg font-black tracking-tight lg:text-xl">SmartBasket</span>
          </NavLink>
          <StoreLocationPicker />
        </div>

        <div ref={historyDesktopRef} className="relative mx-auto hidden min-w-0 flex-1 md:block md:max-w-md xl:absolute xl:left-1/2 xl:w-full xl:-translate-x-1/2">
          <form onSubmit={handleSearchSubmit}
            role="search"
            className="flex h-10 items-stretch overflow-hidden rounded-2xl border border-[#CFE3D2] bg-white shadow-sm transition-all focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
            <input type="search" autoComplete="off" aria-label="Search groceries across stores"
              placeholder="Search groceries across stores..." value={searchQuery}
              onFocus={() => openHistory('desktop')}
              onKeyDown={(event) => { if (event.key === 'Escape') setHistoryOpen(false); }}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent px-4 text-sm font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400" />
            <button type="submit" aria-label="Search products" title="Search products"
              className="flex h-full w-11 shrink-0 items-center justify-center bg-[#187941] text-white transition-colors hover:bg-[#126334] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white">
              <Search className="h-[19px] w-[19px]" strokeWidth={2.25} aria-hidden="true" />
            </button>
          </form>
          {showHistory('desktop')}
        </div>



        <div className="hidden shrink-0 items-center gap-1 lg:flex xl:gap-1.5">



          {isAdmin && (
            <>
            <NavLink 

              to="/admin" 

              className={({ isActive }) => `flex items-center gap-1.5 px-3.5 py-2 rounded-2xl font-bold text-xs transition-all border ${

                isActive ? 'bg-purple-100 text-purple-800 border-purple-300 shadow-sm' : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'

              }`}

              title="Admin Dashboard"

            >

              <ShieldCheck className="w-4 h-4 stroke-[2.5]" /> Admin

            </NavLink></>

          )}



          <NavLink to="/basket" className={({ isActive }) => `relative ${getNavLinkClass({ isActive })}`} title="My Basket">

            <ShoppingCart className="h-6 w-6" strokeWidth={2.15} />

            {cartCount > 0 && (

              <span className="absolute top-0.5 right-0.5 bg-[#4EAA52] text-white rounded-full text-[10px] font-black px-1.5 py-0.2 border-2 border-[#D4EBD7] shadow-sm">

                {cartCount}

              </span>

            )}

          </NavLink>



          <NavLink to="/saved" className={getNavLinkClass} title="Saved Lists" aria-label="Saved Lists">
            <List className="h-6 w-6" strokeWidth={2.15} />
          </NavLink>

          <NavLink to="/notifications" className={getNavLinkClass} title="Notifications" aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread notification groups` : 'Notifications'}>
            <Bell className="h-6 w-6" strokeWidth={2.15} />
            {unreadNotifications > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-[#4EAA52] text-white rounded-full text-[10px] font-black px-1.5 py-0.2 border-2 border-[#D4EBD7] shadow-sm">
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            )}
          </NavLink>



          <NavLink to="/account" className={getNavLinkClass} title="Account">

            <User className="h-6 w-6" strokeWidth={2.15} />

          </NavLink>

        </div>




        <button 

          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}

          className="lg:hidden rounded-xl p-2 text-[#1b4332] hover:bg-[#c2e4c5] rounded-xl transition-colors focus:outline-none"

          aria-label="Toggle Menu"

        >

          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}

        </button>



      </div>



      <div ref={historyMobileRef} className="relative mx-auto mt-2.5 max-w-7xl md:hidden">
        <form onSubmit={handleSearchSubmit} role="search"
          className="flex h-10 items-stretch overflow-hidden rounded-xl border border-[#CFE3D2] bg-white shadow-sm focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
          <input type="search" autoComplete="off" value={searchQuery}
            onFocus={() => openHistory('mobile')}
            onKeyDown={(event) => { if (event.key === 'Escape') setHistoryOpen(false); }}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search groceries..." aria-label="Search groceries"
            className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent px-3.5 text-sm text-slate-800 outline-none placeholder:text-slate-400" />
          <button type="submit" aria-label="Search products"
            className="flex h-full w-11 shrink-0 items-center justify-center bg-[#187941] text-white hover:bg-[#126334]">
            <Search className="h-[19px] w-[19px]" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </form>
        {showHistory('mobile')}
      </div>


      {mobileMenuOpen && (

        <div className="mt-3 flex flex-col gap-3 border-t border-[#badbbd] pt-3 pb-2 lg:hidden">

          <div className="flex flex-col gap-1">



            {isAdmin && (
              <>
              <NavLink 

                to="/admin" 

                onClick={() => setMobileMenuOpen(false)}

                className="flex items-center gap-3 px-4 py-3 rounded-2xl font-bold bg-purple-50 text-purple-700 border border-purple-200 mb-1"

              >

                <ShieldCheck className="w-5 h-5 text-purple-600" /> Admin Dashboard

              </NavLink></>

            )}



            <NavLink 

              to="/basket" 

              onClick={() => setMobileMenuOpen(false)}

              className={({ isActive }) => `justify-between ${getMobileNavLinkClass({ isActive })}`}

            >

              <div className="flex items-center gap-3">

                <ShoppingCart className="w-5 h-5 text-[#2E7D32]" /> My Basket

              </div>

              {cartCount > 0 && (

                <span className="bg-[#4EAA52] text-white rounded-full text-xs font-black px-2.5 py-0.5">

                  {cartCount} items

                </span>

              )}

            </NavLink>



            <NavLink to="/saved" onClick={() => setMobileMenuOpen(false)} className={getMobileNavLinkClass}>
              <List className="w-5 h-5 text-[#2E7D32]" /> Saved Lists
            </NavLink>

            <NavLink to="/notifications" onClick={() => setMobileMenuOpen(false)} className={getMobileNavLinkClass}>

              <Bell className="w-5 h-5 text-[#2E7D32]" /> Notifications {unreadNotifications > 0 && <span className="ml-auto rounded-full bg-[#4EAA52] px-2.5 py-0.5 text-xs font-black text-white">{Math.min(99, unreadNotifications)}</span>}

            </NavLink>



            <NavLink to="/account" onClick={() => setMobileMenuOpen(false)} className={getMobileNavLinkClass}>

              <User className="w-5 h-5 text-[#2E7D32]" /> Account Dashboard

            </NavLink>

          </div>

        </div>

      )}

    </nav>

  );

}




function ProtectedRoute({ children }) {

  const { user, loading } = useAuth();



  if (loading) {

    return <div className="py-20 text-center font-bold text-slate-500">Loading secure section...</div>;

  }



  return user ? children : <Navigate to="/login" replace />;

}




function AdminRoute({ children }) {

  const { user, loading } = useAuth();



  const isAdmin = user?.is_admin || user?.isAdmin || user?.role === 'admin';



  if (loading) {

    return <div className="py-20 text-center font-bold text-slate-500">Checking security clearance...</div>;

  }



  return user && isAdmin ? children : <Navigate to="/" replace />;

}




export default function App() {

  const [cartCount, setCartCount] = useState(0);



  useEffect(() => {

    const update = () => {

      const items = getCart();

      setCartCount(items.reduce((acc, i) => acc + (i.quantity || 1), 0));

    };

    update();

    window.addEventListener('storage', update);
    window.addEventListener('smartbasket:cart-changed', update);
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('smartbasket:cart-changed', update);
      window.removeEventListener('focus', update);
    };

  }, []);



  return (

    <Router>

      <AuthProvider>

          <ToastProvider>
            <SessionSuspensionGuard />
            <BasketCompareLoginRedirect />

          <style>{`

            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

            .skeleton-box { animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite; background-color: #e2e8f0; }

          `}</style>



          <div className="min-h-screen flex flex-col bg-[#F4F7F4]">

            <NavigationBar cartCount={cartCount} />
            <CategoryStrip />



            <main className="flex-grow flex flex-col">

              <Routes>


                <Route path="/" element={<Home />} />

                <Route path="/search" element={<SearchPage />} />

                <Route path="/product/:id" element={<ProductPage />} />
                <Route path="/store/:storeSlug" element={<StoreProductsPage />} />

                <Route path="/basket" element={<BasketPage />} />
                <Route path="/basket/compare" element={<ProtectedRoute><BasketComparisonPage /></ProtectedRoute>} />
                <Route path="/checkout" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
                <Route path="/account/orders" element={<ProtectedRoute><MyOrdersPage /></ProtectedRoute>} />
                <Route path="/orders" element={<ProtectedRoute><MyOrdersPage /></ProtectedRoute>} />
                <Route path="/account/addresses" element={<ProtectedRoute><DeliveryAddressesPage /></ProtectedRoute>} />
                <Route path="/insights" element={<ProtectedRoute><SavingsDashboard /></ProtectedRoute>} />

                <Route path="/shared/basket/:token" element={<SharedBasketPage />} />

                <Route path="/login" element={<LoginPage />} />

                <Route path="/signup" element={<SignupPage />} />




                <Route path="/saved" element={<ProtectedRoute><SavedBasketsPage /></ProtectedRoute>} />

                <Route path="/saved/:basketId" element={<ProtectedRoute><SavedBasketDetailPage /></ProtectedRoute>} />

                <Route path="/collaborative" element={<ProtectedRoute><CollaborativeListsPage /></ProtectedRoute>} />

                <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />

                <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
                <Route path="/account/security" element={<ProtectedRoute><ActiveSessionsPage /></ProtectedRoute>} />

                  <Route path="/account/profile" element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
                  {/* Older links continue to work instead of displaying a blank page. */}
                  <Route path="/profile" element={<Navigate to="/account/profile" replace />} />

                <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />




                <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
                <Route path="/admin/order-analytics" element={<AdminRoute><AdminOrderAnalytics /></AdminRoute>} />
                <Route path="/admin/orders" element={<AdminRoute><AdminOrdersPage /></AdminRoute>} />

                  {/* Unknown URLs should never render an empty screen. */}
                  <Route path="*" element={
                    <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 px-6 py-20 text-center">
                      <h1 className="text-2xl font-black text-slate-900">Page not found</h1>
                      <p className="text-sm text-slate-600">This page doesn't exist. You can return to your account or the home page.</p>
                      <div className="flex flex-wrap justify-center gap-3">
                        <NavLink to="/account" className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700">My Account</NavLink>
                        <NavLink to="/" className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-50">Home</NavLink>
                      </div>
                    </div>
                  } />

              </Routes>

            </main>

            <Footer />

          </div>

        </ToastProvider>

      </AuthProvider>

    </Router>

  );

}
