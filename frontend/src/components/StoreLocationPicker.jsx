import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { MapPin, X, Search, Navigation, Store, Check, LoaderCircle } from 'lucide-react';
import { getShoppingLocation, setShoppingLocation, LOCATION_EVENT, RADII } from '../utils/ShoppingLocation';

const encodeText = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Number(n).toFixed(1)} km`;
const PLACEHOLDER = 'Enter a South African city, suburb or address';
let leafletPromise;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('smartbasket-leaflet-css')) {
      const css = document.createElement('link');
      css.id = 'smartbasket-leaflet-css'; css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => { leafletPromise = null; reject(new Error('Map tiles unavailable')); };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function StoreMap({ location, branches }) {
  const holderRef = useRef(null);
  const leafletMapRef = useRef(null);
  useEffect(() => {
    if (!location || !holderRef.current) return undefined;
    let canceled = false;
    loadLeaflet().then(L => {
      if (canceled || !holderRef.current || leafletMapRef.current) return;
      const map = L.map(holderRef.current, { scrollWheelZoom: false }).setView([location.lat, location.lng], 12);
      leafletMapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      L.circleMarker([location.lat, location.lng], { radius: 10, color: '#047857', fillColor: '#10b981', fillOpacity: 0.9 })
        .addTo(map).bindPopup('Your shopping area');
      const points = [L.latLng(location.lat, location.lng)];
      for (const b of branches) {
        if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) continue;
        L.circleMarker([b.lat, b.lng], { radius: 7, color: '#134e4a', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.9 })
          .addTo(map).bindPopup(`<strong>${encodeText(b.store)}</strong><p>${encodeText(b.name)}</p>`);
        points.push(L.latLng(b.lat, b.lng));
      }
      if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [22, 22], maxZoom: 13 });
      setTimeout(() => { if (!canceled) map.invalidateSize(); }, 100);
    }).catch(() => { /* Branch list remains accessible if map CDN is blocked. */ });
    return () => { canceled = true; leafletMapRef.current?.remove(); leafletMapRef.current = null; };
  }, [location?.lat, location?.lng, branches]);
  if (!location) return null;
  return <div ref={holderRef} className="h-64 w-full rounded-xl border border-emerald-100 bg-slate-100" aria-label="Map of selected shopping area and mapped supermarket branches" />;
}

export default function StoreLocationPicker({ variant = 'header' }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => getShoppingLocation());
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState([]);
  const [candidate, setCandidate] = useState(null);
  const [radius, setRadius] = useState(selected?.radius_km || 15);
  const [branches, setBranches] = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const sync = event => { setSelected(event?.detail || getShoppingLocation()); };
    window.addEventListener(LOCATION_EVENT, sync);
    return () => window.removeEventListener(LOCATION_EVENT, sync);
  }, []);
  useEffect(() => {
    if (!user?.id) return;
    if (Number.isFinite(Number(user.latitude)) && Number.isFinite(Number(user.longitude)) &&
        user.latitude !== null && user.longitude !== null) {
      const current = getShoppingLocation();
      if (!current || current.lat !== Number(user.latitude) || current.lng !== Number(user.longitude)) {
        setShoppingLocation({ name: user.location || 'My shopping area', lat: user.latitude,
          lng: user.longitude, radius_km: user.radius_km || 15 });
      }
    }
  }, [user?.id, user?.latitude, user?.longitude, user?.radius_km]);
  useEffect(() => {
    if (!open) return;
    const chosen = getShoppingLocation();
    setCandidate(chosen);
    setRadius(chosen?.radius_km || 15);
    setError('');
  }, [open]);
  useEffect(() => {
    if (!open || !candidate) { setBranches([]); return undefined; }
    const id = ++requestIdRef.current;
    const controller = new AbortController();
    setLoadingBranches(true);
    axios.get('/api/locations/nearby', { params: { lat: candidate.lat, lng: candidate.lng, radius_km: radius }, signal: controller.signal })
      .then(({ data }) => { if (id === requestIdRef.current) { setBranches(data.stores || []); if (data.status === 'stale') setError(data.warning); else setError(''); } })
      .catch(error => { if (id === requestIdRef.current && !axios.isCancel(error)) {
        setBranches([]); setError(error?.response?.data?.error || 'Branch data is temporarily unavailable. Try again later.');
      } })
      .finally(() => { if (id === requestIdRef.current) setLoadingBranches(false); });
    return () => controller.abort();
  }, [open, candidate?.lat, candidate?.lng, radius]);

  const lookup = async event => {
    event.preventDefault();
    if (query.trim().length < 3) { setError('Enter at least three characters.'); return; }
    setLoadingPlaces(true); setError(''); setPlaces([]);
    try {
      const { data } = await axios.get('/api/locations/search', { params: { q: query.trim() } });
      setPlaces(data.places || []);
      if (!data.places?.length) setError('No South African places found. Try a nearby suburb or town.');
    } catch (e) { setError(e?.response?.data?.error || 'Place lookup unavailable.'); }
    finally { setLoadingPlaces(false); }
  };
  const useMyPosition = () => {
    if (!navigator.geolocation) { setError('Location services are not supported in this browser.'); return; }
    setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (coords.latitude < -35.5 || coords.latitude > -21.5 || coords.longitude < 16 || coords.longitude > 34) {
          setError('Choose a location inside South Africa.'); return;
        }
        setCandidate({ name: 'Current location', lat: coords.latitude, lng: coords.longitude });
        setPlaces([]);
      }, () => setError('Location permission was denied. Search for a place instead.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };
  const save = async () => {
    if (!candidate || saving || loadingBranches || error) return;
    setSaving(true);
    const chosen = { ...candidate, radius_km: radius };
    try {
      if (user?.id) await axios.patch('/api/profile', {
        location: chosen.name.slice(0, 100), latitude: chosen.lat, longitude: chosen.lng, radius_km: radius,
      }, { withCredentials: true });
      setShoppingLocation(chosen);
      setOpen(false);
    } catch (e) { setError(e?.response?.data?.error || 'Could not save location.'); }
    finally { setSaving(false); }
  };
  const clear = async () => {
    setSaving(true);
    try {
      if (user?.id) await axios.patch('/api/profile', { latitude: null, longitude: null, location: '' }, { withCredentials: true });
      setShoppingLocation(null);
      setOpen(false);
    } catch (e) { setError(e?.response?.data?.error || 'Could not clear shopping area.'); }
    finally { setSaving(false); }
  };
  const activate = () => setOpen(true);
  return <>
    {variant === 'profile' ? (
      <button type="button" onClick={activate} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100">
        <MapPin className="h-4 w-4" /> Select on map / nearby branches
      </button>
    ) : (
      <button
        type="button"
        onClick={activate}
        title={selected?.name ? `Shopping location: ${selected.name}` : 'Choose your shopping location'}
        aria-label={selected?.name ? `Change shopping location: ${selected.name}` : 'Choose your shopping location'}
        className="inline-flex h-12 min-w-0 max-w-[132px] items-center justify-center gap-1.5 rounded-xl px-1.5 text-left text-sm font-semibold text-emerald-900 transition-colors hover:bg-[#cbe6ce] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:max-w-[155px]"
      >
        <MapPin className="h-6 w-6 shrink-0" strokeWidth={2.15} aria-hidden="true" />
        <span className="hidden truncate leading-tight sm:inline">{selected?.name?.split(',')[0] || 'Set location'}</span>
      </button>
    )}
    {open && createPortal(
      <div role="dialog" aria-modal="true" aria-labelledby="shopping-location-title" className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="flex max-h-[95dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 p-5 sm:p-6">
            <div><h2 id="shopping-location-title" className="text-xl font-black text-slate-900">Nearby supermarkets</h2>
              <p className="text-xs text-slate-500">Only Checkers, Shoprite, Pick n Pay and Woolworths branches</p></div>
            <button type="button" className="rounded-xl p-2 hover:bg-slate-100" onClick={() => setOpen(false)} aria-label="Close location picker"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-4 overflow-y-auto p-5 sm:p-6">
            <form onSubmit={lookup} className="flex gap-2">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={PLACEHOLDER} aria-label="Search South African location" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
              <button type="submit" disabled={loadingPlaces} className="rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-60"><Search className="h-5 w-5" /></button>
              <button type="button" onClick={useMyPosition} title="Use my location" aria-label="Use my current location" className="rounded-xl border border-slate-200 px-3 hover:bg-slate-50"><Navigation className="h-5 w-5" /></button>
            </form>
            {places.length > 0 && <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-2">
              {places.map((p, i) => <button key={`${p.lat}-${p.lng}-${i}`} type="button" onClick={() => { setCandidate(p); setPlaces([]); }} className="flex w-full items-start gap-2 rounded-lg p-2 text-left text-sm hover:bg-emerald-50"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />{p.name}</button>)}
            </div>}
            <label className="flex items-center gap-3 text-sm font-bold text-slate-700">Distance from chosen location
              <select value={radius} onChange={e => setRadius(Number(e.target.value))} className="rounded-xl border border-slate-200 px-3 py-2">{RADII.map(r => <option key={r} value={r}>{r} km</option>)}</select>
            </label>
            {candidate && <>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><MapPin className="h-4 w-4 text-emerald-700" /><span className="truncate">{candidate.name}</span></div>
              <StoreMap location={candidate} branches={branches} />
              <div className="flex items-center justify-between text-sm font-bold text-slate-700"><span>{loadingBranches ? 'Finding verified branch coordinates…' : `${branches.length} mapped branches within ${radius} km`}</span><span className="text-xs text-slate-500">OpenStreetMap data</span></div>
              {branches.length > 0 && <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                {branches.map(b => <a key={b.id} href={`https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=16/${b.lat}/${b.lng}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-slate-100 p-3 text-xs hover:border-emerald-300"><Store className="h-4 w-4 shrink-0 text-emerald-700" /><span className="min-w-0 flex-1"><strong className="block truncate">{b.name}</strong><span className="text-slate-500">{b.store} · {money(b.distanceKm)}</span></span></a>)}
              </div>}
            </>}
            {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
            <p className="text-xs text-slate-500">Prices come from retailer-wide scraping, not individual branch stock systems. Store presence does not guarantee availability. Map data © OpenStreetMap contributors.</p>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 p-4 sm:p-5">
            <button type="button" onClick={clear} disabled={saving} className="rounded-xl px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100">National view</button>
            <button type="button" onClick={save} disabled={!candidate || !!error || saving || loadingBranches} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this location
            </button>
          </div>
        </div>
      </div>, document.body,
    )}
  </>;
}
