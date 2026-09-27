'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function loadAnalytics() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') return { app: { getVersion: () => 'test', getPath: () => 'C:\\test' } };
        return originalLoad.call(this, request, parent, isMain);
    };
    const modulePath = require.resolve('../analytics');
    delete require.cache[modulePath];
    try { return require(modulePath); }
    finally { Module._load = originalLoad; }
}

test('feature analytics keeps only low-cardinality allowlisted properties', () => {
    const analytics = loadAnalytics();
    const safe = analytics.sanitizeFeatureProperties({
        feature: 'All Games',
        platform: 'Epic',
        query_present: true,
        game_name: 'Private title',
        account_id: 'private-account',
        install_path: 'C:\\Users\\Name\\Games',
        error_code: new Error('Request timed out for C:\\Users\\Name'),
    });
    assert.deepEqual(safe, {
        feature: 'all_games',
        platform: 'epic',
        query_present: true,
        error_code: 'timeout',
    });
});

test('feature analytics rejects unknown event names', async () => {
    const analytics = loadAnalytics();
    assert.equal(await analytics.track('arbitrary_private_event', { feature: 'x' }), false);
    assert.equal(await analytics.track('feature_viewed', { feature: 'home' }), true);
});

test('Vault account activation is an allowlisted privacy-safe feature event', async () => {
    const analytics = loadAnalytics();
    assert.equal(await analytics.track('vault_account_activated', {
        feature: 'vault', platform: 'epic', result: 'success', account_id: 'must-not-leave-renderer',
    }), true);
    assert.deepEqual(analytics.sanitizeFeatureProperties({
        feature: 'vault', platform: 'epic', result: 'success', account_id: 'private',
    }), { feature: 'vault', platform: 'epic', result: 'success' });
});

test('sync analytics classifies errors without retaining raw messages', () => {
    const analytics = loadAnalytics();
    assert.equal(analytics.classifyAnalyticsError('HTTP 429 at https://private.example'), 'rate_limited');
    assert.equal(analytics.classifyAnalyticsError('ENOENT C:\\Users\\Name\\secret'), 'not_found');
    assert.equal(analytics.classifyAnalyticsError('socket ECONNRESET'), 'network');
});
