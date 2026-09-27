'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT          = path.resolve(__dirname, '..');
const ACCOUNTS_JS   = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'), 'utf8');
const ACCOUNTS_CSS  = fs.readFileSync(path.join(ROOT, 'src/css/accounts.css'), 'utf8');
const DASHBOARD_CSS  = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');

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

test('accounts.js: All Games warms visible disk covers before first card render', () => {
    const fnStart = ACCOUNTS_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACCOUNTS_JS.slice(fnStart, fnStart + 8000);
    const warmIdx = fn.indexOf("reason: 'all-games-before-first-paint'");
    const renderIdx = fn.indexOf('_renderAllGamesViewModeAware(window._allGamesCache', warmIdx);
    assert.ok(warmIdx !== -1 && renderIdx > warmIdx);
    assert.match(ACCOUNTS_JS, /getCachedImagesBulk/);
    assert.match(ACCOUNTS_JS, /function _agArtworkRecordFor/);
});

test('accounts.js: All Games warms remaining cached covers in the background without full rerender', () => {
    assert.match(ACCOUNTS_JS, /function _agWarmCachedCoversInBackground\s*\(/,
        'background disk cache warm helper must exist');
    const idx = ACCOUNTS_JS.indexOf('function _agWarmCachedCoversInBackground');
    const body = ACCOUNTS_JS.slice(idx, idx + 1600);
    assert.match(body, /_agRebindCachedCards\(list\)/,
        'background cache warm should patch mounted cards without remounting the grid');
    assert.match(body, /_agEnsureVirtualGridIntegrity\(['"]all-games-background-cache-warm['"]\)/,
        'background cache warm should repair virtual grid geometry without remounting');
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

test('accounts.js: initial _vsInit render calls _vsRender with vs-init reason without forcing destructive remeasure', () => {
    assert.match(ACCOUNTS_JS, /_vsRender\s*\(\s*false\s*,\s*['"]vs-init['"]\s*\)/);
});

test('accounts.js: scroll handler calls _vsRender(false) with scroll reason', () => {
    assert.match(ACCOUNTS_JS, /_vsRender\s*\(\s*false\s*,\s*['"]scroll['"]\s*\)/);
});


test('accounts.js: virtual scroll buffer uses hysteresis instead of 2-to-8 row thrash', () => {
    assert.match(ACCOUNTS_JS, /const AG_VS_FAST_BUFFER_ROWS\s*=\s*2/);
    assert.match(ACCOUNTS_JS, /const AG_VS_NORMAL_BUFFER_ROWS\s*=\s*4/);
    assert.match(ACCOUNTS_JS, /const AG_VS_FAST_ENTER_PX\s*=\s*70/);
    assert.match(ACCOUNTS_JS, /const AG_VS_FAST_LEAVE_PX\s*=\s*20/);
    const renderIdx = ACCOUNTS_JS.indexOf('function _vsRender(');
    const settleIdx = ACCOUNTS_JS.indexOf('function _vsOnScrollSettle(');
    assert.ok(renderIdx !== -1 && settleIdx > renderIdx);
    const renderBody = ACCOUNTS_JS.slice(renderIdx, settleIdx);
    assert.match(renderBody, /_isFastScrolling/);
    assert.match(renderBody, /BUFFER_ROWS\s*=\s*isFastScrolling \? AG_VS_FAST_BUFFER_ROWS : AG_VS_NORMAL_BUFFER_ROWS/);
    assert.doesNotMatch(renderBody, /Math\.max\(8,\s*Math\.ceil\(rowsPerViewport \* 1\.5\)\)/);
});

test('accounts.js: scroll settle timer is reset by every scroll event before rAF render', () => {
    const onScrollIdx = ACCOUNTS_JS.indexOf('function _vsOnScroll(');
    const initIdx = ACCOUNTS_JS.indexOf('/** Initialize or reinitialize virtual scroll', onScrollIdx);
    assert.ok(onScrollIdx !== -1 && initIdx > onScrollIdx);
    const onScroll = ACCOUNTS_JS.slice(onScrollIdx, initIdx);
    const clearIdx = onScroll.indexOf('clearTimeout(_vs._scrollSettleTimer)');
    const timerIdx = onScroll.indexOf('_vs._scrollSettleTimer = setTimeout');
    const rafIdx = onScroll.indexOf('requestAnimationFrame');
    assert.ok(clearIdx !== -1, 'scroll handler must clear previous settle timer');
    assert.ok(timerIdx !== -1, 'scroll handler must create a new settle timer');
    assert.ok(clearIdx < rafIdx && timerIdx < rafIdx, 'settle timer management must happen before rAF gating');
    assert.match(onScroll, /AG_VS_SCROLL_SETTLE_MS/);
    assert.match(onScroll, /_agSetActiveScrollState\(true\)/);
    assert.match(onScroll, /_agSetActiveScrollState\(false\)/);

    const renderIdx = ACCOUNTS_JS.indexOf('function _vsRender(');
    const scheduleIdx = ACCOUNTS_JS.indexOf('function _vsScheduleCoverWork', renderIdx);
    const renderBody = ACCOUNTS_JS.slice(renderIdx, scheduleIdx);
    assert.doesNotMatch(renderBody, /_scrollSettleTimer\s*=\s*setTimeout/,
        '_vsRender must not own scroll-settle timing because it can early-return');
});

test('accounts.js: normal scroll mounts new virtual rows through a DocumentFragment', () => {
    const renderIdx = ACCOUNTS_JS.indexOf('function _vsRender(');
    const scheduleIdx = ACCOUNTS_JS.indexOf('function _vsScheduleCoverWork', renderIdx);
    const renderBody = ACCOUNTS_JS.slice(renderIdx, scheduleIdx);
    assert.match(renderBody, /document\.createDocumentFragment\(\)/);
    assert.match(renderBody, /rowFragment\.appendChild\(rowEl\)/);
    assert.match(renderBody, /grid\.appendChild\(rowFragment\)/);
});
test('accounts.js: virtual scroller owns a bounded recyclable card pool', () => {
    assert.match(ACCOUNTS_JS, /freeCards:\s*\[\]/);
    assert.match(ACCOUNTS_JS, /rowBindings:\s*new Map\(\)/);
    assert.match(ACCOUNTS_JS, /function _vsReleaseRow\(/);
    assert.match(ACCOUNTS_JS, /function _vsAcquireCard\(/);
});

test('accounts.js: scroll row creation acquires reusable cards instead of game-key card builds', () => {
    const renderIdx = ACCOUNTS_JS.indexOf('function _vsRender(');
    const scheduleIdx = ACCOUNTS_JS.indexOf('function _vsScheduleCoverWork', renderIdx);
    const renderBody = ACCOUNTS_JS.slice(renderIdx, scheduleIdx);
    assert.match(renderBody, /const card = _vsAcquireCard\(game\)/);
    assert.doesNotMatch(renderBody, /_vs\.cardCache\.get\(gameId\)[\s\S]{0,300}_vsBuildCard\(game\)/);
});

test('accounts css: active All Games scrolling disables hover/compositor effects', () => {
    assert.match(ACCOUNTS_CSS, /ag-is-scrolling/);
    assert.match(ACCOUNTS_CSS, /#allGamesGrid\.ag-is-scrolling \.game-card:hover/);
    assert.match(ACCOUNTS_CSS, /transform:\s*none !important/);
    assert.match(ACCOUNTS_CSS, /box-shadow:\s*none !important/);
    assert.match(ACCOUNTS_CSS, /#allGamesGrid\.ag-is-scrolling \.native-lazy-load/);
    assert.match(ACCOUNTS_CSS, /filter:\s*none !important/);
    assert.match(ACCOUNTS_CSS, /#allGamesGrid\.ag-is-scrolling \.agc-badge/);
});

test('all games scroll path removes permanent blur and will-change hotspots', () => {
    const toolbarBlock = ACCOUNTS_CSS.slice(ACCOUNTS_CSS.indexOf('.ag-toolbar-sticky {'), ACCOUNTS_CSS.indexOf('.ag-toolbar-sticky.is-stuck'));
    assert.doesNotMatch(toolbarBlock, /backdrop-filter|-webkit-backdrop-filter/);
    const badgeBlock = ACCOUNTS_CSS.slice(ACCOUNTS_CSS.indexOf('.agc-badge {'), ACCOUNTS_CSS.indexOf('.agc-card:hover .agc-badge'));
    assert.doesNotMatch(badgeBlock, /backdrop-filter|-webkit-backdrop-filter/);
    const nativeBlock = ACCOUNTS_CSS.slice(ACCOUNTS_CSS.indexOf('#allGamesGrid .native-lazy-load'), ACCOUNTS_CSS.indexOf('#allGamesGrid .game-card:hover .native-lazy-load'));
    assert.doesNotMatch(nativeBlock, /will-change/);
    const cardBlock = DASHBOARD_CSS.slice(DASHBOARD_CSS.indexOf('.game-card {'), DASHBOARD_CSS.indexOf('.game-card:hover'));
    assert.doesNotMatch(cardBlock, /will-change:\s*transform/);
    const fieldBlock = DASHBOARD_CSS.slice(DASHBOARD_CSS.indexOf('#allGamesGrid .ag-card-field {'), DASHBOARD_CSS.indexOf('#allGamesGrid .ag-card-field-dot'));
    assert.doesNotMatch(fieldBlock, /backdrop-filter|-webkit-backdrop-filter/);
});

test('accounts.js: scroll performance diagnostics are behind baddel_debug_scroll_perf', () => {
    assert.match(ACCOUNTS_JS, /baddel_debug_scroll_perf/);
    assert.match(ACCOUNTS_JS, /\[AG_SCROLL_PERF\]/);
    assert.match(ACCOUNTS_JS, /rowMounts/);
    assert.match(ACCOUNTS_JS, /rowRemovals/);
    assert.match(ACCOUNTS_JS, /droppedFrames/);
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
    const fn = ACCOUNTS_JS.slice(idx, idx + 4200);
    const emptyIdx = fn.indexOf('if (!hasGames)');
    assert.ok(emptyIdx !== -1, 'empty render branch not found');
    const emptyBranch = fn.slice(emptyIdx, emptyIdx + 1600);
    assert.match(emptyBranch, /_vs\.items\s*=\s*\[\]/,
        'empty filtered results must clear stale virtual-scroller items');
    assert.match(emptyBranch, /_vs\.totalHeight\s*=\s*0/,
        'empty filtered results must clear phantom height');
    assert.match(emptyBranch, /_vsReleaseAllRows\(\)/,
        'empty filtered results must release virtual row wrappers through the recycler pool');
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
    assert.doesNotMatch(body, /style\.display\s*=\s*['"]block['"]/, 'integrity helper must not make a hidden grid visible');
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

// ── 9. onLibraryUpdated computes pool without destructive DOM reset (source check) ─────────

test('accounts.js: onLibraryUpdated background path computes pool without destructive grid reset', () => {
    const handlerStart = ACCOUNTS_JS.indexOf('_agSubscribePlatformLibraryCommitted(async (payload = {}) => {');
    assert.ok(handlerStart !== -1, 'platform-library-committed handler not found');
    const section = ACCOUNTS_JS.slice(handlerStart, ACCOUNTS_JS.indexOf('// ── Per-cover instant patch', handlerStart));
    const buildIdx = section.indexOf('_agBuildFilteredPool({ cache: _bgBase, useCanonical: _bgUseCanonical })');
    assert.ok(buildIdx !== -1, '_agBuildFilteredPool call not found inside onLibraryUpdated');
    assert.doesNotMatch(section, /_agResetAllGamesGridMode\s*\(\s*\)/,
        'background sync must not run a destructive grid reset before virtual reconciliation');
    assert.match(section, /_agEnsureVirtualGridIntegrity\(\s*['"]background-pool-changed-before-render['"]\s*\)/,
        'changed background pools must preserve existing virtual geometry until _vsInit applies the new height');
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

test('accounts.js: visible cache warms before render and application hydration survives route changes', () => {
    const hydrationStart = ACCOUNTS_JS.indexOf('function _agStartCompleteLibraryCoverHydration');
    const hydrationEnd = ACCOUNTS_JS.indexOf('function _agWarmFirstPaintCoversAfterRender', hydrationStart);
    const hydration = ACCOUNTS_JS.slice(hydrationStart, hydrationEnd);
    assert.match(hydration, /__agApplicationArtworkHydration/);
    assert.doesNotMatch(hydration, /_agRouteVersion/);
    const fnStart = ACCOUNTS_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACCOUNTS_JS.slice(fnStart, ACCOUNTS_JS.indexOf('// ── Filter state snapshot', fnStart));
    const warm = fn.indexOf("reason: 'all-games-before-first-paint'");
    const render = fn.indexOf('_renderAllGamesViewModeAware(window._allGamesCache', warm);
    const full = fn.indexOf("_agStartCompleteLibraryCoverHydration(window._allGamesCache, 'all-games-application-hydration'", render);
    assert.ok(warm > 0 && render > warm && full > render);
});
test('accounts.js: artwork candidate resolver includes platform-provided coverCandidates before metadata fallback', () => {
    const fnStart = ACCOUNTS_JS.indexOf('function _agArtworkCandidateUrlsFromGame');
    assert.ok(fnStart !== -1, '_agArtworkCandidateUrlsFromGame not found');
    const fn = ACCOUNTS_JS.slice(fnStart, ACCOUNTS_JS.indexOf('function _agIsIpcErrorResult', fnStart));
    assert.match(fn, /game\.coverCandidates/, 'coverCandidates must feed the downloader');
    assert.match(fn, /game\.artworkCandidates/, 'artworkCandidates must feed the downloader');
    assert.match(fn, /game\.remoteCandidates/, 'remoteCandidates must feed the downloader');
    assert.match(fn, /typeof candidate === 'string'\) add\(candidate\)/,
        'candidate resolver must support string candidate lists from platform repositories');
});
test('game-card.js: Jump Back In probes local artwork before assigning img src', () => {
    const gameCardPath = path.join(ROOT, 'src', 'js', 'app', 'game-card.js');
    const source = fs.readFileSync(gameCardPath, 'utf8');
    assert.match(source, /async function _jbiFirstLoadableArtworkCandidate/, 'JBI loadable artwork probe helper must exist');
    assert.match(source, /window\.electronAPI\?\.probeLocalImage/, 'JBI must probe local file URLs before assigning them');
    assert.doesNotMatch(source, /imgEl\.src\s*=\s*displayImg\s*;/,
        'JBI must not assign potentially stale file URLs directly before fallback handling');
});
