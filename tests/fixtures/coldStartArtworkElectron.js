'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow } = require('electron');

const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-cold-start-electron-'));
app.setPath('userData', tempUserData);
process.env.BADDEL_TEST_USER_DATA = tempUserData;
process.env.BADDEL_DISABLE_STARTUP_SYNC = '1';
process.env.BADDEL_QUIET_LOGS = '1';

const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function sourceClass(value) {
    const text = String(value || '');
    if (!text) return 'none';
    if (/^file:/i.test(text)) return 'managed-file';
    if (/^https:/i.test(text)) return 'https';
    return 'other';
}

async function waitForWindow(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const window = BrowserWindow.getAllWindows().find(candidate => {
            if (candidate.isDestroyed()) return false;
            const url = String(candidate.webContents?.getURL?.() || '').toLowerCase();
            return url.includes('/src/dashboard.html') || url.includes('\\src\\dashboard.html');
        });
        if (window && !window.webContents.isLoading()) return window;
        await wait(100);
    }
    const windows = BrowserWindow.getAllWindows().filter(candidate => !candidate.isDestroyed()).map(candidate => ({
        id: candidate.id,
        url: String(candidate.webContents?.getURL?.() || '').replace(/[?#].*$/, ''),
    }));
    throw new Error(`Dashboard window did not become ready; windows=${JSON.stringify(windows)}.`);
}

async function rendererState(window) {
    return window.webContents.executeJavaScript(`(() => ({
        state: window.__baddelStartupLibrary?.state || null,
        metricState: window.__baddelStartupMetrics?.startupLibraryState || null,
        count: Array.isArray(window.allGamesData) ? window.allGamesData.length :
            (typeof allGamesData !== 'undefined' && Array.isArray(allGamesData) ? allGamesData.length : 0),
    }))()`);
}

async function waitForScan(window, timeoutMs = 90000) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let state = null;
    while (Date.now() < deadline) {
        state = await rendererState(window);
        const lifecycleState = state.state || state.metricState;
        if (state.count > 0 || ['ready-with-games', 'confirmed-empty', 'scan-failed'].includes(lifecycleState)) {
            return { ...state, durationMs: Date.now() - startedAt };
        }
        await wait(200);
    }
    throw new Error(`Installed-game scan did not settle; last state=${state?.state || 'unknown'}.`);
}

async function exerciseRenderer(window) {
    return window.webContents.executeJavaScript(`(async () => {
        window.__BADDEL_ARTWORK_DIAGNOSTICS__ = true;
        const games = typeof allGamesData !== 'undefined' && Array.isArray(allGamesData) ? allGamesData : [];
        const platformOf = game => String(game?.platform || game?.scannerPlatform || '').toLowerCase();
        const riot = games.find(game => platformOf(game).includes('riot')) || null;
        const store = games.find(game => /steam|epic/.test(platformOf(game))) || null;
        const targets = [riot, store].filter((game, index, all) => game && all.indexOf(game) === index);
        const summarize = game => ({
            name: String(game?.name || game?.title || 'Unknown').slice(0, 80),
            platform: platformOf(game),
            id: String(game?.localGameId || game?.id || ''),
            cover: game?.image || game?.defaultImage || game?.coverUrl || null,
            hero: game?.heroImage || game?.defaultHero || game?.heroUrl || null,
            logo: game?.logo || game?.defaultLogo || game?.logoUrl || null,
            availability: game?.__baddelArtworkAvailability || null,
        });
        const before = targets.map(summarize);
        for (const game of targets) {
            await updateHeroSection(game.id, { immediate: true, reason: 'cold-start-electron-acceptance' });
            await _suggHydrateArt(game, 'cold-start-visible-' + String(game.id), false);
            await _rtia_hydrateAll([game]);
        }
        if (targets[0]) {
            await openGameDetails(targets[0].id);
        }
        const artworkSettled = game => [
            ['cover', game?.image || game?.defaultImage || game?.coverUrl],
            ['hero', game?.heroImage || game?.defaultHero || game?.heroUrl],
            ['logo', game?.logo || game?.defaultLogo || game?.logoUrl],
        ].every(([type, value]) =>
            String(value || '').startsWith('file:') ||
            game?.__baddelArtworkAvailability?.[type]?.state === 'terminal-miss'
        );
        const currentTarget = original => {
            const id = String(original?.id || '');
            return (typeof allGamesData !== 'undefined' && Array.isArray(allGamesData)
                ? allGamesData.find(candidate => String(candidate?.id || '') === id)
                : null) || original;
        };
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline && targets.some(game => !artworkSettled(currentTarget(game)))) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const settledTargets = targets.map(currentTarget);
        const pendingArtwork = settledTargets.map((game, index) => ({
            game,
            original: targets[index],
        })).filter(({ game }) => !artworkSettled(game)).map(({ game, original }) => ({
            id: String(game?.id || original?.id || ''),
            fields: summarize(game),
            originalFields: summarize(original),
        }));
        const falseRemoteAvailable = pendingArtwork.filter(entry =>
            ['cover', 'hero', 'logo'].some(type =>
                /^https?:/i.test(String(entry.fields[type] || entry.originalFields[type] || '')) &&
                (
                    entry.fields.availability?.[type]?.state === 'available' ||
                    entry.originalFields.availability?.[type]?.state === 'available'
                )
            )
        );
        if (falseRemoteAvailable.length) {
            throw new Error('Remote artwork remained without a managed cache commit: ' + JSON.stringify(falseRemoteAvailable));
        }
        const after = settledTargets.map(summarize);
        const diagnostics = (window.__baddelArtworkDiagnosticsEvents || []).map(entry => ({
            event: entry.event || entry.name || entry.stage || 'unknown',
            type: entry.type || entry.payload?.type || null,
            reason: entry.reason || entry.payload?.reason || null,
            availability: entry.availability || entry.payload?.availability || null,
        })).slice(-120);
        const detailsView = document.getElementById('gameDetailsView');
        return {
            before,
            after,
            pendingArtwork,
            diagnostics,
            detailsOpen: !!detailsView && getComputedStyle(detailsView).display !== 'none',
        };
    })()`);
}

require('../../main');

app.whenReady().then(async () => {
    let window;
    try {
        window = await waitForWindow();
        const scan = await waitForScan(window);
        const renderer = await exerciseRenderer(window);
        const sanitize = game => ({
            name: game.name,
            platform: game.platform,
            identityHash: hash(game.id),
            cover: sourceClass(game.cover),
            hero: sourceClass(game.hero),
            logo: sourceClass(game.logo),
            availability: game.availability,
        });
        process.stdout.write('COLD_START_ARTWORK_RESULT ' + JSON.stringify({
            userDataHash: hash(tempUserData),
            startedEmpty: true,
            scan,
            before: renderer.before.map(sanitize),
            after: renderer.after.map(sanitize),
            pendingArtwork: renderer.pendingArtwork.map(entry => ({
                identityHash: hash(entry.id),
                current: sanitize(entry.fields),
                original: sanitize(entry.originalFields),
            })),
            detailsOpen: renderer.detailsOpen,
            diagnostics: renderer.diagnostics,
        }) + '\n');
        window.destroy();
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error?.stack || error) + '\n');
        try { window?.destroy(); } catch {}
        app.exit(1);
    }
});
