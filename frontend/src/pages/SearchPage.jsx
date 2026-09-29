import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import SkeletonCard from '../components/SkeletonCard';
import { useToast } from '../context/ToastContext';
import { addToCart } from '../utils/cart';
import { Button } from '@/components/ui/button';

import picknpayLogo from '../assets/imgs/picknpay.png';
import shopriteLogo from '../assets/imgs/shoprite.png';
import checkersLogo from '../assets/imgs/checkers.png';
import woolworthsLogo from '../assets/imgs/woolworths.png';

const STORE_INFO = {
  'Pick n Pay':  { logo: picknpayLogo,   bg: 'bg-white', text: 'text-red-500',    border: 'border-red-200' },
  'Shoprite':    { logo: shopriteLogo,   bg: 'bg-white', text: 'text-blue-500',   border: 'border-blue-200' },
  'Checkers':    { logo: checkersLogo,   bg: 'bg-white', text: 'text-amber-500',  border: 'border-amber-200' },
  'Woolworths':  { logo: woolworthsLogo, bg: 'bg-white', text: 'text-purple-500', border: 'border-purple-200' },
};

function StoreBadge({ store }) {
  const info = STORE_INFO[store] || { logo: '', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${info.bg} ${info.text} ${info.border}`}>
      {info.logo && (
        <img src={info.logo} alt={`${store} logo`} className="w-5 h-5 object-contain" />
      )}
      {store}
    </span>
  );
}

const ALL_CATEGORIES = ['Grocery', 'Liquor', 'Pharmacy', 'Electronics'];

function detectCategory(queryText, productList = []) {
  const q = (queryText || '').toLowerCase();

  const liquorKeywords = [
    'vodka', 'bear', 'whisky', 'whiskey', 'gin', 'beer', 'cider', 'wine', 
    'rum', 'brandy', 'tequila', 'liqueur', 'alcohol', 'savanna', 'heineken', 
    'smirnoff', 'amarula', 'jack daniels', 'black label', 'castle', 'flying fish'
  ];
  if (liquorKeywords.some(k => q.includes(k))) return 'Liquor';

  const pharmacyKeywords = [
    'panado', 'paracetamol', 'aspirin', 'flu', 'cough', 'vitamin', 'plaster', 
    'bandage', 'pharmacy', 'medicine', 'medication', 'tablets', 'capsule', 'soap'
  ];
  if (pharmacyKeywords.some(k => q.includes(k))) return 'Pharmacy';

  const electronicsKeywords = [
    'battery', 'batteries', 'kettle', 'iron', 'toaster', 'cable', 'charger', 
    'usb', 'plug', 'tv', 'phone', 'speaker', 'headphone', 'microwave'
  ];
  if (electronicsKeywords.some(k => q.includes(k))) return 'Electronics';

  for (const item of productList) {
    const raw = `${item.name || ''} ${item.category || ''} ${item.description || ''}`.toLowerCase();
    if (liquorKeywords.some(k => raw.includes(k))) return 'Liquor';
    if (pharmacyKeywords.some(k => raw.includes(k))) return 'Pharmacy';
    if (electronicsKeywords.some(k => raw.includes(k))) return 'Electronics';
  }

  return 'Grocery';
}

// Helper to generate a max of 5 visible pagination buttons
const getVisiblePages = (current, total) => {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - 2);
  let end = Math.min(total, current + 2);
  
  if (current <= 3) {
    end = 5;
  } else if (current >= total - 2) {
    start = total - 4;
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

export default function SearchPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || searchParams.get('query') || '';
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const resolveCategories = (q, state) => {
    if (state?.selectedCategories) return state.selectedCategories;
    if (q && q !== 'deals' && q !== 'all') {
      return [detectCategory(q)];
    }
    return ALL_CATEGORIES;
  };

  const [selectedCategories, setSelectedCategories] = useState(() =>
    resolveCategories(query, location.state)
  );

  useEffect(() => {
    setSelectedCategories(resolveCategories(query, location.state));
  }, [query, location.state]);

  const [selectedStores, setSelectedStores] = useState({
    Checkers: true,
    Shoprite: true,
    'Pick n Pay': true,
    Woolworths: true
  });
  const [maxPrice, setMaxPrice] = useState(1000);
  const [sortBy, setSortBy] = useState('relevance');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const { showToast } = useToast();

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

  const activeCategory = useMemo(() => {
    return detectCategory(query, results);
  }, [query, results]);

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
    <div className="min-h-full pb-16">
      <div className="bg-[#E7F3E8] border-b border-[#badbbd] px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar">
          {ALL_CATEGORIES.map((cat) => {
            const isSelected = selectedCategories.includes(cat);
            return (
              <div
                key={cat}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap select-none pointer-events-none ${
                  isSelected
                    ? 'bg-[#FF8C38] text-white shadow-sm ring-2 ring-[#FFF3EB]/20'
                    : 'bg-white/60 text-[#2E7D32]/60'
                }`}
              >
                {cat} {isSelected && '✓'}
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Results for "{query || 'All Items'}"
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Category: <strong className="text-[#2E7D32]">{activeCategory}</strong> • Found {totalItems} matching products across stores.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          
          <div className="bg-white p-5 rounded-2xl border border-[#E0E8E1] shadow-sm sticky top-24 flex flex-col gap-5 lg:col-span-1">
            <h3 className="text-base font-extrabold text-slate-800 border-b border-slate-100 pb-2">Filters</h3>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-slate-600">Sort By</label>
              <select 
                value={sortBy} 
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#E0E8E1] bg-[#F4F7F4] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#4EAA52] cursor-pointer"
              >
                <option value="relevance">Relevance</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2.5 text-slate-600">Retailers</label>
              <div className="flex flex-col gap-2">
                {Object.keys(selectedStores).map(store => (
                  <label key={store} className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={selectedStores[store]} 
                      onChange={() => handleStoreToggle(store)}
                      className="w-4 h-4 rounded text-[#2E7D32] accent-[#FF8C38] cursor-pointer"
                    />
                    {store}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[#FF8C38]">Max Price</label>
                <span className="text-xs font-extrabold text-[#FF8C38]">R {maxPrice}</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="1000" 
                step="10" 
                value={maxPrice} 
                onChange={(e) => { setMaxPrice(Number(e.target.value)); setCurrentPage(1); }}
                className="w-full accent-[#FF8C38] cursor-pointer"
              />
            </div>
          </div>

          <div className="lg:col-span-3">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : currentItems.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-2xl border border-[#E0E8E1]">
                <p className="text-slate-500 font-medium">No products match your selected filters.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                  {currentItems.map(product => (
                    <div 
                      key={product.id} 
                      className="bg-white rounded-2xl border border-[#E0E8E1] p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow relative"
                    >
                      <div>
                        <div 
                          className="h-44 flex items-center justify-center bg-[#F4F7F4] rounded-xl mb-3 p-3 cursor-pointer overflow-hidden relative group" 
                          onClick={() => navigate(`/product/${product.id}`, { state: { product } })}
                        >
                          <span className="absolute top-2 right-2 z-10 bg-[#FF8C38] text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                            Best Deal
                          </span>

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

                        <div className="mb-1.5">
                          <StoreBadge store={product.store} />
                        </div>

                        <h3 
                          onClick={() => navigate(`/product/${product.id}`, { state: { product } })} 
                          className="text-xs font-bold text-slate-800 line-clamp-2 cursor-pointer hover:text-[#FF8C38] transition-colors"
                        >
                          {product.name}
                        </h3>
                      </div>

                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#E0E8E1]">
                        <div>
                          <span className="text-base font-black text-slate-900 block leading-tight">
                            {product.formattedPrice || `R ${product.price.toFixed(2)}`}
                          </span>
                          <span className="text-[10px] text-slate-500">Includes VAT</span>
                        </div>

                        <Button 
                          onClick={() => { addToCart(product); showToast(`Added ${product.name} to basket!`); }}
                          size="sm"
                          className="bg-[#FF8C38] hover:bg-[#256629] text-white text-xs font-bold rounded-xl px-3.5 py-1.5 cursor-pointer shadow-sm"
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex flex-col items-center gap-4 mt-8">
                    <span className="text-xs font-bold text-slate-500">
                      Page {currentPage} of {totalPages}
                    </span>
                    <div className="flex justify-center items-center gap-2">
                      <Button 
                        variant="outline"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="rounded-xl font-bold cursor-pointer text-xs border-[#E0E8E1]"
                      >
                        Previous
                      </Button>

                      <div className="flex gap-1">
                        {getVisiblePages(currentPage, totalPages).map((pageNumber) => (
                          <button
                            key={pageNumber}
                            onClick={() => handlePageChange(pageNumber)}
                            className={`w-8 h-8 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
                              currentPage === pageNumber 
                                ? 'bg-[#FF8C38] text-white shadow-sm' 
                                : 'bg-white text-slate-600 border border-[#E0E8E1] hover:bg-[#E7F3E8]'
                            }`}
                          >
                            {pageNumber}
                          </button>
                        ))}
                      </div>

                      <Button 
                        variant="outline"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="rounded-xl font-bold cursor-pointer text-xs border-[#E0E8E1]"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}