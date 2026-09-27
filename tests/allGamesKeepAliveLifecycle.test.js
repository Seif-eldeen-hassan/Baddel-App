'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');

function fnBody(source, name) {
    const idx = source.indexOf(`function ${name}`);
    assert.notEqual(idx, -1, `${name} not found`);
    const next = source.indexOf('\nfunction ', idx + 1);
    return source.slice(idx, next === -1 ? source.length : next);
}

test('warm All Games route reuses live virtual grid instead of installing skeleton', () => {
    const body = fnBody(ACCOUNTS_JS, '_agBeginAllGamesRoute');
    assert.match(body, /const warmActivation = _agCanWarmActivateAllGames\(opts\)/);
    assert.match(body, /if \(warmActivation\) \{/);
    const warmBlock = body.slice(body.indexOf('if (warmActivation) {'), body.indexOf("return 'warm';") + 14);
    assert.match(warmBlock, /_agExitEmptyPageMode\(\{ preserveVirtualGrid: true \}\)/);
    assert.match(warmBlock, /_agEnsureVirtualGridIntegrity\('warm-route'\)/);
    assert.doesNotMatch(warmBlock, /cardPool\.clear|innerHTML\s*=|renderedStart\s*=\s*-1|renderedEnd\s*=\s*-1/);
});

test('_hideAllViews preserves virtual geometry when All Games is merely hidden', () => {
    const body = fnBody(APP_JS, '_hideAllViews');
    assert.match(body, /window\._agShouldPreserveVirtualGrid/);
    assert.match(body, /_agExitEmptyPageMode\(\{ preserveVirtualGrid \}\)/);
});

test('virtual scroller owns totalHeight and integrity restores from it', () => {
    assert.match(ACCOUNTS_JS, /totalHeight:\s*0/);
    assert.match(ACCOUNTS_JS, /function _agComputeVirtualTotalHeight/);
    assert.match(ACCOUNTS_JS, /_vs\.totalHeight\s*=\s*_agComputeVirtualTotalHeight/);
    const integrity = fnBody(ACCOUNTS_JS, '_agEnsureVirtualGridIntegrity');
    assert.match(integrity, /vs\.totalHeight/);
    assert.match(integrity, /grid\.style\.height = vs\.totalHeight \+ 'px'/);
});

test('ordinary All Games render prunes card cache by ID and does not blanket clear', () => {
    const renderStart = ACCOUNTS_JS.indexOf('window.renderAllGamesView = async function');
    const renderEnd = ACCOUNTS_JS.indexOf('// ── Filter state snapshot', renderStart);
    const body = ACCOUNTS_JS.slice(renderStart, renderEnd);
    assert.match(body, /_agPruneCardCacheForItems\(window\._allGamesCache\)/);
    assert.doesNotMatch(body, /cardCache\.clear\(\)/);
});

test('_vsInit captures logical scroll anchor and restores it for changed datasets', () => {
    const body = fnBody(ACCOUNTS_JS, '_vsInit');
    assert.match(body, /_agCaptureVirtualScrollAnchor\(_vs\.items\)/);
    assert.match(body, /_agRestoreVirtualScrollAnchor\(anchor, items\)/);
    assert.match(ACCOUNTS_JS, /function _agCaptureVirtualScrollAnchor/);
    assert.match(ACCOUNTS_JS, /function _agRestoreVirtualScrollAnchor/);
});

test('background library update no longer uses RAF scrollTop restore', () => {
    const listenerIdx = ACCOUNTS_JS.search(/_agSubscribePlatformLibraryCommitted\(async \(payload(?: = \{\})?\) =>/);
    assert.notEqual(listenerIdx, -1, 'platform library committed listener missing');
    const body = ACCOUNTS_JS.slice(listenerIdx, ACCOUNTS_JS.indexOf('// ── Per-cover instant patch', listenerIdx));
    assert.match(body, /background-library-updated-preserve-filters/);
    assert.doesNotMatch(body, /keepScrollTop|scroller\.scrollTop\s*=\s*keepScrollTop/);
});

test('local cover path resolution is revision-wide and does not eagerly create images', () => {
    const body = fnBody(ACCOUNTS_JS, '_agResolveLocalCoverPathsForRevision');
    assert.match(body, /baseSignature = String\(revision \?\? list\.map\(_agArtworkKey\)\.join/);
    assert.match(body, /signature = baseSignature \+ '\\|' \+ String\(state\.generation/);
    assert.match(body, /_agWarmCachedCoversForGames\(list, \{ limit: Infinity/);
    assert.doesNotMatch(body, /new Image\(|document\.createElement\(['"]img['"]\)/);
});
