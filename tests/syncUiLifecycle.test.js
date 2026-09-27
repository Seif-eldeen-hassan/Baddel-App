'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'), 'utf8');
const PANELS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts/platform-panels.js'), 'utf8');

function section(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `${startNeedle} not found`);
    const end = endNeedle ? source.indexOf(endNeedle, start) : -1;
    return source.slice(start, end === -1 ? source.length : end);
}

function functionBody(source, name) {
    const start = source.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} not found`);
    const sigEnd = source.indexOf(') {', start);
    assert.notEqual(sigEnd, -1, `${name} signature end not found`);
    const open = sigEnd + 2;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(open, i + 1);
        }
    }
    throw new Error(`${name} body not closed`);
}

test('sync completion is not an All Games render owner', () => {
    const completion = section(PANELS_JS, 'window.electronAPI.onPlatformSyncCompleted', 'if (window.electronAPI.onPlatformSyncFailed)');
    assert.doesNotMatch(completion, /_agSafeRenderAllGamesView\s*\(|renderAllGamesView\s*\(/);
    assert.match(completion, /hydrateSidebarAllGamesCount/);
    assert.match(completion, /_renderPlatformSyncStatusPanel/);
});

test('Epic sync completion defers All Games reconciliation to library-updated', () => {
    const body = section(ACCOUNTS_JS, 'async function _syncEpicAndRefresh', 'window.unlinkEpicLibrary');
    assert.doesNotMatch(body, /_agSafeRenderAllGamesView\s*\(|renderAllGamesView\s*\(/);
    assert.match(body, /library-updated event/);
    assert.match(body, /hydrateSidebarAllGamesCount/);
});

test('accounts platform-library-committed is the single virtualized library reconciliation owner', () => {
    const body = section(ACCOUNTS_JS, '_agSubscribePlatformLibraryCommitted(async (payload = {}) => {', '// ── Per-cover instant patch');
    assert.match(body, /_agReadCachedAllGamesProjection/);
    assert.match(body, /_agCommitAllGamesProjection/);
    assert.match(ACCOUNTS_JS, /function _agCommitAllGamesProjection[\s\S]*?_agPublishReadyToInstallState/);
    assert.match(body, /_applyAgFilters\(\{\s*resetScroll:\s*false/);
    assert.doesNotMatch(body, /_preserveActiveScrollDuring|accounts-library-updated/);
});

test('background changed-pool path preserves virtual geometry instead of resetting grid styles', () => {
    const body = section(ACCOUNTS_JS, '_agSubscribePlatformLibraryCommitted(async (payload = {}) => {', '// ── Per-cover instant patch');
    assert.doesNotMatch(body, /_agResetAllGamesGridMode\s*\(\s*\)/);
    assert.doesNotMatch(body, /grid\.style\.height\s*=\s*['"]['"]|grid\.style\.display\s*=\s*['"]none['"]/);
    assert.match(body, /_agEnsureVirtualGridIntegrity\(\s*['"]background-pool-changed-before-render['"]\s*\)/);
});

test('same ordered sync pool patches metadata without reinitializing virtual dataset', () => {
    const apply = functionBody(ACCOUNTS_JS, '_applyAgFilters');
    assert.match(apply, /startsWith\(\s*['"]background-library-updated['"]\s*\)/);
    assert.match(apply, /unchangedVisibleProjection/);
    assert.match(apply, /if \(\(isBackgroundLibraryUpdate \|\| options\.allowWarmReuse\)[\s\S]*?_agRebindCachedCards\(pool\)[\s\S]*?_agEnsureVirtualGridIntegrity[\s\S]*?return false;/);
    const beforeRealRender = apply.slice(0, apply.indexOf('window._agLastRenderedPoolSignature = _newSig'));
    assert.doesNotMatch(beforeRealRender, /_renderAllGamesViewModeAware|_vsInit|_renderAllGamesGrid/);
});

test('changed virtual datasets apply new totalHeight before row reconciliation and anchor restore', () => {
    const body = functionBody(ACCOUNTS_JS, '_vsInit');
    const heightIdx = body.indexOf('_vs.totalHeight = _agComputeVirtualTotalHeight(items.length)');
    const geometryIdx = body.indexOf('_agApplyVirtualGridGeometry(grid)');
    const changedBlockStart = body.indexOf('if (sameOrderedDataset && !resetScroll)');
    const clearIdx = body.indexOf('_vsReleaseAllRows()', changedBlockStart);
    const restoreIdx = body.indexOf('_agRestoreVirtualScrollAnchor(anchor, items)', changedBlockStart);
    const renderIdx = body.indexOf("_vsRender(false, 'vs-init')", changedBlockStart);
    assert.ok(heightIdx !== -1 && geometryIdx > heightIdx, 'new totalHeight must be computed and applied');
    assert.ok(clearIdx > geometryIdx, 'changed-dataset row release may only happen after phantom height is applied');
    assert.ok(restoreIdx > clearIdx && renderIdx > restoreIdx, 'semantic anchor restore must happen before render');
});

test('warm Ready to Install refresh keeps mounted cards instead of showing cold loading UI', () => {
    assert.match(ACCOUNTS_JS, /function _agHasWarmReadyToInstallProjection/);
    const apply = functionBody(ACCOUNTS_JS, '_applyAgFilters');
    const guardStart = apply.indexOf('blocked RTI render; canonical not ready');
    const guard = apply.slice(guardStart, apply.indexOf('// RTI canonical'));
    assert.match(guard, /_agHasWarmReadyToInstallProjection\(\)/);
    assert.match(guard, /return false/);
    assert.ok(guard.indexOf('_agHasWarmReadyToInstallProjection()') < guard.indexOf('_agRenderReadyToInstallLoading()'));
});

test('background sync does not hide toolbar or replace toolbar/sentinel DOM', () => {
    const body = section(ACCOUNTS_JS, '_agSubscribePlatformLibraryCommitted(async (payload = {}) => {', '// ── Per-cover instant patch');
    assert.doesNotMatch(body, /_agSetToolbarVisible\(false\)|agToolbarSentinel|agToolbarSticky\.innerHTML|agToolbarSticky\.remove/);
    assert.match(body, /_agSetToolbarVisible\(true\)/);
});
