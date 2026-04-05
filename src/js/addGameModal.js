// ============================================================
// ADD GAME MODAL — UNIFIED (Browse + Path + Drag & Drop)
// ============================================================
// كيفية الاستخدام:
//   - استبدل openPicker() القديمة بـ openAddGameModal()
//   - احذف الـ functions القديمة:
//     openPicker, navigate, renderDirs, goBack, selectExe,
//     closePicker, confirmSelection, finalizeAddGame, closeNameEditor
// ============================================================

let _agCurrentPath   = '';
let _agSelectedPath  = '';
let _agCurrentTab    = 'browse';
let _agDropZoneInit  = false;
let pendingImageChanges = {};

// ── Open / Close ────────────────────────────────────────────
function openAddGameModal() {
    document.getElementById('addGameModal').classList.add('active');
    switchAGTab('browse');
    _agOpenPicker();          // auto-load drives immediately
}

function closeAddGameModal() {
    document.getElementById('addGameModal').classList.remove('active');
    _agReset();
}

function _agReset() {
    _agCurrentPath  = '';
    _agSelectedPath = '';
    document.getElementById('ag-game-name-input').value = '';
    document.getElementById('ag-path-input').value = '';
    document.getElementById('ag-path-status').innerHTML = '';
    document.getElementById('ag-name-row').style.display = 'none';
    document.getElementById('ag-save-btn').disabled = true;
    document.getElementById('ag-drop-feedback').innerHTML = '';
    document.getElementById('ag-drop-zone').classList.remove('drag-over', 'drop-success');
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

// ── Tab: BROWSE ──────────────────────────────────────────────
async function _agOpenPicker() {
    _agCurrentPath  = '';
    _agSelectedPath = '';
    document.getElementById('ag-current-path').innerText = 'Select Drive';
    document.getElementById('ag-dir-list').innerHTML =
        '<div class="ag-placeholder">Scanning drives…</div>';
    try {
        const drives = await window.electronAPI.getDrives();
        _agRenderDirs(drives, true);
    } catch (e) { console.error(e); }
}

// Exposed as global so the Home button can call it
function agOpenPicker() { _agOpenPicker(); }

async function _agNavigate(p, isDrive) {
    const target = (isDrive || p.includes(':\\')) ? p
        : (_agCurrentPath.endsWith('\\') ? _agCurrentPath + p : _agCurrentPath + '\\' + p);
    _agCurrentPath  = target;
    _agSelectedPath = '';
    document.getElementById('ag-current-path').innerText = 'Loading…';
    document.getElementById('ag-dir-list').innerHTML =
        '<div class="ag-placeholder">Loading…</div>';
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
                <svg viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div><span class="ag-item-text">${item.name}</span>`;
            div.onclick = () => _agNavigate(item.name, false);
        } else {
            const fileExt = item.name.substring(item.name.lastIndexOf('.')).toLowerCase();
            const exeIcon = item.icon
                ? `<img src="${item.icon}" style="width:20px;height:20px;object-fit:contain;">`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="#8e8e93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4m-2-2v4m8-2h.01M16 10h.01"/></svg>`;
            div.innerHTML = `<div class="ag-item-icon">${exeIcon}</div>
                             <span class="ag-item-text">${item.name}</span>
                             <span class="ag-item-badge">${fileExt}</span>`;
            div.onclick = (e) => _agSelectExe(item.path, item.name, e);
        }

        list.appendChild(div);
    });
}

function _agSelectExe(fullPath, fileName, e) {
    _agSelectedPath = fullPath;
    document.getElementById('ag-current-path').innerText = 'Selected: ' + fileName;

    // Highlight selected
    document.querySelectorAll('.ag-dir-item').forEach(i => i.classList.remove('selected'));
    if (e && e.currentTarget) e.currentTarget.classList.add('selected');

    _agSetChosenFile(fullPath, fileName);
}

// ── Tab: PATH ────────────────────────────────────────────────
function agValidatePath() {
    const val  = document.getElementById('ag-path-input').value.trim();
    const btn  = document.getElementById('ag-use-path-btn');
    const stat = document.getElementById('ag-path-status');
    const isValidFile = /\.(exe|lnk|url|bat)$/i.test(val) && val.length > 5;

    btn.disabled = !isValidFile;
    if (!val) { stat.innerHTML = ''; return; }
    stat.innerHTML = isValidFile
        ? `<span class="ag-status-ok">✓ Looks like a valid game path</span>`
        : `<span class="ag-status-warn">⚠ Path should end with .exe, .lnk, .url, or .bat</span>`;
}

function agUsePath() {
    const val = document.getElementById('ag-path-input').value.trim();
    if (!val) return;
    const parts   = val.split(/[\\/]/);
    const fileName = parts[parts.length - 1];
    _agSetChosenFile(val, fileName);
}

// ── Tab: DRAG & DROP ─────────────────────────────────────────
function _agInitDropZone() {
    _agDropZoneInit = true;
    const zone = document.getElementById('ag-drop-zone');

    // Native Electron drag-in: لما بتسحب من Explorer الـ path بيجيله
    zone.addEventListener('dragover', (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove('drag-over');

        // في Electron, webUtils.getPathForFile بتجيب الـ path الحقيقي
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        
        // 1. Electron بيوفر المسار الكامل هنا بشكل مباشر
        let filePath = file.path; 

        // 2. لو مش موجود، نجرب نجيبه من الـ preload
        if (!filePath && window.electronAPI && window.electronAPI.getFilePath) {
            try { filePath = window.electronAPI.getFilePath(file); } catch {}
        }

        // 3. Fallback أخير 
        if (!filePath) filePath = file.name;

        // تعديل الـ Regex هنا لدعم باقي الأنواع
        const isValidFile = /\.(exe|lnk|url|bat)$/i.test(filePath) || /\.(exe|lnk|url|bat)$/i.test(file.name);
        const feedback = document.getElementById('ag-drop-feedback');

        if (!isValidFile) {
            feedback.innerHTML = `<span class="ag-status-warn">⚠ Please drop a supported file (.exe, .lnk, .url, .bat)</span>`;
            return;
        }

        zone.classList.add('drop-success');
        feedback.innerHTML = `<span class="ag-status-ok">✓ ${file.name}</span>`;
        _agSetChosenFile(filePath || file.name, file.name);
    });
}

function agFilterBrowse() {
    const query = document.getElementById('ag-browse-search').value.toLowerCase();
    const items = document.querySelectorAll('#ag-dir-list .ag-dir-item');
    
    items.forEach(item => {
        // بنجيب اسم الفايل/الفولدر من النص اللي جوه العنصر
        const text = item.querySelector('.ag-item-text').innerText.toLowerCase();
        
        // لو الاسم فيه الحروف اللي كتبناها، نعرضه.. لو لأ، نخفيه
        if (text.includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// ── Shared: after any method gives us a file path ───────────
function _agSetChosenFile(fullPath, fileName) {
    _agSelectedPath = fullPath;

    // Smart name guess
    let guessedName = fileName.replace(/\.[^/.]+$/, '');
    const parts = fullPath.split(/[\\/]/);
    const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : '';
    if (['game','launcher','app','bin','x64','x86'].includes(guessedName.toLowerCase()) && parentFolder) {
        guessedName = parentFolder;
    }
    guessedName = guessedName.replace(/[-_]/g, ' ').trim();

    document.getElementById('ag-chosen-path-label').innerText = fileName;
    document.getElementById('ag-game-name-input').value = guessedName;
    document.getElementById('ag-name-row').style.display = 'flex';
    document.getElementById('ag-save-btn').disabled = false;

    // Scroll name row into view
    document.getElementById('ag-name-row').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Finalize (Save) ─────────────────────────────────────────
async function agFinalizeAddGame() {
    const name = document.getElementById('ag-game-name-input').value.trim();
    const path = _agSelectedPath;
    if (!name) return showToast('Name required', 'error');
    if (!path) return showToast('No file selected', 'error');

    const btn = document.getElementById('ag-save-btn');
    btn.innerText = 'Adding…';
    btn.disabled = true;

    try {
        const res = await window.electronAPI.addManualGame(path, name);
        if (res && res.status === 'error') {
            showToast('Error: ' + (res.message || 'Failed to add game'), 'error');
            return;
        }
        showToast('Game Added!', 'success');
        window.electronAPI.logGameAddedManual?.();

        currentFilters.collectionId = null;
        allGamesData = await window.electronAPI.getGames();
        applyFilters();
        renderExploreCarousel();
        closeAddGameModal();
    } catch (e) {
        console.error('agFinalizeAddGame error:', e);
        showToast('Error adding game', 'error');
    } finally {
        btn.innerText = 'Add to Library';
        btn.disabled = false;
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

async function saveGameSettings() {
    if (!selectedGameId) return;

    const g = allGamesData.find(x => String(x.id) === String(selectedGameId));
    if (!g) return;

    // 1. حفظ الاسم الجديد للعبة (لو اتغير)
    const nameInput = document.getElementById('editGameNameInput');
    if (nameInput) {
        const newName = nameInput.value.trim();
        if (newName && newName !== g.name) {
            await window.electronAPI.renameGame(selectedGameId, newName);
            g.name = newName;
        }
    }

    // 2. تطبيق كل تغييرات الصور اللي متسجلة في الـ Draft
    for (const type in pendingImageChanges) {
        const change = pendingImageChanges[type];

        if (change.action === 'update') {
            await window.electronAPI.updateGameImage(selectedGameId, change.path, type);
            localStorage.setItem(`${type}_${selectedGameId}`, change.path);
            
            if (type === 'cover') g.image = change.path;
            if (type === 'hero') g.heroImage = change.path;
            if (type === 'logo') g.logo = change.path;

        } else if (change.action === 'reset') {
            localStorage.removeItem(`${type}_${selectedGameId}`);
            let restoredPath = null;
            try {
                const res = await window.electronAPI.resetGameImage(selectedGameId, type);
                if (res && res.status === 'success') restoredPath = res.path;
            } catch (err) {
                console.error('Failed to reset in backend:', err);
            }

            if (type === 'cover') g.image = restoredPath;
            if (type === 'hero') g.heroImage = restoredPath;
            if (type === 'logo') g.logo = restoredPath;
        }
    }

    // تنظيف الـ Draft بعد الحفظ
    pendingImageChanges = {};

    // 3. نقفل الـ Modal ونعمل Refresh للمكتبة مرة واحدة بس
    showToast('Settings saved successfully!', 'success');
    refreshAllViews();
    closeGameSettings();
}
