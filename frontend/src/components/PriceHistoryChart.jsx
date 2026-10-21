import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { TrendingDown, TrendingUp } from 'lucide-react';

const money = (n) => `R ${Number(n).toFixed(2)}`;
export default function PriceHistoryChart({ productId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    axios.get(`/api/analytics/price-history/${encodeURIComponent(productId)}`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (!controller.signal.aborted) setError('Price history is unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId]);
  const points = useMemo(() => rows.filter(row => Number.isFinite(Number(row.price)) && Number(row.price) > 0 && /^\d{4}-\d\d-\d\d$/.test(row.date || ''))
    .map(row => ({ ...row, price: Number(row.price) })), [rows]);
  const graph = useMemo(() => {
    if (points.length < 2) return null;
    const low = Math.min(...points.map(p => p.price));
    const high = Math.max(...points.map(p => p.price));
    const spread = Math.max(1, high - low);
    const width = 680, height = 200, padding = 24;
    const times = points.map(p => Date.parse(`${p.date}T00:00:00Z`));
    const start = Math.min(...times), end = Math.max(...times);
    const coords = points.map((p, i) => ({ x: padding + (end > start ? (times[i] - start) / (end - start) : i / (points.length - 1)) * (width - 2 * padding), y: height - padding - (p.price - low) * (height - 2 * padding) / spread, ...p }));
    return { coords, low, high, width, height, path: coords.map(p => `${p.x},${p.y}`).join(' ') };
  }, [points]);
  const change = points.length > 1 ? points.at(-1).price - points[0].price : 0;
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-label="Price history">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black text-slate-900">Price history</h2><p className="mt-1 text-xs text-slate-500">Actual indexed observations for this product and retailer, not a live stock guarantee.</p></div>{points.length > 1 && <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-extrabold ${change < 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{change <= 0 ? <TrendingDown size={17}/> : <TrendingUp size={17}/>} {change < 0 ? '-' : '+'}{money(Math.abs(change))}</span>}</div>
    {loading ? <div className="mt-5 h-40 animate-pulse rounded-2xl bg-slate-100"/> : error ? <p className="mt-4 text-sm text-red-700">{error}</p> : points.length < 2 ? <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{points.length === 1 ? `Only one observed price (${money(points[0].price)}) is available so far. A trend will appear after more price observations.` : 'No recorded price observations yet.'}</p> : <>
      <div className="mt-6 w-full overflow-hidden"><svg viewBox={`0 0 ${graph.width} ${graph.height}`} role="img" aria-label={`Price trend from ${money(points[0].price)} to ${money(points.at(-1).price)}`} className="w-full">
        {[0, 1, 2, 3].map(i => <line key={i} x1="24" x2="656" y1={24 + i * 50} y2={24 + i * 50} stroke="#e2e8f0" strokeDasharray="4 6"/>)}
        <polyline points={graph.path} fill="none" stroke="#059669" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        {graph.coords.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={points.length > 100 ? 1.5 : 3.5} fill="#047857"><title>{p.date}: {money(p.price)}</title></circle>)}
      </svg></div><div className="flex justify-between gap-2 text-xs font-bold text-slate-500"><span>{points[0].date}</span><span>Low {money(graph.low)} · High {money(graph.high)}</span><span>{points.at(-1).date}</span></div>
    </>}
  </section>;
}
