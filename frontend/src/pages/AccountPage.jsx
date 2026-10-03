import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ShoppingBasket,
  Users,
  Bell,
  Settings,
  LogOut,
  LogIn,
  UserPlus,
  User,
  ChevronRight,
  CalendarDays,
  Mail,
  ShieldCheck,
} from 'lucide-react';

const ACTION_CARDS = [
  {
    icon: ShoppingBasket,
    title: 'Saved Baskets',
    description: 'View, edit, and reload your custom grocery lists and past price comparisons.',
    route: '/saved',
    label: 'Open Baskets',
    color: 'text-[#FF8C38]',
    bg: 'bg-[#FFF3EB]',
  },
  {
    icon: Users,
    title: 'Collaborative Lists',
    description: 'Share baskets and collaborate on household or student group budgets.',
    route: '/collaborative',
    label: 'Manage Group',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    icon: Bell,
    title: 'Notifications',
    description: 'Check your collaboration invites, price drop alerts, and system updates.',
    route: '/notifications',
    label: 'View Inbox',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    icon: Settings,
    title: 'Store Preferences',
    description: 'Set your preferred stores for personalised search and comparison results.',
    route: '/onboarding',
    label: 'Edit Preferences',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
];

export default function AccountPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/me', { withCredentials: true })
      .then(res => {
        setUser(res.data.authenticated ? res.data : null);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  }, []);

  const handleLogout = () => {
    window.location.href = 'http://localhost:5000/logout';
  };

  // ── LOADING STATE ──
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading your account...</div>
      </div>
    );
  }

  // ── NOT LOGGED IN ──
  if (!user) {
     return (
        <div>
          <div style={{ justifyItems: "center", marginTop: "-50px" }}>
            <div className="login-card-logo" style={{justifyItems:"center"}}>
              <div className="logo" style={{ marginTop: "30px", marginBottom: "5px", display: "grid", justifyItems: "center" }}>
                <span style={{ fontSize: "70px"}}>🛒</span>
                <span style={{ marginTop: "5%", color: "black", fontWeight:"Bolder" , fontSize: "30px" }}>
                  Smart Basket
                </span>
              </div>
              <div style={{ justifyItems: "center" }}>
                <br />
                <h3 className="sign-text">Sign in</h3>
                <p style={{ fontSize: "15px",fontWeight:"" }}>Welcome back! Please sign in to your account</p>
                <p className="text-slate-500 text-sm leading-relaxed">
                Sign in to save your baskets, compare prices and collaborate with others.
                </p>
              </div>
              <br />
                  
              <div style={{justifyItems:"center", width:"75%"}}>        
                <Button
                      onClick={() => navigate('/login')}
                      className="w-full bg-[#FF8C38] hover:brightness-95 text-white font-bold h-11 rounded-xl shadow-md"
                      style={{width:"100%", marginBottom:"2%"}}
                      >
                      <i class="fa fa-sign-in" aria-hidden="true"></i>
                      Sign In
                </Button>
                  <br />
                <Button
                      variant="outline"
                      onClick={() => navigate('/signup')}
                      className="w-full font-bold h-11 rounded-xl border-slate-200 hover:bg-[#FFF3EB] hover:border-[#FF8C38] hover:text-[#FF8C38]"
                      style={{width:"100%"}}
                      >
                      <i class="fa fa-user-plus" aria-hidden="true"></i>
                      Sign up
                </Button>
                    </div>
              <br />
            </div>
          </div>
        </div>
      );

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-md border-0 shadow-xl shadow-slate-200/80">
          <CardContent className="p-10 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-[#FFF3EB] flex items-center justify-center mx-auto">
              <User className="w-10 h-10 text-[#FF8C38]"  style={{colour:"black"}}/>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-900">Welcome to SmartBasket</h1>
              <p className="text-slate-500 text-sm leading-relaxed">
                Sign in to save your baskets, compare prices, and collaborate with others.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                onClick={() => navigate('/login')}
                className="w-full bg-[#FF8C38] hover:brightness-95 text-white font-bold h-11 rounded-xl shadow-md"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Sign In
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/signup')}
                className="w-full font-bold h-11 rounded-xl border-slate-200 hover:bg-[#FFF3EB] hover:border-[#FF8C38] hover:text-[#FF8C38]"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Create Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── LOGGED IN ──
  const initials = user.username?.slice(0, 2).toUpperCase() || 'SB';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-black text-slate-900">My Account</h1>
          <p className="text-slate-500 mt-1">Manage your preferences, lists, and group budgets.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

          {/* ── PROFILE CARD ── */}
          <Card className="border-0 shadow-lg shadow-slate-200/60 lg:sticky lg:top-6">
            <CardContent className="p-6 flex flex-col items-center text-center space-y-4">

              {/* Avatar */}
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-[#FF8C38] flex items-center justify-center shadow-lg shadow-[#FF8C38]/20">
                  <span className="text-2xl font-black text-white">{initials}</span>
                </div>
                {user.is_admin && (
                  <div className="absolute -bottom-1 -right-1 bg-amber-400 rounded-full p-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </div>

              {/* Name & badge */}
              <div className="space-y-1">
                <h2 className="text-xl font-black text-slate-900">{user.username}</h2>
                <Badge
                  variant="secondary"
                  className={user.is_admin
                    ? 'bg-amber-100 text-amber-700 font-bold text-xs'
                    : 'bg-[#FFF3EB] text-[#FF8C38] font-bold text-xs'
                  }
                >
                  {user.is_admin ? '⭐ Admin' : 'Free Account'}
                </Badge>
              </div>

              <Separator />

              {/* User details */}
              <div className="w-full space-y-2 text-left">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Mail className="w-4 h-4 shrink-0 text-slate-400" />
                  <span className="truncate">{user.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <CalendarDays className="w-4 h-4 shrink-0 text-slate-400" />
                  <span>Joined {user.created_at}</span>
                </div>
              </div>

              <Separator />

              {/* Logout */}
              <Button
                variant="outline"
                onClick={handleLogout}
                className="w-full font-bold border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-xl h-10"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Log Out
              </Button>
            </CardContent>
          </Card>

          {/* ── ACTION CARDS ── */}
          <div className="lg:col-span-2 space-y-3">
            {ACTION_CARDS.map(({ icon: Icon, title, description, route, label, color, bg }) => (
              <Card
                key={route}
                className="border border-slate-200 hover:border-[#FF8C38] hover:shadow-md transition-all cursor-pointer group"
                onClick={() => navigate(route)}
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-6 h-6 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-900 text-base">{title}</h3>
                    <p className="text-sm text-slate-500 mt-0.5 leading-snug">{description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-sm font-bold hidden sm:block ${color}`}>{label}</span>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-[#FF8C38] transition-colors" />
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Admin panel shortcut */}
            {user.is_admin && (
              <Card
                className="border border-amber-200 bg-amber-50/50 hover:shadow-md transition-all cursor-pointer group"
                onClick={() => window.location.href = 'http://localhost:5000/admin'}
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-6 h-6 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-slate-900 text-base">Admin Dashboard</h3>
                    <p className="text-sm text-slate-500 mt-0.5">Manage users, system jobs, and platform settings.</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-amber-400 group-hover:text-amber-600 transition-colors shrink-0" />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}