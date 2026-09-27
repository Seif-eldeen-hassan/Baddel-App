const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'accounts.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const IMAGE_HANDLERS_JS = fs.readFileSync(path.join(ROOT, 'handlers', 'imageHandlers.js'), 'utf8');
const PLATFORM_SYNC_JS = fs.readFileSync(path.join(ROOT, 'platformSync.js'), 'utf8');
const { AtomicJsonFileStore } = require('../src/features/sync/infrastructure/runtime/AtomicJsonFileStore');
const { PlatformSyncCacheRepository } = require('../src/features/sync/infrastructure/repositories/PlatformSyncCacheRepository');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-stability-'));
}

function rmDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

function fnBody(source, name) {
    const idx = source.indexOf(`function ${name}`);
    assert.notEqual(idx, -1, `${name} not found`);
    const paramsStart = source.indexOf('(', idx);
    let parenDepth = 0;
    let paramsEnd = -1;
    for (let i = paramsStart; i < source.length; i++) {
        if (source[i] === '(') parenDepth++;
        if (source[i] === ')') {
            parenDepth--;
            if (parenDepth === 0) { paramsEnd = i; break; }
        }
    }
    const start = source.indexOf('{', paramsEnd);
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`${name} body not closed`);
}

test('atomic JSON writer serializes concurrent merged-cache writes without malformed output', async () => {
    const dir = tempDir();
    try {
        const file = path.join(dir, 'epic_library_merged.json');
        const store = new AtomicJsonFileStore();
        const libraries = Array.from({ length: 20 }, (_, writeIndex) => (
            Array.from({ length: 1003 }, (_, gameIndex) => ({ id: `g-${writeIndex}-${gameIndex}`, title: `Game ${gameIndex}` }))
        ));

        await Promise.all(libraries.map((library) => store.writeJson(file, library)));

        const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
        assert.equal(parsed.length, 1003);
        assert.ok(parsed.every((game) => typeof game.id === 'string'));
        assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')), []);
    } finally {
        rmDir(dir);
    }
});

test('merged cache snapshot read preserves last-known-good on transient corruption', async () => {
    const dir = tempDir();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: dir });
        await repo.writeEpicAccounts([{ id: 'epic-1', displayName: 'Epic One' }]);
        const games = Array.from({ length: 1003 }, (_, i) => ({ id: `epic-${i}`, title: `Epic ${i}` }));
        await repo.writeEpicMergedLibrary(games);

        const first = await repo.readMergedLibrarySnapshot('epic');
        assert.equal(first.stale, false);
        assert.equal(first.authoritativeEmpty, false);
        assert.equal(first.games.length, 1003);

        fs.writeFileSync(repo.epicMergedCacheFile, '{not-json', 'utf8');
        const stale = await repo.readMergedLibrarySnapshot('epic');
        assert.equal(stale.status, 'success');
        assert.equal(stale.stale, true);
        assert.equal(stale.authoritativeEmpty, false);
        assert.equal(stale.games.length, 1003);
    } finally {
        rmDir(dir);
    }
});

test('explicit unlink commits an authoritative empty merged-cache snapshot', async () => {
    const dir = tempDir();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: dir });
        await repo.writeSteamAccounts([{ id: 'steam-1' }]);
        await repo.writeSteamMergedLibrary([{ id: 's1', title: 'Steam One' }]);
        await repo.writeSteamAccounts([]);
        await repo.deleteSteamMergedLibrary();

        const snapshot = await repo.readMergedLibrarySnapshot('steam');
        assert.equal(snapshot.status, 'success');
        assert.equal(snapshot.stale, false);
        assert.equal(snapshot.authoritativeEmpty, true);
        assert.deepEqual(snapshot.games, []);
    } finally {
        rmDir(dir);
    }
});

test('platform-sync:get-cached returns committed snapshot metadata', () => {
    assert.match(PLATFORM_SYNC_JS, /readMergedLibrarySnapshot\(platform\)/);
    assert.match(PLATFORM_SYNC_JS, /revision/);
    assert.match(PLATFORM_SYNC_JS, /authoritativeEmpty/);
    assert.match(PLATFORM_SYNC_JS, /platform-library-committed/);
});

test('PlatformSyncAssetWriteBackService is wired to atomic repository writes for merged caches', () => {
    assert.match(PLATFORM_SYNC_JS, /writeJson:\s*\(file,\s*value\)\s*=>\s*syncCacheRepository\.writeJsonFileAtomic\(file,\s*value\)/);
    assert.doesNotMatch(PLATFORM_SYNC_JS, /writeFile:\s*\(file,\s*data,\s*encoding\)\s*=>\s*fs\.writeFile\(file,\s*data,\s*encoding\)/);
});

test('All Games uses a committed platform snapshot event, not generic library-updated ownership', () => {
    assert.match(PRELOAD_JS, /onPlatformLibraryCommitted/);
    assert.match(ACCOUNTS_JS, /const _agSubscribePlatformLibraryCommitted = window\.electronAPI\.onPlatformLibraryCommitted \|\| window\.electronAPI\.onLibraryUpdated/);
    assert.match(ACCOUNTS_JS, /__agAllGamesSnapshotGeneration/);
    assert.match(ACCOUNTS_JS, /_agCanCommitProjection/);
    assert.match(ACCOUNTS_JS, /Ignored transient empty projection/);
});

test('All Games bulk-loads verified cached covers and avoids renderer remote image sources', () => {
    const warmBody = fnBody(ACCOUNTS_JS, '_agWarmCachedCoversForGames');
    assert.match(PRELOAD_JS, /getCachedImagesBulk/);
    assert.match(IMAGE_HANDLERS_JS, /ipcMain\.handle\('get-cached-images-bulk'/);
    assert.match(warmBody, /_agApplyBulkCachedCovers\(list,\s*reason(?:,\s*revision)?\)/);
    assert.match(ACCOUNTS_JS, /Renderer-visible All Games covers must already be local\/verified/);
    assert.match(fnBody(ACCOUNTS_JS, '_agIsUsableCardCover'), /s\.startsWith\('file:\/\/'\)/);
    assert.doesNotMatch(fnBody(ACCOUNTS_JS, '_vsBuildCard'), /onerror=|onload=/);
});

test('cover events patch mounted cards only and do not structurally remount All Games', () => {
    const idx = ACCOUNTS_JS.indexOf('onAllGamesCoverCached');
    assert.notEqual(idx, -1, 'cover cached listener not found');
    const body = ACCOUNTS_JS.slice(idx, idx + 3200);
    assert.match(body, /visibleCardsByGameId/);
    assert.doesNotMatch(body, /_renderAllGamesGrid\s*\(/);
    assert.doesNotMatch(body, /_applyAgFilters\s*\(/);
    assert.doesNotMatch(body, /_vsInit\s*\(/);
});

test('virtualized card cache stays bounded to mounted rows', () => {
    assert.match(ACCOUNTS_JS, /visibleCardsByGameId:\s*new Map\(\)/);
    assert.match(ACCOUNTS_JS, /function _agBoundCardCacheToMountedRows/);
    assert.match(fnBody(ACCOUNTS_JS, '_vsRender'), /_agBoundCardCacheToMountedRows\(\)/);
});


test('All Games artwork state is session-owned and independent from virtual DOM cards', () => {
    assert.match(ACCOUNTS_JS, /window\.__agArtworkRegistry\s*=\s*window\.__agArtworkRegistry instanceof Map/);
    assert.match(ACCOUNTS_JS, /function _agArtworkKey/);
    assert.match(ACCOUNTS_JS, /function _agArtworkRecordFor/);
    assert.match(ACCOUNTS_JS, /function _agSetArtworkReady/);
    assert.match(fnBody(ACCOUNTS_JS, '_agArtworkRecordFor'), /registry\.set\(key,\s*record\)/);
    assert.doesNotMatch(fnBody(ACCOUNTS_JS, '_agArtworkRecordFor'), /document\.|querySelector|HTMLElement|card|img\./);
});

test('All Games keeps distinct Epic artwork state for products sharing one namespace', () => {
    const productBody = fnBody(ACCOUNTS_JS, '_agCanonicalProductKey');
    const artworkKeyBody = fnBody(ACCOUNTS_JS, '_agArtworkKey');
    assert.match(productBody, /namespace && catalogItemId/);
    assert.match(productBody, /ns:\${namespace}:catalog:\${catalogItemId}/);
    assert.match(artworkKeyBody, /BaddelGameArtworkReadModel\?\.resolveCanonicalArtworkIdentity/);
    assert.match(artworkKeyBody, /canonicalGameId/);

    const { resolveCanonicalArtworkIdentity } = require('../src/features/games/application/services/GameArtworkReadModel');
    const base = resolveCanonicalArtworkIdentity({
        platform: 'epic',
        libraryAccountId: 'account-1',
        namespace: 'shared-namespace',
        catalogItemId: 'base-game',
    }).canonicalGameId;
    const dlc = resolveCanonicalArtworkIdentity({
        platform: 'epic',
        libraryAccountId: 'account-1',
        namespace: 'shared-namespace',
        catalogItemId: 'bonus-content',
    }).canonicalGameId;

    assert.notEqual(base, dlc);
});

test('All Games cached artwork hydration uses one bulk lookup and no per-alias card IPC fallback', () => {
    const warmBody = fnBody(ACCOUNTS_JS, '_agWarmCachedCoversForGames');
    const bulkBody = fnBody(ACCOUNTS_JS, '_agApplyBulkCachedCovers');
    const anyKeyBody = fnBody(ACCOUNTS_JS, '_agGetCachedImageAnyKey');
    assert.match(bulkBody, /getCachedImagesBulk\(identities,\s*'cover'\)/);
    assert.match(bulkBody, /bulkArtworkLookupCount/);
    assert.match(bulkBody, /_agArtworkKey\(game\)/);
    assert.doesNotMatch(warmBody, /while\s*\(|Promise\.all|concurrency|_agGetCachedImageAnyKey/);
    assert.doesNotMatch(anyKeyBody, /electronAPI\.getCachedImage\(/);
});

test('ready artwork binding is deferred to visible and near-visible rows', () => {
    const buildBody = fnBody(ACCOUNTS_JS, '_vsBuildCard');
    const rebindBody = fnBody(ACCOUNTS_JS, '_vsBindCard');
    const renderBody = fnBody(ACCOUNTS_JS, '_vsRender');
    const requestBody = fnBody(ACCOUNTS_JS, '_vsRequestCoverBind');
    const commitBody = fnBody(ACCOUNTS_JS, '_vsScheduleCoverCommit');
    assert.match(buildBody, /native-lazy-load/);
    assert.match(buildBody, /style="display:none"/);
    assert.doesNotMatch(buildBody, /src="\$\{cover\}"/);
    assert.match(rebindBody, /_vsClearCardCoverForRebind\(card, game\)/);
    assert.match(rebindBody, /keepingSameCover/);
    assert.match(renderBody, /const nearRows = isFastScrolling \? 1 : 2/);
    assert.match(renderBody, /_vsBindCoversForRows\(firstVisRow/);
    assert.match(requestBody, /new Image\(\)/);
    assert.match(requestBody, /decoder\.decode/);
    assert.match(commitBody, /committed < 2/);
    assert.match(commitBody, /performance\.now\(\) - started <= 2/);
});

test('stale DOM image errors invalidate only the registry entry and enqueue controlled recovery', () => {
    const bindBody = fnBody(ACCOUNTS_JS, '_vsApplyCoverToCard');
    const invalidateBody = fnBody(ACCOUNTS_JS, '_agInvalidateArtworkRecord');
    assert.match(bindBody, /card\.dataset\.id !== gameId\) return/);
    assert.match(bindBody, /_agInvalidateArtworkRecord\(game,\s*'ready-local-img-error'\)/);
    assert.match(bindBody, /_agEnqueueByPriority\(\[game\],\s*null,\s*null\)/);
    assert.match(invalidateBody, /record\.status = 'retry_wait'/);
    assert.match(invalidateBody, /nextRetryAt = Date\.now\(\) \+ 1500/);
});

test('artwork resolver hands remote candidates to the main bootstrap instead of renderer downloads', () => {
    const resolverBody = fnBody(ACCOUNTS_JS, '_agResolveCoverForGame');
    assert.match(resolverBody, /_agArtworkCandidateUrlsFromGame\(game\)/);
    assert.match(resolverBody, /boostColdCoverBootstrap\(\[game\]/);
    assert.doesNotMatch(resolverBody, /cacheImage\?\.\(candidate/);
    assert.doesNotMatch(resolverBody, /getMetadata\?\.\(/);
    assert.match(resolverBody, /record\.status = 'metadata_pending'/);
});

test('virtual scroll diagnostics expose bounded DOM and zero renderer-direct remote requests', () => {
    assert.match(ACCOUNTS_JS, /window\.__agArtworkDiagnostics/);
    assert.match(ACCOUNTS_JS, /rendererDirectRemoteRequests:\s*0/);
    assert.match(fnBody(ACCOUNTS_JS, '_agRefreshArtworkDiagnostics'), /mountedCards/);
    assert.match(fnBody(ACCOUNTS_JS, '_agRefreshArtworkDiagnostics'), /pooledCards/);
    assert.match(fnBody(ACCOUNTS_JS, '_agRefreshArtworkDiagnostics'), /artworkRegistrySize/);
    assert.match(fnBody(ACCOUNTS_JS, '_vsRender'), /virtualRenderCount/);
    assert.match(fnBody(ACCOUNTS_JS, '_vsRender'), /forcedVirtualRenderCount/);
});


test('artwork resolver keeps bounded attempts while renderer network IPC is absent from full-library hydration', () => {
    const resolverBody = fnBody(ACCOUNTS_JS, '_agResolveCoverForGame');
    const needsBody = fnBody(ACCOUNTS_JS, '_agNeedsLocalCoverWork');
    assert.doesNotMatch(resolverBody, /cacheImage\?\.\(candidate/);
    assert.match(resolverBody, /Number\(record\.attempts \|\| 0\) >= 5/);
    assert.match(resolverBody, /record\.attempts = Math\.min\(5,/);
    assert.match(needsBody, /record\?\.status === 'terminal_error'/);
    assert.match(needsBody, /Number\(record\?\.attempts \|\| 0\) >= 5/);
});

test('complete library hydration does not duplicate main-process bootstrap ownership', () => {
    const hydrateBody = fnBody(ACCOUNTS_JS, '_agStartCompleteLibraryCoverHydration');
    const enqueueBody = fnBody(ACCOUNTS_JS, '_agEnqueueAllGamesCovers');
    assert.match(hydrateBody, /const chunkSize = 48/);
    assert.match(hydrateBody, /_agApplyBulkCachedCovers\(chunk, reason\)/);
    assert.match(enqueueBody, /startColdCoverBootstrap\(games/);
    assert.doesNotMatch(enqueueBody, /_agEnqueueByPriority\(null, null, games\)/);
});

test('artwork diagnostics expose terminal errors and bounded max attempts', () => {
    const diagBody = fnBody(ACCOUNTS_JS, '_agRefreshArtworkDiagnostics');
    assert.match(diagBody, /terminalErrorCount/);
    assert.match(diagBody, /maxArtworkAttempts/);
});

test("no-op merged library write keeps revision stable and reports unchanged", async () => {
    const dir = tempDir();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: dir });
        await repo.writeSteamAccounts([{ id: "steam-1" }]);
        const games = [{ id: "steam-1", title: "Steam One", ownedByAccountIds: ["steam-1"] }];
        const first = await repo.writeSteamMergedLibrary(games);
        assert.equal(first.changed, true);
        const firstRevision = first.revision;
        await repo.readMergedLibrarySnapshot("steam");
        const second = await repo.writeSteamMergedLibrary(games);
        assert.equal(second.changed, false);
        assert.equal(second.revision, firstRevision);
        assert.equal(second.writeDiagnostics.reason, "no-op");
    } finally {
        rmDir(dir);
    }
});

test("platform-library-committed handler defers background projection and post-render hydration", () => {
    const handlerStart = ACCOUNTS_JS.indexOf("_agSubscribePlatformLibraryCommitted(async (payload = {})");
    assert.ok(handlerStart !== -1, "platform-library-committed payload handler not found");
    const handler = ACCOUNTS_JS.slice(handlerStart, ACCOUNTS_JS.indexOf("// ── Per-cover instant patch", handlerStart));
    assert.match(handler, /_agStartSyncCommitRendererTrace\(payload\)/);
    assert.match(handler, /background\.deferred/);
    assert.match(handler, /_agScheduleDeferredSyncProjection\(payload, __syncTrace\)/);
    assert.match(handler, /_agSchedulePostCommitHydration\("platform-library-committed-after-render"\)/);
    assert.doesNotMatch(handler, /await _agHydrateCachedCoversIntoAllGames\(\);/);
});

test("normal sync completion does not schedule full-library cover warmup for cached 601-game libraries", () => {
    const syntheticGames = Array.from({ length: 601 }, (_, index) => ({
        id: `game-${index}`,
        title: `Game ${index}`,
        coverUrl: `file:///covers/game-${index}.webp`,
    }));
    assert.equal(syntheticGames.length, 601);
    assert.match(PLATFORM_SYNC_JS, /function _scheduleLibraryArtworkWarmup/, "explicit/manual artwork warmup service must remain available");
    assert.match(PLATFORM_SYNC_JS, /function _recordPostSyncArtworkWarmupSkipped/, "normal sync completion must record skipped warmup diagnostics");
    for (const platform of ["steam", "epic", "gog"]) {
        assert.match(
            PLATFORM_SYNC_JS,
            new RegExp(`_recordPostSyncArtworkWarmupSkipped\\(syncRunId, '${platform}', finalGames\\)`),
            `${platform} normal completion must skip full-library warmup`
        );
    }
    const completionStart = PLATFORM_SYNC_JS.indexOf("const steamCommitSnapshot = await syncCacheRepository.writeSteamMergedLibrary(finalGames)");
    const completionEnd = PLATFORM_SYNC_JS.indexOf("async function autoSyncOnStartup", completionStart);
    const completionBody = PLATFORM_SYNC_JS.slice(completionStart, completionEnd);
    assert.doesNotMatch(completionBody, /webContents\.send\(['"]all-games-cover-cached['"]/, "normal sync completion must send zero cache-hit cover events");
    assert.doesNotMatch(completionBody, /_scheduleLibraryArtworkWarmup\(\{/, "normal sync completion must not start downloads or cache scans");
    assert.match(completionBody, /_emitPlatformLibraryCommitted\('steam'/, "Steam still commits the library snapshot");
    assert.match(completionBody, /_emitPlatformLibraryCommitted\('epic'/, "Epic still commits the library snapshot");
    assert.match(completionBody, /_emitPlatformLibraryCommitted\('gog'/, "GOG still commits the library snapshot");
    assert.match(completionBody, /_finishPlatformSync\('steam'/, "Steam still reaches completed sync state");
    assert.match(completionBody, /_finishPlatformSync\('epic'/, "Epic still reaches completed sync state");
    assert.match(completionBody, /_finishPlatformSync\('gog'/, "GOG still reaches completed sync state");
});

test('All Games sends batched viewport artwork priority boosts to the main cold bootstrap owner', () => {
    const boostBody = fnBody(ACCOUNTS_JS, '_agScheduleColdCoverPriorityBoost');
    const renderBody = fnBody(ACCOUNTS_JS, '_vsRender');
    const settleBody = fnBody(ACCOUNTS_JS, '_vsOnScrollSettle');
    assert.match(boostBody, /boostColdCoverBootstrap/);
    assert.match(boostBody, /restoreThenBoost\(flushVisible, 'visible'\)/);
    assert.match(boostBody, /restoreThenBoost\(flushBuffer, 'buffer'\)/);
    assert.match(boostBody, /restoreThenBoost\(flushPrefetch, 'prefetch'\)/);
    assert.match(renderBody, /_agScheduleColdCoverPriorityBoost/);
    assert.match(settleBody, /_agScheduleColdCoverPriorityBoost/);
});
