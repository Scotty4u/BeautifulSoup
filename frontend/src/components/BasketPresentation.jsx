import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Package, ShoppingBasket } from 'lucide-react';

export const currency = (value) => {
  const number = Number(value);
  return `R ${Number.isFinite(number) ? number.toFixed(2) : '0.00'}`;
};
export const quantityOf = (item) => Math.max(1, Math.floor(Number(item?.quantity) || 1));
export const unitPrice = (item) => Math.max(0, Number(item?.price) || 0);
export const subtotal = (item) => quantityOf(item) * unitPrice(item);
export const basketSummary = (items = []) => ({
  lines: items.length,
  units: items.reduce((total, item) => total + quantityOf(item), 0),
  total: items.reduce((total, item) => total + subtotal(item), 0),
});

export function BasketLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-9 sm:px-6" role="status" aria-label="Loading your basket">
      <div className="h-36 animate-pulse rounded-3xl bg-emerald-100" />
      {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-100 bg-white" />)}
    </div>
  );
}

export function BasketItemRow({ item, controls = null, canOpenProduct = true }) {
  const [broken, setBroken] = useState(false);
  const productUrl = item?.id ? `/product/${encodeURIComponent(item.id)}` : null;
  const productDetail = (
    <>
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#F4F7F4] p-2 sm:h-24 sm:w-24">
        {item?.imageUrl && !broken ? (
          <img src={item.imageUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" onError={() => setBroken(true)} />
        ) : <Package className="h-9 w-9 text-slate-300" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <span className="mb-1.5 inline-block rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700">{item.store || 'Retailer'}</span>
        <h3 className="line-clamp-2 text-sm font-extrabold leading-snug text-slate-900 sm:text-base">{item.name || 'Unnamed product'}</h3>
        <p className="mt-1.5 text-xs text-slate-500">{currency(unitPrice(item))} per item</p>
      </div>
    </>
  );
  return (
    <article className="rounded-2xl border border-[#E0E8E1] bg-white p-3 shadow-sm transition-shadow hover:shadow-md sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {canOpenProduct && productUrl ? (
          <Link to={productUrl} state={{ product: item }} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 sm:gap-4" aria-label={`View ${item.name}`}>
            {productDetail}
          </Link>
        ) : <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">{productDetail}</div>}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
          <strong className="whitespace-nowrap text-lg font-black text-[#047857]">{currency(subtotal(item))}</strong>
          {controls || <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">Qty {quantityOf(item)}</span>}
        </div>
      </div>
    </article>
  );
}

export function BasketSummaryCard({ items, caption = 'Estimated total', children }) {
  const totals = basketSummary(items);
  return (
    <aside className="rounded-3xl border border-[#E0E8E1] bg-white p-5 shadow-sm lg:sticky lg:top-24 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><ShoppingBasket className="h-5 w-5" /></span>
        <div><h2 className="text-lg font-black text-slate-900">Basket summary</h2><p className="text-xs text-slate-500">Your item breakdown</p></div>
      </div>
      <div className="space-y-3 border-b border-slate-100 pb-5 text-sm">
        <div className="flex justify-between text-slate-600"><span>Products</span><strong className="text-slate-900">{totals.lines}</strong></div>
        <div className="flex justify-between text-slate-600"><span>Total units</span><strong className="text-slate-900">{totals.units}</strong></div>
      </div>
      <div className="flex items-end justify-between gap-3 py-5"><span className="text-sm font-bold text-slate-700">{caption}</span><span className="text-2xl font-black text-[#047857]">{currency(totals.total)}</span></div>
      <p className="mb-5 text-xs leading-relaxed text-slate-500">Prices are saved estimates and can change at the retailer.</p>
      {children}
    </aside>
  );
}

export function BasketEmpty({ title = 'No products in this basket', description = 'Products you save will appear here.' }) {
  return <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
    <Package className="mx-auto h-12 w-12 text-slate-300" />
    <h2 className="mt-4 text-lg font-extrabold text-slate-900">{title}</h2>
    <p className="mt-2 text-sm text-slate-500">{description}</p>
    <Link to="/search" className="mt-5 inline-flex items-center gap-2 font-bold text-emerald-700 hover:text-emerald-800">Browse groceries <ArrowRight className="h-4 w-4" /></Link>
  </div>;
}
