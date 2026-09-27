'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/js/app.js', 'utf8');
const dashboard = fs.readFileSync('src/dashboard.html', 'utf8');
const accounts = fs.readFileSync('src/js/accounts.js', 'utf8');
const normalizer = source.slice(source.indexOf('const _PLAT_NORM_MAP'), source.indexOf('function _platformAliasesForGame'));
const evidence = source.slice(source.indexOf('function _gameHasInstalledGogEvidence'), source.indexOf('async function applyFilters'));
const context = { window: {} };
vm.createContext(context);
vm.runInContext(`${normalizer}\n${evidence}\nthis.matchesGog = game => _gameHasInstalledGogEvidence(game);`, context);

test('Installed Games dropdown contains the canonical GOG value and label', () => {
    assert.match(dashboard, /igSelectPlatform\('gog','GOG'\)/);
});

test('All Games and Ready to Install empty states offer Sync GOG through the library-link modal', () => {
    assert.ok((accounts.match(/Sync GOG/g) || []).length >= 3);
    assert.match(accounts, /syncEmptyLibraryPlatform\('gog'\)/);
    assert.match(accounts, /openPlatformsModal/);
    assert.doesNotMatch(accounts.slice(accounts.indexOf('function _agRenderEmptyOnboarding'), accounts.indexOf('async function _agHasLinkedSteamOrEpicAccounts')), /selectAccountPlatform\('gog'\)|startTargetedGogSwitcherAdd/);
});

test('GOG filter accepts scanner and managed gogdl installation evidence', () => {
    assert.equal(context.matchesGog({ scannerPlatform: 'gog' }), true);
    assert.equal(context.matchesGog({ platform: 'gog', installProvider: 'gogdl', installSource: 'download' }), true);
});

test('GOG ownership metadata alone is not treated as a GOG installation', () => {
    assert.equal(context.matchesGog({ platform: 'steam', scannerPlatform: 'steam', allIds: { steam: '1', gog: '2' }, isInstalled: true }), false);
    assert.equal(context.matchesGog({ platform: 'gog', allIds: { gog: '2' }, ownedByAccountIds: ['account-1'] }), false);
});
