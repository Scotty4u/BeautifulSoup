import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, User, ShieldAlert, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Navbar() {
  const navigate = useNavigate();

  // Use AuthContext to ensure UI updates immediately on login/logout
  const { user, logoutUser } = useAuth();

  // Robust check for admin privileges
  const isAdmin = user?.is_admin || user?.role === 'admin' || user?.isAdmin;

  const handleLogout = () => {
    logoutUser();
    navigate('/login');
  };

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">

        {/* Brand / Logo */}
        <Link to="/" className="text-2xl font-black text-[#FF8C38] flex items-center gap-2">
          SmartBasket
        </Link>

        {/* Navigation Links */}
        <div className="flex items-center gap-4 md:gap-6">
          <Link to="/search?q=all" className="text-sm font-semibold text-slate-600 hover:text-[#FF8C38] transition-colors hidden sm:block">
            Browse
          </Link>

          {/* 🔴 ADMIN LINK - ONLY VISIBLE TO ADMINS 🔴 */}
          {isAdmin && (
            <Link
              to="/admin"
              className="text-sm font-bold text-red-600 flex items-center gap-1.5 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-xl transition-colors"
            >
              <ShieldAlert className="w-4 h-4" />
              <span className="hidden sm:inline">Admin Panel</span>
            </Link>
          )}

          {/* Cart */}
          <Link to="/basket" className="relative text-slate-600 hover:text-[#FF8C38] transition-colors p-2">
            <ShoppingCart className="w-5 h-5" />
          </Link>

          {/* Auth & Account Actions */}
          {user ? (
            <div className="flex items-center gap-3">
              <Link
                to="/account"
                className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 hover:text-[#FF8C38] transition-colors"
              >
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">Account</span>
              </Link>
              <button
                onClick={handleLogout}
                className="text-sm font-semibold text-slate-500 flex items-center gap-1.5 hover:text-red-500 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="text-sm font-semibold text-slate-600 flex items-center gap-1.5 hover:text-[#FF8C38] transition-colors"
            >
              <User className="w-4 h-4" />
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}