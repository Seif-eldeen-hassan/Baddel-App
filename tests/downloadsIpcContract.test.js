'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { CHANNELS, validateTaskId, sanitizeQueuePayload } = require('../src/features/downloads/infrastructure/ipc/downloads.ipc');

const PRELOAD = fs.readFileSync('preload.js', 'utf8');
const DASHBOARD = fs.readFileSync('src/dashboard.html', 'utf8');
const DOWNLOADS_JS = fs.readFileSync('src/js/downloads.js', 'utf8');
const GAME_DETAILS_JS = fs.readFileSync('src/js/game-details.js', 'utf8');

test('downloads IPC exposes only allowlisted channel names', () => {
    assert.equal(CHANNELS.GET_SNAPSHOT, 'downloads:get-snapshot');
    assert.equal(CHANNELS.QUEUE_INSTALL, 'downloads:queue-install');
    assert.equal(CHANNELS.START_NOW, 'downloads:start-now');
    assert.equal(CHANNELS.GET_CAPABILITIES, 'downloads:get-capabilities');
    assert.match(PRELOAD, /downloads:\s*{/);
    assert.match(PRELOAD, /startNow:\s*\(taskId\)\s*=>\s*ipcRenderer\.invoke\('downloads:start-now', taskId\)/);
    assert.doesNotMatch(PRELOAD, /downloads:[\s\S]*ipcRenderer\.invoke\(channel/);
});

test('downloads IPC validates task ids', () => {
    assert.equal(validateTaskId('dl_0123456789abcdef'), 'dl_0123456789abcdef');
    assert.throws(() => validateTaskId('../bad'), /Invalid download task id/);
});

test('downloads IPC strips renderer-controlled runtime arguments', () => {
    const payload = sanitizeQueuePayload({
        platform: 'gog',
        accountId: 'a',
        providerProductId: '1',
        installPath: 'D:\\Games\\X',
        installedDiskSizeBytes: 123,
        runtimePath: 'C:\\bad.exe',
        args: ['--token', 'secret'],
    });
    assert.equal(payload.runtimePath, undefined);
    assert.equal(payload.args, undefined);
    assert.equal(payload.installedDiskSizeBytes, 123);
    assert.equal(payload.deletePartial, undefined);
    assert.equal(payload.deletePath, undefined);
});

test('downloads sidebar and view are wired into dashboard', () => {
    assert.match(DASHBOARD, /id="nav-downloads"/);
    assert.match(DASHBOARD, /id="downloadsView"/);
    assert.match(DASHBOARD, /Manage direct game installations from GOG/);
    assert.match(DASHBOARD, /css\/downloads\.css/);
    assert.match(DASHBOARD, /js\/downloads\.js/);
    assert.match(DOWNLOADS_JS, /window\.navigateToDownloads/);
    assert.match(DOWNLOADS_JS, /window\.electronAPI\.downloads\.startNow\(taskId\)/);
    assert.match(DOWNLOADS_JS, /No downloads yet/);
    assert.match(DOWNLOADS_JS, /Games you install directly from GOG will appear here/);
});

test('downloads renderer uses task patches instead of duplicate queue renders', () => {
    assert.match(DOWNLOADS_JS, /onSnapshot\(renderDownloads\)/);
    assert.match(DOWNLOADS_JS, /onTaskUpdated\?\.\(patchDownloadTaskCard\)/);
    assert.doesNotMatch(DOWNLOADS_JS, /onQueueChanged\(renderDownloads\)/);
    assert.match(DOWNLOADS_JS, /function patchDownloadTaskCard/);
    assert.doesNotMatch(DOWNLOADS_JS, /downloadsVisualProgress/);
    assert.doesNotMatch(DOWNLOADS_JS, /dlTickVisualProgress/);
    assert.doesNotMatch(DOWNLOADS_JS, /requestAnimationFrame\(dlTickVisualProgress\)/);
    assert.match(DOWNLOADS_JS, /data-download-field="downloaded"/);
});

test('downloads renderer derives visual percent from displayed transfer bytes', () => {
    assert.match(DOWNLOADS_JS, /function getEffectiveTransferPercent\(task\)/);
    assert.match(DOWNLOADS_JS, /downloadedBytes \/ totalBytes\) \* 100/);
    assert.doesNotMatch(DOWNLOADS_JS, /function dlPercent\(task\)/);
    const cardStart = DOWNLOADS_JS.indexOf('function dlTaskCard');
    const cardBlock = DOWNLOADS_JS.slice(cardStart, cardStart + 2200);
    assert.match(cardBlock, /const pct = getEffectiveTransferPercent\(task\)/);
    assert.match(cardBlock, /width:\$\{pct\}%/);
    assert.match(DOWNLOADS_JS, /Game Files/);
    assert.match(DOWNLOADS_JS, /Download Speed/);
    assert.match(DOWNLOADS_JS, /Disk Usage/);
    assert.match(DOWNLOADS_JS, /Estimated Time/);
    assert.doesNotMatch(DOWNLOADS_JS, /Network Downloaded/);
    assert.match(DOWNLOADS_JS, /download-speed-chart/);
    assert.match(DOWNLOADS_JS, /function dlTaskChartSamples/);
    assert.match(DOWNLOADS_JS, /function dlAdvancedDetails/);
    assert.match(DOWNLOADS_JS, /Raw Network/);
    assert.match(DOWNLOADS_JS, /Written Data/);
    assert.match(DOWNLOADS_JS, /Free Space at Queue/);
    assert.match(DOWNLOADS_JS, /Required Space/);
    assert.match(DOWNLOADS_JS, /Safety Margin/);
    assert.match(DOWNLOADS_JS, /downloadsDeletePartial/);
    assert.match(DOWNLOADS_JS, /deletePartial:\s*true/);
    const patchStart = DOWNLOADS_JS.indexOf('function patchDownloadTaskCard');
    const patchBlock = DOWNLOADS_JS.slice(patchStart, patchStart + 4200);
    assert.match(patchBlock, /const pct = getEffectiveTransferPercent\(task\)/);
    assert.match(patchBlock, /label\.textContent = pct === null \? 'Preparing' : `\$\{pct\.toFixed\(1\)\}%`/);
    assert.match(patchBlock, /fill\.style\.width = pct === null \? '35%' : `\$\{Math\.max\(0, Math\.min\(100, pct\)\)\}%`/);
    assert.match(patchBlock, /dlRenderSpeedChart\(task\)/);
    assert.match(patchBlock, /dlAdvancedDetails\(task(?:,\s*wasOpen)?\)/);
    assert.match(DOWNLOADS_JS, /dlDownloadedText\(task\)/);
});

test('GOG Game Details install path opens folder picker before queuing direct download', () => {
    const pickerStart = GAME_DETAILS_JS.indexOf('async function _gdOpenInstallPicker');
    const pickerBlock = GAME_DETAILS_JS.slice(pickerStart, pickerStart + 1800);
    assert.match(pickerBlock, /p === 'gog'/);
    assert.doesNotMatch(pickerBlock, /p === 'epic' \|\| p === 'steam' \|\| p === 'gog'/);
    const queueStart = GAME_DETAILS_JS.indexOf('async function _gdQueueDirectDownload');
    const queueBlock = GAME_DETAILS_JS.slice(queueStart, queueStart + 3200);
    const selectPos = queueBlock.indexOf('const folderRes = await window.electronAPI.downloads.selectInstallDirectory');
    const queuePos = queueBlock.indexOf('const res = await window.electronAPI.downloads.queueInstall');
    assert.ok(selectPos !== -1, 'folder picker must be called for direct downloads');
    assert.ok(queuePos !== -1, 'queueInstall must be called after choosing a folder');
    assert.ok(selectPos < queuePos, 'folder picker must run before queueInstall');
});

test('GOG Game Details install picker requires a linked account', () => {
    const accountsStart = GAME_DETAILS_JS.indexOf('window.gdInstallLoadAccounts = async function');
    const accountsBlock = GAME_DETAILS_JS.slice(accountsStart, accountsStart + 4200);
    assert.match(accountsBlock, /const allowNoSwitchInstall = platKey !== 'gog'/);
    assert.match(accountsBlock, /const noSwitchRow = allowNoSwitchInstall \?/);
    assert.match(accountsBlock, /platKey === 'gog' && opt\.actionStatus === 'add_to_switcher' && opt\.syncAccountId/);
    assert.match(accountsBlock, /id:\s+String\(opt\.syncAccountId\)/);
    assert.match(accountsBlock, /const canUseAccountForInstall = \(o\) => allowNoSwitchInstall \? !o\.notInSwitcher : true/);
    assert.match(accountsBlock, /allowNoSwitchInstall \? '__none__' : null/);

    const queueStart = GAME_DETAILS_JS.indexOf('async function _gdQueueDirectDownload');
    const queueBlock = GAME_DETAILS_JS.slice(queueStart, queueStart + 2400);
    const guardPos = queueBlock.indexOf("platform === 'gog' && !resolvedAccountId");
    const selectPos = queueBlock.indexOf('const folderRes = await window.electronAPI.downloads.selectInstallDirectory');
    assert.ok(guardPos !== -1, 'GOG direct downloads must guard missing linked accounts');
    assert.ok(selectPos !== -1, 'direct downloads still need a folder picker');
    assert.ok(guardPos < selectPos, 'GOG linked-account guard must run before folder picker');
    assert.match(queueBlock, /accountId: resolvedAccountId \|\| `\$\{platform\}:default`/);
});

test('GOG Game Details install identity uses only verified GOG download ids or rich identity payload', () => {
    const identityStart = GAME_DETAILS_JS.indexOf('function _gdProviderInstallIdentity');
    const identityBlock = GAME_DETAILS_JS.slice(identityStart, identityStart + 1800);
    assert.match(identityBlock, /providerAppName: game\.appName \|\| game\.launcherGameId \|\| game\.allIds\?\.epic \|\| null/);
    assert.match(identityBlock, /providerProductId: game\.catalogItemId \|\| game\.namespace \|\| game\.allIds\?\.epic \|\| null/);
    const gogBranchStart = identityBlock.indexOf("if (platform === 'gog')");
    const gogBranch = identityBlock.slice(gogBranchStart, identityBlock.indexOf('return { providerAppName: null', gogBranchStart));
    assert.match(gogBranch, /game\.gogdlAppName/);
    assert.match(gogBranch, /game\.contentSystemProductId/);
    assert.match(gogBranch, /game\.gogProductId/);
    assert.doesNotMatch(gogBranch, /game\.productId/);
    assert.doesNotMatch(gogBranch, /game\.allIds\?\.gog/);
    assert.doesNotMatch(gogBranch, /game\.appName/);
    assert.doesNotMatch(gogBranch, /game\.canonicalGameId|game\.canonicalId|game\.id/);
    assert.match(gogBranch, /providerProductId: gogProductId/);

    const normalizeStart = GAME_DETAILS_JS.indexOf('function _gdNormalizeGogProductId');
    const normalizeBlock = GAME_DETAILS_JS.slice(normalizeStart, normalizeStart + 500);
    assert.match(normalizeBlock, /replace\(\/\^gog\[-_\]\/i/);
    assert.match(normalizeBlock, /\\d\+/);

    const queueStart = GAME_DETAILS_JS.indexOf('async function _gdQueueDirectDownload');
    const queueBlock = GAME_DETAILS_JS.slice(queueStart, queueStart + 2800);
    const identityPos = queueBlock.indexOf('const identity = _gdProviderInstallIdentity(platform, game)');
    const selectPos = queueBlock.indexOf('const folderRes = await window.electronAPI.downloads.selectInstallDirectory');
    assert.ok(identityPos !== -1 && selectPos !== -1 && identityPos < selectPos);
    assert.match(queueBlock, /const gogIdentity = platform === 'gog'/);
    assert.match(queueBlock, /gogIdentity,/);
    assert.match(queueBlock, /missing its GOG download identity/);
});

test('downloads cancel IPC accepts only boolean deletePartial and no renderer path', () => {
    assert.match(DOWNLOADS_JS, /window\.electronAPI\.downloads\.cancel\(\{ taskId, deletePartial: true \}\)/);
    assert.doesNotMatch(DOWNLOADS_JS, /deletePath|installPath\s*:/);
    assert.match(PRELOAD, /cancel:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('downloads:cancel', payload\)/);
    assert.match(fs.readFileSync('src/features/downloads/infrastructure/ipc/downloads.ipc.js', 'utf8'), /typeof payload\.deletePartial !== 'boolean'/);
    assert.match(fs.readFileSync('src/features/downloads/infrastructure/ipc/downloads.ipc.js', 'utf8'), /DOWNLOAD_INVALID_DELETE_PARTIAL/);
});
