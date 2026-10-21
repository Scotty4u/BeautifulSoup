import { Link } from 'react-router-dom';
import { ShoppingBasket, MapPin, ArrowUpRight, Heart } from 'lucide-react';
import { RETAILERS } from '../utils/retailers';


export default function Footer() {

  return (
    <footer className="mt-auto border-t border-emerald-100 bg-white text-slate-600">
      <div className="mx-auto grid max-w-7xl gap-9 px-5 pb-9 pt-10 sm:px-7 md:grid-cols-12 md:gap-7 lg:pt-12">
        <div className="md:col-span-5 lg:col-span-5">
          <Link to="/" className="inline-flex items-center gap-2.5 text-xl font-black tracking-tight text-[#18472C]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-700 text-white"><ShoppingBasket className="h-6 w-6" /></span>
            SmartBasket
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-500">Plan your grocery shop, compare retailer-wide prices, and keep your lists in one place.</p>
          <p className="mt-3 flex max-w-sm items-start gap-2 text-xs leading-5 text-slate-500">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> Nearby branches are mapped for convenience; listed prices and stock are not guaranteed at a specific branch.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 md:col-span-7 md:grid-cols-2 lg:col-span-7">
          <div>
            <h2 className="mb-4 text-sm font-extrabold text-slate-900">Browse supermarkets</h2>
            <ul className="space-y-3">
              {RETAILERS.map((store) => (
                <li key={store.slug}><Link to={`/store/${store.slug}`} className="group inline-flex items-center gap-1.5 text-sm hover:text-emerald-700">{store.name}<ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-4 text-sm font-extrabold text-slate-900">SmartBasket</h2>
            <ul className="space-y-3 text-sm">
              <li><Link className="hover:text-emerald-700" to="/search?q=all">Browse products</Link></li>
              <li><Link className="hover:text-emerald-700" to="/basket">My shopping basket</Link></li>
              <li><Link className="hover:text-emerald-700" to="/">Home</Link></li>
              <li><Link className="hover:text-emerald-700" to="/search?q=all">Browse all groceries</Link></li>
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-100 bg-[#F4F8F5]">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <span>© {new Date().getFullYear()} SmartBasket. Independently built price-comparison platform.</span>
          <span className="inline-flex items-center gap-1">Made for smarter shopping <Heart className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /></span>
        </div>
      </div>
    </footer>
  );
}
