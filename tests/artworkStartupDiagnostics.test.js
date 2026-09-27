'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ArtworkStartupDiagnostics, sanitize } = require('../services/artworkStartupDiagnostics');
const { createArtworkInvoke } = require('../services/artworkStartupPreload');
function ipc() {
    const handlers = new Map(); const events = new Map();
    return { handlers, events, handle: (key, fn) => handlers.set(key, fn), on: (key, fn) => events.set(key, fn) };
}
test('disabled diagnostics do not wrap handlers or cache operations', () => {
    const d = new ArtworkStartupDiagnostics({ enabled: false }); const i = ipc(); const before = i.handle;
    const target = { read: () => 3 }; const read = target.read;
    d.install(i); d.observe(target, 'read', 'read'); d.record('test');
    assert.equal(i.handle, before); assert.equal(target.read, read); assert.equal(d.events.length, 0);
});
test('main records pending and completion without serializing identity or URLs', async () => {
    const d = new ArtworkStartupDiagnostics({ enabled: true }); const i = ipc(); d.install(i);
    let finish;
    const value = { images: { secretAccount: 'file:///private/token.jpg' }, misses: 2 };
    i.handle('get-cached-images-bulk', () => new Promise(resolve => { finish = resolve; }));
    const pending = i.handlers.get('get-cached-images-bulk')({}, [{ secret: 'credential' }]);
    assert.equal(d.active.size, 1); finish(value);
    assert.equal(await pending, value); assert.equal(d.active.size, 0);
    assert.equal(d.events.at(-1).hits, 1);
    assert.doesNotMatch(JSON.stringify(d.events), /secretAccount|private|credential/);
});
test('rejection and synchronous cache return semantics are preserved', async () => {
    const d = new ArtworkStartupDiagnostics({ enabled: true }); const i = ipc(); d.install(i);
    const error = new Error('secret URL'); i.handle('get-grid-artwork-thumbnails', () => { throw error; });
    await assert.rejects(i.handlers.get('get-grid-artwork-thumbnails')({}, []), e => e === error);
    assert.equal(d.active.size, 0); assert.doesNotMatch(JSON.stringify(d.events), /secret URL/);
    const target = { read(x) { return x; } }; d.observe(target, 'read', 'file');
    assert.equal(target.read(4), 4); assert.equal(d.metrics.file.calls, 1);
});
test('preload preserves results, arguments and rejection while reporting timings', async () => {
    const sent = []; const input = [{ id: 'private' }]; const result = { images: {} };
    const invoke = createArtworkInvoke({ send: (_, event) => sent.push(event), invoke: async (channel, games) => {
        assert.equal(games, input); return result;
    } }, true);
    assert.equal(await invoke('get-cached-images-bulk', input, 'cover'), result);
    assert.deepEqual(sent.map(x => x.stage), ['invoke', 'resolved']);
    assert.doesNotMatch(JSON.stringify(sent), /private/);
    const error = new Error('private');
    await assert.rejects(createArtworkInvoke({ send() {}, invoke: async () => { throw error; } }, true)('x'), e => e === error);
});
test('trace sanitizes renderer data, bounds event count, and stops accepting events', () => {
    assert.deepEqual(sanitize({ cards: 3, title: 'private', at: Infinity, decoded: '3' }), { cards: 3 });
    const d = new ArtworkStartupDiagnostics({ enabled: true });
    for (let i = 0; i < 7000; i++) d.record('event', { count: i });
    assert.equal(d.events.length, 6000); d.stop(); d.record('late'); assert.equal(d.events.length, 6000);
});
