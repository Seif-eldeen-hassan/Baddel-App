'use strict';

const http = require('node:http');
const fs = require('node:fs');

function arg(name, fallback = '') {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        });
        request.on('error', reject);
        request.setTimeout(10_000, () => request.destroy(new Error('CDP discovery timeout')));
    });
}

async function evaluate(expression) {
    const port = Number(arg('port', '9226'));
    const targets = await getJson(`http://127.0.0.1:${port}/json`);
    const mainInspector = arg('mode') === 'main-quit';
    const page = mainInspector
        ? targets.find(item => item.webSocketDebuggerUrl)
        : targets.find(item => item.type === 'page' && /dashboard\.html|Baddel Launcher/i.test(`${item.title} ${item.url}`));
    if (!page?.webSocketDebuggerUrl) throw new Error('Baddel dashboard CDP target not found');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const runtimeErrors = [];
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') {
            runtimeErrors.push(message.params?.exceptionDetails || message.params || message);
        }
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
    };
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    try {
        await call('Runtime.enable');
        if (arg('mode') === 'reload-errors') {
            await call('Page.enable');
            await call('Page.reload', { ignoreCache: true });
            await new Promise(resolve => setTimeout(resolve, 5000));
            return runtimeErrors.map(item => ({
                text: item.text || null,
                url: item.url || null,
                lineNumber: item.lineNumber ?? null,
                columnNumber: item.columnNumber ?? null,
                description: item.exception?.description || null,
            }));
        }
        const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120_000 });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        const screenshotPath = arg('screenshot');
        if (screenshotPath) {
            await call('Page.enable');
            const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
            fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
        }
        return result.result.value;
    } finally {
        socket.close();
    }
}

const mode = arg('mode', 'snapshot');
const taskId = arg('task');
const expression = mode === 'queue' ? `(async () => window.electronAPI.downloads.queueInstall(${JSON.stringify({
    gameId: `gog_${arg('product')}`,
    canonicalGameId: `gog_${arg('product')}`,
    title: arg('title'),
    platform: 'gog',
    installProvider: 'gogdl',
    accountId: arg('account'),
    accountDisplayName: 'GOG account',
    providerProductId: arg('product'),
    providerAppName: arg('product'),
    gogIdentity: { galaxyExternalId: arg('product'), gamesDbExternalId: arg('product'), identitySource: 'acceptance-owned-cache' },
    installPath: arg('path'),
    downloadSizeBytes: Number(arg('download-bytes')),
    installedDiskSizeBytes: Number(arg('installed-bytes')),
})}))()` : mode === 'main-quit' ? `(() => { process.getBuiltinModule('module')._load('electron').app.quit(); return {status:'quit-requested'}; })()`
    : mode === 'ui-check-ux' ? `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const snapshotResult = await window.electronAPI.downloads.getSnapshot();
        const record = (snapshotResult?.snapshot?.managedInstallations || []).find(item =>
            item.status === 'completed' && (item.platform === 'gog' || item.platform === 'epic'));
        const game = record && (window.allGamesData || []).find(item => String(item.id) === String(record.installedGameId));
        if (!record || !game) return { status: 'unavailable', managedCount: snapshotResult?.snapshot?.managedInstallations?.length || 0, gameFound: Boolean(game) };
        await window.openGameDetails(game.id);
        let checkButton = null;
        for (let i = 0; i < 40 && !checkButton; i += 1) {
            document.getElementById('gdManagementBtn').click();
            checkButton = document.querySelector('#gdManagementMenu [data-gd-management-action="check"]');
            if (!checkButton) { window.baddelMenus?.close(); await wait(100); }
        }
        if (!checkButton) return { status: 'unavailable', reason: 'check-control-unavailable', state: window.__baddelGetManagedMaintenanceState?.(game) };
        checkButton.click();
        const immediateState = window.__baddelGetManagedMaintenanceState?.(game);
        const immediateToast = [...document.querySelectorAll('.toast-notification')].at(-1)?.innerText || '';
        window.showContextMenu(24, 24, game.id, game.name || game.title);
        const immediateContext = document.getElementById('contextMenu')?.innerText || '';
        window.hideContextMenu();
        document.getElementById('gdManagementBtn').click();
        const immediateGear = document.getElementById('gdManagementMenu')?.innerText || '';
        const immediateGearDisabled = Boolean(document.querySelector('#gdManagementMenu [data-gd-management-action="maintenance-status"]:disabled'));
        window.baddelMenus?.close();
        const deadline = Date.now() + 120000;
        while (window.__baddelGetManagedMaintenanceState?.(game)?.checkingForUpdate && Date.now() < deadline) await wait(100);
        await wait(50);
        const finalState = window.__baddelGetManagedMaintenanceState?.(game);
        const finalToast = [...document.querySelectorAll('.toast-notification')].at(-1)?.innerText || '';
        document.getElementById('gdManagementBtn').click();
        return {
            status: finalState?.checkingForUpdate ? 'timeout' : 'success',
            gameId: game.id,
            platform: record.platform,
            immediate: { checkingForUpdate: immediateState?.checkingForUpdate, toast: immediateToast, context: immediateContext, gear: immediateGear, gearDisabled: immediateGearDisabled },
            final: { updateAvailable: finalState?.updateAvailable, toast: finalToast, gear: document.getElementById('gdManagementMenu')?.innerText || '', updateHidden: document.getElementById('gdUpdateBtn')?.hidden, maintenanceStatus: document.getElementById('gdMaintenanceStatus')?.innerText || '' },
        };
    })()`
    : mode === 'ui-maintenance-smoke' ? `(async () => {
        const requestedWidth = ${Number(arg('width', '0'))};
        const requestedHeight = ${Number(arg('height', '0'))};
        if (requestedWidth > 0 && requestedHeight > 0) {
            window.electronAPI?.maximizeApp?.();
            await new Promise(resolve => setTimeout(resolve, 150));
            window.resizeTo(requestedWidth, requestedHeight);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        const snapshotResult = await window.electronAPI.downloads.getSnapshot();
        const managed = snapshotResult?.snapshot?.managedInstallations || [];
        const record = managed.find(item => item.installedGameId) || null;
        const game = record && (window.allGamesData || []).find(item => String(item.id) === String(record.installedGameId));
        if (!record || !game) return { status: 'unavailable', managedCount: managed.length, gameFound: Boolean(game) };
        const original = window.__baddelGetManagedMaintenanceState;
        let fixtureState = { ...record, supportsUpdate: true, supportsRepair: true, updateAvailable: true, isMaintenanceActive: false };
        window.__baddelGetManagedMaintenanceState = candidate => String(candidate?.id) === String(game.id) ? fixtureState : original?.(candidate);
        const contextRows = () => {
            window.showContextMenu(20, 20, game.id, game.name || game.title);
            const rows = [...document.getElementById('contextMenu').children].map(item => item.tagName === 'HR' ? '---' : item.innerText.trim()).filter(Boolean);
            window.hideContextMenu();
            return rows;
        };
        const contextStates = { idle: contextRows() };
        fixtureState = { ...fixtureState, checkingForUpdate: true };
        contextStates.checking = contextRows();
        fixtureState = { ...fixtureState, checkingForUpdate: false, status: 'pending', operationKind: 'repair', maintenancePresentation: { operation: 'repair', phase: 'queued', label: 'Repair queued' } };
        contextStates.repairQueued = contextRows();
        fixtureState = { ...fixtureState, status: 'verifying', operationKind: 'repair', maintenancePresentation: { operation: 'repair', phase: 'running', label: 'Verifying files\u2026' } };
        contextStates.repairRunning = contextRows();
        fixtureState = { ...fixtureState, status: 'pending', operationKind: 'update', maintenancePresentation: { operation: 'update', phase: 'queued', label: 'Update queued' } };
        contextStates.updateQueued = contextRows();
        fixtureState = { ...fixtureState, status: 'downloading', operationKind: 'update', maintenancePresentation: { operation: 'update', phase: 'running', label: 'Updating\u2026' } };
        contextStates.updateRunning = contextRows();
        fixtureState = { ...record, supportsUpdate: true, supportsRepair: true, updateAvailable: true, isMaintenanceActive: false };
        const standard = window.createGameCard(game, false, { artworkSurface: 'explore' });
        const recent = window.createRecentCard(game, false);
        await window.openGameDetails(game.id);
        await new Promise(resolve => setTimeout(resolve, 300));
        window.baddelMenus?.close();
        document.getElementById('gdManagementBtn').click();
        const gearMenu = document.getElementById('gdManagementMenu');
        const gearRect = gearMenu.getBoundingClientRect();
        const hero = document.getElementById('gdHero');
        const gearGeometry = {
            portaledToBody: gearMenu.parentElement === document.body,
            outsideHero: !hero.contains(gearMenu),
            position: getComputedStyle(gearMenu).position,
            fullyInViewport: gearRect.left >= 0 && gearRect.top >= 0 && gearRect.right <= innerWidth && gearRect.bottom <= innerHeight,
            rect: { left: gearRect.left, top: gearRect.top, right: gearRect.right, bottom: gearRect.bottom },
            viewport: { width: innerWidth, height: innerHeight },
        };
        window.showContextMenu(20, 20, game.id, game.name || game.title);
        const menuText = document.getElementById('contextMenu')?.innerText || '';
        const result = {
            status: 'success',
            gameId: game.id,
            standard: {
                updateVisible: !standard.querySelector('.game-update-indicator')?.hidden,
                favoritePresent: Boolean(standard.querySelector('.gc-fav-btn')),
                platformPresent: Boolean(standard.querySelector('.gc-platforms')),
                overflowControlPresent: Boolean(standard.querySelector('.download-overflow-trigger, [aria-label*="More actions"]')),
            },
            recent: {
                updateVisible: !recent.querySelector('.game-update-indicator')?.hidden,
                indicatorInsideBody: Boolean(recent.querySelector('.jbi-body > .game-update-indicator')),
                extraActionPresent: Boolean(recent.querySelector('[data-maintenance-action]')),
            },
            details: {
                playVisible: getComputedStyle(document.getElementById('gdPlayBtn')).display !== 'none',
                updateVisible: !document.getElementById('gdUpdateBtn').hidden,
                gearVisible: !document.getElementById('gdManagementMenuRoot').hidden,
                gearText: document.getElementById('gdManagementMenu').innerText,
                gearGeometry,
                status: document.getElementById('gdMaintenanceStatus').textContent,
                uninstallButtonPresent: Boolean(document.querySelector('#gameDetailsView #gdUninstallBtn, #gameDetailsView .gd-uninstall-btn')),
            },
            context: {
                update: menuText.includes('Update'),
                repair: menuText.includes('Verify / Repair'),
                threeDotControlPresent: Boolean(document.querySelector('#contextMenu [aria-label*="More actions"], #contextMenu .download-overflow-trigger')),
                states: contextStates,
            },
        };
        window.hideContextMenu();
        window.__baddelGetManagedMaintenanceState = original;
        window.dispatchEvent(new CustomEvent('baddel-maintenance-state-changed'));
        return result;
    })()`
    : mode === 'ui-repair' ? `(async () => {
        const wantedTaskId = ${JSON.stringify(taskId)};
        const initial = await window.electronAPI.downloads.getSnapshot();
        const record = (initial?.snapshot?.managedInstallations || []).find(item => String(item.taskId) === String(wantedTaskId));
        const game = record && (window.allGamesData || []).find(item => String(item.id) === String(record.installedGameId));
        if (!record || !game) return { status: 'unavailable', recordFound: Boolean(record), gameFound: Boolean(game) };
        await window.openGameDetails(game.id);
        await new Promise(resolve => setTimeout(resolve, 250));
        const repairButton = document.querySelector('#gdManagementMenu [data-gd-management-action="repair"]');
        const resolvedState = window.__baddelGetManagedMaintenanceState?.(game) || null;
        const before = { playVisible: getComputedStyle(document.getElementById('gdPlayBtn')).display !== 'none', gearVisible: !document.getElementById('gdManagementMenuRoot').hidden, repairVisible: Boolean(repairButton), resolvedState };
        if (!repairButton) return { status: 'unavailable', reason: 'repair-control-unavailable', before };
        const initialRevision = Number(record.taskRevision || 0);
        const initialRequestedAt = record.maintenanceRequestedAt || null;
        repairButton.click();
        const confirmation = { active: document.getElementById('confirmModal').classList.contains('active'), label: document.getElementById('confirmBtn').innerText };
        if (!confirmation.active) return { status: 'unavailable', reason: 'repair-confirmation-not-opened', before, confirmation };
        await window.executeConfirm();
        const deadline = Date.now() + ${Number(arg('timeout', '120000'))};
        let observed = null;
        let navigatedToDownloads = false;
        let busyUi = null;
        const statuses = [];
        while (Date.now() < deadline) {
            navigatedToDownloads ||= getComputedStyle(document.getElementById('downloadsView')).display !== 'none';
            const current = await window.electronAPI.downloads.getSnapshot();
            const task = current?.snapshot?.tasks?.find(item => String(item.id) === String(wantedTaskId));
            const isNewRepair = task?.operationKind === 'repair'
                && (Number(task.taskRevision || 0) > initialRevision
                    || (task.maintenanceRequestedAt && task.maintenanceRequestedAt !== initialRequestedAt));
            if (isNewRepair) {
                observed = task;
                const last = statuses[statuses.length - 1];
                if (!last || last.status !== task.status || last.stage !== task.stage) {
                    statuses.push({ status: task.status, stage: task.stage, taskRevision: task.taskRevision, maintenanceRequestedAt: task.maintenanceRequestedAt });
                }
                if (!busyUi && !['completed', 'failed', 'paused', 'cancelled'].includes(task.status)) {
                    await window.openGameDetails(game.id);
                    await new Promise(resolve => setTimeout(resolve, 100));
                    window.showContextMenu(20, 20, game.id, game.name || game.title);
                    busyUi = {
                        taskStatus: task.status,
                        taskStage: task.stage,
                        contextText: document.getElementById('contextMenu')?.innerText || '',
                        gearText: document.getElementById('gdManagementMenu')?.innerText || '',
                        updateLabel: document.getElementById('gdUpdateBtn')?.textContent || '',
                        updateDisabled: Boolean(document.getElementById('gdUpdateBtn')?.disabled),
                    };
                    window.hideContextMenu();
                }
            }
            if (observed && ['completed', 'failed', 'paused', 'cancelled'].includes(observed.status)) break;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
            status: observed?.status || 'timeout',
            before,
            confirmation,
            navigatedToDownloads,
            statuses,
            busyUi,
            task: observed ? { id: observed.id, platform: observed.platform, operationKind: observed.operationKind, status: observed.status, errorCode: observed.errorCode, completionConfirmed: observed.completionConfirmed } : null,
            detailsAfter: {
                playVisible: getComputedStyle(document.getElementById('gdPlayBtn')).display !== 'none',
                gearExists: Boolean(document.getElementById('gdManagementMenuRoot')),
            },
        };
    })()`
    : mode === 'ui-state' ? `(async () => {
        const wantedTaskId = ${JSON.stringify(taskId)};
        const initial = await window.electronAPI.downloads.getSnapshot();
        const record = (initial?.snapshot?.managedInstallations || []).find(item => String(item.taskId) === String(wantedTaskId));
        const game = record && (window.allGamesData || []).find(item => String(item.id) === String(record.installedGameId));
        if (!record || !game) return { status: 'unavailable', recordFound: Boolean(record), gameFound: Boolean(game) };
        const rendererRecords = window.__baddelGetManagedMaintenanceRecords?.() || [];
        const beforeOpenState = window.__baddelGetManagedMaintenanceState?.(game) || null;
        await window.openGameDetails(game.id);
        await new Promise(resolve => setTimeout(resolve, 300));
        return {
            status: 'success', gameId: game.id, record, rendererRecordCount: rendererRecords.length, rendererRecordIds: rendererRecords.map(item => item.installedGameId), beforeOpenState,
            globals: { setFilter: typeof window.downloadsSetFilter, checkUpdate: typeof window.downloadsCheckUpdate, repair: typeof window.downloadsRepair, queueDirectDownload: typeof window.queueDirectDownload },
            controls: {
                play: getComputedStyle(document.getElementById('gdPlayBtn')).display,
                updateHidden: document.getElementById('gdUpdateBtn').hidden,
                gearHidden: document.getElementById('gdManagementMenuRoot').hidden,
                gearText: document.getElementById('gdManagementMenu').innerText,
                maintenanceStatus: document.getElementById('gdMaintenanceStatus').textContent,
            },
        };
    })()`
    : mode === 'pause' ? `(async () => window.electronAPI.downloads.pause(${JSON.stringify(taskId)}))()`
    : mode === 'resume' ? `(async () => window.electronAPI.downloads.resume(${JSON.stringify(taskId)}))()`
        : mode === 'retry' ? `(async () => window.electronAPI.downloads.retry(${JSON.stringify(taskId)}))()`
            : mode === 'start-now' ? `(async () => window.electronAPI.downloads.startNow(${JSON.stringify(taskId)}))()`
        : mode === 'check-update' ? `(async () => window.electronAPI.downloads.checkUpdate(${JSON.stringify(taskId)}))()`
            : mode === 'maintenance' ? `(async () => window.electronAPI.downloads.queueMaintenance(${JSON.stringify(taskId)}, ${JSON.stringify(arg('operation'))}))()`
                : mode === 'capabilities' ? `(async () => window.electronAPI.downloads.getCapabilities())()`
        : mode === 'wait-progress' ? `(async () => { const deadline=Date.now()+${Number(arg('timeout', '120000'))}; while(Date.now()<deadline){const s=await window.electronAPI.downloads.getSnapshot(); const t=s?.snapshot?.tasks?.find(x=>x.id===${JSON.stringify(taskId)}); if(t && Number(t.downloadedBytes)>${Number(arg('bytes', '1048576'))}) return {status:'progress',task:t}; if(t?.status==='failed') return {status:'failed',task:t}; await new Promise(r=>setTimeout(r,500));} return {status:'timeout'}; })()`
            : mode === 'wait-terminal' ? `(async () => { const deadline=Date.now()+${Number(arg('timeout', '120000'))}; while(Date.now()<deadline){const s=await window.electronAPI.downloads.getSnapshot(); const t=s?.snapshot?.tasks?.find(x=>x.id===${JSON.stringify(taskId)}); if(t && ['completed','failed','cancelled','paused'].includes(t.status)) return {status:t.status,task:t}; await new Promise(r=>setTimeout(r,500));} return {status:'timeout'}; })()`
            : mode === 'task-summary' ? `(async () => { const s=await window.electronAPI.downloads.getSnapshot(); const t=s?.snapshot?.tasks?.find(x=>x.id===${JSON.stringify(taskId)}); return {status:s?.status,task:t?{id:t.id,status:t.status,stage:t.stage,operationKind:t.operationKind,downloadedBytes:t.downloadedBytes,totalBytes:t.totalBytes,checkpointDownloadedBytes:t.checkpointDownloadedBytes,progressPercent:t.progressPercent,processPid:t.processPid,resumeAttempts:t.resumeAttempts,recoveryReason:t.recoveryReason,errorCode:t.errorCode,errorMessage:t.errorMessage,updateAvailable:t.updateAvailable,installedBuildId:t.installedBuildId,targetBuildId:t.targetBuildId,buildVersion:t.buildVersion,verifiedBuildId:t.verifiedBuildId,verificationActualBytes:t.verificationActualBytes,verificationVerifiedFileCount:t.verificationVerifiedFileCount}:null,activeTaskId:s?.snapshot?.activeTaskId}; })()`
            : `(async () => window.electronAPI.downloads.getSnapshot())()`;

evaluate(expression).then(value => {
    if (process.argv.includes('--compact')) {
        const task = value?.task || value?.snapshot?.tasks?.find(item => item.id === taskId) || null;
        console.log(JSON.stringify({
            status: value?.status || null,
            update: value?.update || null,
            task: task ? { id: task.id, title: task.title, platform: task.platform, status: task.status, operationKind: task.operationKind, errorCode: task.errorCode || null } : null,
            queue: value?.snapshot ? { activeTaskId: value.snapshot.activeTaskId, pendingCount: value.snapshot.pendingCount, tasks: value.snapshot.tasks.map(item => ({ id: item.id, title: item.title, platform: item.platform, status: item.status, operationKind: item.operationKind })) } : null,
        }, null, 2));
        return;
    }
    console.log(JSON.stringify(value, null, 2));
}).catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
