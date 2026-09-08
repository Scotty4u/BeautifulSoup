const API = 'http://127.0.0.1:5000';

// Global State
let allLoadedProducts = [];
let globalProductRegistry = {}; 
let basket = [];
let allSavedBaskets = [];
let currentInspectedSavedBasket = null;
let currentActiveProduct = null;
let isCartInitialized = false;
let isUserAuthenticated = false;
let showClearConfirmation = false;
let currentStoreData = []; // Stores processed cart data for side-by-side view

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
    updateNotificationBadge();
    initLogoutInterceptor();
    checkUserNotifications();

    if (document.getElementById('unified-bottom-grid')) {
        initLandingPage();
    } else if (document.getElementById('products-grid')) {
        initSearchPage();
    } else if (document.getElementById('detail-title')) {
        initProductDetailPage();
    } else if (document.getElementById('basket-page-items-list')) {
        updateBasketPageUI();
    } else if (document.getElementById('saved-baskets-list-container') || document.getElementById('collab-baskets-list-container')) {
        renderSavedBasketsList();
    } else if (document.getElementById('detail-saved-breakdown')) {
        initSavedBasketDetailPage();
    } else if (window.location.pathname.includes('/notifications') || document.getElementById('notifications-list-container') || document.getElementById('notifications-container') || document.getElementById('notifications-list')) {
        initNotificationsPage();
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

function switchBasketTab(tabName) {
    const btnTotals = document.getElementById('tab-btn-totals');
    const btnSbs = document.getElementById('tab-btn-sbs');
    const contentTotals = document.getElementById('tab-content-totals');
    const contentSbs = document.getElementById('tab-content-sbs');

    if (!btnTotals || !btnSbs || !contentTotals || !contentSbs) return;

    if (tabName === 'totals') {
        btnTotals.className = "px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer bg-brand-dark dark:bg-emerald-600 text-white shadow-sm";
        btnSbs.className = "px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
        contentTotals.classList.remove('hidden');
        contentSbs.classList.add('hidden');
    } else {
        btnSbs.className = "px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer bg-brand-dark dark:bg-emerald-600 text-white shadow-sm";
        btnTotals.className = "px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
        contentSbs.classList.remove('hidden');
        contentTotals.classList.add('hidden');
        setTimeout(executeSideBySide, 0);
    }
}

async function updateNotificationBadge() {
    try {
        const res = await fetch(`${API}/api/notifications/count`);
        if (!res.ok) return;
        const data = await res.json();
        
        const badges = document.querySelectorAll('.notification-badge');
        badges.forEach(badge => {
            if (data.count > 0) {
                badge.textContent = data.count > 99 ? '99+' : data.count;
                badge.classList.remove('hidden');
                badge.classList.add('flex');
            } else {
                badge.classList.add('hidden');
                badge.classList.remove('flex');
            }
        });
    } catch (e) {
        console.error('Badge update failed', e);
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
// 4. BASKET LOGIC & HYBRID STORAGE SYNC
// ==========================================
async function loadActiveBasketFromStorage() {
    try {
        const res = await fetch(`${API}/api/db/active-cart`);
        if (res.ok) {
            const data = await res.json();
            isUserAuthenticated = data.authenticated !== false;
            
            if (isUserAuthenticated) {
                basket = data.items || [];
            } else {
                const localCart = localStorage.getItem('smartBasket_guest_active');
                basket = localCart ? JSON.parse(localCart) : [];
            }
            basket.forEach(registerProduct);
        }
    } catch (e) {
        const localCart = localStorage.getItem('smartBasket_guest_active');
        basket = localCart ? JSON.parse(localCart) : [];
        basket.forEach(registerProduct);
    }
    isCartInitialized = true;
    updateGlobalBasketCounter();
    
    if (document.getElementById('basket-page-items-list')) {
        updateBasketPageUI();
    }
}

function saveActiveBasketToStorage() {
    if (!isCartInitialized) return; 
    
    if (isUserAuthenticated) {
        fetch(`${API}/api/db/active-cart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: basket })
        }).catch(err => console.error('Failed to sync active cart', err));
    } else {
        localStorage.setItem('smartBasket_guest_active', JSON.stringify(basket));
    }
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
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    const p = globalProductRegistry[productId] || currentActiveProduct;
    if (!p) {
        showToast('Product information not found.');
        return;
    }
    
    const existing = basket.find(item => item.id === p.id);
    if (existing) {
        existing.quantity = (existing.quantity || 1) + 1;
    } else {
        basket.push({ ...p, quantity: 1, competitors: null });
    }
    
    updateGlobalBasketCounter();
    showToast(`Added ${p.name.substring(0, 20)}... to basket!`);
}

function addToBasketDetail() {
    if (!currentActiveProduct) {
        showToast('Product information not found.');
        return;
    }
    registerProduct(currentActiveProduct);
    quickAddToBasket(null, currentActiveProduct.id);
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
    if (basket.length === 0) return;
    showClearConfirmation = true;
    updateBasketPageUI();
}

function cancelClearBasket() {
    showClearConfirmation = false;
    updateBasketPageUI();
}

function confirmClearBasket() {
    basket = [];
    if (!isUserAuthenticated) {
        localStorage.removeItem('smartBasket_guest_active');
    }
    showClearConfirmation = false;
    updateBasketPageUI();
    showToast("Basket cleared successfully.");
}

function initLogoutInterceptor() {
    document.addEventListener('click', async (e) => {
        const logoutLink = e.target.closest('a[href="/logout"]');
        if (logoutLink) {
            e.preventDefault();
            if (basket && basket.length > 0) {
                try {
                    await fetch(`${API}/api/db/save-basket`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: `Auto-saved Cart (${new Date().toLocaleDateString()})`,
                            items: basket
                        })
                    });
                } catch (err) {}
            }
            try {
                await fetch(`${API}/api/db/active-cart`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: [] })
                });
            } catch (err) {}
            
            window.location.href = '/logout';
        }
    });
}

// ==========================================
// 5. PAGE INITIALIZERS & RENDERERS
// ==========================================
async function initLandingPage() {
    const unifiedBottomGrid = document.getElementById('unified-bottom-grid');
    if (!unifiedBottomGrid) return;

    try {
        const res = await fetch('/api/popular');
        const products = await res.json();

        if (products && products.length > 0) {
            products.forEach(registerProduct);
            unifiedBottomGrid.innerHTML = products.slice(0, 40).map((p, idx) => bentoCard(p, idx)).join('');
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
    
    fetchProductReviews(p.id);

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
    const saveListBtn = document.getElementById('header-save-list-btn');

    const totalItems = basket.reduce((sum, item) => sum + (item.quantity || 1), 0);
    if (countEl) countEl.textContent = totalItems;

    // Toggle header save button visibility based on whether items exist
    if (saveListBtn) {
        if (totalItems > 0) {
            saveListBtn.classList.remove('hidden');
            saveListBtn.classList.add('flex');
        } else {
            saveListBtn.classList.add('hidden');
            saveListBtn.classList.remove('flex');
        }
    }

    const headerActionEl = document.querySelector('#basket-page-items-list').previousElementSibling;
    if (headerActionEl) {
        if (showClearConfirmation) {
            headerActionEl.innerHTML = `
                <div class="flex items-center justify-between w-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-2xl p-3 animate-pulse">
                    <span class="text-xs font-bold text-red-600 dark:text-red-400">Clear entire list?</span>
                    <div class="flex items-center space-x-2">
                        <button onclick="cancelClearBasket()" class="px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-bold text-xs rounded-xl border border-gray-200 dark:border-gray-800 transition cursor-pointer">Cancel</button>
                        <button onclick="confirmClearBasket()" class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl transition shadow-sm cursor-pointer">Yes, Clear</button>
                    </div>
                </div>
            `;
        } else {
            headerActionEl.innerHTML = `
                <div class="flex items-center space-x-3">
                    <h2 class="text-lg sm:text-xl font-black text-gray-900 dark:text-white">Items List</h2>
                    <span class="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold px-3 py-1 rounded-full"><span id="basket-page-count">${totalItems}</span> Items</span>
                </div>
                <button onclick="clearEntireBasket()" class="p-2 bg-gray-50 dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-950/50 text-gray-400 hover:text-red-600 rounded-xl transition cursor-pointer" title="Delete Whole List">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            `;
        }
    }

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
        const sbsContainer = document.getElementById('basket-page-sbs-container');
        if (sbsContainer) sbsContainer.innerHTML = `<div class="p-8 text-center text-gray-400 text-xs font-medium">Add items to basket to enable comparison.</div>`;
        return;
    }

    if (isActiveBasket) {
        const skeletonCards = Array(4).fill(0).map((_, i) => `
            <div class="border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-5 shadow-2xs relative overflow-hidden">
                <div class="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 dark:via-white/5 to-transparent"></div>
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
                    <div class="flex items-center space-x-3">
                        <div class="h-8 sm:h-9 w-24 sm:w-28 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse"></div>
                    </div>
                    <div class="h-7 sm:h-8 w-20 sm:w-24 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse"></div>
                </div>
                <div class="pt-2 border-t border-gray-50 dark:border-gray-800/50 mt-2">
                    <div class="h-3 sm:h-4 w-32 sm:w-40 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
                </div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="flex items-center justify-between mb-4 px-2">
                <div class="flex items-center space-x-2">
                    <span class="flex h-2.5 w-2.5 relative">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-dark dark:bg-emerald-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-dark dark:bg-emerald-500"></span>
                    </span>
                    <span class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Live Matching...</span>
                </div>
            </div>
            <div class="space-y-4">
                ${skeletonCards}
            </div>
        `;
        
        let itemsToFetch = items.filter(item => !item.competitors || item.competitors.length === 0);
        
        if (itemsToFetch.length > 0) {
            let queries = itemsToFetch.map(item => item.name);
            
            try {
                const res = await fetch(`${API}/api/batch-compare`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ queries: queries })
                });
                
                if (res.ok) {
                    const batchData = await res.json();
                    
                    itemsToFetch.forEach(item => {
                        const matchingProducts = batchData[item.name] || [];
                        item.competitors = matchingProducts.filter(p => p.id !== item.id && p.price > 0);
                    });
                    
                    saveActiveBasketToStorage();
                }
            } catch (e) {
                console.error("Batch compare failed", e);
                itemsToFetch.forEach(item => item.competitors = []);
            }
        }
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
    currentStoreData = storeData;

    if (storeData.length === 0) return;

    const bestStore = storeData[0];
    const maxStore = storeData[storeData.length - 1];
    const maxSavings = maxStore.total - bestStore.total;

    if (heroSummary && maxSavings > 0 && storeData.length > 1) {
        const collabId = localStorage.getItem('activeCollaborativeBasketId');
        const collabName = localStorage.getItem('activeCollaborativeBasketName');
        
        let actionHtml = '';
        if (collabId && collabName) {
            actionHtml = `
                <div class="flex items-center gap-3 shrink-0 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-800 justify-between sm:justify-end">
                    <div class="text-left sm:text-right">
                        <span class="inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 bg-emerald-600 text-white rounded-md mb-0.5">Collaborative Active</span>
                        <p class="text-xs font-bold text-gray-900 dark:text-white truncate max-w-[180px]" title="${collabName}">"${collabName}"</p>
                    </div>
                    <button onclick="saveActiveCartChanges()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-4 py-2.5 rounded-xl transition shadow-sm cursor-pointer shrink-0">
                        Save Changes
                    </button>
                </div>
            `;
        } else {
            actionHtml = `
                <div class="flex items-center gap-3 shrink-0 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-800 justify-end">
                    <button onclick="openSaveBasketModal()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-4 py-2.5 rounded-xl transition shadow-sm cursor-pointer shrink-0 flex items-center space-x-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                        </svg>
                        <span>Save List</span>
                    </button>
                </div>
            `;
        }

        heroSummary.className = 'mb-6 sm:mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white rounded-3xl p-4 sm:p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors';
        heroSummary.innerHTML = `
            <div class="flex items-center gap-4 min-w-0">
                <div class="h-10 w-10 sm:h-12 sm:w-12 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-center text-xl sm:text-2xl shrink-0 text-emerald-600 dark:text-emerald-400">💡</div>
                <div class="min-w-0">
                    <span class="text-[10px] sm:text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Optimal Strategy</span>
                    <h3 class="text-base sm:text-xl font-black leading-tight mt-1">Shop at ${bestStore.name} to save R ${maxSavings.toFixed(2)}</h3>
                </div>
            </div>
            ${actionHtml}
        `;
        heroSummary.classList.remove('hidden');
    }

    const mainListHtml = storeData.map((s, index) => {
        const isWinner = index === 0;
        return `
            <div class="${isWinner ? 'border-2 border-brand-dark dark:border-emerald-500 bg-gray-50 dark:bg-gray-800/50' : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'} rounded-2xl p-4 sm:p-5 shadow-2xs transition-colors mb-4">
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

    container.innerHTML = mainListHtml;
    
    const sbsContainer = document.getElementById('basket-page-sbs-container');
    if (sbsContainer) {
        sbsContainer.innerHTML = getSideBySideUIHtml(storeData);
        setTimeout(executeSideBySide, 0);
    }
}

function getSideBySideUIHtml(storeData) {
    if (storeData.length < 2) return '<div class="p-8 text-center text-gray-400 text-xs font-medium">At least two stores with pricing are required for side-by-side comparison.</div>';
    const storeOptions = storeData.map(s => `<option value="${s.name}">${s.name} (R ${s.total.toFixed(2)})</option>`).join('');

    return `
        <div class="animate-slideUp">
            <div class="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-6">
                <select id="sbs-store-a" onchange="executeSideBySide()" class="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 dark:text-white outline-none cursor-pointer focus:ring-2 focus:ring-brand-dark dark:focus:ring-emerald-500 shadow-sm transition-all">
                    ${storeOptions}
                </select>
                <div class="hidden sm:flex items-center justify-center text-gray-400 font-black text-sm px-2">VS</div>
                <select id="sbs-store-b" onchange="executeSideBySide()" class="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 dark:text-white outline-none cursor-pointer focus:ring-2 focus:ring-brand-dark dark:focus:ring-emerald-500 shadow-sm transition-all">
                    ${storeOptions}
                </select>
            </div>
            <div id="sbs-results-container" class="w-full overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <!-- Table injected here by executeSideBySide() -->
            </div>
        </div>
    `;
}

function executeSideBySide() {
    const selectA = document.getElementById('sbs-store-a');
    const selectB = document.getElementById('sbs-store-b');
    const container = document.getElementById('sbs-results-container');

    if (!container || !currentStoreData || !selectA || !selectB) return;
    
    if (selectA.selectedIndex === selectB.selectedIndex && selectB.options.length > 1) {
        selectB.selectedIndex = selectA.selectedIndex === 0 ? 1 : 0;
    }

    const valA = selectA.value;
    const valB = selectB.value;

    const storeA = currentStoreData.find(s => s.name === valA);
    const storeB = currentStoreData.find(s => s.name === valB);

    if (!storeA || !storeB) return;

    if (valA === valB) {
        container.innerHTML = `<div class="p-8 text-center text-gray-500 dark:text-gray-400 text-sm font-medium bg-gray-50 dark:bg-gray-900">Please select two different stores to compare.</div>`;
        return;
    }

    let rowsHtml = '';
    for (let i = 0; i < storeA.items.length; i++) {
        const itemA = storeA.items[i];
        const itemB = storeB.items[i];

        const isACheaper = itemA.displaySubtotal < itemB.displaySubtotal;
        const isBCheaper = itemB.displaySubtotal < itemA.displaySubtotal;

        rowsHtml += `
            <tr class="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
                <td class="p-3 sm:p-4 min-w-[130px] align-middle">
                    <span class="text-xs font-bold text-gray-900 dark:text-white block leading-snug">${itemA.originalName}</span>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 font-semibold mt-1 block uppercase tracking-wider">Qty: ${itemA.qty}</span>
                </td>
                <td class="p-3 sm:p-4 text-center border-l border-gray-100 dark:border-gray-800 align-middle">
                    <span class="block text-sm sm:text-base font-black ${isACheaper ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300'}">R ${itemA.displaySubtotal.toFixed(2)}</span>
                    ${itemA.notFound ? `<span class="text-[9px] font-bold text-red-500 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded mt-1 inline-block">N/A</span>` : (itemA.isExact ? '' : `<span class="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded mt-1 inline-block">Equivalent</span>`)}
                </td>
                <td class="p-3 sm:p-4 text-center border-l border-gray-100 dark:border-gray-800 align-middle">
                    <span class="block text-sm sm:text-base font-black ${isBCheaper ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300'}">R ${itemB.displaySubtotal.toFixed(2)}</span>
                    ${itemB.notFound ? `<span class="text-[9px] font-bold text-red-500 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded mt-1 inline-block">N/A</span>` : (itemB.isExact ? '' : `<span class="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded mt-1 inline-block">Equivalent</span>`)}
                </td>
            </tr>
        `;
    }

    container.innerHTML = `
        <div class="overflow-x-auto w-full">
            <table class="w-full text-left border-collapse min-w-[320px]">
                <thead>
                    <tr class="bg-gray-100 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
                        <th class="p-3 sm:p-4 text-[10px] sm:text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest w-2/5">Product</th>
                        <th class="p-3 sm:p-4 text-[10px] sm:text-xs font-black text-gray-900 dark:text-white uppercase tracking-widest text-center w-[30%] border-l border-gray-200 dark:border-gray-700">${storeA.name}</th>
                        <th class="p-3 sm:p-4 text-[10px] sm:text-xs font-black text-gray-900 dark:text-white uppercase tracking-widest text-center w-[30%] border-l border-gray-200 dark:border-gray-700">${storeB.name}</th>
                    </tr>
                </thead>
                <tbody class="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                    ${rowsHtml}
                    <tr class="bg-gray-50 dark:bg-gray-800/80">
                        <td class="p-3 sm:p-4 text-xs sm:text-sm font-black text-gray-900 dark:text-white text-right uppercase tracking-widest">TOTAL</td>
                        <td class="p-3 sm:p-4 text-center border-l border-gray-200 dark:border-gray-700">
                            <span class="text-base sm:text-lg font-black ${storeA.total < storeB.total ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}">R ${storeA.total.toFixed(2)}</span>
                        </td>
                        <td class="p-3 sm:p-4 text-center border-l border-gray-200 dark:border-gray-700">
                            <span class="text-base sm:text-lg font-black ${storeB.total < storeA.total ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}">R ${storeB.total.toFixed(2)}</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

// ==========================================
// 6. SAVED BASKETS (Database & Historical Snapshot)
// ==========================================
function openSaveBasketModal() {
    if (basket.length === 0) {
        showToast('Your basket is empty. Add items before saving.');
        return;
    }
    
    if (!isUserAuthenticated) {
        showToast('Please log in before you can save this list. Your cart has been saved.');
        localStorage.setItem('smartBasket_guest_active', JSON.stringify(basket));
        setTimeout(() => {
            window.location.href = '/login';
        }, 1500);
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
    const savedContainer = document.getElementById('saved-baskets-list-container');
    const collabContainer = document.getElementById('collab-baskets-list-container');
    
    // Determine which page we are rendering on
    const container = savedContainer || collabContainer;
    if (!container) return;

    try {
        const res = await fetch(`${API}/api/db/saved-baskets`);
        let fetchedBaskets = await res.json();

        // 💡 FILTER LOGIC: Separate Personal vs Collaborative
        if (collabContainer) {
            allSavedBaskets = fetchedBaskets.filter(b => b.is_collab === true);
        } else {
            allSavedBaskets = fetchedBaskets.filter(b => b.is_collab === false);
        }

        if (!allSavedBaskets.length) {
            const emptyMsg = collabContainer 
                ? "You haven't joined or created any collaborative lists yet. Save a list and invite members to get started!" 
                : "No personal saved baskets found.";
            container.innerHTML = `<p class="col-span-full text-center text-gray-400 font-medium py-12">${emptyMsg}</p>`;
            return;
        }

        container.innerHTML = allSavedBaskets.map(sb => {
            const previewItems = sb.items.slice(0, 4);
            const overflow = sb.items.length - 4;
            const totalEst = sb.items.reduce((a, c) => a + (c.price * (c.quantity || 1)), 0);

            // Assign badges based on ownership status
            let badgeHtml = '';
            if (sb.is_shared) {
                badgeHtml = `<span class="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 ml-2" title="Shared by ${sb.inviter_name}">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                    From ${sb.inviter_name}
                </span>`;
            } else if (sb.is_collab) {
                badgeHtml = `<span class="inline-flex items-center gap-1 bg-brand-dark dark:bg-emerald-600 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm ml-2">Team Owner</span>`;
            }

            return `
                <div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition">
                    <div>
                        <div class="flex justify-between items-start mb-1">
                            <h3 class="font-black text-gray-900 dark:text-white text-base sm:text-lg flex flex-wrap items-center gap-2 pr-2 tracking-tight">${sb.name} ${badgeHtml}</h3>
                            <button onclick="deleteSavedBasket(event, ${sb.id})" class="text-gray-300 hover:text-red-600 font-black text-sm cursor-pointer p-1 -mt-1 -mr-1 transition" title="Delete List">✕</button>
                        </div>
                        <p class="text-[11px] sm:text-xs font-semibold text-gray-400 mb-3">Saved on ${sb.date} &bull; ${sb.items.length} item(s)</p>
                        <div class="flex items-center space-x-2 my-4">
                            ${previewItems.map(i => `<div class="h-10 w-10 sm:h-12 sm:w-12 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-1.5 shrink-0"><img src="${i.imageUrl || ''}" class="object-contain h-full w-full"></div>`).join('')}
                            ${overflow > 0 ? `<div class="h-10 w-10 sm:h-12 sm:w-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center text-xs font-black text-gray-500">+${overflow}</div>` : ''}
                        </div>
                    </div>
                    <div class="pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
                        <span class="text-sm font-black text-gray-900 dark:text-emerald-400">Est. R ${totalEst.toFixed(2)}</span>
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
        const basePrice = item.price;

        storeData.forEach(storeObj => {
            if (item.store === storeObj.name) {
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
    currentStoreData = storeData;

    const mainListHtml = storeData.map((s, index) => {
        const isWinner = index === 0;
        return `
            <div class="${isWinner ? 'border-2 border-brand-dark dark:border-emerald-500 bg-gray-50 dark:bg-gray-800/50' : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'} rounded-2xl p-4 sm:p-5 shadow-2xs transition-colors mb-4">
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

    container.innerHTML = mainListHtml;
    
    const sbsContainer = document.getElementById('basket-page-sbs-container');
    if (sbsContainer) {
        sbsContainer.innerHTML = getSideBySideUIHtml(storeData);
        setTimeout(executeSideBySide, 0);
    }
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

        renderSavedBasketComparison(basketData.items, 'detail-saved-breakdown');
    } catch (e) {
        breakdownContainer.innerHTML = `<p class="text-xs text-red-500 p-4 text-center">JSON Parse Error: ${e.message}</p>`;
    }

    renderCollaboratorTrigger();
}

async function renderCollaboratorTrigger() {
    const container = document.getElementById('collaborator-trigger-container');
    if (!container || !currentInspectedSavedBasket) return;

    try {
        const res = await fetch(`${API}/api/saved-baskets/${currentInspectedSavedBasket.id}/collaborators`);
        const members = await res.json();

        if (!members || members.length === 0) {
            container.innerHTML = `
                <button onclick="openCollabModal()" class="w-10 h-10 bg-brand-dark dark:bg-emerald-600 text-white rounded-full flex items-center justify-center font-black shadow-sm hover:scale-105 transition cursor-pointer relative z-10" title="Add Collaborators">+</button>
            `;
        } else {
            const acceptedMembers = members.filter(m => m.status === 'accepted');
            container.innerHTML = `
                <button onclick="openCollabModal()" class="flex items-center -space-x-2 overflow-hidden p-1 bg-gray-50 dark:bg-gray-800 rounded-full border border-gray-200 dark:border-gray-700 cursor-pointer hover:scale-105 transition relative z-10" title="Manage Collaborators">
                    ${acceptedMembers.slice(0, 3).map(m => `
                        <span class="inline-block h-8 w-8 rounded-full ring-2 ring-white dark:ring-gray-900 bg-emerald-600 text-white text-xs font-black flex items-center justify-center">${m.username.charAt(0).toUpperCase()}</span>
                    `).join('')}
                    <span class="inline-block h-8 w-8 rounded-full ring-2 ring-white dark:ring-gray-900 bg-gray-300 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-[10px] font-black flex items-center justify-center">+</span>
                </button>
            `;
        }
    } catch (e) {
        container.innerHTML = `
            <button onclick="openCollabModal()" class="w-10 h-10 bg-brand-dark dark:bg-emerald-600 text-white rounded-full flex items-center justify-center font-black shadow-sm hover:scale-105 transition cursor-pointer relative z-10" title="Add Collaborators">+</button>
        `;
    }
}

function openCollabModal() {
    const modal = document.getElementById('collaborator-modal');
    if (modal) {
        modal.classList.remove('hidden');
        loadCollaboratorsList();
    }
}

function closeCollabModal() {
    const modal = document.getElementById('collaborator-modal');
    if (modal) modal.classList.add('hidden');
}

async function checkUserNotifications() {
    try {
        const res = await fetch(`${API}/api/notifications`);
        if (!res.ok) return;
        const notifications = await res.json();

        if (notifications.length > 0) {
            showNotificationBanner(notifications);
        }
    } catch (e) {
        console.error("Failed to fetch notifications", e);
    }
}

function showNotificationBanner(notifications) {
    const unread = notifications.filter(n => n.status === 'unread');
    if (unread.length === 0) return;

    let banner = document.getElementById('notification-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'notification-banner';
        banner.className = 'fixed bottom-4 right-4 z-50 max-w-sm w-full space-y-2 pointer-events-none';
        document.body.appendChild(banner);
    }

    const latest = unread[0];
    const targetUrl = latest.basket_id ? `/saved/${latest.basket_id}` : '/notifications';

    banner.innerHTML = `
        <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 shadow-xl flex items-center justify-between space-x-3 pointer-events-auto animate-slideUp">
            <div class="space-y-1">
                <p class="text-xs font-bold text-gray-900 dark:text-white leading-snug">${latest.message}</p>
                <span class="text-[10px] text-gray-400 font-semibold">${latest.date || ''}</span>
            </div>
            <div class="flex items-center space-x-2 shrink-0">
                <a href="${targetUrl}" class="bg-brand-dark dark:bg-emerald-600 hover:bg-black text-white font-bold py-1.5 px-3 rounded-xl text-xs transition cursor-pointer">Open</a>
                <button onclick="closeNotificationBanner()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 font-bold text-sm cursor-pointer" title="Close">✕</button>
            </div>
        </div>
    `;
}

function closeNotificationBanner() {
    const banner = document.getElementById('notification-banner');
    if (banner) banner.remove();
}

async function markAllNotificationsAsRead() {
    try {
        const res = await fetch(`${API}/api/notifications/mark-all-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            showToast('All notifications marked as read.');
            updateNotificationBadge();
            initNotificationsPage();
        } else {
            showToast('Failed to update notifications.');
        }
    } catch (e) {
        showToast('Connection error.');
    }
}

async function initNotificationsPage() {
    const container = document.getElementById('notifications-list-container') || 
                      document.getElementById('notifications-container') || 
                      document.getElementById('notifications-list') ||
                      document.querySelector('.notifications-list');
    
    if (!container) return;

    try {
        const res = await fetch(`${API}/api/notifications`);
        if (!res.ok) {
            container.innerHTML = `<p class="text-sm font-medium text-red-400 text-center py-12">Failed to load notifications.</p>`;
            return;
        }
        const notifications = await res.json();

        if (!notifications || notifications.length === 0) {
            container.innerHTML = `<p class="text-sm font-medium text-gray-400 text-center py-12">No notifications found.</p>`;
            return;
        }

        const hasUnread = notifications.some(n => n.status === 'unread');
        const headerHtml = hasUnread ? `
            <div class="flex items-center justify-between mb-4 pb-2 border-b border-gray-100 dark:border-gray-800 px-1">
                <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Unread & Recent</span>
                <button onclick="markAllNotificationsAsRead()" class="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">Mark all as read</button>
            </div>
        ` : '';

        const listHtml = notifications.map(n => {
            const isInvite = n.message.includes('invited you');
            const targetUrl = n.basket_id ? `/saved/${n.basket_id}` : '#';
            return `
                <div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div class="space-y-1">
                        <p class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white">${n.message}</p>
                        <span class="text-[10px] text-gray-400 font-semibold">${n.date}</span>
                    </div>
                    <div class="flex items-center space-x-2 shrink-0 w-full sm:w-auto">
                        ${n.basket_id ? `<a href="${targetUrl}" class="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 font-bold py-2 px-3 rounded-xl text-xs transition cursor-pointer text-center">Open List</a>` : ''}
                        ${isInvite && n.status === 'unread' ? `
                            <button onclick="respondToNotification(${n.id}, 'accept')" class="bg-brand-dark dark:bg-emerald-600 hover:bg-black text-white font-bold py-2 px-4 rounded-xl text-xs transition cursor-pointer">Accept</button>
                            <button onclick="respondToNotification(${n.id}, 'decline')" class="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 font-bold py-2 px-4 rounded-xl text-xs transition cursor-pointer">Decline</button>
                        ` : `
                            <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${n.status === 'read' ? 'bg-gray-100 dark:bg-gray-800 text-gray-500' : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600'}">${n.status.toUpperCase()}</span>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = headerHtml + `<div class="space-y-4">${listHtml}</div>`;
    } catch (e) {
        container.innerHTML = `<p class="text-xs text-red-400 text-center py-8">Failed to load notifications.</p>`;
    }
}

async function respondToNotification(notifId, action) {
    try {
        const res = await fetch(`${API}/api/notifications/${notifId}/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action })
        });
        
        if (res.ok) {
            showToast(action === 'accept' ? 'Invitation accepted!' : 'Invitation declined.');
            const banner = document.getElementById('notification-banner');
            if (banner) banner.remove();
            
            if (typeof renderCollaboratorTrigger === 'function') {
                renderCollaboratorTrigger();
            }
            updateNotificationBadge();
            initNotificationsPage();
        } else {
            showToast('Failed to respond to notification.');
        }
    } catch (e) {
        showToast('Connection error.');
    }
}

async function searchSystemUsers(query) {
    const resultsContainer = document.getElementById('user-search-results');
    if (!resultsContainer) return;
    
    if (!query.trim()) {
        resultsContainer.innerHTML = '';
        return;
    }

    try {
        const res = await fetch(`${API}/api/users/search?q=${encodeURIComponent(query)}`);
        const users = await res.json();

        if (users.length === 0) {
            resultsContainer.innerHTML = `<p class="text-xs text-gray-400 p-2">No users found.</p>`;
            return;
        }

        resultsContainer.innerHTML = users.map(u => `
            <div class="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <span class="text-xs font-bold text-gray-900 dark:text-white">${u.username}</span>
                <button onclick="inviteUser(${u.id})" class="px-3 py-1 bg-brand-dark dark:bg-emerald-600 text-white font-bold text-[10px] rounded-lg hover:bg-black transition cursor-pointer">Invite</button>
            </div>
        `).join('');
    } catch (e) {
        resultsContainer.innerHTML = `<p class="text-xs text-red-400 p-2">Search failed.</p>`;
    }
}

async function inviteUser(userId) {
    if (!currentInspectedSavedBasket) return;
    try {
        const res = await fetch(`${API}/api/saved-baskets/${currentInspectedSavedBasket.id}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Invitation sent successfully!');
            document.getElementById('user-search-input').value = '';
            document.getElementById('user-search-results').innerHTML = '';
            loadCollaboratorsList();
            renderCollaboratorTrigger();
        } else {
            showToast(data.error || 'Failed to send invitation.');
        }
    } catch (e) {
        showToast('Connection error.');
    }
}

async function loadCollaboratorsList() {
    const container = document.getElementById('collaborators-list-container');
    if (!container || !currentInspectedSavedBasket) return;

    try {
        const res = await fetch(`${API}/api/saved-baskets/${currentInspectedSavedBasket.id}/collaborators`);
        const members = await res.json();

        if (members.length === 0) {
            container.innerHTML = `<p class="text-xs text-gray-400">No collaborators added yet.</p>`;
            return;
        }

        container.innerHTML = members.map(m => `
            <div class="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <span class="text-xs font-bold text-gray-900 dark:text-white">${m.username}</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase ${m.status === 'accepted' ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600' : 'bg-amber-100 dark:bg-amber-950/50 text-amber-600'}">${m.status}</span>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = `<p class="text-xs text-red-400">Failed to load collaborators.</p>`;
    }
}

function copyPublicShareLink() {
    if (!currentInspectedSavedBasket || !currentInspectedSavedBasket.share_token) {
        showToast('Share link not available.');
        return;
    }
    const publicUrl = `${window.location.origin}/shared/basket/${currentInspectedSavedBasket.share_token}`;
    navigator.clipboard.writeText(publicUrl);
    showToast('Public view-only link copied to clipboard!');
}

async function deleteSavedBasket(e, id) {
    if (e) e.stopPropagation();
    
    if (!confirm("Are you sure you want to delete this saved basket?")) {
        return;
    }
    
    try {
        const res = await fetch(`${API}/api/db/saved-baskets/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Saved list deleted successfully');
            renderSavedBasketsList();
        } else {
            showToast('Failed to delete list');
        }
    } catch (e) { 
        showToast('Database connection error'); 
    }
}

function goBackFromSavedBasketDetail() {
    window.location.href = '/saved';
}

function goBack() {
    window.history.back();
} 

// ==========================================
// 7. PRODUCT REVIEWS LOGIC
// ==========================================
async function fetchProductReviews(productId) {
    const container = document.getElementById('reviews-container');
    if (!container) return;
    
    try {
        const res = await fetch(`${API}/api/reviews/${encodeURIComponent(productId)}`);
        const reviews = await res.json();
        
        if (reviews.length === 0) {
            container.innerHTML = `<div class="col-span-full py-8 text-center text-sm font-semibold text-gray-400 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl">No reviews yet. Be the first to review!</div>`;
            return;
        }
        
        container.innerHTML = reviews.map(r => `
            <div class="bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 rounded-3xl p-5 sm:p-6 transition-all hover:shadow-sm">
                <div class="flex items-center justify-between mb-3 border-b border-gray-200 dark:border-gray-800 pb-3">
                    <span class="font-black text-sm text-gray-900 dark:text-white flex items-center gap-2">
                        <span class="h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs">
                            ${r.author_name.charAt(0).toUpperCase()}
                        </span>
                        ${r.author_name}
                    </span>
                    <span class="text-xs font-semibold text-gray-400">${r.date}</span>
                </div>
                <div class="flex items-center mb-3">
                    ${Array(5).fill(0).map((_, i) => `<span class="text-xl ${i < r.rating ? 'text-yellow-400' : 'text-gray-200 dark:text-gray-800'}">★</span>`).join('')}
                </div>
                <p class="text-sm font-medium text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">${r.comment}</p>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = `<p class="col-span-full text-xs text-red-400 py-4 font-semibold text-center">Failed to load reviews.</p>`;
    }
}

function toggleReviewModal() {
    if (!isUserAuthenticated) {
        showToast('Please log in to write a review.');
        setTimeout(() => {
            window.location.href = '/login';
        }, 1200);
        return;
    }
    
    const modal = document.getElementById('review-modal');
    if (modal) {
        if (modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
            document.getElementById('review-rating').value = '5';
            document.getElementById('review-comment').value = '';
        } else {
            modal.classList.add('hidden');
        }
    }
}

async function submitReview(e) {
    e.preventDefault();
    if (!currentActiveProduct) return;
    
    const rating = document.getElementById('review-rating').value;
    const comment = document.getElementById('review-comment').value;
    
    try {
        const res = await fetch(`${API}/api/reviews/${encodeURIComponent(currentActiveProduct.id)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rating, comment })
        });
        
        if (res.ok) {
            toggleReviewModal();
            showToast('Review submitted successfully!');
            fetchProductReviews(currentActiveProduct.id);
        } else {
            showToast('Failed to submit review.');
        }
    } catch (err) {
        showToast('Connection error while submitting review.');
    }
}

async function updateCollabItemQuantity(basketId, productId, change) {
    try {
        const res = await fetch(`${API}/api/db/saved-baskets/${basketId}/items/${productId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ change: change })
        });
        if (res.ok) {
            reloadSavedBasketDetail(basketId);
        } else {
            showToast('Failed to update item quantity.');
        }
    } catch (e) {
        showToast('Connection error.');
    }
}

async function removeCollabItem(basketId, productId) {
    try {
        const res = await fetch(`${API}/api/db/saved-baskets/${basketId}/items/${productId}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            showToast('Item removed from list.');
            reloadSavedBasketDetail(basketId);
        } else {
            showToast('Failed to remove item.');
        }
    } catch (e) {
        showToast('Connection error.');
    }
}

async function reloadSavedBasketDetail(basketId) {
    try {
        const res = await fetch(`${API}/api/db/saved-baskets`);
        const allBaskets = await res.json();
        const target = allBaskets.find(b => b.id === basketId);
        if (target) {
            currentInspectedSavedBasket = target;
            renderSavedBasketComparison(target.items, 'detail-saved-breakdown');
        }
    } catch (e) {}
}

function goToCollaborativeLists() {
    window.location.href = '/collaborative';
}

async function pollNotifications() {
    try {
        const res = await fetch('/api/notifications/count');
        if (!res.ok) return;
        const data = await res.json();
        
        const badges = document.querySelectorAll('.notification-badge');
        badges.forEach(badge => {
            if (data.count > 0) {
                badge.textContent = data.count;
                badge.classList.remove('hidden');
                badge.classList.add('flex');
            } else {
                badge.classList.add('hidden');
                badge.classList.remove('flex');
            }
        });
    } catch (e) {}
}

setInterval(pollNotifications, 15000);

document.addEventListener('DOMContentLoaded', pollNotifications);

async function loadSavedBasketAsActive() {
    const dataEl = document.getElementById('basket-data');
    if (!dataEl) return;
    const basketData = JSON.parse(dataEl.textContent);
    
    if (basketData.id) {
        localStorage.setItem('activeCollaborativeBasketId', basketData.id);
        localStorage.setItem('activeCollaborativeBasketName', basketData.name);
    }

    try {
        const res = await fetch('/api/db/active-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: basketData.items })
        });

        if (res.ok) {
            localStorage.setItem('smartBasket_active', JSON.stringify(basketData.items));
            showToast('Loaded list into active cart!');
            setTimeout(() => { window.location.href = '/basket'; }, 500);
        } else {
            showToast('Failed to load items to active cart.');
        }
    } catch (e) {
        showToast('Connection error.');
    }
}

async function saveActiveCartChanges() {
    const activeItems = basket;
    const collabBasketId = localStorage.getItem('activeCollaborativeBasketId');
    const collabBasketName = localStorage.getItem('activeCollaborativeBasketName') || 'Collaborative Workspace';

    if (!activeItems || activeItems.length === 0) {
        showToast('Your cart is empty.');
        return;
    }

    try {
        const payload = {
            name: collabBasketName,
            items: activeItems
        };
        
        if (collabBasketId) {
            payload.basket_id = parseInt(collabBasketId);
        }

        const res = await fetch('/api/db/save-basket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Changes saved and team notified!');
            localStorage.removeItem('activeCollaborativeBasketId');
            localStorage.removeItem('activeCollaborativeBasketName');
            setTimeout(() => { window.location.href = `/saved/${data.basket_id}`; }, 800);
        } else {
            showToast(data.error || 'Failed to save changes.');
        }
    } catch (e) {
        showToast('Connection error.');
    }
}