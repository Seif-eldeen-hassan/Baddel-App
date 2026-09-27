'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SIDEBAR_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'sidebar.js'), 'utf8');
const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'accounts.js'), 'utf8');

function classList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        toggle(value, force) {
            const next = force === undefined ? !values.has(value) : !!force;
            if (next) values.add(value); else values.delete(value);
            return next;
        },
        contains(value) { return values.has(value); },
        values,
    };
}

function element(id) {
    let textContent = '';
    return {
        id,
        style: {},
        dataset: {},
        innerHTML: '',
        innerText: '',
        get textContent() { return textContent; },
        set textContent(value) { textContent = String(value); },
        classList: classList(),
        closest() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        getAttribute() { return null; },
        setAttribute(name, value) { this[name] = value; },
    };
}

function storage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(String(key), String(value)); },
        removeItem(key) { map.delete(String(key)); },
        dump() { return Object.fromEntries(map); },
    };
}

function createDocument(ids = []) {
    const byId = new Map(ids.map(id => [id, element(id)]));
    const get = id => {
        if (!byId.has(id)) byId.set(id, element(id));
        return byId.get(id);
    };
    return {
        body: element('body'),
        getElementById: get,
        querySelector(selector) {
            const match = String(selector).match(/^\[data-id="(.+)"\]$/);
            if (match) return get(match[1]);
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.nav-item') return [get('nav-home'), get('nav-all-games'), get('nav-installed'), get('nav-ready')];
            if (selector === '.sidebar-section-btn') return [];
            if (selector === '.ag-pill' || selector === '.ag-sort-item' || selector === '.dropdown-item') return [];
            if (selector === '.nav-item.active, .platform-item.active, [data-collection-id].active') return [get('nav-home')];
            return [];
        },
        addEventListener() {},
        createElement(tag) { return element(tag); },
    };
}

function createSandbox({ localStorageSeed = {}, electronAPI = {} } = {}) {
    const document = createDocument([
        'sbBodyLibrary', 'sbBodyCollections', 'sbBodyAccounts',
        'sbChevronLibrary', 'sbChevronCollections', 'sbChevronAccounts',
        'allGamesCount', 'nav-home', 'nav-all-games', 'nav-installed', 'nav-ready',
        'sbNavInstalled', 'sbNavReady', 'collectionsList', 'allGamesGrid',
        'allGamesView', 'accountsView', 'installedGamesView', 'mainContentArea',
        'agAccountMenu', 'selectedAgAccountText', 'allGamesViewTitle',
    ]);
    const listeners = [];
    const sandbox = {
        window: {},
        document,
        localStorage: storage(localStorageSeed),
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
        },
        CSS: { escape(value) { return String(value).replace(/"/g, '\\"'); } },
        setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
        clearTimeout() {},
        requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); },
        performance: { now: () => 0 },
        Map,
        Set,
        Promise,
        JSON,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Date,
        currentView: 'home',
        currentFilters: { collectionId: null },
        currentAccountPlatform: null,
        allCollections: [],
        allGamesData: [],
        playtimeData: {},
        _normPlatform(value) { return String(value || '').toLowerCase().trim(); },
        _agIsInstalled(game) { return !!(game?.path || game?.command || game?.isInstalled); },
        escapeHtml(value) { return String(value ?? ''); },
        navigateToHome() { sandbox.currentView = 'home'; },
        navigateToCollections() {},
        navigateToInstalled() {},
        applyFilters() {},
        renderRecentlyPlayed() {},
        renderExploreCarousel() {},
        renderSyncedSuggestions() {},
        applyHeroForHome() {},
        buildPlaytimeCache() {},
        openConfirmModal(_title, _body, _label, cb) { return cb?.(); },
    };
    sandbox.window = {
        ...sandbox.window,
        window: null,
        document,
        localStorage: sandbox.localStorage,
        console: sandbox.console,
        electronAPI,
        addEventListener(type, fn) { listeners.push({ type, fn }); },
        dispatchEvent(event) {
            listeners.filter(item => item.type === event.type).forEach(item => item.fn(event));
        },
        BaddelCanonicalProductIdentity: null,
        __baddelRefreshCanonicalGamesRegistry: async () => [],
        __baddelSetCanonicalGamesRegistry() {},
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.CustomEvent = sandbox.CustomEvent;
    sandbox.window.CSS = sandbox.CSS;
    sandbox.window.allGamesData = sandbox.allGamesData;
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(SIDEBAR_JS, sandbox, { filename: 'sidebar.js' });
    vm.runInContext(ACCOUNTS_JS, sandbox, { filename: 'accounts.js' });
    return sandbox;
}

function syncedGame(id, title, platform = 'steam', accountId = 'acc') {
    return {
        id,
        title,
        name: title,
        platform,
        ownedByAccountIds: [accountId],
    };
}

test('fresh install opens Accounts section while Home remains active', () => {
    const sandbox = createSandbox();
    sandbox.renderSidebar();

    assert.equal(sandbox.window._sbSec.accounts, true);
    assert.equal(sandbox.document.getElementById('sbBodyAccounts').style.display, '');
    assert.equal(sandbox.document.getElementById('sbChevronAccounts').classList.contains('sb-chevron-closed'), false);
    assert.equal(sandbox.currentView, 'home');
});

test('existing closed/open Accounts preferences are restored', () => {
    const closed = createSandbox({
        localStorageSeed: {
            'baddel.sidebar.sections.v1': JSON.stringify({ library: true, collections: true, accounts: false }),
        },
    });
    closed.renderSidebar();
    assert.equal(closed.window._sbSec.accounts, false);
    assert.equal(closed.document.getElementById('sbBodyAccounts').style.display, 'none');

    const open = createSandbox({
        localStorageSeed: {
            'baddel.sidebar.sections.v1': JSON.stringify({ library: true, collections: false, accounts: true }),
        },
    });
    open.renderSidebar();
    assert.equal(open.window._sbSec.accounts, true);
    assert.equal(open.document.getElementById('sbBodyAccounts').style.display, '');
});

test('sidebar section toggle persists without touching collapsed-width preference', () => {
    const sandbox = createSandbox({
        localStorageSeed: { 'baddel.sidebar.collapsed': '1' },
    });
    sandbox.sbToggleSection('accounts');

    const stored = JSON.parse(sandbox.localStorage.getItem('baddel.sidebar.sections.v1'));
    assert.equal(stored.accounts, false);
    assert.equal(sandbox.localStorage.getItem('baddel.sidebar.collapsed'), '1');
});

test('malformed sidebar section preference falls back safely', () => {
    const sandbox = createSandbox({
        localStorageSeed: { 'baddel.sidebar.sections.v1': '{bad-json' },
    });
    sandbox.renderSidebar();
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window._sbSec)), {
        library: true,
        collections: true,
        accounts: true,
    });
});

test('loading and persisted All Games counts render before authoritative hydration', () => {
    const loading = createSandbox();
    loading.renderSidebar();
    assert.equal(loading.document.getElementById('allGamesCount').textContent, '...');

    const persisted = createSandbox({
        localStorageSeed: { 'baddel.sidebar.allGamesCount.v1': '37' },
    });
    persisted.renderSidebar();
    assert.equal(persisted.document.getElementById('allGamesCount').textContent, '37');
});

test('startup count hydration uses cached platform data without renderAllGamesView or network sync', async () => {
    const calls = [];
    const games = Array.from({ length: 37 }, (_, index) => syncedGame(`steam-${index}`, `Game ${index}`, 'steam', 's1'));
    const sandbox = createSandbox({
        electronAPI: {
            platformSyncStatus: async () => ({ steam: true, epic: false }),
            platformSyncGetAccounts: async platform => {
                calls.push(`accounts:${platform}`);
                return { accounts: [{ id: 's1', displayName: 'Steam One' }] };
            },
            platformSyncGetCached: async platform => {
                calls.push(`cached:${platform}`);
                return { games };
            },
            platformSyncSync: async () => { throw new Error('network sync must not run'); },
        },
    });
    sandbox.window.renderAllGamesView = () => { throw new Error('renderAllGamesView must not run'); };
    sandbox.renderSidebar();

    const projection = await sandbox.window.hydrateSidebarAllGamesCount('startup-cache');

    assert.equal(projection.count, 37);
    assert.equal(sandbox.document.getElementById('allGamesCount').textContent, '37');
    assert.deepEqual(calls, ['accounts:steam', 'cached:steam']);
});

test('empty authoritative All Games library displays 0, not dash', async () => {
    const sandbox = createSandbox({
        electronAPI: {
            platformSyncStatus: async () => ({ steam: true }),
            platformSyncGetAccounts: async () => ({ accounts: [] }),
            platformSyncGetCached: async () => ({ games: [] }),
        },
    });

    await sandbox.window.hydrateSidebarAllGamesCount('startup-cache');

    assert.equal(sandbox.document.getElementById('allGamesCount').textContent, '0');
});

test('persisted count appears immediately then reconciles to cached count and survives restart', async () => {
    const sandbox = createSandbox({
        localStorageSeed: { 'baddel.sidebar.allGamesCount.v1': '12' },
        electronAPI: {
            platformSyncStatus: async () => ({ epic: true }),
            platformSyncGetAccounts: async () => ({ accounts: [{ id: 'e1', displayName: 'Epic One' }] }),
            platformSyncGetCached: async () => ({ games: [syncedGame('epic-a', 'Alpha', 'epic', 'e1'), syncedGame('epic-b', 'Beta', 'epic', 'e1')] }),
        },
    });
    sandbox.renderSidebar();
    assert.equal(sandbox.document.getElementById('allGamesCount').textContent, '12');

    await sandbox.window.hydrateSidebarAllGamesCount('startup-cache');
    assert.equal(sandbox.document.getElementById('allGamesCount').textContent, '2');
    assert.equal(sandbox.localStorage.getItem('baddel.sidebar.allGamesCount.v1'), '2');
});

test('projection count matches rendered All Games cache rules for duplicates and separate games', async () => {
    const sandbox = createSandbox();
    const projection = await sandbox.window.buildAllGamesLibraryProjection({
        cachedPlatformGames: [
            syncedGame('steam-valorant', 'VALORANT', 'steam', 's1'),
            syncedGame('epic-valorant', 'Valorant', 'epic', 'e1'),
            syncedGame('steam-cs2', 'Counter-Strike 2', 'steam', 's1'),
            syncedGame('epic-fall-guys', 'Fall Guys', 'epic', 'e1'),
        ],
        accountMetadata: {
            steam: [{ id: 's1', displayName: 'Steam' }],
            epic: [{ id: 'e1', displayName: 'Epic' }],
        },
    });

    assert.equal(projection.count, 3);
    assert.equal(projection.libraryGames.find(game => game.title === 'VALORANT').platforms.length, 2);
});

test('library update and local add/remove sources can update badge; artwork-only does not', () => {
    const sandbox = createSandbox();
    sandbox.window.setSidebarAllGamesCount(4, { source: 'library-updated', ready: true });
    assert.equal(sandbox.document.getElementById('allGamesCount').textContent, '4');

    sandbox.window.setSidebarAllGamesCount(5, { source: 'game-added', ready: true });
    assert.equal(sandbox.document.getElementById('allGamesCount').textContent, '5');

    sandbox.window.setSidebarAllGamesCount(3, { source: 'game-removed', ready: true });
    assert.equal(sandbox.document.getElementById('allGamesCount').textContent, '3');

    sandbox.window.dispatchEvent(new sandbox.CustomEvent('all-games-cover-cached', { detail: { id: 'x' } }));
    assert.equal(sandbox.document.getElementById('allGamesCount').textContent, '3');
});

test('Installed and Ready to Install badge behavior remains separate', () => {
    const sandbox = createSandbox();
    sandbox.allGamesData = [{ id: 'installed', path: 'C:/Game/game.exe' }];
    sandbox.window.allGamesData = sandbox.allGamesData;
    sandbox.window.__readyToInstallState = { ready: true, count: 9, games: Array(9).fill({}), version: 1 };

    sandbox.updateSmartSidebarCounts();

    assert.equal(sandbox.document.getElementById('sbNavInstalled').textContent, '1');
    assert.equal(sandbox.document.getElementById('sbNavReady').textContent, '9');
}
);

test('confirmed empty Installed library displays 0 instead of an unknown dash', () => {
    const sandbox = createSandbox();
    sandbox.allGamesData = [];
    sandbox.window.allGamesData = sandbox.allGamesData;

    sandbox.updateSmartSidebarCounts();

    assert.equal(sandbox.document.getElementById('sbNavInstalled').textContent, '0');
});

test('cached Installed count is available before accounts.js installed predicate is ready', () => {
    const sandbox = createSandbox();
    sandbox._agIsInstalled = undefined;
    sandbox.allGamesData = [
        { id: 'epic-local', path: 'C:/Games/Epic/game.exe', command: 'launch', isInstalled: true },
        { id: 'riot-local', path: 'C:/Games/Riot/game.exe', command: 'launch', isInstalled: true },
    ];
    sandbox.window.allGamesData = sandbox.allGamesData;

    sandbox.updateSmartSidebarCounts();

    assert.equal(sandbox.document.getElementById('sbNavInstalled').textContent, '2');
});
