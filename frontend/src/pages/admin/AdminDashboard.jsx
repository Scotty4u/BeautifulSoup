import { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from '../../context/ToastContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  ShieldAlert, 
  Users, 
  Database, 
  RefreshCw, 
  Search, 
  CheckCircle2, 
  Trash2, 
  Activity,
  UserPlus,
  X,
  Zap,
  RotateCcw
} from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState({ usersCount: 0, productsCount: 0, activeScrapers: 4 });
  const [users, setUsers] = useState([]);
  const [searchUser, setSearchUser] = useState('');
  const [scraping, setScraping] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // New User Form State
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', is_admin: false });
  const [submitting, setSubmitting] = useState(false);

  const { showToast } = useToast();

  useEffect(() => {
    // Verify authentication and fetch data on load
    axios.get('/api/me', { withCredentials: true })
      .then(res => {
        if (!res.data.authenticated || !res.data.is_admin) {
          window.location.href = 'http://localhost:5000/login';
        }
      })
      .catch(() => {
        window.location.href = 'http://localhost:5000/login';
      });

    fetchAdminData();
  }, []);

  const fetchAdminData = () => {
    axios.get('/api/admin/stats', { withCredentials: true })
      .then(res => setStats(res.data || { usersCount: 0, productsCount: 0, activeScrapers: 4 }))
      .catch(() => {});

    axios.get('/api/admin/users', { withCredentials: true })
      .then(res => setUsers(res.data || []))
      .catch(() => {});
  };

  const triggerScrapers = (storeKey = 'all') => {
    setScraping(true);
    axios.post('/api/admin/system/trigger-job', { store: storeKey }, { withCredentials: true })
      .then(() => {
        showToast(`Retailer scrapers triggered successfully (${storeKey.toUpperCase()})!`);
      })
      .catch(() => {
        showToast("Scraper command processed.", "info");
      })
      .finally(() => setScraping(false));
  };

  const clearSearchCache = () => {
    axios.post('/api/admin/system/clear-cache', {}, { withCredentials: true })
      .then(() => showToast("Search cache flushed successfully!"))
      .catch(() => showToast("Failed to clear cache.", "error"));
  };

  const handleCreateUser = (e) => {
    e.preventDefault();
    setSubmitting(true);

    axios.post('/api/admin/users', newUser, { withCredentials: true })
      .then(res => {
        setUsers([res.data.user, ...users]);
        showToast("User created successfully!");
        setIsModalOpen(false);
        setNewUser({ username: '', email: '', password: '', is_admin: false });
      })
      .catch(err => {
        showToast(err.response?.data?.error || "Failed to create user.", "error");
      })
      .finally(() => setSubmitting(false));
  };

  const deleteUser = (userId) => {
    axios.delete(`/api/admin/users/${userId}`, { withCredentials: true })
      .then(() => {
        setUsers(users.filter(u => u.id !== userId));
        showToast("User removed successfully.");
      })
      .catch(err => showToast(err.response?.data?.error || "Failed to delete user.", "error"));
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchUser.toLowerCase()) || 
    u.email.toLowerCase().includes(searchUser.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8 relative">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200/80 rounded-2xl px-6 py-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Admin & Governance Dashboard</h1>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">Manage system scrapers, user accounts, and platform monitoring.</p>
        </div>

        <div className="flex items-center gap-3">
          <Button 
            onClick={clearSearchCache}
            variant="outline"
            className="border-slate-200 text-slate-700 hover:bg-slate-50 font-bold h-11 px-4 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 mr-2" /> Flush Cache
          </Button>

          <Button 
            onClick={() => triggerScrapers('all')} 
            disabled={scraping}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 px-5 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${scraping ? 'animate-spin' : ''}`} />
            {scraping ? 'Running Scrapers...' : 'Trigger All Scrapers'}
          </Button>
        </div>
      </div>

      {/* Stats Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="border border-slate-200 rounded-2xl bg-white shadow-xs p-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Registered Users</span>
              <h3 className="text-3xl font-black text-slate-900 mt-1">{users.length || stats.usersCount}</h3>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              <Users className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="border border-slate-200 rounded-2xl bg-white shadow-xs p-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Indexed Products</span>
              <h3 className="text-3xl font-black text-slate-900 mt-1">{stats.productsCount}</h3>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
              <Database className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="border border-slate-200 rounded-2xl bg-white shadow-xs p-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Scraper Nodes</span>
              <h3 className="text-3xl font-black text-emerald-600 mt-1">{stats.activeScrapers} / 4</h3>
            </div>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
              <Activity className="w-6 h-6" />
            </div>
          </div>
        </Card>
      </div>

      {/* Scraper Status Section with Individual Triggers */}
      <Card className="border border-slate-200 rounded-2xl bg-white shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900">Retailer Scraping & Store Controls</h3>
          <span className="text-xs text-slate-400 font-medium">Click any store to re-run its scraper node</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: 'Checkers', key: 'checkers' }, 
            { name: 'Shoprite', key: 'shoprite' }, 
            { name: 'Pick n Pay', key: 'pnp' }, 
            { name: 'Woolworths', key: 'woolworths' }
          ].map((store) => (
            <div key={store.key} className="p-4 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between group hover:border-emerald-200 transition-all">
              <div>
                <span className="font-extrabold text-sm text-slate-800 block">{store.name}</span>
                <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 mt-0.5">
                  <CheckCircle2 className="w-3 h-3" /> Sync active
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => triggerScrapers(store.key)}
                className="h-8 px-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-xs font-bold shadow-xs cursor-pointer"
                title={`Re-run ${store.name} scraper`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-500 mr-1" /> Run
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {/* User Management Table Section */}
      <Card className="border border-slate-200 rounded-2xl bg-white shadow-sm overflow-hidden">
        <CardHeader className="p-6 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/50">
          <CardTitle className="text-lg font-black text-slate-900">Platform Users</CardTitle>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <Input 
                type="text"
                placeholder="Search users..."
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                className="pl-9 rounded-xl border-slate-200 bg-white focus-visible:ring-emerald-500 font-medium text-sm"
              />
            </div>
            <Button 
              onClick={() => setIsModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-10 px-4 rounded-xl shadow-sm transition-all w-full sm:w-auto shrink-0 cursor-pointer"
            >
              <UserPlus className="w-4 h-4 mr-1.5" /> Add User
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-400 text-[10px] uppercase font-black tracking-wider">
                  <th className="py-3 px-6">User</th>
                  <th className="py-3 px-6">Email</th>
                  <th className="py-3 px-6">Role</th>
                  <th className="py-3 px-6">Joined</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-slate-400 font-medium">No users found.</td>
                  </tr>
                ) : (
                  filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 px-6 font-bold text-slate-800">{u.username}</td>
                      <td className="py-4 px-6 text-slate-500 font-medium">{u.email}</td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                          u.role === 'Admin' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-slate-400 text-xs font-medium">{u.joined}</td>
                      <td className="py-4 px-6 text-right">
                        <Button 
                          onClick={() => deleteUser(u.id)}
                          variant="ghost"
                          size="sm"
                          className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50 font-bold text-xs cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add User Modal Dialog */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 999999 }} className="bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <UserPlus className="w-5 h-5" />
                </span>
                <h3 className="text-lg font-black text-slate-900">Add New User</h3>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Username</label>
                <Input 
                  type="text" 
                  required
                  placeholder="e.g. javed_dev"
                  value={newUser.username}
                  onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                  className="rounded-xl border-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Email Address</label>
                <Input 
                  type="email" 
                  required
                  placeholder="user@smartbasket.co.za"
                  value={newUser.email}
                  onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                  className="rounded-xl border-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Password</label>
                <Input 
                  type="password" 
                  required
                  placeholder="••••••••"
                  value={newUser.password}
                  onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                  className="rounded-xl border-slate-200"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input 
                  type="checkbox"
                  id="isAdminCheck"
                  checked={newUser.is_admin}
                  onChange={(e) => setNewUser({...newUser, is_admin: e.target.checked})}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                />
                <label htmlFor="isAdminCheck" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Grant Administrator Privileges
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border-slate-200 font-bold cursor-pointer"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={submitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-5 cursor-pointer"
                >
                  {submitting ? 'Creating...' : 'Create User'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}