'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function renderMenu(maintenanceState) {
    const menu = {
        style: {}, offsetHeight: 500, innerHTML: '',
        setAttribute() {},
    };
    const context = {
        console,
        window: null,
        document: {
            getElementById: id => id === 'contextMenu' ? menu : null,
            querySelectorAll: () => [],
        },
        allCollections: [{ id: 'fav_system_default', gameIds: [] }, { id: 'collection-1', name: 'Favorites 2', gameIds: [] }],
        allGamesData: [{ id: 'game-1', name: 'Game One', timeTrackingEnabled: true }],
        currentFilters: { collectionId: null },
        innerWidth: 1280,
        innerHeight: 720,
    };
    context.window = context;
    context.__baddelGetManagedMaintenanceState = () => maintenanceState;
    context.__baddelMaintenancePresentation = state => state.maintenancePresentation || null;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('src/js/app/game-context-actions.js', 'utf8'), context);
    context.showContextMenu(100, 100, 'game-1', 'Game One');
    return menu.innerHTML;
}

function positions(html, labels) {
    return labels.map(label => html.indexOf(label));
}

test('real generated idle context menu keeps stable logical group order', () => {
    const html = renderMenu({ taskId: 'task-1', supportsUpdate: true, supportsRepair: true, updateAvailable: true, uninstallEligible: true });
    const labels = ['Play', 'Add to Favorites', 'Add to Collection', '>Update<', 'Check for Updates', 'Verify / Repair', 'Game Settings', 'Disable Time Tracking', 'Open Folder', '>Uninstall<', 'Remove from Library'];
    const found = positions(html, labels);
    assert.ok(found.every(index => index >= 0), `missing menu label: ${labels[found.findIndex(index => index < 0)]}`);
    assert.deepEqual(found, [...found].sort((a, b) => a - b));
});

test('checking and content maintenance replace only the maintenance group', () => {
    const checking = renderMenu({ taskId: 'task-1', supportsUpdate: true, supportsRepair: true, updateAvailable: true, checkingForUpdate: true, uninstallEligible: true });
    assert.match(checking, /Checking for updates/);
    assert.doesNotMatch(checking, /onclick="runContextMaintenance/);
    const queued = renderMenu({
        taskId: 'task-1', supportsUpdate: true, supportsRepair: true, updateAvailable: true, uninstallEligible: true,
        maintenancePresentation: { operation: 'repair', phase: 'queued', label: 'Repair queued' },
    });
    assert.match(queued, /Repair queued/);
    assert.match(queued, /View in Downloads/);
    assert.match(queued, /menu-item-disabled[^>]*aria-disabled="true">Uninstall/);
    for (const html of [checking, queued]) {
        const order = positions(html, ['Play', 'Add to Favorites', 'Add to Collection', 'Game Settings', 'Disable Time Tracking', 'Open Folder', 'Remove from Library']);
        assert.deepEqual(order, [...order].sort((a, b) => a - b));
    }
});
