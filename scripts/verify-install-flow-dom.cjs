'use strict';
// Explicit, preview-only acceptance against a source renderer on localhost:9333.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
async function main() {
    const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
    const target = targets.find(item => item.url === 'file:///E:/Baddel/Baddel-App/src/dashboard.html');
    assert.ok(target, 'Source renderer must be running with local diagnostics');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); const call = pending.get(message.id); if (call) { pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); } };
    function send(method, params = {}) { return new Promise((resolve, reject) => { const seq = ++id; pending.set(seq, { resolve, reject }); socket.send(JSON.stringify({ id: seq, method, params })); }); }
    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    }
    const evidence = { capturedAt: new Date().toISOString(), target: target.url, fixtureScope: 'Platform/account lifecycle checks use explicit synthetic game/account fixtures in the actual DOM. Drives, tasks and storage IPC are real. No queue or uninstall invoked.' };
    try {
        await send('Page.bringToFront');
        evidence.initial = await evaluate(`(async () => {
            navigateToDownloads();
            await new Promise(r => setTimeout(r, 300));
            const toolbar = document.getElementById('downloadsToolbar');
            const trigger = toolbar.querySelector('[data-menu-trigger]');
            return { nativeSelects: toolbar.querySelectorAll('select').length, menus: toolbar.querySelectorAll('[data-baddel-menu]').length, triggerHeight: trigger.getBoundingClientRect().height, searchHeight: toolbar.querySelector('.ag-search-wrap').getBoundingClientRect().height, triggerWidth: trigger.getBoundingClientRect().width, sourceMenuLoaded: !!window.baddelMenus };
        })()`);
        assert.equal(evidence.initial.nativeSelects, 0); assert.equal(evidence.initial.menus, 4); assert.ok(evidence.initial.triggerWidth >= 140);
        evidence.menus = await evaluate(`(() => {
            const trigger = document.querySelector('#downloadsPlatform [data-menu-trigger]');
            trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            const opened = trigger.getAttribute('aria-expanded') === 'true';
            const focusInside = document.activeElement.getAttribute('role') === 'menuitemradio';
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const escaped = trigger.getAttribute('aria-expanded') === 'false' && document.activeElement === trigger;
            trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
            document.getElementById('downloadsRoot').click();
            return { opened, focusInside, escaped, outsideClosed: trigger.getAttribute('aria-expanded') === 'false' };
        })()`);
        assert.ok(Object.values(evidence.menus).every(Boolean));
        evidence.completed = await evaluate(`(async () => {
            const snapshot = await electronAPI.downloads.getSnapshot();
            const task = snapshot.snapshot.tasks.find(item => item.status === 'completed');
            if (!task) return { tested: false };
            const card = document.querySelector('[data-download-task-id="' + CSS.escape(task.id) + '"]');
            const trigger = card.querySelector('[data-menu-trigger]');
            const visible = [...card.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => button.textContent.trim());
            trigger.click();
            const actions = [...card.querySelectorAll('[data-task-action]')].map(item => item.dataset.taskAction);
            card.querySelector('[data-task-action="info"]').click();
            const info = document.getElementById('downloadGameInfo');
            const infoOpen = info.open;
            const text = info.innerText;
            info.close();
            trigger.click(); downloadsSetFilter('sort', 'az');
            return { tested: true, taskId: task.id, visible, actions, eligible: task.uninstallEligible, infoOpen, hasCompletedDate: text.includes('Downloaded on'), rerenderClosed: !document.querySelector('#downloadsRoot [aria-expanded="true"]') };
        })()`);
        assert.ok(evidence.completed.tested); assert.equal(evidence.completed.visible.length, 2); assert.ok(evidence.completed.infoOpen); assert.ok(evidence.completed.rerenderClosed);
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.resolve('docs/install-flow-downloads-dom.png'), Buffer.from(screenshot.data, 'base64'));
        evidence.platforms = await evaluate(`(async () => {
            const oldDirect = buildDirectEpicInstallAccountOptions;
            const oldPlatform = buildPlatformAccountOptions;
            const oldGame = _gdCurrentGame;
            const oldId = _gdCurrentGameId;
            const results = [];
            const account = { id: 'fixture-owner', displayName: 'Fixture Owner', name: 'Fixture Owner', enabled: true, actionStatus: 'ready', ownsGame: true, platform: 'gog', syncAccountId: 'fixture-owner' };
            buildDirectEpicInstallAccountOptions = async () => [account];
            buildPlatformAccountOptions = async () => [account];
            try {
                for (const platforms of [['steam','epic'], ['epic','gog'], ['steam','gog'], ['steam','epic','gog']]) {
                    await _gdOpenInstallPickerForGame({ id: 'fixture-game', name: 'Installer UI fixture', platforms, platform: platforms[0], gogProductId: '2099051765', appName: 'fixture-app' });
                    const start = { platforms, selected: _gdInstallSelectedPlatform, provider: _gdInstallSelectedProvider, disabled: document.getElementById('gdInstallConfirmBtn').disabled, platformCards: document.querySelectorAll('#gdInstPlatformsRow button').length, methodsHidden: document.getElementById('gdInstallMethodsSection').hidden };
                    for (const platform of platforms) {
                        await gdInstallSelectPlatform(platform);
                        results.push({ ...start, choice: platform, chosenPlatform: _gdInstallSelectedPlatform, chosenProvider: _gdInstallSelectedProvider, methodsHiddenAfter: document.getElementById('gdInstallMethodsSection').hidden });
                        if (platform === 'epic') {
                            await gdInstallSelectProvider('legendary');
                            results.push({ epicMethod: _gdInstallSelectedProvider, hasStorage: !document.getElementById('gdInstallStorageSection').hidden });
                        }
                    }
                    gdInstallClose();
                }
                for (const platform of ['steam','epic','gog']) {
                    await _gdOpenInstallPickerForGame({ id: 'fixture-' + platform, name: 'Single-platform fixture', platforms: [platform], platform, gogProductId: '2099051765' });
                    results.push({ single: platform, platformStepAbsent: !document.getElementById('gdInstPlatformsRow'), selected: _gdInstallSelectedPlatform, provider: _gdInstallSelectedProvider });
                    gdInstallClose();
                }
            } finally { gdInstallClose(); buildDirectEpicInstallAccountOptions = oldDirect; buildPlatformAccountOptions = oldPlatform; _gdCurrentGame = oldGame; _gdCurrentGameId = oldId; }
            return results;
        })()`);
        for (const result of evidence.platforms) {
            if (result.platforms) { assert.equal(result.selected, null); assert.equal(result.provider, null); assert.equal(result.disabled, true); assert.equal(result.chosenPlatform, result.choice); assert.equal(result.chosenProvider, ({ steam: 'steam_client', gog: 'gogdl', epic: null })[result.choice]); }
            if (result.single) assert.ok(result.platformStepAbsent);
        }
        evidence.storage = await evaluate(`(async () => {
            const result = await electronAPI.downloads.getStorageOptions();
            return { status: result.status, drives: result.drives };
        })()`);
        assert.equal(evidence.storage.status, 'success'); assert.ok(evidence.storage.drives.some(drive => drive.freeSpaceBytes > 0));
        evidence.pass = true;
    } catch (error) { evidence.pass = false; evidence.error = error.stack; throw error; }
    finally {
        fs.writeFileSync(path.resolve('docs/install-flow-dom-evidence.json'), JSON.stringify(evidence, null, 2));
        socket.close();
    }
    console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
