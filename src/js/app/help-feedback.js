'use strict';

// Help, feedback, beta-feedback banner, update UI, and community hub.
// Extracted from app.js. Loaded before app.js so window.electronAPI is
// already available (set by preload.js before any script runs).

// ============================================================
// HELP & FEEDBACK
// ============================================================
function openHelpModal(tab) {
    document.getElementById('helpModal').classList.add('active');
    if (tab) switchHelpTab(tab);
}
function closeHelpModal() { document.getElementById('helpModal').classList.remove('active'); }

function _positionHelpDropdown() {
    const wrap = document.getElementById('helpDropdownWrap');
    const menu = document.getElementById('helpDropdownMenu');
    if (!wrap || !menu) return;
    const rect = wrap.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top  = (rect.bottom + 6) + 'px';
}

function toggleHelpDropdown(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const menu = document.getElementById('helpDropdownMenu');
    if (!menu) return;
    const willOpen = !menu.classList.contains('active');
    menu.classList.toggle('active', willOpen);
    if (willOpen) _positionHelpDropdown();
}

function closeHelpDropdown() {
    const menu = document.getElementById('helpDropdownMenu');
    if (menu) menu.classList.remove('active');
}

function handleHelpDropdownAction(e, action) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
    closeHelpDropdown();
    if (action === 'help')      { openHelpModal('guide');    return; }
    if (action === 'bug')       { openHelpModal('feedback'); return; }
    if (action === 'community') { openCommunityModal();      return; }
}

// Capture pointerdown inside wrap to stop it bubbling to the outside-click handler
document.addEventListener('pointerdown', function _helpDropdownPointerDown(e) {
    const wrap = document.getElementById('helpDropdownWrap');
    if (wrap && wrap.contains(e.target)) e.stopPropagation();
}, true);

// Close when clicking outside the wrap
document.addEventListener('click', function _helpDropdownOutside(e) {
    const wrap = document.getElementById('helpDropdownWrap');
    if (wrap && !wrap.contains(e.target)) closeHelpDropdown();
});

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
            hideBetaFeedbackBanner(true);
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

// ============================================================
// BETA FEEDBACK BANNER
// ============================================================

const BETA_FEEDBACK_BANNER_KEY = 'baddel.betaFeedbackBanner.dismissed.v1';

function shouldShowBetaFeedbackBanner() {
    return localStorage.getItem(BETA_FEEDBACK_BANNER_KEY) !== '1';
}

function markBetaFeedbackBannerDismissed() {
    localStorage.setItem(BETA_FEEDBACK_BANNER_KEY, '1');
}

function showBetaFeedbackBanner() {
    const banner = document.getElementById('betaFeedbackBanner');
    if (!banner) return;
    if (!shouldShowBetaFeedbackBanner()) {
        banner.hidden = true;
        document.body.classList.remove('has-beta-feedback-banner');
        return;
    }
    banner.hidden = false;
    document.body.classList.add('has-beta-feedback-banner');
}

function hideBetaFeedbackBanner(persist = false) {
    if (persist) markBetaFeedbackBannerDismissed();
    const banner = document.getElementById('betaFeedbackBanner');
    if (banner) banner.hidden = true;
    document.body.classList.remove('has-beta-feedback-banner');
}

function dismissBetaFeedbackBanner() {
    hideBetaFeedbackBanner(true);
}

function openBetaFeedbackFromBanner() {
    if (typeof openHelpModal === 'function') {
        openHelpModal('feedback');
    } else if (typeof handleHelpDropdownAction === 'function') {
        handleHelpDropdownAction(null, 'bug');
    }
}

// ============================================================
// UPDATE SYSTEM
// ============================================================

// الـ state الداخلي للـ update
const _updateState = {
    status: 'idle',      // idle | found | preparing | downloading | ready | error
    newVersion: null,
    pendingRestart: false,
};

// ── helpers ──────────────────────────────────────────────────

function _setUpdateBadge(show, label) {
    const btn = document.getElementById('updateBadgeBtn');
    const lbl = document.getElementById('updateBadgeLabel');
    if (!btn) return;
    btn.style.display = show ? 'flex' : 'none';
    if (lbl && label) lbl.textContent = label;
}

function _setSettingsUpdateRow(stateId) {
    const ids = ['settingsUpdateAvailable','settingsUpdateDownloading','settingsUpdateReady','settingsUpToDate','settingsUpdateError'];
    const row = document.getElementById('settingsUpdateRow');
    if (row) row.style.display = stateId ? 'block' : 'none';
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === stateId) ? 'block' : 'none';
    });
}

function _updateModalState(stateId) {
    const oldStatus = _updateState.status;
    console.log('[UpdateUI] modal state:', oldStatus, '->', stateId);
    ['updateStateAvailable','updateStateDownloading','updateStateReady','updateStateError'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === stateId) ? 'block' : 'none';
    });
    // Keep the Download button disabled while a download is in flight
    const dlBtn = document.getElementById('btnStartDownload');
    if (dlBtn) {
        dlBtn.disabled = (stateId === 'updateStateDownloading');
    }
}

// Reset progress bar + percentage so a new download starts clean
function _resetUpdateProgress() {
    const bar   = document.getElementById('updateProgressBar');
    const pctEl = document.getElementById('updateProgressPct');
    const spEl  = document.getElementById('updateProgressSpeed');
    const infoEl = document.getElementById('updateDownloadInfo');
    if (bar)    bar.style.width     = '0%';
    if (pctEl)  pctEl.textContent   = '0%';
    if (spEl)   spEl.textContent    = '';
    if (infoEl) infoEl.textContent  = '';
    const sbar = document.getElementById('settingsProgressBar');
    const spct = document.getElementById('settingsProgressPct');
    const sspd = document.getElementById('settingsProgressSpeed');
    if (sbar) sbar.style.width   = '0%';
    if (spct) spct.textContent   = '0%';
    if (sspd) sspd.textContent   = '';
}

// Show "Preparing…" sub-label inside the downloading modal state
function _setDownloadSubLabel(text) {
    const el = document.getElementById('updateDownloadSubLabel');
    if (el) el.textContent = text || '';
}

function openUpdateModal() {
    const modal = document.getElementById('updateModal');
    if (!modal) return;
    if (_updateState.status === 'ready') {
        _updateModalState('updateStateReady');
    } else if (_updateState.status === 'downloading' || _updateState.status === 'preparing') {
        _updateModalState('updateStateDownloading');
    } else if (_updateState.status === 'error') {
        _updateModalState('updateStateError');
    } else {
        _updateModalState('updateStateAvailable');
    }
    modal.classList.add('active');
}

function closeUpdateModal() {
    document.getElementById('updateModal')?.classList.remove('active');
}

async function startUpdateDownload() {
    if (_updateState.status === 'ready') {
        // Already downloaded — just open the ready modal
        openUpdateModal();
        return;
    }
    if (_updateState.status === 'preparing' || _updateState.status === 'downloading') {
        // Already in flight — just show the modal
        console.log('[UpdateUI] startUpdateDownload: already in flight, status =', _updateState.status);
        openUpdateModal();
        return;
    }

    // Transition to preparing state immediately
    const oldStatus = _updateState.status;
    _updateState.status = 'preparing';
    console.log('[UpdateUI] state:', oldStatus, '-> preparing (startUpdateDownload)');
    _resetUpdateProgress();
    _updateModalState('updateStateDownloading');
    _setDownloadSubLabel('Preparing download…');
    _setSettingsUpdateRow('settingsUpdateDownloading');
    _setUpdateBadge(true, 'Preparing…');

    // Invoke the main process. Do NOT change the UI based on the return value —
    // update-status / update-error IPC events are the single source of truth for
    // state transitions once the download is in flight.
    try {
        const result = await window.electronAPI.startUpdateDownload();
        if (result && result.ok === false) {
            // Main process rejected synchronously before any download-progress fired.
            // The update-error event will also fire and is the canonical handler,
            // but log here for visibility.
            console.warn('[UpdateUI] startUpdateDownload returned ok:false —', result.error, '(update-error event will handle UI)');
        } else {
            console.log('[UpdateUI] startUpdateDownload invoke resolved ok');
        }
    } catch (err) {
        // IPC channel failure (not a download error) — update-error won't fire, so handle here.
        console.warn('[Update] startUpdateDownload invoke failed (IPC error):', err);
        const oldSt = _updateState.status;
        _updateState.status = 'error';
        console.log('[UpdateUI] state:', oldSt, '-> error (IPC channel failure)');
        const errEl = document.getElementById('updateErrorMsg');
        if (errEl) errEl.textContent = err?.message || 'Could not reach the update service.';
        _updateModalState('updateStateError');
        _setSettingsUpdateRow('settingsUpdateError');
        _setUpdateBadge(false);
        _setDownloadSubLabel('');
    }
}

function installUpdate() {
    const btn = document.querySelector('#updateStateReady .btn-primary');
    if (btn) { btn.textContent = 'Restarting...'; btn.disabled = true; }
    window.electronAPI.sendRestartUpdate();
}

// ── IPC Listeners ─────────────────────────────────────────────
async function settingsCheckForUpdate() {
    const btn = document.getElementById('settingsCheckUpdateBtn');
    if (btn) { btn.textContent = 'Checking...'; btn.disabled = true; }
    _setSettingsUpdateRow(null);
    try {
        await window.electronAPI.checkForUpdates?.();
        // لو في state موجود فعلاً، اعرضه
        if (_updateState.status === 'found') _setSettingsUpdateRow('settingsUpdateAvailable');
        else if (_updateState.status === 'preparing' || _updateState.status === 'downloading') _setSettingsUpdateRow('settingsUpdateDownloading');
        else if (_updateState.status === 'ready') _setSettingsUpdateRow('settingsUpdateReady');
        // لو مفيش حاجة، هيجي الـ onUpdateNotFound event هيتعامل معاه
    } catch {
        _setSettingsUpdateRow('settingsUpdateError');
    } finally {
        if (btn) { btn.textContent = 'Check for Updates'; btn.disabled = false; }
    }
}

// ── IPC Listeners ─────────────────────────────────────────────

// update-status: unified stream from the state machine in main.js
if (window.electronAPI.onUpdateStatus) {
    window.electronAPI.onUpdateStatus((data) => {
        const { status, version, message, progress } = data;
        const oldStatus = _updateState.status;
        switch (status) {
            case 'preparing':
                _updateState.status = 'preparing';
                console.log('[UpdateUI] state:', oldStatus, '-> preparing (update-status)');
                _resetUpdateProgress();
                _updateModalState('updateStateDownloading');
                _setSettingsUpdateRow('settingsUpdateDownloading');
                _setDownloadSubLabel('Preparing download…');
                _setUpdateBadge(true, 'Preparing…');
                break;

            case 'downloading':
                _updateState.status = 'downloading';
                console.log('[UpdateUI] state:', oldStatus, '-> downloading (update-status)');
                _updateModalState('updateStateDownloading');
                _setSettingsUpdateRow('settingsUpdateDownloading');
                _setDownloadSubLabel('');
                break;

            case 'downloaded':
                // handled by onUpdateReady below
                break;

            case 'error': {
                _updateState.status = 'error';
                console.log('[UpdateUI] state:', oldStatus, '-> error (update-status):', message);
                _setDownloadSubLabel('');
                const errEl = document.getElementById('updateErrorMsg');
                if (errEl) errEl.textContent = message || 'Unknown error';
                _setSettingsUpdateRow('settingsUpdateError');
                _setUpdateBadge(false);
                // Show the dedicated error state — never revert to available
                _updateModalState('updateStateError');
                break;
            }
        }
    });
}

// لقي update جديدة
if (window.electronAPI.onUpdateFound) {
    window.electronAPI.onUpdateFound((version) => {
        // Never overwrite an active download or ready state
        if (['preparing', 'downloading', 'ready'].includes(_updateState.status)) {
            console.log('[UpdateUI] Ignoring update-found — current state is', _updateState.status);
            return;
        }
        const oldStatus = _updateState.status;
        _updateState.status = 'found';
        _updateState.newVersion = version;
        console.log('[UpdateUI] state:', oldStatus, '-> found (update-found) version:', version);

        // badge في الـ title bar
        _setUpdateBadge(true, 'Update Available');

        // الـ modal message
        const msg = document.getElementById('updateAvailableMsg');
        if (msg) msg.textContent = `Version ${version} is available. Download it now?`;

        // الـ settings row
        const smsg = document.getElementById('settingsUpdateAvailableMsg');
        if (smsg) smsg.textContent = `Version ${version} is available`;
        _setSettingsUpdateRow('settingsUpdateAvailable');
    });
}

// مفيش update
if (window.electronAPI.onUpdateNotFound) {
    window.electronAPI.onUpdateNotFound(() => {
        if (_updateState.status === 'idle') {
            _setSettingsUpdateRow('settingsUpToDate');
        }
    });
}

// تقدم التحميل
if (window.electronAPI.onUpdateProgress) {
    window.electronAPI.onUpdateProgress((progress) => {
        const oldStatus = _updateState.status;
        if (oldStatus !== 'downloading') {
            console.log('[UpdateUI] state:', oldStatus, '-> downloading (download-progress)');
        }
        _updateState.status = 'downloading';
        _setDownloadSubLabel('');

        // Ensure the modal is on the downloading panel (guards against race with update-found)
        _updateModalState('updateStateDownloading');

        const pct   = progress.percent || 0;
        const speed = ((progress.bytesPerSecond || 0) / 1024 / 1024).toFixed(1);
        const transferred = ((progress.transferred || 0) / 1024 / 1024).toFixed(1);
        const total       = ((progress.total       || 0) / 1024 / 1024).toFixed(1);
        const info = `${transferred} MB / ${total} MB`;

        // modal progress
        const bar  = document.getElementById('updateProgressBar');
        const pctEl = document.getElementById('updateProgressPct');
        const spEl  = document.getElementById('updateProgressSpeed');
        const infoEl = document.getElementById('updateDownloadInfo');
        if (bar)    bar.style.width = `${pct}%`;
        if (pctEl)  pctEl.textContent = `${pct}%`;
        if (spEl)   spEl.textContent  = `${speed} MB/s`;
        if (infoEl) infoEl.textContent = info;

        // settings progress
        const sbar  = document.getElementById('settingsProgressBar');
        const spct  = document.getElementById('settingsProgressPct');
        const sspd  = document.getElementById('settingsProgressSpeed');
        if (sbar) sbar.style.width = `${pct}%`;
        if (spct) spct.textContent = `${pct}%`;
        if (sspd) sspd.textContent = `${speed} MB/s`;

        // badge
        _setUpdateBadge(true, `Downloading ${pct}%`);
    });
}

// التحميل خلص
if (window.electronAPI.onUpdateReady) {
    window.electronAPI.onUpdateReady((version) => {
        _updateState.status = 'ready';
        _updateState.pendingRestart = true;
        _setDownloadSubLabel('');

        // badge
        _setUpdateBadge(true, 'Ready to Install');

        // modal
        _updateModalState('updateStateReady');
        const rmsg = document.getElementById('updateReadyMsg');
        if (rmsg) rmsg.textContent = `Version ${version} downloaded. Restart to apply.`;

        // settings
        const smsg = document.getElementById('settingsUpdateReadyMsg');
        if (smsg) smsg.textContent = `Version ${version} ready. Restart to apply.`;
        _setSettingsUpdateRow('settingsUpdateReady');

        // افتح الـ modal تلقائياً لو مش مفتوح
        const modal = document.getElementById('updateModal');
        if (modal && !modal.classList.contains('active')) {
            openUpdateModal();
        }
    });
}

// خطأ
if (window.electronAPI.onUpdateError) {
    window.electronAPI.onUpdateError((msg) => {
        const oldStatus = _updateState.status;
        console.warn('[UpdateUI] state:', oldStatus, '-> error (update-error):', msg);
        _updateState.status = 'error';
        _setDownloadSubLabel('');
        const errEl = document.getElementById('updateErrorMsg');
        if (errEl) errEl.textContent = msg || 'Something went wrong. Try again.';
        _setSettingsUpdateRow('settingsUpdateError');
        _setUpdateBadge(false);
        // Show the dedicated error state — never revert to the available screen
        _updateModalState('updateStateError');
    });
}

// ── What's New / Update Notes Modal ───────────────────────────────────────────

let _pendingUpdateNotesVersion = null;

async function checkAndShowUpdateNotes() {
    try {
        if (!window.electronAPI?.getPendingUpdateNotes) return;
        const result = await window.electronAPI.getPendingUpdateNotes();
        console.log('[UpdateNotes] checkAndShowUpdateNotes:', result?.status, result?.notes?.version || 'none');
        if (result?.status === 'success' && result.notes && result.notes.version) {
            const modal = document.getElementById('updateNotesModal');
            if (!modal) {
                console.warn('[UpdateNotes] modal element not ready, retrying in 500ms');
                setTimeout(() => showUpdateNotesModal(result.notes), 500);
                return;
            }
            showUpdateNotesModal(result.notes);
        }
    } catch (err) {
        console.error('[UpdateNotes] checkAndShowUpdateNotes error:', err);
    }
}

function showUpdateNotesModal(notes) {
    _pendingUpdateNotesVersion = notes.version || null;
    const titleEl    = document.getElementById('updateNotesTitle');
    const subtitleEl = document.getElementById('updateNotesSubtitle');
    const listEl     = document.getElementById('updateNotesList');
    const footerEl   = document.getElementById('updateNotesFooter');

    if (titleEl)    titleEl.textContent    = notes.title    || 'Baddel has been updated';
    if (subtitleEl) subtitleEl.textContent = notes.subtitle || "Here's what's new in this version.";
    if (footerEl)   footerEl.textContent   = notes.footer   || 'Thanks for using Baddel.';

    if (listEl) {
        listEl.innerHTML = '';
        const items = Array.isArray(notes.items) ? notes.items : [];
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'update-notes-item';
            const titleP = document.createElement('p');
            titleP.className = 'update-notes-item-title';
            titleP.textContent = item.title || '';
            const descP = document.createElement('p');
            descP.className = 'update-notes-item-desc';
            descP.textContent = item.description || '';
            div.appendChild(titleP);
            div.appendChild(descP);
            listEl.appendChild(div);
        });
    }

    const modal = document.getElementById('updateNotesModal');
    if (modal) modal.classList.add('active');
}

async function closeUpdateNotesModal() {
    const modal = document.getElementById('updateNotesModal');
    if (modal) modal.classList.remove('active');
    if (_pendingUpdateNotesVersion && window.electronAPI?.markUpdateNotesShown) {
        try {
            await window.electronAPI.markUpdateNotesShown(_pendingUpdateNotesVersion);
        } catch (err) {
            console.error('[UpdateNotes] markUpdateNotesShown error:', err);
        }
        _pendingUpdateNotesVersion = null;
    }
}

// ── Community Hub ──────────────────────────────────────────────────────────────

function openCommunityModal() {
    const modal = document.getElementById('communityModal');
    if (modal) modal.classList.add('active');
}

function closeCommunityModal() {
    const modal = document.getElementById('communityModal');
    if (modal) modal.classList.remove('active');
}

async function openCommunityLink(url) {
    try {
        if (window.electronAPI?.openCommunityUrl) {
            await window.electronAPI.openCommunityUrl(url);
        }
    } catch (err) {
        console.error('[Community] failed to open link:', url, err);
        showToast('Could not open link.', 'error');
    }
}

// ── DOMContentLoaded setup ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { showBetaFeedbackBanner(); });
document.addEventListener('DOMContentLoaded', () => setTimeout(checkAndShowUpdateNotes, 900));

// ── Expose _updateState and _setSettingsUpdateRow for openSettingsModal in app.js ──
// openSettingsModal remains in app.js and reads _updateState.status and calls
// _setSettingsUpdateRow. Both are exposed by reference so mutations are shared.
window._updateState          = _updateState;
window._setSettingsUpdateRow = _setSettingsUpdateRow;

// ── Inline onclick handler exports (dashboard.html) ───────────────────────────
window.toggleHelpDropdown        = toggleHelpDropdown;
window.handleHelpDropdownAction  = handleHelpDropdownAction;
window.openHelpModal             = openHelpModal;
window.closeHelpModal            = closeHelpModal;
window.closeHelpDropdown         = closeHelpDropdown;
window.switchHelpTab             = switchHelpTab;
window.sendFeedback              = sendFeedback;
window.openUpdateModal           = openUpdateModal;
window.closeUpdateModal          = closeUpdateModal;
window.startUpdateDownload       = startUpdateDownload;
window.installUpdate             = installUpdate;
window.settingsCheckForUpdate    = settingsCheckForUpdate;
window.closeUpdateNotesModal     = closeUpdateNotesModal;
window.openCommunityModal        = openCommunityModal;
window.closeCommunityModal       = closeCommunityModal;
window.openCommunityLink         = openCommunityLink;
window.dismissBetaFeedbackBanner = dismissBetaFeedbackBanner;
window.openBetaFeedbackFromBanner = openBetaFeedbackFromBanner;
