'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT            = path.join(__dirname, '..');
const APP_JS          = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const SETTINGS_QS_JS  = fs.readFileSync(path.join(ROOT, 'src/js/app/settings-quick-switcher.js'), 'utf8');
const HTML            = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

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

// ── Section 1: Source presence in settings-quick-switcher.js ─────────────────

describe('Phase 2.17B: settings/QS — source presence in settings-quick-switcher.js', () => {
    it('openSettingsModal is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function openSettingsModal\s*\(\s*\)/);
    });
    it('closeSettingsModal is defined', () => {
        assert.match(SETTINGS_QS_JS, /function closeSettingsModal\s*\(\s*\)/);
    });
    it('_qsLoadSettings is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function _qsLoadSettings\s*\(\s*\)/);
    });
    it('qsToggleEnabled is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function qsToggleEnabled\s*\(/);
    });
    it('qsChangePosition is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function qsChangePosition\s*\(/);
    });
    it('qsToggleCloseAfter is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function qsToggleCloseAfter\s*\(/);
    });
    it('qsChangeHotkey is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function qsChangeHotkey\s*\(\s*\)/);
    });
    it('qsResetHotkey is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function qsResetHotkey\s*\(\s*\)/);
    });
    it('_openQSHotkeyModal is defined', () => {
        assert.match(SETTINGS_QS_JS, /function _openQSHotkeyModal\s*\(\s*\)/);
    });
    it('_qsBasicValidate is defined', () => {
        assert.match(SETTINGS_QS_JS, /function _qsBasicValidate\s*\(/);
    });
    it('toggleAnalytics is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function toggleAnalytics\s*\(/);
    });
    it('toggleStartup is defined as an async function', () => {
        assert.match(SETTINGS_QS_JS, /async function toggleStartup\s*\(/);
    });
    it('startupToggle DOMContentLoaded listener is present', () => {
        assert.match(SETTINGS_QS_JS, /DOMContentLoaded/);
        assert.match(SETTINGS_QS_JS, /startupToggleEl/);
        assert.match(SETTINGS_QS_JS, /toggleStartup\(startupToggleEl\)/);
    });
});

// ── Section 2: openSettingsModal behaviour ────────────────────────────────────

describe('Phase 2.17B: settings/QS — openSettingsModal behaviour', () => {
    it('opens settingsModal by adding the active class', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /getElementById\('settingsModal'\)/);
        assert.match(fn, /classList\.add\('active'\)/);
    });
    it('reads getStartupEnabled from electronAPI to populate startupToggle', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /getElementById\('startupToggle'\)/);
        assert.match(fn, /window\.electronAPI.*getStartupEnabled/);
    });
    it('stores verified startup state in startupToggle.dataset.currentState', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /dataset\.currentState/);
    });
    it('reads isAnalyticsEnabled from electronAPI to populate analyticsToggle', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /getElementById\('analyticsToggle'\)/);
        assert.match(fn, /window\.electronAPI.*isAnalyticsEnabled/);
    });
    it('reads getAppVersion from electronAPI and populates settingsVersionLabel', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /getAppVersion/);
        assert.match(fn, /getElementById\('settingsVersionLabel'\)/);
    });
    it('reads window._updateState and calls window._setSettingsUpdateRow', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /window\._updateState/);
        assert.match(fn, /window\._setSettingsUpdateRow/);
    });
    it('calls _qsLoadSettings during open to refresh Quick Switcher settings', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /_qsLoadSettings\(\)/);
    });
    it('defaults startup toggle to checked=true if getStartupEnabled throws', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /catch/);
        assert.match(fn, /startupToggle\.checked\s*=\s*true/);
    });
});

// ── Section 3: closeSettingsModal behaviour ───────────────────────────────────

describe('Phase 2.17B: settings/QS — closeSettingsModal behaviour', () => {
    it('removes the active class from settingsModal', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'closeSettingsModal');
        assert.match(fn, /getElementById\('settingsModal'\)/);
        assert.match(fn, /classList\.remove\('active'\)/);
    });
    it('does not call any IPC or async operation', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'closeSettingsModal');
        assert.doesNotMatch(fn, /await\b/);
        assert.doesNotMatch(fn, /electronAPI/);
    });
});

// ── Section 4: _qsLoadSettings behaviour ─────────────────────────────────────

describe('Phase 2.17B: settings/QS — _qsLoadSettings behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsLoadSettings');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
        assert.match(fn, /return/);
    });
    it('calls quickSwitcher.getSettings to fetch current settings', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsLoadSettings');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.getSettings\(\)/);
    });
    it('populates qsEnabledToggle, qsHotkeyDisplay, qsCloseAfterSwitchToggle (position selector removed)', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsLoadSettings');
        assert.match(fn, /getElementById\('qsEnabledToggle'\)/);
        assert.match(fn, /getElementById\('qsHotkeyDisplay'\)/);
        assert.match(fn, /getElementById\('qsCloseAfterSwitchToggle'\)/);
        assert.doesNotMatch(fn, /getElementById\('qsPositionSelect'\)/);
    });
    it('formats the hotkey display with spaces around plus signs', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsLoadSettings');
        assert.match(fn, /\.replace\(.*' \+ '\)/);
    });
    it('wraps the IPC call in try/catch', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsLoadSettings');
        assert.match(fn, /try/);
        assert.match(fn, /catch/);
    });
});

// ── Section 5: qsToggleEnabled behaviour ─────────────────────────────────────

describe('Phase 2.17B: settings/QS — qsToggleEnabled behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsToggleEnabled');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
        assert.match(fn, /return/);
    });
    it('calls quickSwitcher.setSettings with the enabled value from the checkbox', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsToggleEnabled');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /enabled.*checkbox\.checked/);
    });
    it('reverts checkbox.checked on error', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsToggleEnabled');
        assert.match(fn, /catch/);
        assert.match(fn, /checkbox\.checked\s*=\s*prev/);
    });
});

// ── Section 6: qsChangePosition behaviour ────────────────────────────────────

describe('Phase 2.17B: settings/QS — qsChangePosition behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsChangePosition');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
    });
    it('calls quickSwitcher.setSettings with the position value from the select', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsChangePosition');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /position.*select\.value/);
    });
});

// ── Section 7: qsToggleCloseAfter behaviour ───────────────────────────────────

describe('Phase 2.17B: settings/QS — qsToggleCloseAfter behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsToggleCloseAfter');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
    });
    it('calls quickSwitcher.setSettings with closeAfterSwitch', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsToggleCloseAfter');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /closeAfterSwitch.*checkbox\.checked/);
    });
    it('reverts checkbox.checked on error', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsToggleCloseAfter');
        assert.match(fn, /catch/);
        assert.match(fn, /checkbox\.checked\s*=\s*prev/);
    });
});

// ── Section 8: qsChangeHotkey behaviour ───────────────────────────────────────

describe('Phase 2.17B: settings/QS — qsChangeHotkey behaviour', () => {
    it('calls _openQSHotkeyModal to capture a new hotkey', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsChangeHotkey');
        assert.match(fn, /await _openQSHotkeyModal\(\)/);
    });
    it('updates qsHotkeyDisplay if a new hotkey is accepted', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsChangeHotkey');
        assert.match(fn, /getElementById\('qsHotkeyDisplay'\)/);
        assert.match(fn, /\.replace\(.*' \+ '\)/);
    });
    it('calls showToast with success message after hotkey update', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsChangeHotkey');
        assert.match(fn, /showToast\(/);
        assert.match(fn, /Quick Switcher hotkey updated/);
    });
    it('does nothing when _openQSHotkeyModal resolves to null (user cancelled)', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsChangeHotkey');
        assert.match(fn, /if\s*\(result\)/);
    });
});

// ── Section 9: qsResetHotkey behaviour ───────────────────────────────────────

describe('Phase 2.17B: settings/QS — qsResetHotkey behaviour', () => {
    it('guards against missing electronAPI.quickSwitcher', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsResetHotkey');
        assert.match(fn, /window\.electronAPI.*quickSwitcher/);
    });
    it('resets the hotkey to Ctrl+Alt+B via quickSwitcher.setHotkey', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsResetHotkey');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setHotkey\('Ctrl\+Alt\+B'\)/);
    });
    it('updates accelerator in settings after hotkey reset', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsResetHotkey');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /accelerator.*Ctrl\+Alt\+B/);
    });
    it('updates qsHotkeyDisplay to "Ctrl + Alt + B" after reset', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsResetHotkey');
        assert.match(fn, /getElementById\('qsHotkeyDisplay'\)/);
        assert.match(fn, /Ctrl \+ Alt \+ B/);
    });
    it('calls showToast with success message after reset', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsResetHotkey');
        assert.match(fn, /showToast\(/);
        assert.match(fn, /Quick Switcher hotkey reset to default/);
    });
    it('calls showToast with error if setHotkey returns error status', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsResetHotkey');
        assert.match(fn, /result.*status.*error|status.*error.*result/);
        assert.match(fn, /'error'/);
    });
});

// ── Section 10: _openQSHotkeyModal behaviour ──────────────────────────────────

describe('Phase 2.17B: settings/QS — _openQSHotkeyModal behaviour', () => {
    it('returns a Promise', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /return new Promise/);
    });
    it('resolves null when user presses Escape', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /key\s*===\s*'Escape'/);
        assert.match(fn, /resolve\(null\)/);
    });
    it('resolves null when user clicks Cancel', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /cancelBtn\.onclick/);
        assert.match(fn, /resolve\(null\)/);
    });
    it('calls quickSwitcher.setHotkey with the captured raw accelerator on save', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setHotkey\(capturedRaw\)/);
    });
    it('calls quickSwitcher.setSettings with the accelerator on save', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /window\.electronAPI\.quickSwitcher\.setSettings/);
        assert.match(fn, /accelerator.*capturedRaw/);
    });
    it('uses _qsBasicValidate for shortcut validation', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /_qsBasicValidate/);
    });
    it('marks save button disabled initially and enables it only on valid capture', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /saveBtn\.disabled\s*=\s*true/);
        assert.match(fn, /saveBtn\.disabled\s*=\s*false/);
    });
    it('removes keydown listener and the overlay on cleanup', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /removeEventListener\('keydown'/);
        assert.match(fn, /overlay\.remove\(\)/);
    });
});

// ── Section 11: _qsBasicValidate behaviour ────────────────────────────────────

describe('Phase 2.17B: settings/QS — _qsBasicValidate behaviour', () => {
    it('returns valid: false when no non-modifier key is included', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsBasicValidate');
        assert.match(fn, /keys\.length\s*===\s*0/);
        assert.match(fn, /valid:\s*false/);
        assert.match(fn, /Include a non-modifier key/);
    });
    it('returns valid: false when no modifier key is provided', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsBasicValidate');
        assert.match(fn, /mods\.length\s*<\s*1/);
        assert.match(fn, /Use at least one modifier key/);
    });
    it('returns valid: true with a normalized string when valid', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsBasicValidate');
        assert.match(fn, /valid:\s*true/);
        assert.match(fn, /normalized.*parts\.join/);
    });
    it('recognises Ctrl, Shift, Alt, Super, Meta as modifier keys', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsBasicValidate');
        assert.match(fn, /Ctrl/);
        assert.match(fn, /Shift/);
        assert.match(fn, /Alt/);
        assert.match(fn, /Super/);
        assert.match(fn, /Meta/);
    });
    it('splits the accelerator string on "+" to extract parts', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsBasicValidate');
        assert.match(fn, /split\('\+'\)/);
    });
});

// ── Section 12: toggleAnalytics behaviour ────────────────────────────────────

describe('Phase 2.17B: settings/QS — toggleAnalytics behaviour', () => {
    it('calls grantAnalyticsConsent when checkbox is checked', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.match(fn, /window\.electronAPI\.grantAnalyticsConsent\(\)/);
    });
    it('calls revokeAnalyticsConsent when checkbox is unchecked', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.match(fn, /window\.electronAPI\.revokeAnalyticsConsent\(\)/);
    });
    it('persists baddel_analytics_consent_shown to localStorage', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.match(fn, /localStorage\.setItem\('baddel_analytics_consent_shown'/);
    });
    it('calls showToast with success after toggling analytics', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.match(fn, /showToast\(/);
        assert.match(fn, /Analytics enabled/);
        assert.match(fn, /Analytics disabled/);
    });
    it('reverts checkbox.checked and calls showToast with error on failure', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.match(fn, /catch/);
        assert.match(fn, /checkbox\.checked\s*=\s*!isEnabled/);
        assert.match(fn, /Error saving setting/);
    });
});

// ── Section 13: toggleStartup behaviour ──────────────────────────────────────

describe('Phase 2.17B: settings/QS — toggleStartup behaviour', () => {
    it('guards against concurrent saves with dataset.saving', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /dataset\.saving\s*===\s*'true'/);
        assert.match(fn, /dataset\.saving\s*=\s*'true'/);
        assert.match(fn, /dataset\.saving\s*=\s*'false'/);
    });
    it('reads the requested state as the inverse of dataset.currentState', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /dataset\.currentState\s*===\s*'true'/);
        assert.match(fn, /requested\s*=\s*!previous/);
    });
    it('disables the checkbox during the async operation', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /checkbox\.disabled\s*=\s*true/);
        assert.match(fn, /checkbox\.disabled\s*=\s*false/);
    });
    it('calls window.electronAPI.setStartupEnabled with the requested state', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /window\.electronAPI\.setStartupEnabled\(enabled\)/);
    });
    it('updates dataset.currentState with the verified result', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /dataset\.currentState\s*=\s*String\(/);
    });
    it('calls showToast with success message when startup is enabled', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /Baddel will launch at Windows startup/);
    });
    it('calls showToast with success message when startup is disabled', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /Startup launch disabled/);
    });
    it('calls showToast with error and reverts state on exception', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /catch/);
        assert.match(fn, /Error saving setting/);
        assert.match(fn, /checkbox\.checked\s*=\s*!enabled/);
    });
    it('calls showToast with error on mismatch or error status from setStartupEnabled', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /mismatch/);
        assert.match(fn, /Startup could not be enabled/);
    });
    it('resets disabled and saving flags in a finally block', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /finally/);
    });
});

// ── Section 14: DOM IDs in dashboard.html ────────────────────────────────────

describe('Phase 2.17B: settings/QS — DOM IDs in dashboard.html', () => {
    it('settingsModal element exists', () => { assert.match(HTML, /id="settingsModal"/); });
    it('analyticsToggle element exists', () => { assert.match(HTML, /id="analyticsToggle"/); });
    it('startupToggle element exists', () => { assert.match(HTML, /id="startupToggle"/); });
    it('settingsVersionLabel element exists', () => { assert.match(HTML, /id="settingsVersionLabel"/); });
    it('qsEnabledToggle element exists', () => { assert.match(HTML, /id="qsEnabledToggle"/); });
    it('qsHotkeyDisplay element exists', () => { assert.match(HTML, /id="qsHotkeyDisplay"/); });
    it('qsPositionSelect element is removed from settings UI', () => { assert.doesNotMatch(HTML, /id="qsPositionSelect"/); });
    it('qsCloseAfterSwitchToggle element exists', () => { assert.match(HTML, /id="qsCloseAfterSwitchToggle"/); });
    it('nav-settings triggers openSettingsModal via onclick', () => {
        assert.match(HTML, /onclick="openSettingsModal\(\)"/);
    });
    it('analyticsToggle triggers toggleAnalytics via onchange', () => {
        assert.match(HTML, /onchange="toggleAnalytics\(this\)"/);
    });
    it('qsEnabledToggle triggers qsToggleEnabled via onchange', () => {
        assert.match(HTML, /onchange="qsToggleEnabled\(this\)"/);
    });
    it('qsPositionSelect onchange handler is not present in settings UI', () => {
        assert.doesNotMatch(HTML, /id="qsPositionSelect"/);
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

describe('Phase 2.17B: settings/QS — electronAPI dependencies', () => {
    it('openSettingsModal depends on electronAPI.getStartupEnabled', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /electronAPI.*getStartupEnabled/);
    });
    it('openSettingsModal depends on electronAPI.isAnalyticsEnabled', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /electronAPI.*isAnalyticsEnabled/);
    });
    it('openSettingsModal depends on electronAPI.getAppVersion', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /electronAPI.*getAppVersion/);
    });
    it('_qsLoadSettings depends on electronAPI.quickSwitcher.getSettings', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsLoadSettings');
        assert.match(fn, /electronAPI\.quickSwitcher\.getSettings/);
    });
    it('qsToggleEnabled depends on electronAPI.quickSwitcher.setSettings', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsToggleEnabled');
        assert.match(fn, /electronAPI\.quickSwitcher\.setSettings/);
    });
    it('qsResetHotkey depends on electronAPI.quickSwitcher.setHotkey', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsResetHotkey');
        assert.match(fn, /electronAPI\.quickSwitcher\.setHotkey/);
    });
    it('toggleAnalytics depends on electronAPI.grantAnalyticsConsent', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.match(fn, /electronAPI\.grantAnalyticsConsent/);
    });
    it('toggleAnalytics depends on electronAPI.revokeAnalyticsConsent', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.match(fn, /electronAPI\.revokeAnalyticsConsent/);
    });
    it('toggleStartup depends on electronAPI.setStartupEnabled', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /electronAPI\.setStartupEnabled/);
    });
});

// ── Section 16: Intentional cross-file dependencies ──────────────────────────

describe('Phase 2.17B: settings/QS — intentional cross-file dependencies', () => {
    it('openSettingsModal reads window._updateState from help-feedback.js', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /window\._updateState/);
    });
    it('openSettingsModal calls window._setSettingsUpdateRow from help-feedback.js', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.match(fn, /window\._setSettingsUpdateRow/);
    });
    it('_openQSHotkeyModal uses _qsBasicValidate for validation', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_openQSHotkeyModal');
        assert.match(fn, /_qsBasicValidate/);
    });
    it('qsChangeHotkey calls showToast from toast-confirm.js', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsChangeHotkey');
        assert.match(fn, /showToast\(/);
    });
    it('qsResetHotkey calls showToast from toast-confirm.js', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'qsResetHotkey');
        assert.match(fn, /showToast\(/);
    });
    it('toggleAnalytics calls showToast from toast-confirm.js', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.match(fn, /showToast\(/);
    });
    it('toggleStartup calls showToast from toast-confirm.js', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.match(fn, /showToast\(/);
    });
    it('startupToggle DOMContentLoaded handler wires toggleStartup', () => {
        assert.match(SETTINGS_QS_JS, /DOMContentLoaded.*toggleStartup|toggleStartup.*DOMContentLoaded/s);
    });
});

// ── Section 17: Dependency isolation ─────────────────────────────────────────

describe('Phase 2.17B: settings/QS — dependency isolation', () => {
    it('openSettingsModal does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('openSettingsModal does not reference activePlatformView', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.doesNotMatch(fn, /\bactivePlatformView\b/);
    });
    it('openSettingsModal does not reference openPlatformsModal', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.doesNotMatch(fn, /\bopenPlatformsModal\b/);
    });
    it('openSettingsModal does not reference AG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'openSettingsModal');
        assert.doesNotMatch(fn, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('toggleAnalytics does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('toggleAnalytics does not reference renderPlatformAccounts', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleAnalytics');
        assert.doesNotMatch(fn, /\brenderPlatformAccounts\b/);
    });
    it('toggleStartup does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('toggleStartup does not reference window._agDisplayPrefs', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'toggleStartup');
        assert.doesNotMatch(fn, /window\._agDisplayPrefs/);
    });
    it('_qsLoadSettings does not reference window._igDisplayPrefs', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsLoadSettings');
        assert.doesNotMatch(fn, /window\._igDisplayPrefs/);
    });
    it('_qsBasicValidate does not reference any electronAPI', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, '_qsBasicValidate');
        assert.doesNotMatch(fn, /electronAPI/);
    });
    it('closeSettingsModal does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'closeSettingsModal');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('closeSettingsModal does not reference IG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(SETTINGS_QS_JS, 'closeSettingsModal');
        assert.doesNotMatch(fn, /\bIG_DISPLAY_DEFAULTS\b/);
    });
});

// ── Section 18: app.js does NOT redeclare moved identifiers ──────────────────

describe('Phase 2.17B: settings/QS — app.js does not redeclare moved identifiers', () => {
    it('app.js does not declare async function openSettingsModal', () => {
        assert.doesNotMatch(APP_JS, /^async function openSettingsModal\s*\(/m);
    });
    it('app.js does not declare function closeSettingsModal', () => {
        assert.doesNotMatch(APP_JS, /^function closeSettingsModal\s*\(/m);
    });
    it('app.js does not declare async function _qsLoadSettings', () => {
        assert.doesNotMatch(APP_JS, /^async function _qsLoadSettings\s*\(/m);
    });
    it('app.js does not declare async function qsToggleEnabled', () => {
        assert.doesNotMatch(APP_JS, /^async function qsToggleEnabled\s*\(/m);
    });
    it('app.js does not declare async function qsChangePosition', () => {
        assert.doesNotMatch(APP_JS, /^async function qsChangePosition\s*\(/m);
    });
    it('app.js does not declare async function qsToggleCloseAfter', () => {
        assert.doesNotMatch(APP_JS, /^async function qsToggleCloseAfter\s*\(/m);
    });
    it('app.js does not declare async function qsChangeHotkey', () => {
        assert.doesNotMatch(APP_JS, /^async function qsChangeHotkey\s*\(/m);
    });
    it('app.js does not declare async function qsResetHotkey', () => {
        assert.doesNotMatch(APP_JS, /^async function qsResetHotkey\s*\(/m);
    });
    it('app.js does not declare function _openQSHotkeyModal', () => {
        assert.doesNotMatch(APP_JS, /^function _openQSHotkeyModal\s*\(/m);
    });
    it('app.js does not declare function _qsBasicValidate', () => {
        assert.doesNotMatch(APP_JS, /^function _qsBasicValidate\s*\(/m);
    });
    it('app.js does not declare async function toggleAnalytics', () => {
        assert.doesNotMatch(APP_JS, /^async function toggleAnalytics\s*\(/m);
    });
    it('app.js does not declare async function toggleStartup', () => {
        assert.doesNotMatch(APP_JS, /^async function toggleStartup\s*\(/m);
    });
});

// ── Section 19: window exports ────────────────────────────────────────────────

describe('Phase 2.17B: settings/QS — window exports', () => {
    it('openSettingsModal is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.openSettingsModal\s*=/);
    });
    it('closeSettingsModal is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.closeSettingsModal\s*=/);
    });
    it('qsToggleEnabled is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.qsToggleEnabled\s*=/);
    });
    it('qsChangePosition is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.qsChangePosition\s*=/);
    });
    it('qsToggleCloseAfter is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.qsToggleCloseAfter\s*=/);
    });
    it('qsChangeHotkey is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.qsChangeHotkey\s*=/);
    });
    it('qsResetHotkey is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.qsResetHotkey\s*=/);
    });
    it('toggleAnalytics is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.toggleAnalytics\s*=/);
    });
    it('toggleStartup is exported to window', () => {
        assert.match(SETTINGS_QS_JS, /window\.toggleStartup\s*=/);
    });
});

// ── Section 20: script load order in dashboard.html ──────────────────────────

describe('Phase 2.17B: settings/QS — script load order in dashboard.html', () => {
    it('settings-quick-switcher.js script tag is present', () => {
        assert.match(HTML, /src="js\/app\/settings-quick-switcher\.js"/);
    });
    it('toast-confirm.js loads before settings-quick-switcher.js', () => {
        const tcIdx  = HTML.indexOf('src="js/app/toast-confirm.js"');
        const sqIdx  = HTML.indexOf('src="js/app/settings-quick-switcher.js"');
        assert.ok(tcIdx !== -1, 'toast-confirm.js script tag not found');
        assert.ok(sqIdx !== -1, 'settings-quick-switcher.js script tag not found');
        assert.ok(tcIdx < sqIdx, 'toast-confirm.js must load before settings-quick-switcher.js');
    });
    it('system-stats.js loads before settings-quick-switcher.js', () => {
        const ssIdx  = HTML.indexOf('src="js/app/system-stats.js"');
        const sqIdx  = HTML.indexOf('src="js/app/settings-quick-switcher.js"');
        assert.ok(ssIdx !== -1, 'system-stats.js script tag not found');
        assert.ok(sqIdx !== -1, 'settings-quick-switcher.js script tag not found');
        assert.ok(ssIdx < sqIdx, 'system-stats.js must load before settings-quick-switcher.js');
    });
    it('settings-quick-switcher.js loads before app.js', () => {
        const sqIdx  = HTML.indexOf('src="js/app/settings-quick-switcher.js"');
        const appIdx = HTML.indexOf('src="js/app.js"');
        assert.ok(sqIdx !== -1, 'settings-quick-switcher.js script tag not found');
        assert.ok(appIdx !== -1, 'app.js script tag not found');
        assert.ok(sqIdx < appIdx, 'settings-quick-switcher.js must load before app.js');
    });
    it('settings-quick-switcher.js loads before accounts/display-prefs.js', () => {
        const sqIdx  = HTML.indexOf('src="js/app/settings-quick-switcher.js"');
        const dpIdx  = HTML.indexOf('src="js/accounts/display-prefs.js"');
        assert.ok(sqIdx !== -1);
        assert.ok(dpIdx !== -1);
        assert.ok(sqIdx < dpIdx);
    });
    it('settings-quick-switcher.js loads before accounts/platform-panels.js', () => {
        const sqIdx  = HTML.indexOf('src="js/app/settings-quick-switcher.js"');
        const ppIdx  = HTML.indexOf('src="js/accounts/platform-panels.js"');
        assert.ok(sqIdx !== -1);
        assert.ok(ppIdx !== -1);
        assert.ok(sqIdx < ppIdx);
    });
});

// ── Section 21: comment hygiene ───────────────────────────────────────────────

describe('Phase 2.17B: settings/QS — comment hygiene', () => {
    it('settings-quick-switcher.js contains no Arabic characters', () => {
        assert.doesNotMatch(SETTINGS_QS_JS, /[؀-ۿ]/);
    });
    it('settings-quick-switcher.js contains no emoji characters', () => {
        assert.doesNotMatch(SETTINGS_QS_JS, /[\u{1F300}-\u{1FAFF}]/u);
    });
    it('settings-quick-switcher.js contains no mojibake sequences', () => {
        assert.doesNotMatch(SETTINGS_QS_JS, /Ø|Ã|â€|Ð|Ñ/);
    });
});
