'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const CARD = read('src/js/app/game-card.js');
const CONTEXT = read('src/js/app/game-context-actions.js');
const DETAILS = read('src/js/game-details.js');
const DOWNLOADS = read('src/js/downloads.js');
const DASHBOARD = read('src/dashboard.html');
const CSS = read('src/css/dashboard.css');

test('cards render one lower-region update indicator without changing corner controls', () => {
    assert.match(CARD, /<div class="gc-info">\s*\$\{_gameCardUpdateIndicatorHtml\(game\)\}/);
    assert.match(CARD, /<div class="jbi-body">\s*\$\{_gameCardUpdateIndicatorHtml\(game, 'jbi-update-indicator'\)\}/);
    assert.match(CARD, /<div class="gc-platforms">\$\{badgesHTML\}\$\{overflowBadge\}<\/div>/);
    assert.match(CARD, /<button class="gc-fav-btn\$\{favActive\}"/);
    assert.match(CSS, /\.game-update-indicator\s*\{/);
    assert.doesNotMatch(CARD, /game-update-indicator[\s\S]{0,200}(three-dot|overflow-trigger)/i);
});

test('card update awareness is state-only and never performs provider work while rendering', () => {
    const helper = CARD.slice(CARD.indexOf('function _gameCardHasActionableUpdate'), CARD.indexOf('function _agResolvePlaytimeRecordForGame'));
    assert.match(helper, /__baddelGetManagedMaintenanceState/);
    assert.doesNotMatch(helper, /checkUpdate|queueMaintenance|electronAPI|fetch\s*\(/);
    assert.doesNotMatch(CARD, /REPAIR AVAILABLE/i);
});

test('existing right-click menu conditionally exposes managed maintenance actions', () => {
    assert.match(CONTEXT, /maintenanceState\?\.supportsUpdate === true && maintenanceState\.updateAvailable === true/);
    assert.match(CONTEXT, />Update<\/div>/);
    assert.match(CONTEXT, />Check for Updates<\/div>/);
    assert.match(CONTEXT, />Verify \/ Repair<\/div>/);
    assert.doesNotMatch(CONTEXT, /three-dot|overflow-trigger/i);
});

test('right-click maintenance stays explanatory while queued or running', () => {
    for (const label of ['Repair queued', 'Update queued', 'Verifying files', 'Repairing', 'Updating', 'View in Downloads']) {
        assert.match(CONTEXT + DOWNLOADS, new RegExp(label));
    }
    assert.match(CONTEXT, /maintenanceBusy[\s\S]*menu-item-status/);
    assert.match(CONTEXT, /menu-item-disabled[\s\S]*Uninstall/);
});

test('right-click update and repair navigate only through successful shared queue action', () => {
    const action = DOWNLOADS.slice(DOWNLOADS.indexOf('window.__baddelRunMaintenanceAction'), DOWNLOADS.indexOf('function dlFilterSize'));
    assert.ok(action.indexOf("result?.status !== 'success'") < action.indexOf('navigateToDownloads'));
    assert.match(action, /action !== 'check'/);
    assert.match(CONTEXT, /__baddelRunMaintenanceAction/);
});

test('Game Details keeps PLAY primary, visible Update when needed, and compact management gear', () => {
    const action = DASHBOARD.slice(DASHBOARD.indexOf('<div class="gd-action-block">'), DASHBOARD.indexOf('<div class="gd-download-block"'));
    assert.ok(action.indexOf('id="gdPlayBtn"') < action.indexOf('id="gdUpdateBtn"'));
    assert.ok(action.indexOf('id="gdUpdateBtn"') < action.indexOf('id="gdManagementBtn"'));
    assert.match(action, /id="gdUpdateBtn"[^>]*hidden>UPDATE/);
    assert.match(action, /id="gdManagementBtn"[^>]*data-menu-trigger/);
    assert.doesNotMatch(action, /id="gdRepairBtn"|VERIFY \/ REPAIR/);
    assert.doesNotMatch(action, /UNINSTALL|Up to date|three-dot/i);
    assert.match(DETAILS, /downloadTask\.operationKind !== 'update' && downloadTask\.operationKind !== 'repair'/);
});

test('Game Details gear owns secondary management without a standalone tracking or repair row', () => {
    assert.doesNotMatch(DASHBOARD, /id="gdTimeTrackingRow"|id="gdRepairBtn"/);
    const gear = DETAILS.slice(DETAILS.indexOf('function _gdRenderGameManagement'), DETAILS.indexOf('document.addEventListener', DETAILS.indexOf('function _gdRenderGameManagement')));
    for (const label of ['Time Tracking', 'Check for Updates', 'Verify / Repair', 'View in Downloads', 'Uninstall']) assert.match(gear, new RegExp(label.replace('/', '\\/')));
    assert.match(gear, /disabled: Boolean\(busy\)/);
    assert.match(DETAILS, /setTimeTrackingEnabled/);
    assert.match(DETAILS, /downloadsUninstall/);
});

test('one shared snapshot projection drives cards, details, context menu, and Downloads', () => {
    assert.match(DOWNLOADS, /managedInstallations/);
    assert.match(DOWNLOADS, /window\.__baddelGetManagedMaintenanceState = dlManagedStateForGame/);
    assert.match(DOWNLOADS, /baddel-maintenance-state-changed/);
    assert.match(DETAILS, /__baddelGetManagedMaintenanceState/);
    assert.match(CONTEXT, /__baddelGetManagedMaintenanceState/);
    assert.match(DOWNLOADS, /Completed · Update available/);
});

test('provider capabilities recover from the renderer-before-IPC startup race', () => {
    const refresh = DOWNLOADS.slice(DOWNLOADS.indexOf('function refreshDownloadCapabilities'), DOWNLOADS.indexOf('window.__baddelGetManagedMaintenanceState'));
    assert.match(refresh, /downloadsCapabilitiesPromise/);
    assert.match(refresh, /DOWNLOAD_CAPABILITY_PROVIDERS/);
    assert.match(refresh, /dlScheduleCapabilityRetry/);
    assert.match(DOWNLOADS, /Math\.min\(5000, 250 \* \(2 \*\* \(current\.attempts - 1\)\)\)/);
    assert.match(DOWNLOADS, /refreshDownloadCapabilities\(\{ resetUnavailable: true \}\)/);
});

test('Game Details maintenance uses the global queue and operation-aware progress labels', () => {
    assert.match(DETAILS, /__baddelRunMaintenanceAction/);
    assert.match(DETAILS, /UPDATE QUEUED/);
    assert.match(DETAILS, /UPDATING…/);
    assert.match(DETAILS, /VERIFYING FILES…/);
    assert.match(DETAILS, /REPAIRING FILES…/);
    assert.doesNotMatch(DETAILS, /gdUninstallBtn|gd-uninstall-btn/);
});

test('Game Details gear uses the shared menu portal instead of escaping hero overflow', () => {
    assert.match(DASHBOARD, /id="gdManagementMenuRoot"[^>]*data-menu-portal/);
    assert.match(read('src/js/baddel-menus.js'), /getBoundingClientRect\(\)/);
    assert.match(read('src/js/baddel-menus.js'), /document\.body\.appendChild\(menu\)/);
    assert.match(read('src/js/baddel-menus.js'), /roomBelow[\s\S]*roomAbove/);
    assert.match(read('src/css/game-details.css'), /\.baddel-menu-portal[\s\S]*position:\s*fixed/);
    assert.match(read('src/css/game-details.css'), /\.gd-hero\s*\{[\s\S]{0,160}overflow:\s*hidden/);
});

test('checking state replaces conflicting checks in both card context and Game Details gear', () => {
    assert.match(CONTEXT, /Checking for updates/);
    assert.match(DETAILS, /Checking for updates/);
    assert.match(DOWNLOADS, /checkingForUpdate/);
    assert.match(DOWNLOADS, /Checking for updates/);
});


test('maintenance presentation accepts a missing managed state during Game Details basic render', () => {
    const helper = DOWNLOADS.slice(DOWNLOADS.indexOf('function dlMaintenancePresentation'), DOWNLOADS.indexOf('function dlManagedIdentityValues'));
    assert.ok(helper.includes("state && typeof state === 'object' ? state : {}"));
    assert.doesNotMatch(helper, /const operation = state.operationKind/);
    assert.ok(DETAILS.includes('__baddelMaintenancePresentation?.(state)'));
});
