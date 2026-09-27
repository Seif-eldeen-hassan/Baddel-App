'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const details = fs.readFileSync('src/js/game-details.js', 'utf8');
const dashboard = fs.readFileSync('src/dashboard.html', 'utf8');
const play = fs.readFileSync('src/js/play-launcher.js', 'utf8');

test('Epic, Steam, and GOG use the common install picker', () => {
    assert.match(details, /new Set\(\['epic', 'steam', 'gog'\]\)/);
    assert.doesNotMatch(details, /_gdDetectPlatforms\(game\)\.filter\(p => p === 'gog'\)/);
    assert.match(details, /steam: 'steam_client', gog: 'gogdl'/);
});

test('common INSTALL enters platform picker and Epic methods stay inside installer', () => {
    assert.match(details, /_gdOpenInstallPicker\(_gdCurrentGame\);/);
    assert.doesNotMatch(details, /installProvider: _gdDetectPlatforms/);
    assert.doesNotMatch(dashboard, /epic-install-split|gdInstallMethodToggle/);
    assert.match(details, /id="gdInstallMethodsSection" hidden/);
    assert.match(details, /gdInstallSelectProvider\('legendary'\)/);
    assert.match(details, /gdInstallSelectProvider\('epic_launcher'\)/);
    assert.match(details, /Epic Games Launcher is not installed/);
    assert.match(details, /gdInstallSelectProvider\('gogdl'\)/);
    assert.match(details, /gdInstallSelectProvider\('gog_galaxy'\)/);
    assert.match(details, /GOG Galaxy is not installed/);
});

test('provider routes are explicit and no duplicate broad Epic direct condition remains', () => {
    assert.match(details, /targetPlatform === 'epic' && installProvider === 'legendary'/);
    assert.match(details, /targetPlatform === 'epic' && installProvider === 'epic_launcher'/);
    assert.match(details, /targetPlatform === 'gog' && installProvider === 'gogdl'/);
    assert.doesNotMatch(details, /targetPlatform === 'epic' \|\| targetPlatform === 'gog'/);
});

test('Legendary route queues directly without invoking Epic switch/open, official route retains both', () => {
    const directStart = details.indexOf("targetPlatform === 'epic' && installProvider === 'legendary'");
    const gogStart = details.indexOf("targetPlatform === 'gog' && installProvider === 'gogdl'", directStart);
    const officialStart = details.indexOf("targetPlatform === 'epic' && installProvider === 'epic_launcher'");
    const direct = details.slice(directStart, gogStart);
    const official = details.slice(officialStart, details.indexOf("targetPlatform === 'steam'", officialStart));
    assert.match(direct, /_gdQueueDirectDownload/);
    assert.doesNotMatch(direct, /switchEpic|_gdOpenInstallUrl/);
    assert.match(official, /switchEpic/);
    assert.match(official, /_gdOpenInstallUrl/);
});

test('Legendary Play uses direct synced-owner resolver and dedicated IPC, not Switcher', () => {
    assert.match(play, /isLegendaryEpic/);
    assert.match(play, /buildDirectEpicInstallAccountOptions/);
    assert.match(play, /launchEpicLegendary/);
});
