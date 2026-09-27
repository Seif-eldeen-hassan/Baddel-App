'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/downloads.js'), 'utf8');

test('completed download cards render Play only through the readiness contract', () => {
    assert.match(source, /dlTaskReadyToPlay\(task\) \? dlButton\(\{ label: 'Play'[\s\S]*action: 'downloadsPlay'/);
    assert.match(source, /window\.downloadsPlay\s*=\s*async taskId/);
    assert.match(source, /!dlTaskReadyToPlay\(task\)/);
    assert.match(source, /task\.installedGameId/);
});

test('Downloads Play uses the existing launch flow instead of opening folders', () => {
    assert.match(source, /window\.openPlayLauncher\(game\)/);
    assert.match(source, /window\.triggerLaunchSequence\(game\.id\)/);
    const start = source.indexOf('window.downloadsPlay');
    const end = source.indexOf('window.downloadsRemove', start);
    const handler = source.slice(start, end);
    assert.doesNotMatch(handler, /openInstallDirectory|openFolder|openPath/);
});
test('Downloads Play resolves completed tasks by provider identity and backfills installedGameId', () => {
    assert.match(source, /function dlFindInstalledGameByTask/);
    assert.match(source, /dlGameIdentityValues\(game\)\.some\(id => wantedIds\.has\(id\)\)/);
    assert.match(source, /if \(!task\.installedGameId && game\.id\)/);
    assert.match(source, /task\.installedGameId = game\.id/);
});

test('Downloads Play can resolve repaired completed records by executable and install path', () => {
    assert.match(source, /const wantedInstallPath = dlPathKey\(task\.installPath\)/);
    assert.match(source, /const wantedExe = dlPathKey\(task\.resolvedExecutablePath \|\| task\.verificationExecutablePath \|\| task\.executablePath\)/);
    assert.match(source, /game = await dlResolveInstalledGameForTask\(task\) \|\| dlBuildLaunchGameFromTask\(task\)/);
    assert.match(source, /path: task\.path \|\| task\.installPath \|\| executablePath/);
    assert.match(source, /launchCommand: task\.launchCommand \|\| task\.command \|\|/);
});


test('Downloads actions cover transitional states and status changes rerender buttons', () => {
    assert.match(source, /'resuming'/);
    assert.match(source, /'pausing'/);
    assert.match(source, /label: 'Resuming\.\.\.'/);
    assert.match(source, /label: 'Pausing\.\.\.'/);
    assert.match(source, /card\.dataset\.taskStatus !== String\(task\.status \|\| ''\)/);
});

test('Downloads renderer clamps displayed bytes to canonical total', () => {
    assert.match(source, /Math\.min\(authoritative, totalBytes\)/);
    assert.doesNotMatch(source, /DOWNLOAD_PRESENTATION_(?:LEAD_BUFFER|MAX_PROJECTION|MIN_LEAD)/);
});
