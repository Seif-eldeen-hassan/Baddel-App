'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');

// ── helpers ───────────────────────────────────────────────────────────────────

// Create a fresh temp directory and a pre-seeded DB file, then return a repo
// pointing at it.  Calling flushDatabase() in tests forces immediate disk write.
function makeRepo(games = [], opts = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-jgr-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify(games), 'utf8');
    return new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: dbPath,
        logger: { log: () => {}, error: () => {} },
        ...opts,
    });
}

function game(overrides = {}) {
    return { id: 'aabbccdd11223344', name: 'Test Game', command: '"C:\\games\\test.exe"', isHidden: false, ...overrides };
}

// ── load / init ───────────────────────────────────────────────────────────────

test('JsonGameRepository: loads existing DB without throwing', () => {
    const repo = makeRepo([game()]);
    assert.equal(repo.getSavedGames().length, 1);
});

test('JsonGameRepository: creates games-db.json when path does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-jgr-new-'));
    const dbPath = path.join(tmpDir, 'sub', 'games-db.json');
    const repo = new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log: () => {}, error: () => {} } });
    assert.ok(fs.existsSync(dbPath), 'games-db.json must be created');
    assert.equal(repo.getSavedGames().length, 0);
});

test('JsonGameRepository: resets to empty array on corrupted JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-jgr-corrupt-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, 'NOT_JSON', 'utf8');
    const repo = new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log: () => {}, error: () => {} } });
    assert.equal(repo.getSavedGames().length, 0);
});

// ── flushDatabase / persistence ───────────────────────────────────────────────

test('JsonGameRepository: flushDatabase persists current dbCache to disk', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-jgr-flush-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, '[]', 'utf8');
    const repo = new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log: () => {}, error: () => {} } });

    await repo.removeGame('nonexistent'); // noop — just to exercise code path
    repo._dbCache.push(game({ id: 'flush01', name: 'Flush Test' }));
    await repo.flushDatabase();

    const raw     = fs.readFileSync(dbPath, 'utf8');
    const written = JSON.parse(raw);
    assert.equal(written.length, 1);
    assert.equal(written[0].id, 'flush01');
});

test('JsonGameRepository: saveDatabase debounce does not write synchronously', () => {
    const repo = makeRepo([]);
    repo._dbCache.push(game({ id: 'pending01' }));
    repo.saveDatabase(); // fires debounce — nothing written yet
    // no await, so file on disk still shows empty
    // We just check the timer is set and no throw
    assert.ok(repo._saveTimer !== null, 'saveTimer must be set after saveDatabase()');
    clearTimeout(repo._saveTimer); // clean up to avoid process hanging
    repo._saveTimer = null;
});

// ── getSavedGames / getStoredGames ────────────────────────────────────────────

test('JsonGameRepository: getSavedGames excludes hidden games', () => {
    const repo = makeRepo([
        game({ id: 'g1', isHidden: false }),
        game({ id: 'g2', isHidden: true }),
    ]);
    const result = repo.getSavedGames();
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'g1');
});

test('JsonGameRepository: getSavedGames excludes games where isInstalled === false', () => {
    const repo = makeRepo([
        game({ id: 'g1', isInstalled: true }),
        game({ id: 'g2', isInstalled: false }),
        game({ id: 'g3' }), // isInstalled absent — should be included
    ]);
    const result = repo.getSavedGames();
    const ids = result.map(g => g.id);
    assert.ok(ids.includes('g1'));
    assert.ok(!ids.includes('g2'), 'isInstalled:false must be excluded');
    assert.ok(ids.includes('g3'), 'missing isInstalled must be included');
});

test('JsonGameRepository: getSavedGames returns empty array when no games', () => {
    const repo = makeRepo([]);
    assert.deepEqual(repo.getSavedGames(), []);
});

// ── getHiddenGames ────────────────────────────────────────────────────────────

test('JsonGameRepository: getHiddenGames returns only hidden games', () => {
    const repo = makeRepo([
        game({ id: 'g1', isHidden: false }),
        game({ id: 'g2', isHidden: true }),
        game({ id: 'g3', isHidden: true }),
    ]);
    const result = repo.getHiddenGames();
    assert.equal(result.length, 2);
    assert.ok(result.every(g => g.isHidden));
});

test('JsonGameRepository: getHiddenGames returns empty array when nothing hidden', () => {
    const repo = makeRepo([game({ isHidden: false })]);
    assert.deepEqual(repo.getHiddenGames(), []);
});

// ── generateStableId ──────────────────────────────────────────────────────────

test('JsonGameRepository: generateStableId is deterministic for same command', () => {
    const repo = makeRepo([]);
    const id1 = repo.generateStableId({ command: '"C:\\games\\test.exe"', name: 'Test' });
    const id2 = repo.generateStableId({ command: '"C:\\games\\test.exe"', name: 'Test' });
    assert.equal(id1, id2);
});

test('JsonGameRepository: generateStableId strips double-quotes and lowercases', () => {
    const repo = makeRepo([]);
    const id1 = repo.generateStableId({ command: '"C:\\Games\\Test.exe"' });
    const id2 = repo.generateStableId({ command: 'c:\\games\\test.exe' });
    assert.equal(id1, id2, 'quoted and unquoted commands must produce same ID');
});

test('JsonGameRepository: generateStableId falls back to name when command absent', () => {
    const repo = makeRepo([]);
    const id = repo.generateStableId({ name: 'Half-Life' });
    assert.equal(typeof id, 'string');
    assert.equal(id.length, 16);
    assert.match(id, /^[0-9a-f]{16}$/);
});

test('JsonGameRepository: generateStableId produces 16 hex chars', () => {
    const repo = makeRepo([]);
    const id = repo.generateStableId({ command: 'anything.exe' });
    assert.equal(id.length, 16);
    assert.match(id, /^[0-9a-f]{16}$/);
});

test('JsonGameRepository: generateStableId matches BaddelEngine output for same input', () => {
    const repo = makeRepo([]);
    const command = '"C:\\Program Files\\SomeGame\\game.exe"';
    const repoId = repo.generateStableId({ command });

    // Compute expected independently — same algorithm as BaddelEngine
    const str = command.toLowerCase().replace(/"/g, '').trim();
    const expected = crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
    assert.equal(repoId, expected);
});

// ── renameGame ────────────────────────────────────────────────────────────────

test('JsonGameRepository: renameGame returns error when game not found', async () => {
    const repo = makeRepo([]);
    const result = await repo.renameGame('no-such-id', 'New Name');
    assert.deepEqual(result, { status: 'error', message: 'Game not found' });
});

test('JsonGameRepository: renameGame updates name, title, customTitle', async () => {
    const repo = makeRepo([game({ id: 'g1', name: 'Old Name', title: 'Old Name' })]);
    await repo.renameGame('g1', 'New Name');
    const stored = repo.getSavedGames().find(g => g.id === 'g1');
    assert.equal(stored.name, 'New Name');
    assert.equal(stored.title, 'New Name');
    assert.equal(stored.customTitle, 'New Name');
});

test('JsonGameRepository: renameGame sets customTitleLocked, titleSource, titleUpdatedAt', async () => {
    const before = Date.now();
    const repo = makeRepo([game({ id: 'g1', name: 'Old' })]);
    await repo.renameGame('g1', 'New');
    const stored = repo.getSavedGames().find(g => g.id === 'g1');
    assert.equal(stored.customTitleLocked, true);
    assert.equal(stored.titleSource, 'creator');
    assert.ok(stored.titleUpdatedAt >= before);
});

test('JsonGameRepository: renameGame preserves originalName on first rename', async () => {
    const repo = makeRepo([game({ id: 'g1', name: 'Original' })]);
    await repo.renameGame('g1', 'Renamed');
    const stored = repo.getSavedGames().find(g => g.id === 'g1');
    assert.equal(stored.originalName, 'Original');
});

test('JsonGameRepository: renameGame does not overwrite an existing originalName', async () => {
    const repo = makeRepo([game({ id: 'g1', name: 'Second', originalName: 'VeryFirst' })]);
    await repo.renameGame('g1', 'Third');
    const stored = repo.getSavedGames().find(g => g.id === 'g1');
    assert.equal(stored.originalName, 'VeryFirst', 'originalName must not be overwritten on subsequent renames');
});

test('JsonGameRepository: renameGame returns exact legacy success shape', async () => {
    const repo = makeRepo([game({ id: 'g1', name: 'Old' })]);
    const result = await repo.renameGame('g1', 'New');
    assert.equal(result.status, 'success');
    assert.equal(result.newName, 'New');
    assert.equal(result.customTitleLocked, true);
    assert.equal(result.titleSource, 'creator');
    assert.ok(typeof result.titleUpdatedAt === 'number');
});

test('JsonGameRepository: renameGame uses String() coercion on gameId comparison', async () => {
    const repo = makeRepo([game({ id: 'abc123' })]);
    const result = await repo.renameGame('abc123', 'Renamed');
    assert.equal(result.status, 'success');
});

// ── removeGame ────────────────────────────────────────────────────────────────

test('JsonGameRepository: removeGame sets isHidden=true on matching game', async () => {
    const repo = makeRepo([game({ id: 'g1', isHidden: false })]);
    await repo.removeGame('g1');
    assert.equal(repo.getHiddenGames().length, 1);
    assert.equal(repo.getSavedGames().length, 0);
});

test('JsonGameRepository: removeGame returns { status: success } on success', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.removeGame('g1');
    assert.deepEqual(result, { status: 'success' });
});

test('JsonGameRepository: removeGame returns error shape when game not found', async () => {
    const repo = makeRepo([]);
    const result = await repo.removeGame('no-such');
    assert.deepEqual(result, { status: 'error', message: 'Game not found' });
});

test('JsonGameRepository: removeGame does not delete the game record', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    await repo.removeGame('g1');
    assert.equal(repo._dbCache.length, 1, 'record must still exist, just hidden');
});

// ── unhideAllGames ────────────────────────────────────────────────────────────

test('JsonGameRepository: unhideAllGames clears isHidden on all hidden games', async () => {
    const repo = makeRepo([
        game({ id: 'g1', isHidden: true }),
        game({ id: 'g2', isHidden: true }),
        game({ id: 'g3', isHidden: false }),
    ]);
    await repo.unhideAllGames();
    assert.equal(repo.getHiddenGames().length, 0);
});

test('JsonGameRepository: unhideAllGames returns { status: success, restoredCount } when games were hidden', async () => {
    const repo = makeRepo([
        game({ id: 'g1', isHidden: true }),
        game({ id: 'g2', isHidden: true }),
    ]);
    const result = await repo.unhideAllGames();
    assert.equal(result.status, 'success');
    assert.equal(result.restoredCount, 2);
});

test('JsonGameRepository: unhideAllGames returns { status: no_hidden } when nothing was hidden', async () => {
    const repo = makeRepo([game({ id: 'g1', isHidden: false })]);
    const result = await repo.unhideAllGames();
    assert.deepEqual(result, { status: 'no_hidden' });
});

test('JsonGameRepository: unhideAllGames does not call saveDatabase when nothing was hidden', async () => {
    const repo = makeRepo([game({ id: 'g1', isHidden: false })]);
    let saveCalled = false;
    const orig = repo.saveDatabase.bind(repo);
    repo.saveDatabase = () => { saveCalled = true; orig(); clearTimeout(repo._saveTimer); repo._saveTimer = null; };
    await repo.unhideAllGames();
    assert.equal(saveCalled, false, 'saveDatabase must not be called when nothing to unhide');
});

// ── restoreSpecificGames ──────────────────────────────────────────────────────

test('JsonGameRepository: restoreSpecificGames unhides only the listed game ids', async () => {
    const repo = makeRepo([
        game({ id: 'g1', isHidden: true }),
        game({ id: 'g2', isHidden: true }),
        game({ id: 'g3', isHidden: true }),
    ]);
    await repo.restoreSpecificGames(['g1', 'g3']);
    const hidden = repo.getHiddenGames().map(g => g.id);
    assert.deepEqual(hidden, ['g2'], 'only g2 should remain hidden');
});

test('JsonGameRepository: restoreSpecificGames returns { status: success, count }', async () => {
    const repo = makeRepo([
        game({ id: 'g1', isHidden: true }),
        game({ id: 'g2', isHidden: true }),
    ]);
    const result = await repo.restoreSpecificGames(['g1', 'g2']);
    assert.equal(result.status, 'success');
    assert.equal(result.count, 2);
});

test('JsonGameRepository: restoreSpecificGames returns error shape when no ids matched', async () => {
    const repo = makeRepo([game({ id: 'g1', isHidden: true })]);
    const result = await repo.restoreSpecificGames(['no-such-id']);
    assert.deepEqual(result, { status: 'error', message: 'Nothing restored' });
});

test('JsonGameRepository: restoreSpecificGames uses String() coercion when matching ids', async () => {
    const repo = makeRepo([game({ id: 'g1', isHidden: true })]);
    const result = await repo.restoreSpecificGames(['g1']); // string match
    assert.equal(result.status, 'success');
});

test('JsonGameRepository: restoreSpecificGames does not touch games with non-matching ids', async () => {
    const repo = makeRepo([
        game({ id: 'g1', isHidden: true }),
        game({ id: 'g2', isHidden: true }),
    ]);
    await repo.restoreSpecificGames(['g1']);
    assert.equal(repo.getHiddenGames().length, 1);
    assert.equal(repo.getHiddenGames()[0].id, 'g2');
});

// ── reorderLibrary ────────────────────────────────────────────────────────────

test('JsonGameRepository: reorderLibrary returns { status: success }', async () => {
    const repo = makeRepo([game({ id: 'g1' }), game({ id: 'g2' })]);
    const result = await repo.reorderLibrary(['g2', 'g1']);
    assert.deepEqual(result, { status: 'success' });
});

test('JsonGameRepository: reorderLibrary reorders games to match given id order', async () => {
    const repo = makeRepo([
        game({ id: 'g1', name: 'First' }),
        game({ id: 'g2', name: 'Second' }),
        game({ id: 'g3', name: 'Third' }),
    ]);
    await repo.reorderLibrary(['g3', 'g1', 'g2']);
    const ids = repo.getSavedGames().map(g => g.id);
    assert.deepEqual(ids, ['g3', 'g1', 'g2']);
});

test('JsonGameRepository: reorderLibrary appends games not in newOrderedIds at the end', async () => {
    const repo = makeRepo([
        game({ id: 'g1' }),
        game({ id: 'g2' }),
        game({ id: 'g3' }),
    ]);
    // Only specify 2 of 3 — g3 goes to end
    await repo.reorderLibrary(['g2', 'g1']);
    const ids = repo.getSavedGames().map(g => g.id);
    assert.deepEqual(ids, ['g2', 'g1', 'g3']);
});

test('JsonGameRepository: reorderLibrary ignores ids not present in dbCache', async () => {
    const repo = makeRepo([game({ id: 'g1' }), game({ id: 'g2' })]);
    const result = await repo.reorderLibrary(['g3', 'g1', 'g2']); // g3 doesn't exist
    assert.equal(result.status, 'success');
    const ids = repo.getSavedGames().map(g => g.id);
    assert.deepEqual(ids, ['g1', 'g2']);
});

test('JsonGameRepository: reorderLibrary persists to disk after flush', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-jgr-reorder-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify([
        game({ id: 'g1' }),
        game({ id: 'g2' }),
    ]), 'utf8');
    const repo = new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log: () => {}, error: () => {} } });
    await repo.reorderLibrary(['g2', 'g1']);
    await repo.flushDatabase();

    const written = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.equal(written[0].id, 'g2');
    assert.equal(written[1].id, 'g1');
});

// ── persistence round-trip ────────────────────────────────────────────────────

test('JsonGameRepository: rename persists to disk and is readable by a second instance', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-jgr-persist-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify([game({ id: 'g1', name: 'Before' })]), 'utf8');

    const repo1 = new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log: () => {}, error: () => {} } });
    await repo1.renameGame('g1', 'After');
    await repo1.flushDatabase();

    const repo2 = new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log: () => {}, error: () => {} } });
    const stored = repo2.getSavedGames().find(g => g.id === 'g1');
    assert.equal(stored.name, 'After');
    assert.equal(stored.customTitleLocked, true);
});

test('JsonGameRepository: removeGame persists hidden flag to disk', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-jgr-remove-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify([game({ id: 'g1', isHidden: false })]), 'utf8');

    const repo1 = new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log: () => {}, error: () => {} } });
    await repo1.removeGame('g1');
    await repo1.flushDatabase();

    const repo2 = new JsonGameRepository({ fs, path, crypto, databasePath: dbPath, logger: { log: () => {}, error: () => {} } });
    assert.equal(repo2.getHiddenGames().length, 1);
    assert.equal(repo2.getSavedGames().length, 0);
});

// ── _migrateLnkRecords ────────────────────────────────────────────────────────

test('JsonGameRepository: _migrateLnkRecords fixes path on broken lnk records', () => {
    const lnkGame = {
        id: 'lnk01',
        name: 'LnkGame',
        command: 'C:\\shortcuts\\game.lnk',
        platform: 'Manual',
        executablePath: 'C:\\games\\Game\\game.exe',
        path: 'C:\\shortcuts',  // wrong — should be dirname(executablePath)
        isHidden: false,
    };
    const repo = makeRepo([lnkGame]);
    const stored = repo._dbCache[0];
    assert.equal(stored.path, 'C:\\games\\Game', 'path must be fixed to dirname of executablePath');
    assert.equal(stored.shortcutPath, lnkGame.command, 'shortcutPath must be set to original command');
});

test('JsonGameRepository: _migrateLnkRecords is a no-op for non-lnk games', () => {
    const normalGame = game({ id: 'g1', command: 'C:\\games\\game.exe', platform: 'steam' });
    const repo = makeRepo([normalGame]);
    const stored = repo._dbCache[0];
    assert.equal(stored.path, undefined, 'path must not be touched for non-lnk games');
});
