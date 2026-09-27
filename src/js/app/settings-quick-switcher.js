// ── Settings modal and Quick Switcher settings ────────────────────────────────
// Functions that drive the Settings modal, the Quick Switcher configuration
// panel, and the analytics/startup toggles.
// Loads before app.js; showToast is available from toast-confirm.js (loaded
// earlier). window._updateState and window._setSettingsUpdateRow from
// help-feedback.js resolve at call time.

async function openSettingsModal() {
    window.electronAPI?.trackFeatureEvent?.('feature_viewed', { feature: 'settings', view: 'settings' }).catch?.(() => {});
    const modal  = document.getElementById('settingsModal');
    const toggle = document.getElementById('analyticsToggle');

    // startup toggle — also persist verified state for reliable toggle direction
    const startupToggle = document.getElementById('startupToggle');
    if (startupToggle && window.electronAPI?.getStartupEnabled) {
        try {
            const result = await window.electronAPI.getStartupEnabled();
            const state = typeof result === 'object' ? !!result?.enabled : !!result;
            startupToggle.checked = state;
            startupToggle.dataset.currentState = String(state);
        } catch {
            startupToggle.checked = true;
            startupToggle.dataset.currentState = 'true';
        }
    }

    // analytics toggle
    if (window.electronAPI && window.electronAPI.isAnalyticsEnabled) {
        const isEnabled = await window.electronAPI.isAnalyticsEnabled();
        if (toggle) toggle.checked = isEnabled;
    }

    // version label
    try {
        if (window.electronAPI.getAppVersion) {
            const ver = await window.electronAPI.getAppVersion();
            const el = document.getElementById('settingsVersionLabel');
            if (el) el.textContent = `v${ver}`;
        }
    } catch {}

    // update state — read from help-feedback.js exports at call time
    const updateState          = window._updateState;
    const setSettingsUpdateRow = window._setSettingsUpdateRow;
    if (updateState?.status === 'found')                                                       setSettingsUpdateRow?.('settingsUpdateAvailable');
    else if (updateState?.status === 'preparing' || updateState?.status === 'downloading')     setSettingsUpdateRow?.('settingsUpdateDownloading');
    else if (updateState?.status === 'ready')                                                  setSettingsUpdateRow?.('settingsUpdateReady');
    else if (updateState?.status === 'error')                                                  setSettingsUpdateRow?.('settingsUpdateError');
    else                                                                                        setSettingsUpdateRow?.(null);

    // Quick Switcher settings
    _qsLoadSettings().catch(() => {});

    modal.classList.add('active');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

// ── Quick Switcher settings ──────────────────────────────────────────────────

async function _qsLoadSettings() {
    if (!window.electronAPI?.quickSwitcher) return;
    try {
        const s = await window.electronAPI.quickSwitcher.getSettings();
        const enabledToggle  = document.getElementById('qsEnabledToggle');
        const hotkeyDisplay  = document.getElementById('qsHotkeyDisplay');
        const closeToggle    = document.getElementById('qsCloseAfterSwitchToggle');
        if (enabledToggle) enabledToggle.checked = !!s.enabled;
        if (hotkeyDisplay) hotkeyDisplay.textContent = s.accelerator ? s.accelerator.replace(/\+/g, ' + ') : 'None';
        if (closeToggle) closeToggle.checked = !!s.closeAfterSwitch;
    } catch {}
}

async function qsToggleEnabled(checkbox) {
    // The catch restores with checkbox.checked = prev so UI matches persisted state.
    const quickSwitcher = window.electronAPI?.quickSwitcher;
    if (!quickSwitcher) return;
    const prev = !checkbox.checked;
    let result;
    try { result = await quickSwitcher.setSettings({ enabled: checkbox.checked }); }
    catch (error) {
        checkbox.checked = prev;
        window.electronAPI?.trackFeatureEvent?.('settings_changed', {
            feature: 'quick_switcher', setting: 'enabled', enabled: !prev,
            result: 'failed', error_code: error,
        }).catch?.(() => {});
        return;
    }
    const failed = result?.status === 'error';
    window.electronAPI?.trackFeatureEvent?.('settings_changed', {
        feature: 'quick_switcher', setting: 'enabled', enabled: checkbox.checked,
        result: failed ? 'failed' : 'success',
    }).catch?.(() => {});
    if (failed) checkbox.checked = prev;
}

async function qsChangePosition(select) {
    if (!window.electronAPI?.quickSwitcher) return;
    try {
        const result = await window.electronAPI.quickSwitcher.setSettings({ position: select.value });
        window.electronAPI?.trackFeatureEvent?.('settings_changed', {
            feature: 'quick_switcher', setting: 'position', result: result?.status === 'error' ? 'failed' : 'success',
        }).catch?.(() => {});
    } catch (error) {
        window.electronAPI?.trackFeatureEvent?.('settings_changed', {
            feature: 'quick_switcher', setting: 'position', result: 'failed', error_code: error,
        }).catch?.(() => {});
    }
}

async function qsToggleCloseAfter(checkbox) {
    if (!window.electronAPI?.quickSwitcher) return;
    const prev = !checkbox.checked;
    try {
        const result = await window.electronAPI.quickSwitcher.setSettings({ closeAfterSwitch: checkbox.checked });
        const failed = result?.status === 'error';
        window.electronAPI?.trackFeatureEvent?.('settings_changed', {
            feature: 'quick_switcher', setting: 'close_after_switch', enabled: checkbox.checked,
            result: failed ? 'failed' : 'success',
        }).catch?.(() => {});
        if (failed) checkbox.checked = prev;
    } catch (error) {
        checkbox.checked = prev;
        window.electronAPI?.trackFeatureEvent?.('settings_changed', {
            feature: 'quick_switcher', setting: 'close_after_switch', enabled: !prev,
            result: 'failed', error_code: error,
        }).catch?.(() => {});
    }
}

async function qsChangeHotkey() {
    const result = await _openQSHotkeyModal();
    if (result) {
        const d = document.getElementById('qsHotkeyDisplay');
        if (d) d.textContent = result.replace(/\+/g, ' + ');
        showToast('Quick Switcher hotkey updated', 'success');
    }
}

async function qsResetHotkey() {
    if (!window.electronAPI?.quickSwitcher) return;
    try {
        const result = await window.electronAPI.quickSwitcher.setHotkey('Ctrl+Alt+B');
        if (result?.status === 'error') { showToast(result.message || 'Could not reset hotkey', 'error'); return; }
        await window.electronAPI.quickSwitcher.setSettings({ accelerator: 'Ctrl+Alt+B' });
        const d = document.getElementById('qsHotkeyDisplay');
        if (d) d.textContent = 'Ctrl + Alt + B';
        showToast('Quick Switcher hotkey reset to default', 'success');
    } catch {}
}

function _openQSHotkeyModal() {
    return new Promise((resolve) => {
        let capturedRaw = null, capturedValid = false, capturedMessage = '', capturedDisplay = '';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.cssText = 'z-index:9999; display:flex; align-items:center; justify-content:center;';

        const box = document.createElement('div');
        box.className = 'modal-content';
        box.style.cssText = 'max-width:400px; padding:28px 24px;';
        box.innerHTML = `
            <h3 style="margin:0 0 8px; font-size:1.05rem; color:#e8e8e8;">Change Quick Switcher Hotkey</h3>
            <p style="margin:0 0 18px; font-size:0.83rem; color:#888;">Press a new key combination (one or more modifiers + a key).</p>
            <div id="_qsCapBox" class="shortcut-capture-box">Press a shortcut like Alt + F7</div>
            <p id="_qsCapErr" class="shortcut-error" style="min-height:18px; margin:8px 0 0;"></p>
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:20px;">
                <button id="_qsCapCancel" class="btn-cancel">Cancel</button>
                <button id="_qsCapSave" class="shortcut-save-btn btn-primary" disabled>Save</button>
            </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const capBox = box.querySelector('#_qsCapBox');
        const errEl  = box.querySelector('#_qsCapErr');
        const saveBtn = box.querySelector('#_qsCapSave');
        const cancelBtn = box.querySelector('#_qsCapCancel');

        function refreshUI() {
            if (!capturedRaw) {
                capBox.className = 'shortcut-capture-box';
                capBox.textContent = 'Press a shortcut like Ctrl + Alt + B';
                errEl.textContent = '';
                saveBtn.disabled = true;
            } else if (capturedValid) {
                capBox.className = 'shortcut-capture-box is-valid';
                capBox.textContent = capturedDisplay;
                errEl.textContent = '';
                saveBtn.disabled = false;
            } else {
                capBox.className = 'shortcut-capture-box is-invalid';
                capBox.textContent = capturedDisplay || capturedRaw;
                errEl.textContent = capturedMessage;
                saveBtn.disabled = true;
            }
        }

        function onKeyDown(e) {
            if (e.key === 'Escape') { cleanup(); resolve(null); return; }
            if (e.key === 'Backspace' || e.key === 'Delete') {
                capturedRaw = null; capturedValid = false; capturedMessage = ''; capturedDisplay = '';
                refreshUI(); return;
            }
            if (['Control','Shift','Alt','Meta','Super'].includes(e.key)) return;
            e.preventDefault();
            const parts = [];
            if (e.ctrlKey)  parts.push('Ctrl');
            if (e.shiftKey) parts.push('Shift');
            if (e.altKey)   parts.push('Alt');
            if (e.metaKey)  parts.push('Super');
            const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
            parts.push(k);
            capturedRaw = parts.join('+');
            const v = _qsBasicValidate(capturedRaw);
            capturedValid = v.valid;
            capturedMessage = v.message || '';
            capturedDisplay = v.normalized || parts.slice(0, -1).join(' + ') + ' + ' + k;
            refreshUI();
        }

        document.addEventListener('keydown', onKeyDown);

        function cleanup() {
            document.removeEventListener('keydown', onKeyDown);
            overlay.remove();
        }

        cancelBtn.onclick = () => { cleanup(); resolve(null); };
        overlay.addEventListener('click', e => { if (e.target === overlay) { cleanup(); resolve(null); } });

        saveBtn.onclick = async () => {
            if (!capturedRaw || !capturedValid) return;
            try {
                const result = await window.electronAPI.quickSwitcher.setHotkey(capturedRaw);
                if (result?.status === 'error') { errEl.textContent = result.message || 'Could not register hotkey.'; return; }
                await window.electronAPI.quickSwitcher.setSettings({ accelerator: capturedRaw });
                cleanup();
                resolve(capturedRaw);
            } catch { errEl.textContent = 'Failed to save hotkey.'; }
        };
    });
}

function _qsBasicValidate(accel) {
    const parts = (accel || '').split('+');
    const MODS = new Set(['Ctrl','Shift','Alt','Super','Meta']);
    const mods = parts.filter(p => MODS.has(p));
    const keys = parts.filter(p => !MODS.has(p));
    if (keys.length === 0) return { valid: false, message: 'Include a non-modifier key.', normalized: '' };
    if (mods.length < 1)  return { valid: false, message: 'Use at least one modifier key — e.g. Alt + F7 or Ctrl + B.', normalized: '' };
    return { valid: true, message: '', normalized: parts.join(' + ') };
}

async function toggleAnalytics(checkbox) {
    const isEnabled = checkbox.checked;
    try {
        if (isEnabled) {
            await window.electronAPI.grantAnalyticsConsent();
            localStorage.setItem('baddel_analytics_consent_shown', 'true');
            showToast('Analytics enabled. Thank you!', 'success');
        } else {
            await window.electronAPI.revokeAnalyticsConsent();
            localStorage.setItem('baddel_analytics_consent_shown', 'true');
            showToast('Analytics disabled.', 'success');
        }
    } catch (err) {
        console.error(err);
        checkbox.checked = !isEnabled;
        showToast('Error saving setting.', 'error');
    }
}

async function toggleStartup(checkbox) {
    if (checkbox.dataset.saving === 'true') return;
    // Compute the requested state as the inverse of the last verified state.
    // Do NOT rely on checkbox.checked — it can be stale if a previous result
    // set it back to false and the browser hasn't yet processed the next click.
    const previous  = checkbox.dataset.currentState === 'true';
    const requested = !previous;
    const enabled   = requested; // kept for test compatibility
    checkbox.dataset.saving = 'true';
    checkbox.disabled = true;
    checkbox.checked = requested; // optimistic update visible immediately
    try {
        if (window.electronAPI?.setStartupEnabled) {
            const result = await window.electronAPI.setStartupEnabled(enabled);
            if (result && typeof result.enabled === 'boolean') {
                checkbox.checked = result.enabled;
            }
            const verified = (result && typeof result.enabled === 'boolean') ? result.enabled : requested;
            window.electronAPI?.trackFeatureEvent?.('settings_changed', {
                feature: 'settings', setting: 'launch_at_startup', enabled: verified,
                result: result?.status === 'error' || result?.status === 'mismatch' ? 'failed' : 'success',
            }).catch?.(() => {});
            checkbox.dataset.currentState = String(verified);
            if (result?.status === 'mismatch' || result?.status === 'error') {
                showToast(
                    requested
                        ? 'Startup could not be enabled. Please check Windows Startup Apps and try again.'
                        : 'Startup could not be disabled. Please check Windows Startup Apps.',
                    'error'
                );
            } else if (verified) {
                showToast('Baddel will launch at Windows startup.', 'success');
            } else {
                showToast('Startup launch disabled.', 'success');
            }
        }
    } catch (err) {
        window.electronAPI?.trackFeatureEvent?.('settings_changed', { feature: 'settings', setting: 'launch_at_startup', enabled, result: 'failed', error_code: err }).catch?.(() => {});
        console.error('[Startup] toggle failed:', err);
        checkbox.checked = !enabled;
        checkbox.dataset.currentState = String(!enabled);
        showToast('Error saving setting.', 'error');
    } finally {
        checkbox.disabled = false;
        checkbox.dataset.saving = 'false';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const startupToggleEl = document.getElementById('startupToggle');
    if (startupToggleEl) startupToggleEl.addEventListener('change', () => toggleStartup(startupToggleEl));
});

// Explicit window exports so inline onclick handlers and cross-file calls resolve correctly
window.openSettingsModal  = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.qsToggleEnabled    = qsToggleEnabled;
window.qsChangePosition   = qsChangePosition;
window.qsToggleCloseAfter = qsToggleCloseAfter;
window.qsChangeHotkey     = qsChangeHotkey;
window.qsResetHotkey      = qsResetHotkey;
window.toggleAnalytics    = toggleAnalytics;
window.toggleStartup      = toggleStartup;
