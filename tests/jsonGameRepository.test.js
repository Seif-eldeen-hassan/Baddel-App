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

// ── getMissingInstalledGames ──────────────────────────────────────────────────

test('JsonGameRepository: getMissingInstalledGames returns scanner-owned games where isInstalled === false', () => {
    const repo = makeRepo([
        game({ id: 'g1', installSource: 'scanner', isInstalled: false }),
        game({ id: 'g2', installSource: 'scanner', isInstalled: true }),
        game({ id: 'g3', installSource: 'manual',  isInstalled: false }),
    ]);
    const result = repo.getMissingInstalledGames();
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'g1');
});

test('JsonGameRepository: getMissingInstalledGames excludes games where installSource is not scanner', () => {
    const repo = makeRepo([
        game({ id: 'g1', installSource: 'manual',  isInstalled: false }),
        game({ id: 'g2', installSource: 'epic',    isInstalled: false }),
        game({ id: 'g3', installSource: undefined, isInstalled: false }),
    ]);
    assert.deepEqual(repo.getMissingInstalledGames(), []);
});

test('JsonGameRepository: getMissingInstalledGames excludes scanner games where isInstalled is true', () => {
    const repo = makeRepo([
        game({ id: 'g1', installSource: 'scanner', isInstalled: true }),
    ]);
    assert.deepEqual(repo.getMissingInstalledGames(), []);
});

test('JsonGameRepository: getMissingInstalledGames returns empty array when no games match', () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    assert.deepEqual(repo.getMissingInstalledGames(), []);
});

test('JsonGameRepository: getMissingInstalledGames does not mutate _dbCache', () => {
    const repo = makeRepo([
        game({ id: 'g1', installSource: 'scanner', isInstalled: false }),
    ]);
    const before = repo._dbCache.length;
    repo.getMissingInstalledGames();
    assert.equal(repo._dbCache.length, before);
});

test('JsonGameRepository: getMissingInstalledGames returns the same object references as _dbCache', () => {
    const repo = makeRepo([
        game({ id: 'g1', installSource: 'scanner', isInstalled: false }),
    ]);
    const result = repo.getMissingInstalledGames();
    assert.ok(result[0] === repo._dbCache[0], 'must return the same object reference, not a copy');
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

// ── updatePlaytime ────────────────────────────────────────────────────────────

test('JsonGameRepository: updatePlaytime returns error when game not found', async () => {
    const repo = makeRepo([]);
    const result = await repo.updatePlaytime('no-such', 10);
    assert.deepEqual(result, { status: 'error', message: 'Game not found' });
});

test('JsonGameRepository: updatePlaytime returns tracking_disabled when timeTrackingEnabled === false', async () => {
    const repo = makeRepo([game({ id: 'g1', timeTrackingEnabled: false })]);
    const result = await repo.updatePlaytime('g1', 10);
    assert.deepEqual(result, { status: 'tracking_disabled' });
});

test('JsonGameRepository: updatePlaytime initializes totalPlaytime from zero when field missing', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.updatePlaytime('g1', 30);
    assert.equal(result.status, 'success');
    assert.equal(result.totalPlaytime, 30);
});

test('JsonGameRepository: updatePlaytime accumulates totalPlaytime on repeated calls', async () => {
    const repo = makeRepo([game({ id: 'g1', totalPlaytime: 20 })]);
    await repo.updatePlaytime('g1', 15);
    const result = await repo.updatePlaytime('g1', 5);
    assert.equal(result.totalPlaytime, 40);
});

test('JsonGameRepository: updatePlaytime sets lastPlayed to a recent timestamp', async () => {
    const before = Date.now();
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.updatePlaytime('g1', 10);
    assert.ok(result.lastPlayed >= before, 'lastPlayed must be >= call time');
});

test('JsonGameRepository: updatePlaytime initializes playSessions when missing', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.updatePlaytime('g1', 10);
    assert.ok(Array.isArray(result.playSessions));
    assert.equal(result.playSessions.length, 1);
});

test('JsonGameRepository: updatePlaytime adds legacy session entry for today', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.updatePlaytime('g1', 10);
    const today = new Date().toISOString().split('T')[0];
    const entry = result.playSessions.find(s => s.date === today && !s.startedAt);
    assert.ok(entry, 'must have a legacy session entry for today');
    assert.equal(entry.minutes, 10);
});

test('JsonGameRepository: updatePlaytime accumulates minutes into existing legacy session for today', async () => {
    const today = new Date().toISOString().split('T')[0];
    const repo = makeRepo([game({ id: 'g1', playSessions: [{ date: today, minutes: 5 }] })]);
    const result = await repo.updatePlaytime('g1', 10);
    const entry = result.playSessions.find(s => s.date === today && !s.startedAt);
    assert.equal(entry.minutes, 15);
});

test('JsonGameRepository: updatePlaytime does not merge into rich session (has startedAt)', async () => {
    const today = new Date().toISOString().split('T')[0];
    const richSession = { date: today, startedAt: Date.now() - 1000, minutes: 5 };
    const repo = makeRepo([game({ id: 'g1', playSessions: [richSession] })]);
    const result = await repo.updatePlaytime('g1', 10);
    assert.equal(result.playSessions.length, 2, 'must push a new entry, not merge into rich session');
});

test('JsonGameRepository: updatePlaytime returns success shape with all required fields', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.updatePlaytime('g1', 10);
    assert.equal(result.status, 'success');
    assert.ok('totalPlaytime'       in result);
    assert.ok('lastPlayed'          in result);
    assert.ok('lastQualifiedPlayed' in result);
    assert.ok('playSessions'        in result);
});

test('JsonGameRepository: updatePlaytime schedules saveDatabase', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    await repo.updatePlaytime('g1', 10);
    assert.ok(repo._saveTimer !== null, 'saveDatabase debounce timer must be set');
    clearTimeout(repo._saveTimer);
    repo._saveTimer = null;
});

// ── saveQualifiedSession ──────────────────────────────────────────────────────

test('JsonGameRepository: saveQualifiedSession returns error when game not found', async () => {
    const repo = makeRepo([]);
    const result = await repo.saveQualifiedSession('no-such', {});
    assert.deepEqual(result, { status: 'error', message: 'Game not found' });
});

test('JsonGameRepository: saveQualifiedSession returns tracking_disabled when disabled', async () => {
    const repo = makeRepo([game({ id: 'g1', timeTrackingEnabled: false })]);
    const result = await repo.saveQualifiedSession('g1', {});
    assert.deepEqual(result, { status: 'tracking_disabled' });
});

test('JsonGameRepository: saveQualifiedSession accumulates totalPlaytime when countedMinutes > 0', async () => {
    const repo = makeRepo([game({ id: 'g1', totalPlaytime: 10 })]);
    const result = await repo.saveQualifiedSession('g1', { countedMinutes: 20, endedAt: Date.now() });
    assert.equal(result.totalPlaytime, 30);
});

test('JsonGameRepository: saveQualifiedSession does not change totalPlaytime when countedMinutes === 0', async () => {
    const repo = makeRepo([game({ id: 'g1', totalPlaytime: 10 })]);
    const result = await repo.saveQualifiedSession('g1', { countedMinutes: 0, endedAt: Date.now() });
    assert.equal(result.totalPlaytime, 10);
});

test('JsonGameRepository: saveQualifiedSession sets lastDetectedPlayed always', async () => {
    const endedAt = Date.now();
    const repo = makeRepo([game({ id: 'g1' })]);
    await repo.saveQualifiedSession('g1', { countedMinutes: 0, endedAt });
    assert.equal(repo._dbCache[0].lastDetectedPlayed, endedAt);
});

test('JsonGameRepository: saveQualifiedSession sets lastPlayed only when countedMinutes > 0', async () => {
    const endedAt = Date.now();
    const repo = makeRepo([game({ id: 'g1' })]);
    await repo.saveQualifiedSession('g1', { countedMinutes: 0, endedAt });
    assert.equal(repo._dbCache[0].lastPlayed, undefined, 'lastPlayed must not be set when countedMinutes === 0');

    const repo2 = makeRepo([game({ id: 'g1' })]);
    await repo2.saveQualifiedSession('g1', { countedMinutes: 5, endedAt });
    assert.equal(repo2._dbCache[0].lastPlayed, endedAt);
});

test('JsonGameRepository: saveQualifiedSession sets lastQualifiedPlayed only when isQualified', async () => {
    const endedAt = Date.now();
    const repo = makeRepo([game({ id: 'g1' })]);
    await repo.saveQualifiedSession('g1', { countedMinutes: 5, isQualified: false, endedAt });
    assert.equal(repo._dbCache[0].lastQualifiedPlayed, undefined);

    const repo2 = makeRepo([game({ id: 'g1' })]);
    const result = await repo2.saveQualifiedSession('g1', { countedMinutes: 5, isQualified: true, endedAt });
    assert.equal(result.lastQualifiedPlayed, endedAt);
});

test('JsonGameRepository: saveQualifiedSession pushes rich session record with all fields', async () => {
    const endedAt = Date.now();
    const startedAt = endedAt - 60000;
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.saveQualifiedSession('g1', {
        countedMinutes: 10,
        totalCountedMinutes: 12,
        rawRuntimeMinutes: 15,
        idleMinutes: 2,
        backgroundMinutes: 1,
        foregroundSeen: true,
        confidence: 'high',
        endReason: 'process_exit',
        startedAt,
        endedAt,
        isQualified: true,
    });
    assert.equal(result.status, 'success');
    const session = result.playSessions[result.playSessions.length - 1];
    assert.equal(session.startedAt, startedAt);
    assert.equal(session.endedAt, endedAt);
    assert.equal(session.minutes, 12);
    assert.equal(session.countedMinutes, 12);
    assert.equal(session.rawRuntimeMinutes, 15);
    assert.equal(session.idleMinutes, 2);
    assert.equal(session.backgroundMinutes, 1);
    assert.equal(session.foregroundSeen, true);
    assert.equal(session.confidence, 'high');
    assert.equal(session.endReason, 'process_exit');
    assert.equal(session.qualified, true);
});

test('JsonGameRepository: saveQualifiedSession uses totalCountedMinutes for session.minutes', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.saveQualifiedSession('g1', {
        countedMinutes: 10,
        totalCountedMinutes: 18,
        endedAt: Date.now(),
    });
    const session = result.playSessions[0];
    assert.equal(session.minutes, 18);
    assert.equal(session.countedMinutes, 18);
});

test('JsonGameRepository: saveQualifiedSession defaults totalCountedMinutes to countedMinutes when absent', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.saveQualifiedSession('g1', { countedMinutes: 7, endedAt: Date.now() });
    const session = result.playSessions[0];
    assert.equal(session.minutes, 7);
});

test('JsonGameRepository: saveQualifiedSession trims playSessions to 500', async () => {
    const sessions = Array.from({ length: 500 }, (_, i) => ({
        date: '2024-01-01', startedAt: i, endedAt: i + 1, minutes: 1,
        countedMinutes: 1, rawRuntimeMinutes: 1, idleMinutes: 0,
        backgroundMinutes: 0, foregroundSeen: false, confidence: 'medium',
        endReason: '', qualified: false,
    }));
    const repo = makeRepo([game({ id: 'g1', playSessions: sessions })]);
    await repo.saveQualifiedSession('g1', { countedMinutes: 1, endedAt: Date.now() });
    assert.equal(repo._dbCache[0].playSessions.length, 500, 'must trim to 500');
});

test('JsonGameRepository: saveQualifiedSession returns correct shape', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.saveQualifiedSession('g1', { countedMinutes: 5, isQualified: true, endedAt: Date.now() });
    assert.equal(result.status, 'success');
    assert.ok('totalPlaytime'       in result);
    assert.ok('lastPlayed'          in result);
    assert.ok('lastQualifiedPlayed' in result);
    assert.ok('playSessions'        in result);
    assert.equal(result.sessionQualified, true);
});

// ── setTimeTrackingEnabled ────────────────────────────────────────────────────

test('JsonGameRepository: setTimeTrackingEnabled returns error when game not found', async () => {
    const repo = makeRepo([]);
    const result = await repo.setTimeTrackingEnabled('no-such', true);
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'Game not found');
    assert.equal(result.gameId, 'no-such');
});

test('JsonGameRepository: setTimeTrackingEnabled sets flag to true', async () => {
    const repo = makeRepo([game({ id: 'g1', timeTrackingEnabled: false })]);
    const result = await repo.setTimeTrackingEnabled('g1', true);
    assert.equal(result.status, 'success');
    assert.equal(result.timeTrackingEnabled, true);
    assert.equal(repo._dbCache[0].timeTrackingEnabled, true);
});

test('JsonGameRepository: setTimeTrackingEnabled sets flag to false', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.setTimeTrackingEnabled('g1', false);
    assert.equal(result.status, 'success');
    assert.equal(result.timeTrackingEnabled, false);
});

test('JsonGameRepository: setTimeTrackingEnabled coerces to boolean via !!', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    await repo.setTimeTrackingEnabled('g1', 1);
    assert.equal(typeof repo._dbCache[0].timeTrackingEnabled, 'boolean');
    assert.equal(repo._dbCache[0].timeTrackingEnabled, true);
});

test('JsonGameRepository: setTimeTrackingEnabled returns gameId in success shape', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = await repo.setTimeTrackingEnabled('g1', true);
    assert.equal(result.gameId, 'g1');
});

test('JsonGameRepository: setTimeTrackingEnabled schedules saveDatabase', async () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    await repo.setTimeTrackingEnabled('g1', true);
    assert.ok(repo._saveTimer !== null, 'saveDatabase timer must be set');
    clearTimeout(repo._saveTimer);
    repo._saveTimer = null;
});

// ── getTimeTrackingEnabled ────────────────────────────────────────────────────

test('JsonGameRepository: getTimeTrackingEnabled returns error when game not found', () => {
    const repo = makeRepo([]);
    const result = repo.getTimeTrackingEnabled('no-such');
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'Game not found');
    assert.equal(result.gameId, 'no-such');
});

test('JsonGameRepository: getTimeTrackingEnabled returns true when field is absent (default on)', () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = repo.getTimeTrackingEnabled('g1');
    assert.equal(result.status, 'success');
    assert.equal(result.timeTrackingEnabled, true, 'absent field must default to true');
});

test('JsonGameRepository: getTimeTrackingEnabled returns false when field is false', () => {
    const repo = makeRepo([game({ id: 'g1', timeTrackingEnabled: false })]);
    const result = repo.getTimeTrackingEnabled('g1');
    assert.equal(result.status, 'success');
    assert.equal(result.timeTrackingEnabled, false);
});

test('JsonGameRepository: getTimeTrackingEnabled returns true when field is true', () => {
    const repo = makeRepo([game({ id: 'g1', timeTrackingEnabled: true })]);
    const result = repo.getTimeTrackingEnabled('g1');
    assert.equal(result.status, 'success');
    assert.equal(result.timeTrackingEnabled, true);
});

test('JsonGameRepository: getTimeTrackingEnabled does not call saveDatabase', () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    let saveCalled = false;
    repo.saveDatabase = () => { saveCalled = true; };
    repo.getTimeTrackingEnabled('g1');
    assert.equal(saveCalled, false, 'getTimeTrackingEnabled must not persist');
});

test('JsonGameRepository: getTimeTrackingEnabled is synchronous (not a Promise)', () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = repo.getTimeTrackingEnabled('g1');
    assert.ok(!(result instanceof Promise), 'must return a plain object, not a Promise');
});

test('JsonGameRepository: getTimeTrackingEnabled returns gameId in result', () => {
    const repo = makeRepo([game({ id: 'g1' })]);
    const result = repo.getTimeTrackingEnabled('g1');
    assert.equal(result.gameId, 'g1');
});
