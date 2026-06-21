'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const os     = require('os');
const nodePath = require('path');
const nodeFs   = require('fs');

const { addManualGame } = require('../src/features/games/application/useCases/AddManualGameUseCase');

// ── Helpers ───────────────────────────────────────────────────────────────────

const COOLDOWN = 'cooldown';
const IDLE     = 'idle';

function makeTmpFile() {
    const dir  = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'baddel-amu-'));
    const game = nodePath.join(dir, 'Games', 'MyGame', 'MyGame.exe');
    nodeFs.mkdirSync(nodePath.dirname(game), { recursive: true });
    nodeFs.writeFileSync(game, '');
    return { dir, game, cleanup: () => { try { nodeFs.rmSync(dir, { recursive: true, force: true }); } catch { /**/ } } };
}

function makeFakeFs(isFile = true, throws = false) {
    return {
        stat: async (p) => {
            if (throws) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            return { isFile: () => isFile };
        },
    };
}

function makeFakeFsSync(exists = true) {
    return { existsSync: () => exists };
}

function makeMrm({ status = IDLE, resolveResult = null } = {}) {
    const calls = { getStatus: [], resolve: [] };
    return {
        getStatus: (id) => { calls.getStatus.push(id); return status; },
        resolve:   async (id, hints) => { calls.resolve.push({ id, hints }); return resolveResult; },
        _calls: () => calls,
    };
}

function makeDeps(overrides = {}) {
    const upserted = [];
    const saved    = [];
    const bgCalls  = [];
    const dbSaves  = [];
    const game     = overrides.game || { id: 'test-id', name: 'MyGame', platform: 'Manual' };

    return {
        fs:   makeFakeFs(overrides.isFile ?? true, overrides.fsThrows ?? false),
        fsSync: makeFakeFsSync(overrides.existsSync ?? true),

        generateStableId:           overrides.generateStableId          ?? (() => 'test-id'),
        parseShortcutArgs:          overrides.parseShortcutArgs         ?? (() => []),
        generateMetadataCandidates: overrides.generateMetadataCandidates ?? (() => [{ slug: 'mygame' }]),

        gamesRepository: overrides.gamesRepository ?? {
            findManualGameByPaths: () => null,
        },
        metadataResolutionManager: overrides.metadataResolutionManager ?? makeMrm(),
        metadataStatus: { COOLDOWN },
        metadataCacheStore: overrides.metadataCacheStore ?? {
            save: async () => {},
        },

        upsertGame:         overrides.upsertGame         ?? (async (g) => { upserted.push(g); }),
        saveDatabase:       overrides.saveDatabase        ?? (() => { dbSaves.push(1); }),
        getGameById:        overrides.getGameById         ?? (() => game),
        backgroundDownload: overrides.backgroundDownload  ?? (async (...a) => { bgCalls.push(a); }),

        _upserted: () => upserted,
        _bgCalls:  () => bgCalls,
        _dbSaves:  () => dbSaves,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('addManualGame: fs.stat throws → returns error', async () => {
    const deps = makeDeps({ fsThrows: true });
    const result = await addManualGame({ launchPath: 'C:\\missing.exe', ...deps });
    assert.equal(result.status, 'error');
    assert.ok(result.message, 'must have error message');
    assert.equal(deps._upserted().length, 0, 'upsertGame must not be called');
    assert.equal(deps._bgCalls().length,  0, 'backgroundDownload must not be called');
});

test('addManualGame: stat.isFile() false → returns File not found error', async () => {
    const deps = makeDeps({ isFile: false });
    const result = await addManualGame({ launchPath: 'C:\\not-a-file', ...deps });
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'File not found');
    assert.equal(deps._upserted().length, 0);
});

test('addManualGame: existing visible duplicate → returns success immediately, no upsert', async () => {
    const existingGame = { id: 'existing', name: 'Existing', isHidden: false };
    const deps = makeDeps({
        gamesRepository: { findManualGameByPaths: () => existingGame },
    });
    const result = await addManualGame({ launchPath: 'C:\\Games\\Game\\game.exe', ...deps });
    assert.equal(result.status, 'success');
    assert.deepEqual(result.game, existingGame);
    assert.equal(deps._upserted().length, 0, 'no upsert for duplicate');
    assert.equal(deps._bgCalls().length,  0, 'no backgroundDownload for duplicate');
});

test('addManualGame: existing hidden duplicate → unhides and saves, returns success', async () => {
    const existingGame = { id: 'hidden-id', name: 'Hidden Game', isHidden: true };
    const dbSaves = [];
    const deps = makeDeps({
        gamesRepository: { findManualGameByPaths: () => existingGame },
        saveDatabase: () => { dbSaves.push(1); },
    });
    const result = await addManualGame({ launchPath: 'C:\\Games\\Game\\game.exe', ...deps });
    assert.equal(result.status, 'success');
    assert.equal(existingGame.isHidden, false, 'isHidden must be cleared');
    assert.ok(dbSaves.length >= 1, 'saveDatabase must be called to persist unhide');
    assert.equal(deps._upserted().length, 0, 'no upsertGame needed for re-add');
});

test('addManualGame: successful add without metadata — upsert and save called, backgroundDownload skipped', async () => {
    const tmp = makeTmpFile();
    try {
        const deps = makeDeps({
            fs: require('fs').promises,
            fsSync: require('fs'),
        });
        const result = await addManualGame({ launchPath: tmp.game, ...deps });
        assert.equal(result.status, 'success');
        assert.ok(result.game, 'must return a game');
        assert.equal(deps._upserted().length, 1, 'upsertGame called once');
        assert.equal(deps._dbSaves().length,  1, 'saveDatabase called once');
        assert.equal(deps._bgCalls().length,  0, 'no backgroundDownload when no metadata');
    } finally { tmp.cleanup(); }
});

test('addManualGame: successful add with metadata — metadataCacheStore.save and backgroundDownload called', async () => {
    const tmp = makeTmpFile();
    try {
        const meta = { cover: 'https://cdn/cover.jpg', hero: 'https://cdn/hero.jpg', logo: null };
        const saveCalls = [];
        const deps = makeDeps({
            fs:     require('fs').promises,
            fsSync: require('fs'),
            metadataResolutionManager: makeMrm({
                resolveResult: { meta, matchedName: 'MyGame Resolved', _resolveSource: 'server' },
            }),
            metadataCacheStore: {
                save: async (...a) => { saveCalls.push(a); },
            },
        });

        const result = await addManualGame({ launchPath: tmp.game, customName: 'MyGame', ...deps });
        assert.equal(result.status, 'success');
        assert.equal(deps._upserted().length,   1, 'upsertGame called');
        assert.ok(saveCalls.length >= 1,           'metadataCacheStore.save called');
        assert.equal(deps._bgCalls().length, 1,    'backgroundDownload called once');

        const [bgMeta, bgGameId, , bgOpts] = deps._bgCalls()[0];
        assert.deepEqual(bgMeta, meta);
        assert.equal(bgGameId, 'test-id');
        assert.deepEqual(bgOpts, { source: 'addManual' });
    } finally { tmp.cleanup(); }
});

test('addManualGame: forceMetadata=true — resolve receives force:true and bypassTtl:true', async () => {
    const tmp = makeTmpFile();
    try {
        const mrm = makeMrm({ resolveResult: null });
        const deps = makeDeps({
            fs:     require('fs').promises,
            fsSync: require('fs'),
            metadataResolutionManager: mrm,
        });
        await addManualGame({ launchPath: tmp.game, options: { forceMetadata: true }, ...deps });
        assert.equal(mrm._calls().resolve.length, 1, 'resolve must be called');
        const hints = mrm._calls().resolve[0].hints;
        assert.equal(hints.force,     true, 'must pass force:true');
        assert.equal(hints.bypassTtl, true, 'must pass bypassTtl:true');
    } finally { tmp.cleanup(); }
});

test('addManualGame: options.force=true — same as forceMetadata:true for resolve hints', async () => {
    const tmp = makeTmpFile();
    try {
        const mrm = makeMrm({ resolveResult: null });
        const deps = makeDeps({
            fs:     require('fs').promises,
            fsSync: require('fs'),
            metadataResolutionManager: mrm,
        });
        await addManualGame({ launchPath: tmp.game, options: { force: true }, ...deps });
        const hints = mrm._calls().resolve[0].hints;
        assert.equal(hints.force,     true);
        assert.equal(hints.bypassTtl, true);
    } finally { tmp.cleanup(); }
});

test('addManualGame: cooldown without force — resolve skipped, validationDeferred set', async () => {
    const tmp = makeTmpFile();
    try {
        const mrm = makeMrm({ status: COOLDOWN });
        const deps = makeDeps({
            fs:     require('fs').promises,
            fsSync: require('fs'),
            metadataResolutionManager: mrm,
        });
        const result = await addManualGame({ launchPath: tmp.game, ...deps });
        assert.equal(result.status, 'success');
        assert.equal(mrm._calls().resolve.length, 0, 'resolve must NOT be called during cooldown');
        const game = deps._upserted()[0];
        assert.ok(game, 'game must be upserted');
        assert.equal(game.needsValidation,    true,                   'needsValidation must be set');
        assert.equal(game.validationDeferred, true,                   'validationDeferred must be set');
        assert.equal(game.validationReason,   'manual_add_rate_limited', 'reason must be set');
    } finally { tmp.cleanup(); }
});

test('addManualGame: shortcut fields — lnkTarget, shortcutArgs, shortcutCwd preserved in game record', async () => {
    const tmp = makeTmpFile();
    const lnk = nodePath.join(nodePath.dirname(tmp.game), '..', 'Desktop', 'game.lnk');
    nodeFs.mkdirSync(nodePath.dirname(lnk), { recursive: true });
    nodeFs.writeFileSync(lnk, '');
    try {
        const deps = makeDeps({
            fs:     require('fs').promises,
            fsSync: require('fs'),
            parseShortcutArgs: (args) => args ? [args] : [],
        });
        const result = await addManualGame({
            launchPath: lnk,
            options: {
                lnkTarget:    tmp.game,
                metadataPath: tmp.game,
                shortcutArgs: '--no-sandbox',
                shortcutCwd:  'C:\\Games\\MyGame',
            },
            ...deps,
        });
        assert.equal(result.status, 'success');
        const g = deps._upserted()[0];
        assert.equal(g.command,         lnk,                'command must be the lnk path');
        assert.equal(g.shortcutPath,    lnk,                'shortcutPath must be set for .lnk');
        assert.equal(g.executablePath,  tmp.game,           'executablePath must be the real exe');
        assert.equal(g.rawShortcutArgs, '--no-sandbox',     'rawShortcutArgs preserved');
        assert.equal(g.launchCwd,       'C:\\Games\\MyGame', 'launchCwd from shortcutCwd');
    } finally {
        tmp.cleanup();
        try { nodeFs.rmSync(nodePath.dirname(lnk), { recursive: true, force: true }); } catch { /**/ }
    }
});

test('addManualGame: upsertGame throws → returns error, does not propagate', async () => {
    const deps = makeDeps({
        upsertGame: async () => { throw new Error('DB full'); },
    });
    const result = await addManualGame({ launchPath: 'C:\\Games\\game.exe', ...deps });
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'DB full');
});

test('addManualGame: notifyCallback passed to backgroundDownload', async () => {
    const tmp = makeTmpFile();
    try {
        const meta = { cover: 'https://cdn/cover.jpg' };
        const bgCalls = [];
        const deps = makeDeps({
            fs:     require('fs').promises,
            fsSync: require('fs'),
            metadataResolutionManager: makeMrm({
                resolveResult: { meta, matchedName: 'Game', _resolveSource: 'server' },
            }),
            metadataCacheStore: { save: async () => {} },
            backgroundDownload: async (...a) => { bgCalls.push(a); },
        });
        const cb = () => {};
        await addManualGame({ launchPath: tmp.game, notifyCallback: cb, ...deps });
        assert.equal(bgCalls.length, 1);
        assert.equal(bgCalls[0][2], cb, 'notifyCallback must be forwarded to backgroundDownload');
    } finally { tmp.cleanup(); }
});

test('addManualGame: hydratedGame comes from getGameById, not newGame', async () => {
    const tmp = makeTmpFile();
    try {
        const dbGame = { id: 'test-id', name: 'Hydrated From DB', platform: 'Manual' };
        const deps = makeDeps({
            fs:     require('fs').promises,
            fsSync: require('fs'),
            getGameById: () => dbGame,
        });
        const result = await addManualGame({ launchPath: tmp.game, ...deps });
        assert.equal(result.game.name, 'Hydrated From DB', 'must return game from getGameById');
    } finally { tmp.cleanup(); }
});
