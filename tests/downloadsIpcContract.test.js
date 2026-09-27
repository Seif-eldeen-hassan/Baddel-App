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
    assert.equal(CHANNELS.CHECK_UPDATE, 'downloads:check-update');
    assert.equal(CHANNELS.QUEUE_MAINTENANCE, 'downloads:queue-maintenance');
    assert.match(PRELOAD, /downloads:\s*{/);
    assert.match(PRELOAD, /startNow:\s*\(taskId\)\s*=>\s*ipcRenderer\.invoke\('downloads:start-now', taskId\)/);
    assert.match(PRELOAD, /checkUpdate:\s*\(taskId\)\s*=>\s*ipcRenderer\.invoke\('downloads:check-update', taskId\)/);
    assert.match(PRELOAD, /queueMaintenance:\s*\(taskId, operationKind\)\s*=>\s*ipcRenderer\.invoke\('downloads:queue-maintenance'/);
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
    assert.match(DASHBOARD, /Manage direct game installations from GOG and Epic/);
    assert.match(DASHBOARD, /css\/downloads\.css/);
    assert.match(DASHBOARD, /js\/downloads\.js/);
    assert.match(DOWNLOADS_JS, /window\.navigateToDownloads/);
    assert.match(DOWNLOADS_JS, /window\.electronAPI\.downloads\.startNow\(taskId\)/);
    assert.match(DOWNLOADS_JS, /No downloads yet/);
    assert.match(DOWNLOADS_JS, /Check for Updates/);
    assert.match(DOWNLOADS_JS, /Verify \/ Repair/);
    assert.match(DOWNLOADS_JS, /Games you install directly from GOG or Epic will appear here/);
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
    const cardBlock = DOWNLOADS_JS.slice(cardStart, cardStart + 5200);
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
    assert.match(DOWNLOADS_JS, /Network Transferred/);
    assert.match(DOWNLOADS_JS, /Game Files Written/);
    assert.match(DOWNLOADS_JS, /Disk Write Speed/);
    assert.match(DOWNLOADS_JS, /Free Space at Queue/);
    assert.match(DOWNLOADS_JS, /Required Space/);
    assert.match(DOWNLOADS_JS, /Safety Margin/);
    assert.doesNotMatch(DOWNLOADS_JS, /Delete Partial|downloadsDeletePartial/);
    assert.match(DOWNLOADS_JS, /downloadsUninstall/);
    const patchStart = DOWNLOADS_JS.indexOf('function patchDownloadTaskCard');
    const patchBlock = DOWNLOADS_JS.slice(patchStart, patchStart + 8000);
    assert.match(patchBlock, /const pct = getEffectiveTransferPercent\(task\)/);
    assert.match(patchBlock, /label\.textContent = pct === null \? dlUnknownProgressLabel\(task\) : `\$\{pct\.toFixed\(1\)\}%`/);
    assert.match(patchBlock, /fill\.style\.width = pct === null \? '35%' : `\$\{Math\.max\(0, Math\.min\(100, pct\)\)\}%`/);
    assert.match(patchBlock, /dlRenderSpeedChart\(task\)/);
    assert.match(patchBlock, /dlAdvancedDetails\(task(?:,\s*wasOpen)?\)/);
    assert.match(DOWNLOADS_JS, /dlDownloadedText\(task\)/);
});

test('GOG Game Details confirms a storage preview before queuing direct download', () => {
    const pickerStart = GAME_DETAILS_JS.indexOf('async function _gdOpenInstallPicker');
    const pickerBlock = GAME_DETAILS_JS.slice(pickerStart, pickerStart + 2400);
    assert.match(pickerBlock, /new Set\(\['epic', 'steam', 'gog'\]\)/);
    assert.match(GAME_DETAILS_JS, /targetPlatform === 'gog' && installProvider === 'gogdl'/);
    const queueStart = GAME_DETAILS_JS.indexOf('async function _gdQueueDirectDownload');
    const queueBlock = GAME_DETAILS_JS.slice(queueStart, queueStart + 3200);
    const selectPos = queueBlock.indexOf('const selected = await window.baddelInstallStorage?.confirmed()');
    const queuePos = queueBlock.indexOf('const res = await window.electronAPI.downloads.queueInstall');
    assert.ok(selectPos !== -1, 'folder picker must be called for direct downloads');
    assert.ok(queuePos !== -1, 'queueInstall must be called after choosing a folder');
    assert.ok(selectPos < queuePos, 'folder picker must run before queueInstall');
});

test('GOG Game Details routes managed owners directly and lets Galaxy launch without switching', () => {
    const accountsStart = GAME_DETAILS_JS.indexOf('window.gdInstallLoadAccounts = async function');
    const accountsBlock = GAME_DETAILS_JS.slice(accountsStart, GAME_DETAILS_JS.indexOf('window.gdInstallSelectAccount', accountsStart));
    assert.match(accountsBlock, /const allowNoSwitchInstall = platKey === 'steam' \|\| _gdInstallSelectedProvider === 'epic_launcher' \|\| _gdInstallSelectedProvider === 'gog_galaxy'/);
    assert.match(accountsBlock, /const noSwitchRow = allowNoSwitchInstall \?/);
    assert.match(accountsBlock, /buildManagedProviderAccountOptions\(\{ game, platform: 'gog', provider: 'gogdl' \}\)/);
    assert.match(accountsBlock, /buildPlatformAccountOptions\(\{ game, platform: platKey, mode: 'install' \}\)/);
    assert.match(accountsBlock, /\['legendary', 'gogdl'\]\.includes\(_gdInstallSelectedProvider\) \? o\.enabled === true/);
    assert.match(accountsBlock, /o\.enabled === true && o\.inSwitcher === true/);
    assert.match(accountsBlock, /allowNoSwitchInstall \? '__none__' : null/);

    const queueStart = GAME_DETAILS_JS.indexOf('async function _gdQueueDirectDownload');
    const queueBlock = GAME_DETAILS_JS.slice(queueStart, GAME_DETAILS_JS.indexOf('function _gdPickTrailerFallbackThumbnail', queueStart));
    const guardPos = queueBlock.indexOf("!accountId || accountId === '__none__'");
    const selectPos = queueBlock.indexOf('const selected = await window.baddelInstallStorage?.confirmed()');
    assert.ok(guardPos !== -1, 'GOG direct downloads must guard a missing synced owner');
    assert.ok(selectPos !== -1, 'direct downloads still need a folder picker');
    assert.ok(guardPos < selectPos, 'GOG synced-owner guard must run before folder picker');
    assert.match(GAME_DETAILS_JS, /accountId: resolvedAccountId/);
    assert.doesNotMatch(queueBlock, /accountId: resolvedAccountId \|\|/);
});

test('GOG Game Details install identity accepts only exact numeric provider/product ids', () => {
    const identityStart = GAME_DETAILS_JS.indexOf('function _gdProviderInstallIdentity');
    const identityBlock = GAME_DETAILS_JS.slice(identityStart, identityStart + 1800);
    assert.match(identityBlock, /providerAppName: game\.appName \|\| game\.launcherGameId \|\| game\.allIds\?\.epic \|\| null/);
    assert.match(identityBlock, /providerProductId: game\.catalogItemId \|\| game\.namespace \|\| game\.allIds\?\.epic \|\| null/);
    const gogBranchStart = identityBlock.indexOf("if (platform === 'gog')");
    const gogBranch = identityBlock.slice(gogBranchStart, identityBlock.indexOf('return { providerAppName: null', gogBranchStart));
    assert.match(gogBranch, /game\.gogdlAppName/);
    assert.match(gogBranch, /game\.contentSystemProductId/);
    assert.match(gogBranch, /game\.gogProductId/);
    assert.match(gogBranch, /game\.productId/);
    assert.match(gogBranch, /game\.providerProductId/);
    assert.match(gogBranch, /game\.allIds\?\.gog/);
    assert.doesNotMatch(gogBranch, /game\.appName/);
    assert.doesNotMatch(gogBranch, /game\.canonicalGameId|game\.canonicalId|game\.id/);
    assert.match(gogBranch, /providerProductId: gogProductId/);

    const normalizeStart = GAME_DETAILS_JS.indexOf('function _gdNormalizeGogProductId');
    const normalizeBlock = GAME_DETAILS_JS.slice(normalizeStart, normalizeStart + 500);
    assert.match(normalizeBlock, /replace\(\/\^gog\[-_\]\/i/);
    assert.match(normalizeBlock, /\\d\+/);

    const payloadStart = GAME_DETAILS_JS.indexOf('function _gdDirectInstallPayload');
    const payloadBlock = GAME_DETAILS_JS.slice(payloadStart, GAME_DETAILS_JS.indexOf('async function _gdQueueDirectDownload', payloadStart));
    assert.match(payloadBlock, /_gdProviderInstallIdentity\(platform, game\)/);
    assert.match(payloadBlock, /const gogIdentity = platform === 'gog'/);
    assert.match(payloadBlock, /gogIdentity,/);
    assert.match(GAME_DETAILS_JS, /installPlanId: selected.installPlanId/);
    const storage = fs.readFileSync('src/js/install-storage.js', 'utf8');
    assert.match(storage, /selectInstallDirectory\(\)/);
    assert.match(storage, /gdInstallBrowse/);
});

test('downloads UI has no partial-delete action while cancel IPC still validates its internal flag', () => {
    assert.doesNotMatch(DOWNLOADS_JS, /Delete Partial|downloadsDeletePartial|deletePartial:\s*true/);
    assert.doesNotMatch(DOWNLOADS_JS, /deletePath|installPath\s*:/);
    assert.match(PRELOAD, /cancel:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('downloads:cancel', payload\)/);
    assert.match(fs.readFileSync('src/features/downloads/infrastructure/ipc/downloads.ipc.js', 'utf8'), /typeof payload\.deletePartial !== 'boolean'/);
    assert.match(fs.readFileSync('src/features/downloads/infrastructure/ipc/downloads.ipc.js', 'utf8'), /DOWNLOAD_INVALID_DELETE_PARTIAL/);
});
