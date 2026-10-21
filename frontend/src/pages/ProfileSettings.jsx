import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { getShoppingLocation } from '../utils/ShoppingLocation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft, UserRound, CalendarDays, MapPin, ShieldCheck,
  ShoppingBasket, Bell, Save, LockKeyhole, Mail, Settings,
} from 'lucide-react';

const STORES = ['Checkers', 'Shoprite', 'Pick n Pay', 'Woolworths'];
const FIELD = 'mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const EMPTY = {
  username: '', email: '', date_of_birth: '', age_confirmation: null, age_group: 'unknown',
  location: '', postal_code: '', preferred_store: '', preferred_stores: [], monthly_budget: 0,
  notifications_opt_in: false, marketing_opt_in: false,
};

export default function ProfileSettings() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { setUser } = useAuth();
  const [success, setSuccess] = useState('');
  const [selectedMapLocation, setSelectedMapLocation] = useState(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [profile, setProfile] = useState(EMPTY);
  const [original, setOriginal] = useState(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    axios.get('/api/profile', { withCredentials: true, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const details = { ...EMPTY, ...data, preferred_stores: Array.isArray(data.preferred_stores)
          ? data.preferred_stores : (data.preferred_store || '').split(',').map(s => s.trim()).filter(s => STORES.includes(s)) };
        setProfile(details);
        setOriginal(details);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadError(err?.response?.data?.error || 'Could not load your profile. Check your connection and try again.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadCount]);

  const change = (key, value) => {
    setSuccess(''); setSaveError('');
    setProfile((current) => ({ ...current, [key]: value }));
  };
  const hasChanges = Boolean(original) && (Object.keys(EMPTY).some((key) =>
    JSON.stringify(profile[key] ?? null) !== JSON.stringify(original[key] ?? null)) || Boolean(selectedMapLocation));
  const toggleStore = (store) => {
    const current = Array.isArray(profile.preferred_stores) ? profile.preferred_stores : [];
    change('preferred_stores', current.includes(store) ? current.filter(name => name !== store)
      : STORES.filter(name => name === store || current.includes(name)));
  };
  const useMapLocation = () => {
    const saved = getShoppingLocation();
    if (!saved) { setSaveError('Select a shopping location using the location button next to SmartBasket first.'); return; }
    setSelectedMapLocation(saved);
    change('location', saved.name || 'Selected shopping area');
  };
  const identityChanged = Boolean(original) && (
    profile.username.trim() !== original.username ||
    profile.email.trim().toLowerCase() !== original.email.toLowerCase()
  );

  const save = async (event) => {
    event.preventDefault();
    if (!original || saving) return;
    setSaveError(''); setSuccess('');
    if (identityChanged && !password) {
      setSaveError('Enter your current password to change your username or email.');
      return;
    }
    setSaving(true);
    try {
      const update = {
        username: profile.username.trim(),
        email: profile.email.trim(),
        location: profile.location,
        postal_code: profile.postal_code,
        preferred_stores: profile.preferred_stores,
        monthly_budget: Number(profile.monthly_budget) || 0,
        notifications_opt_in: Boolean(profile.notifications_opt_in),
        marketing_opt_in: Boolean(profile.marketing_opt_in),
      };
      // Older accounts with a saved birth date may not have answered the new prompt.
      // Do not send null: that would reject unrelated profile edits.
      if (typeof profile.age_confirmation === 'boolean') update.age_confirmation = profile.age_confirmation;
      if (profile.date_of_birth !== original.date_of_birth) update.date_of_birth = profile.date_of_birth;
      if (selectedMapLocation) {
        update.latitude = selectedMapLocation.lat;
        update.longitude = selectedMapLocation.lng;
        update.radius_km = selectedMapLocation.radius_km;
      }
      // The password is sent only when editing account identity; never saved in React state beyond this session.
      if (identityChanged) update.current_password = password;
      const { data } = await axios.patch('/api/profile', update, { withCredentials: true });
      const saved = { ...EMPTY, ...data, preferred_stores: Array.isArray(data.preferred_stores) ? data.preferred_stores : [] };
      setProfile(saved);
      setOriginal(saved);
      setPassword('');
      setSelectedMapLocation(null);
      setSuccess('Your profile changes were saved.');
      setUser((current) => current ? {
        ...current, username: saved.username, email: saved.email,
        age_group: saved.age_group, location: saved.location,
        latitude: saved.latitude, longitude: saved.longitude, radius_km: saved.radius_km,
        profile_complete: Boolean((saved.date_of_birth || saved.age_confirmation !== null) && saved.postal_code),
      } : current);
      showToast('Your profile and preferences were saved.');
    } catch (err) {
      setSaveError(err?.response?.data?.error || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen min-w-0 bg-slate-50 px-3 py-5 text-slate-900 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <button type="button" onClick={() => navigate('/account')} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-700">
          <ArrowLeft className="h-4 w-4" /> Back to My Account
        </button>

        <header className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-emerald-100 p-3 text-emerald-700"><Settings className="h-6 w-6" /></span>
            <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Account settings</p><h1 className="break-words text-xl font-black tracking-tight sm:text-3xl">Edit Profile & Preferences</h1></div>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">Manage your account details, age setting, local shopping area and budget preferences.</p>
        </header>

        {loading ? (
          <div role="status" className="space-y-4 animate-pulse"><div className="h-52 rounded-3xl bg-slate-200" /><div className="h-52 rounded-3xl bg-slate-200" /></div>
        ) : loadError ? (
          <Card className="border-rose-200"><CardContent className="space-y-4 p-6"><p role="alert" className="text-sm text-rose-700">{loadError}</p><Button type="button" variant="outline" onClick={() => setReloadCount((n) => n + 1)}>Try again</Button></CardContent></Card>
        ) : (
          <form onSubmit={save} className="min-w-0 space-y-5">
            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm"><CardContent className="min-w-0 space-y-5 p-4 sm:p-8">
              <div className="flex items-center gap-2"><UserRound className="h-5 w-5 text-emerald-700" /><h2 className="text-lg font-extrabold">Personal information</h2></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Username
                  <input name="username" type="text" autoComplete="username" maxLength={80} minLength={3} required className={FIELD} value={profile.username} onChange={(e) => change('username', e.target.value)} />
                </label>
                <label className="block text-sm font-semibold">Email address
                  <span className="relative block"><Mail aria-hidden="true" className="pointer-events-none absolute left-3 top-[24px] h-4 w-4 text-slate-400" />
                    <input name="email" type="email" autoComplete="email" maxLength={120} required className={`${FIELD} pl-10`} value={profile.email} onChange={(e) => change('email', e.target.value)} />
                  </span>
                </label>
              </div>
              {identityChanged && (
                <label className="block text-sm font-semibold">Current password <span className="text-rose-700">(required)</span>
                  <span className="relative block"><LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-3 top-[24px] h-4 w-4 text-slate-400" />
                    <input type="password" autoComplete="current-password" required className={`${FIELD} pl-10`} placeholder="Confirm this account change" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </span>
                </label>
              )}
              <p className="text-xs leading-5 text-slate-500">Changing your username or email requires your current password. An email change takes effect immediately; email verification isn't configured.</p>
            </CardContent></Card>

            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm"><CardContent className="min-w-0 space-y-4 p-4 sm:p-8">
              <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-emerald-700" /><h2 className="text-lg font-extrabold">Age & catalogue access</h2></div>
              <p className="text-sm text-slate-600">Are you 18 years old or older?</p>
              <div role="group" aria-label="Age confirmation" className="grid gap-3 sm:grid-cols-2">
                {[{value:true,label:'Yes, I am 18 or older',sub:'Show age-restricted products'}, {value:false,label:'No, I am under 18',sub:'Keep age-restricted products hidden'}].map(({value,label,sub}) => (
                  <button key={String(value)} type="button" aria-pressed={profile.age_confirmation === value}
                    onClick={() => change('age_confirmation', value)}
                    className={`min-h-20 rounded-2xl border p-4 text-left transition focus-visible:ring-2 focus-visible:ring-emerald-500 ${profile.age_confirmation === value ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 bg-slate-50 hover:bg-emerald-50'}`}>
                    <span className="block font-bold text-sm">{label}</span><span className="mt-1 block text-xs text-slate-500">{sub}</span>
                  </button>
                ))}
              </div>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><ShieldCheck className="mr-2 inline h-4 w-4 text-emerald-700" />Saved access: <strong>{profile.age_group === 'admin' ? 'Administrator' : profile.age_group === 'adult' ? '18+' : profile.age_group === 'under_18' ? 'Under 18' : 'Not confirmed'}</strong></div>
              <p className="text-xs leading-5 text-slate-500">This is a self-declaration, not verified proof of age. An existing birth date is preserved and, if it indicates under 18, cannot be overridden by choosing Yes. Access is restricted until an age is confirmed.</p>
              {profile.date_of_birth && <details className="rounded-xl border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">Need to correct a previously saved birth date?</summary>
                <label className="mt-3 block max-w-sm text-sm font-medium">Date of birth
                  <input type="date" className={FIELD} max={localToday()} value={profile.date_of_birth || ''} onChange={(e) => change('date_of_birth', e.target.value)} />
                </label>
                <p className="mt-2 text-xs text-slate-500">Optional. Only change this if the saved date is incorrect.</p>
              </details>}
            </CardContent></Card>

            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm"><CardContent className="min-w-0 space-y-4 p-4 sm:p-8">
              <div className="flex items-center gap-2"><MapPin className="h-5 w-5 text-emerald-700" /><h2 className="text-lg font-extrabold">Shopping location</h2></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">City or town
                  <input type="text" maxLength={100} placeholder="e.g. Gqeberha" className={FIELD} value={profile.location || ''} onChange={(e) => change('location', e.target.value)} />
                </label>
                <label className="block text-sm font-semibold">Postal code
                  <input type="text" maxLength={12} placeholder="e.g. 6001" className={FIELD} value={profile.postal_code || ''} onChange={(e) => change('postal_code', e.target.value)} />
                </label>
              </div>
              <button type="button" onClick={useMapLocation} className="min-h-11 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-100">Use my selected shopping location</button>
              {selectedMapLocation && <p className="text-xs font-semibold text-emerald-800">Selected: {selectedMapLocation.name} · {selectedMapLocation.radius_km} km radius (save to apply)</p>}
              <p className="text-xs text-slate-500">You don't need to enter your street address. Local store availability is not yet based on your postal code.</p>
            </CardContent></Card>

            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm"><CardContent className="min-w-0 space-y-4 p-4 sm:p-8">
              <div className="flex items-center gap-2"><ShoppingBasket className="h-5 w-5 text-emerald-700" /><h2 className="text-lg font-extrabold">Shopping preferences</h2></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset className="min-w-0 space-y-3">
                  <legend className="text-sm font-semibold">Preferred supermarkets (select as many as you like)</legend>
                  <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                    {STORES.map(store => {
                      const selected = profile.preferred_stores?.includes(store);
                      return <label key={store} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition ${selected ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                        <input type="checkbox" className="h-5 w-5 shrink-0 accent-emerald-700" checked={Boolean(selected)} onChange={() => toggleStore(store)} />{store}
                      </label>;
                    })}
                  </div>
                  <p className="text-xs text-slate-500">Leave all unchecked for no preference. Selecting one doesn't deselect the others.</p>
                </fieldset>
                <label className="block text-sm font-semibold">Monthly grocery budget (R)
                  <input type="number" min="0" max="1000000" step="1" className={FIELD} value={profile.monthly_budget ?? 0} onChange={(e) => change('monthly_budget', e.target.value)} />
                </label>
              </div>
              <p className="text-xs text-slate-500">These settings are saved for your account; they do not change retailer stock availability automatically.</p>
            </CardContent></Card>

            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm"><CardContent className="min-w-0 space-y-4 p-4 sm:p-8">
              <div className="flex items-center gap-2"><Bell className="h-5 w-5 text-emerald-700" /><h2 className="text-lg font-extrabold">Communication preferences</h2></div>
              <button type="button" onClick={() => navigate('/notifications')} className="w-full rounded-xl bg-slate-50 p-4 text-left text-sm transition hover:bg-emerald-50"><strong>Notification preferences →</strong><span className="mt-1 block text-xs text-slate-500">Open Notifications, then Preferences to choose price alerts, order updates, list activity and reminders.</span></button>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-emerald-600" checked={Boolean(profile.marketing_opt_in)} onChange={(e) => change('marketing_opt_in', e.target.checked)} /><span><strong>Optional marketing updates</strong><span className="mt-1 block text-xs text-slate-500">Not required to use SmartBasket. Off unless you opt in.</span></span></label>
            </CardContent></Card>

            {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">{success}</p>}
            {saveError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">{saveError}</p>}
            <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => navigate('/account')} className="h-11 rounded-xl px-6 font-semibold">Back to Account</Button>
              <Button type="submit" disabled={saving || !hasChanges} className="h-11 rounded-xl bg-emerald-600 px-7 font-bold text-white hover:bg-emerald-700"><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}