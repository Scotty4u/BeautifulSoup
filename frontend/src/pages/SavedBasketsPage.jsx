import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Bookmark, ShoppingBag, ChevronRight, Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function SavedBasketsPage() {
  const [baskets, setBaskets] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/db/saved-baskets')
      .then(res => {
        setBaskets(res.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Saved Shopping Lists</h1>
          <p className="text-sm text-slate-500 mt-1">Manage and compare your custom saved grocery baskets.</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 bg-slate-200 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : baskets.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-bold text-lg">No saved baskets found</p>
          <p className="text-slate-400 text-sm mt-1">Save your active basket from the cart page to view it here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {baskets.map(b => {
            const maxPreviews = 3;
            const previewItems = (b.items || []).slice(0, maxPreviews);
            const overflowCount = (b.items || []).length - maxPreviews;

            return (
              <Card 
                key={b.id} 
                className="group border border-slate-200 hover:border-emerald-500/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col justify-between rounded-2xl bg-white"
                onClick={() => navigate(`/saved/${b.id}`)}
              >
                <CardContent className="p-6 flex flex-col h-full justify-between gap-5">
                  
                  {/* Header Info */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md">
                        {b.items?.length || 0} {(b.items?.length || 0) === 1 ? 'item' : 'items'}
                      </span>
                      <span className="text-xs font-medium text-slate-400">{b.date}</span>
                    </div>
                    <h3 className="text-lg font-black text-slate-900 group-hover:text-emerald-600 transition-colors">
                      {b.name}
                    </h3>
                  </div>

                  {/* Item Image Previews */}
                  <div className="flex items-center gap-2.5 py-2">
                    {previewItems.map((item, idx) => (
                      <div key={idx} className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center p-1.5 overflow-hidden shrink-0">
                        <img
                          src={item.imageUrl || 'https://placehold.co/100x100/f8fafc/94a3b8?text=Item'}
                          alt={item.name || 'Product'}
                          onError={e => { e.target.src = 'https://placehold.co/100x100/f8fafc/94a3b8?text=Item'; }}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    ))}

                    {overflowCount > 0 && (
                      <div className="w-14 h-14 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center text-xs font-black shrink-0 shadow-sm">
                        +{overflowCount}
                      </div>
                    )}
                  </div>

                  {/* Footer CTA */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-700 group-hover:text-emerald-600 transition-colors">
                      View Basket Details
                    </span>
                    <div className="w-8 h-8 rounded-full bg-slate-50 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors text-slate-600">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}