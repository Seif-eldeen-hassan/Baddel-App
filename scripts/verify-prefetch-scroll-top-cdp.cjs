'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const port = Number(process.argv.find(value => value.startsWith('--port='))?.split('=')[1] || 9223);
const out = path.resolve(process.argv.find(value => value.startsWith('--out='))?.slice(6) || 'docs/install-size-prefetch-scroll-top-live.json');
const screenshotOutArg = process.argv.find(value => value.startsWith('--screenshot='))?.slice(13);
const screenshotOut = screenshotOutArg ? path.resolve(screenshotOutArg) : null;
const screenshotOnly = process.argv.includes('--screenshot-only');

function getJson(url) {
    return new Promise((resolve, reject) => http.get(url, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on('error', reject));
}

async function main() {
    const targets = await getJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find(target => target.type === 'page' && /(?:dashboard|index)\.html/.test(target.url));
    if (!page) throw new Error('Dashboard target unavailable');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    };
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    await send('Runtime.enable');
    await send('Page.enable');
    if (screenshotOnly) {
        const state = await send('Runtime.evaluate', { expression: `(async () => { Promise.resolve(navigateToAllGames()).catch(() => {}); await new Promise(resolve => setTimeout(resolve, 2500)); setAgViewMode('grid'); const scroller = document.getElementById('mainContentArea'); scroller.scrollTop = Math.min(1800, scroller.scrollHeight - scroller.clientHeight); scroller.dispatchEvent(new Event('scroll')); await new Promise(resolve => requestAnimationFrame(resolve)); const button = document.getElementById('agBackToTop'); const style = getComputedStyle(button); return { scrollTop: scroller.scrollTop, buttonVisible: !button.hidden, route: currentView, readyOnly: window.agReadyOnly, rect: button.getBoundingClientRect().toJSON(), display: style.display, position: style.position, width: style.width, visibility: style.visibility, opacity: style.opacity, zIndex: style.zIndex, ancestors: Array.from(function* () { let node = button.parentElement; while (node) { yield { tag: node.tagName, id: node.id, className: node.className, display: getComputedStyle(node).display }; node = node.parentElement; } }()) }; })()`, awaitPromise: true, returnByValue: true });
        if (!screenshotOut) throw new Error('--screenshot-only requires --screenshot=PATH');
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(screenshotOut, Buffer.from(screenshot.data, 'base64'));
        fs.writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), screenshot: screenshotOut, rendererState: state.result.value }, null, 2));
        console.log(`BADDEL_PREFETCH_SCROLL_SCREENSHOT_WRITTEN ${screenshotOut}`);
        socket.close();
        return;
    }
    const expression = `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const until = async (predicate, timeoutMs) => {
            const deadline = performance.now() + timeoutMs;
            while (performance.now() < deadline) { const value = predicate(); if (value) return value; await wait(25); }
            throw new Error('Acceptance condition timed out');
        };
        await until(() => typeof window.navigateToAllGames === 'function', 30000);
        setAgViewMode('grid');
        await window.navigateToAllGames();
        await until(() => Array.isArray(window._allGamesCache) && window._allGamesCache.length, 60000);
        const api = window.electronAPI.downloads;
        window.__gdInstallSizePrefetchDiagnostics = [];
        const measureGame = async (platform, predicate) => {
            await navigateToAllGames();
            const game = window._allGamesCache.find(predicate);
            if (!game) return { platform, limitation: 'real candidate unavailable' };
            const installed = _gdInstalledRecordCanLaunch(game) || _gdInstalledRecordCanLaunch(_gdFindInstalledLocalMatch(game));
            const frames = [];
            let previous = null;
            let running = true;
            const frame = timestamp => { if (previous != null) frames.push(timestamp - previous); previous = timestamp; if (running) requestAnimationFrame(frame); };
            requestAnimationFrame(frame);
            const prefetchIndex = window.__gdInstallSizePrefetchDiagnostics.length;
            const t0 = performance.now();
            let openError = null;
            Promise.resolve(openGameDetails(game.id)).catch(error => { openError = { name: error?.name, message: error?.message, stack: error?.stack }; });
            try { await until(() => window.__gdInstallSizePrefetchDiagnostics[prefetchIndex], 8000); }
            catch {
                running = false;
                let accountOptions = [];
                try { accountOptions = platform === 'epic' ? await buildDirectEpicInstallAccountOptions({ game }) : await buildPlatformAccountOptions({ game, platform, mode: 'install' }); } catch (error) { accountOptions = [{ error: error?.message || String(error) }]; }
                return { platform, limitation: 'Game Details did not request prefetch', game: { id: game.id, title: game.title || game.name, installed },
                    detectedPlatforms: _gdDetectPlatforms(game), identity: _gdProviderInstallIdentity(platform, game),
                    detailsVisible: document.getElementById('gameDetailsView')?.style.display !== 'none', detailsTitle: document.getElementById('gdTitle')?.textContent || null,
                    prefetchApiPresent: typeof api.prefetchInstallSize === 'function', openFunctionHasPrefetch: String(window.openGameDetails).includes('_gdPrefetchDefaultInstallSize'), openError, selectionDiagnostics: window.__gdInstallSizePrefetchSelectionDiagnostics || [],
                    accountOptions: accountOptions.map(option => ({ id: option.id, syncAccountId: option.syncAccountId, actionStatus: option.actionStatus, enabled: option.enabled, ownsGame: option.ownsGame, error: option.error })) };
            }
            const request = window.__gdInstallSizePrefetchDiagnostics[prefetchIndex];
            await until(() => request.completedAt, 70000);
            running = false;
            const sorted = frames.slice().sort((a, b) => a - b);
            const percentile = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
            const storageStartedAt = performance.now();
            const storage = await api.resolveInstallPlan({ ...request.payload, installPath: 'E:\\\\Baddel Games\\\\Baddel prefetch acceptance ' + platform, installPlanRendererStartedAt: Date.now() });
            const storageCompletedAt = performance.now();
            return {
                platform,
                game: { id: game.id, title: game.title || game.name, installed },
                timeline: {
                    gameDetailsOpenedT0: t0,
                    prefetchIpcSentAfterMs: request.sentAt - t0,
                    authoritativeSizeReadyAfterMs: request.completedAt - t0,
                    prefetchDurationMs: request.completedAt - request.sentAt,
                    storageOpenedT1: storageStartedAt,
                    storagePlanDurationMs: storageCompletedAt - storageStartedAt,
                },
                identity: {
                    accountId: request.payload.accountId,
                    providerAppName: request.payload.providerAppName,
                    providerProductId: request.payload.providerProductId,
                    contentSystemProductId: request.payload.contentSystemProductId || request.payload.gogIdentity?.contentSystemProductId || null,
                    installProvider: request.payload.installProvider,
                },
                prefetch: request.result,
                storage: storage?.plan ? {
                    downloadSizeBytes: storage.plan.downloadSizeBytes,
                    installedDiskSizeBytes: storage.plan.installedDiskSizeBytes,
                    sizeSource: storage.plan.sizeSource,
                    freeSpaceBytes: storage.plan.freeSpaceBytes,
                    requiredSpaceBytes: storage.plan.requiredSpaceBytes,
                    diskSafetyMarginBytes: storage.plan.diskSafetyMarginBytes,
                    totalRequiredBytes: storage.plan.totalRequiredBytes,
                    enoughSpace: storage.plan.enoughSpace,
                    planIdPresent: Boolean(storage.plan.planId),
                    expiresAt: storage.plan.expiresAt,
                } : storage,
                responsiveness: { frameCount: frames.length, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: sorted.at(-1) || 0, over50Ms: frames.filter(value => value > 50).length },
            };
        };
        const epic = await measureGame('epic', game => game.appName === 'd86f9cb568014746a15f66025dcc5733');
        const gog = await measureGame('gog', game => String(game.id) === 'gog_1426240474');
        const measureRace = async () => {
            await navigateToAllGames();
            const game = window._allGamesCache.find(item => item.appName === '59aaa2432a784431b0bfdbb54f3554ee');
            if (!game) return { limitation: 'Epic race candidate unavailable' };
            const index = window.__gdInstallSizePrefetchDiagnostics.length;
            const t0 = performance.now();
            Promise.resolve(openGameDetails(game.id)).catch(() => {});
            const request = await until(() => window.__gdInstallSizePrefetchDiagnostics[index], 15000);
            const planStartedAt = performance.now();
            const planPromise = api.resolveInstallPlan({ ...request.payload, installPath: 'E:\\\\Baddel Games\\\\Baddel prefetch race acceptance', installPlanRendererStartedAt: Date.now() });
            await until(() => request.completedAt, 70000);
            const plan = await planPromise;
            return { gameId: game.id, prefetchSentAfterMs: request.sentAt - t0, foregroundJoinedAfterMs: planStartedAt - request.sentAt,
                totalRaceMs: performance.now() - t0, prefetch: request.result?.prefetch, plan: plan?.plan && { downloadSizeBytes: plan.plan.downloadSizeBytes,
                    installedDiskSizeBytes: plan.plan.installedDiskSizeBytes, sizeSource: plan.plan.sizeSource, planIdPresent: Boolean(plan.plan.planId) } };
        };
        const epicRace = await measureRace();

        const routeResults = [];
        for (const route of ['all', 'ready']) {
            for (const mode of ['grid', 'list']) {
                if (route === 'ready') await navigateToReadyToInstall(); else await navigateToAllGames();
                setAgViewMode(mode);
                await wait(100);
                const scroller = document.getElementById('mainContentArea');
                const beforeState = JSON.stringify({ agReadyOnly: window.agReadyOnly, state: window._agState, count: window._vs?.items?.length });
                let scrollPerformance = null;
                if (mode === 'grid') {
                    const intervals = [];
                    let previous = null;
                    const duration = 5000;
                    const travel = Math.min(Math.max(0, scroller.scrollHeight - scroller.clientHeight), scroller.clientHeight * 12);
                    const started = performance.now();
                    await new Promise(resolve => {
                        const frame = timestamp => {
                            if (previous !== null) intervals.push(timestamp - previous);
                            previous = timestamp;
                            const phase = Math.min(1, (timestamp - started) / duration);
                            const cycle = Math.min(1, (phase * 2) % 1 || (phase >= 1 ? 1 : 0));
                            scroller.scrollTop = travel * (cycle <= .5 ? cycle * 2 : 2 - cycle * 2);
                            if (phase >= 1) resolve(); else requestAnimationFrame(frame);
                        };
                        requestAnimationFrame(frame);
                    });
                    const sorted = intervals.slice().sort((a, b) => a - b);
                    const at = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
                    scrollPerformance = { frameCount: intervals.length, p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: sorted.at(-1) || 0 };
                }
                scroller.scrollTop = Math.min(1800, scroller.scrollHeight - scroller.clientHeight);
                scroller.dispatchEvent(new Event('scroll'));
                await new Promise(resolve => requestAnimationFrame(resolve));
                const button = document.getElementById('agBackToTop');
                const visibleBeforeClick = !button.hidden;
                button.click();
                await new Promise(resolve => requestAnimationFrame(resolve));
                routeResults.push({ route, mode, visibleBeforeClick, scrollTopAfter: scroller.scrollTop, hiddenAfter: button.hidden,
                    statePreserved: beforeState === JSON.stringify({ agReadyOnly: window.agReadyOnly, state: window._agState, count: window._vs?.items?.length }),
                    readyOnlyAfter: window.agReadyOnly, itemCount: window._vs?.items?.length || 0,
                    renderedCount: document.querySelectorAll('#allGamesGrid .game-card, #allGamesList .ag-list-row').length, scrollPerformance });
            }
        }
        const button = document.getElementById('agBackToTop');
        const scroller = document.getElementById('mainContentArea');
        let repeatedListenerAdds = 0;
        const originalAdd = scroller.addEventListener;
        scroller.addEventListener = function() { repeatedListenerAdds += 1; return originalAdd.apply(this, arguments); };
        for (let index = 0; index < 10; index += 1) window._agInitBackToTop();
        scroller.addEventListener = originalAdd;
        setAgViewMode('grid');
        await navigateToHome();
        window._agSyncBackToTopVisibility();
        const outsideRouteHidden = button.hidden;
        return { capturedAt: new Date().toISOString(), epic, gog, epicRace, scrollToTop: { routeResults, repeatedListenerAdds, outsideRouteHidden, boundMarker: button.dataset.bound } };
    })()`;
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 180000 });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    fs.writeFileSync(out, JSON.stringify(result.result.value, null, 2));
    if (screenshotOut) {
        await send('Runtime.evaluate', { expression: `(async () => { await navigateToAllGames(); setAgViewMode('grid'); const scroller = document.getElementById('mainContentArea'); scroller.scrollTop = Math.min(1800, scroller.scrollHeight - scroller.clientHeight); scroller.dispatchEvent(new Event('scroll')); await new Promise(resolve => requestAnimationFrame(resolve)); })()`, awaitPromise: true });
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(screenshotOut, Buffer.from(screenshot.data, 'base64'));
    }
    console.log(`BADDEL_PREFETCH_SCROLL_ACCEPTANCE_WRITTEN ${out}`);
    socket.close();
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
