'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    deriveCanonicalProductIdentity,
    dedupeDelegatedLaunchProducts,
    chooseCanonicalProductRecord,
} = require('../src/features/games/domain/services/CanonicalProductIdentity');

function riotValorant(overrides = {}) {
    return {
        id: 'riot-valorant',
        name: 'VALORANT',
        platform: 'Riot Games',
        riotProduct: 'valorant',
        command: '"C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=valorant --launch-patchline=live',
        executablePath: 'C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe',
        isInstalled: true,
        image: 'file:///canonical/valorant-cover.webp',
        heroUrl: 'file:///canonical/valorant-hero.webp',
        totalPlaytime: 120,
        ...overrides,
    };
}

function epicValorant(overrides = {}) {
    return {
        id: 'epic-valorant-entry',
        title: 'VALORANT',
        name: 'VALORANT',
        platform: 'Epic',
        appName: 'Valorant',
        namespace: 'valorant-ns',
        catalogItemId: 'valorant-catalog',
        launcherGameId: 'Valorant',
        accountId: 'epic-account-1',
        isInstalled: true,
        image: 'https://epic.example/valorant.webp',
        ...overrides,
    };
}

test('CanonicalProductIdentity derives riot:valorant from Riot launch command and executable evidence', () => {
    const identity = deriveCanonicalProductIdentity(riotValorant());
    assert.equal(identity.productKey, 'riot:valorant');
    assert.equal(identity.runtimePlatform, 'riot');
});

test('CanonicalProductIdentity derives riot:valorant from curated Epic VALORANT ownership evidence', () => {
    const identity = deriveCanonicalProductIdentity(epicValorant());
    assert.equal(identity.productKey, 'riot:valorant');
    assert.equal(identity.runtimePlatform, 'riot');
});

test('CanonicalProductIdentity does not merge generic same-title cross-platform records', () => {
    const unrelatedEpic = {
        id: 'epic-same-title',
        name: 'Portal',
        title: 'Portal',
        platform: 'Epic',
        appName: 'Portal',
    };
    const unrelatedSteam = {
        id: 'steam-same-title',
        name: 'Portal',
        platform: 'Steam',
        command: 'steam://rungameid/400',
    };

    assert.equal(deriveCanonicalProductIdentity(unrelatedEpic), null);
    assert.equal(deriveCanonicalProductIdentity(unrelatedSteam), null);
    assert.equal(dedupeDelegatedLaunchProducts([unrelatedEpic, unrelatedSteam]).length, 2);
});

test('CanonicalProductIdentity collapses Riot and Epic VALORANT to one installed card', () => {
    const merged = dedupeDelegatedLaunchProducts([
        epicValorant(),
        riotValorant(),
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].canonicalProductKey, 'riot:valorant');
    assert.equal(merged[0].id, 'riot-valorant');
    assert.equal(merged[0].platform, 'Riot Games');
    assert.deepEqual(merged[0].sourceRecordIds.sort(), ['epic-valorant-entry', 'riot-valorant']);
});

test('CanonicalProductIdentity preserves Riot launch command and canonical artwork over Epic ownership fields', () => {
    const [merged] = dedupeDelegatedLaunchProducts([
        epicValorant({ command: 'com.epicgames.launcher://apps/Valorant?action=launch' }),
        riotValorant(),
    ]);

    assert.match(merged.command, /launch-product=valorant/);
    assert.match(merged.executablePath, /VALORANT-Win64-Shipping\.exe/);
    assert.equal(merged.image, 'file:///canonical/valorant-cover.webp');
    assert.equal(merged.heroUrl, 'file:///canonical/valorant-hero.webp');
});

test('CanonicalProductIdentity preserves Epic and Riot ownership/platform associations for filters and badges', () => {
    const [merged] = dedupeDelegatedLaunchProducts([
        riotValorant(),
        epicValorant(),
    ]);

    assert.ok(merged.platforms.some(platform => /riot/i.test(platform)));
    assert.ok(merged.platforms.some(platform => /epic/i.test(platform)));
    assert.ok(merged.sources.some(platform => /riot/i.test(platform)));
    assert.ok(merged.sources.some(platform => /epic/i.test(platform)));
    assert.ok(merged.ownershipPlatforms.some(platform => /riot/i.test(platform)));
    assert.ok(merged.ownershipPlatforms.some(platform => /epic/i.test(platform)));
    assert.equal(merged.allIds.riot, 'valorant');
    assert.ok(merged.allIds.epic);
});

test('CanonicalProductIdentity canonical record selection prefers native Riot runtime over Epic ownership', () => {
    const chosen = chooseCanonicalProductRecord([
        epicValorant({ command: 'com.epicgames.launcher://apps/Valorant?action=launch' }),
        riotValorant(),
    ]);

    assert.equal(chosen.id, 'riot-valorant');
});

test('CanonicalProductIdentity remains stable across repeated sync/reload dedupe passes', () => {
    const once = dedupeDelegatedLaunchProducts([riotValorant(), epicValorant()]);
    const twice = dedupeDelegatedLaunchProducts([...once, epicValorant({ id: 'epic-valorant-entry-2' })]);

    assert.equal(once.length, 1);
    assert.equal(twice.length, 1);
    assert.equal(twice[0].id, 'riot-valorant');
    assert.deepEqual(twice[0].sourceRecordIds.sort(), [
        'epic-valorant-entry',
        'epic-valorant-entry-2',
        'riot-valorant',
    ]);
});
