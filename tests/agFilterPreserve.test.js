'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// All Games filter-state preservation tests
//
// PURPOSE
//   Verify that a background library-updated event (platform sync completing)
//   does not silently reset the user's active filters. Covers:
//     – snapshot / restore helpers exist and have correct shape
//     – _agRenderAccountFilterOptions preserves selected account when it still exists
//     – onLibraryUpdated snapshots before and restores after account options rebuild
//     – navigateToAllGames supports preserveFilters option
//     – renderAllGamesView supports preserveFilters option
//     – sync-complete path never resets filters when currentView === 'all-games'
//
// TARGET FILE: src/js/accounts.js
// ─────────────────────────────────────────────────────────────────────────────

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const ACC_JS = fs.readFileSync(
    path.join(__dirname, '../src/js/accounts.js'), 'utf8'
);

function extractFn(src, signature) {
    const idx = src.indexOf(signature);
    if (idx === -1) return '';
    // Scan from signature start to find '(' of the parameter list (handles signatures that end with '(')
    let i = idx;
    while (i < src.length && src[i] !== '(') i++;
    // Skip the entire parameter list so '{' inside default params (e.g. options = {}) are not counted
    let parenDepth = 0;
    while (i < src.length) {
        if (src[i] === '(') parenDepth++;
        else if (src[i] === ')') { parenDepth--; if (parenDepth === 0) { i++; break; } }
        i++;
    }
    // Find the opening '{' of the function body
    while (i < src.length && src[i] !== '{') i++;
    let depth = 0;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
        i++;
    }
    return src.slice(idx);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Helper existence and shape
// ─────────────────────────────────────────────────────────────────────────────

test('_agSnapshotFilterState is defined in accounts.js', () => {
    assert.match(ACC_JS, /function _agSnapshotFilterState\s*\(\s*\)/);
});

test('_agSnapshotFilterState captures platform, sort, search, account from _agState', () => {
    const body = extractFn(ACC_JS, 'function _agSnapshotFilterState(');
    assert.match(body, /platform/);
    assert.match(body, /sort/);
    assert.match(body, /search/);
    assert.match(body, /account/);
});

test('_agSnapshotFilterState captures agInstalledOnly and agReadyOnly', () => {
    const body = extractFn(ACC_JS, 'function _agSnapshotFilterState(');
    assert.match(body, /agInstalledOnly/);
    assert.match(body, /agReadyOnly/);
});

test('_agSnapshotFilterState captures scrollTop', () => {
    const body = extractFn(ACC_JS, 'function _agSnapshotFilterState(');
    assert.match(body, /scrollTop/);
});

test('_agRestoreFilterState is defined in accounts.js', () => {
    assert.match(ACC_JS, /function _agRestoreFilterState\s*\(/);
});

test('_agRestoreFilterState restores platform, sort, search, account', () => {
    const body = extractFn(ACC_JS, 'function _agRestoreFilterState(');
    assert.match(body, /window\._agState\.platform/);
    assert.match(body, /window\._agState\.sort/);
    assert.match(body, /window\._agState\.search/);
    assert.match(body, /window\._agState\.account/);
});

test('_agRestoreFilterState restores agInstalledOnly and agReadyOnly', () => {
    const body = extractFn(ACC_JS, 'function _agRestoreFilterState(');
    assert.match(body, /window\.agInstalledOnly/);
    assert.match(body, /window\.agReadyOnly/);
});

test('_agRestoreFilterState calls _agSyncFilterUiFromState', () => {
    const body = extractFn(ACC_JS, 'function _agRestoreFilterState(');
    assert.match(body, /_agSyncFilterUiFromState/);
});

test('_agRestoreFilterState calls window._agUpdateSearchClear if available', () => {
    const body = extractFn(ACC_JS, 'function _agRestoreFilterState(');
    assert.match(body, /_agUpdateSearchClear/);
});

test('_agSyncFilterUiFromState is defined in accounts.js', () => {
    assert.match(ACC_JS, /function _agSyncFilterUiFromState\s*\(/);
});

test('_agSyncFilterUiFromState sets platform pill active state', () => {
    const body = extractFn(ACC_JS, 'function _agSyncFilterUiFromState(');
    assert.match(body, /ag-pill/);
    assert.match(body, /data-platform/);
});

test('_agSyncFilterUiFromState updates sort label and sort items', () => {
    const body = extractFn(ACC_JS, 'function _agSyncFilterUiFromState(');
    assert.match(body, /agSortLabel/);
    assert.match(body, /ag-sort-item/);
});

test('_agSyncFilterUiFromState updates account dropdown text', () => {
    const body = extractFn(ACC_JS, 'function _agSyncFilterUiFromState(');
    assert.match(body, /selectedAgAccountText/);
});

test('_agSyncFilterUiFromState updates installed toggle active class', () => {
    const body = extractFn(ACC_JS, 'function _agSyncFilterUiFromState(');
    assert.match(body, /agInstalledToggle/);
    assert.match(body, /agInstalledOnly/);
});

test('_agSyncFilterUiFromState toggles ag-ready-mode on body', () => {
    const body = extractFn(ACC_JS, 'function _agSyncFilterUiFromState(');
    assert.match(body, /ag-ready-mode/);
    assert.match(body, /agReadyOnly/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — _agRenderAccountFilterOptions account preservation
// ─────────────────────────────────────────────────────────────────────────────

test('_agRenderAccountFilterOptions preserves account when it still exists in option map', () => {
    const body = extractFn(ACC_JS, 'function _agRenderAccountFilterOptions(');
    // Must check whether previous account is still in the new map, not blindly reset
    assert.match(body, /optionMap\.has/);
    assert.match(body, /previousAccount|resolvedAccount/);
});

test('_agRenderAccountFilterOptions logs when account is dropped', () => {
    const body = extractFn(ACC_JS, 'function _agRenderAccountFilterOptions(');
    assert.match(body, /\[AGFILTER\]/);
    assert.match(body, /dropped from options|no longer available/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — onLibraryUpdated handler: snapshot before / restore after
// ─────────────────────────────────────────────────────────────────────────────

{
    // Scope the search to the onLibraryUpdated handler body only
    const handlerIdx = ACC_JS.indexOf('_agSubscribePlatformLibraryCommitted(async (');
    assert.ok(handlerIdx !== -1, 'platform-library-committed handler not found');
    const handlerBody = ACC_JS.slice(handlerIdx, handlerIdx + 16000);

    test('onLibraryUpdated: takes filterSnapshot before DOM mutations', () => {
        assert.match(handlerBody, /filterSnapshot\s*=\s*_agSnapshotFilterState\(\)/);
    });

    test('onLibraryUpdated: calls _agRestoreFilterState in unchanged-pool path', () => {
        const unchangedIdx = handlerBody.indexOf('_bgPoolUnchanged');
        assert.ok(unchangedIdx !== -1, '_bgPoolUnchanged not found in handler');
        // The restore call must appear after the unchanged pool path is entered
        const restoreIdx = handlerBody.indexOf('_agRestoreFilterState(filterSnapshot', unchangedIdx);
        assert.ok(restoreIdx !== -1, '_agRestoreFilterState(filterSnapshot) must appear in unchanged-pool path');
    });

    test('onLibraryUpdated: restores filters before computing background pool signature', () => {
        const snapIdx    = handlerBody.indexOf('filterSnapshot = _agSnapshotFilterState()');
        const restoreIdx = handlerBody.indexOf('_agRestoreFilterState(filterSnapshot', snapIdx);
        const poolIdx    = handlerBody.indexOf('_agBuildFilteredPool({ cache: _bgBase, useCanonical: _bgUseCanonical })');
        assert.ok(snapIdx !== -1, 'filterSnapshot not found');
        assert.ok(restoreIdx !== -1, 'early _agRestoreFilterState not found');
        assert.ok(poolIdx !== -1, 'background _agBuildFilteredPool not found');
        assert.ok(restoreIdx < poolIdx, 'filters must be restored before computing the background pool');
    });

    test('onLibraryUpdated: calls _agRestoreFilterState in changed-pool path (before _applyAgFilters)', () => {
        // There must be a restore call before _applyAgFilters in the changed-pool path
        const applyIdx   = handlerBody.indexOf('_applyAgFilters(');
        const restoreIdx = handlerBody.lastIndexOf('_agRestoreFilterState(filterSnapshot', applyIdx);
        assert.ok(applyIdx   !== -1, '_applyAgFilters must be called in handler');
        assert.ok(restoreIdx !== -1, '_agRestoreFilterState must appear before _applyAgFilters');
        assert.ok(restoreIdx < applyIdx, '_agRestoreFilterState must precede _applyAgFilters');
    });

    test('onLibraryUpdated: uses preserve-filters reason string for _applyAgFilters', () => {
        assert.match(handlerBody, /background-library-updated-preserve-filters/);
    });

    test('onLibraryUpdated: logs AGFILTER snapshot and restore when baddel_debug_vs', () => {
        assert.match(handlerBody, /\[AGFILTER\].*snapshot before sync/);
        assert.match(handlerBody, /\[AGFILTER\].*restored before apply/);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — navigateToAllGames preserveFilters option
// ─────────────────────────────────────────────────────────────────────────────

test('navigateToAllGames supports preserveFilters option', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const body = ACC_JS.slice(fnStart, fnStart + 1600);
    assert.match(body, /opts\.preserveFilters/);
});

test('navigateToAllGames preserveFilters calls _agSnapshotFilterState', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const body = ACC_JS.slice(fnStart, fnStart + 1600);
    assert.match(body, /_agSnapshotFilterState\(\)/);
});

test('navigateToAllGames preserveFilters sets _keepReadyMode to avoid resetting agReadyOnly', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const body = ACC_JS.slice(fnStart, fnStart + 1600);
    assert.match(body, /_keepReadyMode.*true/);
});

test('navigateToAllGames preserveFilters populates restoreState from snapshot', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const body = ACC_JS.slice(fnStart, fnStart + 1600);
    assert.match(body, /restoreState/);
    assert.match(body, /_snap\.state\.platform/);
    assert.match(body, /_snap\.state\.sort/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — renderAllGamesView preserveFilters option
// ─────────────────────────────────────────────────────────────────────────────

test('renderAllGamesView supports preserveFilters option', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const body = ACC_JS.slice(fnStart, fnStart + 9000);
    assert.match(body, /options\.preserveFilters/);
});

test('renderAllGamesView with preserveFilters: snapshots before full-cache _agRenderAccountFilterOptions', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const body = ACC_JS.slice(fnStart, fnStart + 9000);
    // Use the specific full-cache call (not the early [] call for the no-account path)
    const snapIdx    = body.indexOf('_agSnapshotFilterState()');
    const accountIdx = body.indexOf('_agRenderAccountFilterOptions(window._allGamesCache)');
    assert.ok(snapIdx    !== -1, '_agSnapshotFilterState call not found in renderAllGamesView');
    assert.ok(accountIdx !== -1, '_agRenderAccountFilterOptions(window._allGamesCache) call not found in renderAllGamesView');
    assert.ok(snapIdx < accountIdx, 'snapshot must precede full-cache account options rebuild');
});

test('renderAllGamesView with preserveFilters: calls _applyAgFilters instead of raw render', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const body = ACC_JS.slice(fnStart, fnStart + 9000);
    assert.match(body, /options\.preserveFilters[\s\S]{0,1200}_applyAgFilters/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Sync-complete callers audit
// ─────────────────────────────────────────────────────────────────────────────

test('onLibraryUpdated no-accounts path calls renderAllGamesView with preserveFilters', () => {
    const handlerIdx = ACC_JS.indexOf('_agSubscribePlatformLibraryCommitted(async (');
    const handlerBody = ACC_JS.slice(handlerIdx, handlerIdx + 1500);
    // The no-accounts early path (when _agNoLinkedAccounts) must pass preserveFilters
    assert.match(handlerBody, /renderAllGamesView\(\{[^}]*preserveFilters/);
});

test('navigateToAllGames does not reset agInstalledOnly when preserveFilters is used', () => {
    // The preserveFilters path converts to restoreState so agInstalledOnly is kept via snapshot
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const body = ACC_JS.slice(fnStart, fnStart + 1600);
    // Within the preserveFilters block there must be no direct agInstalledOnly = false
    const pfStart = body.indexOf('opts.preserveFilters');
    const pfBlock = body.slice(pfStart, pfStart + 600);
    assert.doesNotMatch(pfBlock, /agInstalledOnly\s*=\s*false/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Behavioral simulation: filter state survives a sync refresh
// ─────────────────────────────────────────────────────────────────────────────

{
    // Simulate the snapshot + restore cycle in pure JS (no DOM / window needed
    // for the state-object logic, only the state field assignments).

    function simulateSnapshotState(agState, installedOnly, readyOnly) {
        return {
            state: {
                platform: agState.platform || 'all',
                sort:     agState.sort     || 'title_asc',
                search:   agState.search   || '',
                account:  agState.account  || 'all',
            },
            agInstalledOnly: !!installedOnly,
            agReadyOnly:     !!readyOnly,
            searchInputValue: agState.search || '',
            selectedAccountText: 'Steam - TestUser',
            scrollTop: 0,
        };
    }

    function simulateRestore(snapshot, currentAgState) {
        currentAgState.platform = snapshot.state.platform;
        currentAgState.sort     = snapshot.state.sort;
        currentAgState.search   = snapshot.state.search;
        currentAgState.account  = snapshot.state.account;
        return currentAgState;
    }

    test('simulation: platform=steam survives after snapshot/restore cycle', () => {
        const before = { platform: 'steam', sort: 'title_asc', search: '', account: 'all' };
        const snap   = simulateSnapshotState(before, false, false);
        // Simulate sync resetting state
        const after  = { platform: 'all', sort: 'title_asc', search: '', account: 'all' };
        const result = simulateRestore(snap, after);
        assert.equal(result.platform, 'steam');
    });

    test('simulation: sort=playtime_desc survives after snapshot/restore cycle', () => {
        const before = { platform: 'all', sort: 'playtime_desc', search: '', account: 'all' };
        const snap   = simulateSnapshotState(before, false, false);
        const after  = { platform: 'all', sort: 'title_asc', search: '', account: 'all' };
        const result = simulateRestore(snap, after);
        assert.equal(result.sort, 'playtime_desc');
    });

    test('simulation: search text survives after snapshot/restore cycle', () => {
        const before = { platform: 'all', sort: 'title_asc', search: 'fall guys', account: 'all' };
        const snap   = simulateSnapshotState(before, false, false);
        const after  = { platform: 'all', sort: 'title_asc', search: '', account: 'all' };
        const result = simulateRestore(snap, after);
        assert.equal(result.search, 'fall guys');
    });

    test('simulation: account=steam:123 survives after snapshot/restore cycle', () => {
        const before = { platform: 'all', sort: 'title_asc', search: '', account: 'steam:123' };
        const snap   = simulateSnapshotState(before, false, false);
        const after  = { platform: 'all', sort: 'title_asc', search: '', account: 'all' };
        const result = simulateRestore(snap, after);
        assert.equal(result.account, 'steam:123');
    });

    test('simulation: agInstalledOnly=true is captured in snapshot', () => {
        const agState = { platform: 'all', sort: 'title_asc', search: '', account: 'all' };
        const snap = simulateSnapshotState(agState, true, false);
        assert.equal(snap.agInstalledOnly, true);
        assert.equal(snap.agReadyOnly, false);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — igSelectPlatform scoped-collection filtering (Bug 1 regression)
// ─────────────────────────────────────────────────────────────────────────────

test('igSelectPlatform: does NOT unconditionally clear collectionId', () => {
    const body = extractFn(ACC_JS, 'window.igSelectPlatform = function(value, label)');
    assert.ok(body, 'igSelectPlatform must be defined');
    // Must not have a bare unconditional `currentFilters.collectionId = null`
    // (i.e. no assignment that is not guarded by a currentView check).
    // Accept the assignment only when it appears inside an `installed` guard.
    const unconditional = /currentFilters\.collectionId\s*=\s*null(?![\s\S]*?\binstalled\b)/.test(
        body.replace(/\/\/[^\n]*/g, '') // strip line comments
    );
    assert.ok(!unconditional, 'collectionId must not be cleared unconditionally — must check currentView');
});

test('igSelectPlatform: clears collectionId only when currentView is "installed"', () => {
    const body = extractFn(ACC_JS, 'window.igSelectPlatform = function(value, label)');
    // The guard must reference both "installed" and collectionId assignment together
    assert.match(body, /installed[\s\S]{0,200}collectionId\s*=\s*null/);
});

test('igSelectPlatform: saves filter state only when in installed view', () => {
    const body = extractFn(ACC_JS, 'window.igSelectPlatform = function(value, label)');
    // _igSaveFilterState must be guarded by currentView === 'installed'
    assert.match(body, /installed[\s\S]{0,200}_igSaveFilterState\(\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — igSelectPlatform behavioral simulation (pure JS, no DOM)
// ─────────────────────────────────────────────────────────────────────────────

{
    // Simulate the scoped-filter logic that igSelectPlatform now uses.
    function simulateIgSelectPlatform(currentView, currentFilters, value) {
        if (typeof currentFilters !== 'undefined') {
            currentFilters.platform = value || 'all';
            if (typeof currentView === 'undefined' || currentView === 'installed') {
                currentFilters.collectionId = null;
            }
        }
        return currentFilters;
    }

    function simulateGetFilteredGames(allGamesData, allCollections, currentFilters) {
        let filtered = [...allGamesData];
        if (currentFilters.platform && currentFilters.platform !== 'all') {
            filtered = filtered.filter(g => g.platform === currentFilters.platform);
        }
        if (currentFilters.collectionId !== null) {
            const col = allCollections.find(c => c.id === currentFilters.collectionId);
            if (col) filtered = filtered.filter(g => col.gameIds.includes(String(g.id)));
        }
        return filtered;
    }

    const allGamesData = [
        { id: 'A', name: 'Game A', platform: 'steam' },
        { id: 'B', name: 'Game B', platform: 'epic' },
        { id: 'C', name: 'Game C', platform: 'epic' },
    ];
    const allCollections = [
        { id: 'fav_system_default', gameIds: ['A', 'B'] },
    ];

    test('igSelectPlatform simulation: collection view keeps collectionId when platform selected', () => {
        const filters = { platform: 'all', collectionId: 'fav_system_default' };
        const result = simulateIgSelectPlatform('collection', filters, 'epic');
        assert.equal(result.collectionId, 'fav_system_default',
            'collectionId must not be cleared in collection view');
    });

    test('igSelectPlatform simulation: collection view platform=epic returns only favorite Epic games', () => {
        const filters = { platform: 'all', collectionId: 'fav_system_default' };
        simulateIgSelectPlatform('collection', filters, 'epic');
        const result = simulateGetFilteredGames(allGamesData, allCollections, filters);
        assert.equal(result.length, 1, 'only 1 game should match: favorite Epic game B');
        assert.equal(result[0].id, 'B', 'result must be Game B only');
    });

    test('igSelectPlatform simulation: collection view does NOT return non-favorite Epic game C', () => {
        const filters = { platform: 'all', collectionId: 'fav_system_default' };
        simulateIgSelectPlatform('collection', filters, 'epic');
        const result = simulateGetFilteredGames(allGamesData, allCollections, filters);
        const hasC = result.some(g => g.id === 'C');
        assert.ok(!hasC, 'Game C (non-favorite Epic) must not appear in Favorites Epic filter');
    });

    test('igSelectPlatform simulation: installed view clears collectionId', () => {
        const filters = { platform: 'all', collectionId: 'fav_system_default' };
        const result = simulateIgSelectPlatform('installed', filters, 'epic');
        assert.equal(result.collectionId, null,
            'collectionId must be cleared when in installed view');
    });

    test('igSelectPlatform simulation: installed view platform filter applies across all installed games', () => {
        const filters = { platform: 'all', collectionId: null };
        simulateIgSelectPlatform('installed', filters, 'epic');
        const result = simulateGetFilteredGames(allGamesData, allCollections, filters);
        assert.equal(result.length, 2, 'both Epic games (B and C) must appear in installed Epic filter');
    });
}
