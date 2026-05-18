'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const { classifyProductVariant } = require('../src/js/platformResolver');

// ─── classifyProductVariant ────────────────────────────────────────────────────

test('base game with no variant keywords → main', () => {
    assert.equal(classifyProductVariant('Detroit: Become Human'), 'main');
    assert.equal(classifyProductVariant('Hogwarts Legacy'), 'main');
    assert.equal(classifyProductVariant('The Witcher 3: Wild Hunt'), 'main');
    assert.equal(classifyProductVariant('Cyberpunk 2077'), 'main');
    assert.equal(classifyProductVariant(''), 'main');
    assert.equal(classifyProductVariant(null), 'main');
});

test('Demo in title → demo', () => {
    assert.equal(classifyProductVariant('Detroit: Become Human Demo'), 'demo');
    assert.equal(classifyProductVariant('Hogwarts Legacy Demo'), 'demo');
    assert.equal(classifyProductVariant('DEMO: Some Game'), 'demo');
    assert.equal(classifyProductVariant('Some Game (Demo)'), 'demo');
});

test('Creator Kit in title → creator_kit', () => {
    assert.equal(classifyProductVariant('Hogwarts Legacy Creator Kit'), 'creator_kit');
    assert.equal(classifyProductVariant('My Game Creator Kit'), 'creator_kit');
});

test('Trial in title → trial', () => {
    assert.equal(classifyProductVariant('Assassin\'s Creed Mirage Trial'), 'trial');
    assert.equal(classifyProductVariant('Some Game Trial Version'), 'trial');
});

test('Playtest / Public Test in title → playtest', () => {
    assert.equal(classifyProductVariant('Game Public Test'), 'playtest');
    assert.equal(classifyProductVariant('New World Playtest'), 'playtest');
    assert.equal(classifyProductVariant('Server Test Build'), 'playtest');
});

test('Dedicated Server in title → dedicated_server', () => {
    assert.equal(classifyProductVariant('Palworld Dedicated Server'), 'dedicated_server');
    assert.equal(classifyProductVariant('ARK: Survival Evolved Dedicated Server'), 'dedicated_server');
});

test('SDK / Toolkit in title → tool', () => {
    assert.equal(classifyProductVariant('Unreal Engine SDK'), 'tool');
    assert.equal(classifyProductVariant('Cyberpunk 2077 Toolkit'), 'tool');
    assert.equal(classifyProductVariant('Game Toolset'), 'tool');
    assert.equal(classifyProductVariant('Creation Kit'), 'tool');
});

test('Mod Kit in title → mod_kit (before mod)', () => {
    assert.equal(classifyProductVariant('Game Mod Kit'), 'mod_kit');
    assert.equal(classifyProductVariant('Modding SDK'), 'mod_kit');
    assert.equal(classifyProductVariant('Game Mod Tools'), 'mod_kit');
});

test('Mod in title → mod (after mod_kit check)', () => {
    assert.equal(classifyProductVariant('Skyrim Mod Collection'), 'mod');
    // "Mod Kit" must still be mod_kit, not mod
    assert.notEqual(classifyProductVariant('Game Mod Kit'), 'mod');
});

test('Alpha / Beta in title → correct variant', () => {
    assert.equal(classifyProductVariant('Hades II Alpha'), 'alpha');
    assert.equal(classifyProductVariant('Game Beta'), 'beta');
    assert.equal(classifyProductVariant('Early Access Beta'), 'beta');
});

test('DLC / Content Pack → dlc', () => {
    assert.equal(classifyProductVariant('Cyberpunk 2077 DLC'), 'dlc');
    assert.equal(classifyProductVariant('Season Pass Content Pack'), 'dlc');
});

test('Bundle in title → bundle', () => {
    assert.equal(classifyProductVariant('Complete Bundle'), 'bundle');
});

test('word boundaries prevent substring false positives', () => {
    // "democracy" contains "demo" but not as a whole word
    assert.equal(classifyProductVariant('Democracy 4'), 'main');
    // "Alphabear" contains "alpha" but not as a whole word
    assert.equal(classifyProductVariant('Alphabear 2'), 'main');
    // "Modular" contains "mod" but not as a whole word
    assert.equal(classifyProductVariant('Modular Grid'), 'main');
});

// ─── Installed-matching reference implementation ───────────────────────────────
//
// This mirrors the FIXED logic in accounts.js (_agBuildInstalledMap + _agIsInstalled).
// The tests here prove the spec; the accounts.js code must stay in sync.

function buildInstalledMap(localGames) {
    const map = new Map();
    const set = (key, installed) => {
        if (!key) return;
        const k = String(key).toLowerCase().trim();
        if (!k) return;
        if (!map.has(k) || installed) map.set(k, installed);
    };
    localGames.forEach(g => {
        const installed = !!(g.path || g.command);
        set(g.id, installed);
        const cleanTitle = (g.name || g.title || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        set(cleanTitle, installed);
        if (g.appName) set(`epic-${g.appName}`, installed);
        if (g.id)      set(`epic-${g.id}`,      installed);
        if (g.allIds?.steam) set(g.allIds.steam, installed);
        if (g.appName) set(g.appName, installed);
        // namespace and allIds.epic deliberately excluded
    });
    return map;
}

function isInstalled(game, map) {
    const probe = (key) => {
        if (!key) return false;
        return map.get(String(key).toLowerCase().trim()) === true;
    };

    if (probe(game.id)) return true;

    // cleanTitle only for non-variants
    const variantType = classifyProductVariant(game.title || game.name || '');
    if (variantType === 'main') {
        const cleanTitle = (game.title || game.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (probe(cleanTitle)) return true;
    }

    if (game.appName && probe(`epic-${game.appName}`)) return true;
    if (game.id      && probe(`epic-${game.id}`))      return true;
    if (game.allIds?.steam && probe(game.allIds.steam)) return true;
    if (game.appName && probe(game.appName)) return true;

    return false;
}

// ── Scenario 1: Detroit base installed → Detroit Demo NOT installed ─────────────

test('Detroit base game installed → Demo does NOT pass Installed Only', () => {
    const localGames = [
        {
            id: 'abc123',
            name: 'Detroit: Become Human',
            command: 'steam://run/1222140',
            appName: '1222140',
            allIds: { steam: '1222140' },
        },
    ];
    const map = buildInstalledMap(localGames);

    // Base game passes (exact appName match)
    const base = { id: 'abc123', title: 'Detroit: Become Human', appName: '1222140', allIds: { steam: '1222140' } };
    assert.equal(isInstalled(base, map), true, 'base game must be installed');

    // Demo has a different Steam ID and a variant title — must NOT be installed
    const demo = { id: 'def456', title: 'Detroit: Become Human Demo', appName: '1905950', allIds: { steam: '1905950' } };
    assert.equal(isInstalled(demo, map), false, 'demo must NOT appear installed from base game');
});

// ── Scenario 2: Hogwarts Legacy installed → Creator Kit NOT installed ──────────

test('Hogwarts Legacy installed → Creator Kit does NOT pass Installed Only', () => {
    const SHARED_NAMESPACE = 'd8d8b399e3bb4ab59de3d0c892c28bc4'; // shared Epic namespace
    const localGames = [
        {
            id: 'hl-hash',
            name: 'Hogwarts Legacy',
            command: 'some-epic-launch-command',
            appName: 'HogwartsLegacy',
            namespace: SHARED_NAMESPACE,
            allIds: { epic: SHARED_NAMESPACE },  // this must NOT be stored in the map
        },
    ];
    const map = buildInstalledMap(localGames);

    // Namespace must NOT be in the map
    assert.equal(map.has(SHARED_NAMESPACE.toLowerCase()), false, 'shared namespace must not be in map');

    // Base game passes (appName match)
    const base = { id: 'hl-hash', title: 'Hogwarts Legacy', appName: 'HogwartsLegacy', namespace: SHARED_NAMESPACE, allIds: { epic: SHARED_NAMESPACE } };
    assert.equal(isInstalled(base, map), true, 'base game must be installed');

    // Creator Kit shares namespace but has its own appName — must NOT be installed
    const kit = { id: 'hlck-id', title: 'Hogwarts Legacy Creator Kit', appName: 'HogwartsLegacyCreatorKit', namespace: SHARED_NAMESPACE, allIds: { epic: SHARED_NAMESPACE } };
    assert.equal(isInstalled(kit, map), false, 'Creator Kit must NOT appear installed from base game');
});

// ── Scenario 3: Exact demo SKU IS installed → passes correctly ─────────────────

test('Demo SKU installed → it DOES pass Installed Only', () => {
    const localGames = [
        {
            id: 'demo-hash',
            name: 'Detroit: Become Human Demo',
            command: 'steam://run/1905950',
            appName: '1905950',
            allIds: { steam: '1905950' },
        },
    ];
    const map = buildInstalledMap(localGames);

    const demo = { id: 'demo-hash', title: 'Detroit: Become Human Demo', appName: '1905950', allIds: { steam: '1905950' } };
    assert.equal(isInstalled(demo, map), true, 'installed demo must pass');
});

// ── Scenario 4: Creator Kit IS installed → passes correctly ───────────────────

test('Creator Kit installed → it DOES pass Installed Only', () => {
    const SHARED_NAMESPACE = 'd8d8b399e3bb4ab59de3d0c892c28bc4';
    const localGames = [
        {
            id: 'hlck-hash',
            name: 'Hogwarts Legacy Creator Kit',
            command: 'some-launch',
            appName: 'HogwartsLegacyCreatorKit',
            namespace: SHARED_NAMESPACE,
            allIds: { epic: SHARED_NAMESPACE },
        },
    ];
    const map = buildInstalledMap(localGames);

    const kit = { id: 'hlck-hash', title: 'Hogwarts Legacy Creator Kit', appName: 'HogwartsLegacyCreatorKit', namespace: SHARED_NAMESPACE, allIds: { epic: SHARED_NAMESPACE } };
    assert.equal(isInstalled(kit, map), true, 'installed Creator Kit must pass');

    // Base game must NOT appear installed just because Creator Kit is
    const base = { id: 'hl-other', title: 'Hogwarts Legacy', appName: 'HogwartsLegacy', namespace: SHARED_NAMESPACE, allIds: { epic: SHARED_NAMESPACE } };
    assert.equal(isInstalled(base, map), false, 'base game must NOT appear installed from Creator Kit only');
});

// ── Scenario 5: cleanTitle collision guard ─────────────────────────────────────

test('cleanTitle of installed game does not match a variant cleanTitle', () => {
    // Even if cleanTitle is in the map, variant entries skip that check
    const localGames = [
        { id: 'g1', name: 'My Game', command: 'run', appName: 'MyGame', allIds: { steam: '12345' } },
    ];
    const map = buildInstalledMap(localGames);

    // Hypothetical variant whose cleanTitle would NOT match "mygame" anyway
    const demo = { id: 'g2', title: 'My Game Demo', appName: 'MyGameDemo', allIds: { steam: '99999' } };
    assert.equal(isInstalled(demo, map), false, 'demo must not match via cleanTitle');

    // Confirm cleanTitle IS stored for non-variants
    assert.equal(map.has('mygame'), true, 'cleanTitle must be in map for base game');
    // "mygamedemo" is different and not in map
    assert.equal(map.has('mygamedemo'), false);
});

// ─── _gdGetProductTypeBadge reference tests ────────────────────────────────────
//
// These test the pure logic of badge selection without DOM.

const _GD_VARIANT_BADGE = {
    creator_kit:      { label: 'Creator Kit',      color: '#a78bfa' },
    dedicated_server: { label: 'Dedicated Server', color: '#60a5fa' },
    mod_kit:          { label: 'Mod Kit',           color: '#f59e0b' },
    playtest:         { label: 'Playtest',          color: '#60c0f0' },
    tool:             { label: 'Tool',              color: '#60c0f0' },
    trial:            { label: 'Trial',             color: '#34d399' },
    demo:             { label: 'Demo',              color: '#90e890' },
    alpha:            { label: 'Alpha',             color: '#f97316' },
    beta:             { label: 'Beta',              color: '#a0d0ff' },
    dlc:              { label: 'DLC',               color: '#f0c040' },
    mod:              { label: 'Mod',               color: '#f59e0b' },
    bundle:           { label: 'Bundle',            color: '#f0c040' },
    other:            { label: 'Other',             color: '#aaaaaa' },
};

function getProductTypeBadge(game, metaData) {
    if (metaData) {
        const et = metaData.entry_type;
        if (et && et !== 'game') {
            const serverMap = { demo: 'demo', dlc: 'dlc', mod: 'mod', tool: 'tool', other: 'other' };
            const key = serverMap[et];
            return (key && _GD_VARIANT_BADGE[key]) ? _GD_VARIANT_BADGE[key] : _GD_VARIANT_BADGE.other;
        }
        if (et === 'game') return null;
    }
    const variantType = classifyProductVariant(game.name || '');
    if (variantType === 'main') return null;
    return _GD_VARIANT_BADGE[variantType] || _GD_VARIANT_BADGE.other;
}

test('normal base game with no metadata → no badge', () => {
    assert.equal(getProductTypeBadge({ name: 'Hogwarts Legacy' }, null), null);
    assert.equal(getProductTypeBadge({ name: 'The Witcher 3' }, null), null);
});

test('Demo in title, no metadata → Demo badge', () => {
    const badge = getProductTypeBadge({ name: 'Detroit: Become Human Demo' }, null);
    assert.ok(badge, 'badge must not be null');
    assert.equal(badge.label, 'Demo');
});

test('Creator Kit in title, no metadata → Creator Kit badge', () => {
    const badge = getProductTypeBadge({ name: 'Hogwarts Legacy Creator Kit' }, null);
    assert.ok(badge, 'badge must not be null');
    assert.equal(badge.label, 'Creator Kit');
});

test('Server entry_type=demo overrides title (metadata-first)', () => {
    // Even if title is "Game", server says demo → show Demo badge
    const badge = getProductTypeBadge({ name: 'Some Game' }, { entry_type: 'demo' });
    assert.ok(badge, 'badge must not be null');
    assert.equal(badge.label, 'Demo');
});

test('Server entry_type=game suppresses title-keyword badge', () => {
    // Title says "demo" but server says "game" → no badge (server wins)
    const badge = getProductTypeBadge({ name: 'Some Game Demo' }, { entry_type: 'game' });
    assert.equal(badge, null, 'server entry_type=game must suppress title keyword badge');
});

test('Server entry_type=tool → Tool badge', () => {
    const badge = getProductTypeBadge({ name: 'Normal Game Name' }, { entry_type: 'tool' });
    assert.ok(badge);
    assert.equal(badge.label, 'Tool');
});

test('Trial / Playtest / Dedicated Server classification correct', () => {
    assert.equal(getProductTypeBadge({ name: 'Game Trial' }, null)?.label, 'Trial');
    assert.equal(getProductTypeBadge({ name: 'Game Playtest' }, null)?.label, 'Playtest');
    assert.equal(getProductTypeBadge({ name: 'Palworld Dedicated Server' }, null)?.label, 'Dedicated Server');
});

test('No metadata and no variant keyword → null badge', () => {
    assert.equal(getProductTypeBadge({ name: 'Democracy 4' }, null), null, 'Democracy 4 must not be flagged as demo');
    assert.equal(getProductTypeBadge({ name: 'Modular Grid' }, null), null, 'Modular Grid must not be flagged as mod');
});
