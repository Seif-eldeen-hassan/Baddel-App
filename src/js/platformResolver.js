'use strict';
// Canonical platform detection — shared between the renderer and the test suite.
// Browser: exposes window._baddelCanonicalPlatforms + window._baddelGetStrictSteamAppId
// Node.js: module.exports = { canonicalPlatforms, getStrictSteamAppId }

// Maps known platform strings (lowercase-trimmed) → canonical names.
// Covers all values emitted by gameScanner.js, accountsHandler.js, and platformSync.js.
const PLATFORM_CANONICAL = {
    'steam': 'steam',
    'epic': 'epic', 'epic games': 'epic',
    'ea': 'ea', 'ea app': 'ea', 'ea games': 'ea', 'origin': 'ea', 'electronic arts': 'ea',
    'riot': 'riot', 'riot games': 'riot',
    'ubisoft': 'ubisoft', 'ubisoft connect': 'ubisoft', 'uplay': 'ubisoft',
    'rockstar': 'rockstar', 'rockstar games': 'rockstar',
    'xbox': 'xbox', 'xbox game pass': 'xbox', 'xbox / store': 'xbox',
    'microsoft': 'xbox', 'microsoft store': 'xbox', 'store': 'xbox',
    'gog': 'gog', 'gog.com': 'gog',
    'battlenet': 'battlenet', 'battle.net': 'battlenet',
    'discord': 'discord',
    'manual': 'manual', 'local': 'manual',
};

function _lookupField(raw) {
    if (!raw) return null;
    return PLATFORM_CANONICAL[String(raw).toLowerCase().trim()] || null;
}

/**
 * Returns the canonical platform list for a game object.
 *
 * Rules:
 * - Reads only explicit, structured fields (source, platform, platforms[], allIds, riotProduct).
 * - Command detection uses specific protocol/marker patterns only (never generic substrings).
 * - Riot short-circuits any EA mis-detection when a Riot marker is present.
 * - Returns ['manual'] for unknown/local games — never falls back to 'steam'.
 */
function canonicalPlatforms(game) {
    if (!game) return ['manual'];

    const s = new Set();

    // 1. Explicit platforms array (merged library entries written by platformSync)
    if (Array.isArray(game.platforms)) {
        for (const p of game.platforms) {
            const c = _lookupField(p);
            if (c) s.add(c);
        }
    }

    // 2. Scalar source / platform fields — exact normalized lookup, no substring scan
    const sc = _lookupField(game.source);
    if (sc) s.add(sc);
    const pc = _lookupField(game.platform);
    if (pc) s.add(pc);

    // 3. Structured metadata fields that prove platform membership
    if (game.allIds?.steam != null) s.add('steam');
    if (game.allIds?.epic  != null) s.add('epic');
    if (game.riotProduct)           s.add('riot');

    // 4. Protocol / marker detection in the command string — unambiguous patterns only
    const cmd = String(game.command || '');
    if (/^steam:\/\//i.test(cmd))           s.add('steam');
    if (/^eadesktop:\/\//i.test(cmd))       s.add('ea');
    if (/^origin:\/\//i.test(cmd))          s.add('ea');
    if (/^uplay:\/\//i.test(cmd))           s.add('ubisoft');
    if (/^ubisoft-connect:\/\//i.test(cmd)) s.add('ubisoft');
    if (/com\.epicgames\./i.test(cmd))      s.add('epic');
    if (/--launch-product=/i.test(cmd))     s.add('riot');
    if (/RiotClientServices/i.test(cmd))    s.add('riot');

    // 5. Riot short-circuit: once Riot is confirmed, discard any EA signal.
    //    Riot's installer infrastructure can leave EA-looking breadcrumbs in paths.
    if (s.has('riot')) s.delete('ea');

    // 6. Discard 'manual' when a real store platform was found alongside it
    if (s.size > 1) s.delete('manual');

    // 7. No steam fallback — unknown/local games stay 'manual'
    if (s.size === 0) s.add('manual');

    return [...s];
}

/**
 * Returns the strict Steam app ID (numeric string ≥ 3 digits) for a game, or null.
 *
 * STRICT contract:
 * - Returns non-null ONLY when the game is canonically Steam AND an explicit
 *   numeric app ID is available from a known structured field.
 * - Does NOT read arbitrary digit runs from game.id or game.command.
 */
function getStrictSteamAppId(game) {
    if (!game) return null;
    if (!canonicalPlatforms(game).includes('steam')) return null;

    // 1. allIds.steam — written by the scanner at import time
    if (game.allIds?.steam != null) {
        const id = String(game.allIds.steam).trim();
        if (/^\d{3,}$/.test(id)) return id;
    }

    // 2. steam:// launch protocol in the command field
    const cmd = String(game.command || '');
    const m = cmd.match(/^steam:\/\/run\/(\d+)/i);
    if (m) return m[1];

    // 3. game.id with an explicit "steam-" / "steam_" scanner prefix
    const raw = String(game.id || '');
    if (/^steam[-_]/i.test(raw)) {
        const stripped = raw.replace(/^steam[-_]/i, '').trim();
        if (/^\d{3,}$/.test(stripped)) return stripped;
    }

    return null;
}

/**
 * Classifies a game's product variant type from its raw (unmodified) title.
 *
 * IMPORTANT: Pass the raw/unmodified title — never a cleaned or normalised version.
 * Cleaning strips variant suffixes ("Demo", "Creator Kit") that are the key signal.
 *
 * This is used in two places:
 *   1. Installed-Only filter (accounts.js) — variants are excluded from cleanTitle
 *      fallback so a base-game installation never makes a variant appear installed.
 *   2. Game Details badge (game-details.js) — title-keyword fallback when server
 *      metadata is absent; overridden by entry_type when metadata arrives.
 *
 * Returns one of:
 *   'creator_kit' | 'dedicated_server' | 'mod_kit' | 'playtest' | 'tool' |
 *   'trial' | 'demo' | 'alpha' | 'beta' | 'dlc' | 'mod' | 'bundle' | 'main'
 *
 * 'main' = no variant detected → treat as base game.
 */
function classifyProductVariant(rawTitle) {
    const s = String(rawTitle || '');
    if (!s.trim()) return 'main';

    // Ordered most-specific first so longer patterns shadow short ones.
    if (/\bcreator\s+kit\b/i.test(s))                                               return 'creator_kit';
    if (/\bdedicated\s+server\b/i.test(s))                                          return 'dedicated_server';
    if (/\bmod(?:ding)?\s+(?:kit|sdk|tools?)\b|\bmod\s+tools?\b/i.test(s))         return 'mod_kit';
    if (/\bpublic\s+test\b|\bplaytest\b|\btest\s+(?:server|build|branch)\b/i.test(s)) return 'playtest';
    if (/\bsdk\b|\btoolkit\b|\btoolset\b|\bcreation\s+kit\b/i.test(s))             return 'tool';
    if (/\btrial\b/i.test(s))                                                       return 'trial';
    if (/\bdemo\b/i.test(s))                                                        return 'demo';
    if (/\balpha\b/i.test(s))                                                       return 'alpha';
    if (/\bbeta\b/i.test(s))                                                        return 'beta';
    if (/\bdlc\b|\bcontent\s+pack\b/i.test(s))                                     return 'dlc';
    if (/\bmod\b/i.test(s))                                                         return 'mod';
    if (/\bbundle\b/i.test(s))                                                      return 'bundle';

    return 'main';
}

// Dual-mode export: CommonJS (tests) or browser global
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { canonicalPlatforms, getStrictSteamAppId, classifyProductVariant };
} else {
    window._baddelCanonicalPlatforms   = canonicalPlatforms;
    window._baddelGetStrictSteamAppId  = getStrictSteamAppId;
    window._baddelClassifyVariant      = classifyProductVariant;
}
