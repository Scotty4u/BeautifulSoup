import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ShoppingBasket, Users, Bell, Settings, LogOut, LogIn, UserPlus,
  ClipboardList, BarChart3, User, ArrowUpRight, CalendarDays, Mail, ShieldCheck, Pencil, MapPin,
} from 'lucide-react';

const ACTION_CARDS = [
  {
    icon: ClipboardList,
    title: 'Order History',
    description: 'See your saved order plans, product pictures, quantities and totals.',
    route: '/account/orders',
    label: 'View Orders',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    featured: true,
  },
  {
    icon: MapPin,
    title: 'Delivery Addresses',
    description: 'Add or update the addresses used for your order plans.',
    route: '/account/addresses',
    label: 'Manage Addresses',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
  },
  {
    icon: BarChart3,
    title: 'Spending & Savings',
    description: 'Explore spending and estimated savings from your saved shopping plans.',
    route: '/insights',
    label: 'View Insights',
    color: 'text-purple-700',
    bg: 'bg-purple-50',
  },
  {
    icon: Settings,
    title: 'Profile & Preferences',
    description: 'Manage your details, favourite stores and shopping preferences.',
    route: '/account/profile',
    label: 'Edit Profile',
    color: 'text-purple-700',
    bg: 'bg-purple-50',
    featured: true,
  },
  {
    icon: ShoppingBasket,
    title: 'Saved Lists',
    description: 'View, edit and reload your grocery lists and past comparisons.',
    route: '/saved',
    label: 'Open Lists',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
  },
  {
    icon: Users,
    title: 'Collaborative Lists',
    description: 'Share baskets and collaborate on household or student budgets.',
    route: '/collaborative',
    label: 'Manage Group',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
  },
  {
    icon: ShieldCheck,
    title: 'Account Security',
    description: 'See signed-in devices, change your password and sign out remotely.',
    route: '/account/security',
    label: 'Manage Security',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    featured: true,
  },
  {
    icon: Bell,
    title: 'Notifications',
    description: 'Review invites, price alerts and system updates.',
    route: '/notifications',
    label: 'View Inbox',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
  },
];

export default function AccountPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    axios.get('/api/me', { withCredentials: true, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setUser(data.authenticated ? data : null); })
      .catch(() => { if (!controller.signal.aborted) setUser(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p role="status" className="animate-pulse text-sm text-slate-500">Loading your account…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md border-slate-200 shadow-xl shadow-slate-200/60">
          <CardContent className="space-y-6 p-8 text-center sm:p-10">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-orange-50">
              <User className="h-10 w-10 text-orange-500" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-900">Welcome to SmartBasket</h1>
              <p className="text-sm leading-relaxed text-slate-500">Sign in to manage your profile, save baskets and compare prices.</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button
  onClick={() => {
    window.location.href = import.meta.env.DEV
      ? 'http://localhost:5000/login'
      : '/login';
  }}
  className="h-11 w-full rounded-xl bg-orange-500 font-bold text-white hover:bg-orange-600"
>
                <LogIn className="mr-2 h-4 w-4" /> Sign In
              </Button>
              <Button
  variant="outline"
  onClick={() => {
    window.location.href = import.meta.env.DEV
      ? 'http://localhost:5000/signup'
      : '/signup';
  }}
  className="h-11 w-full rounded-xl font-bold"
>
                <UserPlus className="mr-2 h-4 w-4" /> Create Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const initials = (user.username || 'SB').slice(0, 2).toUpperCase();

  return (
    <main className="bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6 px-4 pt-8 pb-16 sm:px-6 sm:pt-10 sm:pb-20">
        <header>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Your SmartBasket</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">My Account</h1>
          <p className="mt-1 text-sm text-slate-500">Your orders, addresses, preferences and saved lists—all in one place.</p>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardContent className="flex flex-col items-center space-y-4 p-6 text-center">
              <div className="relative">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-orange-200 to-orange-500 shadow-md">
                  <span className="text-2xl font-black text-white">{initials}</span>
                </div>
                {user.is_admin && (
                  <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-400 p-1" aria-label="Administrator">
                    <ShieldCheck className="h-4 w-4 text-white" />
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <h2 className="break-all text-xl font-extrabold">{user.username}</h2>
                <Badge variant="secondary" className={user.is_admin ? 'bg-amber-100 font-bold text-amber-700' : 'bg-orange-50 font-bold text-orange-700'}>
                  {user.is_admin ? 'Administrator' : 'SmartBasket member'}
                </Badge>
              </div>
              <Separator />
              <div className="w-full space-y-3 text-left text-sm text-slate-600">
                <div className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0 break-all">{user.email}</span></div>
                <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0 text-slate-400" /><span>Joined {user.created_at || 'SmartBasket'}</span></div>
                {user.location && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-slate-400" /><span>{user.location}</span></div>}
              </div>
              <Button type="button" onClick={() => navigate('/account/profile')} className="h-11 w-full rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700">
                <Pencil className="mr-2 h-4 w-4" /> Edit My Profile
              </Button>
              {!user.is_admin && (
                <Button type="button" variant="outline"
                  onClick={() => window.location.assign(import.meta.env.DEV
                    ? 'http://localhost:5000/auth/google/link' : '/auth/google/link')}
                  className="h-11 w-full rounded-xl font-semibold">
                  Connect Google account
                </Button>
              )}
              {new URLSearchParams(window.location.search).get('google') === 'linked' && (
                <p role="status" className="text-sm text-emerald-700">Google account linked. You can now sign in using Google.</p>
              )}
              {new URLSearchParams(window.location.search).get('google') === 'email_mismatch' && (
                <p role="alert" className="text-sm text-red-600">The Google email must match your SmartBasket account email.</p>
              )}
              {new URLSearchParams(window.location.search).get('google') === 'already_linked' && (
                <p role="status" className="text-sm text-slate-600">A Google account is already connected.</p>
              )}
              {new URLSearchParams(window.location.search).get('google') === 'already_used' && (
                <p role="alert" className="text-sm text-red-600">This Google account is already connected to another SmartBasket user.</p>
              )}
              <Button
  variant="outline"
  type="button"
  onClick={() => {
    window.location.href = import.meta.env.DEV
      ? 'http://localhost:5000/logout'
      : '/logout';
  }}
  className="h-10 w-full rounded-xl border-red-200 font-bold text-red-600 hover:bg-red-50"
>
                <LogOut className="mr-2 h-4 w-4" /> Log Out
              </Button>
            </CardContent>
          </Card>

          <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Account options">
            {[ACTION_CARDS[0], ACTION_CARDS[4], ACTION_CARDS[1], ACTION_CARDS[2], ACTION_CARDS[3], ACTION_CARDS[5], ACTION_CARDS[6], ACTION_CARDS[7]].map(({ icon: Icon, title, description, route, label, color, bg }) => {
              const isOrders = route === '/account/orders';
              const isLists = route === '/saved';
              const isCollaboration = route === '/collaborative';
              return (
                <button type="button" key={route} onClick={() => navigate(route)}
                  className={`group relative flex min-w-0 flex-col items-start overflow-hidden rounded-3xl border p-6 text-left shadow-sm transition duration-200 hover:border-emerald-300 hover:shadow-md motion-safe:hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${isOrders ? 'min-h-[220px] border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 sm:col-span-2' : isLists ? 'min-h-[220px] border-emerald-100 bg-[#edf5ef]' : isCollaboration ? 'min-h-[190px] border-blue-100 bg-blue-50/60 xl:col-span-2' : 'min-h-[190px] border-slate-200 bg-white'}`}>
                  <span className="relative z-10 mb-5 flex w-full items-center justify-between gap-3">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${isLists ? 'bg-white' : bg}`}><Icon className={`h-5 w-5 ${color}`} aria-hidden="true" /></span>
                    <ArrowUpRight className="h-5 w-5 text-slate-400 transition group-hover:text-emerald-700" aria-hidden="true" />
                  </span>
                  {isOrders && <ClipboardList className="pointer-events-none absolute -bottom-7 -right-5 h-44 w-44 -rotate-12 text-emerald-600/[0.06]" strokeWidth={1} aria-hidden="true" />}
                  <span className={`relative z-10 block font-extrabold tracking-tight text-slate-900 ${isOrders || isLists ? 'text-xl' : 'text-base'}`}>{title}</span>
                  <span className="relative z-10 mt-2 block max-w-sm text-sm leading-6 text-slate-500">{description}</span>
                  <span className={`relative z-10 mt-auto block pt-5 text-xs font-bold ${color}`}>{label} <span aria-hidden="true">→</span></span>
                </button>
              );
            })}
            {user.is_admin && (
              <button type="button" onClick={() => navigate('/admin')} className="group flex min-w-0 items-center gap-4 rounded-3xl border border-amber-200 bg-amber-50/70 p-6 text-left transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 sm:col-span-2 xl:col-span-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white"><ShieldCheck className="h-6 w-6 text-amber-700" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block font-extrabold">Admin Dashboard</span><span className="mt-1 block text-sm text-slate-500">Manage customers, orders and store activity.</span></span>
                <ArrowUpRight className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              </button>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
