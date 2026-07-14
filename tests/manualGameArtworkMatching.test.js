'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { addManualGame } = require('../src/features/games/application/useCases/AddManualGameUseCase');

const COOLDOWN = 'cooldown';
const GENERIC_EXES = new Set(['game.exe', 'launcher.exe', 'start.exe', 'client.exe']);

function makeTmpExe(exeName = 'ExactGame.exe') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-manual-art-'));
    const exe = path.join(dir, 'Games', 'ExactGame', exeName);
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    return {
        dir,
        exe,
        cleanup: () => {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        },
    };
}

function makeMrm(resolveResult = null) {
    const calls = [];
    return {
        getStatus: () => 'idle',
        resolve: async (id, hints) => {
            calls.push({ id, hints });
            return resolveResult;
        },
        calls,
    };
}

function makeDeps(overrides = {}) {
    const upserted = [];
    const bgCalls = [];
    const saves = [];
    const game = overrides.game || { id: 'manual-id', name: 'Exact Game', platform: 'Manual' };

    return {
        fs: fs.promises,
        fsSync: fs,
        generateStableId: overrides.generateStableId || (() => 'manual-id'),
        parseShortcutArgs: () => [],
        generateMetadataCandidates: overrides.generateMetadataCandidates || (() => [{ slug: 'exact-game', title: 'Exact Game' }]),
        gamesRepository: overrides.gamesRepository || { findManualGameByPaths: () => null },
        metadataResolutionManager: overrides.metadataResolutionManager || makeMrm(),
        metadataStatus: { COOLDOWN },
        metadataCacheStore: overrides.metadataCacheStore || { save: async () => {} },
        upsertGame: overrides.upsertGame || (async (gameRecord) => { upserted.push(gameRecord); }),
        saveDatabase: overrides.saveDatabase || (() => { saves.push(1); }),
        getGameById: overrides.getGameById || (() => game),
        backgroundDownload: overrides.backgroundDownload || (async (...args) => { bgCalls.push(args); }),
        _upserted: () => upserted,
        _bgCalls: () => bgCalls,
        _saves: () => saves,
    };
}

function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenOverlap(a, b) {
    const left = new Set(normalize(a).split(/\s+/).filter(Boolean));
    const right = new Set(normalize(b).split(/\s+/).filter(Boolean));
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const token of left) if (right.has(token)) overlap++;
    return overlap / Math.max(left.size, right.size);
}

function canAcceptManualArtwork({ exeName, requestedTitle, resolvedTitle, confidence, exactExecutable = false, exactExternalId = false }) {
    if (GENERIC_EXES.has(String(exeName || '').toLowerCase())) return false;
    if (exactExecutable || exactExternalId) return true;
    if (confidence === 'verified' || confidence === 'high') return tokenOverlap(requestedTitle, resolvedTitle) >= 0.9;
    return false;
}

function chooseManualFallback({ verifiedPlatformArt, cacheById, cacheByTitle }) {
    if (verifiedPlatformArt) return verifiedPlatformArt;
    if (cacheById) return cacheById;
    return cacheByTitle?.identityVerified ? cacheByTitle.value : null;
}

test('manual add: exact executable/title match can accept verified artwork through the current use case seam', async () => {
    const tmp = makeTmpExe('ExactGame.exe');
    try {
        const meta = { cover: 'https://cdn.example/exact-cover.jpg', hero: 'https://cdn.example/exact-hero.jpg' };
        const mrm = makeMrm({
            meta,
            matchedName: 'Exact Game',
            _resolveSource: 'server',
            confidence: 'verified',
        });
        const deps = makeDeps({ metadataResolutionManager: mrm });

        const result = await addManualGame({
            launchPath: tmp.exe,
            customName: 'Exact Game',
            ...deps,
        });

        assert.equal(result.status, 'success');
        assert.equal(deps._bgCalls().length, 1);
        assert.deepEqual(deps._bgCalls()[0][0], meta);
        assert.deepEqual(deps._bgCalls()[0][3], { source: 'addManual' });
    } finally {
        tmp.cleanup();
    }
});

test('contract: low-confidence loose title match cannot assign artwork automatically', () => {
    assert.equal(canAcceptManualArtwork({
        exeName: 'space.exe',
        requestedTitle: 'Space Client',
        resolvedTitle: 'Dead Space',
        confidence: 'low',
    }), false);
});

test('contract: generic executable names do not select unrelated metadata', () => {
    for (const exeName of GENERIC_EXES) {
        assert.equal(canAcceptManualArtwork({
            exeName,
            requestedTitle: 'My Custom Game',
            resolvedTitle: 'Famous Game',
            confidence: 'verified',
        }), false, `${exeName} must not establish identity by itself`);
    }
});

test('contract: manually selected custom title does not reuse artwork merely because of token overlap', () => {
    assert.equal(canAcceptManualArtwork({
        exeName: 'custom.exe',
        requestedTitle: 'Portal Community Launcher',
        resolvedTitle: 'Portal 2',
        confidence: 'medium',
    }), false);
});

test('manual add: re-adding an existing locked manual game preserves user-owned artwork', async () => {
    const tmp = makeTmpExe('ExactGame.exe');
    try {
        const existing = {
            id: 'manual-id',
            name: 'Exact Game',
            image: 'file://settings-cover.webp',
            customArtworkLocked: true,
            artworkSource: 'settings',
            isHidden: false,
        };
        const deps = makeDeps({
            gamesRepository: { findManualGameByPaths: () => existing },
            metadataResolutionManager: makeMrm({
                meta: { cover: 'https://cdn.example/wrong-cover.jpg' },
                matchedName: 'Wrong Game',
                _resolveSource: 'server',
            }),
        });

        const result = await addManualGame({
            launchPath: tmp.exe,
            customName: 'Exact Game',
            ...deps,
        });

        assert.equal(result.status, 'success');
        assert.equal(result.game.image, 'file://settings-cover.webp');
        assert.equal(deps._bgCalls().length, 0);
        assert.equal(deps._upserted().length, 0);
    } finally {
        tmp.cleanup();
    }
});

test('contract: pipeline/manual metadata needs sufficient confidence before replacing placeholder art', () => {
    assert.equal(canAcceptManualArtwork({
        exeName: 'acmirage.exe',
        requestedTitle: 'AC Mirage',
        resolvedTitle: 'Assassin Creed Mirage',
        confidence: 'low',
    }), false);
    assert.equal(canAcceptManualArtwork({
        exeName: 'acmirage.exe',
        requestedTitle: 'Assassin Creed Mirage',
        resolvedTitle: 'Assassin Creed Mirage',
        confidence: 'high',
    }), true);
});

test('contract: cache entries from another game cannot be selected solely by normalized title collision', () => {
    const fallback = chooseManualFallback({
        verifiedPlatformArt: null,
        cacheById: null,
        cacheByTitle: {
            value: 'file://other-game-cover.webp',
            identityVerified: false,
        },
    });

    assert.equal(fallback, null);
});

test('contract: resetting manual artwork allows verified fallback, not arbitrary cached artwork', () => {
    assert.equal(chooseManualFallback({
        verifiedPlatformArt: 'file://verified-platform-cover.webp',
        cacheById: null,
        cacheByTitle: {
            value: 'file://title-collision-cover.webp',
            identityVerified: false,
        },
    }), 'file://verified-platform-cover.webp');

    assert.equal(chooseManualFallback({
        verifiedPlatformArt: null,
        cacheById: null,
        cacheByTitle: {
            value: 'file://title-collision-cover.webp',
            identityVerified: false,
        },
    }), null);
});

test('source guard: AddManualGameUseCase currently accepts resolver metadata without a confidence gate', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'games', 'application', 'useCases', 'AddManualGameUseCase.js'), 'utf8');
    const resolveIdx = src.indexOf('metadataResolutionManager.resolve');
    const bgIdx = src.indexOf('backgroundDownload', resolveIdx);
    assert.ok(resolveIdx !== -1, 'manual add must call metadataResolutionManager.resolve');
    assert.ok(bgIdx !== -1, 'manual add must call backgroundDownload when metadata exists');

    const useCaseBody = src.slice(resolveIdx, bgIdx + 700);
    assert.match(useCaseBody, /finalMetadata\s*=\s*resolveResult\.meta/, 'resolver metadata feeds manual-add artwork');
    assert.match(useCaseBody, /backgroundDownload\s*\(\s*finalMetadata/, 'finalMetadata is passed to backgroundDownload');
    assert.doesNotMatch(useCaseBody, /confidence\s*[<>!=]|identityVerified|exactExecutable/,
        'current manual-add path has no confidence/identity gate before artwork download');
});
