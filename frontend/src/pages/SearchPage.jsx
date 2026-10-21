import { useState, useEffect, useMemo } from 'react';

import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';

import axios from 'axios';

import SkeletonCard from '../components/SkeletonCard';

import { useToast } from '../context/ToastContext';

import { addToCart } from '../utils/cart';

import { Button } from '@/components/ui/button';
import { useAuth } from '../context/AuthContext';
import { isVisibleProduct } from '../utils/ProductVisibility';
import { ALL_CATEGORIES, normalizeCatalogCategory, inferSearchCategory, canBrowseRestrictedCategories } from '../components/CategoryStrip';



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



const RESTRICTED_WORDS = /(?:^|\W)(?:18\+|alcohol|alcoholic|beer|lager|cider|wine|whisky|whiskey|vodka|gin|rum|brandy|tequila|liqueur|champagne|tobacco|cigarettes?|cigars?|vapes?|nicotine|savanna|heineken|smirnoff|klipdrift|jagermeister|strongbow)(?:$|\W)|\b(?:castle\s+(?:lite|lager|double\s+malt)|carling\s+black\s+label|flying\s+fish|hunters\s+(?:dry|gold|extreme)|windhoek\s+(?:lager|draught|light)|stella\s+artois|corona\s+extra)\b/i;
const EXEMPT_FOODS = /\b(?:wine\s+gums?|wine\s+vinegar|beer\s+battered|beer\s+bread|non.?alcoholic|alcohol.?free)\b/i;
function isRestrictedListing(item) {
  if (item?.ageRestricted === true || item?.age_restricted === true || item?.restricted === true) return true;
  if (Number(item?.minimumAge || item?.minAge || 0) >= 18) return true;
  if (/^(?:alcohol|liquor|tobacco|adult|18\+)$/i.test(String(item?.category || ''))) return true;
  const name = String(item?.name || '');
  return RESTRICTED_WORDS.test(EXEMPT_FOODS.test(name) ? name.replace(EXEMPT_FOODS, ' ') : name);
}

const INITIAL_SEARCH_ACTION = `initial_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;



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
  const isCategoryBrowse = !query || ['all', 'browse'].includes(query.toLowerCase());
  const actionId = searchParams.get('search_id') || (location.key && location.key !== 'default' ? location.key : INITIAL_SEARCH_ACTION);

  const [results, setResults] = useState([]);

  const [loading, setLoading] = useState(false);



  // The four text tabs below the navbar own this filter through the URL.
  // A detected category is highlighted, but only a user selection filters products.
  const categoryParam = searchParams.get('category');
  const selectedCategory = normalizeCatalogCategory(categoryParam);
  const selectedCategories = selectedCategory ? [selectedCategory] : ALL_CATEGORIES;

  const [selectedStores, setSelectedStores] = useState({

    Checkers: true,

    Shoprite: true,

    'Pick n Pay': true,

    Woolworths: true

  });



  const [maxPrice, setMaxPrice] = useState(Infinity);

  const [sortBy, setSortBy] = useState('relevance');

  const [locationFilter, setLocationFilter] = useState('Ibhayi, Eastern Cape');



  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => { setCurrentPage(1); }, [categoryParam]);

  const itemsPerPage = 21; //* Divisible by 3 columns so the last row fills completely*



  const { showToast } = useToast();
  const { user } = useAuth();
  const canViewRestricted = canBrowseRestrictedCategories(user);




  useEffect(() => {

    if (!query && !selectedCategory) {
      setResults([]);
      setLoading(false);
      window.dispatchEvent(new CustomEvent('smartbasket:search-category-detected', { detail: { query, category: null } }));
      return;
    }
    const controller = new AbortController();

    setLoading(true);

    setCurrentPage(1);



    axios.get('/api/search', {
      withCredentials: true,
      signal: controller.signal,
      params: {
        q: isCategoryBrowse ? 'all' : query,
        category: selectedCategory || undefined,
        loc: locationFilter,
        search_action_id: actionId,
      },
    })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const found = Array.isArray(data) ? data : [];
        setResults(found);
        const visible = canViewRestricted ? found : found.filter((item) => !isRestrictedListing(item));
        window.dispatchEvent(new CustomEvent('smartbasket:search-category-detected', {
          detail: { query, category: inferSearchCategory(visible, query) },
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted || axios.isCancel(error)) return;
        setResults([]);
        window.dispatchEvent(new CustomEvent('smartbasket:search-category-detected', {
          detail: { query, category: null },
        }));
        showToast('Failed to fetch search results.', 'error');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [query, locationFilter, actionId, canViewRestricted, selectedCategory, isCategoryBrowse]);



  const filteredResults = useMemo(() => {

    return results.filter(product => {
      if (!isVisibleProduct(product, user)) return false;
      if (!canViewRestricted && isRestrictedListing(product)) return false;

      const category = normalizeCatalogCategory(product.catalogCategory ?? product.catalog_category) || 'Grocery';
      if (!selectedCategories.includes(category)) return false;

      if (selectedStores[product.store] === false) return false;

      if (product.price > maxPrice) return false;

      return true;

    }).sort((a, b) => {

      if (sortBy === 'price-low') return a.price - b.price;

      if (sortBy === 'price-high') return b.price - a.price;

      return 0;

    });

  }, [results, selectedStores, selectedCategories, maxPrice, sortBy, canViewRestricted, user]);



  // Badges are decided by backend across every result, never just this page.
  const bestDealIds = useMemo(() => {
    const winners = new Set();
    const groups = new Set();
    for (const product of results) {
      if (product.isBestPrice !== true || product.bestPriceScope !== 'family_size') continue;
      if (!product.id || !product.bestPriceGroup || groups.has(product.bestPriceGroup)) continue;
      if (!canViewRestricted && isRestrictedListing(product)) continue;
      groups.add(product.bestPriceGroup);
      winners.add(String(product.id));
    }
    return winners;
  }, [results, canViewRestricted]);

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

      <div className="max-w-7xl min-w-0 mx-auto px-3 min-[430px]:px-4 py-5 sm:py-6">

        <div className="mb-6">

          <h1 className="break-words text-xl sm:text-2xl font-black text-slate-900 tracking-tight">

            {isCategoryBrowse ? (selectedCategory ? `Browse ${selectedCategory}` : "Browse all products") : `Results for ${query}`}

          </h1>

          <p className="text-slate-500 text-sm mt-0.5">

            Found {totalItems} matching products across stores.

          </p>

        </div>



        <div className="grid min-w-0 grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 items-start">



          <div className="min-w-0 bg-white p-4 sm:p-5 rounded-2xl border border-[#E0E8E1] shadow-sm lg:sticky lg:top-24 flex flex-col gap-5 lg:col-span-1 z-10">

            <h3 className="text-base font-extrabold text-slate-800 border-b border-slate-100 pb-2">Filters</h3>



            <div>

              <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-slate-600">Location</label>

              <select

                value={locationFilter}

                onChange={(e) => { setLocationFilter(e.target.value); setCurrentPage(1); }}

                className="w-full p-2.5 rounded-xl border border-[#E0E8E1] bg-[#F4F7F4] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#059669] cursor-pointer"

              >

                <option value="National">National (All)</option>

                <option value="Ibhayi, Eastern Cape">Ibhayi, Eastern Cape</option>

                <option value="Western Cape">Western Cape</option>

                <option value="Gauteng">Gauteng</option>

                <option value="KwaZulu-Natal">KwaZulu-Natal</option>

              </select>

            </div>



            <div>

              <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-slate-600">Sort By</label>

              <select

                value={sortBy}

                onChange={(e) => setSortBy(e.target.value)}

                className="w-full p-2.5 rounded-xl border border-[#E0E8E1] bg-[#F4F7F4] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#059669] cursor-pointer"

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

                      className="w-4 h-4 rounded text-[#2E7D32] accent-[#059669] cursor-pointer"

                    />

                    {store}

                  </label>

                ))}

              </div>

            </div>



            <div>
              <label htmlFor="search-price" className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-600">Maximum price</label>
              <select id="search-price" value={Number.isFinite(maxPrice) ? String(maxPrice) : 'any'}
                onChange={(event) => { setMaxPrice(event.target.value === 'any' ? Infinity : Number(event.target.value)); setCurrentPage(1); }}
                className="w-full rounded-xl border border-[#E0E8E1] bg-[#F4F7F4] p-2.5 text-xs font-medium text-slate-700">
                <option value="any">Any price</option>
                <option value="50">Under R50</option>
                <option value="100">Under R100</option>
                <option value="250">Under R250</option>
                <option value="500">Under R500</option>
                <option value="1000">Under R1,000</option>
                <option value="5000">Under R5,000</option>
                <option value="15000">Under R15,000</option>
              </select>
            </div>

          </div>



          <div className="min-w-0 lg:col-span-3">

            {loading ? (

              <div className="grid min-w-0 grid-cols-1 min-[430px]:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">

                {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}

              </div>

            ) : currentItems.length === 0 ? (

              <div className="bg-white p-12 text-center rounded-2xl border border-[#E0E8E1]">

                <p className="text-slate-500 font-medium">{selectedCategory === 'Liquor' && !canViewRestricted ? 'Age-restricted products require an adult account.' : 'No products match your selected filters. Try a different category, retailer or price limit.'}</p>

              </div>

            ) : (

              <>

                <div className="grid min-w-0 grid-cols-1 min-[430px]:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">

                  {currentItems.map(product => {
                    const isBestDeal = bestDealIds.has(String(product.id));



                    return (

                      <div

                        key={product.id}

                        className={`min-w-0 bg-white rounded-2xl border ${isBestDeal ? 'border-[#059669]' : 'border-[#E0E8E1]'} p-3 sm:p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow relative`}

                      >

                        <div>

                          <div

                            className="h-40 min-[430px]:h-36 sm:h-44 flex items-center justify-center bg-[#F4F7F4] rounded-xl mb-3 p-3 cursor-pointer overflow-hidden relative group"

                            onClick={() => navigate(`/product/${encodeURIComponent(product.id)}`, { state: { product } })}

                          >

                            {isBestDeal && (

                              <span className="absolute top-2 right-2 z-10 bg-[#059669] text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">

                                Best Deal

                              </span>

                            )}



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

                            onClick={() => navigate(`/product/${encodeURIComponent(product.id)}`, { state: { product } })}

                            className="min-w-0 text-sm font-bold text-slate-800 line-clamp-2 cursor-pointer hover:text-[#059669] transition-colors leading-snug break-words min-h-[2.5rem]"

                          >

                            {product.name}

                          </h3>

                        </div>



                        <div className="sb-safe-product-actions mt-3 flex min-w-0 flex-col items-stretch gap-3 border-t border-[#E0E8E1] pt-3 xl:flex-row xl:items-end xl:justify-between">

                          <div>

                            <span className="block min-w-0 break-words text-lg sm:text-base font-black text-slate-900 leading-tight">

                              {product.formattedPrice || (Number.isFinite(Number(product.price)) ? `R ${Number(product.price).toFixed(2)}` : 'Price unavailable')}

                            </span>

                            <span className="text-[10px] text-slate-500">Includes VAT</span>

                          </div>



                          <Button

                            onClick={() => { addToCart(product); showToast(`Added ${product.name} to basket!`); }}

                            size="sm"

                            className="min-h-11 w-full xl:w-auto min-w-20 shrink-0 justify-center whitespace-nowrap bg-[#059669] hover:bg-[#047857] text-white text-xs font-bold rounded-xl px-4 py-2 cursor-pointer shadow-sm"

                          >

                            Add

                          </Button>

                        </div>

                      </div>

                    );

                  })}

                </div>



                {totalPages > 1 && (

                  <div className="flex flex-col items-center gap-4 mt-8">

                    <span className="text-xs font-bold text-slate-500">

                      Page {currentPage} of {totalPages}

                    </span>

                    <div className="flex w-full flex-wrap justify-center items-center gap-2">

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

                                ? 'bg-[#059669] text-white shadow-sm'

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
