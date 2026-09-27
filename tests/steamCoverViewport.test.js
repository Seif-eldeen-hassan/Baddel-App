'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('visible null-cover game dispatches main-process bootstrap with visible priority', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/js/accounts.js'), 'utf8');
    const start = source.indexOf('async function _agResolveCoverForGame(');
    const end = source.indexOf('function _agIsUserLibraryGame(', start);
    const calls = [];
    const record = { attempts: 0 };
    const context = vm.createContext({
        window: { electronAPI: { boostColdCoverBootstrap: async (games, options) => calls.push({ games, options }) } },
        localStorage: { getItem: () => null },
        _agApplyReadyArtworkToGame: () => false,
        _agArtworkRecordFor: () => record,
        _agIsCreatorArtworkGame: () => false,
        _agIsManagedArtworkCacheUrl: () => false,
        _agArtworkCandidateUrlsFromGame: () => [],
    });
    vm.runInContext(source.slice(start, end), context);
    const game = { id: 'steam_239140', platform: 'steam', coverUrl: null };
    await context._agResolveCoverForGame(game, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.priority, 'visible');
    assert.equal(calls[0].games[0], game);
    assert.equal(record.status, 'promoted');
    assert.equal(game._agCoverInFlight, false);
});
