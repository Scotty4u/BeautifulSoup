import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, ShoppingCart } from 'lucide-react';

const STORES = [
  {
    id: 'Checkers',
    label: 'Checkers',
    emoji: '🟡',
    description: 'Great deals & Sixty60 delivery',
    color: 'border-amber-400 bg-amber-50 ring-amber-300',
    check: 'bg-amber-400',
    default: true,
  },
  {
    id: 'Shoprite',
    label: 'Shoprite',
    emoji: '🔵',
    description: 'Everyday low prices nationwide',
    color: 'border-blue-400 bg-blue-50 ring-blue-300',
    check: 'bg-blue-500',
    default: false,
  },
  {
    id: 'Pick n Pay',
    label: 'Pick n Pay',
    emoji: '🔴',
    description: 'Wide range & Smart Shopper rewards',
    color: 'border-red-400 bg-red-50 ring-red-300',
    check: 'bg-red-500',
    default: false,
  },
  {
    id: 'Woolworths',
    label: 'Woolworths',
    emoji: '🟣',
    description: 'Premium quality & fresh food',
    color: 'border-purple-400 bg-purple-50 ring-purple-300',
    check: 'bg-purple-500',
    default: false,
  },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(['Checkers']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (storeId) => {
    setSelected(prev =>
      prev.includes(storeId)
        ? prev.length > 1 ? prev.filter(s => s !== storeId) : prev // keep at least 1
        : [...prev, storeId]
    );
    setError('');
  };

  const handleSubmit = () => {
    if (selected.length === 0) {
      setError('Please select at least one store.');
      return;
    }
    setSaving(true);
    const formData = new FormData();
    selected.forEach(s => formData.append('preferred_stores', s));

    axios.post('http://localhost:5000/onboarding', formData, { withCredentials: true })
      .then(() => navigate('/account'))
      .catch(() => navigate('/account'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center mx-auto shadow-lg shadow-emerald-200">
            <ShoppingCart className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-900">Set Your Preferences</h1>
          <p className="text-slate-500 text-sm leading-relaxed">
            Select one or more stores you shop at. We'll personalise your price comparisons.
          </p>
        </div>

        {/* Store Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {STORES.map(store => {
            const isSelected = selected.includes(store.id);
            return (
              <button
                key={store.id}
                type="button"
                onClick={() => toggle(store.id)}
                className={`relative text-left rounded-2xl border-2 p-4 transition-all ring-0 focus:outline-none
                  ${isSelected
                    ? `${store.color} ring-2 shadow-sm`
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                  }`}
              >
                {/* Checkmark */}
                {isSelected && (
                  <div className={`absolute top-3 right-3 w-6 h-6 rounded-full ${store.check} flex items-center justify-center shadow`}>
                    <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                  </div>
                )}

                <div className="space-y-1 pr-6">
                  <div className="text-2xl">{store.emoji}</div>
                  <div className="font-black text-slate-900 text-base">{store.label}</div>
                  <div className="text-xs text-slate-500 leading-snug">{store.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected summary */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">Selected:</span>
          {selected.map(s => (
            <span key={s} className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
              {s}
            </span>
          ))}
        </div>

        {/* Error */}
        {error && <p className="text-sm text-red-500 font-medium">{error}</p>}

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={saving || selected.length === 0}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 rounded-xl shadow-md shadow-emerald-200 text-base disabled:opacity-50"
        >
          {saving ? 'Saving...' : `Save & Continue →`}
        </Button>

        <p className="text-center text-xs text-slate-400">
          You can change this anytime from your account settings.
        </p>
      </div>
    </div>
  );
}