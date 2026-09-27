'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const steamBridge = require('../steamBridge');

function snapshot({ generation = 1, revision = 1, complete = false, terminal = false, resolved = 0, expected = 10 } = {}) {
    return {
        status: complete ? 'complete' : (terminal ? 'terminal_incomplete' : 'collecting'),
        steamAccountId: 'account-1',
        sessionGeneration: generation,
        completeness: {
            generation,
            progressRevision: revision,
            complete,
            terminal,
            expectedApps: expected,
            resolvedApps: resolved,
            pendingApps: Math.max(0, expected - resolved),
        },
        transport: { connected: true, requestsActive: !terminal },
    };
}

function harness(statuses, { onSleep } = {}) {
    const emitter = new EventEmitter();
    let clock = 0;
    let index = 0;
    emitter.getCollectionStatus = async () => statuses[Math.min(index++, statuses.length - 1)];
    emitter.recoverCollection = async () => ({ status: 'nothing_to_retry' });
    emitter.now = () => clock;
    emitter.sleep = async (ms) => {
        clock += ms;
        if (onSleep) onSleep(emitter, ms);
    };
    return emitter;
}

async function wait(emitter, options = {}) {
    return steamBridge.waitForCacheReady.call(emitter, 'account-1', {
        inactivityMs: 60_000,
        overallMs: 180_000,
        pollIntervalMs: 30_000,
        now: emitter.now,
        sleep: emitter.sleep,
        ...options,
    });
}

test('meaningful progress may continue beyond sixty seconds', async () => {
    const emitter = harness([
        snapshot({ revision: 1, resolved: 10, expected: 50 }),
        snapshot({ revision: 2, resolved: 20, expected: 50 }),
        snapshot({ revision: 3, resolved: 30, expected: 50 }),
        snapshot({ revision: 4, resolved: 40, expected: 50 }),
        snapshot({ revision: 5, resolved: 50, expected: 50, complete: true, terminal: true }),
    ]);
    const result = await wait(emitter);
    assert.equal(result.completeness.complete, true);
    assert.ok(emitter.now() >= 120_000);
});

test('genuinely stalled collection fails on inactivity, not wall clock sixty seconds', async () => {
    const emitter = harness([snapshot({ revision: 1, resolved: 3 })]);
    await assert.rejects(
        wait(emitter, { inactivityMs: 10_000, pollIntervalMs: 5_000, maxRecoveryAttempts: 0 }),
        (error) => error.code === 'STEAM_LIBRARY_INACTIVITY_TIMEOUT'
            && error.collectionDiagnostics.completeness.resolvedApps === 3
    );
});

test('missing response is recovered with a bounded retry', async () => {
    let recovered = false;
    const emitter = harness([snapshot({ terminal: true, resolved: 9 }), snapshot({ revision: 2, resolved: 10, complete: true, terminal: true })]);
    emitter.recoverCollection = async (generation) => {
        recovered = true;
        assert.equal(generation, 1);
        return { status: 'requested', requestedAppIds: ['10'] };
    };
    const result = await wait(emitter, { maxRecoveryAttempts: 1 });
    assert.equal(recovered, true);
    assert.equal(result.completeness.complete, true);
});

test('second sync can recover after first attempt times out', async () => {
    const emitter = harness([snapshot({ revision: 1, resolved: 2 })]);
    await assert.rejects(wait(emitter, { inactivityMs: 2, pollIntervalMs: 1, maxRecoveryAttempts: 0 }));

    let calls = 0;
    emitter.getCollectionStatus = async () => calls++ === 0
        ? snapshot({ generation: 2, revision: 2, terminal: true, resolved: 9 })
        : snapshot({ generation: 2, revision: 3, resolved: 10, complete: true, terminal: true });
    emitter.recoverCollection = async () => ({ status: 'requested', requestedAppIds: ['10'] });
    const result = await wait(emitter, { expectedGeneration: 2, maxRecoveryAttempts: 1 });
    assert.equal(result.sessionGeneration, 2);
    assert.equal(result.completeness.complete, true);
});

test('late readiness event from an old session is rejected', async () => {
    const reports = [];
    let emitted = false;
    const emitter = harness([
        snapshot({ generation: 2, revision: 1, resolved: 5 }),
        snapshot({ generation: 2, revision: 2, resolved: 10, complete: true, terminal: true }),
    ], {
        onSleep(instance) {
            if (!emitted) {
                emitted = true;
                instance.emit('cacheReady', { steamAccountId: 'account-1', sessionGeneration: 1 });
            }
        },
    });
    await wait(emitter, { expectedGeneration: 2, onProgress: (value) => reports.push(value) });
    assert.equal(reports.at(-1).readiness.rejected, 1);
    assert.equal(reports.at(-1).readiness.lastRejectedReason, 'generation_mismatch');
});

test('slow first sync does not render zero as a confirmed ownership count', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/js/accounts/platform-panels.js'), 'utf8');
    assert.match(source, /gamesCountKnown/);
    assert.match(source, /Checking library/);
});
