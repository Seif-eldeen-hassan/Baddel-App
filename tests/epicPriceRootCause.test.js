'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyEpicPriceResponse } = require('../src/features/sync/application/services/EpicPriceErrorClassifier');
const { resolveEpicPriceRetryInput } = require('../src/features/sync/application/services/EpicPriceRetryInputResolver');
const { EpicPriceEnrichmentService } = require('../src/features/sync/application/services/EpicPriceEnrichmentService');
const { EpicProgressiveSyncCoordinator } = require('../src/features/sync/application/services/EpicProgressiveSyncCoordinator');
const { sanitize } = require('../src/features/sync/infrastructure/diagnostics/EpicPriceDebugSession');

const root = path.resolve(__dirname, '..');
const platformSync = fs.readFileSync(path.join(root, 'platformSync.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src/js/app/sidebar.js'), 'utf8');

test('restart retry resolves all 602 account-owned games from the merged snapshot', () => {
    const saved = JSON.parse(JSON.stringify(Array.from({ length: 602 }, (_, index) => ({
        id: `game-${index}`, ownedByAccountIds: ['account-a'],
    }))));
    const result = resolveEpicPriceRetryInput({ mergedLibrary: saved, accountId: 'account-a', libraryGamesFetched: 602 });
    assert.equal(result.games.length, 602);
    assert.equal(result.stats.withMatchingAccountId, 602);
});

test('non-empty saved library with zero ownership matches fails before HTTP', () => {
    assert.throws(
        () => resolveEpicPriceRetryInput({ mergedLibrary: [{ ownedByAccountIds: ['other'] }], accountId: 'account-a', libraryGamesFetched: 602 }),
        (error) => error.code === 'EPIC_PRICE_RETRY_INPUT_EMPTY' && error.failedStage === 'retry_input_resolution'
    );
});

test('HTTP 429 preserves Retry-After and typed classification', () => {
    assert.deepEqual(classifyEpicPriceResponse({ status: 429, retryAfterMs: 17000 }), {
        code: 'EPIC_PRICE_RATE_LIMITED', failedStage: 'http_response', reason: 'rate_limited', retryable: true, retryAfterMs: 17000,
    });
});

test('PersistedQueryNotFound remains a specific GraphQL failure', () => {
    const result = classifyEpicPriceResponse({ status: 200, data: { errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] } });
    assert.equal(result.code, 'EPIC_PRICE_PERSISTED_QUERY_INVALID');
    assert.equal(result.failedStage, 'graphql_response');
});

test('HTTP auth, server, timeout, and network failures have distinct codes', () => {
    assert.equal(classifyEpicPriceResponse({ status: 401 }).code, 'EPIC_PRICE_HTTP_401');
    assert.equal(classifyEpicPriceResponse({ status: 403 }).code, 'EPIC_PRICE_HTTP_403');
    assert.equal(classifyEpicPriceResponse({ status: 503 }).code, 'EPIC_PRICE_HTTP_5XX');
    assert.equal(classifyEpicPriceResponse({ status: 408, timedOut: true }).code, 'EPIC_PRICE_REQUEST_TIMEOUT');
    assert.equal(classifyEpicPriceResponse({ networkFailure: true }).code, 'EPIC_PRICE_NETWORK_FAILURE');
});

test('Vault commit failure is wrapped with a typed stage before reaching the coordinator', () => {
    assert.match(platformSync, /EPIC_PRICE_VAULT_COMMIT_FAILED/);
    assert.match(platformSync, /error\.failedStage = 'vault_commit'/);
});

test('price progress persistence failure is typed instead of becoming EPIC_PRICES_FAILED', async (t) => {
    let fail = false;
    const coordinator = new EpicProgressiveSyncCoordinator({
        store: { write: async () => { if (fail) throw new Error('disk unavailable'); } },
        isAccountActive: async () => true,
    });
    t.after(() => coordinator.shutdown().catch(() => {}));
    const state = await coordinator.beginAccount({ accountId: 'a', syncRunId: 'r', options: { currentPrices: true } });
    await coordinator.markLibraryCommitted({ accountId: 'a', syncRunId: 'r', revision: state.revision, gamesFetched: 1 });
    fail = true;
    await assert.rejects(
        coordinator.report('a', 'r', state.revision, 'prices', { status: 'failed', event: 'batch_committed' }),
        (error) => error.code === 'EPIC_PRICE_PROGRESS_PERSIST_FAILED' && error.failedStage === 'progress_persistence'
    );
    fail = false;
});

test('zero coverage keeps its diagnostics and failed stage', async () => {
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async () => ({ priceStatus: 'unresolved', resolutionSource: 'graphql_error', errorCode: 'EPIC_PRICE_GRAPHQL_ERROR' }),
        maxRetries: 0, circuitMinAttempts: 1,
    });
    await assert.rejects(service.process([{}], { onBatch: async () => {} }), (error) =>
        error.code === 'EPIC_PRICES_ZERO_COVERAGE'
        && error.failedStage === 'price_resolution'
        && error.progress.reasonCounts.graphql_error === 1);
});

test('debug serialization redacts tokens, cookies, and authorization codes', () => {
    const serialized = JSON.stringify(sanitize({
        accessToken: 'token-value', cookie: 'session=value', authorizationCode: 'code-value',
        message: 'Authorization: Bearer abc Cookie=session-secret', safe: 'kept',
    }));
    assert.doesNotMatch(serialized, /token-value|session=value|code-value|Bearer abc|session-secret/);
    assert.match(serialized, /kept/);
});

test('price notice uses library games separately and never treats price.total as library size', () => {
    const noticeStart = sidebar.indexOf('function _vaultEpicProgressNoticeHtml');
    const noticeEnd = sidebar.indexOf('async function retryVaultEpicPhase', noticeStart);
    const notice = sidebar.slice(noticeStart, noticeEnd);
    assert.match(notice, /state\.phases\?\.library\?\.gamesFetched/);
    assert.match(notice, /Price candidates:/);
    assert.doesNotMatch(notice, /Number\(price\.total \|\| 0\).*games are available/);
});

test('platformSync imports the price service before constructing it', () => {
    assert.match(platformSync, /EpicPriceEnrichmentService[\s\S]+require\('\.\/src\/features\/sync\/application\/services\/EpicPriceEnrichmentService'\)/);
});
