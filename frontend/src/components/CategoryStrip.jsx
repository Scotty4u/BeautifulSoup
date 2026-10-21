import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
// These four top-level categories are the ONLY tabs displayed sitewide.
// Keep legacy API categories searchable: Baby, Household, Pet Care, and similar
// products remain in Grocery rather than silently disappearing.
export const ALL_CATEGORIES = ['Grocery', 'Pharmacy', 'Liquor', 'Electronics'];
export const RESTRICTED_CATEGORIES = ['Liquor'];

export function canBrowseRestrictedCategories(user) {
  return Boolean(user && (user.is_admin || user.isAdmin || user.age_group === 'adult'));
}

// The labels stay visible for every visitor (as in the supplied mockup),
// but product visibility still gates restricted items in search and the API.
export function visibleCategories() {
  return ALL_CATEGORIES;
}

export function normalizeCatalogCategory(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if (['grocery', 'groceries', 'food', 'foods', 'baby', 'personal care',
    'household', 'pet care', 'other', 'general', 'home', 'beauty', 'toiletries',
    'cleaning', 'pantry', 'produce', 'dairy'].includes(value)) return 'Grocery';
  if (['pharmacy', 'medicine', 'health', 'healthcare'].includes(value)) return 'Pharmacy';
  if (['liquor', 'alcohol', 'tobacco', 'age restricted', 'age-restricted', 'adult', '18+'].includes(value)) return 'Liquor';
  if (['electronics', 'electronic', 'technology'].includes(value)) return 'Electronics';
  return null;
}

// Highlight the strongest existing classification for the user's search.
// This is ONLY a visual suggestion: the user must tap a category to filter.
export function inferSearchCategory(products, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle || ['all', 'deals'].includes(needle)) return null;
  const chosen = normalizeCatalogCategory(needle);
  if (chosen) return chosen;
  const counts = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const category = normalizeCatalogCategory(product?.catalogCategory ?? product?.catalog_category);
    if (category) counts.set(category, (counts.get(category) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return null;
  return ranked[0][0];
}


const SEARCH_MATCH_EVENT = 'smartbasket:search-category-detected';

export default function CategoryStrip() {
  const location = useLocation();
  const [detected, setDetected] = useState(null);
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isSearch = location.pathname === '/search';
  const isStore = /^\/store\/[^/]+\/?$/.test(location.pathname);
  const query = params.get('q') || params.get('query') || '';
  const explicitCategory = normalizeCatalogCategory(params.get('category'));
  const explicitlyAll = String(params.get('category') || '').toLowerCase() === 'all';
  const categories = visibleCategories();

  useEffect(() => {
    const onDetected = (event) => {
      const result = event?.detail;
      if (result && typeof result.query === 'string') {
        setDetected({ query: result.query, category: normalizeCatalogCategory(result.category) });
      }
    };
    window.addEventListener(SEARCH_MATCH_EVENT, onDetected);
    return () => window.removeEventListener(SEARCH_MATCH_EVENT, onDetected);
  }, []);


  // URL choice takes priority; otherwise highlight the category detected from results.
  // Auto-highlighting is visual only: it does NOT hide other search results.
  const filteredCategory = explicitCategory && categories.includes(explicitCategory) ? explicitCategory : null;
  const suggested = isSearch && !explicitCategory && !explicitlyAll && detected?.query === query
    && categories.includes(detected.category) ? detected.category : null;
  const selected = filteredCategory || suggested;

  const linkFor = (category) => {
    const onCatalogPage = isStore;
    const next = new URLSearchParams((isSearch || onCatalogPage) ? location.search : '');
    if (isSearch && !next.has('q') && !next.has('query')) next.set('q', 'all');
    if (!isSearch && !onCatalogPage) next.set('q', 'all');
    if (isSearch && !next.has('search_id') && location.key && location.key !== 'default') {
      next.set('search_id', location.key);
    }
    // On retailer pages, filter THAT retailer without redirecting to all-store search.
    if (category === filteredCategory) next.delete('category');
    else next.set('category', category.toLowerCase());
    const pathname = onCatalogPage ? location.pathname : '/search';
    return `${pathname}?${next.toString()}`;
  };

  return (
    <nav aria-label="Browse supermarket categories"
      className="relative z-40 w-full border-b border-[#d4e8d8] bg-[#e8f5eb]">
      <div className="mx-auto flex min-h-[53px] w-full max-w-7xl items-center justify-center gap-5 overflow-x-auto px-3 sm:gap-10 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categories.map((category) => {
          const active = category === selected;
          const suggestedOnly = active && !filteredCategory;
          return (
            <Link key={category} to={linkFor(category)}
              aria-current={active && !suggestedOnly ? 'page' : undefined}
              aria-label={suggestedOnly ? `${category}: suggested category; tap to filter` : `${category} category`}
              className={`inline-flex min-h-[48px] shrink-0 items-center justify-center border-b-2 px-0.5 text-[12px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 sm:text-sm ${
                active ? 'border-[#116d3d] text-[#115a38]' : 'border-transparent text-[#284b3a] hover:border-[#83b79a] hover:text-[#116d3d]'
              }`}
            >{category}</Link>
          );
        })}
      </div>
    </nav>
  );
}
