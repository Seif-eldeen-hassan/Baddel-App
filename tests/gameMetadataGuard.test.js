'use strict';
// Safety tests for get-game-metadata.
// Protects:
//   _canonicalSteamEpicId — Steam/Epic ID extraction from hints
//   _mapPlatformHint       — raw platform string → server platformHint value
//   handler structure      — server-pending shape, forceMetadata logic,
//                            MRM cooldown gate, mrm.resolve flags, error/fallback paths
// All tests are source-level (reading handlers/gameMetadataHandlers.js) or use local mirrors.
// No Electron process is started.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT    = path.resolve(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const GAME_METADATA_HANDLERS_JS = fs.readFileSync(
    path.join(ROOT, 'handlers', 'gameMetadataHandlers.js'), 'utf8'
);
const PLATFORM_HINTS_JS = fs.readFileSync(
    path.join(ROOT, 'src', 'shared', 'platform', 'platformHints.js'), 'utf8'
);

// ── Production function anchors ───────────────────────────────────────────────

const canonicalFnStart = GAME_METADATA_HANDLERS_JS.indexOf('function _canonicalSteamEpicId(');
// mapPlatformHint canonical definition now lives in the shared module (Phase 17.1).
const mapHintFnStart   = PLATFORM_HINTS_JS.indexOf('function mapPlatformHint(');
const handlerStart     = GAME_METADATA_HANDLERS_JS.indexOf("ipcMain.handle('get-game-metadata'");

assert.ok(canonicalFnStart !== -1, '_canonicalSteamEpicId must be defined in handlers/gameMetadataHandlers.js');
assert.ok(mapHintFnStart   !== -1, 'mapPlatformHint must be defined in src/shared/platform/platformHints.js');
assert.ok(handlerStart     !== -1, "get-game-metadata handler must exist in handlers/gameMetadataHandlers.js");
// Handler must import from shared instead of defining the mapper inline.
assert.ok(
    GAME_METADATA_HANDLERS_JS.includes('platformHints'),
    'handlers/gameMetadataHandlers.js must import from platformHints (no longer inline)'
);

// Verify the register call is wired up in main.js
assert.ok(
    MAIN_JS.includes("require('./handlers/gameMetadataHandlers').register"),
    'main.js must register gameMetadataHandlers'
);

// 9 500 chars covers the full handler body on Windows CRLF line endings.
const HANDLER_SRC = GAME_METADATA_HANDLERS_JS.slice(handlerStart, handlerStart + 9500);

// ── Local mirrors of private helpers ─────────────────────────────────────────
// Pattern from metadataPipeline.test.js: replicate private helper logic locally
// so behavioral tests run without spawning Electron. Source-anchor tests in
// sections 2 and 4 catch any divergence between these mirrors and production.

function canonicalSteamEpicId(platform, hints = {}) {
    const p = String(platform || '').toLowerCase().trim();
    if (p === 'steam') {
        const raw = hints.allIds?.steam || hints.appid || hints.appId || hints.steamAppId || hints.id;
        const cleaned = String(raw || '').replace(/^steam[-_]/i, '').trim();
        return /^\d+$/.test(cleaned) ? cleaned : null;
    }
    if (p === 'epic') {
        const raw = hints.allIds?.epic || hints.namespace || hints.catalogNamespace || hints.epicNamespace;
        const cleaned = String(raw || '').replace(/^epic[-_]/i, '').trim();
        if (cleaned.length >= 10 && /^[a-z0-9-]+$/i.test(cleaned)) return cleaned;
        return null;
    }
    return null;
}

function mapPlatformHint(raw) {
    if (!raw) return null;
    const p = raw.toLowerCase().trim();
    if (p === 'xbox' || p === 'xbox game pass' || p === 'microsoft store' || p === 'store') return 'xbox';
    if (p === 'ea app' || p === 'ea' || p === 'origin')                                     return 'ea';
    if (p === 'ubisoft connect' || p === 'ubisoft')                                          return 'ubisoft';
    if (p === 'riot games' || p === 'riot')                                                  return 'riot';
    if (p === 'rockstar' || p === 'rockstar games')                                          return 'rockstar';
    if (p === 'gog')                                                                         return 'gog';
    if (p === 'battlenet' || p === 'battle.net')                                             return 'battlenet';
    return null;
}

// ─── 1. _canonicalSteamEpicId — behavioral ───────────────────────────────────

test('_canonicalSteamEpicId: steam + numeric hints.id returns cleaned numeric string', () => {
    assert.equal(canonicalSteamEpicId('steam', { id: '570' }), '570');
});

test('_canonicalSteamEpicId: steam + hints.allIds.steam takes priority over hints.id', () => {
    assert.equal(canonicalSteamEpicId('steam', { allIds: { steam: '570' }, id: 'badvalue' }), '570');
});

test('_canonicalSteamEpicId: steam + hints.appId returns numeric string', () => {
    assert.equal(canonicalSteamEpicId('steam', { appId: '570' }), '570');
});

test('_canonicalSteamEpicId: steam + hints.steamAppId returns numeric string', () => {
    assert.equal(canonicalSteamEpicId('steam', { steamAppId: '570' }), '570');
});

test('_canonicalSteamEpicId: steam + steam_-prefixed id is stripped to numeric', () => {
    assert.equal(canonicalSteamEpicId('steam', { id: 'steam_570' }), '570');
});

test('_canonicalSteamEpicId: steam + non-numeric id returns null', () => {
    assert.equal(canonicalSteamEpicId('steam', { id: 'some-md5-hash-abc123' }), null);
});

test('_canonicalSteamEpicId: steam + empty hints returns null', () => {
    assert.equal(canonicalSteamEpicId('steam', {}), null);
});

test('_canonicalSteamEpicId: epic + valid hints.namespace (>=10 chars, alphanumeric+dash) returns it', () => {
    const ns = 'a1b2c3d4e5f6';
    assert.equal(canonicalSteamEpicId('epic', { namespace: ns }), ns);
});

test('_canonicalSteamEpicId: epic + hints.allIds.epic takes priority over namespace', () => {
    assert.equal(
        canonicalSteamEpicId('epic', { allIds: { epic: 'a1b2c3d4e5f6' }, namespace: 'zzzzzzzzzzz' }),
        'a1b2c3d4e5f6'
    );
});

test('_canonicalSteamEpicId: epic + hints.catalogNamespace is accepted', () => {
    assert.equal(canonicalSteamEpicId('epic', { catalogNamespace: 'a1b2c3d4e5f6' }), 'a1b2c3d4e5f6');
});

test('_canonicalSteamEpicId: epic + short namespace (< 10 chars) returns null', () => {
    assert.equal(canonicalSteamEpicId('epic', { namespace: 'abc123' }), null);
});

test('_canonicalSteamEpicId: epic + namespace containing underscore (invalid char) returns null', () => {
    // underscore fails /^[a-z0-9-]+$/i — only alphanumeric and dash are valid
    assert.equal(canonicalSteamEpicId('epic', { namespace: 'abc_def_ghi_jkl' }), null);
});

test('_canonicalSteamEpicId: epic + empty hints returns null', () => {
    assert.equal(canonicalSteamEpicId('epic', {}), null);
});

test('_canonicalSteamEpicId: unknown platform returns null', () => {
    assert.equal(canonicalSteamEpicId('ubisoft', { id: '570' }), null);
});

test('_canonicalSteamEpicId: empty platform returns null', () => {
    assert.equal(canonicalSteamEpicId('', { id: '570' }), null);
});

// ─── 2. _canonicalSteamEpicId — source-level anchors ─────────────────────────
// Catch any divergence between the local mirror above and the production function.

test('_canonicalSteamEpicId source: steam branch checks allIds.steam, appId, steamAppId', () => {
    const src = GAME_METADATA_HANDLERS_JS.slice(canonicalFnStart, canonicalFnStart + 1500);
    assert.match(src, /hints\.allIds\?\.steam/);
    assert.match(src, /hints\.appId/);
    assert.match(src, /hints\.steamAppId/);
});

test('_canonicalSteamEpicId source: steam branch validates all-digit id via /^\\d+$/', () => {
    const src = GAME_METADATA_HANDLERS_JS.slice(canonicalFnStart, canonicalFnStart + 1500);
    // In the source file the regex is the 7-char string /^\d+$/ with a literal backslash.
    assert.ok(src.includes('/^\\d+$/'), 'must use /^\\d+$/ to validate numeric steam id');
});

test('_canonicalSteamEpicId source: epic branch validates length >= 10', () => {
    const src = GAME_METADATA_HANDLERS_JS.slice(canonicalFnStart, canonicalFnStart + 1500);
    assert.match(src, /cleaned\.length\s*>=\s*10/);
});

test('_canonicalSteamEpicId source: epic branch validates alphanumeric+dash char class', () => {
    const src = GAME_METADATA_HANDLERS_JS.slice(canonicalFnStart, canonicalFnStart + 1500);
    assert.ok(src.includes('[a-z0-9-]'), 'must use [a-z0-9-] char class for epic namespace');
});

test('_canonicalSteamEpicId source: epic branch checks catalogNamespace and epicNamespace', () => {
    const src = GAME_METADATA_HANDLERS_JS.slice(canonicalFnStart, canonicalFnStart + 1500);
    assert.match(src, /catalogNamespace/);
    assert.match(src, /epicNamespace/);
});

// ─── 3. _mapPlatformHint — behavioral ────────────────────────────────────────

test('_mapPlatformHint: "xbox game pass" maps to "xbox"', () => {
    assert.equal(mapPlatformHint('xbox game pass'), 'xbox');
});

test('_mapPlatformHint: "microsoft store" maps to "xbox"', () => {
    assert.equal(mapPlatformHint('microsoft store'), 'xbox');
});

test('_mapPlatformHint: "ea app" maps to "ea"', () => {
    assert.equal(mapPlatformHint('ea app'), 'ea');
});

test('_mapPlatformHint: "origin" maps to "ea"', () => {
    assert.equal(mapPlatformHint('origin'), 'ea');
});

test('_mapPlatformHint: "ubisoft connect" maps to "ubisoft"', () => {
    assert.equal(mapPlatformHint('ubisoft connect'), 'ubisoft');
});

test('_mapPlatformHint: "riot games" maps to "riot"', () => {
    assert.equal(mapPlatformHint('riot games'), 'riot');
});

test('_mapPlatformHint: "rockstar games" maps to "rockstar"', () => {
    assert.equal(mapPlatformHint('rockstar games'), 'rockstar');
});

test('_mapPlatformHint: "gog" maps to "gog"', () => {
    assert.equal(mapPlatformHint('gog'), 'gog');
});

test('_mapPlatformHint: "battle.net" maps to "battlenet"', () => {
    assert.equal(mapPlatformHint('battle.net'), 'battlenet');
});

test('_mapPlatformHint: "battlenet" maps to "battlenet"', () => {
    assert.equal(mapPlatformHint('battlenet'), 'battlenet');
});

test('_mapPlatformHint: unknown platform string returns null', () => {
    assert.equal(mapPlatformHint('discord'), null);
});

test('_mapPlatformHint: "steam" returns null — steam takes the fast path before this function', () => {
    assert.equal(mapPlatformHint('steam'), null);
});

test('_mapPlatformHint: "epic" returns null — epic takes the fast path before this function', () => {
    assert.equal(mapPlatformHint('epic'), null);
});

test('_mapPlatformHint: null and empty string both return null', () => {
    assert.equal(mapPlatformHint(null), null);
    assert.equal(mapPlatformHint(''), null);
});

// ─── 4. _mapPlatformHint — source-level anchor ───────────────────────────────

test('_mapPlatformHint source: all eight platform mappings are present', () => {
    // Canonical definition now lives in src/shared/platform/platformHints.js (Phase 17.1).
    const src = PLATFORM_HINTS_JS.slice(mapHintFnStart, mapHintFnStart + 1000);
    assert.match(src, /xbox game pass/);
    assert.match(src, /ea app/);
    assert.match(src, /ubisoft connect/);
    assert.match(src, /riot games/);
    assert.match(src, /rockstar games/);
    assert.match(src, /gog/);
    assert.match(src, /battle\.net/);
    assert.match(src, /battlenet/);
});

// ─── 5. Handler structure — Steam/Epic fast path ─────────────────────────────

test('get-game-metadata: Steam/Epic fast path is guarded by STEAM_EPIC.has(platform)', () => {
    assert.match(HANDLER_SRC, /STEAM_EPIC\.has\(platform\)/);
});

test('get-game-metadata: Steam/Epic miss path calls requestGameEnrich', () => {
    assert.match(HANDLER_SRC, /requestGameEnrich/);
});

test('get-game-metadata: Steam/Epic miss returns source: "server-pending"', () => {
    assert.match(HANDLER_SRC, /source:\s*['"]server-pending['"]/);
});

test('get-game-metadata: Steam/Epic miss returns _serverData.pending === true', () => {
    assert.match(HANDLER_SRC, /pending:\s*true/);
});

test('get-game-metadata: Steam/Epic miss _serverData includes externalId: canonicalId', () => {
    assert.match(HANDLER_SRC, /externalId:\s*canonicalId/);
});

test('get-game-metadata: server-pending info object has empty screenshots, artworks, allTrailers', () => {
    // indexOf("'server-pending'") skips the comment line and lands on the return-value string
    const pendingIdx  = HANDLER_SRC.indexOf("'server-pending'");
    const pendingBlock = HANDLER_SRC.slice(pendingIdx, pendingIdx + 400);
    assert.match(pendingBlock, /screenshots:\s*\[\]/);
    assert.match(pendingBlock, /artworks:\s*\[\]/);
    assert.match(pendingBlock, /allTrailers:\s*\[\]/);
});

// ─── 6. forceMetadata conditions ─────────────────────────────────────────────

test('get-game-metadata: forceMetadata checks hints.force === true', () => {
    assert.match(HANDLER_SRC, /hints\.force\s*===\s*true/);
});

test('get-game-metadata: forceMetadata checks hints.bypassTtl === true', () => {
    assert.match(HANDLER_SRC, /hints\.bypassTtl\s*===\s*true/);
});

test('get-game-metadata: forceMetadata checks hints.ignoreTtl === true', () => {
    assert.match(HANDLER_SRC, /hints\.ignoreTtl\s*===\s*true/);
});

test('get-game-metadata: forceMetadata checks hints.source === "manual-add-readd"', () => {
    assert.match(HANDLER_SRC, /hints\.source\s*===\s*['"]manual-add-readd['"]/);
});

test('get-game-metadata: forceMetadata checks hints.source === "manual-add"', () => {
    assert.match(HANDLER_SRC, /hints\.source\s*===\s*['"]manual-add['"]/);
});

test('get-game-metadata: all five forceMetadata conditions appear in a contiguous block', () => {
    const forceIdx   = HANDLER_SRC.indexOf('forceMetadata');
    const forceBlock = HANDLER_SRC.slice(forceIdx, forceIdx + 500);
    assert.match(forceBlock, /hints\.force/);
    assert.match(forceBlock, /hints\.bypassTtl/);
    assert.match(forceBlock, /hints\.ignoreTtl/);
    assert.match(forceBlock, /manual-add-readd/);
    assert.match(forceBlock, /manual-add/);
});

// ─── 7. MRM cooldown gate ────────────────────────────────────────────────────

test('get-game-metadata: cooldown check is gated by !forceMetadata', () => {
    assert.match(HANDLER_SRC, /!forceMetadata.*cooldown|cooldown.*!forceMetadata/s);
});

test('get-game-metadata: cooldown path returns _mrmStatus: "cooldown"', () => {
    assert.match(HANDLER_SRC, /_mrmStatus:\s*['"]cooldown['"]/);
});

test('get-game-metadata: cooldown return includes _cooldownUntil field', () => {
    assert.match(HANDLER_SRC, /_cooldownUntil/);
});

// ─── 8. mrm.resolve call flags ───────────────────────────────────────────────

test('get-game-metadata: mrm.resolve receives force: forceMetadata', () => {
    assert.match(HANDLER_SRC, /force:\s*forceMetadata/);
});

test('get-game-metadata: mrm.resolve receives bypassTtl: forceMetadata', () => {
    assert.match(HANDLER_SRC, /bypassTtl:\s*forceMetadata/);
});

test('get-game-metadata: mrm.resolve receives candidates: mrmCandidates', () => {
    assert.match(HANDLER_SRC, /candidates:\s*mrmCandidates/);
});

test('get-game-metadata: mrm.resolve receives platformHint via _mapPlatformHint(hints.platform)', () => {
    assert.match(HANDLER_SRC, /platformHint:.*_mapPlatformHint/);
});

test('get-game-metadata: resolveResult.meta._resolveSource is populated before returning', () => {
    assert.match(HANDLER_SRC, /resolveResult\.meta\._resolveSource\s*=\s*resolveResult\._resolveSource/);
});

// ─── 9. Error and fallback paths ─────────────────────────────────────────────

test('get-game-metadata: catch block returns null (not undefined, not rethrow)', () => {
    const catchIdx = HANDLER_SRC.lastIndexOf('} catch (err)');
    assert.ok(catchIdx !== -1, 'catch block must exist');
    const catchBlock = HANDLER_SRC.slice(catchIdx, catchIdx + 200);
    assert.match(catchBlock, /return null/);
});

test('get-game-metadata: MRM-unavailable fallback explicitly returns null', () => {
    assert.match(HANDLER_SRC, /MRM is not available/);
    const fallbackIdx   = HANDLER_SRC.indexOf('MRM is not available');
    const fallbackBlock = HANDLER_SRC.slice(fallbackIdx, fallbackIdx + 120);
    assert.match(fallbackBlock, /return null/);
});
