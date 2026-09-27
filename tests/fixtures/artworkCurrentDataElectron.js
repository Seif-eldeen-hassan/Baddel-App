'use strict';

// Focused, sanitized Electron acceptance probe. It reads the current Baddel data,
// repairs only a temporary copy of its artwork cache, and never prints URLs, paths,
// account IDs, or complete records.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const ReadModel = require('../../src/features/games/application/services/GameArtworkReadModel');
const Schema = require('../../src/features/games/application/services/GameArtworkSchema');
const { ContentAddressedArtworkCache } = require('../../src/features/games/infrastructure/services/ContentAddressedArtworkCache');
const { ArtworkDownloadManager } = require('../../src/features/games/infrastructure/services/ArtworkDownloadManager');
const { ArtworkDownloadScheduler } = require('../../src/features/games/infrastructure/services/ArtworkDownloadScheduler');
const { ArtworkHttpClient } = require('../../src/features/games/infrastructure/services/ArtworkHttpClient');

const TARGET_NAMES = new Map([
    ['sanitarium', 'Sanitarium'],
    ['valorant', 'VALORANT'],
    ['detroit become human', 'Detroit: Become Human'],
    ['detroit: become human', 'Detroit: Become Human'],
]);

function shortHash(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

function sourceClass(value) {
    const text = String(value || '');
    if (!text) return 'none';
    if (/^file:/i.test(text)) return 'managed-file';
    if (/^https:/i.test(text)) return 'https';
    if (/^data:/i.test(text)) return 'embedded';
    return 'other';
}

function originalFor(game, type) {
    const item = game?.artworkState?.version === 2 ? game.artworkState[type] : null;
    const stateValue = item?.locked && item?.overrideValue ? item.overrideValue : item?.fallbackValue;
    return stateValue || Schema.readArtworkValue(game, type) || null;
}

function cacheHit(cache, keys, type) {
    for (const key of keys) {
        const hit = cache.lookupAlias({ canonicalGameId: key, type });
        if (hit?.fileUrl) return { ...hit, matchedAlias: key };
    }
    return null;
}

function sanitizedType(game, identity, type, hit, phase, result = null) {
    const original = originalFor(game, type);
    return {
        phase,
        game: TARGET_NAMES.get(String(game.name || game.title || '').toLowerCase()),
        identityHash: shortHash(identity.canonicalGameId),
        provider: identity.platform,
        type,
        aliasHash: hit ? shortHash(hit.matchedAlias) : null,
        assetHash: hit?.assetHash ? String(hit.assetHash).slice(0, 12) : null,
        cacheHit: Boolean(hit),
        manifestType: hit?.logicalTypes?.includes(type) ? type : null,
        sourceClass: sourceClass(original),
        representsSource: hit ? 'content-addressed-cache' : null,
        availability: hit ? 'available' : (original ? 'pending' : 'terminal-miss'),
        operation: result?.status || (hit ? 'restored' : 'not-acquired'),
    };
}

async function main() {
    const sourceUserData = process.env.BADDEL_CURRENT_USER_DATA || path.join(process.env.APPDATA || '', 'baddel-launcher-beta');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-art-current-data-'));
    const tempCache = path.join(tempRoot, 'artwork-cache-v2');
    const sourceCache = path.join(sourceUserData, 'artwork-cache-v2');
    if (!fs.existsSync(path.join(sourceUserData, 'games-db.json'))) throw new Error('Current Baddel games-db.json was not found.');
    if (fs.existsSync(sourceCache)) fs.cpSync(sourceCache, tempCache, { recursive: true });

    const records = JSON.parse(fs.readFileSync(path.join(sourceUserData, 'games-db.json'), 'utf8'));
    const games = records.filter(game => TARGET_NAMES.has(String(game.name || game.title || '').toLowerCase()));
    if (games.length < 2) throw new Error(`Expected at least two current-data targets, found ${games.length}.`);
    if (!games.some(game => /riot/i.test(String(game.platform || game.scannerPlatform || '')))) {
        throw new Error('Current-data targets did not include a Riot game.');
    }
    if (!games.some(game => /steam|epic/i.test(String(game.platform || game.scannerPlatform || '')))) {
        throw new Error('Current-data targets did not include a Steam or Epic game.');
    }

    const silent = { log() {}, warn() {}, error() {} };
    const cache = new ContentAddressedArtworkCache({ fs, path, crypto, baseDir: tempCache, logger: silent });
    const scheduler = new ArtworkDownloadScheduler({ worker: task => task.run(), concurrency: 2, logger: silent });
    const manager = new ArtworkDownloadManager({
        cache,
        scheduler,
        httpClient: new ArtworkHttpClient({ maxAttempts: 2, timeoutMs: 15000 }),
        logger: silent,
    });

    const before = [];
    const after = [];
    const rendererGames = [];
    for (const game of games) {
        const identity = ReadModel.resolveCanonicalArtworkIdentity(game);
        const keys = ReadModel.resolveArtworkCacheKeys(game, game);
        const local = {};
        for (const type of Schema.ARTWORK_TYPES) {
            let hit = cacheHit(cache, keys, type);
            before.push(sanitizedType(game, identity, type, hit, 'before'));
            const original = originalFor(game, type);
            // Sanitarium's scanner logo is intentionally not an authoritative logo;
            // Game Details already classifies this case as text-title fallback.
            const intentionalNoLogo = TARGET_NAMES.get(String(game.name).toLowerCase()) === 'Sanitarium' && type === 'logo';
            let result = null;
            if (!hit && original && /^https:/i.test(original) && !intentionalNoLogo) {
                result = await manager.requestAsset({
                    sourceUrl: original,
                    canonicalGameId: identity.canonicalGameId,
                    type,
                    priority: 'game-details',
                    reason: 'focused-current-data-acceptance',
                    sourceSubsystem: 'artwork-current-data-electron',
                });
                if (result.localUrl) {
                    const stored = cache.lookupFileUrl(result.localUrl, { type });
                    for (const key of keys) cache.linkAlias({ assetHash: stored.assetHash, canonicalGameId: key, type });
                }
                hit = cacheHit(cache, keys, type);
            }
            after.push(sanitizedType(game, identity, type, hit, 'after', result));
            if (hit) local[type] = hit.fileUrl;
        }
        rendererGames.push({ game, local });
    }

    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: false,
            sandbox: false,
            preload: path.join(__dirname, 'artworkCurrentDataPreload.js'),
        },
    });
    await win.loadFile(path.join(__dirname, '..', '..', 'src', 'dashboard.html'));
    const encoded = JSON.stringify(rendererGames).replace(/</g, '\\u003c');
    const runtime = await win.webContents.executeJavaScript(`(async () => {
        const input = ${encoded};
        window.__BADDEL_ARTWORK_DIAGNOSTICS__ = true;
        const h = value => {
            let x = 2166136261;
            for (const c of String(value || '')) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
            return (x >>> 0).toString(16).padStart(8, '0');
        };
        const decode = value => new Promise(resolve => {
            if (!value) return resolve(false);
            const image = new Image();
            const timer = setTimeout(() => resolve(false), 5000);
            image.onload = () => { clearTimeout(timer); resolve(image.naturalWidth > 0 && image.naturalHeight > 0); };
            image.onerror = () => { clearTimeout(timer); resolve(false); };
            image.src = value;
        });
        const results = [];
        for (const entry of input) {
            const game = { ...entry.game,
                __baddelResolvedLocalCover: entry.local.cover || null,
                __baddelResolvedLocalHero: entry.local.hero || null,
                __baddelResolvedLocalLogo: entry.local.logo || null,
                __baddelArtworkAvailability: {
                    cover: { state: entry.local.cover ? 'available' : (entry.game.artworkState?.cover?.fallbackValue ? 'pending' : 'terminal-miss') },
                    hero: { state: entry.local.hero ? 'available' : (entry.game.artworkState?.hero?.fallbackValue ? 'pending' : 'terminal-miss') },
                    logo: { state: entry.local.logo ? 'available' : ((String(entry.game.name).toLowerCase() === 'sanitarium') ? 'terminal-miss' : (entry.game.artworkState?.logo?.fallbackValue ? 'pending' : 'terminal-miss')) },
                },
            };
            const cacheArtwork = { cover: entry.local.cover || null, hero: entry.local.hero || null, logo: entry.local.logo || null };
            const model = window.BaddelGameArtworkReadModel.buildGameArtworkReadModel({ displayGame: game, canonicalGame: game, cacheArtwork });
            const card = window.BaddelHomeArtworkPresentation.selectCardArtwork(model);
            const home = window.BaddelHomeArtworkPresentation.selectHomeHeroArtwork(model);
            const details = window.BaddelGameDetailsArtworkAdapter.resolveGameDetailsArtwork({ game });
            results.push({
                game: String(game.name).replace('Detroit Become Human', 'Detroit: Become Human'),
                cardType: card.type,
                cardHash: h(card.value),
                homeHeroHash: h(home.background),
                homeLogoHash: h(home.logo),
                detailsCoverHash: h(details.cover.value),
                detailsHeroHash: h(details.hero.value),
                detailsLogoHash: h(details.logo.value),
                coverHeroDistinct: Boolean(card.value && home.background && card.value !== home.background),
                identicalPerType: card.value === details.cover.value && home.background === details.hero.value && home.logo === details.logo.value,
                decoded: {
                    cover: await decode(card.value), hero: await decode(home.background), logo: home.logo ? await decode(home.logo) : null,
                },
                availability: { cover: model.cover.availability, hero: model.hero.availability, logo: model.logo.availability },
                diagnosticsCount: (window.__baddelArtworkDiagnosticsEvents || []).length,
            });
        }
        return results;
    })()`);

    const report = { before, after, runtime };
    process.stdout.write(JSON.stringify(report));
    win.destroy();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    app.quit();
}

app.whenReady().then(main).catch(error => {
    process.stderr.write(String(error?.stack || error));
    app.exit(1);
});
