'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('populated cache resolves visible local covers before rendering and continues at application scope', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'accounts.js'), 'utf8');
    const start = source.indexOf('async function navigateToAllGames(opts = {})');
    const end = source.indexOf('function _agRenderReadyToInstallLoading(', start);
    const navigate = source.slice(start, end);
    const warm = navigate.indexOf('await _agWarmCachedCoversForGames(visibleGames');
    const render = navigate.indexOf('_applyAgFilters({', warm);
    const hydrate = navigate.indexOf('_agStartCompleteLibraryCoverHydration(visibleGames', render);
    assert.ok(warm > 0 && render > warm && hydrate > render);
});
