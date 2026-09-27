'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GogApiClient } = require('../src/features/sync/infrastructure/integrations/gog/GogApiClient');

function ok(items = []) {
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ releases: items }) };
}

test('transient network failure is retried and does not require reauthentication', async () => {
    let calls = 0;
    const sleeps = [];
    const client = new GogApiClient({
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
            return ok([{ external_id: '1' }]);
        },
        sleep: async ms => sleeps.push(ms),
        random: () => 0,
    });
    const releases = await client.fetchLibraryReleases({ userId: 'u', accessToken: 'secret' });
    assert.equal(calls, 2);
    assert.equal(sleeps.length, 1);
    assert.equal(releases.length, 1);
});

test('429 honors Retry-After before retrying the same page', async () => {
    let calls = 0;
    const sleeps = [];
    const client = new GogApiClient({
        fetchImpl: async () => ++calls === 1
            ? { ok: false, status: 429, headers: { get: key => key === 'retry-after' ? '1' : null }, json: async () => ({}) }
            : ok(),
        sleep: async ms => sleeps.push(ms),
    });
    await client.fetchLibraryReleases({ userId: 'u', accessToken: 'secret' });
    assert.deepEqual(sleeps, [1000]);
});

test('explicit cancellation is not retried as a timeout', async () => {
    let calls = 0;
    const signal = AbortSignal.abort();
    const client = new GogApiClient({ fetchImpl: async (_url, options) => {
        calls += 1;
        if (options.signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        return ok();
    } });
    await assert.rejects(
        client.fetchLibraryReleases({ userId: 'u', accessToken: 'secret', signal }),
        error => error.code === 'GOG_REQUEST_CANCELLED'
    );
    assert.equal(calls, 1);
});
