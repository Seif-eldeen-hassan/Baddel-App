'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT   = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── Extraction helper ─────────────────────────────────────────────────────────

function getFunctionBody(source, functionName) {
    const marker = 'function ' + functionName;
    const start = source.indexOf(marker);
    if (start === -1) return '';
    const braceOpen = source.indexOf('{', start);
    if (braceOpen === -1) return '';
    let depth = 0;
    for (let i = braceOpen; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return source.slice(start);
}

// ── Section 1: Source presence in app.js ─────────────────────────────────────

describe('Phase 2.17A: settings/QS — source presence in app.js', () => {
    it('openSettingsModal is defined as an async function', () => {
        assert.match(APP_JS, /async function openSettingsModal\s*\(\s*\)/);
    });
    it('closeSettingsModal is defined', () => {
        assert.match(APP_JS, /function closeSettingsModal\s*\(\s*\)/);
    });
    it('_qsLoadSettings is defined as an async function', () => {
        assert.match(APP_JS, /async function _qsLoadSettings\s*\(\s*\)/);
    });
    it('qsToggleEnabled is defined as an async function', () => {
        assert.match(APP_JS, /async function qsToggleEnabled\s*\(/);
    });
    it('qsChangePosition is defined as an async function', () => {
        assert.match(APP_JS, /async function qsChangePosition\s*\(/);
    });
    it('qsToggleCloseAfter is defined as an async function', () => {
        assert.match(APP_JS, /async function qsToggleCloseAfter\s*\(/);
    });
    it('qsChangeHotkey is defined as an async function', () => {
        assert.match(APP_JS, /async function qsChangeHotkey\s*\(\s*\)/);
    });
    it('qsResetHotkey is defined as an async function', () => {
        assert.match(APP_JS, /async function qsResetHotkey\s*\(\s*\)/);
    });
    it('_openQSHotkeyModal is defined', () => {
        assert.match(APP_JS, /function _openQSHotkeyModal\s*\(\s*\)/);
    });
    it('_qsBasicValidate is defined', () => {
        assert.match(APP_JS, /function _qsBasicValidate\s*\(/);
    });
    it('toggleAnalytics is defined as an async function', () => {
        assert.match(APP_JS, /async function toggleAnalytics\s*\(/);
    });
    it('toggleStartup is defined as an async function', () => {
        assert.match(APP_JS, /async function toggleStartup\s*\(/);
    });
});

// ── Section 2: openSettingsModal behaviour ────────────────────────────────────

describe('Phase 2.17A: settings/QS — openSettingsModal behaviour', () => {
    it('opens settingsModal by adding the active class', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /getElementById\('settingsModal'\)/);
        assert.match(fn, /classList\.add\('active'\)/);
    });
    it('reads getStartupEnabled from electronAPI to populate startupToggle', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /getElementById\('startupToggle'\)/);
        assert.match(fn, /window\.electronAPI.*getStartupEnabled/);
    });
    it('stores verified startup state in startupToggle.dataset.currentState', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /dataset\.currentState/);
    });
    it('reads isAnalyticsEnabled from electronAPI to populate analyticsToggle', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /getElementById\('analyticsToggle'\)/);
        assert.match(fn, /window\.electronAPI.*isAnalyticsEnabled/);
    });
    it('reads getAppVersion from electronAPI and populates settingsVersionLabel', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /getAppVersion/);
        assert.match(fn, /getElementById\('settingsVersionLabel'\)/);
    });
    it('reads window._updateState and calls window._setSettingsUpdateRow', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /window\._updateState/);
        assert.match(fn, /window\._setSettingsUpdateRow/);
    });
    it('calls _qsLoadSettings during open to refresh Quick Switcher settings', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /_qsLoadSettings\(\)/);
    });
    it('defaults startup toggle to checked=true if getStartupEnabled throws', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /catch/);
        assert.match(fn, /startupToggle\.checked\s*=\s*true/);
    });
});

// ── Section 3: closeSettingsModal behaviour ───────────────────────────────────

describe('Phase 2.17A: settings/QS — closeSettingsModal behaviour', () => {
    it('removes the active class from settingsModal', () => {
        const fn = getFunctionBody(APP_JS, 'closeSettingsModal');
        assert.match(fn, /getElementById\('settingsModal'\)/);
        assert.match(fn, /classList\.remove\('active'\)/);
    });
    it('does not call any IPC or async operation', () => {
        const fn = getFunctionBody(APP_JS, 'closeSettingsModal');
        assert.doesNotMatch(fn, /await\b/);
        assert.doesNotMatch(fn, /electronAPI/);
    });
});

// ── Section 4: _qsLoadSettings behaviour ─────────────────────────────────────

describe('Phase 2.17A: settings/QS — _qsLoadSettings behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(APP_JS, '_qsLoadSettings');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
        assert.match(fn, /return/);
    });
    it('calls quickSwitcher.getSettings to fetch current settings', () => {
        const fn = getFunctionBody(APP_JS, '_qsLoadSettings');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.getSettings\(\)/);
    });
    it('populates qsEnabledToggle, qsHotkeyDisplay, qsPositionSelect, qsCloseAfterSwitchToggle', () => {
        const fn = getFunctionBody(APP_JS, '_qsLoadSettings');
        assert.match(fn, /getElementById\('qsEnabledToggle'\)/);
        assert.match(fn, /getElementById\('qsHotkeyDisplay'\)/);
        assert.match(fn, /getElementById\('qsPositionSelect'\)/);
        assert.match(fn, /getElementById\('qsCloseAfterSwitchToggle'\)/);
    });
    it('formats the hotkey display with spaces around plus signs', () => {
        const fn = getFunctionBody(APP_JS, '_qsLoadSettings');
        assert.match(fn, /\.replace\(.*' \+ '\)/);
    });
    it('wraps the IPC call in try/catch', () => {
        const fn = getFunctionBody(APP_JS, '_qsLoadSettings');
        assert.match(fn, /try/);
        assert.match(fn, /catch/);
    });
});

// ── Section 5: qsToggleEnabled behaviour ─────────────────────────────────────

describe('Phase 2.17A: settings/QS — qsToggleEnabled behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(APP_JS, 'qsToggleEnabled');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
        assert.match(fn, /return/);
    });
    it('calls quickSwitcher.setSettings with the enabled value from the checkbox', () => {
        const fn = getFunctionBody(APP_JS, 'qsToggleEnabled');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /enabled.*checkbox\.checked/);
    });
    it('reverts checkbox.checked on error', () => {
        const fn = getFunctionBody(APP_JS, 'qsToggleEnabled');
        assert.match(fn, /catch/);
        assert.match(fn, /checkbox\.checked\s*=\s*prev/);
    });
});

// ── Section 6: qsChangePosition behaviour ────────────────────────────────────

describe('Phase 2.17A: settings/QS — qsChangePosition behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(APP_JS, 'qsChangePosition');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
    });
    it('calls quickSwitcher.setSettings with the position value from the select', () => {
        const fn = getFunctionBody(APP_JS, 'qsChangePosition');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /position.*select\.value/);
    });
});

// ── Section 7: qsToggleCloseAfter behaviour ───────────────────────────────────

describe('Phase 2.17A: settings/QS — qsToggleCloseAfter behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(APP_JS, 'qsToggleCloseAfter');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
    });
    it('calls quickSwitcher.setSettings with closeAfterSwitch', () => {
        const fn = getFunctionBody(APP_JS, 'qsToggleCloseAfter');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /closeAfterSwitch.*checkbox\.checked/);
    });
    it('reverts checkbox.checked on error', () => {
        const fn = getFunctionBody(APP_JS, 'qsToggleCloseAfter');
        assert.match(fn, /catch/);
        assert.match(fn, /checkbox\.checked\s*=\s*prev/);
    });
});

// ── Section 8: qsChangeHotkey behaviour ───────────────────────────────────────

describe('Phase 2.17A: settings/QS — qsChangeHotkey behaviour', () => {
    it('calls _openQSHotkeyModal to capture a new hotkey', () => {
        const fn = getFunctionBody(APP_JS, 'qsChangeHotkey');
        assert.match(fn, /await _openQSHotkeyModal\(\)/);
    });
    it('updates qsHotkeyDisplay if a new hotkey is accepted', () => {
        const fn = getFunctionBody(APP_JS, 'qsChangeHotkey');
        assert.match(fn, /getElementById\('qsHotkeyDisplay'\)/);
        assert.match(fn, /\.replace\(.*' \+ '\)/);
    });
    it('calls showToast with success message after hotkey update', () => {
        const fn = getFunctionBody(APP_JS, 'qsChangeHotkey');
        assert.match(fn, /showToast\(/);
        assert.match(fn, /Quick Switcher hotkey updated/);
    });
    it('does nothing when _openQSHotkeyModal resolves to null (user cancelled)', () => {
        const fn = getFunctionBody(APP_JS, 'qsChangeHotkey');
        assert.match(fn, /if\s*\(result\)/);
    });
});

// ── Section 9: qsResetHotkey behaviour ───────────────────────────────────────

describe('Phase 2.17A: settings/QS — qsResetHotkey behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(APP_JS, 'qsResetHotkey');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
    });
    it('resets the hotkey to Ctrl+Alt+B via quickSwitcher.setHotkey', () => {
        const fn = getFunctionBody(APP_JS, 'qsResetHotkey');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setHotkey\('Ctrl\+Alt\+B'\)/);
    });
    it('updates accelerator in settings after hotkey reset', () => {
        const fn = getFunctionBody(APP_JS, 'qsResetHotkey');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /accelerator.*Ctrl\+Alt\+B/);
    });
    it('updates qsHotkeyDisplay to "Ctrl + Alt + B" after reset', () => {
        const fn = getFunctionBody(APP_JS, 'qsResetHotkey');
        assert.match(fn, /getElementById\('qsHotkeyDisplay'\)/);
        assert.match(fn, /Ctrl \+ Alt \+ B/);
    });
    it('calls showToast with success or error based on result', () => {
        const fn = getFunctionBody(APP_JS, 'qsResetHotkey');
        assert.match(fn, /showToast\(/);
        assert.match(fn, /Quick Switcher hotkey reset to default/);
    });
    it('calls showToast with error if setHotkey returns error status', () => {
        const fn = getFunctionBody(APP_JS, 'qsResetHotkey');
        assert.match(fn, /result.*status.*error|status.*error.*result/);
        assert.match(fn, /'error'/);
    });
});

// ── Section 10: _openQSHotkeyModal behaviour ──────────────────────────────────

describe('Phase 2.17A: settings/QS — _openQSHotkeyModal behaviour', () => {
    it('returns a Promise', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /return new Promise/);
    });
    it('resolves null when user presses Escape', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /key\s*===\s*'Escape'/);
        assert.match(fn, /resolve\(null\)/);
    });
    it('resolves null when user clicks Cancel', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /cancelBtn\.onclick/);
        assert.match(fn, /resolve\(null\)/);
    });
    it('calls quickSwitcher.setHotkey with the captured raw accelerator on save', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setHotkey\(capturedRaw\)/);
    });
    it('calls quickSwitcher.setSettings with the accelerator on save', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /accelerator.*capturedRaw/);
    });
    it('uses validateShortcutCapture if available, falls back to _qsBasicValidate', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /validateShortcutCapture/);
        assert.match(fn, /_qsBasicValidate/);
    });
    it('marks save button disabled initially and enables it only on valid capture', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /saveBtn\.disabled\s*=\s*true/);
        assert.match(fn, /saveBtn\.disabled\s*=\s*false/);
    });
    it('removes keydown listener and the overlay on cleanup', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /removeEventListener\('keydown'/);
        assert.match(fn, /overlay\.remove\(\)/);
    });
});

// ── Section 11: _qsBasicValidate behaviour ────────────────────────────────────

describe('Phase 2.17A: settings/QS — _qsBasicValidate behaviour', () => {
    it('returns valid: false when no non-modifier key is included', () => {
        const fn = getFunctionBody(APP_JS, '_qsBasicValidate');
        assert.match(fn, /keys\.length\s*===\s*0/);
        assert.match(fn, /valid:\s*false/);
        assert.match(fn, /Include a non-modifier key/);
    });
    it('returns valid: false when fewer than 2 modifier keys are provided', () => {
        const fn = getFunctionBody(APP_JS, '_qsBasicValidate');
        assert.match(fn, /mods\.length\s*<\s*2/);
        assert.match(fn, /Use at least 2 modifier keys/);
    });
    it('returns valid: true with a normalized string when valid', () => {
        const fn = getFunctionBody(APP_JS, '_qsBasicValidate');
        assert.match(fn, /valid:\s*true/);
        assert.match(fn, /normalized.*parts\.join/);
    });
    it('recognises Ctrl, Shift, Alt, Super, Meta as modifier keys', () => {
        const fn = getFunctionBody(APP_JS, '_qsBasicValidate');
        assert.match(fn, /Ctrl/);
        assert.match(fn, /Shift/);
        assert.match(fn, /Alt/);
        assert.match(fn, /Super/);
        assert.match(fn, /Meta/);
    });
    it('splits the accelerator string on "+" to extract parts', () => {
        const fn = getFunctionBody(APP_JS, '_qsBasicValidate');
        assert.match(fn, /split\('\+'\)/);
    });
});

// ── Section 12: toggleAnalytics behaviour ────────────────────────────────────

describe('Phase 2.17A: settings/QS — toggleAnalytics behaviour', () => {
    it('calls grantAnalyticsConsent when checkbox is checked', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.match(fn, /window\.electronAPI\.grantAnalyticsConsent\(\)/);
    });
    it('calls revokeAnalyticsConsent when checkbox is unchecked', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.match(fn, /window\.electronAPI\.revokeAnalyticsConsent\(\)/);
    });
    it('persists baddel_analytics_consent_shown to localStorage', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.match(fn, /localStorage\.setItem\('baddel_analytics_consent_shown'/);
    });
    it('calls showToast with success after toggling analytics', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.match(fn, /showToast\(/);
        assert.match(fn, /Analytics enabled/);
        assert.match(fn, /Analytics disabled/);
    });
    it('reverts checkbox.checked and calls showToast with error on failure', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.match(fn, /catch/);
        assert.match(fn, /checkbox\.checked\s*=\s*!isEnabled/);
        assert.match(fn, /Error saving setting/);
    });
});

// ── Section 13: toggleStartup behaviour ──────────────────────────────────────

describe('Phase 2.17A: settings/QS — toggleStartup behaviour', () => {
    it('guards against concurrent saves with dataset.saving', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /dataset\.saving\s*===\s*'true'/);
        assert.match(fn, /dataset\.saving\s*=\s*'true'/);
        assert.match(fn, /dataset\.saving\s*=\s*'false'/);
    });
    it('reads the requested state as the inverse of dataset.currentState', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /dataset\.currentState\s*===\s*'true'/);
        assert.match(fn, /requested\s*=\s*!previous/);
    });
    it('disables the checkbox during the async operation', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /checkbox\.disabled\s*=\s*true/);
        assert.match(fn, /checkbox\.disabled\s*=\s*false/);
    });
    it('calls window.electronAPI.setStartupEnabled with the requested state', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /window\.electronAPI\.setStartupEnabled\(enabled\)/);
    });
    it('updates dataset.currentState with the verified result', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /dataset\.currentState\s*=\s*String\(/);
    });
    it('calls showToast with success message when startup is enabled', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /Baddel will launch at Windows startup/);
    });
    it('calls showToast with success message when startup is disabled', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /Startup launch disabled/);
    });
    it('calls showToast with error and reverts state on exception', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /catch/);
        assert.match(fn, /Error saving setting/);
        assert.match(fn, /checkbox\.checked\s*=\s*!enabled/);
    });
    it('calls showToast with error on mismatch or error status from setStartupEnabled', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /mismatch/);
        assert.match(fn, /Startup could not be enabled/);
    });
    it('resets disabled and saving flags in a finally block', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /finally/);
    });
});

// ── Section 14: DOM IDs in dashboard.html ────────────────────────────────────

describe('Phase 2.17A: settings/QS — DOM IDs in dashboard.html', () => {
    it('settingsModal element exists', () => {
        assert.match(HTML, /id="settingsModal"/);
    });
    it('analyticsToggle element exists', () => {
        assert.match(HTML, /id="analyticsToggle"/);
    });
    it('startupToggle element exists', () => {
        assert.match(HTML, /id="startupToggle"/);
    });
    it('settingsVersionLabel element exists', () => {
        assert.match(HTML, /id="settingsVersionLabel"/);
    });
    it('qsEnabledToggle element exists', () => {
        assert.match(HTML, /id="qsEnabledToggle"/);
    });
    it('qsHotkeyDisplay element exists', () => {
        assert.match(HTML, /id="qsHotkeyDisplay"/);
    });
    it('qsPositionSelect element exists', () => {
        assert.match(HTML, /id="qsPositionSelect"/);
    });
    it('qsCloseAfterSwitchToggle element exists', () => {
        assert.match(HTML, /id="qsCloseAfterSwitchToggle"/);
    });
    it('nav-settings triggers openSettingsModal via onclick', () => {
        assert.match(HTML, /onclick="openSettingsModal\(\)"/);
    });
    it('analyticsToggle triggers toggleAnalytics via onchange', () => {
        assert.match(HTML, /onchange="toggleAnalytics\(this\)"/);
    });
    it('qsEnabledToggle triggers qsToggleEnabled via onchange', () => {
        assert.match(HTML, /onchange="qsToggleEnabled\(this\)"/);
    });
    it('qsPositionSelect triggers qsChangePosition via onchange', () => {
        assert.match(HTML, /onchange="qsChangePosition\(this\)"/);
    });
    it('qsCloseAfterSwitchToggle triggers qsToggleCloseAfter via onchange', () => {
        assert.match(HTML, /onchange="qsToggleCloseAfter\(this\)"/);
    });
    it('Change hotkey button triggers qsChangeHotkey via onclick', () => {
        assert.match(HTML, /onclick="qsChangeHotkey\(\)"/);
    });
    it('Reset hotkey button triggers qsResetHotkey via onclick', () => {
        assert.match(HTML, /onclick="qsResetHotkey\(\)"/);
    });
    it('settings modal close button calls closeSettingsModal via onclick', () => {
        assert.match(HTML, /onclick="closeSettingsModal\(\)"/);
    });
});

// ── Section 15: electronAPI dependencies ─────────────────────────────────────

describe('Phase 2.17A: settings/QS — electronAPI dependencies', () => {
    it('openSettingsModal depends on electronAPI.getStartupEnabled', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /electronAPI.*getStartupEnabled/);
    });
    it('openSettingsModal depends on electronAPI.isAnalyticsEnabled', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /electronAPI.*isAnalyticsEnabled/);
    });
    it('openSettingsModal depends on electronAPI.getAppVersion', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /electronAPI.*getAppVersion/);
    });
    it('_qsLoadSettings depends on electronAPI.quickSwitcher.getSettings', () => {
        const fn = getFunctionBody(APP_JS, '_qsLoadSettings');
        assert.match(fn, /electronAPI\.quickSwitcher\.getSettings/);
    });
    it('qsToggleEnabled depends on electronAPI.quickSwitcher.setSettings', () => {
        const fn = getFunctionBody(APP_JS, 'qsToggleEnabled');
        assert.match(fn, /electronAPI\.quickSwitcher\.setSettings/);
    });
    it('qsResetHotkey depends on electronAPI.quickSwitcher.setHotkey', () => {
        const fn = getFunctionBody(APP_JS, 'qsResetHotkey');
        assert.match(fn, /electronAPI\.quickSwitcher\.setHotkey/);
    });
    it('toggleAnalytics depends on electronAPI.grantAnalyticsConsent', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.match(fn, /electronAPI\.grantAnalyticsConsent/);
    });
    it('toggleAnalytics depends on electronAPI.revokeAnalyticsConsent', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.match(fn, /electronAPI\.revokeAnalyticsConsent/);
    });
    it('toggleStartup depends on electronAPI.setStartupEnabled', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /electronAPI\.setStartupEnabled/);
    });
});

// ── Section 16: Intentional cross-file dependencies ──────────────────────────

describe('Phase 2.17A: settings/QS — intentional cross-file dependencies', () => {
    it('openSettingsModal reads window._updateState from help-feedback.js', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /window\._updateState/);
    });
    it('openSettingsModal calls window._setSettingsUpdateRow from help-feedback.js', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.match(fn, /window\._setSettingsUpdateRow/);
    });
    it('_openQSHotkeyModal uses validateShortcutCapture from accounts.js when available', () => {
        const fn = getFunctionBody(APP_JS, '_openQSHotkeyModal');
        assert.match(fn, /typeof validateShortcutCapture\s*===\s*'function'/);
    });
    it('qsChangeHotkey calls showToast from toast-confirm.js', () => {
        const fn = getFunctionBody(APP_JS, 'qsChangeHotkey');
        assert.match(fn, /showToast\(/);
    });
    it('qsResetHotkey calls showToast from toast-confirm.js', () => {
        const fn = getFunctionBody(APP_JS, 'qsResetHotkey');
        assert.match(fn, /showToast\(/);
    });
    it('toggleAnalytics calls showToast from toast-confirm.js', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.match(fn, /showToast\(/);
    });
    it('toggleStartup calls showToast from toast-confirm.js', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.match(fn, /showToast\(/);
    });
    it('startupToggle DOMContentLoaded handler in app.js wires toggleStartup', () => {
        assert.match(APP_JS, /DOMContentLoaded.*toggleStartup|toggleStartup.*DOMContentLoaded/s);
    });
});

// ── Section 17: Dependency isolation ─────────────────────────────────────────

describe('Phase 2.17A: settings/QS — dependency isolation', () => {
    it('openSettingsModal does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('openSettingsModal does not reference activePlatformView', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.doesNotMatch(fn, /\bactivePlatformView\b/);
    });
    it('openSettingsModal does not reference openPlatformsModal', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.doesNotMatch(fn, /\bopenPlatformsModal\b/);
    });
    it('openSettingsModal does not reference AG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(APP_JS, 'openSettingsModal');
        assert.doesNotMatch(fn, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('toggleAnalytics does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('toggleAnalytics does not reference renderPlatformAccounts', () => {
        const fn = getFunctionBody(APP_JS, 'toggleAnalytics');
        assert.doesNotMatch(fn, /\brenderPlatformAccounts\b/);
    });
    it('toggleStartup does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('toggleStartup does not reference window._agDisplayPrefs', () => {
        const fn = getFunctionBody(APP_JS, 'toggleStartup');
        assert.doesNotMatch(fn, /window\._agDisplayPrefs/);
    });
    it('_qsLoadSettings does not reference window._igDisplayPrefs', () => {
        const fn = getFunctionBody(APP_JS, '_qsLoadSettings');
        assert.doesNotMatch(fn, /window\._igDisplayPrefs/);
    });
    it('_qsBasicValidate does not reference any electronAPI', () => {
        const fn = getFunctionBody(APP_JS, '_qsBasicValidate');
        assert.doesNotMatch(fn, /electronAPI/);
    });
    it('closeSettingsModal does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(APP_JS, 'closeSettingsModal');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('closeSettingsModal does not reference IG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(APP_JS, 'closeSettingsModal');
        assert.doesNotMatch(fn, /\bIG_DISPLAY_DEFAULTS\b/);
    });
});
