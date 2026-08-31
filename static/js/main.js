const API = 'http://127.0.0.1:5000';

// Global State
let allLoadedProducts = [];
let globalProductRegistry = {}; 
let basket = [];
let allSavedBaskets = [];
let currentInspectedSavedBasket = null;
let currentActiveProduct = null;

const categoryKeywords = {
    'Milk': ['milk', 'dairy', 'butter', 'cheese', 'yogurt', 'cream', 'lank', '2l', '1l'],
    'Juice': ['juice', 'fruit', 'drink', 'apple', 'orange', 'nectar', 'refresh', 'beverage'],
    'Pantry': ['rice', 'pasta', 'oil', 'flour', 'sugar', 'beans', 'soup', 'cereal', 'maize', 'mealie'],
    'Bakery': ['bread', 'bakery', 'toast', 'roll', 'bun', 'loaf', 'croissant'],
    'Snacks': ['snack', 'chips', 'chocolate', 'biscuits', 'sweets', 'treat', 'crisps', 'popcorn'],
    'Meat': ['meat', 'chicken', 'beef', 'steak', 'pork', 'wors', 'sausage', 'mince', 'chops']
};

// ==========================================
// 1. INITIALIZATION & ROUTER LOGIC
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadActiveBasketFromStorage();
    updateGlobalBasketCounter();

    if (document.getElementById('unified-bottom-grid')) {
        initLandingPage();
    } else if (document.getElementById('products-grid')) {
        initSearchPage();
    } else if (document.getElementById('detail-title')) {
        initProductDetailPage();
    } else if (document.getElementById('basket-page-items-list')) {
        updateBasketPageUI();
    } else if (document.getElementById('saved-baskets-list-container')) {
        renderSavedBasketsList();
    } else if (document.getElementById('detail-saved-breakdown')) {
        initSavedBasketDetailPage(); // Matches the ID in saved_basket_detail.html
    }
});

// ==========================================
// 2. THEME & GLOBAL UI MANAGERS
// ==========================================
function initTheme() {
    const savedTheme = localStorage.getItem('smartBasket_theme');
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        const toggle = document.getElementById('dark-mode-toggle');
        if (toggle) toggle.classList.add('bg-emerald-600');
    }
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('smartBasket_theme', isDark ? 'dark' : 'light');
    showToast(isDark ? 'Dark mode enabled' : 'Light mode enabled');
    
    if (document.getElementById('basket-page-breakdown-container')) {
        renderComparisonBreakdownAsync(basket, 'basket-page-breakdown-container', 'basket-hero-summary', true);
    } else if (document.getElementById('detail-saved-breakdown')) {
        renderComparisonBreakdownAsync(currentInspectedSavedBasket.items, 'detail-saved-breakdown', null, false);
    }
}

function showToast(message) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto bg-gray-900 dark:bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-3 toast-slide text-sm border border-gray-800 dark:border-emerald-500 w-full sm:w-auto max-w-sm ml-auto mt-2';
    toast.innerHTML = `
        <span class="flex h-2 w-2 relative shrink-0">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span class="font-bold">${message}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10%)';
        toast.style.transition = 'all 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
    }, 1500);
}

function toggleMobileSearch() {
    const overlay = document.getElementById('mobile-search-overlay');
    const input = overlay.querySelector('input');
    if (overlay.classList.contains('translate-x-full')) {
        overlay.classList.remove('translate-x-full', 'pointer-events-none');
        overlay.classList.add('translate-x-0', 'pointer-events-auto');
        setTimeout(() => input.focus(), 300);
    } else {
        overlay.classList.remove('translate-x-0', 'pointer-events-auto');
        overlay.classList.add('translate-x-full', 'pointer-events-none');
    }
}

function toggleMobileMenu() {
    const menuOverlay = document.getElementById('mobile-menu-overlay');
    const backdrop = document.getElementById('mobile-menu-backdrop');
    if (menuOverlay.classList.contains('translate-x-full')) {
        menuOverlay.classList.remove('translate-x-full');
        menuOverlay.classList.add('translate-x-0');
        if (backdrop) backdrop.classList.remove('hidden');
    } else {
        menuOverlay.classList.remove('translate-x-0');
        menuOverlay.classList.add('translate-x-full');
        if (backdrop) backdrop.classList.add('hidden');
    }
}

// ==========================================
// 3. CORE DATA & HELPER FUNCTIONS
// ==========================================
function registerProduct(p) {
    if (p && p.id) { globalProductRegistry[p.id] = p; }
}

function searchCategory(queryKey) {
    window.location.href = `/search?q=${encodeURIComponent(queryKey)}`;
}

function openProductPageById(productId) {
    const p = globalProductRegistry[productId];
    if (p) {
        sessionStorage.setItem('smartBasket_currentProduct', JSON.stringify(p));
        window.location.href = `/product/${productId}`;
    }
}

function getStoreBadge(store, size = 'normal') {
    const storeMap = {
        'Pick n Pay': { file: 'picknpay.png', alt: 'Pick n Pay', bg: 'bg-white', border: 'border-gray-200', text: 'text-blue-900' },
        'Shoprite': { file: 'shoprite.png', alt: 'Shoprite', bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-800' },
        'Checkers': { file: 'checkers.png', alt: 'Checkers', bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-800' },
        'Woolworths': { file: 'woolworths.png', alt: 'Woolworths', bg: 'bg-white dark:bg-gray-900', border: 'border-gray-900 dark:border-gray-100', text: 'text-gray-900 dark:text-white' }
    };
    const info = storeMap[store] || { file: 'default.png', alt: store, bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' };
    
    if (size === 'large') {
        return `
            <span class="inline-flex items-center gap-3 px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl ${info.bg} border-2 ${info.border} shadow-sm">
                <img src="/static/js/imgs/${info.file}" alt="${info.alt}" class="h-8 sm:h-12 w-auto max-w-[100px] sm:max-w-[140px] object-contain shrink-0" onerror="this.onerror=null; this.style.display='none';">
                <span class="text-sm sm:text-base font-black ${info.text}">${store}</span>
            </span>
        `;
    }
    return `
        <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl ${info.bg} border ${info.border} shadow-2xs">
            <img src="/static/js/imgs/${info.file}" alt="${info.alt}" class="h-5 sm:h-6 w-auto max-w-[70px] sm:max-w-[90px] object-contain shrink-0" onerror="this.onerror=null; this.style.display='none';">
            <span class="text-xs sm:text-sm font-black ${info.text}">${store}</span>
        </span>
    `;
}

function bentoCard(p, idx = -1) {
    registerProduct(p);
    const isBentoHero = (idx % 5 === 0) || (idx === 0);
    const bentoClasses = isBentoHero 
        ? 'sm:col-span-2 lg:col-span-2 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent border-2 border-emerald-500/40' 
        : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800';

    const isEquivalent = p.isExact === false || p.is_exact_match === false;
    const warningBadge = isEquivalent ? `
        <div class="mt-3 flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-[10px] sm:text-xs font-black px-2.5 py-1 rounded-lg w-fit shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            STORE EQUIVALENT
        </div>
    ` : '';

    return `
        <div onclick="openProductPageById('${p.id}')"
             class="${bentoClasses} rounded-[28px] p-5 sm:p-6 flex flex-col justify-between hover:-translate-y-1.5 hover:shadow-2xl transition-all duration-300 cursor-pointer relative group border">
            <div class="flex flex-col mb-4">
                <div class="flex items-center justify-between">
                    ${getStoreBadge(p.store, isBentoHero ? 'large' : 'normal')}
                </div>
                ${warningBadge}
            </div>
            <div class="flex flex-col sm:flex-row items-center gap-4 my-2">
                <div class="w-28 h-28 sm:w-32 sm:h-32 bg-gray-50/80 dark:bg-gray-800/80 rounded-2xl flex items-center justify-center p-3 shrink-0 overflow-hidden border border-gray-100 dark:border-gray-800">
                    <img src="${p.imageUrl || 'https://via.placeholder.com/200'}" alt="${p.name}" class="object-contain w-full h-full group-hover:scale-105 transition duration-500" onerror="this.onerror=null; this.src='https://via.placeholder.com/200';">
                </div>
                <div class="flex-grow min-w-0">
                    <h3 class="font-black text-gray-900 dark:text-white text-sm sm:text-base mb-2 leading-snug break-words whitespace-normal">${p.name}</h3>
                    <span class="text-xs text-gray-400 font-semibold uppercase tracking-wider">Store Offer</span>
                </div>
            </div>
            <div class="pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between mt-4">
                <div>
                    <span class="text-xs text-gray-400 block font-medium">Price</span>
                    <span class="text-lg sm:text-xl font-black text-gray-900 dark:text-emerald-400">${p.formattedPrice}</span>
                </div>
                <button onclick="quickAddToBasket(event, '${p.id}')" class="bg-brand-dark dark:bg-emerald-600 hover:bg-black text-white px-4 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer shadow-sm flex items-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                    <span class="hidden sm:inline">Add</span>
                </button>
            </div>
        </div>
    `;
}

// ==========================================
// 4. BASKET LOGIC (Local Storage)
// ==========================================
function loadActiveBasketFromStorage() {
    const stored = localStorage.getItem('smartBasket_active');
    if (stored) {
        try {
            basket = JSON.parse(stored);
            basket.forEach(registerProduct);
        } catch (e) { basket = []; }
    }
}

function saveActiveBasketToStorage() {
    localStorage.setItem('smartBasket_active', JSON.stringify(basket));
}

function updateGlobalBasketCounter() {
    saveActiveBasketToStorage();
    const totalItemsCount = basket.reduce((sum, item) => sum + (item.quantity || 1), 0);
    const counter = document.getElementById('basket-counter');
    if (counter) {
        counter.textContent = totalItemsCount;
        counter.classList.remove('animate-pulse');
        void counter.offsetWidth;
        counter.classList.add('animate-pulse');
    }
}

function quickAddToBasket(e, productId) {
    if (e) e.stopPropagation();
    const p = globalProductRegistry[productId];
    if (!p) return;
    
    const existing = basket.find(item => item.id === p.id);
    if (existing) {
        existing.quantity = (existing.quantity || 1) + 1;
    } else {
        basket.push({ ...p, quantity: 1, competitors: null });
    }
    
    updateGlobalBasketCounter();
    showToast(`Added ${p.name.substring(0, 20)}... to basket!`);
}

function updateQuantity(index, change) {
    if (!basket[index].quantity) basket[index].quantity = 1;
    basket[index].quantity += change;
    if (basket[index].quantity <= 0) {
        basket.splice(index, 1);
    }
    updateBasketPageUI();
}

function removeFromBasket(index) {
    basket.splice(index, 1);
    updateBasketPageUI();
}

function clearEntireBasket() {
    if (!confirm("Are you sure you want to clear your entire basket?")) return;
    basket = [];
    updateBasketPageUI();
    showToast("Basket cleared.");
}

// ==========================================
// 5. PAGE INITIALIZERS & RENDERERS
// ==========================================

async function initLandingPage() {
    const unifiedBottomGrid = document.getElementById('unified-bottom-grid');
    try {
        const res = await fetch(`${API}/api/categories`);
        const categoriesData = await res.json();
        allLoadedProducts = [];

        for (const [catName, products] of Object.entries(categoriesData)) {
            if (products && products.length) {
                allLoadedProducts.push(...products);
            }
        }

        if (allLoadedProducts.length > 0) {
            unifiedBottomGrid.innerHTML = allLoadedProducts.slice(0, 25).map((p, idx) => bentoCard(p, idx)).join('');
        } else {
            unifiedBottomGrid.innerHTML = `<p class="col-span-full text-center text-gray-400 font-medium py-8">No products available at the moment.</p>`;
        }
    } catch (err) {
        unifiedBottomGrid.innerHTML = `<p class="col-span-full text-center text-red-500 font-bold py-8 bg-red-50 rounded-2xl">Could not connect to backend.</p>`;
    }
}

async function initSearchPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    if (!query) return;

    const productsGrid = document.getElementById('products-grid');
    const loadingIndicator = document.getElementById('loading');
    const storeFilter = document.getElementById('store-filter');
    const sortOption = document.getElementById('sort-option');

    const fetchFilteredProducts = async () => {
        if (loadingIndicator) loadingIndicator.classList.remove('hidden');
        productsGrid.innerHTML = '';

        try {
            const storeQuery = storeFilter ? storeFilter.value : 'all';
            const sortQuery = sortOption ? sortOption.value : '';
            const res = await fetch(`${API}/api/search?q=${encodeURIComponent(query)}&store=${storeQuery}&sort=${sortQuery}`);
            let products = await res.json();
            
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
            products.forEach(p => registerProduct(p));
            productsGrid.innerHTML = products.length 
                ? products.map((p, idx) => bentoCard(p, idx)).join('') 
                : `<p class="col-span-full text-center text-gray-500 font-medium py-8 bg-gray-50 dark:bg-gray-900 rounded-2xl">No products found.</p>`;
        } catch (err) {
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
            productsGrid.innerHTML = `<p class="col-span-full text-center text-red-500 font-bold py-8 bg-red-50 rounded-2xl">Failed to connect to backend.</p>`;
        }
    };

    if (storeFilter) storeFilter.addEventListener('change', fetchFilteredProducts);
    if (sortOption) sortOption.addEventListener('change', fetchFilteredProducts);
    fetchFilteredProducts();
}

async function initProductDetailPage() {
    const pStr = sessionStorage.getItem('smartBasket_currentProduct');
    if (!pStr) { window.location.href = '/'; return; }
    
    const p = JSON.parse(pStr);
    currentActiveProduct = p;
    registerProduct(p);

    document.getElementById('detail-img').src = p.imageUrl || 'https://via.placeholder.com/300';
    document.getElementById('detail-title').textContent = p.name;
    document.getElementById('detail-price').textContent = p.formattedPrice;
    document.getElementById('detail-id').textContent = p.id;
    document.getElementById('detail-store').innerHTML = getStoreBadge(p.store, 'large');

    const detailComparisonLoading = document.getElementById('detail-comparison-loading');
    const detailComparisonGrid = document.getElementById('detail-comparison-grid');
    detailComparisonLoading.classList.remove('hidden');
    detailComparisonGrid.innerHTML = '';
    
    try {
        const cmpRes = await fetch(`${API}/api/compare?q=${encodeURIComponent(p.name)}`);
        const cmpData = await cmpRes.json();
        detailComparisonLoading.classList.add('hidden');

        if (cmpData.found && cmpData.products.length > 0) {
            detailComparisonGrid.innerHTML = cmpData.products.map((alt, idx) => {
                registerProduct(alt);
                const isCheapest = cmpData.cheapest && alt.id === cmpData.cheapest.id;
                const isBentoHero = (idx % 5 === 0) || isCheapest || (idx === 0);
                const bentoClasses = isBentoHero 
                    ? 'sm:col-span-2 lg:col-span-2 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent border-2 border-emerald-500/40' 
                    : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800';

                const isEquivalent = alt.isExact === false || alt.is_exact_match === false;
                const warningBadge = isEquivalent ? `
                    <div class="mt-3 flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-[10px] sm:text-xs font-black px-2.5 py-1 rounded-lg w-fit shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                        STORE EQUIVALENT
                    </div>
                ` : '';

                return `
                    <div onclick="openProductPageById('${alt.id}')" class="${bentoClasses} rounded-[28px] p-5 sm:p-6 flex flex-col justify-between hover:-translate-y-1.5 hover:shadow-2xl transition-all duration-300 cursor-pointer relative group border">
                        <div class="flex flex-col mb-4">
                            <div class="flex items-center justify-between">
                                ${getStoreBadge(alt.store, isBentoHero ? 'large' : 'normal')}
                                ${isCheapest ? '<span class="bg-emerald-500 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">Lowest Price 🏆</span>' : ''}
                            </div>
                            ${warningBadge}
                        </div>
                        <div class="flex flex-col sm:flex-row items-center gap-4 my-2">
                            <div class="w-28 h-28 sm:w-32 sm:h-32 bg-gray-50/80 dark:bg-gray-800/80 rounded-2xl flex items-center justify-center p-3 shrink-0 overflow-hidden border border-gray-100 dark:border-gray-800">
                                <img src="${alt.imageUrl || 'https://via.placeholder.com/200'}" alt="${alt.name}" class="object-contain w-full h-full group-hover:scale-105 transition duration-500">
                            </div>
                            <div class="flex-grow min-w-0">
                                <h3 class="font-black text-gray-900 dark:text-white text-sm sm:text-base mb-2 leading-snug break-words whitespace-normal">${alt.name}</h3>
                                <span class="text-xs text-gray-400 font-semibold uppercase tracking-wider">Store Offer</span>
                            </div>
                        </div>
                        <div class="pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between mt-4">
                            <div>
                                <span class="text-xs text-gray-400 block font-medium">Price</span>
                                <span class="text-lg sm:text-xl font-black text-gray-900 dark:text-emerald-400">${alt.formattedPrice}</span>
                            </div>
                            <button onclick="quickAddToBasket(event, '${alt.id}')" class="bg-brand-dark dark:bg-emerald-600 hover:bg-black text-white px-4 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer shadow-sm flex items-center space-x-2">
                                <span class="hidden sm:inline">Add</span>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            detailComparisonGrid.innerHTML = `<p class="col-span-full text-xs text-gray-400 py-4">No alternative store prices found for this item.</p>`;
        }
    } catch (e) {
        detailComparisonLoading.classList.add('hidden');
        detailComparisonGrid.innerHTML = `<p class="col-span-full text-xs text-red-400 py-4">Failed to fetch store comparison.</p>`;
    }
}

function updateBasketPageUI() {
    updateGlobalBasketCounter();
    const countEl = document.getElementById('basket-page-count');
    if (countEl) countEl.textContent = basket.reduce((sum, item) => sum + (item.quantity || 1), 0);

    const listEl = document.getElementById('basket-page-items-list');
    if (!listEl) return;
    
    if (basket.length === 0) {
        listEl.innerHTML = `<p class="text-sm font-medium text-gray-400 py-12 text-center">Your basket is currently empty.</p>`;
    } else {
        listEl.innerHTML = basket.map((item, idx) => {
            registerProduct(item);
            const qty = item.quantity || 1;
            const itemTotalPrice = (item.price * qty).toFixed(2);
            return `
                <div class="flex items-center justify-between py-4 first:pt-2 last:pb-2 gap-3 group">
                    <div class="flex items-center space-x-3 sm:space-x-4 min-w-0">
                        <div class="h-14 w-14 sm:h-16 sm:w-16 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-800 flex items-center justify-center p-2 shrink-0 overflow-hidden cursor-pointer" onclick="openProductPageById('${item.id}')">
                            <img src="${item.imageUrl || 'https://via.placeholder.com/60'}" class="object-contain h-full w-full">
                        </div>
                        <div class="min-w-0">
                            <div class="mb-1">${getStoreBadge(item.store)}</div>
                            <h4 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white break-words whitespace-normal hover:text-brand-dark cursor-pointer transition" onclick="openProductPageById('${item.id}')">${item.name}</h4>
                            <div class="flex items-center space-x-2.5 mt-2">
                                <button onclick="updateQuantity(${idx}, -1)" class="w-7 h-7 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-bold text-xs flex items-center justify-center transition cursor-pointer">-</button>
                                <span class="text-xs font-bold text-gray-700 dark:text-gray-300 w-6 text-center">${qty}</span>
                                <button onclick="updateQuantity(${idx}, 1)" class="w-7 h-7 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-bold text-xs flex items-center justify-center transition cursor-pointer">+</button>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center space-x-3 sm:space-x-4 shrink-0">
                        <span class="text-sm sm:text-base font-black text-gray-900 dark:text-emerald-400">R ${itemTotalPrice}</span>
                        <button onclick="removeFromBasket(${idx})" class="text-gray-400 hover:text-red-600 p-2 cursor-pointer font-black text-sm bg-gray-50 dark:bg-gray-800 rounded-xl transition" title="Remove item">✕</button>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    renderComparisonBreakdownAsync(basket, 'basket-page-breakdown-container', 'basket-hero-summary', true);
}


// ==========================================
// 5B. REAL-TIME STORE COMPARISON LOGIC
// ==========================================
async function renderComparisonBreakdownAsync(items, containerId, heroId, isActiveBasket) {
    const container = document.getElementById(containerId);
    const heroSummary = heroId ? document.getElementById(heroId) : null;
    
    if (heroSummary) heroSummary.classList.add('hidden');
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = `<p class="text-sm font-medium text-gray-400 text-center py-12">Add products to view total store cost comparison.</p>`;
        return;
    }

    if (isActiveBasket) {
        container.innerHTML = `<div class="flex flex-col justify-center items-center py-12"><span class="flex h-3 w-3 relative mb-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span></span><p class="text-sm font-medium text-gray-500 animate-pulse">Calculating real store totals...</p></div>`;
        let fetchedAny = false;
        for (let i = 0; i < items.length; i++) {
            let item = items[i];
            if (!item.competitors || item.competitors.length === 0) {
                fetchedAny = true;
                try {
                    const res = await fetch(`${API}/api/compare?q=${encodeURIComponent(item.name)}`);
                    const data = await res.json();
                    if (data.found && data.products) {
                        item.competitors = data.products.filter(p => p.id !== item.id && p.price > 0);
                    } else {
                        item.competitors = [];
                    }
                } catch (e) {
                    item.competitors = [];
                }
            }
        }
        if (fetchedAny) saveActiveBasketToStorage();
    }

    const storeNames = ['Pick n Pay', 'Shoprite', 'Checkers', 'Woolworths'];
    let storeData = storeNames.map(name => ({ name, total: 0, items: [] }));

    items.forEach(item => {
        const qty = item.quantity || 1;

        storeData.forEach(storeObj => {
            if (item.store === storeObj.name) {
                storeObj.items.push({
                    ...item, displayPrice: item.price, displaySubtotal: item.price * qty,
                    isExact: true, originalName: item.name, qty: qty
                });
                storeObj.total += (item.price * qty);
            } else {
                const equivalents = (item.competitors || []).filter(c => c.store === storeObj.name);
                if (equivalents.length > 0) {
                    
                    // TRUST THE BACKEND: The backend has already determined if this is an exact match or an equivalent,
                    // and it has already sorted the best option to the top. We just take index 0.
                    let bestEq = equivalents[0];
                    let exactMatchFound = bestEq.isExact === true || bestEq.is_exact_match === true;

                    registerProduct(bestEq);
                    storeObj.items.push({
                        ...bestEq, displayPrice: bestEq.price, displaySubtotal: bestEq.price * qty,
                        isExact: exactMatchFound, notFound: false, originalName: item.name, qty: qty
                    });
                    storeObj.total += (bestEq.price * qty);
                } else {
                    storeObj.items.push({
                        ...item, displayPrice: item.price, displaySubtotal: item.price * qty,
                        isExact: false, notFound: true, originalName: item.name, qty: qty
                    });
                    storeObj.total += (item.price * qty);
                }
            }
        });
    });

    storeData.sort((a, b) => a.total - b.total);

    if (storeData.length === 0) return;

    const bestStore = storeData[0];
    const maxStore = storeData[storeData.length - 1];
    const maxSavings = maxStore.total - bestStore.total;

    if (heroSummary && maxSavings > 0 && storeData.length > 1) {
        heroSummary.className = 'mb-6 sm:mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white rounded-3xl p-4 sm:p-6 shadow-sm flex items-center gap-4 transition-colors';
        heroSummary.innerHTML = `
            <div class="h-10 w-10 sm:h-12 sm:w-12 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-center text-xl sm:text-2xl shrink-0 text-emerald-600 dark:text-emerald-400">💡</div>
            <div>
                <span class="text-[10px] sm:text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Optimal Strategy</span>
                <h3 class="text-base sm:text-xl font-black leading-tight mt-1">Shop at ${bestStore.name} to save R ${maxSavings.toFixed(2)}</h3>
            </div>
        `;
        heroSummary.classList.remove('hidden');
    }

    container.innerHTML = storeData.map((s, index) => {
        const isWinner = index === 0;
        return `
            <div class="${isWinner ? 'border-2 border-brand-dark dark:border-emerald-500 bg-gray-50 dark:bg-gray-800/50' : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'} rounded-2xl p-4 sm:p-5 shadow-2xs transition-colors">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
                    <div class="flex items-center space-x-3">
                        ${getStoreBadge(s.name)}
                        ${isWinner ? '<span class="bg-brand-dark dark:bg-emerald-600 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm">🏆 #1 Cheapest</span>' : ''}
                    </div>
                    <span class="text-xl sm:text-2xl font-black ${isWinner ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}">R ${s.total.toFixed(2)}</span>
                </div>
                <details ${isWinner ? 'open' : ''} class="group pt-2 border-t border-gray-100 dark:border-gray-800">
                    <summary class="cursor-pointer text-[11px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 select-none flex justify-between hover:text-gray-800 transition">
                        <span>Items available at ${s.name} (${s.items.length})</span>
                        <span>▼</span>
                    </summary>
                    <div class="mt-3 space-y-2 divide-y divide-gray-50 dark:divide-gray-800">
                        ${s.items.map(i => {
                            let subtextHtml = '';
                            if (!i.isExact && !i.notFound) {
                                subtextHtml = `<div class="mt-1"><span class="inline-block text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800 tracking-tight leading-tight">Equivalent for: ${i.originalName}</span></div>`;
                            } else if (i.notFound) {
                                subtextHtml = `<div class="mt-1"><span class="inline-block text-[10px] font-bold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded-md border border-red-200 dark:border-red-800 tracking-tight leading-tight">Not found here. Using original price.</span></div>`;
                            }

                            return `
                                <div onclick="openProductPageById('${i.id}')" class="flex items-center justify-between pt-2 first:pt-0 gap-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 p-1.5 rounded-xl transition">
                                    <div class="flex items-center space-x-3 min-w-0">
                                        <div class="h-10 w-10 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center p-1 shrink-0 overflow-hidden ${i.notFound ? 'opacity-50 grayscale' : ''}">
                                            <img src="${i.imageUrl || ''}" class="object-contain h-full w-full">
                                        </div>
                                        <div class="min-w-0">
                                            <span class="break-words whitespace-normal block pr-2 text-xs font-medium ${i.notFound ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}">${i.name} (x${i.qty})</span>
                                            ${subtextHtml}
                                        </div>
                                    </div>
                                    <span class="font-bold shrink-0 text-gray-900 dark:text-gray-100 text-xs sm:text-sm">R ${i.displaySubtotal.toFixed(2)}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </details>
            </div>
        `;
    }).join('');
}


// ==========================================
// 6. SAVED BASKETS (Database & Historical Snapshot)
// ==========================================
function openSaveBasketModal() {
    if (basket.length === 0) {
        showToast('Your basket is empty. Add items before saving.');
        return;
    }
    const modal = document.getElementById('save-basket-modal');
    if (modal) {
        document.getElementById('saved-basket-name-input').value = `My Basket (${new Date().toLocaleDateString()})`;
        modal.classList.remove('hidden');
    }
}

function closeSaveBasketModal() { 
    const modal = document.getElementById('save-basket-modal');
    if (modal) modal.classList.add('hidden'); 
}

async function confirmSaveBasket() {
    const input = document.getElementById('saved-basket-name-input');
    const name = input ? input.value.trim() : '';
    if (!name) return showToast('Provide a name.');

    try {
        const res = await fetch(`${API}/api/db/save-basket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, items: basket })
        });
        if (res.ok) {
            closeSaveBasketModal();
            showToast('Saved to database with price snapshot successfully!');
        }
    } catch (e) { showToast('Database connection error.'); }
}

async function renderSavedBasketsList() {
    const container = document.getElementById('saved-baskets-list-container');
    if (!container) return;

    try {
        const res = await fetch(`${API}/api/db/saved-baskets`);
        allSavedBaskets = await res.json();

        if (!allSavedBaskets.length) {
            container.innerHTML = `<p class="col-span-full text-center text-gray-400 font-medium py-12">No saved baskets found in database.</p>`;
            return;
        }

        container.innerHTML = allSavedBaskets.map(sb => {
            const previewItems = sb.items.slice(0, 4);
            const overflow = sb.items.length - 4;
            const totalEst = sb.items.reduce((a, c) => a + (c.price * (c.quantity || 1)), 0);

            return `
                <div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition">
                    <div>
                        <div class="flex justify-between items-start mb-1">
                            <h3 class="font-black text-gray-900 dark:text-white text-base sm:text-lg break-words whitespace-normal pr-2 tracking-tight">${sb.name}</h3>
                            <button onclick="deleteSavedBasket(event, ${sb.id})" class="text-gray-300 hover:text-red-600 font-black text-sm cursor-pointer p-1 -mt-1 -mr-1 transition" title="Delete Saved Basket">✕</button>
                        </div>
                        <p class="text-[11px] sm:text-xs font-semibold text-gray-400 mb-3">Saved on ${sb.date} &bull; ${sb.items.length} item(s)</p>
                        <div class="flex items-center space-x-2 my-4">
                            ${previewItems.map(i => `<div class="h-10 w-10 sm:h-12 sm:w-12 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-1.5 shrink-0"><img src="${i.imageUrl || ''}" class="object-contain h-full w-full"></div>`).join('')}
                            ${overflow > 0 ? `<div class="h-10 w-10 sm:h-12 sm:w-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center text-xs font-black text-gray-500">+${overflow}</div>` : ''}
                        </div>
                    </div>
                    <div class="pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
                        <span class="text-sm font-black text-gray-900 dark:text-emerald-400">Snapshot Est. R ${totalEst.toFixed(2)}</span>
                        <a href="/saved/${sb.id}" class="bg-brand-dark dark:bg-emerald-600 hover:bg-black text-white font-bold text-[11px] sm:text-xs px-4 py-2 rounded-xl transition cursor-pointer shadow-sm text-center">View Details</a>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        container.innerHTML = `<p class="col-span-full text-center text-red-400 font-bold py-12">Failed to load from database.</p>`;
    }
}

function renderSavedBasketComparison(items, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = `<p class="text-sm font-medium text-gray-400 text-center py-12">No items in this saved basket.</p>`;
        return;
    }

    const storeNames = ['Pick n Pay', 'Shoprite', 'Checkers', 'Woolworths'];
    let storeData = storeNames.map(name => ({ name, total: 0, items: [] }));

    items.forEach(item => {
        const qty = item.quantity || 1;
        const basePrice = item.price; // The historical snapshot price

        storeData.forEach(storeObj => {
            if (item.store === storeObj.name) {
                // Original store item at snapshot price
                storeObj.items.push({
                    name: item.name,
                    store: item.store,
                    imageUrl: item.imageUrl,
                    displayPrice: basePrice,
                    displaySubtotal: basePrice * qty,
                    isExact: true,
                    notFound: false,
                    originalName: item.name,
                    qty: qty
                });
                storeObj.total += (basePrice * qty);
            } else {
                // Look inside the saved competitors snapshot array
                const comps = item.competitors || [];
                const match = comps.find(c => c.store === storeObj.name);

                if (match) {
                    const compPrice = match.price;
                    const isExact = match.isExact === true || match.is_exact_match === true;
                    storeObj.items.push({
                        name: match.name,
                        store: match.store,
                        imageUrl: match.imageUrl,
                        displayPrice: compPrice,
                        displaySubtotal: compPrice * qty,
                        isExact: isExact,
                        notFound: false,
                        originalName: item.name,
                        qty: qty
                    });
                    storeObj.total += (compPrice * qty);
                } else {
                    // Item was not captured in snapshot for this store
                    storeObj.items.push({
                        name: item.name,
                        store: storeObj.name,
                        imageUrl: item.imageUrl,
                        displayPrice: basePrice,
                        displaySubtotal: basePrice * qty,
                        isExact: false,
                        notFound: true,
                        originalName: item.name,
                        qty: qty
                    });
                    storeObj.total += (basePrice * qty);
                }
            }
        });
    });

    storeData.sort((a, b) => a.total - b.total);

    container.innerHTML = storeData.map((s, index) => {
        const isWinner = index === 0;
        return `
            <div class="${isWinner ? 'border-2 border-brand-dark dark:border-emerald-500 bg-gray-50 dark:bg-gray-800/50' : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'} rounded-2xl p-4 sm:p-5 shadow-2xs transition-colors">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
                    <div class="flex items-center space-x-3">
                        ${getStoreBadge(s.name)}
                        ${isWinner ? '<span class="bg-brand-dark dark:bg-emerald-600 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm">🏆 #1 Cheapest</span>' : ''}
                    </div>
                    <span class="text-xl sm:text-2xl font-black ${isWinner ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}">R ${s.total.toFixed(2)}</span>
                </div>
                <details ${isWinner ? 'open' : ''} class="group pt-2 border-t border-gray-100 dark:border-gray-800">
                    <summary class="cursor-pointer text-[11px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 select-none flex justify-between hover:text-gray-800 transition">
                        <span>Items available at ${s.name} (${s.items.length})</span>
                        <span>▼</span>
                    </summary>
                    <div class="mt-3 space-y-2 divide-y divide-gray-50 dark:divide-gray-800">
                        ${s.items.map(i => {
                            let subtextHtml = '';
                            if (!i.isExact && !i.notFound) {
                                subtextHtml = `<div class="mt-1"><span class="inline-block text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800 tracking-tight leading-tight">Equivalent for: ${i.originalName}</span></div>`;
                            } else if (i.notFound) {
                                subtextHtml = `<div class="mt-1"><span class="inline-block text-[10px] font-bold text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded-md tracking-tight leading-tight">Not in snapshot. Using base price.</span></div>`;
                            }

                            return `
                                <div class="flex items-center justify-between pt-2 first:pt-0 gap-3 p-1.5 rounded-xl transition">
                                    <div class="flex items-center space-x-3 min-w-0">
                                        <div class="h-10 w-10 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center p-1 shrink-0 overflow-hidden ${i.notFound ? 'opacity-50 grayscale' : ''}">
                                            <img src="${i.imageUrl || ''}" class="object-contain h-full w-full">
                                        </div>
                                        <div class="min-w-0">
                                            <span class="break-words whitespace-normal block pr-2 text-xs font-medium ${i.notFound ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}">${i.name} (x${i.qty})</span>
                                            ${subtextHtml}
                                        </div>
                                    </div>
                                    <span class="font-bold shrink-0 text-gray-900 dark:text-gray-100 text-xs sm:text-sm">R ${i.displaySubtotal.toFixed(2)}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </details>
            </div>
        `;
    }).join('');
}

async function initSavedBasketDetailPage() {
    const dataScript = document.getElementById('basket-data');
    const breakdownContainer = document.getElementById('detail-saved-breakdown');
    
    if (!breakdownContainer) return;

    if (!dataScript) {
        breakdownContainer.innerHTML = `<p class="text-xs text-red-500 p-4 text-center">Error: #basket-data script tag is missing.</p>`;
        return;
    }

    try {
        const basketData = JSON.parse(dataScript.textContent.trim());
        currentInspectedSavedBasket = basketData;
        
        if (!basketData.items || basketData.items.length === 0) {
            breakdownContainer.innerHTML = `<p class="text-xs text-gray-400 p-4 text-center">This saved basket contains no items.</p>`;
            return;
        }

        // Render instantly using the saved historical snapshot data (zero network requests)
        renderSavedBasketComparison(basketData.items, 'detail-saved-breakdown');
        
    } catch (e) {
        console.error("Failed to parse basket JSON data bridge:", e);
        breakdownContainer.innerHTML = `<p class="text-xs text-red-500 p-4 text-center">JSON Parse Error: ${e.message}</p>`;
    }
}

async function deleteSavedBasket(e, id) {
    if (e) e.stopPropagation();
    if (!confirm("Are you sure you want to delete this saved basket?")) return;
    try {
        await fetch(`${API}/api/db/saved-baskets/${id}`, { method: 'DELETE' });
        showToast('Deleted from database');
        renderSavedBasketsList();
    } catch (e) { showToast('Deletion failed'); }
}

function loadSavedBasketAsActive() {
    if (!currentInspectedSavedBasket) return;
    basket = currentInspectedSavedBasket.items.map(i => ({ ...i }));
    updateGlobalBasketCounter();
    showToast(`Loaded "${currentInspectedSavedBasket.name}" into active working basket!`);
    setTimeout(() => window.location.href = '/basket', 1500);
}

function goBackFromSavedBasketDetail() {
    window.location.href = '/saved';
}

function goBack() {
    window.history.back();
}