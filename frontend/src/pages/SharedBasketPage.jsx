import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { Store, Share2, ArrowLeft } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { Button } from '@/components/ui/button';

export default function SharedBasketPage() {
  const { token } = useParams();
  const [basket, setBasket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    axios.get(`/api/shared/basket/${token}`)
      .then(res => {
        setBasket(res.data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center text-slate-500 font-medium">
        Loading shared shopping list...
      </div>
    );
  }

  if (error || !basket) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="bg-white rounded-3xl border border-[#E0E8E1] p-12 shadow-sm">
          <h2 className="text-xl font-bold text-slate-800">List Not Found</h2>
          <p className="text-slate-500 text-sm mt-1 mb-6">
            This shared link is invalid or the list has been removed.
          </p>
          <Link to="/">
            <Button className="bg-[#2E7D32] hover:bg-[#256629] text-white font-bold rounded-xl px-6">
              Go Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const totalUnits = basket.items.reduce((acc, item) => acc + (item.quantity || 1), 0);
  const totalPrice = basket.items.reduce((acc, item) => acc + (item.price * (item.quantity || 1)), 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-2 rounded-xl bg-white border border-[#E0E8E1] hover:bg-slate-50 transition-colors text-slate-600">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">{basket.name}</h1>
            <p className="text-xs font-semibold text-slate-400 mt-0.5">
              Shared by <span className="text-slate-700 font-bold">{basket.owner}</span> • {basket.items.length} items ({totalUnits} units)
            </p>
          </div>
        </div>

        <button 
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            showToast("Link copied to clipboard!");
          }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#E0E8E1] text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm"
        >
          <Share2 className="w-3.5 h-3.5" />
          Copy Link
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2 flex flex-col gap-3">
          {basket.items.map(item => (
            <div key={item.id} className="bg-white rounded-2xl border border-[#E0E8E1] p-4 flex items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-16 h-16 bg-[#F4F7F4] rounded-xl flex items-center justify-center p-2 shrink-0">
                  <img src={item.imageUrl || 'https://placehold.co/60x60/f8fafc/94a3b8?text=Item'} alt={item.name} className="max-h-full max-w-full object-contain" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-slate-800 truncate">{item.name}</h4>
                  <span className="inline-block text-[10px] font-bold text-[#2E7D32] bg-[#E7F3E8] px-2 py-0.5 rounded mt-1">
                    {item.store}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-6 shrink-0 text-right">
                <span className="text-xs font-semibold text-slate-500">Qty: {item.quantity || 1}</span>
                <span className="text-sm font-black text-slate-800 min-w-[65px]">
                  R {(item.price * (item.quantity || 1)).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-[#E0E8E1] p-6 shadow-sm flex flex-col gap-5">
          <div>
            <h3 className="text-base font-black text-slate-900">List Summary</h3>
            <p className="text-xs text-slate-400 mt-0.5">Overview of shared items</p>
          </div>
          <div className="flex justify-between items-baseline border-b border-slate-100 pb-4">
            <span className="text-xs font-bold text-slate-700">Total Estimated Cost</span>
            <span className="text-xl font-black text-[#2E7D32]">
              R {totalPrice.toFixed(2)}
            </span>
          </div>
          <Link to="/search">
            <Button className="w-full bg-[#2E7D32] hover:bg-[#256629] text-white font-bold rounded-xl py-3">
              Start Your Own Comparison →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}