'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    DownloadCompletionLibraryRegistrar,
    meaningfulPathMatch,
} = require('../src/features/downloads/infrastructure/services/DownloadCompletionLibraryRegistrar');

function makeGamesApi(initial = []) {
    const games = initial.map(game => ({ ...game }));
    return {
        games,
        getAllGames: () => games,
        getSavedGames: () => games,
        async upsertGame(game) {
            if (!game.id) game.id = `registered-${games.length + 1}`;
            const index = games.findIndex(existing =>
                existing.id === game.id ||
                (game.installedGameKey && existing.installedGameKey === game.installedGameKey)
            );
            if (index >= 0) games[index] = { ...games[index], ...game, id: games[index].id };
            else games.push({ ...game });
        },
        saveDatabase() {},
        async flushDatabase() {},
    };
}

function makeSanitariumInstall() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sanitarium-'));
    const installPath = path.join(root, 'Sanitarium');
    const scummVmDir = path.join(installPath, 'ScummVM');
    const executablePath = path.join(scummVmDir, 'scummvm.exe');
    fs.mkdirSync(scummVmDir, { recursive: true });
    fs.writeFileSync(executablePath, 'scummvm');
    return { installPath, executablePath };
}

function sanitariumTask(installPath, overrides = {}) {
    return {
        id: 'dl_sanitarium',
        title: 'Sanitarium',
        platform: 'gog',
        providerProductId: '1207659028',
        gogProductId: '1207659028',
        gogdlAppName: 'sanitarium',
        installPath,
        ...overrides,
    };
}

test('meaningfulPathMatch rejects every empty side and uses path boundaries', () => {
    const wanted = 'F:\\New folder (3)\\Sanitarium\\ScummVM\\scummvm.exe';
    for (const empty of [null, undefined, '', '   ']) {
        assert.equal(meaningfulPathMatch(empty, wanted), false);
        assert.equal(meaningfulPathMatch(wanted, empty), false);
    }
    assert.equal(meaningfulPathMatch('F:\\New folder (3)\\Sanitarium', wanted), true);
    assert.equal(meaningfulPathMatch('F:\\New folder (3)\\San', wanted), false);
    assert.equal(meaningfulPathMatch('F:\\Other\\scummvm.exe', wanted), false);
});

test('missing executablePath, command, or path cannot match Xbox Solitaire to GOG Sanitarium', () => {
    const wanted = 'F:\\New folder (3)\\Sanitarium\\ScummVM\\scummvm.exe';
    const variants = [
        { executablePath: null, command: 'shell:AppsFolder\\MicrosoftSolitaire', path: 'C:\\Xbox\\Solitaire' },
        { executablePath: 'C:\\Xbox\\Solitaire\\Solitaire.exe', command: null, path: 'C:\\Xbox\\Solitaire' },
        { executablePath: 'C:\\Xbox\\Solitaire\\Solitaire.exe', command: 'shell:AppsFolder\\MicrosoftSolitaire', path: null },
        { executablePath: null, command: null, path: 'C:\\Xbox\\Solitaire' },
        { executablePath: null, command: 'shell:AppsFolder\\MicrosoftSolitaire', path: null },
        { executablePath: 'C:\\Xbox\\Solitaire\\Solitaire.exe', command: null, path: null },
        { executablePath: null, command: null, path: null },
    ];

    for (const fields of variants) {
        const solitaire = {
            id: 'xbox-Microsoft-MicrosoftSolitaireCollection_8wekyb3d8bbwe',
            name: 'Microsoft Solitaire Collection',
            platform: 'xbox',
            ...fields,
        };
        const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi: makeGamesApi([solitaire]) });
        assert.equal(registrar.findExistingGame(sanitariumTask('F:\\New folder (3)\\Sanitarium'), wanted), null);
    }
});

test('Sanitarium completion creates a GOG record instead of reusing Xbox Solitaire', async () => {
    const { installPath, executablePath } = makeSanitariumInstall();
    const solitaireId = 'xbox-Microsoft-MicrosoftSolitaireCollection_8wekyb3d8bbwe';
    const gamesApi = makeGamesApi([{
        id: solitaireId,
        name: 'Microsoft Solitaire Collection',
        platform: 'xbox',
        scannerPlatform: 'xbox',
        executablePath: null,
        command: 'shell:AppsFolder\\Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe!App',
        path: null,
    }]);
    const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi });
    const task = sanitariumTask(installPath);

    assert.equal(registrar.findExistingGame(task, executablePath), null);
    const result = await registrar.registerCompletedDownload(task, {
        verification: { executablePath },
    });

    assert.notEqual(result.installedGameId, solitaireId);
    assert.equal(result.installedGame.platform, 'gog');
    assert.equal(result.installedGame.scannerPlatform, 'gog');
    assert.equal(result.resolvedExecutablePath, executablePath);
    assert.equal(result.installedGame.executablePath, executablePath);
    assert.equal(gamesApi.games.find(game => game.id === solitaireId).platform, 'xbox');
});

test('provider identity matching is platform scoped for identical numeric IDs', () => {
    const games = [
        { id: 'xbox-1440133968', name: 'Xbox Game', platform: 'xbox', providerProductId: '1440133968', path: 'C:\\Xbox\\Game' },
        { id: 'steam-1440133968', name: 'Steam Game', platform: 'steam', providerProductId: '1440133968', path: 'C:\\Steam\\Game' },
        { id: 'gog_1440133968', name: 'SYMMETRY', platform: 'gog', providerProductId: '1440133968', path: 'F:\\SYMMETRY' },
    ];
    const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi: makeGamesApi(games) });
    const existing = registrar.findExistingGame({
        title: 'SYMMETRY',
        platform: 'gog',
        providerProductId: '1440133968',
        installPath: 'F:\\Unrelated Folder',
    }, 'F:\\Unrelated Folder\\Symmetry.exe');
    assert.equal(existing.id, 'gog_1440133968');
});

test('cross-platform canonical ID collision cannot overwrite or return the foreign record', async () => {
    const { installPath, executablePath } = makeSanitariumInstall();
    const sharedId = 'shared-numeric-id';
    const gamesApi = makeGamesApi([{
        id: sharedId,
        name: 'Xbox Existing',
        platform: 'xbox',
        scannerPlatform: 'xbox',
        path: 'C:\\Xbox\\Existing',
    }]);
    const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi });
    const result = await registrar.registerCompletedDownload(
        sanitariumTask(installPath, { canonicalGameId: sharedId }),
        { verification: { executablePath } }
    );

    assert.notEqual(result.installedGameId, sharedId);
    assert.equal(result.installedGame.platform, 'gog');
    assert.equal(gamesApi.games.find(game => game.id === sharedId).platform, 'xbox');
    assert.equal(gamesApi.games.filter(game => game.platform === 'gog').length, 1);
});
