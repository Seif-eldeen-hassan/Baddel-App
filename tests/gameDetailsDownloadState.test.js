'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/game-details.js'), 'utf8');

test('Game Details subscribes to real Downloads snapshot and task updates once', () => {
    assert.match(source, /downloads\.getSnapshot\(\)/);
    assert.match(source, /downloads\.onSnapshot/);
    assert.match(source, /downloads\.onTaskUpdated/);
    assert.match(source, /_gdDownloadsUnsubscribers\.length/);
});

test('Game Details matches downloads by provider identities before title fallback', () => {
    assert.match(source, /function _gdFindMatchingDownloadTask/);
    assert.match(source, /providerProductId/);
    assert.match(source, /contentSystemProductId/);
    assert.match(source, /gogdlAppName/);
    assert.match(source, /_gdTitleKey\(task\.title \|\| task\.providerAppName\)/);
});

test('Game Details renders live download states instead of simulated install progress', () => {
    for (const label of ['QUEUED', 'PREPARING', 'DOWNLOADING', 'PAUSING', 'Resume', 'RESUMING', 'VERIFYING', 'INSTALLING', 'Retry', 'PLAY']) {
        assert.match(source, new RegExp(label));
    }
    assert.doesNotMatch(source, /_gdSimulateDownload\(\);/);
    assert.match(source, /gdHandleMainAction download-state branch/);
});
test('Game Details hides the main action during active downloads and uses card controls', () => {
    assert.match(source, /if \(playBtn\) playBtn\.style\.display = 'none'/);
    assert.match(source, /window\.gdDownloadAction\s*=\s*async function/);
    assert.match(source, /downloads\.pause\(taskId\)/);
    assert.match(source, /downloads\.resume\(taskId\)/);
    assert.match(source, /_gdDownloadActionInFlight/);
});

test('Game Details resolves installed library records before install fallback', () => {
    assert.match(source, /async function _gdResolveInstalledCurrentGame/);
    assert.match(source, /await _gdResolveInstalledCurrentGame\(\)/);
    assert.match(source, /_gdInstalledRecordCanLaunch\(_gdCurrentGame\)/);
    assert.match(source, /await _gdResolveInstalledGameForDownloadTask\(downloadTask\)/);
});

test('Game Details patches download task revisions and avoids duplicated status text', () => {
    assert.match(source, /incomingRevision <= currentRevision/);
    assert.match(source, /statusEl\.textContent = statusLabel/);
    assert.doesNotMatch(source, /`\$\{buttonLabel\}\$\{statusText \? ` - /);
});