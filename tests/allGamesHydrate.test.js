'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT          = path.resolve(__dirname, '..');
const ACCOUNTS_JS   = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'), 'utf8');
const ACCOUNTS_CSS  = fs.readFileSync(path.join(ROOT, 'src/css/accounts.css'), 'utf8');

// ── Helper: mirror of the patchList logic inside _agHydrateCachedCoversIntoAllGames ──
// This extracts only the cover-key matching logic for unit testing without DOM.
function makeCoverByKey(rawGames) {
    const coverByKey = new Map();
    rawGames.forEach(g => {
        const cover = g.coverUrl || g.image || g.defaultImage;
        if (!cover || !String(cover).startsWith('file://')) return;
        [g.id, g.appid, g.appId, g.appName, g.namespace]
            .filter(Boolean)
            .forEach(k => coverByKey.set(String(k), cover));
    });
    return coverByKey;
}

function patchList(list, coverByKey) {
    let changed = 0;
    if (!Array.isArray(list)) return changed;
    list.forEach(g => {
        const keys = [g.id, g.appid, g.appId, g.appName, g.namespace]
            .filter(Boolean).map(String);
        const cover = keys.map(k => coverByKey.get(k)).find(Boolean);
        if (!cover) return;
        g.coverUrl = cover;
        g.image    = cover;
        g._agCoverPipelineDone = true;
        changed++;
    });
    return changed;
}

// ── 1. patchList behavior ─────────────────────────────────────────────────────

test('hydrate: patchList patches coverUrl from rawGames by appid key', () => {
    const raw  = [{ appid: '123', coverUrl: 'file://cover.webp' }];
    const list = [{ appid: '123', coverUrl: null }];
    const changed = patchList(list, makeCoverByKey(raw));
    assert.equal(changed, 1);
    assert.equal(list[0].coverUrl, 'file://cover.webp');
    assert.equal(list[0]._agCoverPipelineDone, true);
});

test('hydrate: patchList does not patch when no matching key', () => {
    const raw  = [{ appid: '999', coverUrl: 'file://cover.webp' }];
    const list = [{ appid: '123', coverUrl: null }];
    const changed = patchList(list, makeCoverByKey(raw));
    assert.equal(changed, 0);
    assert.equal(list[0].coverUrl, null);
});

test('hydrate: patchList skips non-file:// covers in raw source', () => {
    const raw  = [{ appid: '123', coverUrl: 'https://cdn.example.com/cover.jpg' }];
    const list = [{ appid: '123', coverUrl: null }];
    const changed = patchList(list, makeCoverByKey(raw));
    assert.equal(changed, 0);
});

test('hydrate: patchList patches by appName when appid absent', () => {
    const raw  = [{ appName: 'MyGame', coverUrl: 'file://mygame.webp' }];
    const list = [{ appName: 'MyGame', coverUrl: null }];
    const changed = patchList(list, makeCoverByKey(raw));
    assert.equal(changed, 1);
    assert.equal(list[0].coverUrl, 'file://mygame.webp');
});

// ── 2. _agHydrateCachedCoversIntoAllGames must NOT call _vsRender(true) ──────

test('accounts.js: _agHydrateCachedCoversIntoAllGames never calls _vsRender(true)', () => {
    const idx = ACCOUNTS_JS.indexOf('async function _agHydrateCachedCoversIntoAllGames(');
    assert.ok(idx !== -1, 'function not found');
    // Extract the function body by brace counting
    let depth = 0, i = idx, start = -1;
    while (i < ACCOUNTS_JS.length) {
        if (ACCOUNTS_JS[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (ACCOUNTS_JS[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    const body = ACCOUNTS_JS.slice(start, i + 1);
    // Strip comments before checking so comment text doesn't trigger false positives.
    const stripped = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(stripped, /_vsRender\s*\(\s*true/,
        '_agHydrateCachedCoversIntoAllGames must not call _vsRender(true) — that tears down row wrappers');
});

test('accounts.js: _agHydrateCachedCoversIntoAllGames uses cover-patch-fallback reason for any _vsRender call', () => {
    const idx = ACCOUNTS_JS.indexOf('async function _agHydrateCachedCoversIntoAllGames(');
    assert.ok(idx !== -1);
    let depth = 0, i = idx, start = -1;
    while (i < ACCOUNTS_JS.length) {
        if (ACCOUNTS_JS[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (ACCOUNTS_JS[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    const body = ACCOUNTS_JS.slice(start, i + 1);
    if (body.includes('_vsRender')) {
        assert.match(body, /cover-patch-fallback/, 'any _vsRender call must use cover-patch-fallback reason');
    }
});

// ── 3. cardPool is NOT cleared during cover hydration (simulated) ─────────────

test('accounts.js: All Games first paint warms disk cached covers before rendering cards', () => {
    assert.match(ACCOUNTS_JS, /async function _agWarmCachedCoversForGames\s*\(/,
        'first-paint disk cache warm helper must exist');
    assert.match(ACCOUNTS_JS, /__baddelLoadCachedArtworkForGame/,
        'All Games cache lookup should reuse the shared cached artwork lookup');
    const fnStart = ACCOUNTS_JS.indexOf('window.renderAllGamesView = async function');
    assert.ok(fnStart !== -1, 'renderAllGamesView not found');
    const fn = ACCOUNTS_JS.slice(fnStart, fnStart + 5000);
    const warmIdx = fn.indexOf('_agWarmCachedCoversForGames(window._allGamesCache');
    const renderIdx = fn.indexOf('_renderAllGamesViewModeAware(window._allGamesCache');
    assert.ok(warmIdx !== -1, 'renderAllGamesView must warm cached covers for first paint');
    assert.ok(renderIdx !== -1, 'renderAllGamesView must still render All Games cache');
    assert.ok(warmIdx < renderIdx, 'cached covers must be warmed before first All Games card render');
});

test('accounts.js: All Games warms remaining cached covers in the background without full rerender', () => {
    assert.match(ACCOUNTS_JS, /function _agWarmCachedCoversInBackground\s*\(/,
        'background disk cache warm helper must exist');
    const idx = ACCOUNTS_JS.indexOf('function _agWarmCachedCoversInBackground');
    const body = ACCOUNTS_JS.slice(idx, idx + 1600);
    assert.match(body, /_vsRender\(false,\s*['"]all-games-background-cache-warm['"]\)/,
        'background cache warm should only do a soft virtual-scroll repaint');
    assert.doesNotMatch(body, /_vsRender\(true/,
        'background cache warm must not force a full virtual-scroll rerender');
});

test('hydrate: cardPool row wrappers are not removed when covers are patched in cardCache', () => {
    // Simulate the hydration cardCache-patching loop.
    // The key invariant: patching cardCache does not touch cardPool.
    const removedRows = [];
    const rowEl = { remove: () => removedRows.push('removed') };

    const cardCache = new Map();
    const gameId = 'g1';
    // Simulate a card with an img element
    const img = { src: '', style: {}, classList: { add() {}, contains: () => false } };
    const card = { querySelector: (sel) => (sel === '.native-lazy-load' ? img : null) };
    cardCache.set(gameId, card);

    const items = [{ id: gameId, coverUrl: 'file://newcover.webp' }];

    // The patching loop (mirrors the fixed code in _agHydrateCachedCoversIntoAllGames)
    let patchedCards = 0;
    items.forEach(game => {
        const gId = String(game.id || game.appName || game.title || '');
        const c = cardCache.get(gId);
        if (c && game.coverUrl) {
            const imgEl = c.querySelector('.native-lazy-load');
            if (imgEl) { imgEl.src = game.coverUrl; }
            patchedCards++;
        }
    });

    // cardPool row wrappers must not be touched
    assert.equal(removedRows.length, 0, 'row wrapper remove() must not be called');
    assert.equal(patchedCards, 1, 'card must be patched');
    assert.equal(img.src, 'file://newcover.webp', 'img src must be updated');
});

// ── 4. _vsRender reason parameter ────────────────────────────────────────────

test('accounts.js: _vsRender accepts a reason parameter', () => {
    assert.match(ACCOUNTS_JS, /function _vsRender\s*\(\s*forceRemeasure\s*=\s*false\s*,\s*reason\s*=\s*['"]/);
});

test('accounts.js: resize handler calls _vsRender with window-resize reason', () => {
    assert.match(ACCOUNTS_JS, /_vsRender\s*\(\s*true\s*,\s*['"]window-resize['"]\s*\)/);
});

test('accounts.js: initial _vsInit render calls _vsRender with vs-init reason', () => {
    assert.match(ACCOUNTS_JS, /_vsRender\s*\(\s*true\s*,\s*['"]vs-init['"]\s*\)/);
});

test('accounts.js: scroll handler calls _vsRender(false) with scroll reason', () => {
    assert.match(ACCOUNTS_JS, /_vsRender\s*\(\s*false\s*,\s*['"]scroll['"]\s*\)/);
});

// ── 5. Toolbar height stability ───────────────────────────────────────────────

test('accounts.css: is-stuck does not change toolbar padding', () => {
    const stuckIdx = ACCOUNTS_CSS.indexOf('.ag-toolbar-sticky.is-stuck');
    assert.ok(stuckIdx !== -1, '.ag-toolbar-sticky.is-stuck not found');
    const stuckBlock = ACCOUNTS_CSS.slice(stuckIdx, stuckIdx + 250);
    assert.doesNotMatch(stuckBlock, /\bpadding\s*:/,
        'is-stuck must not change padding — that alters toolbar height and causes a visible jump');
});

test('accounts.css: ag-toolbar-sticky transition does not animate padding', () => {
    const idx = ACCOUNTS_CSS.indexOf('.ag-toolbar-sticky {');
    assert.ok(idx !== -1);
    const block = ACCOUNTS_CSS.slice(idx, idx + 600);
    const transitionLine = block.match(/transition:[^;]+;/)?.[0] || '';
    assert.ok(transitionLine.length > 0, 'transition rule not found in first 600 chars of .ag-toolbar-sticky');
    assert.doesNotMatch(transitionLine, /\bpadding\b/,
        'padding must not be in transition — animating height causes toolbar movement');
});

// ── 6. Debug instrumentation ──────────────────────────────────────────────────

test('accounts.js: _vsRender has baddel_debug_vs instrumentation', () => {
    assert.match(ACCOUNTS_JS, /baddel_debug_vs/);
    assert.match(ACCOUNTS_JS, /\[VSDBG\]/);
});

test('accounts.js: _renderAllGamesGrid has baddel_debug_vs instrumentation', () => {
    const idx = ACCOUNTS_JS.indexOf('function _renderAllGamesGrid(');
    assert.ok(idx !== -1);
    const slice = ACCOUNTS_JS.slice(idx, idx + 600);
    assert.match(slice, /baddel_debug_vs/);
    assert.match(slice, /VSDBG.*_renderAllGamesGrid/);
});

test('accounts.js: empty grid render clears stale virtual scroller items', () => {
    const idx = ACCOUNTS_JS.indexOf('function _renderAllGamesGrid(');
    assert.ok(idx !== -1);
    const fn = ACCOUNTS_JS.slice(idx, idx + 2600);
    const emptyIdx = fn.indexOf('if (!games || games.length === 0)');
    assert.ok(emptyIdx !== -1, 'empty render branch not found');
    const emptyBranch = fn.slice(emptyIdx, emptyIdx + 900);
    assert.match(emptyBranch, /_vs\.items\s*=\s*\[\]/,
        'empty filtered results must clear stale virtual-scroller items');
    assert.match(emptyBranch, /_vs\.cardPool\.clear\(\)/,
        'empty filtered results must clear virtual row wrappers');
    assert.match(emptyBranch, /clearTimeout\(_vs\._scrollSettleTimer\)/,
        'empty filtered results must cancel delayed scroll-settle work');
});

test('accounts.js: _applyAgFilters has baddel_debug_vs instrumentation', () => {
    const idx = ACCOUNTS_JS.indexOf('function _applyAgFilters(');
    assert.ok(idx !== -1);
    const slice = ACCOUNTS_JS.slice(idx, idx + 500);
    assert.match(slice, /baddel_debug_vs/);
    assert.match(slice, /VSDBG.*_applyAgFilters/);
});

// ── 7. New structural helpers ─────────────────────────────────────────────────

test('accounts.js: _agBuildFilteredPool is defined', () => {
    assert.match(ACCOUNTS_JS, /function _agBuildFilteredPool\s*\(\s*\{\s*cache\s*,\s*useCanonical\s*\}/);
});

test('accounts.js: _agBuildFilteredPool performs no DOM writes', () => {
    const idx = ACCOUNTS_JS.indexOf('function _agBuildFilteredPool(');
    assert.ok(idx !== -1, '_agBuildFilteredPool not found');
    let depth = 0, i = idx, start = -1;
    while (i < ACCOUNTS_JS.length) {
        if (ACCOUNTS_JS[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (ACCOUNTS_JS[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    const body = ACCOUNTS_JS.slice(start, i + 1);
    const stripped = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(stripped, /getElementById|innerHTML|style\.|classList/,
        '_agBuildFilteredPool must contain no DOM writes');
});

test('accounts.js: _agEnsureVirtualGridIntegrity is defined', () => {
    assert.match(ACCOUNTS_JS, /function _agEnsureVirtualGridIntegrity\s*\(\s*reason\s*\)/);
});

test('accounts.js: _agEnsureVirtualGridIntegrity restores position:relative', () => {
    const idx = ACCOUNTS_JS.indexOf('function _agEnsureVirtualGridIntegrity(');
    assert.ok(idx !== -1);
    let depth = 0, i = idx, start = -1;
    while (i < ACCOUNTS_JS.length) {
        if (ACCOUNTS_JS[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (ACCOUNTS_JS[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    const body = ACCOUNTS_JS.slice(start, i + 1);
    assert.match(body, /position.*relative/, 'must restore position:relative');
    assert.match(body, /display.*block/, 'must restore display:block');
    assert.match(body, /totalHeight/, 'must restore phantom height from vs.totalHeight');
});

test('accounts.js: _agResetAllGamesGridMode accepts preserveVirtualGrid option', () => {
    const idx = ACCOUNTS_JS.indexOf('function _agResetAllGamesGridMode(');
    assert.ok(idx !== -1);
    // Scan past the parameter list to find the function body, then read 400 chars.
    const bodyStart = ACCOUNTS_JS.indexOf('{', ACCOUNTS_JS.indexOf(')', idx));
    assert.ok(bodyStart !== -1);
    const body = ACCOUNTS_JS.slice(bodyStart, bodyStart + 400);
    assert.match(body, /preserveVirtualGrid/, 'must gate style clearing on preserveVirtualGrid');
});

test('accounts.js: _agExitEmptyPageMode accepts preserveVirtualGrid option', () => {
    const idx = ACCOUNTS_JS.indexOf('function _agExitEmptyPageMode(');
    assert.ok(idx !== -1);
    const bodyStart = ACCOUNTS_JS.indexOf('{', ACCOUNTS_JS.indexOf(')', idx));
    assert.ok(bodyStart !== -1);
    const body = ACCOUNTS_JS.slice(bodyStart, bodyStart + 600);
    assert.match(body, /preserveVirtualGrid/, 'must gate style clearing on preserveVirtualGrid');
});

// ── 8. Unchanged pool simulation — grid styles must not be cleared ────────────

test('simulation: unchanged pool leaves grid styles intact and calls integrity helper', () => {
    // Simulate the background-skip branch from onLibraryUpdated.
    // Key invariant: grid position/display/height must NOT be cleared when pool is unchanged.

    const grid = {
        style: { position: 'relative', display: 'block', height: '4000px' },
        classList: { remove() {} },
    };
    const removedRows = [];
    const row = { remove: () => removedRows.push('row-removed') };

    // Fake _vs with live rows
    const vs = {
        items: [{ id: 'g1', title: 'Game 1' }],
        cardPool: new Map([[0, row]]),
        totalHeight: 4000,
    };

    // Simulate _agEnsureVirtualGridIntegrity logic with the above objects.
    function simulateEnsureIntegrity() {
        if (!vs || !Array.isArray(vs.items) || vs.items.length === 0) return;
        if (!(vs.cardPool instanceof Map) || vs.cardPool.size === 0) return;
        if (!grid) return;
        if (!grid.style.position || grid.style.position === '') grid.style.position = 'relative';
        if (!grid.style.display  || grid.style.display  === '') grid.style.display  = 'block';
        if (vs.totalHeight != null && (!grid.style.height || grid.style.height === '')) {
            grid.style.height = vs.totalHeight + 'px';
        }
    }

    // Simulate the background-skip path (pool unchanged, no DOM resets)
    simulateEnsureIntegrity();

    // Grid styles must be intact
    assert.equal(grid.style.position, 'relative', 'position must be relative');
    assert.equal(grid.style.display, 'block', 'display must be block');
    assert.equal(grid.style.height, '4000px', 'phantom height must be preserved');
    // Row wrappers must not be removed
    assert.equal(removedRows.length, 0, 'row wrappers must not be removed');
});

test('simulation: cleared grid styles are repaired by integrity helper', () => {
    // Simulate what happens if styles were cleared and the integrity helper runs.
    const grid = {
        style: { position: '', display: '', height: '' },
        classList: { remove() {} },
    };
    const vs = {
        items: [{ id: 'g1', title: 'Game 1' }],
        cardPool: new Map([[0, {}]]),
        totalHeight: 3200,
    };

    // Simulate _agEnsureVirtualGridIntegrity
    if (!vs.items.length === 0 || !(vs.cardPool instanceof Map) || vs.cardPool.size === 0) {
        assert.fail('vs precondition failed');
    }
    if (!grid.style.position || grid.style.position === '') grid.style.position = 'relative';
    if (!grid.style.display  || grid.style.display  === '') grid.style.display  = 'block';
    if (vs.totalHeight != null && (!grid.style.height || grid.style.height === '')) {
        grid.style.height = vs.totalHeight + 'px';
    }

    assert.equal(grid.style.position, 'relative', 'position restored to relative');
    assert.equal(grid.style.display, 'block', 'display restored to block');
    assert.equal(grid.style.height, '3200px', 'phantom height restored from totalHeight');
});

// ── 9. onLibraryUpdated computes pool before DOM reset (source check) ─────────

test('accounts.js: onLibraryUpdated background path computes pool before DOM reset', () => {
    // Scope the search to the onLibraryUpdated listener body so earlier
    // _agResetAllGamesGridMode() calls in other functions don't interfere.
    const handlerStart = ACCOUNTS_JS.indexOf('window.electronAPI.onLibraryUpdated(async () => {');
    assert.ok(handlerStart !== -1, 'onLibraryUpdated handler not found');
    // Take a generous window (14 000 chars) — enough to cover the full visible-path logic.
    const section = ACCOUNTS_JS.slice(handlerStart, handlerStart + 14000);
    const buildIdx = section.indexOf('_agBuildFilteredPool({ cache: _bgBase, useCanonical: _bgUseCanonical })');
    const resetIdx = section.indexOf('_agResetAllGamesGridMode()');
    assert.ok(buildIdx !== -1, '_agBuildFilteredPool call not found inside onLibraryUpdated');
    assert.ok(resetIdx !== -1, '_agResetAllGamesGridMode() call not found inside onLibraryUpdated');
    assert.ok(buildIdx < resetIdx, '_agBuildFilteredPool must appear before _agResetAllGamesGridMode');
});

test('accounts.js: onLibraryUpdated background-skip path calls _agEnsureVirtualGridIntegrity', () => {
    assert.match(ACCOUNTS_JS, /_agEnsureVirtualGridIntegrity\s*\(\s*['"]background-skip['"]\s*\)/);
});

test('accounts.js: _agHydrateCachedCoversIntoAllGames calls _agEnsureVirtualGridIntegrity before cover-patch-fallback vsRender', () => {
    const idx = ACCOUNTS_JS.indexOf('async function _agHydrateCachedCoversIntoAllGames(');
    assert.ok(idx !== -1);
    let depth = 0, i = idx, start = -1;
    while (i < ACCOUNTS_JS.length) {
        if (ACCOUNTS_JS[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (ACCOUNTS_JS[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    const body = ACCOUNTS_JS.slice(start, i + 1);
    const integrityIdx = body.indexOf('_agEnsureVirtualGridIntegrity');
    const fallbackIdx  = body.indexOf('cover-patch-fallback');
    assert.ok(integrityIdx !== -1, '_agEnsureVirtualGridIntegrity not called in hydration function');
    assert.ok(fallbackIdx  !== -1, 'cover-patch-fallback not found in hydration function');
    assert.ok(integrityIdx < fallbackIdx, '_agEnsureVirtualGridIntegrity must appear before cover-patch-fallback vsRender call');
});
