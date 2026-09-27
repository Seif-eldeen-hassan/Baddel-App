'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const sidebar = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');

function functionBlock(name, nextName) {
    const start = sidebar.indexOf(`function ${name}`);
    const end = sidebar.indexOf(`function ${nextName}`, start + 1);
    assert.notEqual(start, -1, `${name} was not found`);
    assert.notEqual(end, -1, `${nextName} was not found`);
    return sidebar.slice(start, end);
}

function artworkSandbox() {
    const start = sidebar.indexOf('function _vaultIsManagedArtworkCacheUrl');
    const end = sidebar.indexOf('function _vaultScheduleArtworkWarm', start);
    const sandbox = {
        setTimeout,
        clearTimeout,
        Promise,
        _vaultResolveLocalCover: (game) => game.coverUrl,
        window: {
            electronAPI: {},
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(`${sidebar.slice(start, end)}\nObject.assign(window, { _vaultGridDisplayCover, _vaultAwaitArtworkBoundary, _vaultLoadExistingGridThumbnails });`, sandbox);
    return sandbox;
}

test('Vault first paint waits for only the visible artwork window before mounting', () => {
    const library = functionBlock('_renderVaultEpicLibraryResults', '_renderVaultEpicLibrary');
    const history = functionBlock('_renderVaultEpicHistoryResults', '_renderVaultEpicHistory');

    for (const source of [library, history]) {
        assert.match(source, /\.slice\(0, 48\)/);
        assert.match(source, /await _vaultAwaitArtworkBoundary\(_vaultPrimeLocalCovers/);
        assert.match(source, /await _vaultAwaitArtworkBoundary\(_vaultLoadExistingGridThumbnails/);
    }
    assert.ok(library.indexOf('await _vaultAwaitArtworkBoundary') < library.indexOf('_vaultMountLibraryVirtual'));
    assert.ok(history.indexOf('await _vaultAwaitArtworkBoundary') < history.indexOf('_vaultMountHistoryVirtual'));
});

test('Vault uses the shared 160x240 grid thumbnail mapping used by All Games', async () => {
    const sandbox = artworkSandbox();
    const source = 'file:///cache/artwork-cache-v2/assets/epic-game.webp';
    const thumbnail = 'file:///cache/artwork-grid-cache-v1/160x240/epic-game.webp';
    let request = null;
    sandbox.window.electronAPI.getGridArtworkThumbnails = async (urls, options) => {
        request = { urls, options };
        return { images: { [source]: thumbnail } };
    };

    const accepted = await sandbox.window._vaultLoadExistingGridThumbnails([{ coverUrl: source }], null, { limit: 48 });

    assert.equal(accepted, 1);
    assert.deepEqual(Array.from(request.urls), [source]);
    assert.equal(request.options.createMissing, false);
    assert.equal(sandbox.window._vaultGridDisplayCover(source), thumbnail);
});

test('Vault artwork preparation has a bounded fallback when image IPC never settles', async () => {
    const sandbox = artworkSandbox();
    const started = Date.now();
    const result = await sandbox.window._vaultAwaitArtworkBoundary(new Promise(() => {}), 15);
    assert.equal(result, 0);
    assert.ok(Date.now() - started < 250);
});

test('Vault background artwork work is chunked and creates missing thumbnails off first paint', () => {
    const warm = functionBlock('_vaultScheduleArtworkWarm', '_vaultPatchMountedCover');
    assert.match(warm, /slice\(48\)/);
    assert.match(warm, /offset \+= 64/);
    assert.match(warm, /createMissing: true/);
    assert.match(warm, /requestIdleCallback|setTimeout/);
    assert.match(warm, /__vaultArtworkWarmSignatures\.has/);
});

test('Vault visible virtual ranges receive artwork priority without rebuilding the full host', () => {
    const warm = functionBlock('_vaultWarmVisibleRange', '_vaultEnsureLibraryController');
    const libraryController = functionBlock('_vaultEnsureLibraryController', '_vaultRenderLibraryVirtualFrame');
    const historyController = functionBlock('_vaultEnsureHistoryController', '_vaultRenderHistoryVirtualFrame');
    assert.match(warm, /slice\(range\.start, range\.end\)/);
    assert.match(warm, /controller\.render\(true, true\)/);
    assert.doesNotMatch(warm, /host\.innerHTML|host\.textContent/);
    assert.match(libraryController, /_vaultWarmVisibleRange\(vs, range, 'library'\)/);
    assert.match(historyController, /_vaultWarmVisibleRange\(vs, range, 'history'\)/);
});

test('History preserves an unchanged cover node and resolves through canonical game identity', () => {
    const bind = functionBlock('_vaultBindHistoryRow', '_vaultEnsureHistoryController');
    const subject = functionBlock('_vaultHistoryArtworkSubject', '_vaultFindAllGamesArtworkForEpic');
    assert.match(bind, /slot\.dataset\.vaultArtworkKey !== artworkKey \|\| slot\.innerHTML !== next/);
    assert.match(subject, /_vaultFindLibraryGameMatchForPurchase/);
    assert.match(subject, /_vaultFindAllGamesArtworkForEpic/);
});

test('History without a stored URL still reaches the shared metadata resolver', () => {
    const queue = functionBlock('_vaultQueueMissingCoverWarm', '_vaultPrimeLocalCovers');
    assert.doesNotMatch(queue, /!remoteCandidates\.length/);
    assert.match(queue, /platform: game\.platform \|\| 'epic'/);
    assert.match(queue, /coverUrl: remoteCandidates\[0\] \|\| null/);
    assert.match(queue, /boostColdCoverBootstrap/);
});

test('stale asynchronous artwork preparation cannot mount an obsolete Vault result', () => {
    const library = functionBlock('_renderVaultEpicLibraryResults', '_renderVaultEpicLibrary');
    const history = functionBlock('_renderVaultEpicHistoryResults', '_renderVaultEpicHistory');
    assert.match(library, /renderJob !== __vaultEpicLibraryRenderJob/);
    assert.match(history, /renderJob !== __vaultEpicHistoryRenderJob/);
});
