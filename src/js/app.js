// ============================================================
// BADDEL LAUNCHER - RENDERER (app.js)
// ============================================================

// ---- State ----
let allGamesData = [];
let allCollections = [];
let selectedGameId = null;
let tempImagePath = null;
let isEditingMode = false;

let activeHoverId = null;
let isLaunching = false;
let currentHeroGameId = null;
let currentFilters = { collectionId: null, platform: 'all', search: '', sort: 'manual' };

// View state: 'home' | 'installed' | 'collection'
let currentView = 'home';
let exploreCarouselOffset = 0;
const EXPLORE_PAGE_SIZE = 12;

const imageQueue = [];
let activeRequests = 0;
let isScanning = false;

let playtimeData = {};
let currentHeroSlideshowInterval = null;
let currentEditingCollectionId = null;
let customSpinIds = [];

// ============================================================
// PLAYTIME SYSTEM
// ============================================================
function buildPlaytimeCache(games) {
    playtimeData = {};
    games.forEach(g => {
        if (g.totalPlaytime || g.lastPlayed || g.playSessions) {
            playtimeData[g.id] = {
                totalMinutes: g.totalPlaytime || 0,
                lastPlayed: g.lastPlayed || null,
                playSessions: g.playSessions || []
            };
        }
    });
}

async function savePlaytimeData(gameId, playedMinutes) {
    try {
        const result = await window.electronAPI.updatePlaytime(gameId, playedMinutes);
        if (result && result.status === 'success') {
            if (!playtimeData[gameId]) playtimeData[gameId] = { totalMinutes: 0, lastPlayed: null };
            playtimeData[gameId].totalMinutes = result.totalPlaytime;
            playtimeData[gameId].lastPlayed = result.lastPlayed;

            const gameIndex = allGamesData.findIndex(g => String(g.id) === String(gameId));
            if (gameIndex > -1) {
                allGamesData[gameIndex].totalPlaytime = result.totalPlaytime;
                allGamesData[gameIndex].lastPlayed = result.lastPlayed;
            }
        }
    } catch (e) {
        console.error('Failed to save playtime:', e);
    }
}

function formatPlaytime(minutes) {
    if (!minutes) return '0h 0m';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatLastPlayed(timestamp) {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
}

async function migratePlaytimeFromLocalStorage() {
    const migrationDone = localStorage.getItem('baddel_playtime_migrated');
    if (migrationDone) return;

    const oldData = JSON.parse(localStorage.getItem('baddel_playtime') || '{}');
    const entries = Object.entries(oldData);
    if (entries.length === 0) {
        localStorage.setItem('baddel_playtime_migrated', '1');
        return;
    }

    for (const [gameId, data] of entries) {
        try {
            await window.electronAPI.updatePlaytime(gameId, data.totalMinutes || 0);
            playtimeData[gameId] = { totalMinutes: data.totalMinutes || 0, lastPlayed: data.lastPlayed || null };
        } catch { /* skip failed games */ }
    }

    localStorage.setItem('baddel_playtime_migrated', '1');
}

// ============================================================
// 1. SYSTEM STARTUP & NAVIGATION
// ============================================================
async function initSystem() {
    try {
        const loader = document.getElementById('mainLoader');
        const grid = document.getElementById('gamesGrid');

        if (loader) loader.classList.add('active');
        if (grid) grid.style.display = 'none';

        const [games, collections] = await Promise.all([
            window.electronAPI.getGames(),
            window.electronAPI.getCollections()
        ]);

        allGamesData = games;
        allCollections = collections;

        buildPlaytimeCache(games);
        await migratePlaytimeFromLocalStorage();

        renderSidebar();
        navigateToHome(); // بدلاً من applyFilters في الـ Home
        initSortable();

        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.classList.remove('active'), 400);
        }
        if (grid) grid.style.display = 'grid';

        setTimeout(() => {
            if (typeof window.checkAndStartTour === 'function') window.checkAndStartTour();
        }, 800);
    } catch (err) {
        console.error('Init Error:', err);
        const loader = document.getElementById('mainLoader');
        if (loader) loader.classList.remove('active');
    }
}
initSystem();

function _hideAllViews() {
    const libView = document.getElementById('libraryView');
    const instView = document.getElementById('installedGamesView');
    const accView = document.getElementById('accountsView');
    const heroSec = document.getElementById('heroSection');
    const gdView = document.getElementById('gameDetailsView');
    const allGmsView = document.getElementById('allGamesView'); 

    if (libView) libView.style.display = 'none';
    if (instView) instView.style.display = 'none';
    if (accView) accView.style.display = 'none';
    if (heroSec) heroSec.style.display = 'none';
    if (gdView) gdView.style.display = 'none'; 
    if (allGmsView) allGmsView.style.display = 'none'; 
}

function navigateToHome() {
    currentView = 'home';
    _hideAllViews();
    
    document.getElementById('heroSection').style.display = 'flex';
    document.getElementById('libraryView').style.display = 'block';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    currentFilters.collectionId = null;
    currentFilters.platform = 'all';
    currentFilters.search = '';
    currentHeroGameId = null;

    renderRecentlyPlayed();
    renderExploreCarousel();
    applyHeroForHome();
    renderAccountShortcuts();
    updateFooterStats();
    
    if (typeof checkAndManagePolling === 'function') checkAndManagePolling();
}

function navigateToInstalled() {
    currentView = 'installed';
    _hideAllViews();
    
    document.getElementById('installedGamesView').style.display = 'block';

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-installed')?.classList.add('active');

    currentFilters.collectionId = null;
    applyFilters();
}

function applyHeroForHome() {
    const recent = getRecentGames();
    if (recent.length > 0) {
        updateHeroSection(recent[0].id);
    } else if (allGamesData.length > 0) {
        updateHeroSection(allGamesData[0].id);
    } else {
        // Fallback لو مفيش أي ألعاب
        const bgImg = document.getElementById('heroBg');
        const titleTxt = document.getElementById('heroTitle');
        if (bgImg) {
            bgImg.style.backgroundImage = `linear-gradient(to bottom, transparent 0%, #000000 100%), radial-gradient(rgba(255, 255, 255, 0.18) 1.5px, transparent 1.5px), linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)`;
            bgImg.style.backgroundSize = '100% 100%, 20px 20px, 100% 100%';
        }
        if (titleTxt) { titleTxt.innerText = 'No Games Found'; titleTxt.style.display = 'block'; }
        document.getElementById('heroLogo').style.display = 'none';
        document.getElementById('heroStats').style.display = 'none';
        document.getElementById('heroPlayBtn').style.display = 'none';
        document.getElementById('heroSettingsBtn').style.display = 'none';
    }
}

// ============================================================
// EXPLORE CAROUSEL (For Home - Epic Style)
// ============================================================
function renderExploreCarousel() {
    const grid = document.getElementById('exploreGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // نجيب مثلاً 15 لعبة عشوائية نعرضهم في الـ Carousel (أو ممكن تعرضهم كلهم)
    const shuffled = [...allGamesData].sort(() => Math.random() - 0.5).slice(0, 15);

    if (shuffled.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="width:100%"><div class="empty-title">No games yet.</div></div>';
        return;
    }

    shuffled.forEach(game => grid.appendChild(createGameCard(game)));
}

function exploreCarouselPrev() {
    const grid = document.getElementById('exploreGrid');
    // السكرول لليسار بمقدار 3 كروت تقريباً (عرض الكارت 200 + المسافات)
    if (grid) grid.scrollBy({ left: -660, behavior: 'smooth' });
}

function exploreCarouselNext() {
    const grid = document.getElementById('exploreGrid');
    // السكرول لليمين بمقدار 3 كروت تقريباً
    if (grid) grid.scrollBy({ left: 660, behavior: 'smooth' });
}

// ============================================================
// ACCOUNT SHORTCUTS (For Home)
// ============================================================
// ============================================================
// ACCOUNT SHORTCUTS (For Home)
// ============================================================
// ============================================================
// ACCOUNT SHORTCUTS (For Home)
// ============================================================
const PLATFORM_LOGOS = {
    steam:   { img: '../assets/Steam.png',   name: 'Steam',   color: '#1b2838' },
    epic:    { img: '../assets/epic.svg',     name: 'Epic',    color: '#181818', invert: true },
    ea:      { img: '../assets/ea.png',       name: 'EA App',  color: '#ff6b35' },
    riot:    { img: '../assets/riot.png',     name: 'Riot',    color: '#ff4655' },
    ubisoft: { img: '../assets/ubisoft.png',  name: 'Ubisoft', color: '#0070d1', invert: true },
    discord: { img: '../assets/discord.webp', name: 'Discord', color: '#5865F2' },
};

function renderAccountShortcuts() {
    const container = document.getElementById('accountsShortcutsInner');
    const section = document.getElementById('accountsShortcutsSection');
    if (!container || !section) return;

    let pinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    
    if (pinned.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = '';

    pinned.forEach(acc => {
        const cfg = PLATFORM_LOGOS[acc.platform];
        if (!cfg) return;
        
        const btn = document.createElement('div');
        btn.className = 'account-shortcut-card';
        // 🔴 بنخزن الداتا عشان نقدر نرتبهم بعدين
        btn.dataset.platform = acc.platform;
        btn.dataset.profile = acc.profileName;
        
        const initials = acc.displayName ? acc.displayName.substring(0, 2).toUpperCase() : '??';
        const uniqueId = `home-avatar-${acc.platform}-${acc.profileName.replace(/\W/g, '')}`;
        
        let avatarContent = `<span style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-weight:bold; color: #fff;">${initials}</span>`;
        
        if (acc.avatarUrl) {
            avatarContent = `<img src="${acc.avatarUrl}" class="asc-img" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        } 
        else if (acc.platform === 'steam') {
            avatarContent = `
                <span id="span-${uniqueId}" style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-weight:bold; color: #fff;">${initials}</span>
                <img id="img-${uniqueId}" class="asc-img" style="display:none; width:100%; height:100%; object-fit:cover; border-radius:50%;">
            `;
        }

        // 🔴 غيرنا title لـ data-tooltip
        btn.innerHTML = `
            <button class="asc-unpin-btn" onclick="handlePinAccount('${acc.platform}', '${acc.profileName}')" data-tooltip="Unpin">
                <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div class="asc-avatar" style="--sc-color:${cfg.color};">
                ${avatarContent}
                <div class="asc-plat-badge">
                    <img src="${cfg.img}" class="${cfg.invert ? 'shortcut-invert' : ''}" style="width:100%; height:100%; object-fit:contain;">
                </div>
            </div>
            <div class="asc-info">
                <div class="asc-name">${acc.displayName}</div>
                <div class="asc-plat">${cfg.name}</div>
            </div>
            <button class="asc-play-btn" onclick="switchPinnedAccount('${acc.platform}', '${acc.profileName}', this)" data-tooltip="Switch">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            </button>
        `;

        // 🔴 تفعيل فك التثبيت بـ Right Click
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            handlePinAccount(acc.platform, acc.profileName);
        });

        container.appendChild(btn);

        if (acc.platform === 'steam' && acc.extraId && window.electronAPI.getSteamImage) {
            window.electronAPI.getSteamImage(acc.extraId).then(imgUrl => {
                if (imgUrl && imgUrl.trim() !== '') {
                    const imgEl = document.getElementById(`img-${uniqueId}`);
                    const spanEl = document.getElementById(`span-${uniqueId}`);
                    if (imgEl && spanEl) {
                        imgEl.onload = () => { imgEl.style.display = 'block'; spanEl.style.display = 'none'; };
                        imgEl.onerror = () => { imgEl.style.display = 'none'; spanEl.style.display = 'flex'; };
                        imgEl.src = imgUrl;
                    }
                }
            }).catch(() => {});
        }
    });

    // 🔴 تشغيل السحب والإفلات بعد ما الكروت تترسم
    initShortcutsSortable();
}

// ============================================================
// 🟢 دوال السحب والإفلات (Drag & Drop) للأكاونتات
// ============================================================
let shortcutsSortableInstance = null;

function initShortcutsSortable() {
    const container = document.getElementById('accountsShortcutsInner');
    if (!container) return;

    if (shortcutsSortableInstance) {
        shortcutsSortableInstance.destroy();
    }

    shortcutsSortableInstance = new Sortable(container, {
        animation: 250,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        delay: 100, // تأخير بسيط عشان ميمنعش كليك الماوس العادي
        delayOnTouchOnly: true,
        onEnd: () => {
            saveShortcutsOrder(); // حفظ الترتيب الجديد لما تسيب الماوس
        }
    });
}

function saveShortcutsOrder() {
    const container = document.getElementById('accountsShortcutsInner');
    const cards = container.querySelectorAll('.account-shortcut-card');
    
    let currentPinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let newOrder = [];

    // بنمشي على الكروت بعد ما اليوزر رتبهم ونعيد ترتيب الـ Array
    cards.forEach(card => {
        const plat = card.dataset.platform;
        const prof = card.dataset.profile;
        const acc = currentPinned.find(p => p.platform === plat && p.profileName === prof);
        if (acc) newOrder.push(acc);
    });

    // بنحفظ الترتيب الجديد في الجهاز
    localStorage.setItem('baddel_pinned_accounts', JSON.stringify(newOrder));
}

window.switchPinnedAccount = async function(platform, profileName, btnEl) {
    if(typeof handleSwitchAccount === 'function') {
        await handleSwitchAccount(platform, profileName, btnEl);
    }
}

// ============================================================
// REAL-TIME PLAYTIME UPDATER
// ============================================================
if (window.electronAPI.onPlaytimeUpdated) {
    window.electronAPI.onPlaytimeUpdated((data) => {
        const { gameId, totalMinutes, lastPlayed, playSessions } = data;

        if (!playtimeData[gameId]) playtimeData[gameId] = { totalMinutes: 0, lastPlayed: null, playSessions: [] };
        playtimeData[gameId].totalMinutes = totalMinutes;
        playtimeData[gameId].lastPlayed = lastPlayed;
        if (playSessions) playtimeData[gameId].playSessions = playSessions;

        const gameIndex = allGamesData.findIndex(g => String(g.id) === String(gameId));
        if (gameIndex > -1) {
            allGamesData[gameIndex].totalPlaytime = totalMinutes;
            allGamesData[gameIndex].lastPlayed = lastPlayed;
            if (playSessions) allGamesData[gameIndex].playSessions = playSessions;
        }

        renderRecentlyPlayed();

        if (currentFilters.collectionId === null && currentHeroGameId === String(gameId)) {
            updateHeroSection(gameId);
        }

        updateFooterStats();

        const cards = document.querySelectorAll(`.game-card[data-id="${gameId}"]`);
        cards.forEach(card => {
            const timeEl = card.querySelector('.gc-time');
            if (timeEl) {
                const h = Math.floor(totalMinutes / 60);
                const m = totalMinutes % 60;
                const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
                const clockIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
                
                timeEl.innerHTML = `${clockIcon} ${timeStr}`;
                timeEl.classList.add('played'); 
            }
        });
    });
}

// ============================================================
// REAL-TIME LIBRARY + IMAGE UPDATES FROM MAIN PROCESS
// ============================================================

// Full library refresh (background scan completed)
if (window.electronAPI.onLibraryUpdated) {
    window.electronAPI.onLibraryUpdated((updatedGames) => {
        allGamesData = updatedGames;
        renderSidebar();
        if (currentView === 'home') {
            renderRecentlyPlayed();
            renderExploreCarousel();
            applyHeroForHome();
        } else {
            applyFilters();
        }
    });
}


if (window.electronAPI.onGameImageUpdated) {
    window.electronAPI.onGameImageUpdated((updatedGame) => {
        const idx = allGamesData.findIndex(g => String(g.id) === String(updatedGame.id));
        if (idx === -1) return;

        // Update the in-memory record (This includes cover, hero, and logo)
        allGamesData[idx] = { ...allGamesData[idx], ...updatedGame };

        const cacheBuster = `?t=${Date.now()}`;

        // Update the card's cover image in the DOM
        const cardImg = document.querySelector(`[data-id="${updatedGame.id}"] .actual-img`);
        if (cardImg && updatedGame.image) {
            cardImg.src = updatedGame.image + cacheBuster;
            cardImg.style.opacity = '1';
        }

        // If this game is the current hero, refresh the hero section too
        if (currentHeroGameId === String(updatedGame.id)) {
            updateHeroSection(updatedGame.id);
        }

        // 🔴 السحر هنا: لو المستخدم فاتح إعدادات اللعبة دي تحديداً، اعملها إعادة تحميل تلقائي
        if (selectedGameId === String(updatedGame.id)) {
            const settingsModal = document.getElementById('gameSettingsModal');
            if (settingsModal && settingsModal.classList.contains('active')) {
                if (typeof openGameSettings === 'function') {
                    openGameSettings(selectedGameId);
                }
            }
        }
    });
}

// ============================================================
// 2. FILTERS (Fixed Version)
// ============================================================
function applyFilters() {
    const grid = document.getElementById('gamesGrid');
    if (!grid) return;

    grid.style.minHeight = grid.offsetHeight + 'px';
    grid.innerHTML = '';

    if (typeof imageQueue !== 'undefined') {
        imageQueue.length = 0; 
    }

    let filtered = [...allGamesData];

    if (currentFilters.platform !== 'all') {
        filtered = filtered.filter(g => {
            const plat = (g.platform || '').toLowerCase();
            const filterVal = currentFilters.platform.toLowerCase();
            return plat.includes(filterVal) || (filterVal === 'manual' && plat === 'manual');
        });
    }

    if (currentFilters.search.trim() !== '') {
        const term = currentFilters.search.toLowerCase();
        filtered = filtered.filter(g => {
            const name = g.name.toLowerCase();
            if (name.startsWith(term)) return true;
            if (name.includes(` ${term}`) || name.includes(`-${term}`) || name.includes(`_${term}`) || name.includes(`:${term}`)) return true;
            return false;
        });
    }
    if (currentFilters.sort === 'name') {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (currentFilters.sort === 'playtime') {
        filtered.sort((a, b) => {
            const timeA = playtimeData[a.id] ? playtimeData[a.id].totalMinutes : 0;
            const timeB = playtimeData[b.id] ? playtimeData[b.id].totalMinutes : 0;
            return timeB - timeA;
        });
    } else if (currentFilters.sort === 'last_played') {
        filtered.sort((a, b) => {
            const lastA = playtimeData[a.id] ? playtimeData[a.id].lastPlayed || 0 : 0;
            const lastB = playtimeData[b.id] ? playtimeData[b.id].lastPlayed || 0 : 0;
            return lastB - lastA;
        });
    } else if (currentFilters.sort === 'manual' && currentFilters.collectionId !== null) {
        const targetColl = allCollections.find(c => c.id === currentFilters.collectionId);
        if (targetColl) {
            filtered.sort((a, b) => targetColl.gameIds.indexOf(String(a.id)) - targetColl.gameIds.indexOf(String(b.id)));
        }
    }
    const libraryTitle = document.getElementById('libraryTitle');

    if (currentFilters.collectionId !== null) {
        const targetColl = allCollections.find(c => c.id === currentFilters.collectionId);
        if (targetColl) {
            filtered = filtered.filter(g => targetColl.gameIds.includes(String(g.id)));
            updateHeroForCollection(targetColl);
            if (libraryTitle) libraryTitle.innerText = targetColl.name;
        }
    } else {
        if (libraryTitle) {
            libraryTitle.innerText = currentFilters.platform !== 'all'
                ? `${document.getElementById('selectedPlatformText').innerText} Library`
                : 'Installed Games';
        }
    }

    if (currentHeroGameId && !filtered.find(g => String(g.id) === currentHeroGameId)) {
        currentHeroGameId = null;
    }

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
                <div class="empty-title">... It's quiet in here ...</div>
                <div class="empty-subtext">No games found. Try changing your filters or add a new game.</div>
            </div>
        `;
    } else {
        filtered.forEach(game => grid.appendChild(createGameCard(game)));
    }

    updateSidebarActiveState();
    setTimeout(() => { grid.style.minHeight = 'auto'; }, 10);
    updateFooterStats();
    if (typeof checkAndManagePolling === 'function') checkAndManagePolling();
}

function filterGames() {
    currentFilters.search = document.getElementById('searchInput').value;
    applyFilters();
}

function selectPlatform(value, text) {
    document.getElementById('selectedPlatformText').innerText = text;
    currentFilters.platform = value;
    toggleDropdown();
    applyFilters();
}

function toggleSortDropdown(e) { 
    if (e) e.stopPropagation(); 
    document.getElementById('sortMenu').classList.toggle('active'); 
}

function selectSort(value, text) {
    document.getElementById('selectedSortText').innerText = text;
    currentFilters.sort = value;
    document.getElementById('sortMenu').classList.remove('active');
    applyFilters();
}

function filterByCollection(collId) {
    currentView = 'collection';
    _hideAllViews();
    
    document.getElementById('heroSection').style.display = 'flex';
    document.getElementById('installedGamesView').style.display = 'block';

    currentFilters.collectionId = collId;
    currentHeroGameId = null;
    currentFilters.platform = 'all';
    currentFilters.search = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('selectedPlatformText').innerText = 'All Platforms';
    
    applyFilters();
}

async function reloadLibrary() {
    if (isScanning) return;
    isScanning = true;
    const btn = document.getElementById('btn-scan');
    if (btn) btn.style.transform = 'rotate(360deg)';
    showToast('Scanning library...', 'success');
    
    try {
        const updatedGames = await window.electronAPI.scanAllGames();
        allGamesData = updatedGames;
        allCollections = await window.electronAPI.getCollections();
        buildPlaytimeCache(updatedGames);
        
        renderSidebar();
        
        if (currentView === 'home') {
            renderRecentlyPlayed();
            renderExploreCarousel();
            applyHeroForHome();
        } else {
            applyFilters(); 
        }
        
        showToast('Library updated!', 'success');
    } catch (e) { 
        showToast('Scan failed', 'error'); 
    } finally {
        if (btn) btn.style.transform = 'none';
        isScanning = false;
    }
}

// ============================================================
// 3. CARD RENDERING & RECENTLY PLAYED
// ============================================================
function getRecentGames() {
    const playedGames = allGamesData.filter(g => playtimeData[g.id] && playtimeData[g.id].lastPlayed);
    return playedGames.sort((a, b) => playtimeData[b.id].lastPlayed - playtimeData[a.id].lastPlayed);
}

function renderRecentlyPlayed() {
    const grid = document.getElementById('recentGrid');
    const section = document.getElementById('recentlyPlayedSection');
    if (!grid || !section) return;

    const recent = getRecentGames().slice(0, 5);

    if (recent.length === 0 || currentView !== 'home') {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = '';
    recent.forEach(game => grid.appendChild(createGameCard(game, true)));
}

function createGameCard(game, isRecent = false) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.setAttribute('data-id', game.id);

    card.addEventListener('mouseenter', () => {
        if (currentFilters.collectionId === null && currentView === 'home') updateHeroSection(game.id);
    });

    const pData = playtimeData[game.id] || { totalMinutes: 0 };
    let timeStr = 'Not played';
    let playedClass = '';
    if (pData.totalMinutes > 0) {
        const h = Math.floor(pData.totalMinutes / 60);
        const m = pData.totalMinutes % 60;
        timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
        playedClass = 'played';
    }

    const clockIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    const initials = game.name ? game.name.substring(0, 2).toUpperCase() : '🎮';
    const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

    // ── Platform badge(s) ──────────────────────────────────────────
    // game.sources = ['steam','epic',...] لو موجود، وإلا fallback على game.platform
    const PLAT_META = {
        steam:   { label: 'Steam',   color: '#66c0f4', icon: '../assets/Steam.png',   invert: false },
        epic:    { label: 'Epic',    color: '#ffffff', icon: '../assets/epic.svg',    invert: true  },
        ea:      { label: 'EA',      color: '#ff6b35', icon: '../assets/ea.png',      invert: false },
        riot:    { label: 'Riot',    color: '#ff4655', icon: '../assets/riot.png',    invert: false },
        ubisoft: { label: 'Ubisoft', color: '#00a8ff', icon: '../assets/ubisoft.png', invert: false },
        manual:  { label: 'Manual',  color: '#888888', icon: null,                   invert: false },
    };

    const rawSources = game.sources && Array.isArray(game.sources) && game.sources.length > 0
        ? game.sources
        : [game.platform || 'manual'];

    const MAX_BADGES = 3;
    const visibleSources = rawSources.slice(0, MAX_BADGES);
    const overflow = rawSources.length - MAX_BADGES;

    const badgesHTML = visibleSources.map(src => {
        const key = (src || '').toLowerCase();
        const meta = PLAT_META[key] || { label: src, color: '#888', icon: null, invert: false };
        const imgTag = meta.icon
            ? `<img src="${meta.icon}" alt="${meta.label}" class="plat-badge-img${meta.invert ? ' plat-badge-invert' : ''}" style="--plat-c:${meta.color}">`
            : `<span class="plat-badge-dot" style="background:${meta.color}"></span>`;
        return `<span class="plat-badge" style="--plat-c:${meta.color}" title="${meta.label}">${imgTag}</span>`;
    }).join('');

    const overflowBadge = overflow > 0
        ? `<span class="plat-badge plat-badge-more" title="${rawSources.slice(MAX_BADGES).join(', ')}">+${overflow}</span>`
        : '';

    card.innerHTML = `
        <div class="placeholder-bg"><span class="placeholder-text">${initials}</span></div>
        <img class="actual-img" src="${transparentPixel}" alt="${game.name}" onerror="this.style.opacity='0'">
        <div class="gc-grad-bottom"></div>
        <div class="gc-grad-top"></div>
        <div class="gc-platforms">${badgesHTML}${overflowBadge}</div>
        <div class="gc-info">
            <div class="gc-name">${game.name}</div>
            <div class="gc-time ${playedClass}">${clockIcon} ${timeStr}</div>
        </div>
        <div class="play-btn-center" onclick="triggerLaunchSequence('${game.id}')">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <span style="margin-left: 2px;">PLAY</span>
        </div>
    `;

    const imgEl = card.querySelector('.actual-img');

    // Handle missing local images automatically
    imgEl.onerror = () => {
        imgEl.style.opacity = '0';
        // لو الصورة كان المفروض تكون لوكال ومش موجودة، هنفضي الكاش ونطلبها من تاني
        if (game.image && game.image.startsWith('file://')) {
            console.log('Broken local cache detected, re-fetching:', game.name);
            game.image = null; 
            localStorage.removeItem('cover_' + game.id);
            fetchMetadata(imgEl, game); 
        }
    };

    if (game.image && game.image.startsWith('file://')) {
        // Local cached file — load instantly
        imgEl.src = game.image;
        checkBackgroundAssets(game);
    } else {
        // No image, or image is a remote http:// URL that may be blocked/expired
        // — go through fetchMetadata which handles disk cache + API fallback
        fetchMetadata(imgEl, game);
    }

    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, game.id, game.name);
    });

    return card;
}

function getPlatformClass(p) {
    p = (p || '').toLowerCase();
    if (p.includes('steam')) return 'ps';
    if (p.includes('epic')) return 'pe';
    if (p.includes('riot')) return 'pr';
    if (p.includes('ea')) return 'pea';
    if (p.includes('ubisoft')) return 'pu';
    if (p.includes('xbox')) return 'px';
    return 'pm';
}

// ============================================================
// 4. HERO SECTION
// ============================================================
function updateHeroSection(gameId) {
    if (isLaunching) return;
    clearInterval(currentHeroSlideshowInterval);

    const game = allGamesData.find(g => String(g.id) === String(gameId));
    if (!game) return;
    currentHeroGameId = String(gameId);

    const bgImg = document.getElementById('heroBg');
    const logoImg = document.getElementById('heroLogo');
    const titleTxt = document.getElementById('heroTitle');
    const statsDiv = document.getElementById('heroStats');
    const actionsDiv = document.querySelector('.hero-actions');
    const playBtn = document.getElementById('heroPlayBtn');
    const settingsBtn = document.getElementById('heroSettingsBtn');

    if (!bgImg || !logoImg) return;

    const targetBg = game.heroImage || game.image || 'assets/default_hero.jpg';
    bgImg.style.backgroundImage = `url('${targetBg.replace(/\\/g, '/')}')`;

    if (game.logo) {
        logoImg.src = game.logo; logoImg.style.display = 'block'; titleTxt.style.display = 'none';
    } else {
        logoImg.style.display = 'none'; titleTxt.innerText = game.name; titleTxt.style.display = 'block';
    }

    const pData = playtimeData[game.id] || { totalMinutes: 0, lastPlayed: null };
    statsDiv.innerHTML = `
        <span class="stat-badge playtime-stat"><span id="heroPlaytime">${formatPlaytime(pData.totalMinutes)}</span></span>
        <span class="stat-badge">Last Played: <span id="heroLastPlayed">${formatLastPlayed(pData.lastPlayed)}</span></span>
    `;

    statsDiv.style.display = 'flex';
    playBtn.style.display = 'block';

    if (settingsBtn) {
        settingsBtn.style.display = 'flex';
        settingsBtn.style.width = '48px';
        settingsBtn.style.height = '48px';
        settingsBtn.style.fontSize = '1.2rem';
        actionsDiv.appendChild(settingsBtn);
        settingsBtn.onclick = () => openGameSettings(game.id);
    }
    
    playBtn.onclick = () => triggerLaunchSequence(game.id);
}

function updateHeroForCollection(coll) {
    clearInterval(currentHeroSlideshowInterval);

    const bgImg = document.getElementById('heroBg');
    const logoImg = document.getElementById('heroLogo');
    const titleTxt = document.getElementById('heroTitle');
    const statsDiv = document.getElementById('heroStats');
    const playBtn = document.getElementById('heroPlayBtn');
    const settingsBtn = document.getElementById('heroSettingsBtn');

    if (!bgImg) return;

    let totalMins = 0;
    let validImages = [];
    let activeGamesCount = 0;

    if (coll.gameIds && coll.gameIds.length > 0) {
        coll.gameIds.forEach(id => {
            const g = allGamesData.find(x => String(x.id) === String(id));
            if (g) {
                activeGamesCount++;
                if (playtimeData[id]?.totalMinutes) totalMins += playtimeData[id].totalMinutes;
                if (g.heroImage || g.image) validImages.push(g.heroImage || g.image);
            }
        });
    }

    if (coll.image) {
        bgImg.style.backgroundImage = `url('${coll.image.replace(/\\/g, '/').replace(/'/g, "\\'")}')`;
        bgImg.style.backgroundSize = 'cover';
        bgImg.style.filter = 'none';
    } else if (validImages.length > 0) {
        let imgIndex = 0;
        const setBg = (idx) => {
            bgImg.style.backgroundImage = `url('${validImages[idx].replace(/\\/g, '/').replace(/'/g, "\\'")}')`;
            bgImg.style.backgroundSize = 'cover';
        };
        setBg(imgIndex);
        bgImg.style.filter = 'none';
        if (validImages.length > 1) {
            currentHeroSlideshowInterval = setInterval(() => {
                imgIndex = (imgIndex + 1) % validImages.length;
                setBg(imgIndex);
            }, 5000);
        }
    } else {
        bgImg.style.backgroundImage = `
            linear-gradient(to bottom, transparent 0%, #000000 100%),
            radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px),
            linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)
        `;
        bgImg.style.backgroundSize = '100% 100%, 20px 20px, 100% 100%';
        bgImg.style.filter = 'none';
    }

    logoImg.style.display = 'none';
    titleTxt.innerText = coll.name || 'Favorites';
    titleTxt.style.display = 'block';

    statsDiv.innerHTML = `
        <span class="stat-badge playtime-stat"><span id="heroPlaytime">${formatPlaytime(totalMins)}</span></span>
        <span class="stat-badge">Total Games: <span id="heroLastPlayed">${activeGamesCount}</span></span>
    `;

    statsDiv.style.display = 'flex';
    playBtn.style.display = 'none';

    if (settingsBtn) {
        settingsBtn.style.display = 'flex';
        settingsBtn.style.width = '32px';
        settingsBtn.style.height = '32px';
        settingsBtn.style.fontSize = '1rem';
        settingsBtn.style.margin = '0';
        statsDiv.appendChild(settingsBtn);
        settingsBtn.onclick = () => openCollectionSettings(coll.id);
    }
}

function triggerPlayFromHero() {
    if (currentHeroGameId) triggerLaunchSequence(currentHeroGameId);
}

function openCurrentGameSettings() {
    if (currentHeroGameId) openGameSettings(currentHeroGameId);
}

// ============================================================
// 5. LAUNCHER
// ============================================================
async function triggerLaunchSequence(gameId) {
    if (isLaunching) return;

    const game = allGamesData.find(g => String(g.id) === String(gameId));
    if (!game) return;

    // 🎮 افتح الـ Play Launcher Modal أولاً (بيختار المنصة والأكاونت)
    // لو اللعبة على منصة واحدة هيشغل مباشرة من غير Modal
    if (typeof window.openPlayLauncher === 'function') {
        window.openPlayLauncher(game);
        return;
    }

    // ── Fallback: لو play-launcher.js مش محمّل ──
    isLaunching = true;

    const overlay = document.getElementById('launchOverlay');
    const bgDiv = document.getElementById('launchBg');
    const logoImg = document.getElementById('launchLogo');
    const titleTxt = document.getElementById('launchTitle');
    const statusText = document.getElementById('launchText');

    logoImg.style.display = 'none'; logoImg.src = '';
    titleTxt.style.display = 'none'; statusText.innerText = 'INITIALIZING...';

    const bgUrl = game.heroImage || game.image || 'assets/default_hero.jpg';
    if (bgUrl) bgDiv.style.backgroundImage = `url('${bgUrl.replace(/\\/g, '/')}')`;

    if (game.logo) { logoImg.src = game.logo; logoImg.style.display = 'block'; }
    else { titleTxt.innerText = game.name; titleTxt.style.display = 'block'; }

    statusText.innerText = `STARTING ${game.name.toUpperCase()}...`;
    overlay.classList.add('active');

    let trackPath = game.path;
    if (!trackPath && game.command) {
        const cleanCommand = game.command.replace(/"/g, '');
        trackPath = cleanCommand.substring(0, cleanCommand.lastIndexOf('\\'));
    }

    try {
        const launchRes = await window.electronAPI.launchGame(game.command, game.id, trackPath, game.name);
        if (launchRes && launchRes.status === 'error') throw new Error(launchRes.message);
    } catch (e) {
        showToast('Error starting game! Make sure it\'s installed.', 'error');
        overlay.classList.remove('active');
        isLaunching = false;
        return;
    }

    const finish = () => {
        window.electronAPI.minimizeApp();
        setTimeout(() => { overlay.classList.remove('active'); isLaunching = false; }, 400);
    };

    const onFocus = () => { finish(); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    setTimeout(() => { if (isLaunching) { finish(); window.removeEventListener('focus', onFocus); } }, 8000);
}

// ============================================================
// 6. IMAGE QUEUE & METADATA
// ============================================================
async function fetchMetadata(imgElement, game) {
    const cacheKey = 'cover_' + game.id;
    const storedCover = localStorage.getItem(cacheKey);

    // 1. In-memory path is already a local file — use it instantly
    if (game.image && game.image.startsWith('file://')) {
        imgElement.src = game.image; checkBackgroundAssets(game); return;
    }

    // 2. localStorage has a local file path
    if (storedCover && storedCover.startsWith('file://')) {
        imgElement.src = storedCover; game.image = storedCover; checkBackgroundAssets(game); return;
    }

    // 3. Check disk cache directly (handles reinstall where localStorage was wiped)
    if (window.electronAPI.getCachedImage) {
        try {
            const diskCover = await window.electronAPI.getCachedImage(game.id, 'cover');
            if (diskCover) {
                imgElement.src = diskCover;
                game.image = diskCover;
                localStorage.setItem(cacheKey, diskCover);
                const diskHero = await window.electronAPI.getCachedImage(game.id, 'hero');
                const diskLogo = await window.electronAPI.getCachedImage(game.id, 'logo');
                if (diskHero) { game.heroImage = diskHero; localStorage.setItem('hero_' + game.id, diskHero); }
                if (diskLogo) { game.logo = diskLogo;      localStorage.setItem('logo_' + game.id, diskLogo); }
                window.electronAPI.saveMetadata(game.id, { cover: diskCover, hero: diskHero, logo: diskLogo }).catch(() => {});
                return;
            }
        } catch { /* fall through */ }
    }

    // 4. Clear any stale remote URL from DB/memory so we do a clean API fetch
    //    (remote URLs can expire or be blocked by CORS in Electron)
    if (game.image && !game.image.startsWith('file://')) {
        game.image = null;
    }

    // 5. Fetch fresh metadata from SteamGridDB API
    imageQueue.push({ imgElement, game });
    processQueue();
}

async function processQueue() {
    if (activeRequests >= 3 || imageQueue.length === 0) return;
    activeRequests++;
    const { imgElement, game } = imageQueue.shift();

    try {
        const meta = await window.electronAPI.getMetadata(game.name);
        if (meta) {
            if (meta.hero) game.heroImage = meta.hero;
            if (meta.logo) game.logo = meta.logo;
            if (meta.cover) { game.image = meta.cover; imgElement.src = meta.cover; }

            if (window.electronAPI.cacheAllAssets) {
                window.electronAPI.cacheAllAssets({ cover: meta.cover, hero: meta.hero, logo: meta.logo }, game.id)
                    .then(localAssets => {
                        if (localAssets.cover) { game.image = localAssets.cover; localStorage.setItem('cover_' + game.id, localAssets.cover); }
                        if (localAssets.hero)  { game.heroImage = localAssets.hero;  localStorage.setItem('hero_' + game.id, localAssets.hero); }
                        if (localAssets.logo)  { game.logo = localAssets.logo;  localStorage.setItem('logo_' + game.id, localAssets.logo); }
                        window.electronAPI.saveMetadata(game.id, { cover: localAssets.cover, hero: localAssets.hero, logo: localAssets.logo });
                    })
                    .catch(() => {});
            }
        }
    } catch { } finally { activeRequests--; processQueue(); }
}

function checkBackgroundAssets(game) {
    const h = localStorage.getItem('hero_' + game.id);
    const l = localStorage.getItem('logo_' + game.id);
    if (h && h.startsWith('file://')) game.heroImage = h;
    if (l && l.startsWith('file://')) game.logo = l;
}


// ============================================================
// 8. SIDEBAR & COLLECTIONS
// ============================================================
function renderSidebar() {
    const l = document.getElementById('collectionsList');
    if (!l) return;
    l.innerHTML = '';

    const customCollections = allCollections.filter(c => c.id !== 'fav_system_default');

    const favItem = document.getElementById('nav-fav');
    if (favItem) {
        if (currentFilters.collectionId === 'fav_system_default') favItem.classList.add('active');
        else favItem.classList.remove('active');
    }

    customCollections.forEach(c => {
        const i = document.createElement('div');
        i.className = `nav-item ${String(currentFilters.collectionId) === String(c.id) ? 'active' : ''}`;

        const dotColor = c.image ? 'var(--accent)' : '#444';
        i.innerHTML = `
            <div class="nav-icon">
                <div style="width:8px; height:8px; border-radius:50%; background:${dotColor}; box-shadow: 0 0 8px ${dotColor}"></div>
            </div>
            <span class="nav-text">${c.name}</span>
            <span class="delete-btn" onclick="deleteColl(event,'${c.id}')">&#10005;</span>
        `;

        i.setAttribute('data-id', c.id);
        i.onclick = () => filterByCollection(c.id);
        l.appendChild(i);
    });
    updateSidebarActiveState();
}

function updateSidebarActiveState() {
    const h = document.getElementById('nav-home'); // Actually this got renamed or acts as logic
    const inst = document.getElementById('nav-installed');
    
    if (currentView === 'home' && h) h.classList.add('active');
    else if (h) h.classList.remove('active');

    if (currentView === 'installed' && inst) inst.classList.add('active');
    else if (inst) inst.classList.remove('active');

    const f = document.getElementById('nav-fav');
    if (currentFilters.collectionId === 'fav_system_default' && f) f.classList.add('active');
    else if (f) f.classList.remove('active');

    document.querySelectorAll('#collectionsList .nav-item').forEach(i => {
        if (i.getAttribute('data-id') === String(currentFilters.collectionId)) i.classList.add('active');
        else i.classList.remove('active');
    });
}

function toggleSidebar() {
    const s = document.getElementById('mainSidebar'), i = document.getElementById('toggleIcon');
    s.classList.toggle('collapsed');
    i.innerHTML = s.classList.contains('collapsed') ? '&#9654;' : '&#9664;';
}

function openCollectionModal() { document.getElementById('collName').value = ''; document.getElementById('collectionModal').classList.add('active'); }
function closeCollectionModal() { document.getElementById('collectionModal').classList.remove('active'); }

async function saveCollection() {
    const name = document.getElementById('collName').value.trim();
    if (!name) return showToast('Please enter a name', 'error');
    try {
        await window.electronAPI.createCollection(name, null);
        allCollections = await window.electronAPI.getCollections();
        renderSidebar(); closeCollectionModal(); showToast('Collection Created!', 'success');
    } catch (e) { showToast('Error', 'error'); }
}

function deleteColl(e, id) {
    e.stopPropagation();
    openConfirmModal(
        'Delete Collection?',
        'Delete this collection from your sidebar? Games will stay in your library.',
        'Delete',
        async () => {
            await window.electronAPI.deleteCollection(id);
            allCollections = await window.electronAPI.getCollections();
            if (currentFilters.collectionId === id) currentFilters.collectionId = null;
            renderSidebar();
            if (currentView === 'collection') navigateToInstalled();
        }
    );
}

// ============================================================
// 9. CONTEXT MENU & RECYCLE BIN
// ============================================================
function showContextMenu(x, y, id, name) {
    const m = document.getElementById('contextMenu');
    selectedGameId = id;
    m.setAttribute('data-current-name', name);

    const favColl = allCollections.find(c => c.id === 'fav_system_default');
    const isLiked = favColl && favColl.gameIds.includes(String(id));

    const favAction = isLiked
        ? `<div class="menu-item" onclick="toggleFavorite('${id}', false)"> Remove from Favorites</div>`
        : `<div class="menu-item" onclick="toggleFavorite('${id}', true)"> Add to Favorites</div>`;

    let o = '';
    allCollections.forEach(c => {
        if (c.id !== currentFilters.collectionId && c.id !== 'fav_system_default') {
            o += `<div class="dropdown-item" onclick="addToCollection('${c.id}')">${c.name}</div>`;
        }
    });
    if (o === '') o = `<div class="dropdown-item" style="color:#555;font-size:0.75rem;padding:8px 15px;">No other collections</div>`;

    let removeFromCollAction = '';
    if (currentFilters.collectionId !== null && currentFilters.collectionId !== 'fav_system_default') {
        removeFromCollAction = `<div class="menu-item delete" onclick="removeFromCurrentCollection('${id}')">Remove from Collection</div>`;
    }

    m.innerHTML = `
        <div class="menu-item" onclick="triggerPlay()">Play</div>
        ${favAction} <hr>
        <div class="menu-item" style="position:relative" onmouseenter="fixSubmenuPosition(this)">
            <span>Add to Collection <span class="submenu-icon">&#9654;</span></span>
            <div class="submenu">${o}</div>
        </div>
        ${removeFromCollAction}
        <div class="menu-item" onclick="openGameSettings('${id}')">Game Settings</div>
        <div class="menu-item delete" onclick="triggerRemove()">Remove from Library</div>
    `;

    m.style.display = 'block';
    const fx = x + 200 > window.innerWidth ? x - 200 : x;
    const fy = y + m.offsetHeight > window.innerHeight ? y - m.offsetHeight : y;
    m.style.left = `${fx}px`; m.style.top = `${fy}px`;
}

async function removeFromCurrentCollection(gameId) {
    hideContextMenu();
    if (!currentFilters.collectionId) return;
    try {
        const res = await window.electronAPI.removeGameFromCollection(currentFilters.collectionId, gameId);
        if (res.status === 'success') {
            allCollections = await window.electronAPI.getCollections();
            applyFilters();
            showToast('Removed from collection', 'success');
        } else {
            showToast('Failed to remove from collection', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Error removing from collection', 'error');
    }
}

function triggerPlay() { if (selectedGameId) triggerLaunchSequence(selectedGameId); hideContextMenu(); }

function triggerRemove() {
    hideContextMenu();
    openConfirmModal(
        'Move to Recycle Bin?',
        'Are you sure you want to remove this game from your library? It will be moved to the Recycle Bin.',
        'Move to Bin',
        async () => { await confirmDeleteAction(); }
    );
}

async function confirmDeleteAction() {
    try {
        const res = await window.electronAPI.removeGame(selectedGameId);
        if (res.status === 'success') {
            showToast('Game moved to bin!', 'success');
            allGamesData = allGamesData.filter(g => String(g.id) !== String(selectedGameId));
            allCollections = await window.electronAPI.getCollections();
            applyFilters(); 
            renderRecentlyPlayed();
            renderExploreCarousel();
            if (currentHeroGameId === String(selectedGameId)) {
                currentHeroGameId = null;
                applyFilters();
            }
        }
    } catch (err) { console.error(err); }
}

function hideContextMenu() { document.getElementById('contextMenu').style.display = 'none'; fixSubmenuPosition.reset(); }

async function addToCollection(collId) {
    hideContextMenu();
    await window.electronAPI.addGameToCollection(collId, selectedGameId);
    allCollections = await window.electronAPI.getCollections();
    renderSidebar();
    showToast('Added to collection', 'success');
}

async function toggleFavorite(gameId, shouldAdd) {
    hideContextMenu();
    if (shouldAdd) await window.electronAPI.addGameToCollection('fav_system_default', gameId);
    else await window.electronAPI.removeGameFromCollection('fav_system_default', gameId);
    allCollections = await window.electronAPI.getCollections();
    renderSidebar();
    if (currentFilters.collectionId === 'fav_system_default') applyFilters();
}

async function openRecycleBin() {
    document.getElementById('recycleModal').classList.add('active');
    const list = document.getElementById('recycleList');
    list.innerHTML = "<div style='padding:20px; color:#555; text-align:center;'>Loading...</div>";
    try {
        const hidden = await window.electronAPI.getHiddenGames();
        list.innerHTML = '';
        if (hidden.length === 0) {
            list.innerHTML = "<div style='padding:30px; color:#444; text-align:center;font-size:0.9rem;'>Recycle bin is empty.</div>";
            return;
        }
        hidden.forEach(g => {
            const div = document.createElement('div');
            div.className = 'bin-item';
            div.innerHTML = `
                <label class="custom-checkbox">
                    <input type="checkbox" value="${g.id}">
                    <span class="checkmark"></span>
                </label>
                <img src="${g.image || 'assets/logo.png'}" style="width:32px;height:32px;border-radius:6px;margin-right:12px;object-fit:cover; border: 1px solid #333;">
                <span style="flex-grow:1; color:#ddd; font-weight:500; font-size:0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 15px;">${g.name}</span>
                <button class="btn-danger" style="padding:6px 12px; font-size:0.75rem; flex-shrink:0;" onclick="hardDeleteGame('${g.id}')">Delete Forever</button>
            `;
            list.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

function closeRecycleBin() { document.getElementById('recycleModal').classList.remove('active'); }

async function restoreSelectedGames() {
    const checks = document.querySelectorAll('#recycleList input[type="checkbox"]:checked');
    const ids = Array.from(checks).map(c => c.value);
    if (ids.length === 0) return;
    await window.electronAPI.restoreSpecificGames(ids);
    closeRecycleBin();
    reloadLibrary();
}

function hardDeleteGame(id) {
    openConfirmModal(
        'Delete Forever?',
        'Permanently delete this game? Data and cached images cannot be recovered.',
        'Delete Forever',
        async () => {
            await window.electronAPI.deleteGamePermanently(id);
            openRecycleBin();
        }
    );
}



function closeGameSettings(){
     pendingImageChanges = {}; 
    document.getElementById('gameSettingsModal').classList.remove('active'); 
    selectedGameId = null;
}


function refreshAllViews() {
    applyFilters(); 
    renderRecentlyPlayed();
    renderExploreCarousel();
    if (currentHeroGameId && allGamesData.find(g => String(g.id) === currentHeroGameId)) updateHeroSection(currentHeroGameId);
}

// ============================================================
// 11. DRAG & DROP (SORTABLE)
// ============================================================
let sortableInstance = null;

function initSortable() {
    const grid = document.getElementById('gamesGrid');
    if (!grid) return;
    if (sortableInstance) sortableInstance.destroy();

    sortableInstance = new Sortable(grid, {
        animation: 400,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        draggable: '.game-card',
        swap: true,
        swapClass: 'highlight-swap',
        forceFallback: true,
        delay: 100,
        delayOnTouchOnly: true,
        onStart: () => { document.body.classList.add('is-dragging'); },
        onEnd: (evt) => {
            document.body.classList.remove('is-dragging');
            if (evt.oldIndex !== evt.newIndex) saveNewOrder();
        }
    });
}

async function saveNewOrder() {
    if (currentFilters.search !== '' || currentFilters.platform !== 'all' || currentFilters.sort !== 'manual') return;
    
    const cards = document.querySelectorAll('#gamesGrid .game-card');
    const newOrderIds = Array.from(cards).map(c => c.getAttribute('data-id'));
    
    if (currentFilters.collectionId !== null) {
        await window.electronAPI.reorderCollection(currentFilters.collectionId, newOrderIds);
        const coll = allCollections.find(c => String(c.id) === String(currentFilters.collectionId));
        if (coll) coll.gameIds = newOrderIds;
    } else {
        await window.electronAPI.reorderLibrary(newOrderIds);
        allGamesData.sort((a, b) => newOrderIds.indexOf(String(a.id)) - newOrderIds.indexOf(String(b.id)));
    }
}

// ============================================================
// COLLECTION SETTINGS MODAL
// ============================================================
function openCollectionSettings(id) {
    currentEditingCollectionId = id;
    const coll = allCollections.find(c => String(c.id) === String(id));
    if (!coll) return;

    const nameInput = document.getElementById('editCollNameInput');
    const deleteBtn = document.querySelector('#collectionSettingsModal .btn-danger');

    nameInput.value = coll.name || 'Favorites';
    document.getElementById('previewCollImage').src = coll.image || '../assets/app_icon.png';

    if (id === 'fav_system_default') {
        nameInput.disabled = true;
        nameInput.style.opacity = '0.5';
        if (deleteBtn) deleteBtn.style.display = 'none';
    } else {
        nameInput.disabled = false;
        nameInput.style.opacity = '1';
        if (deleteBtn) deleteBtn.style.display = 'block';
    }

    document.getElementById('collectionSettingsModal').classList.add('active');
}

function closeCollectionSettings() {
    document.getElementById('collectionSettingsModal').classList.remove('active');
    currentEditingCollectionId = null;
}

function triggerDeleteCollection() {
    if (!currentEditingCollectionId) return;
    openConfirmModal(
        'Delete Collection?',
        'Are you sure you want to delete this collection? Games inside will NOT be deleted from your library.',
        'Delete Collection',
        async () => {
            await window.electronAPI.deleteCollection(currentEditingCollectionId);
            allCollections = await window.electronAPI.getCollections();
            if (String(currentFilters.collectionId) === String(currentEditingCollectionId)) {
                currentFilters.collectionId = null;
            }
            renderSidebar();
            if (currentView === 'collection') navigateToInstalled();
            closeCollectionSettings();
            showToast('Collection deleted', 'success');
        }
    );
}

async function saveCollectionSettings() {
    if (!currentEditingCollectionId) return;
    const newName = document.getElementById('editCollNameInput').value.trim();
    if (!newName) return showToast('Name cannot be empty', 'error');
    try {
        await window.electronAPI.updateCollection(currentEditingCollectionId, newName, undefined);
        const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
        if (coll) coll.name = newName;
        showToast('Settings saved!', 'success');
        renderSidebar();
        applyFilters();
        closeCollectionSettings();
    } catch (e) {
        console.error(e);
        showToast('Error saving collection', 'error');
    }
}

async function changeCollectionImage() {
    if (!currentEditingCollectionId) return;
    try {
        const newPath = await window.electronAPI.selectImage();
        if (newPath) {
            const safePath = `file://${newPath.replace(/\\/g, '/')}`;
            await window.electronAPI.updateCollection(currentEditingCollectionId, undefined, safePath);
            document.getElementById('previewCollImage').src = safePath;
            document.getElementById('previewCollImage').style.display = 'block';
            const txt = document.getElementById('previewCollText');
            if (txt) txt.style.display = 'none';
            const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
            if (coll) coll.image = safePath;
            showToast('Custom image applied!', 'success');
            applyFilters();
        }
    } catch (e) { console.error(e); }
}

async function resetCollectionImage() {
    if (!currentEditingCollectionId) return;
    try {
        await window.electronAPI.updateCollection(currentEditingCollectionId, undefined, null);
        const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
        if (coll) coll.image = null;
        document.getElementById('previewCollImage').src = '';
        document.getElementById('previewCollImage').style.display = 'none';
        const txt = document.getElementById('previewCollText');
        if (txt) txt.style.display = 'flex';
        showToast('Slideshow restored!', 'success');
        applyFilters();
    } catch (e) { console.error(e); }
}

// ============================================================
// 12. SURPRISE ME (ROULETTE)
// ============================================================
let rouletteResultId = null;
let isSpinning = false;

function startRoulette() {
    window.electronAPI.logGameSpinClicked?.(customSpinIds.length > 0);
    if (isSpinning) return;

    // 🟢 التعديل السحري هنا: تحديد الـ Pool بناءً على اختيار اليوزر
    let pool = allGamesData.filter(g => !g.isHidden);
    if (customSpinIds.length > 0) {
        pool = pool.filter(g => customSpinIds.includes(String(g.id)));
    }

    if (pool.length === 0) { 
        showToast('No games in your spin pool! Add games or clear the custom pool.', 'error'); 
        return; 
    }

    isSpinning = true;
    const card = document.getElementById('rouletteCard');
    const img = document.getElementById('rouletteImg');
    const graphic = document.getElementById('rouletteGraphic');
    const nameTxt = document.getElementById('rouletteName');
    const spinBtn = document.getElementById('spinBtn');
    const playBtn = document.getElementById('playResultBtn');

    if (graphic) graphic.style.display = 'none';
    if (img) img.style.display = 'block';

    spinBtn.disabled = true;
    spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-anim"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Rolling...`;
    if (playBtn) playBtn.style.display = 'none';

    card.classList.remove('winner');
    card.classList.add('spinning');

    let spinsCount = 0;
    const maxSpins = 25;
    let speed = 40;

    function spinTick() {
        const randomGame = pool[Math.floor(Math.random() * pool.length)];
        const safeUrl = randomGame.image ? randomGame.image.replace(/\\/g, '/').replace(/'/g, "\\'") : '../assets/default_hero.jpg';
        img.src = safeUrl;
        nameTxt.innerText = randomGame.name;
        spinsCount++;

        if (spinsCount < maxSpins) {
            speed += Math.floor(spinsCount * 0.8);
            setTimeout(spinTick, speed);
        } else {
            const winner = pool[Math.floor(Math.random() * pool.length)];
            const winnerUrl = winner.image ? winner.image.replace(/\\/g, '/').replace(/'/g, "\\'") : '../assets/default_hero.jpg';
            img.src = winnerUrl;
            nameTxt.innerText = winner.name;
            rouletteResultId = winner.id;

            card.classList.remove('spinning');
            card.classList.add('winner');

            spinBtn.disabled = false;
            spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Spin Again`;
            if (playBtn) playBtn.style.display = 'flex';
            isSpinning = false;
        }
    }

    spinTick();
}

function openRoulettePool() {
    const list = document.getElementById('poolGamesList');
    list.innerHTML = '';
    document.getElementById('poolSearchInput').value = '';
    
    const availableGames = allGamesData.filter(g => !g.isHidden);
    if(availableGames.length === 0) return showToast('Your library is empty!', 'error');

    availableGames.forEach(g => {
        const isChecked = customSpinIds.includes(String(g.id)) ? 'checked' : '';
        const div = document.createElement('div');
        div.className = 'bin-item pool-item';
        div.setAttribute('data-name', g.name.toLowerCase());
        
        // استخدام نفس تصميم الـ checkbox بتاعك
        div.innerHTML = `
            <label class="custom-checkbox">
                <input type="checkbox" value="${g.id}" ${isChecked}>
                <span class="checkmark"></span>
            </label>
            <img src="${g.image || '../assets/default_hero.jpg'}" style="width:32px;height:32px;border-radius:6px;margin-right:12px;object-fit:cover; border: 1px solid #333;">
            <span style="flex-grow:1; color:#ddd; font-weight:500; font-size:0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${g.name}</span>
        `;
        list.appendChild(div);
    });

    document.getElementById('roulettePoolModal').classList.add('active');
}

function closeRoulettePool() {
    document.getElementById('roulettePoolModal').classList.remove('active');
}

function filterPoolList() {
    const term = document.getElementById('poolSearchInput').value.toLowerCase();
    document.querySelectorAll('.pool-item').forEach(item => {
        if (item.getAttribute('data-name').includes(term)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function saveRoulettePool() {
    const checks = document.querySelectorAll('#poolGamesList input[type="checkbox"]:checked');
    customSpinIds = Array.from(checks).map(c => c.value);
    closeRoulettePool();
    
    if (customSpinIds.length > 0) {
        showToast(`Custom pool saved! (${customSpinIds.length} games)`, 'success');
    } else {
        showToast('Custom pool cleared. Spinning from all games.', 'INFO');
    }
}

function clearRoulettePool() {
    document.querySelectorAll('#poolGamesList input[type="checkbox"]').forEach(c => c.checked = false);
    customSpinIds = [];
    closeRoulettePool();
    showToast('Custom pool cleared. Spinning from all games.', 'INFO');
}

function playRouletteResult() {
    if (rouletteResultId) triggerLaunchSequence(rouletteResultId);
}

// ============================================================
// UTILS & GLOBAL EVENTS
// ============================================================
function showToast(m, t) {
    const w = document.getElementById('toast-wrapper');
    const d = document.createElement('div');
    d.className = `toast-notification ${t === 'error' ? 'toast-error' : ''}`;
    d.innerHTML = `<span>${m}</span>`;
    w.appendChild(d);
    setTimeout(() => { d.style.animation = 'fadeOutUp 0.3s ease forwards'; setTimeout(() => d.remove(), 300); }, 3500);
}

function toggleDropdown(e) { if (e) e.stopPropagation(); document.getElementById('dropdownMenu').classList.toggle('active'); }

function fixSubmenuPosition(i) {
    const s = i.querySelector('.submenu');
    if (s) {
        const r = i.getBoundingClientRect();
        if (window.innerWidth - r.right < 200) { s.style.left = 'auto'; s.style.right = '100%'; s.style.borderRadius = '8px 0 8px 8px'; }
        else { s.style.left = '100%'; s.style.right = 'auto'; s.style.borderRadius = '0 8px 8px 8px'; }
    }
}

fixSubmenuPosition.reset = () => {
    document.querySelectorAll('.submenu').forEach(s => { s.style.left = '100%'; s.style.right = 'auto'; });
};

window.onclick = (e) => {
    if (!e.target.closest('#platformDropdown')) { const d = document.getElementById('dropdownMenu'); if (d) d.classList.remove('active'); }
    if (!e.target.closest('#playtimeDropdownContainer')) { const pm = document.getElementById('playtimeMenu'); if (pm) pm.classList.remove('active'); }
    if (!e.target.closest('#sortDropdown')) { const sm = document.getElementById('sortMenu'); if (sm) sm.classList.remove('active'); } // <- السطر الجديد
    if (!e.target.closest('#contextMenu')) hideContextMenu();
};

// ============================================================
// 13. SYSTEM STATS HUD (HIGHLY OPTIMIZED)
// ============================================================
let _prevNetBytes = { rx: 0, tx: 0, ts: 0 };
let _hudInterval = null;
let _isStatsInit = false;
let _isStatsBusy = false;

let isSensorEnabled = localStorage.getItem('baddel_sensors_enabled') !== 'false'; 

function checkAndManagePolling() {
    const isHomeView = (currentView === 'home');
    const hasFocus = document.hasFocus();
    const liveDot = document.getElementById('sysLiveDot');

    if (isSensorEnabled && hasFocus && isHomeView) {
        if (!_hudInterval) {
            _hudInterval = setInterval(_tickStats, 3000);
            _tickStats();
            if (liveDot) liveDot.style.opacity = '1';
        }
    } else {
        if (_hudInterval) {
            clearInterval(_hudInterval);
            _hudInterval = null;
            if (liveDot) liveDot.style.opacity = '0.3';
        }
    }
}

function toggleSensors() {
    isSensorEnabled = !isSensorEnabled;
    localStorage.setItem('baddel_sensors_enabled', isSensorEnabled);

    const btn = document.getElementById('sensorToggleBtn');
    const txt = document.getElementById('sensorToggleText');

    window.electronAPI.logHudSensorToggled?.(isSensorEnabled);

    if (isSensorEnabled) {
        if (btn) btn.classList.remove('off');
        if (txt) txt.innerText = 'SENSORS: ON';
        _tickStats(); 
    } else {
        if (btn) btn.classList.add('off');
        if (txt) txt.innerText = 'SENSORS: OFF';
        _resetStatsUI(); 
    }

    checkAndManagePolling();
}

function _resetStatsUI() {
    _setText('cpuPercent', '0%'); _setBar('cpuBar', 0); _setText('cpuTemp', 'N/A');
    _setText('gpuPercent', '0%'); _setBar('gpuBar', 0); _setText('gpuTemp', 'N/A');
    _setText('ramPercent', '0%'); _setBar('ramBar', 0); _setText('ramUsed', '0 GB');
    _setText('netDown', '0 KB/s'); _setText('netUp', '0 KB/s'); _setText('netPing', '0 ms');
}

async function initSystemStats() {
    if (_isStatsInit) return;
    _isStatsInit = true;
    await _loadStaticInfo();
    const btn = document.getElementById('sensorToggleBtn');
    const txt = document.getElementById('sensorToggleText');
    if (!isSensorEnabled && btn) {
        btn.classList.add('off');
        txt.innerText = 'SENSORS: OFF';
        _resetStatsUI();
    }

    checkAndManagePolling();
    window.addEventListener('focus', checkAndManagePolling);
    window.addEventListener('blur', checkAndManagePolling);
}


async function _loadStaticInfo() {
    try {
        const info = await window.electronAPI.getSystemInfo();
        _setText('osName', info.osName || '—');
        _setText('cpuModel', _shortName(info.cpuModel));
        _setText('cpuCores', `${info.cpuCores} Cores`);
        _setText('ramTotal', `${_fmtBytes(info.totalRam)} Total`);
        _setText('ramSpeed', info.ramSpeed || '—');
        _setText('ramKits', info.ramKitsStr ? `Kits: ${info.ramKitsStr}` : 'Kits: —');
        if (info.gpuModel && info.gpuModel !== '—') {
            _setText('gpuModel', _shortName(info.gpuModel));
            if (info.gpuVram > 0) _setText('gpuVram', `${_fmtBytes(info.gpuVram)} VRAM`);
        } else {
            _setText('gpuModel', 'Integrated');
        }
    } catch (e) { console.warn('Static info error:', e); }
}

async function _tickStats() {
    if (_isStatsBusy) return;
    _isStatsBusy = true;
    try {
        const stats = await window.electronAPI.getLiveStats();
        if (!stats || Object.keys(stats).length === 0) return;

        const cpuPct = stats.cpuLoad || 0;
        _setText('cpuPercent', `${cpuPct}%`);
        _setBar('cpuBar', cpuPct);
        _setText('cpuTemp', stats.cpuTemp ? `${stats.cpuTemp}°C` : 'N/A');

        const ramUsed = stats.usedRam || 0;
        const ramTotal = stats.totalRam || 1;
        const ramPct = Math.round((ramUsed / ramTotal) * 100);
        _setText('ramPercent', `${ramPct}%`);
        _setBar('ramBar', ramPct);
        _setText('ramUsed', _fmtBytes(ramUsed));

        const now = Date.now();
        const rx = stats.netRxBytes || 0;
        const tx = stats.netTxBytes || 0;
        const dt = _prevNetBytes.ts ? (now - _prevNetBytes.ts) / 1000 : 1;
        const down = _prevNetBytes.ts ? Math.max(0, (rx - _prevNetBytes.rx) / dt) : 0;
        const up = _prevNetBytes.ts ? Math.max(0, (tx - _prevNetBytes.tx) / dt) : 0;
        _prevNetBytes = { rx, tx, ts: now };

        _setText('netDown', _fmtSpeed(down));
        _setText('netUp', _fmtSpeed(up));
        _setText('netPing', `${stats.ping || 0} ms`);

        _setText('gpuPercent', `${stats.gpuLoad || 0}%`);
        _setBar('gpuBar', stats.gpuLoad || 0);
        _setText('gpuTemp', stats.gpuTemp ? `${stats.gpuTemp}°C` : '32°C');
    } catch (e) {
        console.error('Stats Tick Error:', e);
    } finally {
        _isStatsBusy = false;
    }
}

function _setText(id, val) { const el = document.getElementById(id); if (el && el.innerText !== val) el.innerText = val; }
function _setBar(id, pct) { const el = document.getElementById(id); if (el) el.style.width = `${Math.min(pct, 100)}%`; }
function _fmtBytes(b) {
    if (!b) return '0 GB';
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
    return '0 GB';
}
function _fmtSpeed(bps) {
    if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' MB/s';
    return (bps / 1e3).toFixed(0) + ' KB/s';
}
function _shortName(name) {
    if (!name) return '—';
    return name.replace(/Intel\(R\)|Core\(TM\)|CPU|NVIDIA GeForce|AMD Radeon/gi, '').replace(/\s+/g, ' ').trim();
}

document.addEventListener('DOMContentLoaded', () => setTimeout(initSystemStats, 1000));

// ============================================================
// CONFIRM MODAL
// ============================================================
let pendingConfirmAction = null;

function openConfirmModal(title, message, buttonText, callback) {
    document.getElementById('confirmTitle').innerHTML = `&#9888; ${title}`;
    document.getElementById('confirmMessage').innerText = message;
    document.getElementById('confirmBtn').innerText = buttonText;
    pendingConfirmAction = callback;
    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
    pendingConfirmAction = null;
}

async function executeConfirm() {
    if (pendingConfirmAction) {
        const btn = document.getElementById('confirmBtn');
        const originalText = btn.innerText;
        btn.innerText = 'Processing...';
        btn.disabled = true;
        btn.style.opacity = '0.7';
        await pendingConfirmAction();
        btn.innerText = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
    closeConfirmModal();
}

// ============================================================
// FOOTER PLAYTIME STATS
// ============================================================
let currentPlaytimeFormat = 0;
let currentPlaytimeFilterValue = 'all';

function cyclePlaytimeFormat() {
    currentPlaytimeFormat = (currentPlaytimeFormat + 1) % 5;
    updateFooterStats();
}

function togglePlaytimeDropdown(e) {
    if (e) e.stopPropagation();
    document.getElementById('playtimeMenu').classList.toggle('active');
}

function selectPlaytime(value, text) {
    document.getElementById('selectedPlaytimeText').innerText = text;
    currentPlaytimeFilterValue = value;
    document.getElementById('playtimeMenu').classList.remove('active');
    updateFooterStats();
}

function updateFooterStats() {
    const countEl = document.getElementById('gamesCount');
    if (countEl) countEl.innerText = `${allGamesData.length} Games Installed`;

    const filterType = currentPlaytimeFilterValue;
    let totalMins = 0;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const id in playtimeData) {
        const gameData = playtimeData[id];
        if (filterType === 'all') {
            totalMins += gameData.totalMinutes || 0;
        } else {
            const sessions = gameData.playSessions || [];
            sessions.forEach(session => {
                if (!session.date) return;
                const [year, month, day] = session.date.split('-');
                const sessionDate = new Date(year, month - 1, day);
                sessionDate.setHours(0, 0, 0, 0);
                const diffDays = Math.floor((now - sessionDate) / (1000 * 60 * 60 * 24));
                if (filterType === 'today' && diffDays === 0) totalMins += session.minutes;
                else if (filterType === 'week' && diffDays <= 7 && diffDays >= 0) totalMins += session.minutes;
                else if (filterType === 'month' && diffDays <= 30 && diffDays >= 0) totalMins += session.minutes;
                else if (filterType === 'year' && diffDays <= 365 && diffDays >= 0) totalMins += session.minutes;
            });
        }
    }

    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    const timeStr = totalMins > 0 ? `${hours}h ${mins}m` : '0h 0m';

    const timeEl = document.getElementById('totalLifePlaytime');
    if (timeEl) timeEl.innerText = timeStr;
}

// ============================================================
// HELP & FEEDBACK
// ============================================================
function openHelpModal() { document.getElementById('helpModal').classList.add('active'); }
function closeHelpModal() { document.getElementById('helpModal').classList.remove('active'); }

function switchHelpTab(tab) {
    document.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.help-content').forEach(c => c.classList.remove('active'));
    if (tab === 'guide') {
        document.querySelectorAll('.help-tab')[0].classList.add('active');
        document.getElementById('tabGuide').classList.add('active');
    } else {
        document.querySelectorAll('.help-tab')[1].classList.add('active');
        document.getElementById('tabFeedback').classList.add('active');
    }
}

async function sendFeedback() {
    const msg = document.getElementById('feedbackMessage').value.trim();
    const name = document.getElementById('feedbackName').value.trim() || 'Gamer';
    if (!msg) return showToast('Please write a message first!', 'error');

    const btn = document.querySelector('#tabFeedback .btn-primary');
    const originalText = btn.innerText;
    btn.innerText = 'Sending...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        const response = await fetch('https://formspree.io/f/xnjoqlyo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Name: name, Message: msg, App: 'Baddel Launcher Feedback' })
        });

        if (response.ok) {
            showToast('Feedback sent successfully! Thank you.', 'success');
            window.electronAPI.logFeedbackSent?.();
            document.getElementById('feedbackMessage').value = '';
            closeHelpModal();
        } else {
            throw new Error('Failed to send');
        }
    } catch (error) {
        console.error(error);
        showToast('Error sending feedback. Check your internet.', 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

if (window.electronAPI.onUpdateAvailable) {
    window.electronAPI.onUpdateAvailable((version) => {
        const msg = document.getElementById('updateMessage');
        if (msg) msg.innerText = `Version ${version} of Baddel Launcher is ready. Restart to apply?`;
        document.getElementById('updateModal').classList.add('active');
    });
}

function closeUpdateModal() {
    document.getElementById('updateModal').classList.remove('active');
}

function installUpdate() {
    const btn = document.querySelector('#updateModal .btn-primary');
    btn.innerText = 'Restarting...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
    window.electronAPI.sendRestartUpdate();
}

// ============================================================
// SETTINGS MODAL & LOGIC
// ============================================================

async function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    const toggle = document.getElementById('analyticsToggle');

    // أول ما يفتح، نسأل الـ Back-end: هو اليوزر موافق ولا لأ؟
    if (window.electronAPI && window.electronAPI.isAnalyticsEnabled) {
        const isEnabled = await window.electronAPI.isAnalyticsEnabled();
        toggle.checked = isEnabled; // نظبط الزرار على حالته الحقيقية
    }

    modal.classList.add('active'); 
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

async function toggleAnalytics(checkbox) {
    const isEnabled = checkbox.checked;
    try {
        if (isEnabled) {
            // لو فتحه، نبعت للـ Back-end يكريت ملف الـ txt
            await window.electronAPI.grantAnalyticsConsent();
            localStorage.setItem('baddel_analytics_consent_shown', 'true');
            showToast('Analytics enabled. Thank you!', 'success');
        } else {
            // لو قفله، نبعت للـ Back-end يمسح ملف الـ txt
            await window.electronAPI.revokeAnalyticsConsent();
            localStorage.setItem('baddel_analytics_consent_shown', 'true');
            showToast('Analytics disabled.', 'success');
        }
    } catch (err) {
        console.error(err);
        // لو حصل إيرور نرجع الزرار زي ما كان
        checkbox.checked = !isEnabled; 
        showToast('Error saving setting.', 'error');
    }
}

