'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');

const { generateMetadataCandidates, computeCandidateSignature } = require('../services/candidateGenerator');
const { MetadataResolutionManager, STATUS } = require('../services/metadataResolutionManager');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMRM() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrm-cand-test-'));
    const mrm = new MetadataResolutionManager(dir);
    return { mrm, dir };
}

/** Build a fake baddelApi that returns a fixed response sequence per title. */
function makeFakeApi(titleResponses = {}) {
    return {
        async lookupGame(_q)       { return null; },  // Stage 1 always misses
        normalizeServerData(h)     { return h; },
        normalizeTransientData(h)  { return h; },
        async resolveMetadata(h) {
            const key = h.title || h.slug || '';
            const r   = titleResponses[key];
            if (r === undefined) return { status: 'not_found' };
            return r;
        },
    };
}

// ─── A) Candidate generation ──────────────────────────────────────────────────

test('candidateGenerator: ACMirage → includes Assassin\'s Creed Mirage', () => {
    const candidates = generateMetadataCandidates({ name: 'ACMirage' });
    const titles = candidates.map(c => c.title);
    assert.ok(
        titles.some(t => t === "Assassin's Creed Mirage"),
        `Expected "Assassin's Creed Mirage" in candidates. Got: ${JSON.stringify(titles)}`
    );
});

test('candidateGenerator: ACMirage → includes AC Mirage (camelCase split)', () => {
    const candidates = generateMetadataCandidates({ name: 'ACMirage' });
    const titles = candidates.map(c => c.title);
    assert.ok(
        titles.some(t => t === 'AC Mirage'),
        `Expected "AC Mirage" in candidates. Got: ${JSON.stringify(titles)}`
    );
});

test('candidateGenerator: ACOrigins → includes Assassin\'s Creed Origins', () => {
    const candidates = generateMetadataCandidates({ name: 'ACOrigins' });
    const titles = candidates.map(c => c.title);
    assert.ok(
        titles.some(t => t === "Assassin's Creed Origins"),
        `Got: ${JSON.stringify(titles)}`
    );
});

test('candidateGenerator: NFS Most Wanted → not mangled', () => {
    const candidates = generateMetadataCandidates({ name: 'NFS Most Wanted' });
    const titles = candidates.map(c => c.title);
    // exact string preserved
    assert.ok(titles.includes('NFS Most Wanted'), `Got: ${JSON.stringify(titles)}`);
});

test('candidateGenerator: NFSMostWanted (compact) → includes Need for Speed', () => {
    const candidates = generateMetadataCandidates({ name: 'NFSMostWanted' });
    const titles = candidates.map(c => c.title);
    assert.ok(
        titles.some(t => t.toLowerCase().includes('need for speed')),
        `Got: ${JSON.stringify(titles)}`
    );
});

test('candidateGenerator: normal spaced title → no duplicate entries', () => {
    const candidates = generateMetadataCandidates({ name: 'Hades' });
    const norms = candidates.map(c => c.title?.toLowerCase());
    const uniq = new Set(norms);
    assert.equal(uniq.size, norms.length, 'Duplicate candidates found');
});

test('candidateGenerator: exeName=ACMirage folds alias even when name is empty', () => {
    const candidates = generateMetadataCandidates({ exeName: 'ACMirage' });
    const titles = candidates.map(c => c.title);
    assert.ok(
        titles.some(t => t === "Assassin's Creed Mirage"),
        `Got: ${JSON.stringify(titles)}`
    );
});

test('candidateGenerator: respects maxCandidates cap', () => {
    const candidates = generateMetadataCandidates({ name: 'ACMirage', exeName: 'ACMirage', folderName: 'ACMirage' }, 3);
    assert.ok(candidates.length <= 3, `Expected ≤3 candidates, got ${candidates.length}`);
});

test('candidateGenerator: all candidates have at least a title or slug', () => {
    const candidates = generateMetadataCandidates({ name: 'ACMirage', exeName: 'GTAV', folderName: 'Games' });
    for (const c of candidates) {
        assert.ok(c.title || c.slug, `Candidate has neither title nor slug: ${JSON.stringify(c)}`);
    }
});

test('computeCandidateSignature: same candidates → same signature', () => {
    const c1 = generateMetadataCandidates({ name: 'ACMirage' });
    const c2 = generateMetadataCandidates({ name: 'ACMirage' });
    assert.equal(computeCandidateSignature(c1), computeCandidateSignature(c2));
});

test('computeCandidateSignature: different candidates → different signature', () => {
    const c1 = generateMetadataCandidates({ name: 'Hades' });
    const c2 = generateMetadataCandidates({ name: 'ACMirage' });
    assert.notEqual(computeCandidateSignature(c1), computeCandidateSignature(c2));
});

test('computeCandidateSignature: empty → empty string', () => {
    assert.equal(computeCandidateSignature([]), '');
    assert.equal(computeCandidateSignature(null), '');
});

// ─── B) MRM: transient resolver tries candidate #2 when #1 returns not_found ─

test('MRM: tries candidate #2 when candidate #1 returns not_found', async () => {
    const { mrm } = makeMRM();
    const candidates = [
        { title: 'ACMirage',                slug: 'acmirage',                displayName: 'ACMirage' },
        { title: "Assassin's Creed Mirage", slug: 'assassins-creed-mirage', displayName: "Assassin's Creed Mirage" },
    ];
    const resolved = { status: 'resolved', meta: { cover: 'https://cdn/cover.jpg', heroImage: 'https://cdn/hero.jpg', logo: 'https://cdn/logo.png' } };
    const api = makeFakeApi({
        'ACMirage': { status: 'not_found' },
        "Assassin's Creed Mirage": resolved,
    });
    mrm.setApi(api);

    const result = await mrm.resolve('game-acmirage-1', { candidates, title: 'ACMirage', slug: 'acmirage' });
    assert.ok(result, 'Expected resolved result from candidate #2');
    assert.equal(result._resolveSource, 'transient-resolved');
    assert.equal(mrm.getStatus('game-acmirage-1'), STATUS.RESOLVED);
});

test('MRM: writes NOT_FOUND only after all candidates fail', async () => {
    const { mrm } = makeMRM();
    const candidates = [
        { title: 'ACMirage',                slug: 'acmirage' },
        { title: "Assassin's Creed Mirage", slug: 'assassins-creed-mirage' },
    ];
    const api = makeFakeApi({
        // all return not_found
    });
    mrm.setApi(api);

    const result = await mrm.resolve('game-all-nf', { candidates, title: 'ACMirage' });
    assert.equal(result, null);
    assert.equal(mrm.getStatus('game-all-nf'), STATUS.NOT_FOUND);
});

test('MRM: tries next candidate when resolved but no images', async () => {
    const { mrm } = makeMRM();
    const candidates = [
        { title: 'ACMirage',                slug: 'acmirage' },
        { title: "Assassin's Creed Mirage", slug: 'assassins-creed-mirage' },
    ];
    const api = makeFakeApi({
        'ACMirage':               { status: 'resolved', meta: { cover: null, heroImage: null, logo: null } },
        "Assassin's Creed Mirage": { status: 'resolved', meta: { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg', logo: null } },
    });
    mrm.setApi(api);

    const result = await mrm.resolve('game-no-img', { candidates, title: 'ACMirage' });
    assert.ok(result, 'Should resolve using second candidate which has images');
    assert.equal(mrm.getStatus('game-no-img'), STATUS.RESOLVED);
});

test('MRM: ambiguous on candidate #1 → tries #2, resolves', async () => {
    const { mrm } = makeMRM();
    const candidates = [
        { title: 'AC',                       slug: 'ac' },
        { title: "Assassin's Creed Mirage",  slug: 'assassins-creed-mirage' },
    ];
    const api = makeFakeApi({
        'AC': { status: 'ambiguous' },
        "Assassin's Creed Mirage": {
            status: 'resolved',
            meta: { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg', logo: null },
        },
    });
    mrm.setApi(api);

    const result = await mrm.resolve('game-ambig', { candidates, title: 'AC' });
    assert.ok(result, 'ambiguous on first → should try next');
    assert.equal(mrm.getStatus('game-ambig'), STATUS.RESOLVED);
});

test('MRM: ambiguous on all candidates → writes AMBIGUOUS', async () => {
    const { mrm } = makeMRM();
    const candidates = [
        { title: 'AC', slug: 'ac' },
        { title: 'AC2', slug: 'ac-2' },
    ];
    const api = makeFakeApi({
        'AC':  { status: 'ambiguous' },
        'AC2': { status: 'ambiguous' },
    });
    mrm.setApi(api);

    const result = await mrm.resolve('game-all-ambig', { candidates, title: 'AC' });
    assert.equal(result, null);
    assert.equal(mrm.getStatus('game-all-ambig'), STATUS.AMBIGUOUS);
});

// ─── C) Terminal state does not block improved candidate signature ─────────────

test('MRM: old not_found state is bypassed when candidate signature changes', async () => {
    const { mrm } = makeMRM();

    // First attempt: compact name only → not_found
    const badCandidates = [{ title: 'ACMirage', slug: 'acmirage' }];
    const sig1 = computeCandidateSignature(badCandidates);
    mrm._setJob('game-sig', {
        status: STATUS.NOT_FOUND,
        updatedAt: Date.now(),
        candidateSignature: sig1,
    });
    assert.equal(mrm.getStatus('game-sig'), STATUS.NOT_FOUND);

    // Second attempt: richer candidates with alias → signature changes → IDLE
    const goodCandidates = [
        { title: 'ACMirage',                slug: 'acmirage' },
        { title: "Assassin's Creed Mirage", slug: 'assassins-creed-mirage' },
    ];
    const api = makeFakeApi({
        'ACMirage':               { status: 'not_found' },
        "Assassin's Creed Mirage": { status: 'resolved', meta: { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg', logo: null } },
    });
    mrm.setApi(api);

    const result = await mrm.resolve('game-sig', { candidates: goodCandidates, title: 'ACMirage' });
    assert.ok(result, 'Should bypass old not_found when candidate signature changed');
    assert.equal(mrm.getStatus('game-sig'), STATUS.RESOLVED);
});

test('MRM: old not_found state blocks retry when signature has NOT changed', async () => {
    const { mrm } = makeMRM();
    const candidates = [{ title: 'ACMirage', slug: 'acmirage' }];
    const sig = computeCandidateSignature(candidates);
    mrm._setJob('game-same-sig', {
        status: STATUS.NOT_FOUND,
        updatedAt: Date.now(),
        candidateSignature: sig,
    });

    const api = makeFakeApi({});
    mrm.setApi(api);

    const result = await mrm.resolve('game-same-sig', { candidates, title: 'ACMirage' });
    assert.equal(result, null, 'Same signature → terminal state should block retry');
    assert.equal(mrm.getStatus('game-same-sig'), STATUS.NOT_FOUND);
});

test('MRM: old not_found with NO candidateSignature is bypassed when new candidates arrive', async () => {
    const { mrm } = makeMRM();

    // Simulate a legacy job written before signature support existed — no candidateSignature field.
    mrm._setJob('game-no-oldsig', {
        status: STATUS.NOT_FOUND,
        updatedAt: Date.now(),
        // intentionally NO candidateSignature
    });
    assert.equal(mrm.getStatus('game-no-oldsig'), STATUS.NOT_FOUND);

    // Now resolve with a rich candidate list that includes the alias expansion.
    const goodCandidates = [
        { title: 'ACMirage',                slug: 'acmirage',                displayName: 'ACMirage' },
        { title: 'AC Mirage',               slug: 'ac-mirage',               displayName: 'AC Mirage' },
        { title: "Assassin's Creed Mirage", slug: 'assassins-creed-mirage', displayName: "Assassin's Creed Mirage" },
    ];
    const api = makeFakeApi({
        'ACMirage':               { status: 'not_found' },
        'AC Mirage':              { status: 'not_found' },
        "Assassin's Creed Mirage": { status: 'resolved', meta: { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg', logo: null } },
    });
    mrm.setApi(api);

    const result = await mrm.resolve('game-no-oldsig', { candidates: goodCandidates, title: 'ACMirage' });
    assert.ok(result, 'Legacy not_found (no sig) + new candidates → should retry and resolve');
    assert.equal(mrm.getStatus('game-no-oldsig'), STATUS.RESOLVED);
});

// ─── D) Existing MRM behavior preserved ───────────────────────────────────────

test('MRM: 429 cooldown prevents further candidates from being tried', async () => {
    const { mrm } = makeMRM();
    const candidates = [
        { title: 'Game A', slug: 'game-a' },
        { title: 'Game B', slug: 'game-b' },
    ];
    let callCount = 0;
    const api = {
        async lookupGame()       { return null; },
        normalizeServerData(h)   { return h; },
        normalizeTransientData(h){ return h; },
        async resolveMetadata()  {
            callCount++;
            const err = new Error('429 rate limited');
            err.status = 429;
            throw err;
        },
    };
    mrm.setApi(api);

    const result = await mrm.resolve('game-429', { candidates, title: 'Game A' });
    assert.equal(result, null);
    assert.equal(mrm.getStatus('game-429'), STATUS.COOLDOWN);
    // Should have aborted after first candidate (no retry on 429)
    assert.equal(callCount, 1, 'Should stop at first 429, not try all candidates');
});

test('MRM: resetToIdle still works after candidate-loop changes', () => {
    const { mrm } = makeMRM();
    mrm.markResolved('game-r', { matchedName: 'Test' });
    assert.equal(mrm.getStatus('game-r'), STATUS.RESOLVED);
    mrm.resetToIdle('game-r');
    assert.equal(mrm.getStatus('game-r'), STATUS.IDLE);
});

test('MRM: clearJob still works', () => {
    const { mrm } = makeMRM();
    mrm.markResolved('game-clr', {});
    mrm.clearJob('game-clr');
    assert.equal(mrm.getJob('game-clr'), null);
});

test('MRM: inflight dedup — second call joins first promise', async () => {
    const { mrm } = makeMRM();
    let resolveCount = 0;
    const api = {
        async lookupGame()       { return null; },
        normalizeServerData(h)   { return h; },
        normalizeTransientData(h){ return h; },
        async resolveMetadata()  {
            resolveCount++;
            await new Promise(r => setTimeout(r, 20));
            return { status: 'resolved', meta: { cover: 'c.jpg', heroImage: 'h.jpg', logo: null } };
        },
    };
    mrm.setApi(api);

    const candidates = [{ title: 'Hades', slug: 'hades' }];
    const [r1, r2] = await Promise.all([
        mrm.resolve('game-dedup', { candidates, title: 'Hades' }),
        mrm.resolve('game-dedup', { candidates, title: 'Hades' }),
    ]);
    assert.ok(r1, 'first call should resolve');
    assert.equal(r1, r2, 'second call must return the same promise result');
    assert.equal(resolveCount, 1, 'resolveMetadata must only be called once');
});

// ─── E) Rainbow Six Siege slug + alias fixes ──────────────────────────────────

const { _toSlug } = require('../services/candidateGenerator');

test('_toSlug: straight apostrophe stripped (tom-clancys-rainbow-six-siege)', () => {
    assert.equal(_toSlug("Tom Clancy's Rainbow Six Siege"), 'tom-clancys-rainbow-six-siege');
});

test('_toSlug: right curly apostrophe (U+2019) stripped — not converted to space', () => {
    // "Tom Clancy’s" must become "tom-clancys", not "tom-clancy-s"
    assert.equal(_toSlug('Tom Clancy’s Rainbow Six Siege'), 'tom-clancys-rainbow-six-siege');
});

test('_toSlug: left curly apostrophe (U+2018) stripped', () => {
    assert.equal(_toSlug('Tom Clancy‘s Rainbow Six Siege'), 'tom-clancys-rainbow-six-siege');
});

test('_toSlug: modifier apostrophe (U+02BC) stripped', () => {
    assert.equal(_toSlug('Tom Clancyʼs Rainbow Six Siege'), 'tom-clancys-rainbow-six-siege');
});

test('candidateGenerator: "Tom Clancy\'s Rainbow Six Siege" slug is correct', () => {
    const candidates = generateMetadataCandidates({ name: "Tom Clancy's Rainbow Six Siege" });
    const slugs = candidates.map(c => c.slug).filter(Boolean);
    assert.ok(
        slugs.includes('tom-clancys-rainbow-six-siege'),
        `Expected 'tom-clancys-rainbow-six-siege' in slugs. Got: ${JSON.stringify(slugs)}`
    );
    assert.ok(
        !slugs.some(s => s.includes('clancy-s')),
        `Slug must not contain 'clancy-s' (apostrophe was converted to space). Got: ${JSON.stringify(slugs)}`
    );
});

test('candidateGenerator: "Tom Clancy\'s Rainbow Six Siege" produces "Rainbow Six Siege" alias', () => {
    const candidates = generateMetadataCandidates({ name: "Tom Clancy's Rainbow Six Siege" });
    const titles = candidates.map(c => c.title);
    assert.ok(
        titles.some(t => t === 'Rainbow Six Siege'),
        `Expected "Rainbow Six Siege" alias in candidates. Got: ${JSON.stringify(titles)}`
    );
});

test('candidateGenerator: r6s shorthand → Tom Clancy\'s Rainbow Six Siege', () => {
    const candidates = generateMetadataCandidates({ name: 'r6s' });
    const titles = candidates.map(c => c.title);
    assert.ok(
        titles.some(t => t === "Tom Clancy's Rainbow Six Siege"),
        `Expected "Tom Clancy's Rainbow Six Siege" from r6s alias. Got: ${JSON.stringify(titles)}`
    );
});

test('candidateGenerator: R6Siege (compact) expands via alias', () => {
    const candidates = generateMetadataCandidates({ name: 'R6Siege' });
    const titles = candidates.map(c => c.title);
    assert.ok(
        titles.some(t => t === "Tom Clancy's Rainbow Six Siege" || t === 'Rainbow Six Siege'),
        `Expected R6Siege expansion. Got: ${JSON.stringify(titles)}`
    );
});

test('MRM: Rainbow Six Siege resolves via fixed slug', async () => {
    const { mrm } = makeMRM();
    const candidates = generateMetadataCandidates({ name: "Tom Clancy's Rainbow Six Siege" });
    const resolved = { status: 'resolved', meta: { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg', logo: null, info: { description: 'Tactical shooter.' } } };
    const api = {
        async lookupGame(_q)      { return null; },
        normalizeServerData(h)    { return h; },
        normalizeTransientData(h) { return h; },
        async resolveMetadata(h) {
            if (h.slug === 'tom-clancys-rainbow-six-siege' || h.title === "Tom Clancy's Rainbow Six Siege" || h.title === 'Rainbow Six Siege') return resolved;
            return { status: 'not_found' };
        },
    };
    mrm.setApi(api);

    const result = await mrm.resolve('epic_Carnation', { candidates, title: "Tom Clancy's Rainbow Six Siege" });
    assert.ok(result, 'Expected R6S to resolve via fixed slug or alias');
    assert.equal(mrm.getStatus('epic_Carnation'), STATUS.RESOLVED);
});