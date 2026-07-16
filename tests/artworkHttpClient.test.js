'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    ArtworkHttpClient,
    ArtworkHttpError,
    parseRetryAfter,
} = require('../src/features/games/infrastructure/services/ArtworkHttpClient');

const HTTP_CLIENT_PATH = path.join(
    __dirname,
    '..',
    'src',
    'features',
    'games',
    'infrastructure',
    'services',
    'ArtworkHttpClient.js'
);

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWv2YQAAAABJRU5ErkJggg==',
    'base64'
);

function makeResponse(buffer = PNG_1X1, options = {}) {
    const headers = {
        'content-type': options.mime || 'image/png',
        'content-length': String(options.contentLength ?? buffer.length),
        etag: options.etag || null,
        'last-modified': options.lastModified || null,
        'retry-after': options.retryAfter || null,
    };
    return {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        headers: {
            get(name) {
                return headers[String(name).toLowerCase()] || null;
            },
        },
        async arrayBuffer() {
            if (options.failOnRead) throw new Error('body should not be read');
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        },
    };
}

test('ArtworkHttpClient sends conditional validators and returns 304 without reading a body', async () => {
    let seenRequest = null;
    const client = new ArtworkHttpClient({
        fetchImpl: async (_url, request) => {
            seenRequest = request;
            return makeResponse(Buffer.alloc(0), {
                ok: false,
                status: 304,
                etag: '"v2"',
                lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT',
                failOnRead: true,
            });
        },
    });

    const result = await client.fetchImage({
        url: 'https://cdn.example/cover.png',
        etag: '"v1"',
        lastModified: 'Tue, 20 Oct 2015 07:28:00 GMT',
    });

    assert.equal(seenRequest.headers['If-None-Match'], '"v1"');
    assert.equal(seenRequest.headers['If-Modified-Since'], 'Tue, 20 Oct 2015 07:28:00 GMT');
    assert.equal(result.notModified, true);
    assert.equal(result.status, 304);
    assert.equal(result.buffer, null);
    assert.equal(result.etag, '"v2"');
});

test('ArtworkHttpClient retries retryable statuses and honors Retry-After', async () => {
    const sleeps = [];
    let calls = 0;
    const client = new ArtworkHttpClient({
        sleep: async ms => { sleeps.push(ms); },
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) {
                return makeResponse(Buffer.alloc(0), {
                    ok: false,
                    status: 503,
                    retryAfter: '2',
                });
            }
            return makeResponse(PNG_1X1, { etag: '"ok"' });
        },
    });

    const result = await client.fetchImage({ url: 'https://cdn.example/cover.png' });

    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [2000]);
    assert.equal(result.retryCount, 1);
    assert.equal(result.etag, '"ok"');
    assert.equal(result.bytes, PNG_1X1.length);
});

test('ArtworkHttpClient uses capped exponential backoff for network failures', async () => {
    const sleeps = [];
    let calls = 0;
    const client = new ArtworkHttpClient({
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 15,
        sleep: async ms => { sleeps.push(ms); },
        fetchImpl: async () => {
            calls += 1;
            if (calls < 3) throw new Error('socket reset');
            return makeResponse(PNG_1X1);
        },
    });

    const result = await client.fetchImage({ url: 'https://cdn.example/cover.png' });

    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [10, 15]);
    assert.equal(result.retryCount, 2);
});

test('ArtworkHttpClient does not retry non-retryable 404 responses', async () => {
    let calls = 0;
    const client = new ArtworkHttpClient({
        fetchImpl: async () => {
            calls += 1;
            return makeResponse(Buffer.alloc(0), { ok: false, status: 404 });
        },
    });

    await assert.rejects(
        client.fetchImage({ url: 'https://cdn.example/missing.png' }),
        (err) => err instanceof ArtworkHttpError && err.status === 404 && err.retryable === false
    );
    assert.equal(calls, 1);
});

test('ArtworkHttpClient rejects unsupported MIME types before committing response bytes', async () => {
    const client = new ArtworkHttpClient({
        fetchImpl: async () => makeResponse(Buffer.from('<html></html>'), {
            mime: 'text/html',
            failOnRead: true,
        }),
    });

    await assert.rejects(
        client.fetchImage({ url: 'https://cdn.example/not-art.html' }),
        /Unsupported artwork MIME type/
    );
});

test('ArtworkHttpClient rejects oversized responses from content-length without reading body', async () => {
    const client = new ArtworkHttpClient({
        fetchImpl: async () => makeResponse(PNG_1X1, {
            contentLength: 50,
            failOnRead: true,
        }),
    });

    await assert.rejects(
        client.fetchImage({ url: 'https://cdn.example/large.png', maxBytes: 8 }),
        /exceeds maximum/
    );
});

test('ArtworkHttpClient parseRetryAfter handles seconds, dates, and invalid values', () => {
    assert.equal(parseRetryAfter('3'), 3000);
    assert.equal(parseRetryAfter('not a date'), null);
    assert.ok(parseRetryAfter(new Date(Date.now() + 5000).toUTCString()) >= 0);
});

test('ArtworkHttpClient stays independent of renderer, Electron, and production download routing', () => {
    const source = fs.readFileSync(HTTP_CLIENT_PATH, 'utf8');

    assert.doesNotMatch(source, /electron|ipcMain|BrowserWindow|window\.|document\./);
    assert.doesNotMatch(source, /platformSync|main\.js|preload\.js|imageWebpCache/);
});
