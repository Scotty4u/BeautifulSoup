import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, LoaderCircle, MapPin, RefreshCw, Store, AlertTriangle } from 'lucide-react';
import { nearbyBasketChoices } from '../utils/nearbyShops.mjs';

const money = (value) => `R ${Number(value || 0).toFixed(2)}`;
const supportedRadius = [5, 10, 15, 20, 30, 50];

function validLocation(location) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const radius = Number(location?.radius_km);
  return location && Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -35.5 && lat <= -21.5 && lng >= 16 && lng <= 34 &&
    supportedRadius.includes(radius);
}

export default function NearbyBasketSection({ report, location }) {
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLocation = validLocation(location);
  const results = useMemo(() => nearbyBasketChoices(report, branches), [report, branches]);
  const recommended = results.bestComplete || results.bestPartial;
  const otherOptions = results.options.filter((option) => option.name !== recommended?.name);

  useEffect(() => {
    if (!hasLocation) {
      setBranches([]);
      setError('');
      setStale(false);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setBranches([]);
    setError('');
    setStale(false);

    axios.get('/api/locations/nearby', {
      params: { lat: location.lat, lng: location.lng, radius_km: location.radius_km },
      withCredentials: true,
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        // The API returns only real mapped branches from four scraper chains.
        if (data?.status === 'unavailable' || data?.filterActive === false) {
          setError(data?.error || 'Verified nearby branch data is unavailable.');
          return;
        }
        setBranches(Array.isArray(data?.stores) ? data.stores : []);
        setStale(data?.status === 'stale');
      })
      .catch((err) => {
        if (controller.signal.aborted || axios.isCancel(err)) return;
        setError(err?.response?.data?.error || 'Nearby branch data is temporarily unavailable.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [hasLocation, location?.lat, location?.lng, location?.radius_km, refreshKey]);

  return (
    <section className="space-y-4 rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-7" aria-label="Cheapest nearby shop">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-700" />
            <h2 className="text-xl font-black text-slate-900">Cheapest nearby shop for your list</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Complete-basket price first, then closest mapped branch for that retailer. Only Checkers, Shoprite, Pick n Pay and Woolworths.
          </p>
        </div>
        {hasLocation && <button type="button" onClick={() => setRefreshKey((n) => n + 1)} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh branches
        </button>}
      </div>

      {!hasLocation ? (
        <div className="rounded-2xl bg-emerald-50 p-5">
          <p className="text-sm font-semibold text-emerald-900">Choose your shopping location to see the cheapest mapped shop near you.</p>
          <button type="button" onClick={() => navigate('/account/profile')}
            className="mt-3 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">
            Set my location
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
            <MapPin className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="min-w-0 truncate">{location.name || 'Your selected shopping area'}</span>
            <span className="rounded-lg bg-slate-100 px-2 py-1">Within {location.radius_km} km</span>
            <button type="button" onClick={() => navigate('/account/profile')} className="font-bold text-emerald-700 underline underline-offset-2">Change</button>
          </div>

          {loading && <div role="status" className="flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
            <LoaderCircle className="h-5 w-5 animate-spin text-emerald-700" /> Finding verified nearby supermarket branches...
          </div>}
          {!loading && error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error} We cannot recommend a nearby branch without real location data.
          </div>}
          {!loading && !error && stale && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">Showing previously mapped branch coordinates because live map lookup is unavailable.</p>}
          {!loading && !error && !recommended && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            No nearby mapped branch has a verified offer for this basket within {location.radius_km} km. Try a larger radius or another location. No shop has been assumed or invented.
          </div>}

          {!loading && !error && recommended && (
            <>
              <div className={`rounded-2xl border p-4 sm:p-5 ${recommended.complete ? 'border-emerald-400 bg-emerald-50/60' : 'border-amber-300 bg-amber-50/50'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${recommended.complete ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-900'}`}>
                      {recommended.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {recommended.complete ? 'Lowest-priced complete basket nearby' : 'Closest matching partial basket nearby'}
                    </span>
                    <h3 className="mt-3 text-2xl font-black text-slate-900">{recommended.name}</h3>
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-700"><Store className="h-4 w-4 text-emerald-700" /> {recommended.branch.name}</p>
                    {recommended.branch.address && <p className="mt-1 text-xs text-slate-600">{recommended.branch.address}</p>}
                    <p className="mt-2 text-xs font-semibold text-emerald-800">{recommended.branch.distanceKm.toFixed(1)} km straight-line distance · {recommended.found}/{report.itemCount} products matched</p>
                    {!recommended.complete && <p className="mt-2 text-xs font-bold text-amber-800">Incomplete basket: {recommended.missing} item(s) missing. This is NOT a full-basket quote.</p>}
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-2xl font-black text-emerald-800">{money(recommended.total)}</p>
                    <p className="text-[11px] font-semibold text-slate-500">{recommended.complete ? 'Retailer-wide basket estimate' : 'Available-items subtotal only'}</p>
                  </div>
                </div>
                <a target="_blank" rel="noopener noreferrer"
                  href={`https://www.openstreetmap.org/?mlat=${recommended.branch.lat}&mlon=${recommended.branch.lng}#map=16/${recommended.branch.lat}/${recommended.branch.lng}`}
                  className="mt-4 inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50">
                  View mapped branch <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>

              {otherOptions.length > 0 && <div className="space-y-2">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Other mapped nearby retailers</p>
                {otherOptions.map((option) => (
                  <div key={option.name} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 sm:p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900">{option.name} · {option.branch.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{option.branch.distanceKm.toFixed(1)} km away · {option.found}/{report.itemCount} items {option.complete ? '· Complete basket' : '· Partial basket only'}</p>
                    </div>
                    <p className="text-right text-sm font-black text-slate-900">{money(option.total)}{!option.complete && <span className="ml-1 text-[10px] font-semibold text-amber-700">partial</span>}</p>
                  </div>
                ))}
              </div>}
            </>
          )}
        </>
      )}
      <p className="text-[11px] leading-5 text-slate-500">Branch coordinates are from mapped OpenStreetMap locations. Distances are straight-line estimates, not driving routes. Scraped prices are retailer-wide; actual branch prices and stock may differ. Prices may change at the retailer.</p>
    </section>
  );
}
