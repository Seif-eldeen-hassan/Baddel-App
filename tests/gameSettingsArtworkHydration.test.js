'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ADD_GAME_MODAL_JS = fs.readFileSync(path.join(ROOT, 'src/js/addGameModal.js'), 'utf8');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'), 'utf8');
const CONTEXT_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/game-context-actions.js'), 'utf8');
const { resolveArtworkCacheKeys } = require('../src/features/games/application/services/GameArtworkReadModel');

function extractFunction(source, name) {
    const marker = `function ${name}`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${name} not found`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

test('resolveArtworkCacheKeys uses strong identity aliases and excludes title/name', () => {
    const keys = resolveArtworkCacheKeys(
        {
            id: 'epic:fall-guys',
            localGameId: 'local-fall-guys',
            installedId: 'installed-fall-guys',
            name: 'Fall Guys Title',
            platform: 'epic',
            appName: 'FallGuys',
            launcherGameId: 'FallGuysLauncher',
        },
        {
            id: 'local-fall-guys',
            installedGameKey: 'install-key',
            allIds: { steam: '12345' },
            steamAppId: '12345',
            platform: 'steam',
            appId: '12345',
        }
    );

    assert.deepEqual(keys.slice(0, 4), ['local-fall-guys', 'installed-fall-guys', 'epic:fall-guys', 'install-key']);
    assert.ok(keys.includes('12345'));
    assert.ok(keys.includes('FallGuys'));
    assert.ok(keys.includes('FallGuysLauncher'));
    assert.equal(keys.includes('Fall Guys Title'), false);
});

test('__baddelLoadCachedArtworkForGame tries strong keys and returns matched disk cache hits', async () => {
    const calls = [];
    const sandbox = {
        window: {},
        console: { info() {}, warn() {}, error() {}, debug() {} },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        Map,
        Set,
        Promise,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Date,
        safeImageUrl(value) { return value || null; },
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.console = sandbox.console;
    sandbox.window.localStorage = sandbox.localStorage;
    sandbox.window.BaddelGameArtworkReadModel = { resolveArtworkCacheKeys };
    sandbox.window.electronAPI = {
        async getCachedImage(key, type) {
            calls.push(`${type}:${key}`);
            if (key === 'local-fall-guys' && type === 'hero') return 'file:///cache/hero-local.webp';
            if (key === 'FallGuys' && type === 'logo') return 'file:///cache/logo-epic.webp';
            return null;
        },
        async probeLocalImage(url) {
            return !String(url).includes('missing');
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(ARTWORK_SYNC_JS, sandbox, { filename: 'artwork-sync.js' });

    const result = await sandbox.window.__baddelLoadCachedArtworkForGame(
        { id: 'epic:fall-guys', localGameId: 'local-fall-guys', appName: 'FallGuys' },
        { id: 'local-fall-guys' }
    );

    assert.equal(result.hero, 'file:///cache/hero-local.webp');
    assert.equal(result.logo, 'file:///cache/logo-epic.webp');
    assert.equal(result.matchedKeys.hero, 'local-fall-guys');
    assert.equal(result.matchedKeys.logo, 'FallGuys');
    assert.ok(calls.includes('hero:local-fall-guys'));
    assert.ok(calls.includes('logo:FallGuys'));
});

test('_gsSetArtworkPreview advances from stale first candidate to valid second candidate', () => {
    const normalizeSrc = extractFunction(ADD_GAME_MODAL_JS, '_gsNormalizeCandidates');
    const previewSrc = extractFunction(ADD_GAME_MODAL_JS, '_gsSetArtworkPreview');
    const factory = new Function('safeImageUrl', `
        let _gsArtworkOpenRequestId = 1;
        ${normalizeSrc}
        ${previewSrc}
        return { _gsSetArtworkPreview };
    `);
    const { _gsSetArtworkPreview } = factory(value => value || null);
    const img = { src: '', style: {} };

    _gsSetArtworkPreview(img, ['file:///missing.webp', 'file:///valid.webp'], 'placeholder.jpg', 1);
    assert.equal(img.src, 'file:///missing.webp');
    img.onerror();
    assert.equal(img.src, 'file:///valid.webp');
    img.onerror();
    assert.equal(img.src, 'placeholder.jpg');
});

test('_gsUpdateLogoPreview tries every logo candidate before showing No Logo', () => {
    const normalizeSrc = extractFunction(ADD_GAME_MODAL_JS, '_gsNormalizeCandidates');
    const logoSrc = extractFunction(ADD_GAME_MODAL_JS, '_gsUpdateLogoPreview');
    const logoEl = { src: '', style: {} };
    const emptyEl = { style: {} };
    const document = {
        getElementById(id) {
            if (id === 'previewLogo') return logoEl;
            if (id === 'gs-logo-empty') return emptyEl;
            return null;
        },
    };
    const factory = new Function('safeImageUrl', 'document', `
        let _gsArtworkOpenRequestId = 1;
        ${normalizeSrc}
        ${logoSrc}
        return { _gsUpdateLogoPreview };
    `);
    const { _gsUpdateLogoPreview } = factory(value => value || null, document);

    _gsUpdateLogoPreview(['file:///missing-logo.webp', 'file:///valid-logo.webp'], 1);
    assert.equal(logoEl.src, 'file:///missing-logo.webp');
    logoEl.onerror();
    assert.equal(logoEl.src, 'file:///valid-logo.webp');
    logoEl.onerror();
    assert.equal(logoEl.style.display, 'none');
    assert.equal(emptyEl.style.display, 'flex');
});

test('Game Settings context menu action closes menu before opening modal', () => {
    assert.match(CONTEXT_JS, /hideContextMenu\(\);\s*openGameSettings\('\$\{id\}'\)/);
    const openBody = extractFunction(ADD_GAME_MODAL_JS, 'openGameSettings');
    assert.match(openBody, /hideContextMenu\(\)/);
    assert.ok(openBody.indexOf('hideContextMenu') < openBody.indexOf('await'));
});

test('saveGameSettings artwork path does not call applyFilters after changed artwork types', () => {
    const body = extractFunction(ADD_GAME_MODAL_JS, 'saveGameSettings');
    const successIndex = body.indexOf("showToast('Settings saved successfully!'");
    const tail = body.slice(successIndex);
    assert.match(tail, /if \(!_changedTypes\.length\)/);
    assert.doesNotMatch(tail, /if \(_changedTypes\.length\)[\s\S]*applyFilters\(/);
});
