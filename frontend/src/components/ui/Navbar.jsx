import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, User, ShieldAlert, LogOut } from 'lucide-react';

export default function Navbar() {
  const navigate = useNavigate();
  
  // Get user from localStorage (Change this if you use an AuthContext)
  const userString = localStorage.getItem('user');
  const user = userString ? JSON.parse(userString) : null;
  
  // Check if the logged-in user is an admin
  const isAdmin = user?.role === 'admin';

  const handleLogout = () => {
    localStorage.removeItem('user');
    // Also remove token if you have one: localStorage.removeItem('token');
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

          {/* Auth Actions */}
          {user ? (
            <button 
              onClick={handleLogout} 
              className="text-sm font-semibold text-slate-500 flex items-center gap-1.5 hover:text-red-500 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
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