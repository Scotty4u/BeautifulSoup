import { useLayoutEffect, useRef, useState } from 'react';
import { Clock3, Search, X } from 'lucide-react';

export default function SearchHistoryDropdown({ items = [], query = '', loading, onChoose, onRemove, onClose }) {
  const panelRef = useRef(null);
  const [maxHeight, setMaxHeight] = useState(320);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const viewport = window.visualViewport;
    const fitToViewport = () => {
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      setMaxHeight(Math.max(0, Math.min(320, bottom - panel.getBoundingClientRect().top - 12)));
    };
    fitToViewport();
    window.addEventListener('resize', fitToViewport);
    window.addEventListener('scroll', fitToViewport, true);
    viewport?.addEventListener('resize', fitToViewport);
    viewport?.addEventListener('scroll', fitToViewport);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitToViewport);
    if (panel.parentElement) observer?.observe(panel.parentElement);
    return () => {
      window.removeEventListener('resize', fitToViewport);
      window.removeEventListener('scroll', fitToViewport, true);
      viewport?.removeEventListener('resize', fitToViewport);
      viewport?.removeEventListener('scroll', fitToViewport);
      observer?.disconnect();
    };
  }, []);

  const needle = query.trim().toLowerCase();
  const shown = items.filter((item) => item?.query && item.query.toLowerCase().includes(needle)).slice(0, 8);
  return (
    <div ref={panelRef} style={{ maxHeight }} role="region" aria-label="Recent searches" className="absolute left-0 right-0 top-full z-[110] mt-2 box-border overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-white/50 bg-white p-2 text-slate-800 shadow-[0_10px_30px_rgba(15,23,42,0.12)] backdrop-blur-2xl supports-[backdrop-filter]:bg-white/[0.97]">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">Recent searches</span>
        <button type="button" onClick={onClose} aria-label="Close search history" className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"><X className="h-4 w-4" /></button>
      </div>
      {shown.map((item, index) => (
        <div key={`${item.query}-${index}`} className="flex items-center gap-1 rounded-xl transition-colors hover:bg-white/40 focus-within:bg-white/40">
          <button type="button" onClick={() => onChoose(item.query)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 text-slate-800">
            <Clock3 className="h-4 w-4 shrink-0 text-slate-500" /><span className="truncate">{item.query}</span>
          </button>
          <button type="button" aria-label={`Remove ${item.query} from history`} onClick={() => onRemove(item)} className="mr-2 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-50/80 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"><X className="h-4 w-4" /></button>
        </div>
      ))}
      {!shown.length && <p className="px-3 py-4 text-xs text-slate-600">{loading ? 'Loading recent searches...' : needle ? 'No matching recent searches.' : 'Your recent searches will appear here.'}</p>}
      {needle && !shown.some((i) => i.query.toLowerCase() === needle) && <button type="button" onClick={() => onChoose(query)} className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-white/60 px-3 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"><Search className="h-4 w-4" /> Search for “{query.trim()}”</button>}
    </div>
  );
}