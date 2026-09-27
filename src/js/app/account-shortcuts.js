'use strict';
// ── Account Shortcuts (Home) ─────────────────────────────────────────────────
// Extracted from app.js. Loaded before app.js in dashboard.html.
// PLATFORM_LOGOS is also read by _suggBadge in app.js via global scope.

const PLATFORM_LOGOS = {
    steam:   { img: '../assets/Steam.png',        name: 'Steam',          color: '#1b2838' },
    epic:    { img: '../assets/epic.svg',          name: 'Epic',           color: '#181818', invert: true },
    gog:     { img: '../assets/gog.png',           name: 'GOG',            color: '#8638e5' },
    ea:      { img: '../assets/ea.png',            name: 'EA App',         color: '#ff6b35' },
    riot:    { img: '../assets/riot.png',          name: 'Riot',           color: '#ff4655' },
    ubisoft: { img: '../assets/Ubisoft.png',       name: 'Ubisoft',        color: '#0070d1', invert: true },
    discord: { img: '../assets/discord.webp',      name: 'Discord',        color: '#5865F2' },
    rockstar: { img: '../assets/rockstar.png',     name: 'Rockstar',       color: '#1a1100' }, // ← ده المفقود
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

    initShortcutsSortable();
}

// ── Drag-and-drop (SortableJS) ────────────────────────────────────────────────
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
        delay: 100, 
        delayOnTouchOnly: true,
        onEnd: () => {
            saveShortcutsOrder(); 
        }
    });
}

function saveShortcutsOrder() {
    const container = document.getElementById('accountsShortcutsInner');
    const cards = container.querySelectorAll('.account-shortcut-card');
    let currentPinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let newOrder = [];

    cards.forEach(card => {
        const plat = card.dataset.platform;
        const prof = card.dataset.profile;
        const acc = currentPinned.find(p => p.platform === plat && p.profileName === prof);
        if (acc) newOrder.push(acc);
    });

    localStorage.setItem('baddel_pinned_accounts', JSON.stringify(newOrder));
}

window.switchPinnedAccount = async function(platform, profileName, btnEl) {
    if (typeof handleSwitchAccount === 'function') {
        await handleSwitchAccount(platform, profileName, btnEl);
    }
};

// ── Explicit window exports ───────────────────────────────────────────────────
window.renderAccountShortcuts = renderAccountShortcuts;
