'use strict';

const fs   = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT    = path.join(__dirname, '..');
const ACC_JS  = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'), 'utf8');
const HTML    = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── Section 1: Account card and view functions ────────────────────────────

describe('Phase 2.11A: platform panels — account card and view functions exist in accounts.js', () => {
    it('showAccountsView is defined', () => {
        assert.match(ACC_JS, /function showAccountsView\s*\(/);
    });
    it('selectAccountPlatform is defined', () => {
        assert.match(ACC_JS, /function selectAccountPlatform\s*\(/);
    });
    it('PLATFORM_CONFIG is defined', () => {
        assert.match(ACC_JS, /const PLATFORM_CONFIG\s*=/);
    });
    it('renderAccountsView is defined', () => {
        assert.match(ACC_JS, /async function renderAccountsView\s*\(/);
    });
    it('loadAccountsForPlatform is defined', () => {
        assert.match(ACC_JS, /async function loadAccountsForPlatform\s*\(/);
    });
    it('_loadShortcutsMap is defined', () => {
        assert.match(ACC_JS, /async function _loadShortcutsMap\s*\(/);
    });
    it('_shortcutBtnHtml is defined', () => {
        assert.match(ACC_JS, /function _shortcutBtnHtml\s*\(/);
    });
    it('_updateCardShortcutBtn is defined', () => {
        assert.match(ACC_JS, /function _updateCardShortcutBtn\s*\(/);
    });
    it('validateShortcutCapture is defined', () => {
        assert.match(ACC_JS, /function validateShortcutCapture\s*\(/);
    });
    it('openShortcutCaptureModal is defined', () => {
        assert.match(ACC_JS, /function openShortcutCaptureModal\s*\(/);
    });
    it('createAccountCard is defined', () => {
        assert.match(ACC_JS, /function createAccountCard\s*\(/);
    });
    it('createDiscordAccountCard is defined', () => {
        assert.match(ACC_JS, /function createDiscordAccountCard\s*\(/);
    });
    it('createSteamAccountCard is defined', () => {
        assert.match(ACC_JS, /function createSteamAccountCard\s*\(/);
    });
    it('copyToClipboard is defined', () => {
        assert.match(ACC_JS, /function copyToClipboard\s*\(/);
    });
    it('loadSteamAvatar is defined', () => {
        assert.match(ACC_JS, /async function loadSteamAvatar\s*\(/);
    });
    it('handleSwitchAccount is defined', () => {
        assert.match(ACC_JS, /async function handleSwitchAccount\s*\(/);
    });
    it('handleSaveAccount is defined', () => {
        assert.match(ACC_JS, /async function handleSaveAccount\s*\(/);
    });
    it('addNewAccount is defined', () => {
        assert.match(ACC_JS, /async function addNewAccount\s*\(/);
    });
    it('showLauncherLocatorDialog is defined', () => {
        assert.match(ACC_JS, /async function showLauncherLocatorDialog\s*\(/);
    });
    it('showRiotClientLocatorDialog is defined', () => {
        assert.match(ACC_JS, /async function showRiotClientLocatorDialog\s*\(/);
    });
    it('isColorLight is defined', () => {
        assert.match(ACC_JS, /function isColorLight\s*\(/);
    });
    it('handleRenameAccount is defined', () => {
        assert.match(ACC_JS, /async function handleRenameAccount\s*\(/);
    });
    it('handleDeleteAccount is defined', () => {
        assert.match(ACC_JS, /function handleDeleteAccount\s*\(/);
    });
    it('ipcInvoke is defined', () => {
        assert.match(ACC_JS, /async function ipcInvoke\s*\(/);
    });
    it('promptAccountName is defined', () => {
        assert.match(ACC_JS, /function promptAccountName\s*\(/);
    });
    it('updateAllAccountCounts is defined', () => {
        assert.match(ACC_JS, /async function updateAllAccountCounts\s*\(/);
    });
    it('showEpicLibraryPanel is defined', () => {
        assert.match(ACC_JS, /async function showEpicLibraryPanel\s*\(/);
    });
    it('_renderEpicLibraryPanel is defined', () => {
        assert.match(ACC_JS, /async function _renderEpicLibraryPanel\s*\(/);
    });
});

// ── Section 2: Platform-specific wrapper functions ────────────────────────

describe('Phase 2.11A: platform panels — platform-specific wrappers exist in accounts.js', () => {
    const wrappers = [
        'switchSteamAccount', 'switchEpicAccount', 'switchEAAccount',
        'switchRiotAccount', 'switchUbisoftAccount',
        'saveEpicAccount', 'saveEAAccount', 'saveRiotAccount', 'saveUbisoftAccount',
        'addNewSteamAccount', 'addNewEpicAccount', 'addNewEAAccount',
        'addNewRiotAccount', 'addNewUbisoftAccount',
        'switchDiscordAccount', 'saveDiscordAccount', 'addNewDiscordAccount',
        'switchRockstarAccount', 'saveRockstarAccount', 'addNewRockstarAccount',
    ];
    for (const name of wrappers) {
        it(`${name} is defined`, () => {
            assert.match(ACC_JS, new RegExp(`(?:async )?function ${name}\\s*\\(`));
        });
    }
});

// ── Section 3: Platform sync state functions ──────────────────────────────

describe('Phase 2.11A: platform panels — platform sync state functions exist in accounts.js', () => {
    it('state var activePlatformView is declared', () => {
        assert.match(ACC_JS, /let activePlatformView\b/);
    });
    it('state var platformSyncStateCache is declared', () => {
        assert.match(ACC_JS, /(?:let|const) platformSyncStateCache\b/);
    });
    it('state var platformSyncRenderTimers is declared', () => {
        assert.match(ACC_JS, /(?:let|const) platformSyncRenderTimers\b/);
    });
    it('state var platformSyncListenerBound is declared', () => {
        assert.match(ACC_JS, /let platformSyncListenerBound\b/);
    });
    it('_escapePlatformSyncHtml is defined', () => {
        assert.match(ACC_JS, /function _escapePlatformSyncHtml\s*\(/);
    });
    it('_countPlatformAccountGames is defined', () => {
        assert.match(ACC_JS, /function _countPlatformAccountGames\s*\(/);
    });
    it('_platformAccountOwnsGame is defined', () => {
        assert.match(ACC_JS, /function _platformAccountOwnsGame\s*\(/);
    });
    it('_summarizePlatformGameTitles is defined', () => {
        assert.match(ACC_JS, /function _summarizePlatformGameTitles\s*\(/);
    });
    it('_buildFriendlyPlatformSyncCopy is defined', () => {
        assert.match(ACC_JS, /function _buildFriendlyPlatformSyncCopy\s*\(/);
    });
    it('_renderPlatformSyncOverlay is defined', () => {
        assert.match(ACC_JS, /function _renderPlatformSyncOverlay\s*\(/);
    });
    it('_hidePlatformSyncOverlay is defined', () => {
        assert.match(ACC_JS, /function _hidePlatformSyncOverlay\s*\(/);
    });
    it('_getPlatformSyncState is defined', () => {
        assert.match(ACC_JS, /function _getPlatformSyncState\s*\(/);
    });
    it('_refreshPlatformSyncState is defined', () => {
        assert.match(ACC_JS, /async function _refreshPlatformSyncState\s*\(/);
    });
    it('_schedulePlatformAccountsRender is defined', () => {
        assert.match(ACC_JS, /function _schedulePlatformAccountsRender\s*\(/);
    });
    it('_getPlatformSyncStatusLabel is defined', () => {
        assert.match(ACC_JS, /function _getPlatformSyncStatusLabel\s*\(/);
    });
    it('_TRANSIENT_UI_STATUSES is declared', () => {
        assert.match(ACC_JS, /(?:const|let) _TRANSIENT_UI_STATUSES\b/);
    });
    it('_sanitizePlatformAccountName is defined', () => {
        assert.match(ACC_JS, /function _sanitizePlatformAccountName\s*\(/);
    });
    it('_deriveAccountStatusFromData is defined', () => {
        assert.match(ACC_JS, /function _deriveAccountStatusFromData\s*\(/);
    });
    it('_renderPlatformSyncStatusPanel is defined', () => {
        assert.match(ACC_JS, /function _renderPlatformSyncStatusPanel\s*\(/);
    });
    it('_ensurePlatformSyncListener is defined', () => {
        assert.match(ACC_JS, /function _ensurePlatformSyncListener\s*\(/);
    });
    it('_runPlatformSync is defined', () => {
        assert.match(ACC_JS, /function _runPlatformSync\s*\(/);
    });
    it('openPlatformsModal is defined', () => {
        assert.match(ACC_JS, /function openPlatformsModal\s*\(/);
    });
    it('closePlatformsModal is defined', () => {
        assert.match(ACC_JS, /function closePlatformsModal\s*\(/);
    });
    it('backToPlatformsList is defined', () => {
        assert.match(ACC_JS, /function backToPlatformsList\s*\(/);
    });
    it('updatePlatformsOverview is defined', () => {
        assert.match(ACC_JS, /async function updatePlatformsOverview\s*\(/);
    });
    it('openPlatformDetails is defined', () => {
        assert.match(ACC_JS, /async function openPlatformDetails\s*\(/);
    });
    it('renderPlatformAccounts is defined', () => {
        assert.match(ACC_JS, /async function renderPlatformAccounts\s*\(/);
    });
    it('linkNewPlatformAccount is defined', () => {
        assert.match(ACC_JS, /async function linkNewPlatformAccount\s*\(/);
    });
    it('unlinkPlatformAccount is defined', () => {
        assert.match(ACC_JS, /async function unlinkPlatformAccount\s*\(/);
    });
    it('syncCurrentPlatform is defined', () => {
        assert.match(ACC_JS, /function syncCurrentPlatform\s*\(/);
    });
    it('syncSinglePlatformAccount is defined', () => {
        assert.match(ACC_JS, /function syncSinglePlatformAccount\s*\(/);
    });
});

// ── Section 4: Window exports ─────────────────────────────────────────────

describe('Phase 2.11A: platform panels — window exports in accounts.js', () => {
    it('window.handlePinAccount is exported', () => {
        assert.match(ACC_JS, /window\.handlePinAccount\s*=/);
    });
});

// ── Section 5: DOM IDs used by platform panel functions ───────────────────

describe('Phase 2.11A: platform panels — DOM IDs referenced in accounts.js', () => {
    const domIds = [
        'accountsView',
        'accountsGrid',
        'heroAccountCount',
        'accountsOnboardWrap',
        'platformSyncSimpleOverlay',
        'platformSyncSimpleTitle',
        'platformSyncSimpleSubtitle',
        'platformSyncSimpleSpinner',
        'platformSyncStatusPanel',
        'syncPlatformBtn',
        'linkPlatformBtn',
        'platformsListView',
        'platformDetailsView',
        'currentPlatformTitle',
        'linkedAccountsList',
        'epicAccountsCount',
        'steamAccountsCount',
    ];
    for (const id of domIds) {
        it(`accounts.js references DOM id #${id}`, () => {
            assert.match(ACC_JS, new RegExp(`['"\`]${id}['"\`]`));
        });
    }
});

describe('Phase 2.11A: platform panels — DOM IDs present in dashboard.html', () => {
    const domIds = [
        'accountsView',
        'platformSyncSimpleOverlay',
        'platformSyncStatusPanel',
        'syncPlatformBtn',
        'linkPlatformBtn',
        'currentPlatformTitle',
        'linkedAccountsList',
        'epicAccountsCount',
        'steamAccountsCount',
        'plat-nav-epic',
        'plat-nav-steam',
    ];
    for (const id of domIds) {
        it(`dashboard.html contains element id="${id}"`, () => {
            assert.match(HTML, new RegExp(`id=["']${id}["']`));
        });
    }
});

// ── Section 6: Inline onclick handlers in dashboard.html ─────────────────

describe('Phase 2.11A: platform panels — inline handlers in dashboard.html', () => {
    it('dashboard.html calls openPlatformsModal() via onclick', () => {
        assert.match(HTML, /onclick="openPlatformsModal\(\)"/);
    });
    it('dashboard.html calls closePlatformsModal() via onclick', () => {
        assert.match(HTML, /onclick="closePlatformsModal\(\)"/);
    });
    it("dashboard.html calls openPlatformDetails('epic') via onclick", () => {
        assert.match(HTML, /onclick="openPlatformDetails\('epic'\)"/);
    });
    it("dashboard.html calls openPlatformDetails('steam') via onclick", () => {
        assert.match(HTML, /onclick="openPlatformDetails\('steam'\)"/);
    });
    it('dashboard.html calls linkNewPlatformAccount() via onclick', () => {
        assert.match(HTML, /onclick="linkNewPlatformAccount\(\)"/);
    });
    it('dashboard.html calls syncCurrentPlatform() via onclick', () => {
        assert.match(HTML, /onclick="syncCurrentPlatform\(\)"/);
    });
    it("dashboard.html calls selectAccountPlatform('steam') via onclick", () => {
        assert.match(HTML, /onclick="selectAccountPlatform\('steam'\)"/);
    });
    it("dashboard.html calls selectAccountPlatform('epic') via onclick", () => {
        assert.match(HTML, /onclick="selectAccountPlatform\('epic'\)"/);
    });
});

// ── Section 7: localStorage keys ─────────────────────────────────────────

describe('Phase 2.11A: platform panels — localStorage keys used', () => {
    it('accounts.js reads/writes baddel_pinned_accounts', () => {
        assert.match(ACC_JS, /['"]baddel_pinned_accounts['"]/);
    });
});

// ── Section 8: Cross-file dependencies (electronAPI calls) ───────────────

describe('Phase 2.11A: platform panels — electronAPI calls in accounts.js', () => {
    const apiCalls = [
        'platformSyncGetAccounts',
        'platformSyncGetCached',
        'platformSyncGetState',
        'platformSyncLink',
        'platformSyncUnlink',
        'platformSyncSync',
        'onPlatformSyncState',
        'onPlatformSyncCompleted',
        'onPlatformSyncFailed',
        'onPlatformLinkStateChanged',
        'getSteamImage',
    ];
    for (const call of apiCalls) {
        it(`accounts.js references window.electronAPI.${call}`, () => {
            assert.match(ACC_JS, new RegExp(`window\\.electronAPI\\.${call}\\b`));
        });
    }
});

// ── Section 9: Dependency isolation — no out-of-scope references ──────────

describe('Phase 2.11A: platform panels — dependency isolation', () => {
    // Bound the platform-sync section: from activePlatformView to syncSinglePlatformAccount end.
    // The IG toolbar and game-filter sections that follow legitimately use currentFilters etc.
    const syncStart = ACC_JS.indexOf('let activePlatformView');
    const syncEnd   = ACC_JS.indexOf('function syncSinglePlatformAccount');
    const syncSection = syncStart !== -1 && syncEnd !== -1
        ? ACC_JS.slice(syncStart, syncEnd + 200)
        : '';

    it('platform sync section bounds are resolvable', () => {
        assert.ok(syncSection.length > 100, 'sync section slice must be non-empty');
    });
    it('platform sync section does not reference currentFilters', () => {
        assert.doesNotMatch(syncSection, /\bcurrentFilters\b/);
    });
    it('platform sync section does not reference playtimeData', () => {
        assert.doesNotMatch(syncSection, /\bplaytimeData\b/);
    });
    it('platform sync section does not reference window._vs', () => {
        assert.doesNotMatch(syncSection, /window\._vs\b/);
    });
});

// ── Section 10: No redeclaration of items moved to display-prefs.js ───────

describe('Phase 2.11A: platform panels — accounts.js does not redefine display-prefs symbols', () => {
    it('accounts.js does not define AG_DISPLAY_DEFAULTS', () => {
        assert.doesNotMatch(ACC_JS, /const AG_DISPLAY_DEFAULTS\s*=/);
    });
    it('accounts.js does not define IG_DISPLAY_DEFAULTS', () => {
        assert.doesNotMatch(ACC_JS, /const IG_DISPLAY_DEFAULTS\s*=/);
    });
    it('accounts.js does not define _agLoadDisplayPrefs', () => {
        assert.doesNotMatch(ACC_JS, /function _agLoadDisplayPrefs\s*\(/);
    });
    it('accounts.js does not define _igLoadDisplayPrefs', () => {
        assert.doesNotMatch(ACC_JS, /function _igLoadDisplayPrefs\s*\(/);
    });
    it('accounts.js does not define _agSaveDisplayPrefs', () => {
        assert.doesNotMatch(ACC_JS, /function _agSaveDisplayPrefs\s*\(/);
    });
    it('accounts.js does not define _igSaveDisplayPrefs', () => {
        assert.doesNotMatch(ACC_JS, /function _igSaveDisplayPrefs\s*\(/);
    });
    it('accounts.js does not define _agApplyDisplayPrefs as a function statement', () => {
        assert.doesNotMatch(ACC_JS, /^function _agApplyDisplayPrefs\s*\(/m);
    });
    it('accounts.js does not define _igApplyDisplayPrefs as a function statement', () => {
        assert.doesNotMatch(ACC_JS, /^function _igApplyDisplayPrefs\s*\(/m);
    });
    it('accounts.js calls _agApplyDisplayPrefs through window guard', () => {
        assert.match(ACC_JS, /window\._agApplyDisplayPrefs\?\.\(\)/);
    });
    it('accounts.js calls _igApplyDisplayPrefs through window guard', () => {
        assert.match(ACC_JS, /window\._igApplyDisplayPrefs\?\.\(\)/);
    });
});
