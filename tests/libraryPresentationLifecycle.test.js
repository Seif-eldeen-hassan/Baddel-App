'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const accounts = fs.readFileSync(path.join(root, 'src/js/accounts.js'), 'utf8');
const displayPrefs = fs.readFileSync(path.join(root, 'src/js/accounts/display-prefs.js'), 'utf8');

function bodyOf(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `${signature} must exist`);
    const brace = source.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = brace; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) return source.slice(brace, index + 1);
    }
    throw new Error(`Could not extract ${signature}`);
}

test('normal Grid/List visibility has one authoritative writer', () => {
    const apply = bodyOf(displayPrefs, 'function _agApplyDisplayPrefs(');
    assert.match(apply, /grid\.style\.display\s*=\s*isGrid\s*\?\s*['"]block['"]\s*:\s*['"]none['"]/);
    assert.match(apply, /list\.style\.display\s*=\s*isGrid\s*\?\s*['"]none['"]\s*:\s*['"]block['"]/);

    const exitEmpty = bodyOf(accounts, 'function _agExitEmptyPageMode(');
    const integrity = bodyOf(accounts, 'function _agEnsureVirtualGridIntegrity(');
    assert.doesNotMatch(exitEmpty, /list\.style\.display\s*=/);
    assert.doesNotMatch(integrity, /grid\.style\.display\s*=/);
    assert.match(integrity, /viewMode\s*!==\s*['"]grid['"]/);
});

test('route activation applies the selected presentation before asynchronous work', () => {
    const navigate = bodyOf(accounts, 'async function navigateToAllGames(');
    const showView = navigate.indexOf("view.style.display = 'block'");
    const beginRoute = navigate.indexOf('_agBeginAllGamesRoute(opts)');
    const firstAwait = navigate.indexOf('await ');
    assert.ok(showView >= 0 && beginRoute > showView);
    assert.ok(beginRoute < firstAwait, 'presentation must be applied before the first route await');

    const begin = bodyOf(accounts, 'function _agBeginAllGamesRoute(');
    assert.match(begin, /_agApplyDisplayPrefs\?\.\(\{ routeActive: true \}\)/);
    assert.doesNotMatch(begin, /list\.style\.display\s*=/);
});

test('hidden or zero-width grids cannot commit virtual geometry', () => {
    const measure = bodyOf(accounts, 'function _vsMeasure(');
    assert.match(measure, /getComputedStyle\(grid\)\.display\s*!==\s*['"]none['"]/);
    assert.match(measure, /gridW\s*<\s*80\s*\|\|\s*rectW\s*<\s*80/);
    assert.match(measure, /return null/);

    const render = bodyOf(accounts, 'function _vsRender(');
    assert.match(render, /if \(!m\)/);
    assert.match(render, /_vs\.cols\s*=\s*0/);
    assert.match(render, /_vs\.rowH\s*=\s*0/);
});

test('hidden-route resize is ignored and Grid restoration remeasures after layout', () => {
    const init = bodyOf(accounts, 'function _vsInit(');
    assert.match(init, /currentView\s*===\s*['"]all-games['"]/);
    assert.match(init, /view\?\.style\.display\s*!==\s*['"]none['"]/);
    assert.doesNotMatch(init, /grid\.style\.display\s*=\s*['"]block['"]/);

    const setMode = bodyOf(displayPrefs, 'window.setAgViewMode = function(');
    assert.match(setMode, /vs\.cols\s*=\s*0/);
    assert.match(setMode, /vs\.rowH\s*=\s*0/);
    assert.match(setMode, /requestAnimationFrame\(\(\)\s*=>\s*requestAnimationFrame/);
});

test('thumbnail preparation has no fixed five-second reveal gate', () => {
    const schedule = bodyOf(accounts, 'function _agScheduleGridThumbnailPreparation(');
    const pump = bodyOf(accounts, 'function _agPumpGridThumbnailPreparation(');
    assert.match(schedule, /setTimeout\(_agPumpGridThumbnailPreparation, 150\)/);
    assert.doesNotMatch(schedule, /5000/);
    assert.match(pump, /splice\(0, 8\)/);
    assert.match(pump, /_isScrolling\s*\|\|\s*window\._vs\?\._isFastScrolling/);
});
