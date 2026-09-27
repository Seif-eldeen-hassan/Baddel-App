'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function getJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => req.destroy(new Error('CDP discovery timed out')));
    });
}

async function evaluate(expression, timeout = 600000) {
    const targets = await getJson('http://127.0.0.1:9224/json');
    const page = targets.find((target) => target.type === 'page' && /Baddel Launcher/i.test(`${target.title} ${target.url}`))
        || targets.find((target) => target.type === 'page');
    if (!page) throw new Error('Packaged Baddel page was not found.');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const callId = ++id;
        pending.set(callId, { resolve, reject });
        socket.send(JSON.stringify({ id: callId, method, params }));
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
        socket.onerror = () => reject(new Error('CDP WebSocket failed'));
    });
    try {
        await call('Runtime.enable');
        const response = await call('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            timeout,
        });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
        return response.result.value;
    } finally {
        socket.close();
    }
}

const expression = `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const capturedAt = new Date().toISOString();
    const accountsResult = await window.electronAPI.platformSyncGetAccounts('epic');
    const accounts = Array.isArray(accountsResult) ? accountsResult : (accountsResult?.accounts || []);
    const account = accounts[0];
    if (!account?.id) throw new Error('No linked Epic account is available for acceptance.');
    const accountId = String(account.id);
    const beforeVault = await window.electronAPI.platformSyncGetEpicVault();
    const beforeAccount = beforeVault?.vault?.accounts?.find((item) => String(item.accountId) === accountId) || null;
    const events = [];
    window.electronAPI.onPlatformLibraryCommitted((payload) => {
        if (payload?.platform === 'epic') events.push({ kind: 'library_committed', at: new Date().toISOString(), count: payload.games?.length || payload.count || null, syncRunId: payload.syncRunId || null });
    });
    window.electronAPI.onEpicSyncProgress((payload) => {
        if (String(payload?.accountId) === accountId) events.push({
            kind: 'progress', at: new Date().toISOString(), syncRunId: payload.syncRunId,
            overallStatus: payload.overallStatus, phase: payload.phase, phaseStatus: payload.phaseStatus,
            phases: payload.state?.phases || null,
        });
    });
    const startedAt = new Date().toISOString();
    const startResult = await window.electronAPI.platformSyncSync('epic', accountId, {
        epicSyncOptions: { games: true, currentPrices: true, purchaseHistory: true },
    });
    const deadline = Date.now() + 180000;
    while (!events.some((event) => event.kind === 'library_committed')) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for Epic library commit.');
        await wait(100);
    }
    const libraryCommittedAt = events.find((event) => event.kind === 'library_committed').at;
    const stateAtLibraryReady = await window.electronAPI.platformSyncGetEpicProgressState(accountId);
    const cachedAtLibraryReady = await window.electronAPI.platformSyncGetCached('epic');
    if (typeof window.navigateToAllGames === 'function') await window.navigateToAllGames({ preserveFilters: true });
    await wait(400);
    const allGamesAtLibraryReady = {
        cachedEpicGames: cachedAtLibraryReady?.games?.length || 0,
        renderedGames: Array.isArray(window._allGamesCache) ? window._allGamesCache.filter((game) => String(game.platform || '').toLowerCase() === 'epic' || game.platforms?.some?.((p) => String(p).toLowerCase() === 'epic')).length : 0,
        indicator: document.getElementById('epicEnrichmentIndicator')?.textContent || '',
        scrollTop: Number(document.getElementById('mainContentArea')?.scrollTop || 0),
    };
    if (typeof window.openVaultPlatform === 'function') window.openVaultPlatform('epic');
    await wait(600);
    if (typeof window.selectVaultEpicAccount === 'function') window.selectVaultEpicAccount(accountId);
    await wait(250);
    const vaultDuringEnrichment = {
        notice: document.querySelector('.vault-epic-detail .vault-history-notice')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        pendingPlaceholder: Boolean(document.querySelector('.vault-enrichment-placeholder')),
        accountVisible: Boolean(document.querySelector('[data-vault-account-id]')),
        financeText: document.querySelector('[data-vault-finance-grid]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    };
    const finalDeadline = Date.now() + 600000;
    let finalState = null;
    while (Date.now() < finalDeadline) {
        finalState = (await window.electronAPI.platformSyncGetEpicProgressState(accountId))?.state || null;
        if (finalState && ['complete', 'partial', 'failed'].includes(finalState.overallStatus)) break;
        await wait(500);
    }
    if (!finalState || !['complete', 'partial'].includes(finalState.overallStatus)) throw new Error('Epic optional phases did not reach complete or partial state.');
    await wait(500);
    const afterVault = await window.electronAPI.platformSyncGetEpicVault();
    const afterAccount = afterVault?.vault?.accounts?.find((item) => String(item.accountId) === accountId) || null;
    const finalEvent = [...events].reverse().find((event) => event.kind === 'progress' && ['complete', 'partial'].includes(event.overallStatus));
    return {
        result: 'success', capturedAt, application: 'dist/win-unpacked/Baddel Launcher Beta.exe',
        accountIdHashPrefix: accountId.slice(0, 6), accountDisplayName: account.displayName,
        startedAt, startResult, libraryCommittedAt,
        libraryReadyBeforeOptionalTerminal: events.some((event) => event.kind === 'library_committed')
            && !events.slice(0, events.findIndex((event) => event.kind === 'library_committed') + 1).some((event) => event.kind === 'progress' && ['complete', 'partial'].includes(event.overallStatus)),
        stateAtLibraryReady: stateAtLibraryReady?.state || null,
        allGamesAtLibraryReady,
        vaultDuringEnrichment,
        finalState,
        finalEvent,
        beforeVault: beforeAccount ? { fetchedAt: beforeAccount.purchaseHistoryFetchedAt || null, items: beforeAccount.purchaseHistoryItems?.length || 0, netSpentMinor: beforeAccount.netSpentMinor ?? null } : null,
        afterVault: afterAccount ? { fetchedAt: afterAccount.purchaseHistoryFetchedAt || null, items: afterAccount.purchaseHistoryItems?.length || 0, netSpentMinor: afterAccount.netSpentMinor ?? null } : null,
        events,
    };
})()`;

(async () => {
    const output = await evaluate(expression);
    const outputPath = path.join(process.cwd(), 'acceptance-epic-progressive.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`EPIC_PROGRESSIVE_ACCEPTANCE_WRITTEN ${outputPath}`);
})().catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
});
