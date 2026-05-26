// ============================================================
// ADD GAME MODAL — MULTI-SELECT (Browse + Path + Drag & Drop)
// ============================================================

let _agCurrentPath   = '';
let _agSelectedGames = []; // [{ path, fileName, name, source }]
let _agCurrentTab    = 'browse';
let _agDropZoneInit  = false;
let pendingImageChanges = {};

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

// استبدل openGameSettings القديمة بالتالية:
function openGameSettings(id) {
    pendingImageChanges = {};
    selectedGameId = id;
    const g = allGamesData.find(x => String(x.id) === String(id));
    if (!g) return;

    document.getElementById('editGameNameInput').value = g.name;

    // Cover
    const coverEl = document.getElementById('previewCover');
    coverEl.src = g.image || '../assets/logo.png';

    // Hero
    const heroEl = document.getElementById('previewHero');
    heroEl.src = g.heroImage || '../assets/default_hero.jpg';

    // Logo
    _gsUpdateLogoPreview(g.logo || null);

    // Init hero drag-to-pan
    // Init drag-to-pan for both Hero and Cover
    _gsInitImagePan('gs-hero-wrapper', 'previewHero');
    _gsInitImagePan('gs-cover-wrapper', 'previewCover');
    // ابحث عن دالة openGameSettings(id) وعدل الجزء ده في آخرها، قبل الـ .classList.add('active')

    // update images
    document.getElementById('previewHero').src = (g.heroImage && g.heroImage != 'assets/default_hero.jpg') ? g.heroImage : 'assets/default_hero.jpg';
    document.getElementById('previewCover').src = (g.image && g.image != 'assets/logo.png') ? g.image : 'assets/logo.png';
    _gsUpdateLogoPreview(g.logo);
    
    // --- التعديل الجديد هنا ---
    // التشييك أول ما تفتح الـ Modal: لو الصور أصلاً Default، اقفل زراير الـ Reset
    const btnCover = document.getElementById('btn-reset-cover');
    const btnHero = document.getElementById('btn-reset-hero');
    const btnLogo = document.getElementById('btn-reset-logo');

    // بنقفل الزرار لو الداتا فاضية أو بتحتوي على اسم صورة الديفولت
    if (btnCover) btnCover.disabled = !g.image || g.image.includes('assets/logo.png');
    if (btnHero) btnHero.disabled = !g.heroImage || g.heroImage.includes('assets/default_hero.jpg');
    if (btnLogo) btnLogo.disabled = !g.logo;
    // --- نهاية التعديل ---

    // open modal
    document.getElementById('gameSettingsModal').classList.add('active');
    overlay.classList.add('active');

    checkResetAllButtonState();

    document.getElementById('gameSettingsModal').classList.add('active');
}

function _gsUpdateLogoPreview(src) {
    const logoEl  = document.getElementById('previewLogo');
    const emptyEl = document.getElementById('gs-logo-empty');
    if (src) {
        logoEl.src = src;
        logoEl.style.display = 'block';
        if (emptyEl) emptyEl.style.display = 'none';
    } else {
        logoEl.src = '';
        logoEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'flex';
    }
}

// Hero pan interaction
// Universal Image Pan interaction (Works for X and Y axes)
function _gsInitImagePan(wrapperId, imgId) {
    const wrapper = document.getElementById(wrapperId);
    const img = document.getElementById(imgId);
    if (!wrapper || !img) return;

    // إزالة أي Listeners قديمة عشان ميتعملش مشاكل لما تفتح وتقفل الـ Modal
    const cloned = wrapper.cloneNode(true);
    wrapper.parentNode.replaceChild(cloned, wrapper);

    const newWrapper = document.getElementById(wrapperId);
    const newImg = document.getElementById(imgId);
    const hint = newWrapper.querySelector('.gs-hero-pan-hint');

    // تأكيد إن الصورة Cover ومتركزة في النص كبداية
    newImg.style.objectFit = 'cover';
    if (!newImg.style.objectPosition) newImg.style.objectPosition = '50% 50%';

    let isDragging = false, startX = 0, startY = 0;
    let startPosX = 50, startPosY = 50;

    newWrapper.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        // استخراج النسب المئوية الحالية
        const pos = newImg.style.objectPosition.split(' ');
        startPosX = parseFloat(pos[0]) || 50;
        startPosY = parseFloat(pos[1]) || 50;
        
        newWrapper.style.cursor = 'grabbing';
        if (hint) hint.style.opacity = '0';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        // حساب المسافة اللي الماوس اتحركها
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        // تحويل المسافة بالبيكسل لنسبة مئوية (ضربنا في 0.8 لضبط سرعة السحب)
        const percentX = (dx / newWrapper.offsetWidth) * 100 * 0.8;
        const percentY = (dy / newWrapper.offsetHeight) * 100 * 0.8;
        
        // عكس الاتجاه عشان تحس إنك ماسك الصورة بتسحبها، مع عمل Limit بين 0% و 100%
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

    // Reset position لما صورة جديدة تتحمل
    newImg.onload = () => { newImg.style.objectPosition = '50% 50%'; };
}

// استبدل changeGameImage القديمة:
async function changeGameImage(type) {
    if (!selectedGameId) return;
    const newPath = await window.electronAPI.selectImage();
    if (!newPath) return;

    const safePath = `file://${newPath.replace(/\\/g, '/')}`;

    // حفظ التغيير بشكل مؤقت (Draft)
    pendingImageChanges[type] = { action: 'update', path: safePath };

    // تحديث الواجهة بتاعت الـ Modal بس
    if (type === 'cover') {
        document.getElementById('previewCover').src = safePath;
    } else if (type === 'hero') {
        document.getElementById('previewHero').src = safePath;
        document.getElementById('previewHero').style.marginLeft = '0';
    } else if (type === 'logo') {
        _gsUpdateLogoPreview(safePath);
    }

    // تفعيل زرار الـ Reset
    const btn = document.getElementById(`btn-reset-${type}`);
    if (btn) btn.disabled = false;
    
    if (typeof checkResetAllButtonState === 'function') checkResetAllButtonState();
}
// استبدل resetGameImage القديمة:
// دالة لترسيت صورة واحدة (Cover أو Hero أو Logo)
// دالة ترسيت صورة واحدة للـ Default
async function resetGameImage(type) {
    if(!selectedGameId) return;

    // 1. نمسح الصورة المخصصة من الـ LocalStorage والـ Backend
    localStorage.removeItem(`${type}_${selectedGameId}`);

    const g = allGamesData.find(x => x.id == selectedGameId);
    if(g) {
        if(type == 'cover') g.image = null;
        if(type == 'hero') g.heroImage = null;
        if(type == 'logo') g.logo = null;
    }

    try {
        if(window.electronAPI && window.electronAPI.resetGameImage) {
            await window.electronAPI.resetGameImage(selectedGameId, type);
        }
    } catch(err) {
        console.error("Failed to reset in backend:", err);
    }

    // 2. تحديث الواجهة فوراً (المسارات المصلحة)
    // استخدمنا /assets/ لتفادي مشاكل الـ Path في Electron
    if (type === 'cover') {
        document.getElementById('previewCover').src = '/assets/logo.png';
    } else if (type === 'hero') {
        const heroImg = document.getElementById('previewHero');
        heroImg.src = '/assets/default_hero.jpg';
        heroImg.style.objectPosition = '50% 50%'; // نرسّت الـ Pan كمان
    } else if (type === 'logo') {
        _gsUpdateLogoPreview(null); // دي هتبين شاشة "No Logo"
    }

    // 3. نقفل زرار الـ Reset ده تحديداً عشان ميحصلش Spam
    const btn = document.getElementById(`btn-reset-${type}`);
    if (btn) {
        btn.disabled = true;
    }

    showToast(`${type} reset to default`, 'success');
    refreshAllViews(); // نحدث المكتبة بره
}


async function resetGameImage(type, skipToast = false) {
    if (!selectedGameId) return;

    // 1. تسجيل الحدث كـ مسودة (Draft) عشان يتنفذ وقت الـ Save
    pendingImageChanges[type] = { action: 'reset' };

    // 2. استنتاج مسار الصورة الديفولت عشان نعرضها كـ Preview بس (من غير مانكلم الباك إند يمسح حاجة)
    let restoredPath = null;
    const g = allGamesData.find(x => String(x.id) === String(selectedGameId));
    
    // نجرب نجيب الديفولت المتسجل في الداتا الأول
    if (g) {
        if (type === 'cover') restoredPath = g.defaultImage;
        else if (type === 'hero') restoredPath = g.defaultHero;
        else if (type === 'logo') restoredPath = g.defaultLogo;
    }

    // لو ملقناش ديفولت في الداتا، نجرب نقراه من الكاش (بدون ما نمسح الصورة المخصصة)
    if (!restoredPath && window.electronAPI && window.electronAPI.getCachedImage) {
        try {
            restoredPath = await window.electronAPI.getCachedImage(selectedGameId, type);
        } catch (err) {
            console.error('Failed to read cached image:', err);
        }
    }

    // 3. تحديث الصور في الـ Modal بناءً على المسار الحقيقي (كشكل بس)
    if (type === 'cover') {
        document.getElementById('previewCover').src = restoredPath || '../assets/logo.png';
    } else if (type === 'hero') {
        const heroImg = document.getElementById('previewHero');
        heroImg.src = restoredPath || '../assets/default_hero.jpg';
        heroImg.style.objectPosition = '50% 50%'; 
    } else if (type === 'logo') {
        _gsUpdateLogoPreview(restoredPath || null);
    }

    // 4. قفل زرار الـ Reset 
    const btn = document.getElementById(`btn-reset-${type}`);
    if (btn) btn.disabled = true;
    
    if (typeof checkResetAllButtonState === 'function') {
        checkResetAllButtonState();
    }

    if (!skipToast) showToast(`${type} set to default (Click Save to apply)`, 'info');
    
    // شيلنا مسح الـ localStorage من هنا (هيحصل وقت الـ Save)
    // شيلنا تعديل g.image من هنا (هيحصل وقت الـ Save)
    // شيلنا refreshAllViews()
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

async function saveGameSettings() {
    if (!selectedGameId) return;

    const g = allGamesData.find(x => String(x.id) === String(selectedGameId));
    if (!g) return;

    const _patch = {};
    const _artworkTs    = Date.now();  // single timestamp for the whole settings save
    const _changedTypes = [];          // tracks which art types were updated (cover/hero/logo)

    // 1. حفظ الاسم الجديد للعبة (لو اتغير)
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

    // 2. تطبيق كل تغييرات الصور اللي متسجلة في الـ Draft
    for (const type in pendingImageChanges) {
        const change = pendingImageChanges[type];

        if (change.action === 'update') {
            const res = await window.electronAPI.updateGameImage(selectedGameId, change.path, type);
            localStorage.setItem(`${type}_${selectedGameId}`, change.path);

            if (type === 'cover') {
                g.cover        = change.path;
                g.image        = change.path;
                g.coverUrl     = change.path;
                g.defaultImage = change.path;
                _patch.cover   = change.path;
            }
            if (type === 'hero') {
                g.hero        = change.path;
                g.heroImage   = change.path;
                g.heroUrl     = change.path;
                g.defaultHero = change.path;
                _patch.hero   = change.path;
            }
            if (type === 'logo') {
                g.logo        = change.path;
                g.logoUrl     = change.path;
                g.defaultLogo = change.path;
                _patch.logo   = change.path;
            }

            _changedTypes.push(type);

            // Keep frontend memory in sync immediately.
            // Use artworkSource:'settings' (not 'creator') so Game Detail
            // priority logic knows a newer Settings save overrides older Creator art.
            g.customArtworkLocked = true;
            g.artworkSource    = 'settings';
            g.artworkUpdatedAt = _artworkTs;
        } else if (change.action === 'reset') {
            localStorage.removeItem(`${type}_${selectedGameId}`);
            let restoredPath = null;
            try {
                const res = await window.electronAPI.resetGameImage(selectedGameId, type);
                if (res && res.status === 'success') restoredPath = res.path;
            } catch (err) {
                console.error('Failed to reset in backend:', err);
            }

            if (type === 'cover') {
                g.image        = restoredPath;
                g.coverUrl     = restoredPath;
                g.defaultImage = restoredPath;
            }
            if (type === 'hero') {
                g.heroImage   = restoredPath;
                g.heroUrl     = restoredPath;
                g.defaultHero = restoredPath;
            }
            if (type === 'logo') {
                g.logo        = restoredPath;
                g.logoUrl     = restoredPath;
                g.defaultLogo = restoredPath;
                _patch.logoCleared = true;
            }
        }
    }

    // Propagate changes to all live in-memory stores (sugg rail, _allGamesCache, VS)
    if (Object.keys(_patch).length) {
        if (_changedTypes.length) {
            _patch.artworkSource    = 'settings';
            _patch.artworkUpdatedAt = _artworkTs;
        }
        if (typeof window.__baddelApplyGameCustomOverride === 'function') {
            window.__baddelApplyGameCustomOverride(g, _patch);
        }
        // Clear stale Creator Mode artwork from localStorage customGameDetails so
        // _gdApplyCustomToGame no longer lets old posterImage win over game.image.
        if (_changedTypes.length && typeof window._gdClearCustomDetailArtwork === 'function') {
            window._gdClearCustomDetailArtwork(g, _changedTypes);
        }
        // If Game Detail is open for this game, update _gdCurrentGame and re-render.
        if (typeof window._gdApplyExternalPatch === 'function') {
            window._gdApplyExternalPatch(g, _patch);
        }
    }

    // تنظيف الـ Draft بعد الحفظ
    pendingImageChanges = {};

    // 3. نقفل الـ Modal ونعمل Refresh للمكتبة مرة واحدة بس
    showToast('Settings saved successfully!', 'success');
    refreshAllViews();
    closeGameSettings();
}
