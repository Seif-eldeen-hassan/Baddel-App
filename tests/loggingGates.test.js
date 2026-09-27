'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('noisy metadata scanner and artwork diagnostics are gated behind BADDEL_VERBOSE_LOGS', () => {
    const baddelApi = read('services/baddelApi.js');
    const mrm = read('services/metadataResolutionManager.js');
    const backgroundPipeline = read('src/features/games/infrastructure/services/BackgroundMetadataPipeline.js');
    const scannerCore = read('src/features/games/infrastructure/scanner/GameScannerCore.js');
    const baddelEngine = read('src/features/games/infrastructure/legacy/BaddelEngine.js');
    const metadataHandlers = read('handlers/gameMetadataHandlers.js');
    const manualAdd = read('src/features/games/application/useCases/AddManualGameUseCase.js');
    const gamesContainer = read('src/features/games/infrastructure/composition/GamesContainer.js');
    const imageHandlers = read('handlers/imageHandlers.js');
    const artworkManager = read('src/features/games/infrastructure/services/ArtworkDownloadManager.js');
    const analytics = read('analytics.js');
    const platformSync = read('platformSync.js');

    for (const source of [
        baddelApi,
        mrm,
        backgroundPipeline,
        scannerCore,
        baddelEngine,
        metadataHandlers,
        manualAdd,
        gamesContainer,
        imageHandlers,
        artworkManager,
        analytics,
        platformSync,
    ]) {
        assert.match(source, /BADDEL_VERBOSE_LOGS/);
    }

    assert.match(baddelApi, /function _quietLog\(\.\.\.args\) \{ if \(VERBOSE_LOGS && !QUIET_LOGS\) console\.log\(\.\.\.args\); \}/);
    assert.match(mrm, /function verboseLog\(\.\.\.args\) \{ if \(VERBOSE_LOGS\) console\.log\(\.\.\.args\); \}/);
    assert.match(backgroundPipeline, /function verboseLog\(\.\.\.args\) \{ if \(VERBOSE_LOGS\) console\.log\(\.\.\.args\); \}/);
    assert.match(scannerCore, /function verboseLog\(\.\.\.args\) \{ if \(VERBOSE_LOGS\) console\.log\(\.\.\.args\); \}/);

    assert.doesNotMatch(scannerCore, /console\.log\(`\[Xbox Scan\] PREFILTER DROP/);
    assert.match(scannerCore, /verboseLog\(`\[Xbox Scan\] PREFILTER DROP/);
    assert.ok(!scannerCore.split(/\r?\n/).some(line => /console\.log\(.*`\[Xbox Scan\].*Summary/.test(line)));
    assert.match(scannerCore, /verboseLog\(\s*`\[Xbox Scan\] Summary/);

    assert.doesNotMatch(baddelEngine, /console\.log\(`\[GameScanner\] Summary/);
    assert.match(baddelEngine, /scannerLog\(`\[GameScanner\] Summary/);
    assert.doesNotMatch(baddelEngine, /console\.log\(`\[GameScanner\] Syncing/);
    assert.match(baddelEngine, /scannerLog\(`\[GameScanner\] Syncing/);
    assert.doesNotMatch(baddelEngine, /console\.warn\(`\[GameScanner\] Epic game/);
    assert.match(baddelEngine, /scannerWarnVerbose\(`\[GameScanner\] Epic game/);

    assert.doesNotMatch(mrm, /console\.log\(`\$\{TAG\} SKIP/);
    assert.match(mrm, /verboseLog\(`\$\{TAG\} SKIP/);
    assert.doesNotMatch(metadataHandlers, /console\.log\(`\[get-game-metadata\] MRM candidates/);
    assert.match(metadataHandlers, /verboseLog\(`\[get-game-metadata\] MRM candidates/);
    assert.doesNotMatch(manualAdd, /console\.log\(`\[Manual Add\] MRM candidates/);
    assert.match(manualAdd, /verboseLog\(`\[Manual Add\] MRM candidates/);
    assert.doesNotMatch(gamesContainer, /console\.log\('\[BackgroundMetaPipeline\] Local metadata resolver registered/);
    assert.match(gamesContainer, /verboseLog\('\[BackgroundMetaPipeline\] Local metadata resolver registered/);

    assert.doesNotMatch(baddelApi, /console\.log\(`\[BaddelAPI\] normalizeServerData/);
    assert.match(baddelApi, /_quietLog\(`\[BaddelAPI\] normalizeServerData/);
    assert.match(baddelApi, /_quietLog\('\[BaddelAPI\] importGames\(\) is deprecated/);
    assert.match(baddelApi, /if \(VERBOSE_LOGS \|\| s\.rateLimited > 0 \|\| s\.failed > 0\)/);

    assert.match(imageHandlers, /function coverDebugLog\(\.\.\.args\) \{ if \(VERBOSE_LOGS\) console\.log\(\.\.\.args\); \}/);
    assert.match(imageHandlers, /function coverDebugWarn\(\.\.\.args\) \{ if \(VERBOSE_LOGS\) console\.warn\(\.\.\.args\); \}/);
    assert.doesNotMatch(imageHandlers, /console\.(?:log|warn)\('\[CoverDebug:Main\]/);

    assert.match(platformSync, /verboseLog\('\[CoverDebug:Sync\]', msg, data\)/);
    assert.doesNotMatch(platformSync, /console\.log\('\[CoverDebug:Sync\]'/);
    assert.match(artworkManager, /if \(VERBOSE_LOGS\) \{\s*try \{ this\._logger\.warn\?\.\(`\[ArtworkDownloadManager\]/);

    assert.match(analytics, /function analyticsLog\(\.\.\.args\) \{ if \(VERBOSE_LOGS\) console\.log\(\.\.\.args\); \}/);
    assert.doesNotMatch(analytics, /console\.log\(`\[PostHog\] Sent/);
    assert.match(analytics, /analyticsLog\(`\[PostHog\] Sent/);
});

test('recoverable GOG store-product HTTP 400 misses are verbose-only', () => {
    const platformSync = read('platformSync.js');
    assert.match(platformSync, /err\?\.status === 400/);
    assert.match(platformSync, /Optional store product unavailable/);
    assert.match(platformSync, /optionalProductMisses/);
    assert.doesNotMatch(platformSync, /if \(err\?\.status === 400\)[\s\S]{0,220}syncWarn\(`\[GogSync\] Failed to fetch store product by external id/);
    assert.match(platformSync, /syncWarn\(`\[GogSync\] Failed to fetch store product by external id/);
});

test('temporary Epic region key-dump diagnostics are removed', () => {
    const platformSync = read('platformSync.js');
    assert.doesNotMatch(platformSync, /EPIC REGION TEST|END EPIC REGION TEST|\[EpicRegionTest\]|user\.json keys|status keys|region fields/);
    assert.match(platformSync, /verboseLog\(`\[Epic Region\] pricingCountry=\$\{pricingCountry\}`\)/);
});
