'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function arg(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        });
        request.on('error', reject);
        request.setTimeout(10_000, () => request.destroy(new Error(`Timeout for ${url}`)));
    });
}

async function evaluate(port, expression) {
    const targets = await getJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find(target => target.type === 'page' && /dashboard\.html|Baddel Launcher/i.test(String(target.title || '') + ' ' + String(target.url || '')))
        || targets.find(target => target.type === 'page')
        || targets[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('No Electron page target found');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
    };
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error('CDP websocket failed'));
    });
    try {
        await call('Runtime.enable');
        const result = await call('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            timeout: 120_000,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Renderer evaluation failed');
        return result.result.value;
    } finally {
        try { socket.close(); } catch {}
    }
}

const mode = arg('mode', 'all');
const expression = `
(async () => {
    const mode = ${JSON.stringify(mode)};
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitUntil = async (predicate, timeoutMs = 15000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try { if (predicate()) return true; } catch {}
            await wait(100);
        }
        return false;
    };
    if (mode === 'ready') {
        if (typeof window.navigateToReadyToInstall === 'function') await window.navigateToReadyToInstall();
    } else {
        window.agReadyOnly = false;
        if (typeof window.navigateToAllGames === 'function') await window.navigateToAllGames();
    }
    await waitUntil(() => !window._allGamesRendering, 20000);
    await wait(1500);

    const allGames = Array.isArray(window._allGamesCache) ? window._allGamesCache : [];
    const readyGames = typeof window.getCanonicalReadyToInstallGames === 'function'
        ? (window.getCanonicalReadyToInstallGames() || [])
        : (window.__readyToInstallState?.games || []);
    const rendered = Array.isArray(window._vs?.items) ? window._vs.items : [];
    const selected = mode === 'ready' ? readyGames : allGames;
    const identities = selected.map(game => {
        if (typeof _agBulkCoverIdentityForGame === 'function') return _agBulkCoverIdentityForGame(game);
        const key = String(game?.id || game?.appName || game?.title || '');
        return { key, ids: [key] };
    }).filter(identity => identity?.key);
    const bulk = window.electronAPI?.getCachedImagesBulk
        ? await window.electronAPI.getCachedImagesBulk(identities, 'cover').catch(error => ({ status: 'error', error: error?.message || String(error) }))
        : null;
    const results = Object.values(bulk?.results || {});

    const managed = value => typeof value === 'string' && value.startsWith('file://') && /artwork-cache-v2(?:%5C|[\\/])/i.test(value);
    const persistedCandidates = [];
    for (const game of selected) {
        for (const field of ['coverUrl', 'image', 'defaultImage']) {
            const value = game?.[field];
            if (managed(value)) persistedCandidates.push({ game: game.title || game.name || game.id, field, value });
        }
    }
    const uniquePersisted = [...new Map(persistedCandidates.map(item => [item.value, item])).values()];
    let persistedPhysicallyValid = 0;
    for (const item of uniquePersisted) {
        if (await window.electronAPI.probeLocalImage(item.value).catch(() => false)) persistedPhysicallyValid += 1;
    }

    const images = [...document.querySelectorAll('#allGamesGrid img.native-lazy-load, #allGamesList img.ag-list-thumb')];
    const imageRows = images.map(image => ({
        src: image.currentSrc || image.src || '',
        complete: image.complete === true,
        naturalWidth: Number(image.naturalWidth || 0),
        connected: image.isConnected === true,
    }));
    const localRows = imageRows.filter(row => row.src.startsWith('file://'));
    const remoteRows = imageRows.filter(row => /^https?:/i.test(row.src));
    const decodedRows = localRows.filter(row => row.complete && row.naturalWidth > 0);
    const brokenRows = localRows.filter(row => !row.complete || row.naturalWidth <= 0);
    const cards = [...document.querySelectorAll('#allGamesGrid .game-card, #allGamesList .ag-list-row')];
    const cardImages = cards.map(card => [...card.querySelectorAll('img')]);
    const decodedCards = cardImages.filter(rows => rows.some(image => {
        const src = image.currentSrc || image.src || '';
        return src.startsWith('file://') && image.complete === true && Number(image.naturalWidth || 0) > 0;
    }));
    const brokenCards = cardImages.filter(rows => rows.some(image => {
        const src = image.currentSrc || image.src || '';
        return src.startsWith('file://') && (!image.complete || Number(image.naturalWidth || 0) <= 0);
    }));
    const sourceCounts = {};
    for (const result of results) sourceCounts[result.source || result.missReason || 'unknown'] = (sourceCounts[result.source || result.missReason || 'unknown'] || 0) + 1;

    return {
        marker: 'BADDEL_COLD_START_ARTWORK_ACCEPTANCE',
        generatedAt: new Date().toISOString(),
        mode,
        currentView: typeof currentView === 'undefined' ? null : currentView,
        agReadyOnly: !!window.agReadyOnly,
        allGamesCount: allGames.length,
        readyToInstallCount: readyGames.length,
        renderedItemCount: rendered.length,
        registrySize: window.__agArtworkRegistry?.size || 0,
        verifiedUrlCount: window.__agVerifiedArtworkUrls?.size || 0,
        verifiedSetIsSet: window.__agVerifiedArtworkUrls instanceof Set,
        managedDetectorOnFirstBulkResult: typeof _agIsManagedArtworkCacheUrl === 'function'
            ? _agIsManagedArtworkCacheUrl(results.find(result => result?.fileUrl)?.fileUrl)
            : null,
        lastProductionBulkLookup: window.__agLastBulkArtworkLookup || null,
        registryStatusCounts: window.__agArtworkRegistry instanceof Map
            ? [...window.__agArtworkRegistry.values()].reduce((counts, record) => {
                const status = record?.status || 'unknown';
                counts[status] = (counts[status] || 0) + 1;
                return counts;
            }, {})
            : {},
        readyRegistryCount: window.__agArtworkRegistry instanceof Map
            ? [...window.__agArtworkRegistry.values()].filter(record => record?.status === 'ready').length
            : 0,
        managedGameCoverCount: selected.filter(game => managed(game?.coverUrl || game?.image || game?.defaultImage)).length,
        renderedManagedGameCoverCount: rendered.filter(game => managed(game?.coverUrl || game?.image || game?.defaultImage)).length,
        renderedVerifiedManagedGameCoverCount: rendered.filter(game => {
            const cover = game?.coverUrl || game?.image || game?.defaultImage;
            return managed(cover) && window.__agVerifiedArtworkUrls instanceof Set && window.__agVerifiedArtworkUrls.has(cover);
        }).length,
        verifiedManagedGameCoverCount: selected.filter(game => {
            const cover = game?.coverUrl || game?.image || game?.defaultImage;
            return managed(cover) && window.__agVerifiedArtworkUrls instanceof Set && window.__agVerifiedArtworkUrls.has(cover);
        }).length,
        bulk: {
            requested: identities.length,
            hits: results.filter(result => result.fileUrl).length,
            misses: results.filter(result => !result.fileUrl).length,
            backfilledAliases: Number(bulk?.backfilledAliases || 0),
            cacheGeneration: bulk?.cacheGeneration || null,
            sourceCounts,
        },
        persistedManagedPaths: uniquePersisted.length,
        persistedManagedPathsPhysicallyValid: persistedPhysicallyValid,
        mountedImages: imageRows.length,
        mountedLocalImages: localRows.length,
        mountedUniqueLocalUrls: new Set(localRows.map(row => row.src)).size,
        verifiedMountedLocalUrls: new Set(localRows.map(row => row.src).filter(src => window.__agVerifiedArtworkUrls?.has(src))).size,
        sampleMountedLocalUrls: [...new Set(localRows.map(row => row.src))].slice(0, 10),
        decodedVisibleCovers: decodedRows.length,
        brokenLocalImages: brokenRows.length,
        mountedCards: cards.length,
        decodedVisibleCards: decodedCards.length,
        brokenLocalCards: brokenCards.length,
        remoteRendererImages: remoteRows.length,
        sampleRequests: identities.slice(0, 5),
        sampleResults: results.slice(0, 5),
    };
})()`;

(async () => {
    const value = await evaluate(Number(arg('port', '9225')), expression);
    const output = path.resolve(arg('out', `cold-start-artwork-${mode}.json`));
    fs.writeFileSync(output, JSON.stringify(value, null, 2), 'utf8');
    console.log(`BADDEL_COLD_START_ARTWORK_ACCEPTANCE_WRITTEN ${output}`);
})().catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
});
