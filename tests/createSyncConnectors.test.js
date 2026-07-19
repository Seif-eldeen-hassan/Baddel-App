'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    CONNECTOR_METHODS,
    createSyncConnectors,
} = require('../src/features/sync/infrastructure/composition/createSyncConnectors');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');

function createMethods(prefix) {
    return Object.fromEntries(CONNECTOR_METHODS.map((method) => [
        method,
        function connectorMethod(...args) {
            return { prefix, method, self: this, args };
        },
    ]));
}

test('createSyncConnectors exists and exposes the current connector method contract', () => {
    assert.equal(typeof createSyncConnectors, 'function');
    assert.deepEqual(CONNECTOR_METHODS, [
        'isLinked',
        'getAccounts',
        'link',
        'syncLibrary',
        'getCachedLibrary',
        'unlink',
    ]);
});

test('createSyncConnectors returns Steam, Epic, GOG, and ALL_CONNECTORS in the current order', () => {
    const result = createSyncConnectors({
        steam: createMethods('steam'),
        epic: createMethods('epic'),
        gog: createMethods('gog'),
    });

    assert.deepEqual(Object.keys(result), ['steamConnector', 'epicConnector', 'gogConnector', 'ALL_CONNECTORS']);
    assert.deepEqual(Object.keys(result.steamConnector), CONNECTOR_METHODS);
    assert.deepEqual(Object.keys(result.epicConnector), CONNECTOR_METHODS);
    assert.deepEqual(Object.keys(result.gogConnector), CONNECTOR_METHODS);
    assert.deepEqual(Object.keys(result.ALL_CONNECTORS), ['epic', 'steam', 'gog']);
    assert.equal(result.ALL_CONNECTORS.steam, result.steamConnector);
    assert.equal(result.ALL_CONNECTORS.epic, result.epicConnector);
    assert.equal(result.ALL_CONNECTORS.gog, result.gogConnector);
});

test('connector methods are forwarded exactly and keep object method this binding', () => {
    const steam = createMethods('steam');
    const epic = createMethods('epic');
    const gog = createMethods('gog');
    const { steamConnector, epicConnector, gogConnector } = createSyncConnectors({ steam, epic, gog });

    for (const method of CONNECTOR_METHODS) {
        assert.equal(steamConnector[method], steam[method]);
        assert.equal(epicConnector[method], epic[method]);
        assert.equal(gogConnector[method], gog[method]);
    }

    const steamResult = steamConnector.syncLibrary('target');
    assert.deepEqual(steamResult.args, ['target']);
    assert.equal(steamResult.prefix, 'steam');
    assert.equal(steamResult.method, 'syncLibrary');
    assert.equal(steamResult.self, steamConnector);

    const epicResult = epicConnector.unlink('account');
    assert.deepEqual(epicResult.args, ['account']);
    assert.equal(epicResult.prefix, 'epic');
    assert.equal(epicResult.method, 'unlink');
    assert.equal(epicResult.self, epicConnector);
});

test('createSyncConnectors rejects missing connector objects and methods with useful errors', () => {
    assert.throws(
        () => createSyncConnectors({ epic: createMethods('epic') }),
        /steam connector must be an object/
    );
    assert.throws(
        () => createSyncConnectors({ steam: createMethods('steam') }),
        /epic connector must be an object/
    );
    assert.throws(
        () => createSyncConnectors({ steam: createMethods('steam'), epic: createMethods('epic') }),
        /gog connector must be an object/
    );

    const incompleteSteam = createMethods('steam');
    delete incompleteSteam.unlink;

    assert.throws(
        () => createSyncConnectors({ steam: incompleteSteam, epic: createMethods('epic'), gog: createMethods('gog') }),
        /steam connector missing unlink/
    );
});

test('createSyncConnectors module stays pure and isolated from runtime boundaries', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');

    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /electron|BrowserWindow|Notification|ipcMain|ipcRenderer/);
    assert.doesNotMatch(source, /main\.js|preload\.js|renderer|src\/js|src\\js/);
    assert.doesNotMatch(source, /steamBridge/);
    assert.doesNotMatch(source, /legendary|LEGENDARY|execFile/);
    assert.doesNotMatch(source, /registerPlatformSyncHandlers|platform-sync:/);
    assert.doesNotMatch(source, /SyncRuntimeState|SyncEventEmitter|_platformSyncState/);
});
