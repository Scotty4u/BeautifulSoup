import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowRight, LockKeyhole, LogIn, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Drop-in replacement for the basket's "Compare retailer prices" button.
 * Keep the rest of BasketPage and all add-to-cart functions unchanged.
 *
 * Usage: <BasketCompareButton onCompare={handleCompareRetailerPrices} disabled={!items.length} />
 *
 * onCompare is the existing authenticated basket comparison function. Guests
 * never call it: they can add products to their local basket, but must sign in
 * before comparing their WHOLE basket across shops.
 */
export default function BasketCompareButton({
  onCompare,
  disabled = false,
  busy = false,
  className = '',
  children = 'Compare retailer prices',
}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [showLoginChoice, setShowLoginChoice] = useState(false);

  const compare = () => {
    if (loading || disabled || busy) return;
    if (!user) {
      setShowLoginChoice(true);
      return;
    }
    onCompare?.();
  };
  const goToAuth = (page) => {
    setShowLoginChoice(false);
    const target = '/basket';
    // The local basket is NOT cleared; it will still be there after login.
    navigate(`/${page}?next=${encodeURIComponent(target)}`, {
      state: { from: target, reason: 'basket-comparison' },
    });
  };

  return (
    <>
      <Button type="button" onClick={compare} disabled={disabled || busy || loading}
        className={className || 'w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold'}>
        <ArrowRight className="mr-2 h-4 w-4" />
        {busy ? 'Comparing…' : children}
      </Button>
      {showLoginChoice && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 p-4"
          role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowLoginChoice(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="basket-signin-title"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8"
            onKeyDown={(event) => { if (event.key === 'Escape') setShowLoginChoice(false); }}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <LockKeyhole className="h-6 w-6" aria-hidden="true" />
              </div>
              <button type="button" onClick={() => setShowLoginChoice(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close sign in prompt">
                <X className="h-5 w-5" />
              </button>
            </div>
            <h2 id="basket-signin-title" className="text-xl font-extrabold text-slate-900">
              Sign in to compare your basket
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              You can add items without an account. To find the cheapest stores for your whole basket,
              please sign in or create an account. Your items will stay in your basket.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button type="button" className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700"
                onClick={() => goToAuth('login')}>
                <LogIn className="mr-2 h-4 w-4" /> Sign in
              </Button>
              <Button type="button" variant="outline" className="flex-1 rounded-xl"
                onClick={() => goToAuth('signup')}>
                <UserPlus className="mr-2 h-4 w-4" /> Create account
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
