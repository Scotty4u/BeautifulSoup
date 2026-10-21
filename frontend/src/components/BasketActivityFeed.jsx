import { useMemo, useState } from 'react';
import { Activity, Minus, PackagePlus, Plus, ShoppingBasket, Tag, Clock3 } from 'lucide-react';

const EVENT_STYLES = {
  created: { Icon: ShoppingBasket, bg: 'bg-emerald-100', color: 'text-emerald-700', verb: 'created the list' },
  added: { Icon: PackagePlus, bg: 'bg-emerald-100', color: 'text-emerald-700', verb: 'added' },
  removed: { Icon: Minus, bg: 'bg-rose-100', color: 'text-rose-700', verb: 'removed' },
  quantity_increased: { Icon: Plus, bg: 'bg-blue-100', color: 'text-blue-700', verb: 'increased the quantity of' },
  quantity_decreased: { Icon: Minus, bg: 'bg-amber-100', color: 'text-amber-700', verb: 'decreased the quantity of' },
  renamed: { Icon: Tag, bg: 'bg-purple-100', color: 'text-purple-700', verb: 'renamed the list' },
  legacy: { Icon: Activity, bg: 'bg-slate-100', color: 'text-slate-600', verb: 'updated the list' },
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function describe(entry) {
  const verb = EVENT_STYLES[entry?.type]?.verb || 'updated the list';
  if (entry?.type === 'legacy') return entry?.action || 'updated the list';
  if (entry?.type === 'created' || entry?.type === 'renamed') return verb;
  return verb;
}

export default function BasketActivityFeed({ activities = [], shared = false }) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('all');
  const safeEvents = useMemo(() => (Array.isArray(activities) ? activities : [])
    .filter((e) => e && (e.type || e.action))
    .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)), [activities]);
  const filtered = safeEvents.filter((event) => {
    if (filter === 'items') return ['added', 'removed'].includes(event.type);
    if (filter === 'quantities') return ['quantity_increased', 'quantity_decreased'].includes(event.type);
    return true;
  });
  const visible = showAll ? filtered : filtered.slice(0, 8);

  return (
    <section aria-label="Basket activity" className="mt-6 overflow-hidden rounded-3xl border border-[#E0E8E1] bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Activity className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-black text-slate-900">List activity</h2>
              <p className="text-xs text-slate-500">{shared ? 'See what members changed in this shared list' : 'Changes made by you and other members'}</p>
            </div>
          </div>
          <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">{safeEvents.length} updates</span>
        </div>
        {safeEvents.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter activity">
          {[['all', 'All activity'], ['items', 'Items'], ['quantities', 'Quantities']].map(([key, label]) => (
            <button key={key} type="button" onClick={() => { setFilter(key); setShowAll(false); }}
              aria-pressed={filter === key}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${filter === key ? 'bg-[#059669] text-white' : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'}`}>{label}</button>
          ))}
        </div>}
      </div>
      {visible.length === 0 ? <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <Clock3 className="h-8 w-8 text-slate-300" />
        <p className="font-bold text-slate-700">No activity yet</p>
        <p className="max-w-sm text-sm text-slate-500">Changes like adding products, removing products or adjusting quantities will appear here.</p>
      </div> : <div className="divide-y divide-slate-100 px-4 sm:px-6">
        {visible.map((event, index) => {
          const cfg = EVENT_STYLES[event.type] || EVENT_STYLES.legacy;
          const Icon = cfg.Icon;
          const actor = event?.user?.username || event?.username || 'Former member';
          const oldQty = Number(event.previous_quantity);
          const newQty = Number(event.quantity);
          const hasQuantities = Number.isFinite(oldQty) && Number.isFinite(newQty) && event.previous_quantity != null && event.quantity != null;
          return <article key={event.id || `${event.created_at}-${index}`} className="flex gap-3 py-4">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cfg.bg} ${cfg.color}`}><Icon className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm leading-6 text-slate-700">
                <strong className="font-extrabold text-slate-900">{actor}</strong>{' '}
                {describe(event)}{' '}
                {event.type !== 'legacy' && !['created', 'renamed'].includes(event.type) && <strong className="font-bold text-slate-900">{event.product_name || 'a product'}</strong>}
                {event.type === 'renamed' && event.product_name && <> to <strong className="text-slate-900">{event.product_name}</strong></>}
                {event.type === 'added' && Number(event.quantity) > 1 && <span className="ml-1 text-emerald-700">({event.quantity} units)</span>}
                {['quantity_increased', 'quantity_decreased'].includes(event.type) && hasQuantities && <span className="ml-1 whitespace-nowrap font-bold text-slate-500">({oldQty} → {newQty})</span>}
              </p>
              {event.created_at && <time dateTime={event.created_at} className="mt-1 block text-xs font-medium text-slate-400">{formatDate(event.created_at)}</time>}
            </div>
          </article>;
        })}
      </div>}
      {filtered.length > 8 && <div className="border-t border-slate-100 p-4 text-center">
        <button type="button" className="rounded-xl px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer updates' : `Show ${filtered.length - 8} more updates`}</button>
      </div>}
    </section>
  );
}
