import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import SkeletonCard from '../components/SkeletonCard';
import { useToast } from '../context/ToastContext';
import { addToCart } from '../utils/cart';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- FILTER & SORT STATES ---
  const [selectedStores, setSelectedStores] = useState({
    Checkers: true,
    Shoprite: true,
    'Pick n Pay': true,
    Woolworths: true
  });
  const [maxPrice, setMaxPrice] = useState(1000);
  const [sortBy, setSortBy] = useState('relevance');

  // --- PAGINATION STATES ---
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;

  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!query) return;
    setLoading(true);
    setCurrentPage(1);
    
    axios.get(`/api/search?q=${encodeURIComponent(query)}`, { withCredentials: true })
      .then(res => {
        setResults(res.data || []);
        setLoading(false);
      })
      .catch(() => {
        setResults([]);
        setLoading(false);
        showToast("Failed to fetch search results.", "error");
      });
  }, [query]);

  // --- OPTIMIZED FILTERING & SORTING WITH USEMEMO ---
  const filteredResults = useMemo(() => {
    return results.filter(product => {
      if (selectedStores[product.store] === false) return false;
      if (product.price > maxPrice) return false;
      return true;
    }).sort((a, b) => {
      if (sortBy === 'price-low') return a.price - b.price;
      if (sortBy === 'price-high') return b.price - a.price;
      return 0;
    });
  }, [results, selectedStores, maxPrice, sortBy]);

  const totalItems = filteredResults.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  
  // --- MEMOIZED PAGINATION SLICE ---
  const currentItems = useMemo(() => {
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    return filteredResults.slice(indexOfFirstItem, indexOfLastItem);
  }, [filteredResults, currentPage, itemsPerPage]);

  const handleStoreToggle = (store) => {
    setSelectedStores(prev => ({ ...prev, [store]: !prev[store] }));
    setCurrentPage(1);
  };

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Results for "{query}"</h1>
        <p className="text-slate-500 mt-1">Found {totalItems} matching products based on your filters.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        
        {/* --- LEFT: FILTERS SIDEBAR --- */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm sticky top-24 flex flex-col gap-6 lg:col-span-1">
          <h3 className="text-lg font-extrabold text-slate-800 border-b border-slate-100 pb-3">Filters</h3>

          {/* Sort By */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-slate-600">Sort By</label>
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="relevance">Relevance</option>
              <option value="price-low">Price: Low to High</option>
              <option value="price-high">Price: High to Low</option>
            </select>
          </div>

          {/* Store Filter */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-3 text-slate-600">Retailers</label>
            <div className="flex flex-col gap-2.5">
              {Object.keys(selectedStores).map(store => (
                <label key={store} className="flex items-center gap-3 text-sm font-medium text-slate-700 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={selectedStores[store]} 
                    onChange={() => handleStoreToggle(store)}
                    className="w-4 h-4 rounded text-emerald-600 accent-emerald-600 cursor-pointer"
                  />
                  {store}
                </label>
              ))}
            </div>
          </div>

          {/* Max Price Filter */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600">Max Price</label>
              <span className="text-sm font-extrabold text-emerald-600">R {maxPrice}</span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="1000" 
              step="10"
              value={maxPrice} 
              onChange={(e) => { setMaxPrice(Number(e.target.value)); setCurrentPage(1); }}
              className="w-full accent-emerald-600 cursor-pointer"
            />
          </div>

        </div>

        {/* --- RIGHT: RESULTS GRID & PAGINATION --- */}
        <div className="lg:col-span-3">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : currentItems.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200">
              <p className="text-slate-500 font-medium">No products match your selected filters.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {currentItems.map(product => (
                  <div key={product.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                    <div>
                      <div 
                        className="h-40 flex items-center justify-center bg-slate-50 rounded-xl mb-4 p-2 cursor-pointer overflow-hidden relative group" 
                        onClick={() => navigate(`/product/${product.id}`, { state: { product } })}
                      >
                        {/* LAZY LOADING & ASYNC DECODING FOR UI SPEED */}
                        <img 
                          src={product.imageUrl} 
                          alt={product.name} 
                          loading="lazy"
                          decoding="async"
                          className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                        <div className="absolute inset-0 bg-slate-100 items-center justify-center text-xs font-bold text-slate-400 hidden">
                          Image Unavailable
                        </div>
                      </div>
                      
                      <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md mb-2">
                        {product.store}
                      </span>
                      <h3 
                        onClick={() => navigate(`/product/${product.id}`, { state: { product } })} 
                        className="text-sm font-bold text-slate-800 line-clamp-2 cursor-pointer hover:text-emerald-600 transition-colors"
                      >
                        {product.name}
                      </h3>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                      <span className="text-base font-black text-slate-900">{product.formattedPrice || `R ${product.price.toFixed(2)}`}</span>
                      <Button 
                        onClick={() => { addToCart(product); showToast(`Added ${product.name} to basket!`); }}
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-4 cursor-pointer"
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* PAGINATION */}
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-10">
                  <Button 
                    variant="outline"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="rounded-xl font-bold cursor-pointer"
                  >
                    Previous
                  </Button>

                  <div className="flex gap-1">
                    {[...Array(totalPages)].map((_, i) => (
                      <button
                        key={i + 1}
                        onClick={() => handlePageChange(i + 1)}
                        className={`w-10 h-10 rounded-xl font-bold text-sm transition-colors cursor-pointer ${
                          currentPage === i + 1 
                            ? 'bg-emerald-600 text-white shadow-sm' 
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>

                  <Button 
                    variant="outline"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="rounded-xl font-bold cursor-pointer"
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}