'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

process.env.BADDEL_TEST_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-upsert-singleton-'));

const { BaddelEngine } = require('../src/features/games/infrastructure/legacy/BaddelEngine');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(prefix = 'baddel-upsert-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeEngine() {
    const dbFolder = makeTempDir();
    return new BaddelEngine({
        dbFolder,
        programData: path.join(dbFolder, 'ProgramData'),
        skipMetadataServerSync: true,
    });
}

// Minimal game object that can be upserted without id generation conflicts.
function makeGame(overrides = {}) {
    return {
        name:           'Test Game',
        command:        '"C:\\Games\\Test\\test.exe"',
        path:           'C:\\Games\\Test',
        executablePath: 'C:\\Games\\Test\\test.exe',
        platform:       'pc',
        scannerPlatform: 'manual',
        installSource:  'manual',
        isInstalled:    true,
        ...overrides,
    };
}

// Pre-populate a game directly into the live DB array (bypasses upsert) so we can test
// update paths without id/key/command collisions changing the baseline.
function seedGame(engine, overrides = {}) {
    const g = {
        id:              'seed-id-' + Math.random().toString(36).slice(2),
        name:            'Seeded Game',
        command:         '"C:\\Games\\Seeded\\game.exe"',
        path:            'C:\\Games\\Seeded',
        executablePath:  'C:\\Games\\Seeded\\game.exe',
        platform:        'pc',
        scannerPlatform: 'manual',
        installSource:   'manual',
        installedGameKey: null,
        addedAt:         '2024-01-01T00:00:00.000Z',
        firstSeenAt:     '2024-01-01T00:00:00.000Z',
        lastSeenAt:      '2024-01-01T00:00:00.000Z',
        score:           100,
        isHidden:        false,
        isInstalled:     true,
        image:           null,
        heroImage:       null,
        logo:            null,
        defaultImage:    null,
        defaultHero:     null,
        defaultLogo:     null,
        allIds:          {},
        ...overrides,
    };
    engine.getAllGames().push(g);
    return g;
}

// ── INSERT path ───────────────────────────────────────────────────────────────

test('upsertGame: inserts a new game into an empty DB', async () => {
    const engine = makeEngine();
    assert.equal(engine.getAllGames().length, 0);

    await engine.upsertGame(makeGame({ id: 'g1', name: 'Alpha' }));

    assert.equal(engine.getAllGames().length, 1);
    assert.equal(engine.getAllGames()[0].name, 'Alpha');
});

test('upsertGame: insert sets addedAt to current ISO string', async () => {
    const engine = makeEngine();
    const before = new Date().toISOString();
    await engine.upsertGame(makeGame({ id: 'g1' }));
    const after = new Date().toISOString();
    const addedAt = engine.getAllGames()[0].addedAt;
    assert.ok(addedAt >= before, 'addedAt must be >= before');
    assert.ok(addedAt <= after, 'addedAt must be <= after');
});

test('upsertGame: insert sets score:100 and isHidden:false as defaults when game omits them', async () => {
    const engine = makeEngine();
    const game = makeGame({ id: 'g1' });
    delete game.score;
    delete game.isHidden;
    await engine.upsertGame(game);
    assert.equal(engine.getAllGames()[0].score,    100);
    assert.equal(engine.getAllGames()[0].isHidden, false);
});

test('upsertGame: insert stores image/heroImage/logo from game object', async () => {
    const engine = makeEngine();
    await engine.upsertGame(makeGame({
        id:        'g1',
        image:     'file://cover.webp',
        heroImage: 'file://hero.webp',
        logo:      'file://logo.webp',
    }));
    const g = engine.getAllGames()[0];
    assert.equal(g.image,     'file://cover.webp');
    assert.equal(g.heroImage, 'file://hero.webp');
    assert.equal(g.logo,      'file://logo.webp');
});

test('upsertGame: insert sets defaultImage/Hero/Logo to match image fields', async () => {
    const engine = makeEngine();
    await engine.upsertGame(makeGame({
        id:        'g1',
        image:     'file://cover.webp',
        heroImage: 'file://hero.webp',
        logo:      'file://logo.webp',
    }));
    const g = engine.getAllGames()[0];
    assert.equal(g.defaultImage, 'file://cover.webp');
    assert.equal(g.defaultHero,  'file://hero.webp');
    assert.equal(g.defaultLogo,  'file://logo.webp');
});

test('upsertGame: insert recovers cover from image cache when game.image is absent', async () => {
    const engine = makeEngine();
    // Place a cover file in the image cache directory
    const cacheDir = path.join(engine.dbFolder, 'image_cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'cover_cached-game.webp'), 'x');

    await engine.upsertGame(makeGame({ id: 'cached-game', image: null }));

    const g = engine.getAllGames()[0];
    assert.ok(g.image && g.image.startsWith('file://'), 'image must be recovered from cache');
    assert.ok(g.image.includes('cover_cached-game'), 'image must point to the cached file');
    assert.equal(g.defaultImage, g.image, 'defaultImage must mirror image when recovered from cache');
});

test('upsertGame: insert leaves image null when nothing in game object or cache', async () => {
    const engine = makeEngine();
    await engine.upsertGame(makeGame({ id: 'g1', image: null, heroImage: null, logo: null }));
    const g = engine.getAllGames()[0];
    assert.equal(g.image,     null);
    assert.equal(g.heroImage, null);
    assert.equal(g.logo,      null);
});

test('upsertGame: generates stable id when game.id is absent', async () => {
    const engine = makeEngine();
    const game = makeGame({ name: 'No ID Game' });
    delete game.id;
    await engine.upsertGame(game);
    assert.ok(engine.getAllGames().length === 1, 'game must be inserted');
    assert.ok(game.id, 'game.id must be populated after upsert');
    assert.equal(typeof game.id, 'string', 'generated id must be a string');
});

test('upsertGame: stamps installedGameKey on the game object when absent', async () => {
    const engine = makeEngine();
    const game = makeGame({ id: 'g1', installedGameKey: undefined, scannerPlatform: 'steam', allIds: { steam: '999' } });
    await engine.upsertGame(game);
    assert.equal(game.installedGameKey, 'steam:999');
});

// ── UPDATE path — id match ────────────────────────────────────────────────────

test('upsertGame: updates existing game on id match instead of inserting', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, { id: 'match-id', installSource: 'manual' });

    await engine.upsertGame(makeGame({ id: existing.id, installSource: 'scanner' }));

    assert.equal(engine.getAllGames().length, 1, 'no duplicate must be created');
    assert.equal(engine.getAllGames()[0].installSource, 'scanner',
        'updatable field must reflect incoming value');
});

test('upsertGame: preserves existing.id in the merged record', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, { id: 'original-id' });

    // Upsert with same id — id: existing.id assignment is redundant here but must not break
    await engine.upsertGame(makeGame({ id: existing.id }));

    assert.equal(engine.getAllGames()[0].id, 'original-id');
});

test('upsertGame: deep-merges allIds from existing and incoming game', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, { id: 'g1', allIds: { steam: '111', epic: 'abc' } });

    await engine.upsertGame(makeGame({ id: existing.id, allIds: { epic: 'xyz', riot: 'lr' } }));

    const merged = engine.getAllGames()[0].allIds;
    assert.equal(merged.steam, '111',  'existing-only key must survive');
    assert.equal(merged.epic,  'xyz',  'incoming key must override existing key');
    assert.equal(merged.riot,  'lr',   'incoming-only key must be added');
});

test('upsertGame: preserves existing.firstSeenAt when both exist', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, { id: 'g1', firstSeenAt: '2023-01-01T00:00:00.000Z' });

    await engine.upsertGame(makeGame({ id: existing.id, firstSeenAt: '2024-01-01T00:00:00.000Z' }));

    assert.equal(engine.getAllGames()[0].firstSeenAt, '2023-01-01T00:00:00.000Z',
        'firstSeenAt must keep the earliest timestamp');
});

test('upsertGame: falls back to game.firstSeenAt when existing.firstSeenAt is null', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, { id: 'g1', firstSeenAt: null });

    await engine.upsertGame(makeGame({ id: existing.id, firstSeenAt: '2024-06-01T00:00:00.000Z' }));

    assert.equal(engine.getAllGames()[0].firstSeenAt, '2024-06-01T00:00:00.000Z');
});

test('upsertGame: image update prefers incoming image over existing', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, { id: 'g1', image: 'file://old-cover.webp' });

    await engine.upsertGame(makeGame({ id: existing.id, image: 'file://new-cover.webp' }));

    assert.equal(engine.getAllGames()[0].image, 'file://new-cover.webp');
});

test('upsertGame: image update preserves existing image when incoming is null/falsy', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, { id: 'g1', image: 'file://keep-this.webp' });

    await engine.upsertGame(makeGame({ id: existing.id, image: null }));

    assert.equal(engine.getAllGames()[0].image, 'file://keep-this.webp',
        'existing image must be preserved when incoming image is null');
});

test('upsertGame: defaultImage in update uses existing.defaultImage first', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, {
        id:           'g1',
        defaultImage: 'file://locked-default.webp',
        image:        'file://current.webp',
    });

    await engine.upsertGame(makeGame({ id: existing.id, image: 'file://fresh.webp' }));

    assert.equal(engine.getAllGames()[0].defaultImage, 'file://locked-default.webp',
        'defaultImage must not be overwritten when existing.defaultImage is set');
});

test('upsertGame: defaultImage in update falls through to existing.image when defaultImage is null', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, {
        id:           'g1',
        defaultImage: null,
        image:        'file://existing-cover.webp',
    });

    await engine.upsertGame(makeGame({ id: existing.id, image: null }));

    assert.equal(engine.getAllGames()[0].defaultImage, 'file://existing-cover.webp');
});

test('upsertGame: removedFromDiskAt and missingReason are null when isInstalled is true', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, {
        id:                'g1',
        isInstalled:       false,
        removedFromDiskAt: '2024-03-01T00:00:00.000Z',
        missingReason:     'uninstalled',
    });

    await engine.upsertGame(makeGame({ id: existing.id, isInstalled: true }));

    assert.equal(engine.getAllGames()[0].removedFromDiskAt, null);
    assert.equal(engine.getAllGames()[0].missingReason,     null);
});

test('upsertGame: removedFromDiskAt and missingReason preserved when isInstalled is false', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, {
        id:                'g1',
        isInstalled:       true,
        removedFromDiskAt: null,
        missingReason:     null,
    });

    await engine.upsertGame(makeGame({
        id:                existing.id,
        isInstalled:       false,
        removedFromDiskAt: '2024-05-10T00:00:00.000Z',
        missingReason:     'disk_removed',
    }));

    assert.equal(engine.getAllGames()[0].removedFromDiskAt, '2024-05-10T00:00:00.000Z');
    assert.equal(engine.getAllGames()[0].missingReason,     'disk_removed');
});

test('upsertGame: exeCandidates from incoming array overrides existing', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, {
        id:            'g1',
        exeCandidates: ['old.exe'],
    });

    await engine.upsertGame(makeGame({ id: existing.id, exeCandidates: ['new.exe'] }));

    assert.deepEqual(engine.getAllGames()[0].exeCandidates, ['new.exe']);
});

test('upsertGame: exeCandidates from existing preserved when incoming is not an array', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, {
        id:            'g1',
        exeCandidates: ['keep.exe'],
    });

    const game = makeGame({ id: existing.id });
    delete game.exeCandidates;
    await engine.upsertGame(game);

    assert.deepEqual(engine.getAllGames()[0].exeCandidates, ['keep.exe']);
});

test('upsertGame: validationWarnings from incoming array overrides existing', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, {
        id:                 'g1',
        validationWarnings: ['old-warning'],
    });

    await engine.upsertGame(makeGame({ id: existing.id, validationWarnings: ['new-warning'] }));

    assert.deepEqual(engine.getAllGames()[0].validationWarnings, ['new-warning']);
});

test('upsertGame: validationWarnings defaults to [] when neither side has an array', async () => {
    const engine = makeEngine();
    const existing = seedGame(engine, { id: 'g1', validationWarnings: null });

    const game = makeGame({ id: existing.id });
    delete game.validationWarnings;
    await engine.upsertGame(game);

    assert.deepEqual(engine.getAllGames()[0].validationWarnings, []);
});

// ── UPDATE path — installedGameKey match ──────────────────────────────────────

test('upsertGame: updates existing game when installedGameKey matches (id does not match)', async () => {
    const engine = makeEngine();
    // Seed a Steam game with a known installedGameKey
    seedGame(engine, {
        id:               'seed-steam-1',
        name:             'Steam Game A',
        scannerPlatform:  'steam',
        allIds:           { steam: '70000' },
        installedGameKey: 'steam:70000',
        installSource:    'manual',
    });

    // Incoming game has different id but same Steam key
    await engine.upsertGame(makeGame({
        id:              'incoming-different-id',
        name:            'Steam Game A Updated',
        scannerPlatform: 'steam',
        allIds:          { steam: '70000' },
        installSource:   'scanner',
    }));

    assert.equal(engine.getAllGames().length, 1, 'no duplicate must be created');
    assert.equal(engine.getAllGames()[0].id, 'seed-steam-1', 'existing id must be preserved');
    assert.equal(engine.getAllGames()[0].installSource, 'scanner',
        'updatable field must reflect incoming value');
});

// ── UPDATE path — command match ───────────────────────────────────────────────

test('upsertGame: updates existing game when normalized command matches', async () => {
    const engine = makeEngine();
    // Seed game with a unique path-based key that won't match the incoming
    seedGame(engine, {
        id:               'cmd-seed',
        name:             'Command Match Game',
        installedGameKey: 'manual:path:xxxx', // different key
        installSource:    'manual',
        command:          '"C:\\Games\\CmdGame\\game.exe"',
    });

    // Incoming has different id and key but same command (different quoting/case)
    await engine.upsertGame(makeGame({
        id:               'cmd-incoming',
        name:             'Command Match Game Updated',
        installedGameKey: 'manual:path:yyyy',
        installSource:    'scanner',
        command:          'C:\\Games\\CmdGame\\game.exe', // no quotes, same after normalization
    }));

    assert.equal(engine.getAllGames().length, 1, 'command match must prevent duplicate insertion');
    assert.equal(engine.getAllGames()[0].installSource, 'scanner',
        'updatable field must reflect incoming value');
});

test('upsertGame: command match is case-insensitive and strips double quotes', async () => {
    const engine = makeEngine();
    seedGame(engine, {
        id:               'ci-seed',
        installedGameKey: 'manual:name:ci-seed',
        command:          '"C:\\Games\\GAME.EXE"',
    });

    await engine.upsertGame(makeGame({
        id:               'ci-incoming',
        installedGameKey: 'manual:name:ci-incoming',
        command:          'c:\\games\\game.exe',
    }));

    assert.equal(engine.getAllGames().length, 1, 'case-insensitive command match must prevent duplicate');
});

// ── saveDatabase not called ───────────────────────────────────────────────────

test('upsertGame: does not call saveDatabase — caller owns persistence', async () => {
    const engine = makeEngine();
    let saveCalled = false;
    const originalSave = engine.saveDatabase.bind(engine);
    engine.saveDatabase = () => { saveCalled = true; return originalSave(); };

    await engine.upsertGame(makeGame({ id: 'g1' }));

    assert.equal(saveCalled, false,
        'upsertGame must not call saveDatabase; caller owns persistence timing');
});

// ── no-duplicate isolation ────────────────────────────────────────────────────

test('upsertGame: calling twice with same id produces only one record', async () => {
    const engine = makeEngine();
    await engine.upsertGame(makeGame({ id: 'dup-id', installSource: 'manual' }));
    await engine.upsertGame(makeGame({ id: 'dup-id', installSource: 'scanner' }));
    assert.equal(engine.getAllGames().length, 1, 'no duplicate must be created on second upsert');
    assert.equal(engine.getAllGames()[0].installSource, 'scanner',
        'second upsert must update the record in-place');
});

test('upsertGame: two games with different ids and keys are both inserted', async () => {
    const engine = makeEngine();
    await engine.upsertGame(makeGame({
        id:      'alpha',
        command: '"C:\\A\\a.exe"',
        path:    'C:\\A',
        executablePath: 'C:\\A\\a.exe',
    }));
    await engine.upsertGame(makeGame({
        id:      'beta',
        command: '"C:\\B\\b.exe"',
        path:    'C:\\B',
        executablePath: 'C:\\B\\b.exe',
    }));
    assert.equal(engine.getAllGames().length, 2);
});

// ── findInCache timing ────────────────────────────────────────────────────────

test('upsertGame: update path does not call findInCache', async () => {
    const engine = makeEngine();
    // Seed a game so the next upsert hits the UPDATE branch.
    seedGame(engine, { id: 'fc-test', installSource: 'manual' });

    let findInCacheCalled = false;
    const orig = engine.findInCache.bind(engine);
    engine.findInCache = (...args) => { findInCacheCalled = true; return orig(...args); };

    await engine.upsertGame(makeGame({ id: 'fc-test', installSource: 'scanner' }));

    assert.equal(findInCacheCalled, false,
        'findInCache must not be called on the UPDATE path');
    assert.equal(engine.getAllGames()[0].installSource, 'scanner', 'record must still be updated');
});

test('upsertGame: insert path calls findInCache when image fields are absent', async () => {
    const engine = makeEngine();
    let findInCacheCalled = false;
    const orig = engine.findInCache.bind(engine);
    engine.findInCache = (...args) => { findInCacheCalled = true; return orig(...args); };

    await engine.upsertGame(makeGame({ id: 'fc-insert', image: null, heroImage: null, logo: null }));

    assert.equal(findInCacheCalled, true,
        'findInCache must be called on the INSERT path when image fields are absent');
});
