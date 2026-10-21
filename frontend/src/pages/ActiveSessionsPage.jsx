import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, LockKeyhole, MonitorSmartphone, ShieldCheck, Trash2 } from 'lucide-react';

const when = (value) => value ? new Date(value).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown';

export default function ActiveSessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' });
  const load = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/security/sessions');
      setSessions(Array.isArray(data) ? data : []);
      setError('');
    } catch (e) { setError(e.response?.data?.error || 'Could not load active sessions.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (path, self = false) => {
    if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const { data } = await axios.delete(path);
      if (self || data.logged_out) { window.location.assign('/login'); return; }
      setSuccess('Other devices have been signed out.');
      await load();
    } catch (e) { setError(e.response?.data?.error || 'Could not sign out that device.'); }
    finally { setBusy(false); }
  };
  const changePassword = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      const { data } = await axios.post('/api/security/change-password', passwords);
      setPasswords({ current_password: '', new_password: '' });
      setSuccess(`Password changed. ${data.other_sessions_revoked} other sessions signed out.`);
      await load();
    } catch (e) { setError(e.response?.data?.error || 'Could not change your password.'); }
    finally { setBusy(false); }
  };

  return <main className="min-h-screen bg-[#F8FAF8] px-4 py-8 text-slate-900 sm:px-6">
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/account" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700"><ArrowLeft size={17} /> Account</Link>
      <header className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-100 via-white to-white p-6 sm:p-8">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-white p-3 text-emerald-700"><ShieldCheck size={27}/></div><div><p className="text-xs font-black uppercase tracking-wider text-emerald-700">Account security</p><h1 className="text-2xl font-black sm:text-3xl">Active sessions</h1></div></div>
        <p className="mt-4 text-sm text-slate-600">See browsers signed into your account. Locations are not guessed; a browser label is not a guaranteed device identity.</p>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{success}</p>}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-extrabold">Your devices</h2><button type="button" disabled={busy || sessions.length < 2} onClick={() => revoke('/api/security/sessions/others')} className="min-h-11 rounded-xl border border-emerald-200 px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">Log out other devices</button></div>
        {loading ? <p className="py-8 text-sm text-slate-500">Loading sessions…</p> : !sessions.length ? <p className="py-8 text-sm text-slate-500">No active sessions found.</p> : <div className="mt-5 divide-y divide-slate-100">
          {sessions.map((entry) => <article key={entry.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3"><div className="shrink-0 rounded-xl bg-slate-100 p-3 text-slate-600"><MonitorSmartphone size={22}/></div><div className="min-w-0"><p className="break-words text-sm font-bold text-slate-900">{entry.device}</p><p className="mt-1 text-xs text-slate-500">Last active: {when(entry.last_seen_at)} · Expires: {when(entry.expires_at)}</p>{entry.current && <span className="mt-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">This browser</span>}</div></div>
            <button type="button" disabled={busy} onClick={() => revoke(`/api/security/sessions/${entry.id}`, entry.current)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={16}/> Sign out</button>
          </article>)}
        </div>}
        <button type="button" disabled={busy || !sessions.length} onClick={() => { if (window.confirm('Sign out every device, including this one?')) revoke('/api/security/sessions/all', true); }} className="mt-4 min-h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">Emergency: sign out everywhere</button>
      </section>
      <form onSubmit={changePassword} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="flex items-center gap-2 text-xl font-extrabold"><LockKeyhole size={20} className="text-emerald-700"/> Change password</h2>
        <p className="text-sm text-slate-600">Changing your password signs out other browsers automatically.</p>
        <label className="block text-sm font-bold">Current password<input required type="password" autoComplete="current-password" value={passwords.current_password} onChange={e => setPasswords(p => ({ ...p, current_password: e.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
        <label className="block text-sm font-bold">New password (at least 12 characters)<input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={passwords.new_password} onChange={e => setPasswords(p => ({ ...p, new_password: e.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
        <button disabled={busy} type="submit" className="min-h-11 w-full rounded-xl bg-emerald-700 px-4 font-bold text-white hover:bg-emerald-800 disabled:opacity-50">Update password</button>
      </form>
    </div>
  </main>;
}
