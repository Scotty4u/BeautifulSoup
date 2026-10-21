import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { MapPin, Search, Navigation, LoaderCircle } from 'lucide-react';
import { getShoppingLocation } from '../utils/ShoppingLocation';

const VALID_PROVINCES = ['Eastern Cape', 'Western Cape', 'Northern Cape', 'Gauteng', 'KwaZulu-Natal', 'Free State', 'North West', 'Limpopo', 'Mpumalanga'];

export function normalizeAddress(place = {}) {
  const a = place.address || {};
  const province = VALID_PROVINCES.find((value) => value.toLowerCase() === String(a.province || '').toLowerCase());
  return {
    street: String(a.street || '').slice(0, 180),
    suburb: String(a.suburb || '').slice(0, 100),
    city: String(a.city || '').slice(0, 100),
    ...(province ? { province } : {}),
    postal_code: /^\d{4}$/.test(String(a.postal_code || '')) ? String(a.postal_code) : ''
  };
}

export default function AddressLookup({ onSelect, autoFromShoppingLocation = false }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [location] = useState(() => getShoppingLocation());
  const didAutoLoad = useRef(false);

  const apply = (place) => {
    setChosen(place);
    setQuery(place.name || 'Selected location');
    setResults([]);
    onSelect(normalizeAddress(place));
  };

  const fromShoppingLocation = async (silent = false) => {
    if (!location || location.lat == null || location.lng == null) return;
    setLoading(true);
    if (!silent) setError('');
    try {
      const { data } = await axios.get('/api/orders/address-reverse', {
        params: { lat: location.lat, lng: location.lng }, withCredentials: true
      });
      apply(data.place);
    } catch (e) {
      // Never invent street numbers or postal codes from coordinates.
      setQuery(String(location.name || 'My shopping area'));
      setChosen(location);
      if (!silent) setError(e?.response?.data?.error || 'Could not identify address details. Fill them in manually.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!autoFromShoppingLocation || didAutoLoad.current || !location?.lat || !location?.lng) return;
    didAutoLoad.current = true;
    fromShoppingLocation(true);
    // Only run once for a newly opened blank form, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFromShoppingLocation]);

  const search = async (event) => {
    event.preventDefault();
    if (query.trim().length < 3) { setError('Enter at least 3 characters.'); return; }
    setLoading(true); setError('');
    try {
      const { data } = await axios.get('/api/locations/search', { params: { q: query.trim() } });
      setResults(data.places || []);
      if (!data.places?.length) setError('No matching South African addresses found. Try adding a suburb or city.');
    } catch (e) { setError(e?.response?.data?.error || 'Address search is unavailable. Enter the details manually.'); }
    finally { setLoading(false); }
  };

  const latitude = Number(chosen?.lat), longitude = Number(chosen?.lng);
  const showMap = chosen && Number.isFinite(latitude) && Number.isFinite(longitude);
  const mapLink = showMap ? `https://www.openstreetmap.org/export/embed.html?bbox=${longitude-0.009}%2C${latitude-0.006}%2C${longitude+0.009}%2C${latitude+0.006}&layer=mapnik&marker=${latitude}%2C${longitude}` : '';

  return <div className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
    <label className="block text-sm font-extrabold text-emerald-950">Find your delivery address on the map</label>
    <form onSubmit={search} className="flex min-w-0 gap-2">
      <input aria-label="Address or street search" value={query} onChange={(e) => { setQuery(e.target.value); setResults([]); }} placeholder="Street, suburb, city…" className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-600" />
      <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-700 px-3 font-bold text-white disabled:opacity-50" aria-label="Find address">{loading ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4" />}<span className="hidden sm:inline">Find</span></button>
    </form>
    {location?.lat != null && <button type="button" onClick={() => fromShoppingLocation()} className="inline-flex items-center gap-2 text-xs font-bold text-emerald-800 hover:underline"><Navigation className="h-4 w-4"/> Use my selected shopping location</button>}
    {results.length > 0 && <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border bg-white p-1">{results.map((place, i) => <button key={`${place.lat}-${place.lng}-${i}`} onClick={() => apply(place)} type="button" className="flex w-full items-start gap-2 rounded-lg p-2 text-left text-xs text-slate-800 hover:bg-emerald-50"><MapPin className="h-4 w-4 shrink-0 text-emerald-700"/>{place.name}</button>)}</div>}
    {showMap && <div className="overflow-hidden rounded-xl border bg-slate-100"><iframe title="Selected delivery area map" className="h-40 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={mapLink}/><p className="px-3 py-2 text-xs text-slate-600">Check the pin and review all address fields before saving. Map data © OpenStreetMap contributors.</p></div>}
    {error && <p role="alert" className="text-xs text-amber-800">{error}</p>}
    <p className="text-xs text-slate-600">Search then select a suggestion to fill available details. House number, recipient, phone or postal code may still need to be entered manually.</p>
  </div>;
}
