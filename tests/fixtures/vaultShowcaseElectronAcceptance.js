'use strict';

const { app, BrowserWindow, clipboard, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const sharp = require('sharp');
const { pathToFileURL } = require('url');
const { buildVaultShowcaseSnapshot, strongCanonicalKey } = require('../../src/js/vault-showcase-model');
const { VaultShowcaseExportService } = require('../../src/features/vault/infrastructure/services/VaultShowcaseExportService');
const { registerVaultShowcaseHandlers } = require('../../handlers/vaultShowcaseHandlers');

function aliasPart(value) {
    return String(value || 'unknown').trim().replace(/[^a-zA-Z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 128) || 'unknown';
}

function resolveCachedCover(game, index, manifest, assetDir) {
    const keys = [
        strongCanonicalKey(game, index), game.canonicalGameId, game.vaultCanonicalKey, game.id,
        game.appName, game.catalogItemId,
    ].filter(Boolean);
    for (const key of keys) {
        const alias = manifest.aliases?.[`${aliasPart(key)}:cover`];
        const asset = alias && manifest.assets?.[alias.assetHash];
        if (!asset?.fileName) continue;
        const file = path.join(assetDir, asset.fileName);
        if (fs.existsSync(file)) return pathToFileURL(file).href;
    }
    return null;
}

async function run() {
    await app.whenReady();
    const sourceUserData = process.env.BADDEL_ACCEPTANCE_USER_DATA;
    const outputPath = process.env.BADDEL_ACCEPTANCE_OUTPUT;
    if (!sourceUserData || !outputPath) throw new Error('Acceptance paths are required.');
    const vault = JSON.parse(fs.readFileSync(path.join(sourceUserData, 'platform-sync', 'epic_vault.json'), 'utf8'));
    const account = (vault.accounts || []).find((item) => Array.isArray(item.games) && item.games.length);
    if (!account) throw new Error('No committed Epic Vault account is available.');
    const cacheRoot = path.join(sourceUserData, 'artwork-cache-v2');
    const manifest = JSON.parse(fs.readFileSync(path.join(cacheRoot, 'manifest.json'), 'utf8'));
    let cacheHits = 0;
    const snapshot = buildVaultShowcaseSnapshot({
        account,
        generatedAt: new Date().toISOString(),
        resolveCover: (game) => {
            const cover = resolveCachedCover(game, 0, manifest, path.join(cacheRoot, 'assets'));
            if (cover) cacheHits += 1;
            return cover;
        },
    });
    const protectedRuntime = process.env.BADDEL_ACCEPTANCE_PROTECTED === '1';
    const runtimeRoot = path.join(__dirname, '..', '..');
    const serviceLogs = [];
    const service = new VaultShowcaseExportService({
        BrowserWindow,
        dialog: { showSaveDialog: async () => ({ canceled: false, filePath: outputPath }) },
        clipboard,
        nativeImage,
        sharp,
        exportPagePath: protectedRuntime ? path.join(runtimeRoot, '.protected-build', 'app', 'vault-export.html') : path.join(runtimeRoot, 'src', 'vault-export.html'),
        exportPreloadPath: protectedRuntime ? path.join(runtimeRoot, '.protected-build', 'app', 'vault-export-preload.bundle.cjs') : path.join(runtimeRoot, 'vault-export-preload.js'),
        trustedArtworkRoots: [cacheRoot],
        logger: { info: (...args) => { serviceLogs.push({ stage: args[1], detail: args[2] }); process.stderr.write(`${args.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join(' ')}\n`); } },
    });
    registerVaultShowcaseHandlers(ipcMain, { service });
    const progress = [];
    const result = await service.export(snapshot, { isDestroyed: () => false, send: (_channel, payload) => { progress.push(payload); process.stderr.write(`progress:${payload.stage}\n`); } });
    const metadata = await sharp(outputPath, { limitInputPixels: false }).metadata();
    const measured = serviceLogs.find((item) => item.stage === 'viewport_measured')?.detail?.renderer;
    const tileDiagnostics = serviceLogs.filter((item) => item.stage === 'tile_captured').map((item) => item.detail);
    const rawHashes = tileDiagnostics.map((tile) => tile.rawCapture.sha256);
    const normalizedHashes = tileDiagnostics.map((tile) => tile.normalizedTile.sha256);
    if (new Set(rawHashes).size !== rawHashes.length || new Set(normalizedHashes).size !== normalizedHashes.length) throw new Error('Acceptance detected duplicate tile content.');
    if (measured?.markers?.headerCount !== 1 || measured?.markers?.pricedHeadingCount !== 1 || measured?.markers?.priceUnavailableHeadingCount !== 1 || measured?.markers?.footerCount !== 1) throw new Error('Acceptance marker count failed.');
    if (measured.markers.countChipCount !== 4 || measured.markers.countChipLabels.join('|') !== 'Total Library|Priced|Free|Price Unavailable') throw new Error('Acceptance header count boxes failed.');
    const pricedGames = snapshot.sections[0].games;
    const priceUnavailableGames = snapshot.sections[1].games;
    if (snapshot.counts.included !== pricedGames.length + priceUnavailableGames.length || snapshot.counts.priceUnavailable !== priceUnavailableGames.length) throw new Error('Acceptance poster reconciliation failed.');
    const renderedSections = measured.markers.sectionPosterCounts;
    if (renderedSections.length !== 2
        || renderedSections[0].title !== 'Priced Games' || renderedSections[0].count !== pricedGames.length || renderedSections[0].firstIndex !== 0 || renderedSections[0].lastIndex !== pricedGames.length - 1
        || renderedSections[1].title !== 'Price Unavailable' || renderedSections[1].count !== priceUnavailableGames.length || renderedSections[1].firstIndex !== pricedGames.length || renderedSections[1].lastIndex !== snapshot.counts.included - 1) {
        throw new Error('Acceptance section order or poster range failed.');
    }
    if (priceUnavailableGames.some((game) => 'priceMinor' in game || 'priceCurrency' in game)) throw new Error('Acceptance found an invented price on a no-price game.');
    const alphabeticalNoPriceKeys = [...priceUnavailableGames].sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }) || left.key.localeCompare(right.key)).map((game) => game.key);
    if (priceUnavailableGames.some((game, index) => game.key !== alphabeticalNoPriceKeys[index])) throw new Error('Acceptance no-price sorting failed.');
    for (let index = 1; index < pricedGames.length; index += 1) if (pricedGames[index].priceMinor > pricedGames[index - 1].priceMinor) throw new Error('Acceptance priced sorting failed.');
    if (measured.markers.posterCount !== snapshot.counts.included || measured.markers.uniquePosterKeyCount !== snapshot.counts.included) throw new Error('Acceptance poster identity count failed.');
    if (!(measured.markers.footer.top > measured.markers.lastPosterBottom) || measured.markers.footer.bottom > metadata.height) throw new Error('Acceptance footer geometry failed.');
    for (let index = 1; index < measured.markers.posterRows.length; index += 1) {
        if (measured.markers.posterRows[index].top < measured.markers.posterRows[index - 1].bottom - 1) throw new Error('Acceptance poster rows overlap.');
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex').slice(0, 12);
    const report = {
        status: result.status,
        width: metadata.width,
        height: metadata.height,
        rawOwned: snapshot.counts.rawOwned,
        canonicalOwned: snapshot.counts.canonicalOwned,
        included: snapshot.counts.included,
        priced: snapshot.counts.priced,
        unresolved: snapshot.counts.unresolved,
        priceUnavailable: snapshot.counts.priceUnavailable,
        freeExcluded: snapshot.counts.freeExcluded,
        unavailableExcluded: snapshot.counts.unavailableExcluded,
        nonGameExcluded: snapshot.counts.nonGameExcluded,
        duplicatesRemoved: snapshot.counts.duplicatesRemoved,
        cachedPosters: cacheHits,
        tileCount: progress.filter((item) => item.stage === 'capturing').length,
        digest,
        markers: measured.markers,
        tileHashes: tileDiagnostics.map((tile) => ({ index: tile.tileIndex, offset: tile.plannedOffset, height: tile.plannedHeight, raw: tile.rawCapture.sha256.slice(0, 16), normalized: tile.normalizedTile.sha256.slice(0, 16) })),
        protectedRuntime,
        viewportMeasurement: serviceLogs.find((item) => item.stage === 'viewport_measured')?.detail || null,
        dimensions: serviceLogs.find((item) => item.stage === 'dimensions_calculated')?.detail || null,
        firstTile: serviceLogs.find((item) => item.stage === 'tile_captured')?.detail || null,
        composition: serviceLogs.find((item) => item.stage === 'sharp_composition_completed')?.detail || null,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    app.quit();
}

app.setPath('userData', path.join(os.tmpdir(), `baddel-vault-acceptance-${process.pid}`));
app.on('window-all-closed', () => {});

run().catch((error) => {
    process.stderr.write(`${error?.code || 'VAULT_EXPORT_ACCEPTANCE_FAILED'}: ${error?.message || error}\n`);
    app.exit(1);
});
