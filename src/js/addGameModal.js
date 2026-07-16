// ============================================================
// ADD GAME MODAL — MULTI-SELECT (Browse + Path + Drag & Drop)
// ============================================================

let _agCurrentPath   = '';
let _agSelectedGames = []; // [{ path, fileName, name, source }]
let _agCurrentTab    = 'browse';
let _agDropZoneInit  = false;
let pendingImageChanges = {};
let _gsArtworkOpenRequestId = 0;
let _gsCurrentSettingsCanonicalGame = null;

// ── Helpers ──────────────────────────────────────────────────
function _agIsSupportedGameFile(p) {
    return /\.(exe|lnk|url|bat)$/i.test(p);
}

function _agGuessGameName(fullPath, fileName) {
    let name = fileName.replace(/\.[^/.]+$/, '');
    const parts  = fullPath.split(/[\\/]/);
    const parent = parts.length >= 2 ? parts[parts.length - 2] : '';
    if (['game','launcher','app','bin','x64','x86'].includes(name.toLowerCase()) && parent) {
        name = parent;
    }
    return name.replace(/[-_]/g, ' ').trim();
}

function _agNormPath(p) { return (p || '').toLowerCase().replace(/\//g, '\\'); }

// ── Open / Close ────────────────────────────────────────────
function openAddGameModal() {
    document.getElementById('addGameModal').classList.add('active');
    switchAGTab('browse');
    _agOpenPicker();
}

function closeAddGameModal() {
    document.getElementById('addGameModal').classList.remove('active');
    _agReset();
}

function _agReset() {
    _agCurrentPath   = '';
    _agSelectedGames = [];
    const pathInput = document.getElementById('ag-path-input');
    if (pathInput) pathInput.value = '';
    document.getElementById('ag-path-status').innerHTML = '';
    document.getElementById('ag-selected-section').style.display = 'none';
    document.getElementById('ag-selected-games-list').innerHTML  = '';
    const btn = document.getElementById('ag-save-btn');
    btn.disabled = true;
    btn.textContent = 'Add to Library';
    document.getElementById('ag-drop-feedback').innerHTML = '';
    document.getElementById('ag-drop-zone').classList.remove('drag-over', 'drop-success');
    document.querySelectorAll('.ag-dir-item.selected').forEach(el => el.classList.remove('selected'));
}

// ── Tab Switcher ─────────────────────────────────────────────
function switchAGTab(tab) {
    _agCurrentTab = tab;
    ['browse','path','drop'].forEach(t => {
        document.getElementById(`ag-tab-${t}`).classList.toggle('active', t === tab);
        document.getElementById(`ag-panel-${t}`).style.display = t === tab ? 'flex' : 'none';
    });
    if (tab === 'drop' && !_agDropZoneInit) _agInitDropZone();
}

// ── Selection management ─────────────────────────────────────
function _agAddChosenFile(fullPath, fileName, source) {
    const norm = _agNormPath(fullPath);
    if (_agSelectedGames.some(g => _agNormPath(g.path) === norm)) return false;
    _agSelectedGames.push({ path: fullPath, fileName, name: _agGuessGameName(fullPath, fileName), source: source || 'browse' });
    _agRenderSelectedList();
    return true;
}

function _agRemoveSelected(norm) {
    _agSelectedGames = _agSelectedGames.filter(g => _agNormPath(g.path) !== norm);
    document.querySelectorAll('.ag-dir-item[data-path]').forEach(el => {
        if (_agNormPath(el.dataset.path) === norm) el.classList.remove('selected');
    });
    _agRenderSelectedList();
}

function _agClearAllSelected() {
    _agSelectedGames = [];
    document.querySelectorAll('.ag-dir-item.selected').forEach(el => el.classList.remove('selected'));
    _agRenderSelectedList();
}

function _agRenderSelectedList() {
    const section = document.getElementById('ag-selected-section');
    const list    = document.getElementById('ag-selected-games-list');
    const btn     = document.getElementById('ag-save-btn');
    const count   = _agSelectedGames.length;

    if (count === 0) {
        section.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Add to Library';
        return;
    }

    section.style.display = 'flex';
    btn.disabled = false;
    btn.textContent = count === 1 ? 'Add Game' : `Add ${count} Games`;

    list.innerHTML = '';
    _agSelectedGames.forEach((game, idx) => {
        const norm = _agNormPath(game.path);
        const row  = document.createElement('div');
        row.className = 'ag-sel-row';
        row.innerHTML = `
            <span class="ag-sel-filename" title="${game.path}">${game.fileName}</span>
            <input type="text" class="modal-input ag-sel-name-input"
                   value="${game.name.replace(/"/g, '&quot;')}" placeholder="Game name…">
            <button class="ag-sel-remove" title="Remove"
                    data-norm="${norm.replace(/"/g, '&quot;')}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.5" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        row.querySelector('.ag-sel-name-input').addEventListener('input', (e) => {
            _agSelectedGames[idx].name = e.target.value;
        });
        row.querySelector('.ag-sel-remove').addEventListener('click', (e) => {
            _agRemoveSelected(e.currentTarget.dataset.norm);
        });
        list.appendChild(row);
    });

    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Tab: BROWSE ──────────────────────────────────────────────
async function _agOpenPicker() {
    _agCurrentPath = '';
    const pathLabel = document.getElementById('ag-current-path');
    const list      = document.getElementById('ag-dir-list');
    if (pathLabel) pathLabel.innerText = 'Select Drive';
    if (list) list.innerHTML = '<div class="ag-placeholder">Scanning drives…</div>';

    const fallbackIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 20h10"/><path d="M12 18v2"/>
    </svg>`;
    const fallbackDrives = [{ path: 'C:\\', label: 'Local Disk', icon: fallbackIcon, isQuick: false }];

    try {
        const drives = await Promise.race([
            window.electronAPI.getDrives(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('getDrives timeout')), 12000))
        ]);
        _agRenderDirs(Array.isArray(drives) && drives.length ? drives : fallbackDrives, true);
    } catch (e) {
        console.warn('[AddGame] getDrives failed:', e);
        if (typeof showToast === 'function') showToast('Could not scan drives. Showing C:\\ fallback.', 'warning');
        _agRenderDirs(fallbackDrives, true);
        const listEl = document.getElementById('ag-dir-list');
        if (listEl) {
            const warn = document.createElement('div');
            warn.className = 'ag-placeholder';
            warn.style.marginBottom = '10px';
            warn.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
                <span>Drive scan failed. You can still browse from C:\\.</span>
                <button class="ag-mini-btn" onclick="agOpenPicker()">Retry scan</button>
            </div>`;
            listEl.prepend(warn);
        }
    }
}

function agOpenPicker() { _agOpenPicker(); }

async function _agNavigate(p, isDrive) {
    const target = (isDrive || p.includes(':\\')) ? p
        : (_agCurrentPath.endsWith('\\') ? _agCurrentPath + p : _agCurrentPath + '\\' + p);
    _agCurrentPath = target;
    document.getElementById('ag-current-path').innerText = 'Loading…';
    document.getElementById('ag-dir-list').innerHTML = '<div class="ag-placeholder">Loading…</div>';
    try {
        const items = await window.electronAPI.listDirs(target);
        document.getElementById('ag-current-path').innerText = target;
        _agRenderDirs(items, false);
    } catch (e) { showToast('Error loading folder', 'error'); }
}

function agGoBack() {
    if (!_agCurrentPath || _agCurrentPath.length <= 3) { _agOpenPicker(); return; }
    let p = _agCurrentPath.split('\\').filter(x => x);
    p.pop();
    let n = p.join('\\');
    if (p.length === 1 && !n.includes(':')) n += ':\\';
    if (p.length === 1 && n.includes(':') && !n.endsWith('\\')) n += '\\';
    _agNavigate(n, p.length === 1);
}

function _agRenderDirs(items, isDrives = false) {
    const list = document.getElementById('ag-dir-list');
    list.innerHTML = '';
    const searchInput = document.getElementById('ag-browse-search');
    if (searchInput) searchInput.value = '';

    if (!items || items.length === 0) {
        list.innerHTML = "<div class='ag-placeholder'>Empty folder</div>";
        return;
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'ag-dir-item';

        if (isDrives) {
            div.innerHTML = `<div class="ag-item-icon">${item.icon}</div>
                <span class="ag-item-text">${item.isQuick ? item.label : `${item.label} (${item.path})`}</span>`;
            div.onclick = () => _agNavigate(item.path, true);
        } else if (item.type === 'dir') {
            div.innerHTML = `<div class="ag-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg></div><span class="ag-item-text">${item.name}</span>`;
            div.onclick = () => _agNavigate(item.name, false);
        } else {
            const fileExt = item.name.substring(item.name.lastIndexOf('.')).toLowerCase();
            const exeIcon = item.icon
                ? `<img src="${item.icon}" style="width:20px;height:20px;object-fit:contain;">`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="#8e8e93" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                       <rect x="2" y="6" width="20" height="12" rx="2"/>
                       <path d="M6 12h4m-2-2v4m8-2h.01M16 10h.01"/>
                   </svg>`;
            div.dataset.path = item.path;
            // Restore selection state when re-rendering the same folder
            if (_agSelectedGames.some(g => _agNormPath(g.path) === _agNormPath(item.path))) {
                div.classList.add('selected');
            }
            div.innerHTML = `<div class="ag-item-icon">${exeIcon}</div>
                <span class="ag-item-text">${item.name}</span>
                <span class="ag-item-badge">${fileExt}</span>
                <span class="ag-item-check">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </span>`;
            div.onclick = () => _agToggleExe(item.path, item.name, div);
        }

        list.appendChild(div);
    });
}

function _agToggleExe(fullPath, fileName, divEl) {
    const norm = _agNormPath(fullPath);
    if (_agSelectedGames.some(g => _agNormPath(g.path) === norm)) {
        _agRemoveSelected(norm);
        divEl.classList.remove('selected');
    } else {
        _agAddChosenFile(fullPath, fileName, 'browse');
        divEl.classList.add('selected');
    }
}

// ── Tab: PATH ────────────────────────────────────────────────
function agValidatePath() {
    const val  = document.getElementById('ag-path-input').value.trim();
    const btn  = document.getElementById('ag-use-path-btn');
    const stat = document.getElementById('ag-path-status');
    if (!val) { btn.disabled = true; stat.innerHTML = ''; return; }

    const paths      = val.split(/[\n;]/).map(p => p.trim()).filter(Boolean);
    const validCount = paths.filter(p => _agIsSupportedGameFile(p) && p.length > 5).length;
    btn.disabled = validCount === 0;
    if (validCount === paths.length) {
        stat.innerHTML = `<span class="ag-status-ok">✓ ${validCount} valid path${validCount > 1 ? 's' : ''}</span>`;
    } else if (validCount > 0) {
        stat.innerHTML = `<span class="ag-status-warn">⚠ ${validCount} of ${paths.length} valid</span>`;
    } else {
        stat.innerHTML = `<span class="ag-status-warn">⚠ Path must end with .exe, .lnk, .url, or .bat</span>`;
    }
}

function agUsePath() {
    const val = document.getElementById('ag-path-input').value.trim();
    if (!val) return;
    const paths = val.split(/[\n;]/).map(p => p.trim()).filter(p => p && _agIsSupportedGameFile(p) && p.length > 5);
    if (!paths.length) return;

    let added = 0, skipped = 0;
    paths.forEach(p => {
        const parts    = p.split(/[\\/]/);
        const fileName = parts[parts.length - 1];
        (_agAddChosenFile(p, fileName, 'path') ? added++ : skipped++);
    });

    if (added === 0) {
        showToast('All paths already in selection', 'warning');
    } else if (skipped > 0) {
        showToast(`Added ${added}, skipped ${skipped} duplicate${skipped > 1 ? 's' : ''}`, 'info');
    }
    document.getElementById('ag-path-input').value = '';
    document.getElementById('ag-path-status').innerHTML = '';
    document.getElementById('ag-use-path-btn').disabled = true;
}

// ── Tab: DRAG & DROP ─────────────────────────────────────────
function _agInitDropZone() {
    _agDropZoneInit = true;
    const zone = document.getElementById('ag-drop-zone');

    zone.addEventListener('dragover',  (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove('drag-over');

        const files = Array.from(e.dataTransfer.files || []);
        if (!files.length) return;

        let added = 0, skipped = 0, invalid = 0;
        files.forEach(file => {
            let filePath = file.path;
            if (!filePath && window.electronAPI?.getFilePath) {
                try { filePath = window.electronAPI.getFilePath(file); } catch {}
            }
            if (!filePath) filePath = file.name;

            if (!_agIsSupportedGameFile(filePath) && !_agIsSupportedGameFile(file.name)) {
                invalid++; return;
            }
            (_agAddChosenFile(filePath || file.name, file.name, 'drop') ? added++ : skipped++);
        });

        const feedback = document.getElementById('ag-drop-feedback');
        const parts = [];
        if (added > 0)   parts.push(`<span class="ag-status-ok">✓ Added ${added} file${added > 1 ? 's' : ''}</span>`);
        if (skipped > 0) parts.push(`<span class="ag-status-warn">⚠ ${skipped} duplicate${skipped > 1 ? 's' : ''} skipped</span>`);
        if (invalid > 0) parts.push(`<span class="ag-status-warn">⚠ ${invalid} unsupported file${invalid > 1 ? 's' : ''} ignored</span>`);
        feedback.innerHTML = parts.join(' &nbsp;');
        if (added > 0) zone.classList.add('drop-success');
    });
}

// ── Browse search filter ─────────────────────────────────────
function agFilterBrowse() {
    const query = document.getElementById('ag-browse-search').value.toLowerCase();
    document.querySelectorAll('#ag-dir-list .ag-dir-item').forEach(item => {
        const text = item.querySelector('.ag-item-text')?.innerText.toLowerCase() || '';
        item.style.display = text.includes(query) ? 'flex' : 'none';
    });
}

// ── Finalize (Save) ─────────────────────────────────────────
async function agFinalizeAddGame() {
    if (_agSelectedGames.length === 0) return showToast('No games selected', 'error');

    const btn   = document.getElementById('ag-save-btn');
    const total = _agSelectedGames.length;
    btn.disabled = true;

    // Sync names from inputs one final time
    document.querySelectorAll('.ag-sel-row').forEach((row, idx) => {
        const ni = row.querySelector('.ag-sel-name-input');
        if (ni && _agSelectedGames[idx]) {
            const v = ni.value.trim();
            if (v) _agSelectedGames[idx].name = v;
        }
    });

    let successCount = 0, failCount = 0;
    const addedGames = [];
    for (let i = 0; i < total; i++) {
        const game = _agSelectedGames[i];
        if (!game.name) { failCount++; continue; }
        btn.textContent = `Adding ${i + 1}/${total}…`;
        try {
            const res = await window.electronAPI.addManualGame(game.path, game.name);
            if (res && res.status === 'error') failCount++;
            else {
                successCount++;
                if (res?.game) addedGames.push(res.game);
            }
        } catch (e) {
            console.error('[AddGame] failed:', game.path, e);
            failCount++;
        }
    }

    if (successCount > 0) {
        const msg = failCount > 0
            ? `Added ${successCount} game${successCount > 1 ? 's' : ''}, ${failCount} failed`
            : `Added ${successCount} game${successCount > 1 ? 's' : ''} successfully`;
        showToast(msg, failCount > 0 ? 'warning' : 'success');
        window.electronAPI.logGameAddedManual?.();
        currentFilters.collectionId = null;

        closeAddGameModal();

        const hydratedGames = [];
        for (const g of addedGames) {
            if (typeof window.hydrateManualGameArtworkNow === 'function') {
                try {
                    const hydrated = await window.hydrateManualGameArtworkNow(g);
                    hydratedGames.push(hydrated || g);
                } catch (e) {
                    console.error('[ManualAddArtwork] hydrate failed', g.id, e);
                    hydratedGames.push(g);
                }
            } else {
                hydratedGames.push(g);
            }
        }

        allGamesData = await window.electronAPI.getGames();

        for (const g of hydratedGames) {
            if (typeof _patchGameInMemory === 'function') _patchGameInMemory(g);
        }

        applyFilters();
        renderExploreCarousel();
    } else {
        showToast(`Failed to add ${failCount} game${failCount > 1 ? 's' : ''}`, 'error');
        btn.disabled = false;
        btn.textContent = total === 1 ? 'Add Game' : `Add ${total} Games`;
    }
}

// ============================================================
// GAME SETTINGS — LOGO SUPPORT & BETTER IMAGE PREVIEW
// ============================================================

async function openGameSettings(id) {
    if (typeof hideContextMenu === 'function') hideContextMenu();
    pendingImageChanges = {};
    selectedGameId = id;
    const requestId = ++_gsArtworkOpenRequestId;
    const modal = document.getElementById('gameSettingsModal');
    if (modal) modal.classList.add('is-loading-artwork');
    let displayGame = allGamesData.find(x => String(x.id) === String(id));
    if (!displayGame && Array.isArray(window._allGamesCache)) {
        displayGame = window._allGamesCache.find(x => String(x.id || x.appName || x.title) === String(id));
    }
    if (!displayGame) {
        if (modal) modal.classList.remove('is-loading-artwork');
        return;
    }
    let g = displayGame;
    const recordsBeforeRefresh = Array.isArray(window.__baddelCanonicalGames) ? window.__baddelCanonicalGames : [];
    const resolvedBeforeRefresh = window.BaddelCanonicalGameIdentityResolver?.resolveCanonicalGameIdentity
        ? window.BaddelCanonicalGameIdentityResolver.resolveCanonicalGameIdentity(displayGame, recordsBeforeRefresh)
        : null;
    const matchedBeforeRefresh = resolvedBeforeRefresh?.status === 'success' ? resolvedBeforeRefresh.game : null;
    const readBeforeRefresh = window.BaddelGameArtworkReadModel?.buildGameArtworkReadModel && matchedBeforeRefresh
        ? window.BaddelGameArtworkReadModel.buildGameArtworkReadModel({ displayGame, canonicalGame: matchedBeforeRefresh })
        : null;
    const matchedMissingTypes = matchedBeforeRefresh && readBeforeRefresh
        ? ['cover', 'hero', 'logo'].some(type => !readBeforeRefresh[type]?.effectiveValue && !_gsDisplayHasArtworkType(displayGame, type))
        : false;
    const needsCanonicalRefresh = recordsBeforeRefresh.length === 0 ||
        window.__baddelCanonicalRegistryRefreshInFlight ||
        (resolvedBeforeRefresh && resolvedBeforeRefresh.status !== 'success') ||
        matchedMissingTypes;
    if (window.__baddelRefreshCanonicalGamesRegistry && needsCanonicalRefresh) {
        await window.__baddelRefreshCanonicalGamesRegistry('game-settings-open');
        if (requestId !== _gsArtworkOpenRequestId || String(selectedGameId) !== String(id)) return;
    }
    const records = Array.isArray(window.__baddelCanonicalGames) ? window.__baddelCanonicalGames : [];
    const resolvedAfterRefresh = window.BaddelCanonicalGameIdentityResolver?.resolveCanonicalGameIdentity
        ? window.BaddelCanonicalGameIdentityResolver.resolveCanonicalGameIdentity(displayGame, records)
        : null;
    const canonicalGame = resolvedAfterRefresh?.status === 'success' ? resolvedAfterRefresh.game : null;
    _gsCurrentSettingsCanonicalGame = canonicalGame || g;
    if (g && window.BaddelCanonicalArtworkProjection?.projectFromRecords) {
        g = window.BaddelCanonicalArtworkProjection.projectFromRecords(displayGame, records) || displayGame;
    }
    const cacheArtwork = window.__baddelLoadCachedArtworkForGame
        ? await window.__baddelLoadCachedArtworkForGame(displayGame, canonicalGame || g)
        : null;
    if (requestId !== _gsArtworkOpenRequestId || String(selectedGameId) !== String(id)) return;
    await _gsPromoteCacheFallbacks(displayGame, canonicalGame || g, cacheArtwork);
    if (requestId !== _gsArtworkOpenRequestId || String(selectedGameId) !== String(id)) return;

    document.getElementById('editGameNameInput').value = g.name;

    // Init hero drag-to-pan
    // Init drag-to-pan for both Hero and Cover
    _gsInitImagePan('gs-hero-wrapper', 'previewHero');
    _gsInitImagePan('gs-cover-wrapper', 'previewCover');

    // update images
    const readModel = window.BaddelGameArtworkReadModel?.buildGameArtworkReadModel
        ? window.BaddelGameArtworkReadModel.buildGameArtworkReadModel({
            displayGame,
            canonicalGame: canonicalGame || g,
            platformArtwork: displayGame,
            cacheArtwork,
        })
        : null;
    _gsSetArtworkPreview(document.getElementById('previewHero'), [readModel?.hero?.effectiveValue, g.heroImage, displayGame.heroImage, cacheArtwork?.hero, g.defaultHero], 'assets/No_Image_Available.jpg', requestId);
    _gsSetArtworkPreview(document.getElementById('previewCover'), [readModel?.cover?.effectiveValue, g.image, displayGame.image, cacheArtwork?.cover, g.defaultImage, g.coverUrl], 'assets/No_Image_Available.jpg', requestId);
    _gsUpdateLogoPreview([readModel?.logo?.effectiveValue, g.logo, displayGame.logo, cacheArtwork?.logo], requestId);
    
    _gsSetResetButtonState('cover', canonicalGame || g);
    _gsSetResetButtonState('hero', canonicalGame || g);
    _gsSetResetButtonState('logo', canonicalGame || g);
    
    // open modal
    document.getElementById('gameSettingsModal').classList.add('active');
    overlay.classList.add('active');
    if (modal) modal.classList.remove('is-loading-artwork');

    checkResetAllButtonState();

    document.getElementById('gameSettingsModal').classList.add('active');
}

function _gsNormalizeCandidates(candidates) {
    const seen = new Set();
    return (Array.isArray(candidates) ? candidates : [candidates])
        .map(src => safeImageUrl(src))
        .filter(Boolean)
        .filter(src => {
            if (seen.has(src)) return false;
            seen.add(src);
            return true;
        });
}

function _gsDisplayHasArtworkType(game, type) {
    if (!game) return false;
    if (type === 'cover') return Boolean(game.image || game.cover || game.coverUrl || game.defaultImage);
    if (type === 'hero') return Boolean(game.heroImage || game.hero || game.heroUrl || game.defaultHero);
    if (type === 'logo') return Boolean(game.logo || game.logoUrl || game.defaultLogo);
    return false;
}

function _gsSetArtworkPreview(imgEl, candidates, placeholder, requestId = _gsArtworkOpenRequestId) {
    if (!imgEl) return;
    const queue = _gsNormalizeCandidates(candidates);
    let index = 0;
    const applyNext = () => {
        if (requestId !== _gsArtworkOpenRequestId) return;
        const next = queue[index++] || placeholder;
        imgEl.src = next;
        imgEl.style.display = 'block';
    };
    imgEl.onerror = () => {
        if (requestId !== _gsArtworkOpenRequestId) return;
        if (index < queue.length) {
            applyNext();
            return;
        }
        imgEl.onerror = null;
        imgEl.src = placeholder;
    };
    applyNext();
}

function _gsUpdateLogoPreview(candidates, requestId = _gsArtworkOpenRequestId) {
    const logoEl  = document.getElementById('previewLogo');
    const emptyEl = document.getElementById('gs-logo-empty');
    const queue = _gsNormalizeCandidates(candidates);
    let index = 0;
    const showEmpty = () => {
        logoEl.src = '';
        logoEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'flex';
    };
    const applyNext = () => {
        if (requestId !== _gsArtworkOpenRequestId) return;
        const next = queue[index++];
        if (!next) {
            logoEl.onerror = null;
            showEmpty();
            return;
        }
        logoEl.src = next;
        logoEl.style.display = 'block';
        if (emptyEl) emptyEl.style.display = 'none';
    };
    logoEl.onerror = () => {
        if (requestId !== _gsArtworkOpenRequestId) return;
        if (index < queue.length) applyNext();
        else showEmpty();
    };
    applyNext();
}

function _gsHasExplicitOverride(game, type) {
    const item = game?.artworkState?.version === 2 ? game.artworkState[type] : null;
    return Boolean(item?.locked === true && item?.overrideValue);
}

function _gsArtworkItem(game, type) {
    return game?.artworkState?.version === 2 ? game.artworkState[type] : null;
}

function _gsSetResetButtonState(type, game, { pendingReset = false } = {}) {
    const btn = document.getElementById(`btn-reset-${type}`);
    if (!btn) return;
    const item = _gsArtworkItem(game, type);
    btn.disabled = pendingReset ? true : !(item?.locked === true && item?.overrideValue);
}

function checkResetAllButtonState() {
    const btn = document.getElementById('btn-reset-all');
    if (!btn) return;
    const g = _gsCurrentSettingsCanonicalGame ||
        allGamesData.find(x => String(x.id) === String(selectedGameId));
    const hasResettableType = ['cover', 'hero', 'logo'].some(type => {
        if (pendingImageChanges[type]?.action === 'reset') return false;
        return _gsHasExplicitOverride(g, type);
    });
    btn.disabled = !hasResettableType;
}

function _gsHasAnyCanonicalValue(game, type) {
    const item = game?.artworkState?.version === 2 ? game.artworkState[type] : null;
    return Boolean(item?.overrideValue || item?.fallbackValue);
}

async function _gsPromoteCacheFallbacks(displayGame, canonicalGame, cacheArtwork) {
    if (!cacheArtwork || !canonicalGame || !window.electronAPI?.setGameArtwork) return;
    const updates = {};
    for (const type of ['cover', 'hero', 'logo']) {
        if (cacheArtwork[type] && !_gsHasAnyCanonicalValue(canonicalGame, type)) {
            updates[type] = cacheArtwork[type];
        }
    }
    if (!Object.keys(updates).length) return;
    const identity = _gsBuildArtworkIdentity(canonicalGame || displayGame, selectedGameId);
    const res = await window.electronAPI.setGameArtwork(identity, updates, {
        source: 'cache-recovery',
        mode: 'fallback',
    }).catch(() => null);
    if (res?.persisted && res.updatedGame) {
        window.__baddelUpsertCanonicalGameRegistry?.(res.updatedGame);
    }
}

// Hero pan interaction
// Universal Image Pan interaction (Works for X and Y axes)
function _gsInitImagePan(wrapperId, imgId) {
    const wrapper = document.getElementById(wrapperId);
    const img = document.getElementById(imgId);
    if (!wrapper || !img) return;

    const cloned = wrapper.cloneNode(true);
    wrapper.parentNode.replaceChild(cloned, wrapper);

    const newWrapper = document.getElementById(wrapperId);
    const newImg = document.getElementById(imgId);
    const hint = newWrapper.querySelector('.gs-hero-pan-hint');

    newImg.style.objectFit = 'cover';
    if (!newImg.style.objectPosition) newImg.style.objectPosition = '50% 50%';

    let isDragging = false, startX = 0, startY = 0;
    let startPosX = 50, startPosY = 50;

    newWrapper.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const pos = newImg.style.objectPosition.split(' ');
        startPosX = parseFloat(pos[0]) || 50;
        startPosY = parseFloat(pos[1]) || 50;
        
        newWrapper.style.cursor = 'grabbing';
        if (hint) hint.style.opacity = '0';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        const percentX = (dx / newWrapper.offsetWidth) * 100 * 0.8;
        const percentY = (dy / newWrapper.offsetHeight) * 100 * 0.8;
        
        let newPosX = Math.max(0, Math.min(100, startPosX - percentX));
        let newPosY = Math.max(0, Math.min(100, startPosY - percentY));
        
        newImg.style.objectPosition = `${newPosX}% ${newPosY}%`;
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            newWrapper.style.cursor = 'grab';
        }
    });

    newImg.onload = () => { newImg.style.objectPosition = '50% 50%'; };
}

async function changeGameImage(type) {
    if (!selectedGameId) return;
    const newPath = await window.electronAPI.selectImage();
    if (!newPath) return;

    const safePath = `file://${newPath.replace(/\\/g, '/')}`;

    
    pendingImageChanges[type] = { action: 'update', path: safePath };

    if (type === 'cover') {
        document.getElementById('previewCover').src = safePath;
    } else if (type === 'hero') {
        document.getElementById('previewHero').src = safePath;
        document.getElementById('previewHero').style.marginLeft = '0';
    } else if (type === 'logo') {
        _gsUpdateLogoPreview(safePath);
    }

    const btn = document.getElementById(`btn-reset-${type}`);
    if (btn) btn.disabled = false;
    
    if (typeof checkResetAllButtonState === 'function') checkResetAllButtonState();
}

async function resetGameImage(type, skipToast = false) {
    if (!selectedGameId) return;
    if (!['cover', 'hero', 'logo'].includes(type)) return;

    pendingImageChanges[type] = { action: 'reset' };

    let restoredPath = null;
    const g = allGamesData.find(x => String(x.id) === String(selectedGameId));
    const canonicalGame = _gsCurrentSettingsCanonicalGame || g;
    
    if (canonicalGame || g) {
        restoredPath = _gsArtworkItem(canonicalGame, type)?.fallbackValue || null;
        if (!restoredPath && type === 'cover') restoredPath = canonicalGame?.defaultImage || g?.defaultImage;
        else if (!restoredPath && type === 'hero') restoredPath = canonicalGame?.defaultHero || g?.defaultHero;
        else if (!restoredPath && type === 'logo') restoredPath = canonicalGame?.defaultLogo || g?.defaultLogo;
    }

    if (!restoredPath && window.electronAPI && window.electronAPI.getCachedImage) {
        try {
            restoredPath = await window.electronAPI.getCachedImage(selectedGameId, type);
        } catch (err) {
            console.error('Failed to read cached image:', err);
        }
    }

    if (type === 'cover') {
        _gsSetArtworkPreview(document.getElementById('previewCover'), [restoredPath], 'assets/No_Image_Available.jpg');
    } else if (type === 'hero') {
        const heroImg = document.getElementById('previewHero');
        _gsSetArtworkPreview(heroImg, [restoredPath], 'assets/No_Image_Available.jpg');
        heroImg.style.objectPosition = '50% 50%'; 
    } else if (type === 'logo') {
        _gsUpdateLogoPreview(restoredPath || null);
    }

    _gsSetResetButtonState(type, null, { pendingReset: true });
    
    if (typeof checkResetAllButtonState === 'function') {
        checkResetAllButtonState();
    }

    if (!skipToast) showToast(`${type} set to default (Click Save to apply)`, 'info');

}

async function resetAllGameImages() {
    if (!selectedGameId) return;
    for (const type of ['cover', 'hero', 'logo']) {
        await resetGameImage(type, true);
    }
    showToast('All artwork set to default (Click Save to apply)', 'info');
}

function _gsLooseKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function _gsAddKey(set, value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw) set.add(raw);

    const loose = _gsLooseKey(value);
    if (loose) set.add(loose);
}

function _gsCollectAgPatchKeys(game = {}) {
    const keys = new Set();

    [
        game.id,
        game.installedId,
        game.appName,
        game.appid,
        game.appId,
        game.namespace,
        game.catalogNamespace,
        game.catalogItemId,
        game.launcherGameId,
        game.allIds?.steam,
        game.allIds?.epic,
        game.originalName,
        game.originalTitle,
        game.name,
        game.title
    ].forEach(v => _gsAddKey(keys, v));

    [
        game.originalName,
        game.originalTitle,
        game.name,
        game.title
    ].forEach(v => {
        const titleKey = _gsLooseKey(v);
        if (titleKey) keys.add(`title:${titleKey}`);
    });

    return keys;
}

function _gsMatchesAgGame(localGame, agGame) {
    const localKeys = _gsCollectAgPatchKeys(localGame);
    const agKeys = _gsCollectAgPatchKeys(agGame);

    for (const key of agKeys) {
        if (localKeys.has(key)) return true;
    }

    return false;
}

function _gsPatchAllGamesTitleAfterRename(localGame, newName) {
    const patchOne = (game) => {
        if (!game || !_gsMatchesAgGame(localGame, game)) return false;

        game.title = newName;
        game.name = newName;
        game.customTitle = newName;
        game.customTitleLocked = true;
        game.titleSource = 'creator';
        game.titleUpdatedAt = localGame.titleUpdatedAt || Date.now();

        return true;
    };

    let changed = 0;

    if (Array.isArray(window._allGamesCache)) {
        window._allGamesCache.forEach(g => {
            if (patchOne(g)) changed++;
        });
    }

    if (Array.isArray(window._vs?.items)) {
        window._vs.items.forEach(g => {
            if (patchOne(g)) changed++;
        });
    }

    if (window._vs?.cardCache instanceof Map) {
        window._vs.cardCache.clear();
    }

    if (changed > 0 && typeof _applyAgFilters === 'function') {
        try {
            _applyAgFilters({ resetScroll: false });
        } catch (_) {}
    }

    if (changed > 0 && typeof window._vsRender === 'function') {
        try {
            window._vsRender(true);
        } catch (_) {}
    }
}

function _gsBuildArtworkIdentity(game, uiId) {
    const allIds = (game && typeof game.allIds === 'object') ? { ...game.allIds } : {};
    return {
        id: uiId,
        gameId: uiId,
        localGameId: game?.localGameId,
        installedId: game?.installedId,
        installedGameKey: game?.installedGameKey,
        command: game?.command,
        executablePath: game?.executablePath,
        path: game?.path,
        launchCommand: game?.launchCommand,
        shortcutPath: game?.shortcutPath,
        allIds,
        platform: game?.platform,
        appId: game?.appId,
        appid: game?.appid,
        steamAppId: game?.steamAppId,
        steam_appid: game?.steam_appid,
        appName: game?.appName,
        launcherGameId: game?.launcherGameId,
        namespace: game?.namespace,
        catalogNamespace: game?.catalogNamespace,
        catalogItemId: game?.catalogItemId,
    };
}

function _gsLogArtworkIdentityFailure(uiId, game, res) {
    console.warn('[ArtworkIdentity] Settings artwork save failed', {
        uiId: String(uiId || ''),
        localGameId: game?.localGameId || null,
        installedId: game?.installedId || null,
        installedGameKey: game?.installedGameKey || null,
        steam: game?.allIds?.steam || game?.steamAppId || game?.steam_appid || null,
        epic: game?.appName || game?.launcherGameId || null,
        status: res?.status || 'error',
        message: res?.message || 'Game not found',
    });
}

function _gsArtworkOperationId(prefix = 'settings-artwork') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function _gsExpectedArtworkRevisions(game, types) {
    const revisions = {};
    for (const type of types) {
        const item = _gsArtworkItem(game, type);
        if (item && item.revision != null) revisions[type] = item.revision;
    }
    return revisions;
}

async function _gsRefreshOpenModalArtwork(displayGame, canonicalSavedGame, changedTypes) {
    if (!canonicalSavedGame || !Array.isArray(changedTypes) || changedTypes.length === 0) return;
    const cacheArtwork = window.__baddelLoadCachedArtworkForGame
        ? await window.__baddelLoadCachedArtworkForGame(displayGame, canonicalSavedGame).catch(() => null)
        : null;
    const readModel = window.BaddelGameArtworkReadModel?.buildGameArtworkReadModel
        ? window.BaddelGameArtworkReadModel.buildGameArtworkReadModel({
            displayGame,
            canonicalGame: canonicalSavedGame,
            platformArtwork: displayGame,
            cacheArtwork,
        })
        : null;

    if (changedTypes.includes('cover')) {
        _gsSetArtworkPreview(document.getElementById('previewCover'), [readModel?.cover?.effectiveValue], 'assets/No_Image_Available.jpg');
        _gsSetResetButtonState('cover', canonicalSavedGame);
    }
    if (changedTypes.includes('hero')) {
        const heroImg = document.getElementById('previewHero');
        _gsSetArtworkPreview(heroImg, [readModel?.hero?.effectiveValue], 'assets/No_Image_Available.jpg');
        if (heroImg) heroImg.style.objectPosition = '50% 50%';
        _gsSetResetButtonState('hero', canonicalSavedGame);
    }
    if (changedTypes.includes('logo')) {
        _gsUpdateLogoPreview(readModel?.logo?.effectiveValue || null);
        _gsSetResetButtonState('logo', canonicalSavedGame);
    }
}

async function saveGameSettings() {
    if (!selectedGameId) return;

    const g = allGamesData.find(x => String(x.id) === String(selectedGameId));
    if (!g) return;

    const _patch = {};
    const _artworkTs    = Date.now();  // single timestamp for the whole settings save
    const _changedTypes = [];          // tracks which art types were updated (cover/hero/logo)
    const _atomicArtworkUpdatedTypes = new Set();
    let canonicalSavedGame = null;
    const artworkPlan = {
        updates: {},
        resets: [],
    };
    for (const type of ['cover', 'hero', 'logo']) {
        const change = pendingImageChanges[type];
        if (change?.action === 'update') artworkPlan.updates[type] = change.path;
        if (change?.action === 'reset') artworkPlan.resets.push(type);
    }

    const nameInput = document.getElementById('editGameNameInput');
    if (nameInput) {
        const newName = nameInput.value.trim();
        if (newName && newName !== g.name) {
            const oldName = g.name || g.title || '';
            const res = await window.electronAPI.renameGame(selectedGameId, newName);

            if (!g.originalName && oldName && oldName !== newName) {
                g.originalName = oldName;
            }

            g.name = newName;
            g.title = newName;
            g.customTitle = newName;
            g.customTitleLocked = true;
            g.titleSource = 'creator';
            g.titleUpdatedAt = res?.titleUpdatedAt || Date.now();
            _patch.name = newName;

            if (typeof _gsPatchAllGamesTitleAfterRename === 'function') {
                _gsPatchAllGamesTitleAfterRename(g, newName);
            }
        }
    }

    const _artworkUpdates = artworkPlan.updates;
    if (Object.keys(_artworkUpdates).length && typeof window.electronAPI.setGameArtwork === 'function') {
        const identity = _gsBuildArtworkIdentity(g, selectedGameId);
        const res = await window.electronAPI.setGameArtwork(identity, _artworkUpdates, {
            source: 'settings',
            updatedAt: _artworkTs,
        });
        if (!res || res.status !== 'success' || res.persisted !== true || !res.updatedGame) {
            _gsLogArtworkIdentityFailure(selectedGameId, g, res);
            showToast(res?.message || 'Artwork save failed', 'error');
            return;
        }

        const canonicalGame = res.updatedGame || {};
        canonicalSavedGame = canonicalGame;
        _gsCurrentSettingsCanonicalGame = canonicalSavedGame;
        Object.assign(g, canonicalGame);
        g.localGameId = res.canonicalGameId || g.localGameId;
        g.installedId = g.installedId || res.canonicalGameId || canonicalGame.id;

        for (const type of Object.keys(_artworkUpdates)) {
            _atomicArtworkUpdatedTypes.add(type);
            _changedTypes.push(type);
            localStorage.removeItem(`${type}_${selectedGameId}`);
            if (res.canonicalGameId) localStorage.removeItem(`${type}_${res.canonicalGameId}`);
            if (type === 'cover') _patch.cover = canonicalGame.image || canonicalGame.cover || _artworkUpdates[type];
            if (type === 'hero')  _patch.hero  = canonicalGame.heroImage || canonicalGame.hero || _artworkUpdates[type];
            if (type === 'logo')  _patch.logo  = canonicalGame.logo || _artworkUpdates[type];
        }
        _patch.artworkState = canonicalGame.artworkState;
        _patch.customArtworkLocked = canonicalGame.customArtworkLocked;
        _patch.artworkSource = canonicalGame.artworkSource;
        _patch.artworkUpdatedAt = canonicalGame.artworkUpdatedAt || _artworkTs;
        void window._gdClearCustomDetailArtwork;
        void window._gdApplyExternalPatch;
        console.info('[ArtworkStateV2] Settings artwork persisted', {
            uiId: String(selectedGameId),
            canonicalId: String(res.canonicalGameId || ''),
            matchReason: String(res.matchReason || ''),
            types: Object.keys(_artworkUpdates),
            perType: res.perType || {},
        });
    }

    if (artworkPlan.resets.length && typeof window.electronAPI.resetGameArtwork === 'function') {
        const identity = _gsBuildArtworkIdentity(canonicalSavedGame || g, selectedGameId);
        const operationId = _gsArtworkOperationId('settings-reset');
        const res = await window.electronAPI.resetGameArtwork(identity, {
            types: artworkPlan.resets,
            operationId,
            expectedRevisions: _gsExpectedArtworkRevisions(canonicalSavedGame || g, artworkPlan.resets),
            updatedAt: _artworkTs,
        });
        if (!res || (res.status !== 'success' && res.status !== 'partial') || res.persisted !== true || !res.updatedGame) {
            _gsLogArtworkIdentityFailure(selectedGameId, g, res);
            showToast(res?.message || 'Artwork reset failed', 'error');
            return;
        }

        const failedResetTypes = Object.entries(res.results || {})
            .filter(([, result]) => result?.applied === false)
            .map(([type]) => type);
        const successfulResetTypes = artworkPlan.resets.filter(type => !failedResetTypes.includes(type));

        canonicalSavedGame = res.updatedGame;
        _gsCurrentSettingsCanonicalGame = canonicalSavedGame;
        Object.assign(g, canonicalSavedGame);
        g.localGameId = res.canonicalGameId || g.localGameId;
        g.installedId = g.installedId || res.canonicalGameId || canonicalSavedGame.id;

        for (const type of successfulResetTypes) {
            _atomicArtworkUpdatedTypes.add(type);
            _changedTypes.push(type);
            localStorage.removeItem(`${type}_${selectedGameId}`);
            if (res.canonicalGameId) localStorage.removeItem(`${type}_${res.canonicalGameId}`);
            if (type === 'cover') _patch.cover = canonicalSavedGame.image || null;
            if (type === 'hero')  _patch.hero  = canonicalSavedGame.heroImage || null;
            if (type === 'logo') {
                _patch.logo = canonicalSavedGame.logo || null;
                _patch.logoCleared = !canonicalSavedGame.logo;
            }
        }

        _patch.artworkState = canonicalSavedGame.artworkState;
        _patch.customArtworkLocked = canonicalSavedGame.customArtworkLocked;
        _patch.artworkSource = canonicalSavedGame.artworkSource;
        _patch.artworkUpdatedAt = canonicalSavedGame.artworkUpdatedAt || _artworkTs;

        if (failedResetTypes.length) {
            for (const type of successfulResetTypes) delete pendingImageChanges[type];
            if (canonicalSavedGame && typeof window.__baddelCommitCanonicalGameUpdate === 'function') {
                window.__baddelCommitCanonicalGameUpdate(canonicalSavedGame, {
                    reason: 'settings-reset',
                    changedTypes: successfulResetTypes,
                });
            }
            await _gsRefreshOpenModalArtwork(g, canonicalSavedGame, successfulResetTypes);
            showToast(`Artwork reset failed for: ${failedResetTypes.join(', ')}`, 'error');
            return;
        }
    } else if (artworkPlan.resets.length) {
        showToast('Artwork reset failed: reset service unavailable', 'error');
        return;
    }

    for (const type in pendingImageChanges) {
        const change = pendingImageChanges[type];

        if (change.action === 'update') {
            if (_atomicArtworkUpdatedTypes.has(type)) continue;
            const identity = _gsBuildArtworkIdentity(g, selectedGameId);
            const res = await window.electronAPI.updateGameImage(identity, change.path, type, {
                source: 'settings',
                locked: true,
                updatedAt: _artworkTs,
            });
            if (!res || res.status !== 'success' || res.persisted !== true || !res.updatedGame) {
                _gsLogArtworkIdentityFailure(selectedGameId, g, res);
                showToast(res?.message || 'Artwork save failed', 'error');
                return;
            }

            const savedPath = res.path || change.path;
            const canonicalGame = res.updatedGame || {};
            if (canonicalGame.id) canonicalSavedGame = canonicalGame;
            localStorage.removeItem(`${type}_${selectedGameId}`);
            if (res.canonicalGameId) localStorage.removeItem(`${type}_${res.canonicalGameId}`);

            if (type === 'cover') {
                g.cover        = savedPath;
                g.image        = savedPath;
                g.coverUrl     = savedPath;
                g.defaultImage = savedPath;
                _patch.cover   = savedPath;
            }
            if (type === 'hero') {
                g.hero        = savedPath;
                g.heroImage   = savedPath;
                g.heroUrl     = savedPath;
                g.defaultHero = savedPath;
                _patch.hero   = savedPath;
            }
            if (type === 'logo') {
                g.logo        = savedPath;
                g.logoUrl     = savedPath;
                g.defaultLogo = savedPath;
                _patch.logo   = savedPath;
            }

            _changedTypes.push(type);

            // Keep frontend memory in sync immediately.
            // Use artworkSource:'settings' (not 'creator') so Game Detail
            // priority logic knows a newer Settings save overrides older Creator art.
            g.customArtworkLocked = true;
            g.artworkSource    = 'settings';
            g.artworkUpdatedAt = res.artworkUpdatedAt || _artworkTs;
            g.localGameId = res.canonicalGameId || g.localGameId;
            g.installedId = g.installedId || res.canonicalGameId || canonicalGame.id;
            console.info('[ArtworkIdentity] uiId=' + String(selectedGameId) +
                ' canonicalId=' + String(res.canonicalGameId || '') +
                ' matchReason=' + String(res.matchReason || '') +
                ' source=settings');
        }
    }

    // Propagate changes to all live in-memory stores (sugg rail, _allGamesCache, VS)
    if (Object.keys(_patch).length) {
        if (!_changedTypes.length && typeof window.__baddelApplyGameCustomOverride === 'function') {
            window.__baddelApplyGameCustomOverride(g, _patch);
        }
        // Clear stale Creator Mode artwork from localStorage customGameDetails so
        // _gdApplyCustomToGame no longer lets old posterImage win over game.image.
        if (_changedTypes.length && typeof window._gdClearCustomDetailArtwork === 'function') {
            window._gdClearCustomDetailArtwork(g, _changedTypes);
        }
        // Content-only saves still need the direct detail patcher. Artwork saves
        // are projected once through __baddelCommitCanonicalGameUpdate below.
        if (!_changedTypes.length && typeof window._gdApplyExternalPatch === 'function') {
            window._gdApplyExternalPatch(g, _patch);
        }
    }
    if (canonicalSavedGame && typeof window.__baddelCommitCanonicalGameUpdate === 'function') {
        window.__baddelCommitCanonicalGameUpdate(canonicalSavedGame, {
            reason: artworkPlan.resets.length && !Object.keys(artworkPlan.updates).length ? 'settings-reset' : 'settings-save',
            changedTypes: _changedTypes,
        });
    }
    await _gsRefreshOpenModalArtwork(g, canonicalSavedGame, _changedTypes);

    pendingImageChanges = {};

    showToast('Settings saved successfully!', 'success');
    if (!_changedTypes.length) {
        refreshAllViews();
    }
    closeGameSettings();
}
