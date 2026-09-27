'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunction(source, name) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing ${name}`);
    let open = source.indexOf('{', start + marker.length);
    let depth = 1;
    let index = open + 1;
    while (index < source.length && depth > 0) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') depth -= 1;
        index += 1;
    }
    assert.equal(depth, 0, `unbalanced ${name}`);
    return source.slice(start, index);
}

test('shared startup resolver validates managed persisted paths before accepting them', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
    const snippetStart = source.indexOf('function isUsableImageUrl(');
    const snippetEnd = source.indexOf('window.__baddelApplyBulkResolvedArtworkToGame = _bulkArtworkApply;');
    assert.notEqual(snippetStart, -1);
    assert.notEqual(snippetEnd, -1);
    const snippet = source.slice(snippetStart, snippetEnd);
    const managed = 'file:///C:/Users/test/AppData/Roaming/baddel/artwork-cache-v2/assets/cover.webp';
    const accepted = [];
    const context = {
        window: {
            __agVerifiedArtworkUrls: new Set(),
            __baddelAcceptVerifiedBulkCover(game, cover, resolutionSource) {
                accepted.push({ game, cover, resolutionSource });
                context.window.__agVerifiedArtworkUrls.add(cover);
            },
        },
        Set,
        String,
    };
    vm.runInNewContext(`${snippet}
        this.direct = _bulkArtworkDirectValue;
        this.candidates = _bulkArtworkCandidateManagedUrls;
        this.apply = _bulkArtworkApply;`, context);

    const game = { id: 'game-a', image: managed };
    assert.equal(context.direct(game, 'cover'), null);
    assert.deepEqual(Array.from(context.candidates(game, 'cover')), [managed]);

    const changed = context.apply(game, {
        cover: managed,
        missTypes: [],
        cacheResults: { cover: { source: 'persisted-managed-file' } },
    }, { surface: 'all-games-startup' });
    assert.equal(changed, true);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].resolutionSource, 'persisted-managed-file');
    assert.equal(context.direct(game, 'cover'), managed);
});

test('All Games verified bulk hook publishes through the authoritative ready-state method', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'accounts.js'), 'utf8');
    const fn = extractFunction(source, '_agAcceptVerifiedBulkCover');
    const managed = 'file:///cache/artwork-cache-v2/assets/cover.webp';
    const calls = [];
    const context = {
        window: { __agVerifiedArtworkUrls: new Set() },
        _agIsManagedArtworkCacheUrl: value => value === managed,
        _agSetArtworkReady(game, cover, resolutionSource) {
            calls.push({ game, cover, resolutionSource });
            return true;
        },
    };
    vm.runInNewContext(`${fn}; this.accept = _agAcceptVerifiedBulkCover;`, context);

    const game = { id: 'game-a' };
    assert.equal(context.accept(game, managed, 'artwork-cache-v2'), true);
    assert.equal(context.window.__agVerifiedArtworkUrls.has(managed), true);
    assert.deepEqual(calls, [{ game, cover: managed, resolutionSource: 'artwork-cache-v2' }]);
    assert.equal(context.accept(game, 'file:///outside/cover.webp', 'persisted'), false);
});
