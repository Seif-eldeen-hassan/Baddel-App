// ============================================================
// BADDEL LAUNCHER - GAME DETAILS PAGE (game-details.js)
// ============================================================
// كيفية الاستخدام:
//   openGameDetails(gameId)  ← من أي مكان في app.js
//   closeGameDetails()       ← زرار الـ Back
// ============================================================

// ──────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────
let _gdCurrentGameId   = null;
let _gdCurrentMeta     = null;
let _gdCurrentGame     = null;
let _gdDownloadInterval = null;   // للـ demo download progress
let _gdPreviousView    = 'home';  // عشان نعرف نرجع لأنهي شاشة
let _gdLightboxImages = [];
let _gdLightboxIndex  = 0;

// Platform logos config (نفس اللي في app.js)
const GD_PLATFORM_LOGOS = {
    steam:   { img: '../assets/Steam.png',    name: 'Steam',        color: '#1b2838' },
    epic:    { img: '../assets/epic.svg',      name: 'Epic Games',   color: '#181818', invert: true },
    ea:      { img: '../assets/ea.png',        name: 'EA App',       color: '#ff6b35' },
    riot:    { img: '../assets/riot.png',      name: 'Riot Games',   color: '#ff4655' },
    ubisoft: { img: '../assets/ubisoft.png',   name: 'Ubisoft',      color: '#0070d1', invert: true },
    discord: { img: '../assets/discord.webp',  name: 'Discord',      color: '#5865F2' },
    rockstar:{ img: '../assets/rockstar.png',  name: 'Rockstar',     color: '#1a1100' },
};

// ──────────────────────────────────────────
//  ENTRY POINT
// ──────────────────────────────────────────
/**
 * openGameDetails(gameId)
 * يفتح صفحة تفاصيل اللعبة - استدعيها من createGameCard أو أي مكان تاني
 */
window.openGameDetails = async function(gameId) {
    console.log("🚀 openGameDetails started! ID received:", gameId); // 4️⃣ نتأكد إن الدالة اشتغلت
    _gdCurrentGameId = String(gameId);

    // نعرف إحنا كنا فاتحين شاشة إيه قبل ما نفتح التفاصيل
    const allGamesView = document.getElementById('allGamesView');
    if (allGamesView && allGamesView.style.display !== 'none') {
        _gdPreviousView = 'allGames';
    } else {
        _gdPreviousView = 'home';
    }

    let game = (typeof allGamesData !== 'undefined')
        ? allGamesData.find(g => String(g.id) === _gdCurrentGameId)
        : null;

    console.log("🕵️ Found in allGamesData?", !!game); // 5️⃣ هل لقاها في الداتا العادية؟

    if (!game && window._allGamesCache) {
        console.log("🕵️ Searching in _allGamesCache..."); 
        
        // غيرنا اسم المتغير لـ cachedGame عشان يكون أدق
        const cachedGame = window._allGamesCache.find(g => String(g.id || g.appName || g.title) === _gdCurrentGameId);
        
        if (cachedGame) {
            game = {
                id: _gdCurrentGameId,
                name: cachedGame.title, 
                image: cachedGame.coverUrl, 
                
                // 🟢 التعديل الأهم: سحب مصفوفة المنصات والـ IDs
                platforms: cachedGame.platforms || [cachedGame.platform],
                allIds: cachedGame.allIds || { [cachedGame.platform]: cachedGame.id },
                platform: cachedGame.platforms ? cachedGame.platforms.join(', ') : cachedGame.platform,
                
                path: null, 
                command: null,
                appName: cachedGame.appName,
                namespace: cachedGame.namespace,
                catalogItemId: cachedGame.catalogItemId
            };
        } else {
            console.log("❌ Not found in cache either!");
        }
    }

    if (!game) { console.warn('GD: game not found', gameId); return; }
    try {
        // بنجيب الألعاب المتسطبة من قاعدة البيانات المحلية
        const installedGames = await window.electronAPI.getGames();
        const gameNameLower = (game.name || '').toLowerCase().trim();
        const epicId = `epic-${game.appName || game.id}`.toLowerCase();

        const installedMatch = installedGames.find(g => {
            const gIdLower = String(g.id).toLowerCase();
            const gNameLower = (g.name || '').toLowerCase().trim();
            // بندور بتطابق الـ ID أو اسم اللعبة
            return gIdLower === String(game.id).toLowerCase() || 
                   gIdLower === epicId ||
                   gNameLower === gameNameLower;
        });

        if (installedMatch && (installedMatch.path || installedMatch.command)) {
            console.log("🎯 Game is actually INSTALLED!", installedMatch.name);
            // ننقل مسار التشغيل للعبة عشان الزرار يقلب PLAY
            game.path = installedMatch.path;
            game.command = installedMatch.command;
            game.platform = installedMatch.platform || game.platform;
            // نحتفظ بالـ ID الحقيقي للنسخة المتسطبة عشان نستخدمه وقت التشغيل
            game.installedId = installedMatch.id; 
        }
    } catch (e) {
        console.warn('GD: Could not verify installation status', e);
    }
    _gdCurrentGame = game;
    
    console.log("🎉 Opening view for:", game.name); // 9️⃣ تأكيد نهائي قبل ما يفتح الشاشة
    
    // إخفاء كل الـ views الحالية
    if (typeof _hideAllViews === 'function') _hideAllViews();

    const view = document.getElementById('gameDetailsView');
    view.style.display = 'block';
    view.scrollTop = 0;

    // ... (باقي الكود زي ما هو من غير تغيير)

    // إعادة ضبط حالة الـ UI
    _gdResetUI();

    // ملأ البيانات الأساسية فوراً (بدون انتظار الـ API)
    _gdPopulateBasic(game);

    // جيب الـ metadata من الـ API
    try {
        const meta = await window.electronAPI.getMetadata(game.name, {
            id: game.id,
            platform: game.platform,
            platforms: game.platforms,
            command: game.command,
            path: game.path,
            allIds: game.allIds,
        });
        console.log(`[Metadata][GameDetails] ${game.name} -> source: ${meta?.source || 'unknown'}`, meta?.debug || {});
        _gdCurrentMeta = meta;
        _gdPopulateMeta(game, meta);
    } catch (e) {
        console.warn('GD: metadata fetch failed', e);
        _gdPopulateMeta(game, null);
    }

    // ملأ تاب الأكاونتات
    _gdPopulateAccounts(game);
};

/**
 * closeGameDetails()
 * زرار الـ Back
 */
window.closeGameDetails = function() {
    const view = document.getElementById('gameDetailsView');
    view.style.display = 'none';
    _gdCurrentGameId = null;
    _gdCurrentMeta   = null;
    _gdCurrentGame   = null;
    clearInterval(_gdDownloadInterval);

    // 🟢 نرجع للشاشة الصح اللي كنا فيها
    if (_gdPreviousView === 'allGames') {
        if (typeof navigateToAllGames === 'function') navigateToAllGames();
    } else {
        if (typeof navigateToHome === 'function') navigateToHome();
    }
};

// ──────────────────────────────────────────
//  RESET
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  RESET
// ──────────────────────────────────────────
function _gdResetUI() {
    // Reset tabs
    document.querySelectorAll('.gd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.gd-tab-content').forEach(t => { t.style.display = 'none'; t.classList.remove('active'); });
    const firstTab = document.querySelector('.gd-tab[data-tab="overview"]');
    if (firstTab) { firstTab.classList.add('active'); }
    const firstContent = document.getElementById('gdTab-overview');
    if (firstContent) { firstContent.style.display = 'block'; firstContent.classList.add('active'); }

    // Reset download block
    document.getElementById('gdDownloadBlock').style.display = 'none';
    document.getElementById('gdPlayBtn').style.display = 'flex';
    clearInterval(_gdDownloadInterval);

    // Reset screenshots
    document.getElementById('gdScreenshots').innerHTML = '<div class="gd-no-media">Loading media…</div>';

    // Reset accounts
    document.getElementById('gdAccountsList').innerHTML = '<div class="gd-no-accounts">Loading accounts…</div>';

    // Reset cover
    const coverImg = document.getElementById('gdCover');
    coverImg.style.display = 'none';
    coverImg.src = '';
    document.getElementById('gdCoverPlaceholder').style.display = 'flex';

    // Reset rating
    document.getElementById('gdRatingBlock').style.display = 'none';

    // 🚀 التعديل هنا: وضع Skeletons كـ placeholders في الأماكن اللي بتحمل
    
    // 1. Info Grid Skeleton
    const gridItems = Array(6).fill().map(() => `
        <div class="gd-info-item">
            <div class="gd-info-label"><div class="gd-skeleton" style="height:10px; width:40%; margin-bottom:0;"></div></div>
            <div class="gd-info-value"><div class="gd-skeleton" style="height:14px; width:80%; margin-top:4px;"></div></div>
        </div>
    `).join('');
    document.getElementById('gdInfoGrid').innerHTML = gridItems;

    // 2. Sidebar Details Skeleton
    const sidebarItems = Array(5).fill().map(() => `
        <div class="gd-detail-row">
            <span class="gd-detail-label"><div class="gd-skeleton" style="height:10px; width:60px; display:inline-block; margin:0;"></div></span>
            <span class="gd-detail-value"><div class="gd-skeleton" style="height:12px; width:80px; display:inline-block; margin:0;"></div></span>
        </div>
    `).join('');
    document.getElementById('gdDetailList').innerHTML = sidebarItems;

    document.getElementById('gdPlatformsRow').innerHTML = '';

    // Hide sections
    document.getElementById('gdTrailerSection').style.display = 'none';
    document.getElementById('gdGenresSection').style.display  = 'none';

    // 3. Description Skeleton (موجودة أصلاً بس بنأكد عليها)
    document.getElementById('gdDesc').innerHTML = `
        <div class="gd-skeleton" style="height:14px;margin-bottom:8px;width:90%"></div>
        <div class="gd-skeleton" style="height:14px;margin-bottom:8px;width:95%"></div>
        <div class="gd-skeleton" style="height:14px;margin-bottom:8px;width:80%"></div>
        <div class="gd-skeleton" style="height:14px;width:70%"></div>
    `;
}

// ──────────────────────────────────────────
//  BASIC DATA (no API needed)
// ──────────────────────────────────────────
function _gdPopulateBasic(game) {
    // Breadcrumb + title
    document.getElementById('gdBreadcrumbName').textContent = game.name;
    document.getElementById('gdTitle').textContent = game.name;
    document.getElementById('gdTitle').style.display = 'block';
    document.getElementById('gdLogo').style.display  = 'none';

    // Logo
    if (game.logo) {
        const logoEl = document.getElementById('gdLogo');
        logoEl.src = game.logo;
        logoEl.style.display = 'block';
        document.getElementById('gdTitle').style.display = 'none';
    }

    // Hero background
    // Hero background
    const heroBg = document.getElementById('gdHeroBg');
    const heroSrc = game.heroImage || ''; // ✅ شلنا الـ game.image خالص
    if (heroSrc) {
        heroBg.style.backgroundImage = `url('${heroSrc.replace(/\\/g, '/')}')`;
    } else {
        // لو مفيش بانر، اعرض الخلفية الغامقة الشيك لحد ما الداتا تحمل
        heroBg.style.backgroundImage = 'linear-gradient(135deg, #0f0f18, #1a1a28)';
    }

    // Cover art
    if (game.image) {
        const coverImg = document.getElementById('gdCover');
        coverImg.src = game.image;
        // onload handler يتشغل أوتوماتيك
    }

    // Cover initials
    document.getElementById('gdCoverInitials').textContent =
        game.name ? game.name.substring(0, 2).toUpperCase() : '??';

    // Playtime stats
    const pData = (typeof playtimeData !== 'undefined' && playtimeData[game.id])
        ? playtimeData[game.id]
        : { totalMinutes: 0, lastPlayed: null };

    document.getElementById('gdPlaytime').textContent  =
        (typeof formatPlaytime === 'function') ? formatPlaytime(pData.totalMinutes) : `${Math.floor((pData.totalMinutes||0)/60)}h`;
    document.getElementById('gdLastPlayed').textContent =
        (typeof formatLastPlayed === 'function') ? formatLastPlayed(pData.lastPlayed) : 'Never';

    // Platform badges
    _gdRenderPlatformBadges(game);

    // Play / Install button state
    _gdSetActionButton(game);

    // Basic details sidebar
    _gdBuildDetailList(game, null);
}

// ──────────────────────────────────────────
//  PLATFORM BADGES
// ──────────────────────────────────────────
function _gdRenderPlatformBadges(game) {
    const row = document.getElementById('gdPlatformsRow');
    row.innerHTML = '';

    const platforms = _gdDetectPlatforms(game);
    platforms.forEach(platKey => {
        const cfg = GD_PLATFORM_LOGOS[platKey];
        if (!cfg) return;
        const badge = document.createElement('div');
        badge.className = 'gd-plat-badge';
        const platFilters = {
            steam:    'none',
            epic:     'invert(1)',
            ea:       'none',
            riot:     'none',
            ubisoft:  'invert(1)',
            discord:  'none',
            rockstar: 'none',
        };
        badge.innerHTML = `
            <img src="${cfg.img}" alt="${cfg.name}"
                 style="width:18px;height:18px;object-fit:contain;flex-shrink:0;display:block;filter:${platFilters[platKey] || 'none'};">
            <span>${cfg.name}</span>
        `;
        row.appendChild(badge);
    });
}

function _gdDetectPlatforms(game) {
    const platforms = new Set();
    
    // 🟢 لو الداتا جاية مدمجة وفيها مصفوفة platforms
    if (game.platforms && Array.isArray(game.platforms)) {
        game.platforms.forEach(p => platforms.add(p.toLowerCase()));
    } else {
        // Fallback: الطريقة القديمة لو اللعبة جاية من حتة تانية
        const src = ((game.platform || '') + (game.command || '') + (game.path || '')).toLowerCase();
        if (src.includes('steam'))    platforms.add('steam');
        if (src.includes('epic'))     platforms.add('epic');
        if (src.includes('ea') || src.includes('origin')) platforms.add('ea');
        if (src.includes('riot'))     platforms.add('riot');
        if (src.includes('ubisoft'))  platforms.add('ubisoft');
        if (src.includes('rockstar')) platforms.add('rockstar');
    }
    
    if (platforms.size === 0) platforms.add('steam'); // fallback
    return [...platforms];
}

// ──────────────────────────────────────────
//  ACTION BUTTON (Play / Install)
// ──────────────────────────────────────────
function _gdSetActionButton(game) {
    const btn = document.getElementById('gdPlayBtn');
    const label = document.getElementById('gdPlayBtnLabel');
    const playIcon = btn.querySelector('.gd-play-icon'); // 🟢 بنمسك أيقونة اللعب من هنا

    const isInstalled = !!(game.path || game.command);

    if (isInstalled) {
        // حالة اللعب
        btn.classList.remove('install-mode');
        label.textContent = 'PLAY';
        btn.title = 'Launch game';
        if (playIcon) playIcon.style.display = 'inline-block'; // 🟢 إظهار أيقونة البلاي
    } else {
        // حالة التحميل
        btn.classList.add('install-mode');
        label.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>INSTALL`;
        btn.title = 'Install game';
        if (playIcon) playIcon.style.display = 'none'; // 🟢 إخفاء أيقونة البلاي عشان متظهرش مع أيقونة التحميل
    }
}

// ──────────────────────────────────────────
//  ACTION BUTTON (Play / Install)
// ──────────────────────────────────────────
window.gdHandleMainAction = async function() {
    if (!_gdCurrentGame) {
        if (typeof showToast === 'function') showToast("No game selected!", "error");
        return;
    }

    // بنعرف هي متسطبة ولا لأ من وجود path أو command
    const isInstalled = !!(_gdCurrentGame.path || _gdCurrentGame.command);

    if (isInstalled) {
        // 🎮 حالة الـ PLAY
        console.log("🚀 Opening Play Launcher for:", _gdCurrentGame.name);

        // 🟢 نستخدم الـ ID بتاع النسخة المتسطبة (لو موجود) عشان يتشغل صح بدون مشاكل
        const gameToLaunch = { ..._gdCurrentGame };
        if (gameToLaunch.installedId) {
            gameToLaunch.id = gameToLaunch.installedId;
        }

        if (typeof window.openPlayLauncher === 'function') {
            window.openPlayLauncher(gameToLaunch);
        } else {
            // Fallback
            if (typeof triggerLaunchSequence === 'function') {
                triggerLaunchSequence(gameToLaunch.id);
            } else if (window.electronAPI && window.electronAPI.launchGame) {
                window.electronAPI.launchGame(gameToLaunch.command, gameToLaunch.id, gameToLaunch.path, gameToLaunch.name);
            }
        }

    } else {
        // ⬇️ حالة الـ INSTALL
        console.log("📥 Install picker for:", _gdCurrentGame.name);
    if (!document.getElementById('pl-badge-unknown-style')) {
        const st = document.createElement('style');
        st.id = 'pl-badge-unknown-style';
        st.textContent = `
            .pl-badge-unknown {
                background: rgba(255,255,255,0.06);
                color: rgba(255,255,255,0.45);
                border: 1px solid rgba(255,255,255,0.12);
                font-size: 10px;
                padding: 2px 7px;
                border-radius: 10px;
                white-space: nowrap;
                cursor: help;
            }
        `;
        document.head.appendChild(st);
    }
        _gdOpenInstallPicker(_gdCurrentGame);
    }
};

// ──────────────────────────────────────────
//  INSTALL PICKER MODAL
// ──────────────────────────────────────────

let _gdInstallSelectedAccountUsername = null;
let _gdInstallSelectedAccountName = null;

async function _gdOpenInstallPicker(game) {
    document.getElementById('gdInstallerModal')?.remove();

    // 1. كشف المنصات المتاحة للعبة (ستيم وإيبك فقط للتحميل حالياً)
    const detectedPlats = _gdDetectPlatforms(game).filter(p => p === 'epic' || p === 'steam');

    if (detectedPlats.length === 0) {
        _gdSimulateDownload();
        return;
    }

    // 2. اختيار أول منصة كافتراضي
    _gdInstallSelectedPlatform = detectedPlats[0];
    _gdInstallSelectedAccountId = null;

    const coverHtml = game.image ? `<img class="pl-game-cover" src="${game.image}" alt="${game.name}">` : '';
    const heroBg = game.heroImage || game.image || '';

    // 3. بناء صف المنصات لو اللعبة متوفرة في أكتر من منصة
    let platformsHtml = '';
    if (detectedPlats.length > 1) {
        platformsHtml = `
            <div class="pl-section">
                <div class="pl-section-header">
                    <div class="pl-step-badge">1</div>
                    <span class="pl-section-title">CHOOSE PLATFORM</span>
                </div>
                <div class="pl-platforms-row" id="gdInstPlatformsRow">
                    ${detectedPlats.map(p => _gdBuildInstallPlatformCard(p, _gdInstallSelectedPlatform)).join('')}
                </div>
            </div>
            <div class="pl-divider"></div>
        `;
    }

    const modal = document.createElement('div');
    modal.id        = 'gdInstallerModal';
    modal.className = 'pl-backdrop';
    modal.innerHTML = `
        <div class="pl-modal" id="gdInstallModalInner">
            <div class="pl-hero" style="background-image:url('${heroBg.replace(/\\/g, '/')}')">
                <div class="pl-hero-overlay"></div>
                <div class="pl-hero-content">
                    ${coverHtml}
                    <div class="pl-game-info">
                        <div class="pl-game-label">INSTALLATION</div>
                        <h2 class="pl-game-name">${game.name}</h2>
                    </div>
                </div>
                <button class="pl-close-btn" onclick="document.getElementById('gdInstallerModal')?.remove()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            
            <div class="pl-body">
                ${platformsHtml}
                <div class="pl-section">
                    <div class="pl-section-header">
                        <div class="pl-step-badge">${detectedPlats.length > 1 ? '2' : '1'}</div>
                        <span class="pl-section-title">CHOOSE ACCOUNT</span>
                    </div>
                    <div class="pl-accounts-list" id="gdInstallAccountsList">
                        <div class="pl-accounts-loading"><div class="pl-spinner"></div><span>Loading accounts…</span></div>
                    </div>
                </div>
            </div>

            <div class="pl-footer">
                <button class="pl-btn-cancel" onclick="document.getElementById('gdInstallerModal')?.remove()">Cancel</button>
                <button class="pl-btn-launch" id="gdInstallConfirmBtn" onclick="gdInstallConfirm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Install
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    requestAnimationFrame(() => {
        modal.classList.add('visible');
        document.getElementById('gdInstallModalInner')?.classList.add('visible');
    });

    // 4. تحميل الحسابات الخاصة بالمنصة الافتراضية
    await gdInstallLoadAccounts(_gdInstallSelectedPlatform);
}


// ──────────────────────────────────────────
//  INSTALL CONFIRM & ACCOUNT SELECT (CLEANED)
// ──────────────────────────────────────────
function _gdBuildInstallPlatformCard(platKey, selected) {
    const cfg = GD_PLATFORM_LOGOS[platKey];
    if (!cfg) return '';
    const isSelected = platKey === selected;
    const accent = platKey === 'steam' ? '#66c0f4' : '#ffffff';
    return `
        <div class="pl-platform-card ${isSelected ? 'selected' : ''}"
             id="gdInstPlat-${platKey}" data-plat="${platKey}"
             onclick="gdInstallSelectPlatform('${platKey}')"
             style="--plat-color:${cfg.color};--plat-accent:${accent}">
            <div class="pl-platform-icon-wrap">
                <img src="${cfg.img}" alt="${cfg.name}" ${cfg.invert ? 'style="filter:invert(1)"' : ''}>
            </div>
            <span class="pl-platform-name">${cfg.name}</span>
        </div>`;
}

window.gdInstallSelectPlatform = async function(platKey) {
    if (_gdInstallSelectedPlatform === platKey) return;
    _gdInstallSelectedPlatform = platKey;
    
    document.querySelectorAll('#gdInstPlatformsRow .pl-platform-card').forEach(c => c.classList.remove('selected'));
    document.getElementById(`gdInstPlat-${platKey}`)?.classList.add('selected');
    
    await gdInstallLoadAccounts(platKey);
};

window.gdInstallLoadAccounts = async function(platKey) {
    const list = document.getElementById('gdInstallAccountsList');
    if (!list) return;

    // 1. تأثير اختفاء ناعم قبل التحميل
    list.style.opacity = '0';
    await new Promise(r => setTimeout(r, 150)); 

    list.innerHTML = `<div class="pl-accounts-loading"><div class="pl-spinner"></div><span>Loading accounts…</span></div>`;
    list.style.opacity = '1'; 

    const game = _gdCurrentGame;
    let accounts = [];
    let syncedLibrary = [];
    let syncAccounts = [];

    // 2. جلب الحسابات العادية من السويتشر حسب المنصة
    if (platKey === 'epic') {
        try {
            const res = await window.electronAPI.getEpicProfiles?.() || [];
            accounts = res.map(p => {
                const accObj = typeof p === 'string' 
                    ? { id: p, displayName: p, username: p } 
                    : { 
                        ...p, 
                        id: p.id || p.name, 
                        displayName: p.displayName || p.discordUsername || p.name, 
                        username: p.username || p.name,
                        avatar: p.avatar || p.avatarUrl || p.picture || null,
                        platformAccountId: p.platformAccountId || p.id || null,
                        _resolvedSyncId: p._resolvedSyncId || null
                    };
                return { ...accObj, platformType: 'epic', platformLabel: 'Epic Games' };
            });
        } catch (e) {}
    } else if (platKey === 'steam') {
        try {
            const res = await window.electronAPI.getSteamAccounts?.() || [];
            if (window.electronAPI.getSteamImage) {
                await Promise.all(res.map(async (acc) => {
                    try { acc.avatar = await window.electronAPI.getSteamImage(acc.steamId || acc.id); } catch(e) {}
                }));
            }
            accounts = res.map(a => ({
                id: a.steamId || a.id || a.username, 
                displayName: a.displayName || a.username || 'Unknown',
                username: a.username,
                avatar: a.avatar || a.avatarUrl || null,
                platformAccountId: a.platformAccountId || a.steamId || null,
                _resolvedSyncId: a._resolvedSyncId || a.steamId || null,
                platformType: 'steam',
                platformLabel: 'Steam'
            }));
        } catch (e) {}
    }

    // 🟢 3. جلب بيانات المزامنة بشكل عام لأي منصة (Epic, Steam, الخ...)
    // 🟢 3. جلب بيانات المزامنة بشكل عام لأي منصة (Epic, Steam, الخ...)
    if (window.electronAPI.platformSyncGetAccounts && window.electronAPI.platformSyncGetCached) {
        try {
            const [accRes, libRes] = await Promise.all([
                window.electronAPI.platformSyncGetAccounts(platKey),
                window.electronAPI.platformSyncGetCached(platKey)
            ]);
            syncAccounts = accRes?.accounts || [];
            syncedLibrary = libRes?.games || [];
        } catch (e) {}
    }


    // 👇 ضيف كود الـ Debugging هنا 👇
    if (platKey === 'steam') {
        const _nd = s => (s||'').toLowerCase().replace(/[®©™]/g,'').replace(/[:\-'']/g,' ').replace(/\s+/g,' ').trim();
        const _ca = (()=>{ const m=(game.command||game.id||'').match(/(\d{5,})/); return m?m[1]:null; })();
        console.log("=== 📥 STEAM INSTALL ACCOUNTS DEBUG ===");
        console.log("1. Switcher Profiles:", accounts.map(a=>({id:a.id, _resolvedSyncId:a._resolvedSyncId, platformAccountId:a.platformAccountId, steamId:a.steamId, username:a.username})));
        console.log("2. Synced Accounts:", syncAccounts.map(sa=>({id:sa.id, displayName:sa.displayName})));
        console.log("3. Library count:", syncedLibrary.length);
        console.log("4. game.name:", game.name, "| norm:", _nd(game.name), "| extractedAppId:", _ca);
        const _bl2 = syncedLibrary.find(g=>_nd(g.title)===_nd(game.name)||String(g.appName)===_ca);
        console.log("5. Direct lib search result:", _bl2 ? {title:_bl2.title,appName:_bl2.appName,owners:_bl2.ownedByAccountIds} : 'NOT FOUND');
        syncedLibrary.slice(0,3).forEach(g=>console.log('  sample:',g.title,'| norm:',_nd(g.title),'| appName:',g.appName,'| owners:',g.ownedByAccountIds?.map(String)));
        console.log("=======================================");
    }
    // 👆 끝 👆

    const gameNameLower = (game.name || '').toLowerCase().trim();

    // 🟢 4. فحص الملكية والمطابقة يطبق الآن على كل المنصات وليس Epic فقط
    const finalAccounts = accounts.map(acc => {
        let isOwned = false;
        let ownershipStatus = 'unknown';

        if (syncedLibrary.length > 0) {
            // ✅ جمع كل candidate IDs من الأكونت (لأي بيكون هو الـ steamId)
            const candidateIds = [
                acc._resolvedSyncId,
                acc.platformAccountId,
                acc.steamId,
                acc.id,
            ].filter(v => v && String(v).trim().length >= 4).map(String);

            // ✅ syncAccount لتحديث الاسم والصورة فقط
            const syncAccount = syncAccounts.find(sa => {
                if (candidateIds.includes(String(sa.id))) return true;
                const saName = (sa.displayName || '').toLowerCase().trim();
                return saName && (
                    saName === (acc.displayName || '').toLowerCase().trim() ||
                    saName === (acc.username   || '').toLowerCase().trim()
                );
            });

            if (syncAccount) {
                if (syncAccount.displayName && syncAccount.displayName !== syncAccount.id)
                    acc.displayName = syncAccount.displayName;
                if (syncAccount.avatar && !acc.avatar)
                    acc.avatar = syncAccount.avatar;
            }

            // ✅ ال IDs اللي هنعمل بيها بحث في الليبراري
            const searchIds = [...new Set([
                ...(syncAccount ? [String(syncAccount.id)] : []),
                ...candidateIds
            ])];

            const _norm = s => (s || '').toLowerCase()
                .replace(/[®©™]/g, '').replace(/[:\-'']/g, ' ').replace(/\s+/g, ' ').trim();
            const _gameNorm = _norm(game.name);
            const _cmdAppId = (() => {
                const m = (game.command || game.id || '').match(/(\d{5,})/);
                return m ? m[1] : null;
            })();

            if (searchIds.length > 0) {
                const isActuallySynced = !!syncAccount || syncAccounts.some(sa => searchIds.includes(String(sa.id)));

                const libGame = syncedLibrary.find((lg) => {
                    if (_cmdAppId && lg.appName && String(lg.appName) === _cmdAppId) return true;
                    const libNorm = _norm(lg.title);
                    return libNorm === _gameNorm || libNorm.includes(_gameNorm) || _gameNorm.includes(libNorm);
                });

                const _steamAccountLicensed = (lg, sid) => {
                    if (!lg || platKey !== 'steam') return false;
                    const lic = lg.steamLicensedAccountIds;
                    if (Array.isArray(lic)) {
                        if (lic.length > 0) return lic.map(String).includes(String(sid));
                    }
                    const owners = lg.ownedByAccountIds;
                    if (Array.isArray(owners) && owners.length > 0) {
                        return owners.map(String).includes(String(sid));
                    }
                    return (lg.steamDetectedAccountIds || []).map(String).includes(String(sid));
                };

                if (libGame && platKey === 'steam') {
                    const licensedOk = searchIds.some((sid) => _steamAccountLicensed(libGame, sid));
                    if (licensedOk) {
                        ownershipStatus = 'owned';
                        isOwned = true;
                    } else if (isActuallySynced) {
                        ownershipStatus = 'not-owned';
                        isOwned = false;
                    } else {
                        ownershipStatus = 'unknown';
                        isOwned = false;
                    }
                } else if (libGame && platKey === 'epic') {
                    const libOwners = libGame.ownedByAccountIds?.map(String) || [];
                    const foundEpic = searchIds.some((id) => libOwners.includes(id));
                    if (foundEpic) {
                        ownershipStatus = 'owned';
                        isOwned = true;
                    } else if (isActuallySynced) {
                        ownershipStatus = 'not-owned';
                        isOwned = false;
                    } else {
                        ownershipStatus = 'unknown';
                        isOwned = false;
                    }
                } else if (isActuallySynced) {
                    ownershipStatus = 'not-owned';
                    isOwned = false;
                } else {
                    ownershipStatus = 'unknown';
                    isOwned = false;
                }
            } else {
                // ✅ Not synced in Baddel -> "Sync to verify"
                ownershipStatus = 'unknown';
                isOwned = false;
            }
        }
        return { ...acc, isOwned, ownershipStatus, _hasLibraryData: syncedLibrary.length > 0 };
    }).filter((acc) => {
        // ✅ Show all accounts regardless of ownership status
        return true;
    });

    finalAccounts.sort((a, b) => {
        const rank = (x) => (x.isOwned ? 2 : x.ownershipStatus === 'unknown' ? 1 : 0);
        return rank(b) - rank(a);
    });

    // 🟢 Ghost accounts: أكاونتات بتملك اللعبة من الـ Sync بس مش في الـ Switcher
    if (syncedLibrary.length > 0) {
        const switcherIds = new Set(accounts.map(a => {
            const id = a._resolvedSyncId || a.platformAccountId || a.id;
            return id ? String(id) : null;
        }).filter(Boolean));
        const switcherNames = new Set(accounts.map(a =>
            (a.displayName || a.username || '').toLowerCase().trim()
        ).filter(Boolean));

        const _norm2 = s => (s || '').toLowerCase()
            .replace(/[®©™]/g, '').replace(/[:\-'']/g, ' ').replace(/\s+/g, ' ').trim();
        const _gameNorm2 = _norm2(game.name);
        const _cmdAppId2 = (() => {
            const m = (game.command || game.id || '').match(/(\d{5,})/);
            return m ? m[1] : null;
        })();

        syncAccounts.forEach(sa => {
            const alreadyIn = switcherIds.has(String(sa.id)) ||
                switcherNames.has((sa.displayName || '').toLowerCase().trim());
            if (alreadyIn) return;

            const ownsGame = syncedLibrary.some((libGame) => {
                if (_cmdAppId2 && libGame.appName && String(libGame.appName) === _cmdAppId2) {
                    if (platKey === 'steam') {
                        const lic = libGame.steamLicensedAccountIds;
                        if (Array.isArray(lic) && lic.length > 0) {
                            return lic.map(String).includes(String(sa.id));
                        }
                        const owners = libGame.ownedByAccountIds;
                        if (Array.isArray(owners) && owners.length > 0) {
                            return owners.map(String).includes(String(sa.id));
                        }
                        return (libGame.steamDetectedAccountIds || []).map(String).includes(String(sa.id));
                    }
                    return (libGame.ownedByAccountIds || []).map(String).includes(String(sa.id));
                }
                const libNorm = _norm2(libGame.title);
                const titleMatch = libNorm === _gameNorm2 || libNorm.includes(_gameNorm2) || _gameNorm2.includes(libNorm);
                if (!titleMatch) return false;
                if (platKey === 'steam') {
                    const lic = libGame.steamLicensedAccountIds;
                    if (Array.isArray(lic) && lic.length > 0) {
                        return lic.map(String).includes(String(sa.id));
                    }
                    const owners = libGame.ownedByAccountIds;
                    if (Array.isArray(owners) && owners.length > 0) {
                        return owners.map(String).includes(String(sa.id));
                    }
                    return (libGame.steamDetectedAccountIds || []).map(String).includes(String(sa.id));
                }
                return (libGame.ownedByAccountIds || []).map(String).includes(String(sa.id));
            });
            if (!ownsGame) return;

            finalAccounts.push({
                id:              `ghost-${sa.id}`,
                displayName:     sa.displayName || sa.id,
                username:        sa.displayName || sa.id,
                avatar:          sa.avatar || null,
                isOwned:         true,
                ownershipStatus: 'owned',
                notInSwitcher:   true,
                platformType:    platKey,
                platformLabel:   platKey === 'steam' ? 'Steam' : 'Epic Games',
                _hasLibraryData: true,
            });
        });
    }

    const platDisplayName = platKey === 'steam' ? 'Steam' : 'Epic Games';

    const noSwitchRow = `
        <div class="pl-account-row no-switch" id="gdInstAcct-__none__" onclick="gdInstallSelectAccount('__none__', '${platKey}')" data-id="__none__">
            <div class="pl-account-avatar no-switch-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </div>
            <div class="pl-account-info">
                <div class="pl-account-name">Install Directly</div>
                <div class="pl-account-sub">No account switch</div>
            </div>
            <div class="pl-account-check"></div>
        </div>`;

    const accountRows = finalAccounts.map(a => {
        const initials = (a.displayName || '??').substring(0, 2).toUpperCase();

        // 🟢 Ghost account: بيملك اللعبة بس مش في الـ Switcher
        if (a.notInSwitcher) {
            return `
            <div class="pl-ghost-wrapper">
                <div class="pl-account-row pl-account-row-ghost" id="gdInstAcct-${a.id}">
                    <div class="pl-account-avatar" style="background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.1)">
                        ${a.avatar ? `<img src="${a.avatar}" alt="${a.displayName}">` : `<span>${initials}</span>`}
                    </div>
                    <div class="pl-account-info">
                        <div class="pl-account-name">${a.displayName}</div>
                        <div class="pl-account-sub" style="color:rgba(255,255,255,0.3);">Not in Switcher</div>
                    </div>
                    <div class="pl-owned-badge pl-badge-owned" style="opacity:0.8;">✓ Owned Game</div>
                </div>
                <div class="pl-ghost-tooltip">
                    <div class="pl-ghost-tooltip-title">Account not in Switcher</div>
                    <div class="pl-ghost-tooltip-body">This account owns the game but hasn't been added to your ${platDisplayName} Switcher yet.</div>
                    <button class="pl-ghost-go-btn" onclick="document.getElementById('gdInstallerModal')?.remove(); selectAccountPlatform('${platKey}');">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                        Add to ${platDisplayName} Switcher
                    </button>
                </div>
            </div>`;
        }

        return `
        <div class="pl-account-row" id="gdInstAcct-${a.id}" onclick="gdInstallSelectAccount('${a.id}', '${a.platformType}')" data-id="${a.id}" data-username="${a.username || a.id}" data-name="${a.displayName}">
            <div class="pl-account-avatar" style="background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.1)">
                ${a.avatar ? `<img src="${a.avatar}" alt="${a.displayName}">` : `<span>${initials}</span>`}
            </div>
            <div class="pl-account-info">
                <div class="pl-account-name">${a.displayName}</div>
                <div class="pl-account-sub">${a.platformLabel}</div>
            </div>
            ${
                a.isOwned
                    ? `<div class="pl-owned-badge pl-badge-owned">✓ Owned</div>`
                    : a.ownershipStatus === 'not-owned'
                        ? `<div class="pl-owned-badge pl-badge-not-owned">✗ Not Owned</div>`
                    : a.ownershipStatus === 'unknown'
                        ? `<div class="pl-owned-badge pl-badge-unknown" title="Sync this account in the Accounts tab to verify ownership">— Sync to verify</div>`
                        : ''
            }
            <div class="pl-account-check"></div>
        </div>`;
    }).join('');

    list.style.opacity = '0';
    await new Promise(r => setTimeout(r, 150));

    list.innerHTML = noSwitchRow + accountRows;

    if (finalAccounts.length > 0) {
        const firstSelectable = finalAccounts.find(a => !a.notInSwitcher);
        if (firstSelectable) {
            gdInstallSelectAccount(firstSelectable.id, firstSelectable.platformType);
        } else {
            gdInstallSelectAccount('__none__', platKey);
        }
    } else {
        gdInstallSelectAccount('__none__', platKey);
    }

    list.style.opacity = '1';
};
window.gdInstallSelectAccount = function(accountId, platformType) {
    _gdInstallSelectedAccountId = accountId;
    _gdInstallSelectedAccountUsername = null;
    _gdInstallSelectedAccountName = null;
    
    document.querySelectorAll('#gdInstallAccountsList .pl-account-row').forEach(r => r.classList.remove('selected'));
    const row = document.querySelector(`#gdInstallAccountsList .pl-account-row[data-id="${accountId}"]`);
    if (row) {
        row.classList.add('selected');
        _gdInstallSelectedAccountUsername = row.dataset.username || null;
        _gdInstallSelectedAccountName = row.dataset.name || null;
    }
};

window.gdInstallConfirm = async function() {
    const accountId = _gdInstallSelectedAccountId;
    const platform = _gdInstallSelectedPlatform;
    const game = _gdCurrentGame;
    
    document.getElementById('gdInstallerModal')?.remove();
    if (!game) return;

    const targetPlatform = platform || (game.platforms ? game.platforms[0] : 'steam');
    
    // 🟢 استخراج الـ ID الصحيح للتحميل بناءً على المنصة المختارة
    let launchTarget = game.id;
    if (game.allIds && game.allIds[targetPlatform]) {
        launchTarget = game.allIds[targetPlatform];
    }
    
    if (targetPlatform === 'epic') {
        if (accountId && accountId !== '__none__') {
            try {
                if (typeof showToast === 'function') showToast('Switching account & waking up Epic...', 'info');
                await window.electronAPI.switchEpic?.(accountId);
                await new Promise(r => setTimeout(r, 2000));
            } catch (e) { console.warn('[Install] Epic Switch failed:', e); }
        }
        
        let finalLaunch = launchTarget;
        if (game.namespace && game.catalogItemId && game.appName && launchTarget === game.id) {
            finalLaunch = `${game.namespace}%3A${game.catalogItemId}%3A${game.appName}`;
        }

        const cleanTarget = String(finalLaunch).replace(/^epic_/i, '');
        const finalUrl = `com.epicgames.launcher://apps/${cleanTarget}?action=launch&silent=true`;
        
        window.electronAPI?.openExternal?.(finalUrl);
        if (typeof showToast === 'function') showToast('Opening Epic Games...', 'success');
        setTimeout(() => window.electronAPI?.openExternal?.(finalUrl), 8500);
    }
    else if (targetPlatform === 'steam') {
        if (accountId && accountId !== '__none__') {
            try {
                const switchArg = (_gdInstallSelectedAccountUsername && _gdInstallSelectedAccountUsername !== 'undefined') ? _gdInstallSelectedAccountUsername : accountId;
                
                if (typeof showToast === 'function') showToast(`Switching Steam account to ${_gdInstallSelectedAccountName || switchArg}… Please wait up to 7s`, 'info');
                await window.electronAPI.switchSteam?.(switchArg);
                await new Promise(r => setTimeout(r, 7000));
            } catch (e) { console.warn('[Install] Steam Switch failed:', e); }
        }

        const cleanSteamId = String(launchTarget).replace(/^steam_/i, '');
        window.electronAPI?.openExternal?.(`steam://install/${cleanSteamId}`);
        if (typeof showToast === 'function') showToast('Opening Steam to install...', 'success');
    }
};

// محاكاة بار التحميل - استبدلها بـ IPC event حقيقي
function _gdSimulateDownload() {
    const downloadBlock = document.getElementById('gdDownloadBlock');
    const playBtn = document.getElementById('gdPlayBtn');
    const dlBar = document.getElementById('gdDlBar');
    const dlPercent = document.getElementById('gdDlPercent');
    const dlSpeed = document.getElementById('gdDlSpeed');
    const dlEta = document.getElementById('gdDlEta');
    const dlStatus = document.getElementById('gdDlStatus');

    playBtn.style.display = 'none';
    downloadBlock.style.display = 'block';

    let percent = 0;
    const totalSizeMB = 25000; // 25 GB

    _gdDownloadInterval = setInterval(() => {
        const speedMBps = 5 + Math.random() * 10; // 5-15 MB/s
        percent += (speedMBps / totalSizeMB) * 100 * 2;
        if (percent >= 100) {
            percent = 100;
            clearInterval(_gdDownloadInterval);
            dlStatus.textContent = 'Installed!';
            dlSpeed.textContent = '';
            dlEta.textContent = 'Done';
            setTimeout(() => {
                downloadBlock.style.display = 'none';
                const btn = document.getElementById('gdPlayBtn');
                btn.classList.remove('install-mode');
                document.getElementById('gdPlayBtnLabel').textContent = 'PLAY';
                btn.style.display = 'flex';
            }, 1500);
            return;
        }
        const remainingMB = totalSizeMB * (1 - percent / 100);
        const etaSec = remainingMB / speedMBps;
        const etaMin = Math.floor(etaSec / 60);
        const etaSec2 = Math.floor(etaSec % 60);

        dlBar.style.width = percent + '%';
        dlPercent.textContent = percent.toFixed(1) + '%';
        dlSpeed.textContent = speedMBps.toFixed(1) + ' MB/s';
        dlEta.textContent = etaMin > 0 ? `${etaMin}m ${etaSec2}s left` : `${etaSec2}s left`;
        dlStatus.textContent = 'Downloading…';
    }, 200);
}

// ──────────────────────────────────────────
//  METADATA POPULATE
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  METADATA POPULATE
// ──────────────────────────────────────────
function _gdPopulateMeta(game, metaData) {
    const images = metaData || {};          
    const info = metaData?.info || {};        

    // 1. Description: IGDB بيبعت نص عادي، فهنحول الـ line breaks لـ <br> عشان التنسيق
    const descEl = document.getElementById('gdDesc');
    if (info.description) {
        // ✅ السحر هنا: \n+ معناها "لو لقيت سطر أو 100 سطر فاضيين ورا بعض، حولهم لمسافة فقرة واحدة بس"
        descEl.innerHTML = info.description.trim().replace(/\n+/g, '<br><br>');
    }else {
        descEl.innerHTML = `<span style="color:var(--gd-text-muted); font-style:italic;">No description available for "${game.name}".</span>`;
    }

    // ── تحديث الـ Hero Background بالـ IGDB artwork ──
    const heroSrc = images.heroImage || null; // ✅ شلنا الـ images.cover خالص
    const heroBg = document.getElementById('gdHeroBg');
    
    if (heroSrc && heroBg) {
        heroBg.style.backgroundImage = `url('${heroSrc.replace(/\\/g, '/')}')`;
        game.heroImage = heroSrc;
    } else if (heroBg) {
        // لو حتى بعد ما الداتا رجعت مفيش Hero، سيب الخلفية الغامقة
        heroBg.style.backgroundImage = 'linear-gradient(135deg, #0f0f18, #1a1a28)';
    }

    // ── تحديث الـ Cover لو مش موجود ──
    if (images.cover && !game.image) {
        game.image = images.cover;
        const coverImg = document.getElementById('gdCover');
        if (coverImg) {
            coverImg.src = images.cover;
            coverImg.style.display = 'block';
            document.getElementById('gdCoverPlaceholder').style.display = 'none';
        }
    }

    // ── Logo (من SteamGridDB عادةً) ──
    if (images.logo && !game.logo) {
        game.logo = images.logo;
        const logoEl = document.getElementById('gdLogo');
        if (logoEl) {
            logoEl.src = images.logo;
            logoEl.style.display = 'block';
            document.getElementById('gdTitle').style.display = 'none';
        }
    }

    // 2. Rating بدل Metacritic 
    const score = info.rating || null;
    if (score) {
        document.getElementById('gdRatingBlock').style.display = 'block';
        document.getElementById('gdRatingScore').textContent = score;
        const stars = Math.round((score / 100) * 5);
        const starsEl = document.getElementById('gdRatingStars');
        starsEl.innerHTML = Array.from({length: 5}, (_, i) =>
            `<span class="${i < stars ? '' : 'empty'}">★</span>`
        ).join('');
    } else {
        document.getElementById('gdRatingBlock').style.display = 'none';
    }

    // ── Trailer Section ──────────────────────────────────────────
    // YouTube embeds مش بتشتغل في Electron (Error 153)
    // الحل: نعرض thumbnail + زرار يفتح في المتصفح، زي ما accounts.js بيعمل
    const trailerSection = document.getElementById('gdTrailerSection');
    const trailerExtBtn  = document.getElementById('gdTrailerExtBtn');
    const allTrailers    = info.allTrailers || (info.trailer ? [{
        name: 'Trailer',
        url: info.trailer,
        thumbUrl: info.trailer.includes('youtube') ? `https://img.youtube.com/vi/${info.trailer.split('/embed/')[1]?.split('?')[0]}/maxresdefault.jpg` : null
    }] : []);

    if (allTrailers.length > 0 && trailerSection) {
        trailerSection.style.display = 'block';

        // ── المشغل الرئيسي ────────────────────────────────
        const trailerWrap = trailerSection.querySelector('.gd-trailer-wrap');
        if (trailerWrap) {
            _gdRenderTrailerPlayer(trailerWrap, allTrailers, 0);
        }

        // ── Thumbnails لو في أكتر من واحد (بالـ Slider والأسهم) ────────────────
        const thumbsContainer = document.getElementById('gdTrailerThumbs');
        if (thumbsContainer && allTrailers.length > 1) {
            
            // 1. نظبط الكونتينر الأساسي عشان يستوعب الأسهم ويبقى بلوك
            thumbsContainer.style.display = 'block';
            thumbsContainer.style.position = 'relative';
            
            // 2. نحدد هل محتاجين أسهم ولا لأ (لو أكتر من 4 فيديوهات هيظهر الأسهم)
            const showArrows = allTrailers.length > 4;

            // 3. نبني التريلرات (عملناها flex-shrink: 0 عشان متتكبسش)
            const thumbsHtml = allTrailers.map((t, i) => `
                <div class="gd-trailer-thumb" data-idx="${i}"
                     style="cursor:pointer; text-align:center; opacity:${i===0?1:0.55}; transition:opacity 0.2s; flex-shrink: 0;
                            margin-left: ${showArrows && i === 0 ? '38px' : '0'};
                            margin-right: ${showArrows && i === allTrailers.length - 1 ? '38px' : '0'};">
                    <img src="${t.thumbUrl || 'assets/logo.png'}" alt="${t.name}"
                         style="width:130px;height:73px;object-fit:cover;border-radius:6px;
                                border:2px solid ${i===0?'var(--accent)':'rgba(255,255,255,0.1)'};display:block;"
                         onerror="this.src='assets/logo.png'">
                    <div style="font-size:0.68rem;color:var(--gd-text-muted);margin-top:5px;
                                max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${t.name}
                    </div>
                </div>
            `).join('');

            // 4. نبني الأسهم (تصميم شيك بـ blur)
            const leftArrow = showArrows ? `
                <button onclick="document.getElementById('gd-thumbs-scroll').scrollBy({left: -200, behavior: 'smooth'})" 
                        style="position: absolute; left: 0; top: 0; height: 73px; width: 32px; background: rgba(0,0,0,0.85); color: white; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; z-index: 2; border-radius: 6px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); transition: 0.2s; box-shadow: 5px 0 15px rgba(0,0,0,0.5);" 
                        onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='rgba(0,0,0,0.85)'">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>` : '';

            const rightArrow = showArrows ? `
                <button onclick="document.getElementById('gd-thumbs-scroll').scrollBy({left: 200, behavior: 'smooth'})" 
                        style="position: absolute; right: 0; top: 0; height: 73px; width: 32px; background: rgba(0,0,0,0.85); color: white; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; z-index: 2; border-radius: 6px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); transition: 0.2s; box-shadow: -5px 0 15px rgba(0,0,0,0.5);" 
                        onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='rgba(0,0,0,0.85)'">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>` : '';

            // 5. نحط المزيج ده كله جوه الكونتينر
            thumbsContainer.innerHTML = `
                ${leftArrow}
                <div id="gd-thumbs-scroll" style="display: flex; gap: 8px; overflow-x: auto; scroll-behavior: smooth; scrollbar-width: none; padding-bottom: 5px;">
                    ${thumbsHtml}
                </div>
                ${rightArrow}
            `;

            // 6. السحر هنا: إخفاء شريط السكرول المزعج من المتصفح عشان يبان إنه Custom
            if (!document.getElementById('hide-scroll-style')) {
                const style = document.createElement('style');
                style.id = 'hide-scroll-style';
                style.innerHTML = `#gd-thumbs-scroll::-webkit-scrollbar { display: none; }`;
                document.head.appendChild(style);
            }

            // 7. كليك على الـ thumbnail يغير المشغل
            thumbsContainer.querySelectorAll('.gd-trailer-thumb').forEach(el => {
                el.addEventListener('click', () => {
                    const idx = parseInt(el.dataset.idx);
                    if (trailerWrap) _gdRenderTrailerPlayer(trailerWrap, allTrailers, idx);
                    // تحديث الـ active state
                    thumbsContainer.querySelectorAll('.gd-trailer-thumb').forEach((t, i) => {
                        t.style.opacity = i === idx ? '1' : '0.55';
                        t.querySelector('img').style.border = i === idx
                            ? '2px solid var(--accent)'
                            : '2px solid rgba(255,255,255,0.1)';
                    });
                });
            });
        } else if (thumbsContainer) {
            thumbsContainer.style.display = 'none';
        }

    } else if (trailerSection) {
        trailerSection.style.display = 'none';
    }
    // Screenshots & Artworks
    // 📸 Screenshots ONLY (بدون أي Artworks أو لوجوهات)
    // 📸 Screenshots ONLY
    const screenshotsEl = document.getElementById('gdScreenshots');
    if (screenshotsEl) {
        const allMedia = info.screenshots || []; 
        
        if (allMedia.length > 0) {
            _gdLightboxImages = allMedia;
            screenshotsEl.innerHTML = allMedia.map((url, i) => `
                <div class="gd-screenshot-thumb" onclick="gdOpenLightbox(${i})">
                    <img src="${url}" loading="lazy" alt="Screenshot" onerror="this.parentElement.style.display='none'">
                </div>
            `).join('');
        } else {
            screenshotsEl.innerHTML = '<div class="gd-no-media">No screenshots available.</div>';
        }
    }
    // 3. تحديث الـ Info Grid عشان يقرا الداتا الجديدة من IGDB
    _gdBuildInfoGrid(game, info);

    // Genres
    const genresSection = document.getElementById('gdGenresSection');
    const genresList = document.getElementById('gdGenres');
    if (info.genres && info.genres.length > 0 && genresSection && genresList) {
        genresSection.style.display = 'block';
        genresList.innerHTML = info.genres.map(g => `<span class="gd-genre-tag">${g}</span>`).join('');
    } else if (genresSection) {
        genresSection.style.display = 'none';
    }

    // 4. إخفاء Requirements لو مش موجودة (لأن IGDB مش بيوفرها كنص زي RAWG)
    const reqSection = document.getElementById('gdTab-requirements');
    const reqTabBtn  = document.querySelector('.gd-tab[data-tab="requirements"]');
    if (info.requirements) {
        if (reqTabBtn) reqTabBtn.style.display = '';
        _gdPopulateRequirements(info);
    } else {
        // إخفاء تاب المتطلبات عشان ميفضلش فاضي
        if (reqTabBtn) reqTabBtn.style.display = 'none';
        if (reqSection) reqSection.style.display = 'none';
    }

    // Sidebar detail list
    _gdBuildDetailList(game, info);
}

// ──────────────────────────────────────────
//  TRAILER PLAYER — thumbnail + open in browser
//  (YouTube embeds مش بتشتغل في Electron)
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — مدمج بالكامل داخل التطبيق
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — مدمج بالكامل داخل التطبيق
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — مدمج بالكامل داخل التطبيق
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — GOG/Epic Style Trick
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — GOG/Epic Style Trick (Final Fix)
// ──────────────────────────────────────────
function _gdRenderTrailerPlayer(container, trailers, idx) {
    const t = trailers[idx];
    if (!t || !t.url) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    const url = t.url;

    // التحقق: هل ده فيديو مباشر ولا يوتيوب؟
    const isDirect = url.endsWith('.mp4') || url.endsWith('.webm') || url.includes('akamaihd.net');

    if (isDirect) {
        // فيديو Steam الخام
        container.innerHTML = `
            <video controls autoplay muted style="width:100%; aspect-ratio:16/9; border-radius:10px; background:#000; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                <source src="${url}" type="video/mp4">
            </video>
        `;
    } else {
        // مشغل YouTube (GOG Trick)
        const embedMatch = url.match(/(?:v=|embed\/|youtu\.be\/)([^&?\/\s]{11})/);
        const videoId = embedMatch ? embedMatch[1] : null;

        if (videoId) {
            const thumbUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

            container.innerHTML = `
                <div id="gd-yt-fake-player-${videoId}" style="position:relative; width:100%; aspect-ratio:16/9; border-radius:10px; overflow:hidden; cursor:pointer; background:#000; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                    <img src="${thumbUrl}" alt="Trailer Thumbnail" style="width:100%; height:100%; object-fit:cover; opacity:0.8; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.8" onerror="this.src='assets/logo.png'">
                    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:68px; height:48px; background:rgba(30,30,30,0.92); border-radius:12px; display:flex; align-items:center; justify-content:center;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                </div>
            `;

            const fakePlayer = document.getElementById(`gd-yt-fake-player-${videoId}`);
            if (fakePlayer) {
                fakePlayer.addEventListener('click', function() {
                    // ══════════════════════════════════════════════════
                    // الـ URL parameters دي بتأثر على يوتيوب من الأول:
                    // modestbranding=1  → بيشيل لوجو يوتيوب من الكونترول بار
                    // rel=0             → بيمنع "more videos" في الآخر
                    // iv_load_policy=3  → بيشيل الـ annotations والـ cards
                    // cc_load_policy=0  → بيشيل الـ CC
                    // disablekb=0       → keyboard shortcuts شغالة
                    // fs=1              → fullscreen شغال
                    // color=white       → بيشيل اللون الأحمر من الـ progress bar
                    // ══════════════════════════════════════════════════
                    const iframeSrc = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3&cc_load_policy=0&color=white&vq=hd1080`;

                    // الـ wrapper ده بيحتوي الـ webview + overlay divs فوقيه
                    this.innerHTML = `
                        <div style="position:relative; width:100%; height:100%;">

                            <webview 
                                id="yt-webview-${videoId}"
                                style="width:100%; height:100%; border:none; background:#000;"
                                src="${iframeSrc}"
                                partition="persist:youtubeplayer"
                                httpreferrer="https://store.steampowered.com/"
                                useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                                allowpopups
                                allowfullscreen
                                webpreferences="contextIsolation=false">
                            </webview>

                            <!-- ███ OVERLAY: يغطي شريط العنوان فوق (اسم الفيديو + القناة + أيقونة يوتيوب) ███ -->
                            <div style="
                                position:absolute; top:0; left:0; right:0;
                                height: 52px;
                                background: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%);
                                pointer-events: none;
                                z-index: 10;">
                            </div>

                            <!-- ███ OVERLAY: يغطي شريط الكونترول تحت (Progress bar + لوجو يوتيوب + More Videos) ███ -->
                            <div style="
                                position:absolute; bottom:0; left:0; right:0;
                                height: 48px;
                                background: linear-gradient(to top, rgba(0,0,0,0.90) 0%, transparent 100%);
                                pointer-events: none;
                                z-index: 10;">
                            </div>

                            <!-- ███ BLOCKER: يبلوك كليك على أيقونة يوتيوب أسفل يمين تحديداً ███ -->
                            <div style="
                                position:absolute; bottom:0; right:0;
                                width: 120px; height: 48px;
                                background: transparent;
                                pointer-events: all;
                                z-index: 20;">
                            </div>

                            <!-- ███ BLOCKER: يبلوك كليك على اسم الفيديو والقناة أعلى يسار ███ -->
                            <div style="
                                position:absolute; top:0; left:0;
                                width: 70%; height: 52px;
                                background: transparent;
                                pointer-events: all;
                                z-index: 20;">
                            </div>

                            <!-- ███ BLOCKER: يبلوك كليك على زراير أعلى يمين (Watch Later, Share) ███ -->
                            <div style="
                                position:absolute; top:0; right:0;
                                width: 110px; height: 52px;
                                background: transparent;
                                pointer-events: all;
                                z-index: 20;">
                            </div>

                        </div>
                    `;
                    this.style.cursor = 'default';

                    const webview = document.getElementById(`yt-webview-${videoId}`);

                    webview.addEventListener('dom-ready', () => {
                        // محاولة CSS injection كـ backup
                        try {
                            webview.insertCSS(`
                                .ytp-chrome-top, .ytp-title, .ytp-title-channel,
                                .ytp-youtube-button, .ytp-watermark,
                                .ytp-pause-overlay-container, .ytp-endscreen-content,
                                .html5-endscreen, .ytp-ce-element,
                                .ytp-cards-teaser, .ytp-cards-button,
                                .ytp-chrome-top-buttons, .ytp-suggested-action,
                                .ytp-branding-logo, .ytp-autonav-toggle-button,
                                .ytp-settings-button, .ytp-subtitles-button,
                                .ytp-miniplayer-button, .ytp-size-button {
                                    display: none !important;
                                    visibility: hidden !important;
                                    opacity: 0 !important;
                                }
                                .ytp-progress-bar-container {
                                    opacity: 0.001 !important;
                                }
                            `);
                        } catch(e) {}

                        // جودة 1080p
                        try {
                            webview.executeJavaScript(`
                                setTimeout(() => {
                                    try {
                                        const p = document.querySelector('.html5-video-player');
                                        if (p) {
                                            p.setPlaybackQualityRange && p.setPlaybackQualityRange('hd1080','hd1080');
                                            p.setPlaybackQuality && p.setPlaybackQuality('hd1080');
                                        }
                                    } catch(e) {}
                                }, 2000);
                            `);
                        } catch(e) {}
                    });

                }, { once: true });
            }
        } else {
            container.innerHTML = `<div style="color:#fff; padding:20px; text-align:center;">Unsupported video format</div>`;
        }
    }
}
// ──────────────────────────────────────────
//  INFO GRID (Overview)
// ──────────────────────────────────────────

function _gdBuildInfoGrid(game, meta) {
    const grid = document.getElementById('gdInfoGrid');
    const items = [];

    const add = (label, value) => {
        if (value && value !== '—' && value !== 'Unknown') items.push({ label, value });
    };

    // 🧹 تنظيف الـ Platforms: هنشيل أي كلمة "Platform" وجنبها رقم، ونخليهم 4 بالكتير
    let cleanPlatforms = '—';
    if (meta?.platforms && Array.isArray(meta.platforms)) {
        const filtered = meta.platforms.filter(p => !p.toLowerCase().includes('platform'));
        cleanPlatforms = filtered.slice(0, 4).join(' • ');
        if (filtered.length > 4) cleanPlatforms += ' • ...'; // لو أكتر من 4 نحط نقط
    } else if (meta?.platform || game.platform) {
        cleanPlatforms = meta?.platform || game.platform;
    }

    add('Developer',    meta?.developer || game.developer || '—');
    add('Publisher',    meta?.publisher || game.publisher || '—');
    add('Release Date', _gdFormatDate(meta?.releaseDate || game.releaseDate));
    add('Platform',     cleanPlatforms); // حطينا المنصات بعد التنظيف
    // ❌ شلنا الـ Genre من هنا خالص زي ما طلبت
    add('Mode',         meta?.playerMode || meta?.gameMode || '—');
    add('Engine',       meta?.engine || '—');
    add('Website',      meta?.website ? `<a href="#" onclick="window.electronAPI?.openExternal('${meta.website}'); return false;">${_gdTrimUrl(meta.website)}</a>` : null);

    grid.innerHTML = items.map(i => `
        <div class="gd-info-item">
            <div class="gd-info-label">${i.label}</div>
            <div class="gd-info-value">${i.value}</div>
        </div>
    `).join('');
}

// ──────────────────────────────────────────
//  DETAIL LIST (Sidebar)
// ──────────────────────────────────────────
function _gdBuildDetailList(game, meta) {
    const list = document.getElementById('gdDetailList');
    const rows = [];

    const add = (label, value) => {
        if (value) rows.push(`
            <div class="gd-detail-row">
                <span class="gd-detail-label">${label}</span>
                <span class="gd-detail-value">${value}</span>
            </div>
        `);
    };

    const pData = (typeof playtimeData !== 'undefined' && playtimeData[game.id])
        ? playtimeData[game.id] : { totalMinutes: 0, lastPlayed: null };

    const ptStr = (typeof formatPlaytime === 'function') ? formatPlaytime(pData.totalMinutes) : '0h';
    const lpStr = (typeof formatLastPlayed === 'function') ? formatLastPlayed(pData.lastPlayed) : 'Never';

    add('Playtime',       ptStr);
    add('Last Played',    lpStr);
    add('Developer',      meta?.developer || game.developer);
    add('Publisher',      meta?.publisher || game.publisher);
    add('Release Date',   _gdFormatDate(meta?.releaseDate || game.releaseDate));
    add('Platform',       game.platform);
    add('File Size',      meta?.fileSize || game.size);

    list.innerHTML = rows.join('') || `
        <div class="gd-detail-row">
            <span class="gd-detail-value" style="color:var(--gd-text-muted); font-style:italic; font-size:0.8rem;">No additional info</span>
        </div>
    `;
}

// ──────────────────────────────────────────
//  REQUIREMENTS
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  REQUIREMENTS & PARSER
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  REQUIREMENTS & PARSER
// ──────────────────────────────────────────
function _parseRawgReqString(str) {
    if (!str) return {};

    // تحويل الـ <br> لسطر جديد عشان الـ Regex يشتغل صح
    const cleanStr = str.replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<\/li>/gi, '\n')
                        .replace(/<[^>]*>?/gm, '')
                        .replace(/&nbsp;/g, ' ');

    const extract = (regex) => {
        const match = cleanStr.match(regex);
        return match ? match[1].trim() : null;
    };

    return {
        os: extract(/(?:OS|Operating System)\s*:?\s*([^\n]+)/i),
        cpu: extract(/(?:Processor|CPU)\s*:?\s*([^\n]+)/i),
        ram: extract(/(?:Memory|RAM)\s*:?\s*([^\n]+)/i),
        gpu: extract(/(?:Graphics|Video Card|GPU)\s*:?\s*([^\n]+)/i),
        storage: extract(/(?:Storage|Hard Drive|Network)\s*:?\s*([^\n]+)/i),
        directx: extract(/(?:DirectX|DX)\s*:?\s*([^\n]+)/i)
    };
}

function _gdPopulateRequirements(info) {
    const req = info?.requirements || {};
    
    // لو RAWG باعت النص كـ String، هنحلله ونفصصه، لو باعت Object هنستخدمه
    const min = typeof req.minimum === 'string' ? _parseRawgReqString(req.minimum) : (req.minimum || {});
    const rec = typeof req.recommended === 'string' ? _parseRawgReqString(req.recommended) : (req.recommended || {});

    const fill = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '—';
    };

    fill('gdReqMinOS',      min.os);
    fill('gdReqMinCPU',     min.cpu);
    fill('gdReqMinRAM',     min.ram);
    fill('gdReqMinGPU',     min.gpu);
    fill('gdReqMinStorage', min.storage);
    fill('gdReqMinDX',      min.directx);

    fill('gdReqRecOS',      rec.os);
    fill('gdReqRecCPU',     rec.cpu);
    fill('gdReqRecRAM',     rec.ram);
    fill('gdReqRecGPU',     rec.gpu);
    fill('gdReqRecStorage', rec.storage);
    fill('gdReqRecDX',      rec.directx);
}

function _gdNormTitle(s) {
    return (s || '').toLowerCase().replace(/[®©™]/g, '').replace(/[:\-'']/g, ' ').replace(/\s+/g, ' ').trim();
}

// ──────────────────────────────────────────
//  ACCOUNTS TAB (Smart Sync Filter & Ownership)
// ──────────────────────────────────────────
async function _gdPopulateAccounts(game) {
    const container = document.getElementById('gdAccountsList');
    const rows = [];
    const detectedPlatforms = _gdDetectPlatforms(game);
    const platformKeys = Object.keys(GD_PLATFORM_LOGOS).filter((platKey) => detectedPlatforms.includes(platKey));

    for (const platKey of platformKeys) {
        try {
            const cfg = GD_PLATFORM_LOGOS[platKey];
            
            // 1. سحب الحسابات المربوطة والألعاب المتكيشة (زي Epic)
            let syncedAccounts = [];
            let syncedLibrary = [];
            if (window.electronAPI.platformSyncGetAccounts && window.electronAPI.platformSyncGetCached) {
                try {
                    const accRes = await window.electronAPI.platformSyncGetAccounts(platKey);
                    if (accRes && accRes.accounts) syncedAccounts = accRes.accounts;
                    
                    const libRes = await window.electronAPI.platformSyncGetCached(platKey);
                    if (libRes && libRes.games) syncedLibrary = libRes.games;
                } catch (e) {}
            }

            // 2. سحب الحسابات العادية من الـ Switcher (زي Steam, EA)
            // 2. سحب الحسابات العادية من الـ Switcher (زي Steam, EA)
            let switcherProfiles = [];
            switch(platKey) {
                case 'steam': 
                    switcherProfiles = await window.electronAPI.getSteamAccounts?.() || []; 
                    // 🟢 جلب الصور لحسابات ستيم هنا كمان
                    if (window.electronAPI.getSteamImage) {
                        await Promise.all(switcherProfiles.map(async (acc) => {
                            try { acc.avatar = await window.electronAPI.getSteamImage(acc.steamId || acc.id); } catch(e) {}
                        }));
                    }
                    break;
                case 'epic': switcherProfiles = await window.electronAPI.getEpicProfiles?.() || []; break;
                case 'ea': switcherProfiles = await window.electronAPI.getEAProfiles?.() || []; break;
                case 'riot': switcherProfiles = await window.electronAPI.getRiotProfiles?.() || []; break;
                case 'ubisoft': switcherProfiles = await window.electronAPI.getUbisoftProfiles?.() || []; break;
                case 'rockstar': switcherProfiles = await window.electronAPI.getRockstarProfiles?.() || []; break;
            }

            if (platKey === 'steam' && syncedAccounts.length > 0) {
                const _ls = new Set(syncedAccounts.map((s) => String(s.id)));
                switcherProfiles = switcherProfiles.filter((sp) => {
                    const p = typeof sp === 'string' ? { id: sp, steamId: sp } : sp;
                    const pid = String(p.steamId || p.id || p.username || p.AccountName || '');
                    return _ls.has(pid);
                });
            }

            // 3. دمج القائمتين مع تجنب التكرار
            let accountsToDisplay = [];

            // أولوية للحسابات اللي اتعملها Sync
            syncedAccounts.forEach((sa) => {
                const ownedGames = platKey === 'steam'
                    ? syncedLibrary.filter((g) => {
                        if (Array.isArray(g.steamLicensedAccountIds) && g.steamLicensedAccountIds.length > 0) {
                            return g.steamLicensedAccountIds.map(String).includes(String(sa.id));
                        }
                        if (Array.isArray(g.ownedByAccountIds) && g.ownedByAccountIds.length > 0) {
                            return g.ownedByAccountIds.map(String).includes(String(sa.id));
                        }
                        if (Array.isArray(g.steamDetectedAccountIds) && g.steamDetectedAccountIds.length > 0) {
                            return g.steamDetectedAccountIds.map(String).includes(String(sa.id));
                        }
                        return g.ownedByAccountIds && g.ownedByAccountIds.map(String).includes(String(sa.id));
                    })
                    : syncedLibrary.filter((g) => g.ownedByAccountIds && g.ownedByAccountIds.includes(sa.id));

                accountsToDisplay.push({
                    id: sa.id,
                    displayName: sa.displayName,
                    isSynced: true,
                    ownedGames: ownedGames
                });
            });

            // إضافة الحسابات العادية لو مش موجودة في حسابات الـ Sync
            switcherProfiles.forEach(sp => {
                let prof = typeof sp === 'string' ? { id: sp, displayName: sp } : { ...sp };
                prof.displayName = prof.displayName || prof.name || prof.username || String(prof.id || '');
                prof.id = String(prof.id || prof.username || prof.name || prof.displayName);

                const alreadyAdded = accountsToDisplay.some(a => String(a.id) === String(prof.id) || String(a.displayName).toLowerCase() === String(prof.displayName).toLowerCase());
                
                if (!alreadyAdded) {
                    prof.isSynced = false;
                    prof.ownedGames = []; 
                    accountsToDisplay.push(prof);
                }
            });

            // 4. فحص الملكية وعرض البيانات
            const _cmdAppGd = (game.command || game.id || '').match(/(\d{5,})/)?.[1];
            const _gameTitleNorm = _gdNormTitle(game.name || '');

            accountsToDisplay.forEach(profile => {
                let isOwned = false;

                if (profile.isSynced) {
                    isOwned = profile.ownedGames.some((g) => {
                        if (platKey === 'steam' && _cmdAppGd && g.appName && String(g.appName) === _cmdAppGd) return true;
                        if (platKey === 'steam') {
                            return _gdNormTitle(g.title || '') === _gameTitleNorm;
                        }
                        const gameIdStr = String(game.id).toLowerCase();
                        const gameNameStr = String(game.name || '').toLowerCase();
                        const gId = String(g.id).toLowerCase();
                        const gName = String(g.title || g.appName || '').toLowerCase();
                        return gId === gameIdStr || gName === gameNameStr || gName.includes(gameNameStr);
                    });
                } else {
                    // فحص الملكية الافتراضي لمنصات زي Steam (لو اللعبة مثبتة باسمه)
                    isOwned = _gdCheckRealOwnership(game, platKey, profile);
                }

                // 🛑 الفلترة المطلوبة: 
                // هنعرض الحساب فقط لو هو معموله Scan (isSynced)
                // أو لو الحساب عادي بس اللعبة فعلاً تابعة ليه (isOwned)
                // 🟢 شلنا الفلتر اللي كان بيخفي الحسابات عشان تظهر بحالة Sync to verify
                if (!profile.isSynced && !isOwned) return;

                let statusHtml = '';
                let statusClass = '';
                
                if (isOwned) {
                    statusHtml = platKey === 'steam' ? '✓ Licensed' : '✓ Owned';
                    statusClass = 'owned';
                } else if (profile.isSynced) {
                    statusHtml = platKey === 'steam' ? 'No license' : 'Not Owned';
                    statusClass = 'not-owned';
                } else {
                    statusHtml = '— Sync to verify';
                    statusClass = 'unknown';
                }

                rows.push(`
                    <div class="gd-account-item">
                        <div class="gd-account-plat-icon" style="background:${cfg.color}22; border: 1px solid ${cfg.color}44;">
                            <img src="${cfg.img}" alt="${cfg.name}" ${cfg.invert ? 'style="filter:invert(1)"' : ''}>
                        </div>
                        <div class="gd-account-info">
                            <div class="gd-account-name">${profile.displayName}</div>
                            <div class="gd-account-plat">${cfg.name}</div>
                        </div>
                        <div class="gd-account-status ${statusClass}" ${statusClass === 'unknown' ? 'style="background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.45); border: 1px solid rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 8px; font-size: 0.8em;"' : ''}>
                            ${statusHtml}
                        </div>
                    </div>
                `);
            });

        } catch(e) {
            console.error(e);
        }
    }

    // 5. تحديث الواجهة
    if (rows.length === 0) {
        container.innerHTML = '<div class="gd-no-accounts">No scanned accounts found. Sync your library from the Accounts tab first.</div>';
    } else {
        container.innerHTML = rows.join('');
    }
}

/**
 * دالة ذكية لمعرفة إذا كان الأكاونت يملك اللعبة فعلاً مش مجرد تخمين
 */
function _gdCheckRealOwnership(game, platform, profile) {
    // 1. لو الباك إند باعت لستة الألعاب اللي الأكاونت ده بيملكها
    if (profile.ownedGames && Array.isArray(profile.ownedGames)) {
        const gameNameLower = (game.name || '').toLowerCase();
        const isOwned = profile.ownedGames.some(g => {
            // بنقارن الاسم سواء كان string أو object
            const gName = (typeof g === 'string' ? g : g.name || '').toLowerCase();
            return gName === gameNameLower || gName.includes(gameNameLower);
        });
        if (isOwned) return true;
    }

    // 2. لو اللعبة نفسها متخزن فيها الـ ID بتاع الأكاونت اللي بتنتمي ليه 
    if (game.ownerIds && Array.isArray(game.ownerIds)) {
        if (game.ownerIds.includes(profile.id || profile.username)) return true;
    }

    // 3. Fallback للعبة المتسطبة: لو إنت مسجل إن اللعبة دي تابعة لأكاونت معين في الـ DB
    if (game.accountId && (game.accountId === profile.id || game.accountId === profile.username)) {
        return true;
    }

    return false;
}

/**
 * بيحاول يحدد إذا كانت اللعبة موجودة على الأكاونت ده
 */
function _gdCheckGameOwnership(game, platform, profile) {
    const gamePlatform = (game.platform || '').toLowerCase();
    if (gamePlatform.includes(platform)) return true;

    const cmd = (game.command || '').toLowerCase();
    if (platform === 'steam' && cmd.includes('steam')) return true;
    if (platform === 'epic'  && cmd.includes('com.epicgames')) return true;
    if (platform === 'ea'    && (cmd.includes('origin') || cmd.includes('ea'))) return true;

    return false;
}

// ──────────────────────────────────────────
//  TAB SWITCHING
// ──────────────────────────────────────────
window.gdSwitchTab = function(tabName, btnEl) {
    document.querySelectorAll('.gd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.gd-tab-content').forEach(t => {
        t.style.display = 'none';
        t.classList.remove('active');
    });

    btnEl.classList.add('active');
    const content = document.getElementById(`gdTab-${tabName}`);
    if (content) {
        content.style.display = 'block';
        content.classList.add('active');
    }
};

// ──────────────────────────────────────────
//  LIGHTBOX (GALLERY NAVIGATION)
// ──────────────────────────────────────────
window.gdOpenLightbox = function(index) {
    if (_gdLightboxImages.length === 0) return;
    _gdLightboxIndex = index;
    document.getElementById('gdLightboxImg').src = _gdLightboxImages[_gdLightboxIndex];
    document.getElementById('gdLightbox').classList.add('active');
};

window.gdCloseLightbox = function() {
    document.getElementById('gdLightbox').classList.remove('active');
};

window.gdNavLightbox = function(direction) {
    if (_gdLightboxImages.length === 0) return;
    
    _gdLightboxIndex += direction;
    // لف الدائرة لو وصل للآخر
    if (_gdLightboxIndex < 0) _gdLightboxIndex = _gdLightboxImages.length - 1;
    if (_gdLightboxIndex >= _gdLightboxImages.length) _gdLightboxIndex = 0;
    
    document.getElementById('gdLightboxImg').src = _gdLightboxImages[_gdLightboxIndex];
};

// دعم الكيبورد (أسهم يمين/شمال و زرار الهروب)
document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('gdLightbox');
    if (lb && lb.classList.contains('active')) {
        if (e.key === 'ArrowRight') window.gdNavLightbox(1);
        if (e.key === 'ArrowLeft') window.gdNavLightbox(-1);
        if (e.key === 'Escape') window.gdCloseLightbox();
    }
});

// عشان لو ضغط في أي حتة فاضية في الخلفية يقفلها (اختياري بس بيخلي الـ UX أنضف)
document.getElementById('gdLightbox')?.addEventListener('click', (e) => {
    if (e.target.id === 'gdLightbox') window.gdCloseLightbox();
});

// ──────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────
function _gdToYoutubeEmbed(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    // ضفنا الـ origin هنا كمان
    if (match) return `https://www.youtube.com/embed/${match[1]}?autoplay=0&rel=0&origin=http://localhost`;
    return null;
}

function _gdFormatDate(val) {
    if (!val) return null;
    try {
        const d = new Date(val);
        if (isNaN(d)) return String(val);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return String(val); }
}

function _gdTrimUrl(url) {
    return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

// ──────────────────────────────────────────
//  HOOK: ADD CLICK TO GAME CARDS
// ──────────────────────────────────────────
// شلنا الـ DOMContentLoaded عشان الـ Event يتطبق فوراً بدون مشاكل توقيت
document.addEventListener('click', (e) => {
    // لو ضغط على زرار PLAY الموجود جوه الكارت نخليه يلعب مباشرة
    const playBtn = e.target.closest('.play-btn-center');
    if (playBtn) return; // اتركه للـ handler الأصلي

    // 1️⃣ هنا بنراقب الماوس داس فين وهل لقط الكارت ولا لأ
    const card = e.target.closest('.game-card');
    console.log("👉 Click Detected! Found card?", !!card); 

    if (card && !e.target.closest('.asc-unpin-btn') && !e.target.closest('.asc-play-btn')) {
        const gameId = card.getAttribute('data-id');
        
        // 2️⃣ بنراقب الـ ID اللي طلعه من الكارت
        console.log("👉 Card ID:", gameId); 

        if (gameId) {
            e.stopPropagation();
            console.log("👉 Calling openGameDetails with ID:", gameId); // 3️⃣ نتاكد إنه استدعى الدالة
            openGameDetails(gameId);
        }
    }
});

// ──────────────────────────────────────────
//  IPC: REAL DOWNLOAD PROGRESS LISTENER
// ──────────────────────────────────────────
if (window.electronAPI?.onDownloadProgress) {
    window.electronAPI.onDownloadProgress((data) => {
        if (data.gameId !== _gdCurrentGameId) return;
        const dlBar = document.getElementById('gdDlBar');
        if (dlBar) dlBar.style.width = data.percent + '%';
        document.getElementById('gdDlPercent').textContent = data.percent.toFixed(1) + '%';
        document.getElementById('gdDlSpeed').textContent = data.speedMBps.toFixed(1) + ' MB/s';
        document.getElementById('gdDlEta').textContent = data.etaStr;
    });
}
