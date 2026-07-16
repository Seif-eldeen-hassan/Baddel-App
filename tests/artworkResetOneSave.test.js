'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const vm = require('node:vm');

const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');

const ROOT = path.join(__dirname, '..');
const ADD_GAME_MODAL_JS = fs.readFileSync(path.join(ROOT, 'src/js/addGameModal.js'), 'utf8');
const ARTWORK_STATE_JS = fs.readFileSync(path.join(ROOT, 'src/features/games/domain/services/GameArtworkState.js'), 'utf8');
const READ_MODEL_JS = fs.readFileSync(path.join(ROOT, 'src/features/games/application/services/GameArtworkReadModel.js'), 'utf8');

function makeRepo(games = []) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-art-reset-'));
    const dbPath = path.join(tmpDir, 'games-db.json');
    fs.writeFileSync(dbPath, JSON.stringify(games), 'utf8');
    return new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: dbPath,
        logger: { log() {}, warn() {}, error() {} },
    });
}

function gameWithArtwork(overrides = {}) {
    return {
        id: 'canonical-1',
        name: 'Reset Game',
        isHidden: false,
        image: 'file://settings-cover.webp',
        heroImage: 'file://settings-hero.webp',
        logo: 'file://settings-logo.webp',
        artworkState: {
            version: 2,
            cover: {
                overrideValue: 'file://settings-cover.webp',
                overrideSource: 'settings',
                locked: true,
                updatedAt: 7,
                revision: 7,
                fallbackValue: 'file://platform-cover.webp',
                fallbackSource: 'platform',
                fallbackUpdatedAt: 1,
            },
            hero: {
                overrideValue: 'file://settings-hero.webp',
                overrideSource: 'settings',
                locked: true,
                updatedAt: 8,
                revision: 8,
                fallbackValue: 'file://platform-hero.webp',
                fallbackSource: 'platform',
                fallbackUpdatedAt: 1,
            },
            logo: {
                overrideValue: 'file://settings-logo.webp',
                overrideSource: 'settings',
                locked: true,
                updatedAt: 9,
                revision: 9,
                fallbackValue: 'file://platform-logo.webp',
                fallbackSource: 'platform',
                fallbackUpdatedAt: 1,
            },
        },
        ...overrides,
    };
}

function makeSettingsSandbox(updatedGame, resetImpl) {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) {
            elements.set(id, {
                id,
                value: id === 'editGameNameInput' ? 'Reset Game' : '',
                src: '',
                disabled: false,
                style: {},
                classList: { add() {}, remove() {} },
            });
        }
        return elements.get(id);
    };

    const commitCalls = [];
    const resetCalls = [];
    const toasts = [];
    const sandbox = {
        window: {},
        console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
        document: { getElementById: element },
        overlay: { classList: { add() {}, remove() {} } },
        localStorage: { removeItem() {}, getItem() { return null; }, setItem() {} },
        showToast: (message, kind) => toasts.push({ message, kind }),
        closeGameSettings() {},
        refreshAllViews() { throw new Error('structural render should not run for artwork reset'); },
        safeImageUrl: value => value || null,
        allGamesData: [gameWithArtwork({ id: 'display-1', localGameId: 'canonical-1' })],
        selectedGameId: 'display-1',
        Math,
        Date,
        Promise,
        setTimeout,
        clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.window.electronAPI = {
        resetGameArtwork: async (identity, opts) => {
            resetCalls.push({ identity, opts });
            return resetImpl ? resetImpl(identity, opts) : {
                status: 'success',
                persisted: true,
                canonicalGameId: 'canonical-1',
                operationId: opts.operationId,
                results: Object.fromEntries(opts.types.map(type => [type, {
                    applied: true,
                    reason: 'override-cleared',
                    revision: updatedGame.artworkState[type].revision,
                    effectiveValue: updatedGame.artworkState[type].fallbackValue,
                    fallbackSource: updatedGame.artworkState[type].fallbackSource,
                }])),
                updatedGame,
            };
        },
    };
    sandbox.window.__baddelCommitCanonicalGameUpdate = (game, opts) => {
        commitCalls.push({ game, opts });
    };

    vm.createContext(sandbox);
    vm.runInContext(ARTWORK_STATE_JS, sandbox, { filename: 'GameArtworkState.js' });
    vm.runInContext(READ_MODEL_JS, sandbox, { filename: 'GameArtworkReadModel.js' });
    vm.runInContext(ADD_GAME_MODAL_JS, sandbox, { filename: 'addGameModal.js' });
    return { sandbox, resetCalls, commitCalls, toasts, element };
}

test('JsonGameRepository resetGameArtwork clears only selected explicit override and returns durable updatedGame', async () => {
    const repo = makeRepo([gameWithArtwork()]);
    const res = await repo.resetGameArtwork('canonical-1', {
        types: ['cover'],
        operationId: 'op-cover',
        expectedRevisions: { cover: 7 },
        updatedAt: 100,
    });

    assert.equal(res.status, 'success');
    assert.equal(res.persisted, true);
    assert.equal(res.canonicalGameId, 'canonical-1');
    assert.equal(res.results.cover.reason, 'override-cleared');
    assert.equal(res.updatedGame.artworkState.cover.locked, false);
    assert.equal(res.updatedGame.artworkState.cover.overrideValue, null);
    assert.equal(res.updatedGame.artworkState.cover.fallbackValue, 'file://platform-cover.webp');
    assert.equal(res.updatedGame.artworkState.cover.fallbackSource, 'platform');
    assert.equal(res.updatedGame.image, 'file://platform-cover.webp');
    assert.equal(res.updatedGame.artworkState.hero.overrideValue, 'file://settings-hero.webp');
    assert.equal(res.updatedGame.artworkState.logo.overrideValue, 'file://settings-logo.webp');
    assert.equal(res.updatedGame.artworkState.hero.revision, 8);
    assert.equal(res.updatedGame.artworkState.logo.revision, 9);

    const disk = JSON.parse(fs.readFileSync(repo._dbPath, 'utf8'))[0];
    assert.equal(disk.artworkState.cover.locked, false);
    assert.equal(disk.image, 'file://platform-cover.webp');
});

test('JsonGameRepository update Cover plus reset Hero in one save sequence carries forward final updatedGame', async () => {
    const repo = makeRepo([gameWithArtwork()]);
    const update = await repo.setGameArtwork('canonical-1', { cover: 'file://new-cover.webp' }, {
        source: 'settings',
        updatedAt: 200,
    });
    const reset = await repo.resetGameArtwork(update.updatedGame, {
        types: ['hero'],
        expectedRevisions: { hero: update.updatedGame.artworkState.hero.revision },
        updatedAt: 201,
    });

    assert.equal(reset.updatedGame.image, 'file://new-cover.webp');
    assert.equal(reset.updatedGame.heroImage, 'file://platform-hero.webp');
    assert.equal(reset.updatedGame.logo, 'file://settings-logo.webp');
    assert.equal(reset.updatedGame.artworkState.cover.locked, true);
    assert.equal(reset.updatedGame.artworkState.hero.locked, false);
    assert.equal(reset.updatedGame.artworkState.logo.locked, true);
});

test('JsonGameRepository Reset All clears all explicit overrides and retains all fallbacks', async () => {
    const repo = makeRepo([gameWithArtwork()]);
    const res = await repo.resetGameArtwork('canonical-1', {
        types: ['cover', 'hero', 'logo'],
        updatedAt: 300,
    });

    assert.equal(res.status, 'success');
    assert.equal(res.updatedGame.image, 'file://platform-cover.webp');
    assert.equal(res.updatedGame.heroImage, 'file://platform-hero.webp');
    assert.equal(res.updatedGame.logo, 'file://platform-logo.webp');
    for (const type of ['cover', 'hero', 'logo']) {
        assert.equal(res.updatedGame.artworkState[type].locked, false);
        assert.equal(res.updatedGame.artworkState[type].overrideValue, null);
        assert.equal(res.updatedGame.artworkState[type].fallbackSource, 'platform');
    }
});

test('Game Settings Reset Cover stages only, Save once commits returned updatedGame once', async () => {
    const updatedGame = gameWithArtwork({
        id: 'canonical-1',
        image: 'file://platform-cover.webp',
        artworkState: {
            ...gameWithArtwork().artworkState,
            cover: {
                ...gameWithArtwork().artworkState.cover,
                overrideValue: null,
                overrideSource: null,
                locked: false,
                revision: 8,
            },
        },
    });
    const { sandbox, resetCalls, commitCalls, element } = makeSettingsSandbox(updatedGame);

    await sandbox.resetGameImage('cover');
    assert.equal(resetCalls.length, 0, 'Reset click must not persist before Save');
    assert.equal(element('previewCover').src, 'file://platform-cover.webp');

    await sandbox.saveGameSettings();

    assert.equal(resetCalls.length, 1);
    assert.deepEqual(Array.from(resetCalls[0].opts.types), ['cover']);
    assert.equal(commitCalls.length, 1);
    assert.strictEqual(commitCalls[0].game, updatedGame);
    assert.deepEqual(Array.from(commitCalls[0].opts.changedTypes), ['cover']);
    assert.equal(commitCalls[0].opts.reason, 'settings-reset');
    assert.equal(sandbox.allGamesData[0].image, 'file://platform-cover.webp');
    assert.equal(element('btn-reset-cover').disabled, true);
});

for (const type of ['hero', 'logo']) {
    test(`Game Settings Reset ${type} Save once commits only that type`, async () => {
        const base = gameWithArtwork();
        const updatedGame = gameWithArtwork({
            id: 'canonical-1',
            heroImage: type === 'hero' ? 'file://platform-hero.webp' : base.heroImage,
            logo: type === 'logo' ? 'file://platform-logo.webp' : base.logo,
            artworkState: {
                ...base.artworkState,
                [type]: {
                    ...base.artworkState[type],
                    overrideValue: null,
                    overrideSource: null,
                    locked: false,
                    revision: base.artworkState[type].revision + 1,
                },
            },
        });
        const { sandbox, resetCalls, commitCalls } = makeSettingsSandbox(updatedGame);

        await sandbox.resetGameImage(type);
        await sandbox.saveGameSettings();

        assert.equal(resetCalls.length, 1);
        assert.deepEqual(Array.from(resetCalls[0].opts.types), [type]);
        assert.equal(commitCalls.length, 1);
        assert.deepEqual(Array.from(commitCalls[0].opts.changedTypes), [type]);
    });
}

test('Game Settings Reset All stages three types and Save commits one canonical update', async () => {
    const updatedGame = gameWithArtwork({
        id: 'canonical-1',
        image: 'file://platform-cover.webp',
        heroImage: 'file://platform-hero.webp',
        logo: 'file://platform-logo.webp',
        artworkState: {
            version: 2,
            ...Object.fromEntries(['cover', 'hero', 'logo'].map(type => [type, {
                ...gameWithArtwork().artworkState[type],
                overrideValue: null,
                overrideSource: null,
                locked: false,
                revision: gameWithArtwork().artworkState[type].revision + 1,
            }])),
        },
    });
    const { sandbox, resetCalls, commitCalls } = makeSettingsSandbox(updatedGame);

    await sandbox.resetAllGameImages();
    assert.equal(resetCalls.length, 0);
    await sandbox.saveGameSettings();

    assert.equal(resetCalls.length, 1);
    assert.deepEqual(Array.from(resetCalls[0].opts.types), ['cover', 'hero', 'logo']);
    assert.equal(commitCalls.length, 1);
    assert.deepEqual(Array.from(commitCalls[0].opts.changedTypes), ['cover', 'hero', 'logo']);
});

test('Game Settings partial reset keeps failed type pending and commits successful updatedGame', async () => {
    const updatedGame = gameWithArtwork({
        id: 'canonical-1',
        image: 'file://platform-cover.webp',
        artworkState: {
            ...gameWithArtwork().artworkState,
            cover: {
                ...gameWithArtwork().artworkState.cover,
                overrideValue: null,
                overrideSource: null,
                locked: false,
                revision: 8,
            },
        },
    });
    const { sandbox, resetCalls, commitCalls, toasts } = makeSettingsSandbox(updatedGame, (_identity, opts) => ({
        status: 'partial',
        persisted: true,
        canonicalGameId: 'canonical-1',
        operationId: opts.operationId,
        results: {
            cover: { applied: true, reason: 'override-cleared', revision: 8 },
            hero: { applied: false, reason: 'stale-revision', revision: 8 },
        },
        updatedGame,
    }));

    await sandbox.resetGameImage('cover');
    await sandbox.resetGameImage('hero');
    await sandbox.saveGameSettings();

    assert.equal(commitCalls.length, 1);
    assert.deepEqual(Array.from(commitCalls[0].opts.changedTypes), ['cover']);
    assert.equal(resetCalls.length, 1);
    assert.match(toasts.at(-1).message, /hero/);
    assert.equal(toasts.some(toast => toast.message === 'Settings saved successfully!'), false);
});

test('source guards: Settings reset has one production definition and no legacy immediate authority', () => {
    const resetDefinitions = ADD_GAME_MODAL_JS.match(/async function resetGameImage\s*\(/g) || [];
    assert.equal(resetDefinitions.length, 1);
    assert.match(ADD_GAME_MODAL_JS, /const artworkPlan = \{\s*updates: \{\},\s*resets: \[\],\s*\}/);
    assert.match(ADD_GAME_MODAL_JS, /resetGameArtwork\(identity/);
    assert.doesNotMatch(ADD_GAME_MODAL_JS, /resetGameImage\(selectedGameId,\s*type\)/);
    assert.doesNotMatch(ADD_GAME_MODAL_JS, /refreshAllViews\(\);\s*\}\s*async function resetGameImage/);
});
