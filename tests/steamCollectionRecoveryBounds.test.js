'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const steamBridge = require('../steamBridge');

test('default recovery budget is finite', async () => {
    const bridge = new EventEmitter();
    let clock = 0;
    let recoveries = 0;
    bridge.getCollectionStatus = async () => ({
        status: 'terminal_incomplete',
        steamAccountId: 'account',
        sessionGeneration: 4,
        completeness: { terminal: true, complete: false, progressRevision: 9, pendingAppIds: ['42'] },
        transport: { connected: true, requestsActive: false },
    });
    bridge.recoverCollection = async () => {
        recoveries += 1;
        return { status: 'requested', requestedAppIds: ['42'] };
    };

    await assert.rejects(
        steamBridge.waitForCacheReady.call(bridge, 'account', {
            inactivityMs: 10,
            overallMs: 5_000,
            pollIntervalMs: 1,
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
        }),
        (error) => error.code === 'STEAM_LIBRARY_INCOMPLETE'
            && error.collectionDiagnostics.recoveryAttempts === 2
    );
    assert.equal(recoveries, 2);
    assert.equal(bridge.listenerCount('cacheReady'), 0);
    assert.equal(bridge.listenerCount('cacheIncomplete'), 0);
});
