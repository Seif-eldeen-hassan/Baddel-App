'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');

test('Game Details renders its basic shell before optional GOG hydration', () => {
    const renderIndex = source.indexOf("_gdRecordStage('GD_POPULATE_BASIC_END')");
    const hydrateIndex = source.indexOf("_gdRecordStage('GD_GOG_HYDRATE_START')");
    assert.ok(renderIndex > 0 && hydrateIndex > renderIndex);
    assert.match(source, /void _gdHydrateGogRichRecordForDetails\(compactGogGame\)\.then/);
    assert.doesNotMatch(source, /game = await _gdHydrateGogRichRecordForDetails\(game\)/);
});

test('optional account failure and an unexpected fatal error settle loading placeholders', () => {
    assert.match(source, /GD_ACCOUNTS_FAILED/);
    assert.match(source, /Account details are unavailable/);
    assert.match(source, /GD_OPEN_FATAL/);
    const fatal = source.slice(source.indexOf("_gdRecordStage('GD_OPEN_FATAL'"), source.indexOf('// ──────────────────────────────────────────\n//  NO-METADATA UI STATE'));
    assert.match(fatal, /_gdClearSkeletons\(\)/);
    assert.match(fatal, /Media unavailable/);
});

test('stage diagnostics are bounded and debug-gated', () => {
    assert.match(source, /window\.__baddelDebugGameDetails !== true/);
    assert.match(source, /trace\.length > 120/);
    for (const stage of ['GD_OPEN_START', 'GD_GAME_RESOLVED', 'GD_VIEW_SWITCHED', 'GD_RESET_UI', 'GD_POPULATE_BASIC_END', 'GD_METADATA_START', 'GD_OPEN_COMPLETE', 'GD_OPEN_FATAL']) {
        assert.match(source, new RegExp(stage));
    }
});
