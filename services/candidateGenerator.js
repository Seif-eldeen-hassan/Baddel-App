'use strict';
const crypto = require('crypto');

// ─── Franchise alias dictionary ───────────────────────────────────────────────
// Maps compact/abbreviated prefixes → their full franchise expansion(s).
// Keys are lowercase, no spaces.  Values are ordered: most likely match first.
// Extend this as needed — it is intentionally small and data-driven.
const FRANCHISE_ALIASES = {
    // Assassin's Creed abbreviations
    'ac':          ["Assassin's Creed"],
    'acmirage':    ["Assassin's Creed Mirage"],
    'acorigins':   ["Assassin's Creed Origins"],
    'acodyssey':   ["Assassin's Creed Odyssey"],
    'acvalhalla':  ["Assassin's Creed Valhalla"],
    'acsyndicate': ["Assassin's Creed Syndicate"],
    'acunity':     ["Assassin's Creed Unity"],
    'acblackflag': ["Assassin's Creed IV Black Flag"],
    // Need For Speed
    'nfs':         ['Need for Speed'],
    'nfsmw':       ['Need for Speed Most Wanted'],
    'nfshp':       ['Need for Speed Hot Pursuit'],
    // Grand Theft Auto
    'gta':         ['Grand Theft Auto'],
    'gtav':        ['Grand Theft Auto V'],
    'gtaiv':       ['Grand Theft Auto IV'],
    // Call of Duty
    'cod':         ['Call of Duty'],
    'codmw':       ['Call of Duty Modern Warfare'],
    'codbo':       ['Call of Duty Black Ops'],
    // The Elder Scrolls
    'tes':         ['The Elder Scrolls'],
    // Far Cry
    'fc':          ['Far Cry'],
    // Red Dead
    'rdr':         ['Red Dead Redemption'],
    'rdr2':        ['Red Dead Redemption 2'],
    // Metal Gear
    'mgs':         ['Metal Gear Solid'],
    // Resident Evil
    're':          ['Resident Evil'],
    // Devil May Cry
    'dmc':         ['Devil May Cry'],
    // Dark Souls
    'ds':          ['Dark Souls'],
    // Batman Arkham
    'ba':          ['Batman Arkham'],
    // Dragon Age
    'da':          ['Dragon Age'],
    // Mass Effect
    'me':          ['Mass Effect'],
    // Rainbow Six Siege
    'r6s':                       ["Tom Clancy's Rainbow Six Siege", "Rainbow Six Siege"],
    'r6siege':                   ["Tom Clancy's Rainbow Six Siege", "Rainbow Six Siege"],
    'rainbowsix':                ["Tom Clancy's Rainbow Six Siege"],
    'rainbowsixsiege':           ["Tom Clancy's Rainbow Six Siege", "Rainbow Six Siege"],
    'tomclancysrainbowsixsiege': ["Rainbow Six Siege", "Tom Clancy's Rainbow Six Siege"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Slugify a string.
 * @param {string} s
 * @returns {string}
 */
function _toSlug(s) {
    if (!s) return '';
    return s.toLowerCase().trim()
        .replace(/['‘’ʼ＇'`™®©]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Split a camelCase or PascalCase word into space-separated words.
 *   "ACMirage"    → "AC Mirage"
 *   "ACOriginsHD" → "AC Origins HD"
 *   "NeedForSpeed"→ "Need For Speed"
 *
 * Strategy:
 *   - Insert a space before any uppercase letter that is followed by a lowercase
 *     letter AND preceded by a non-space.
 *   - Also insert a space between a run of uppercase letters and the next
 *     uppercase-then-lowercase group (e.g. "ACMirage" → "AC Mirage").
 * @param {string} s
 * @returns {string}
 */
function _splitCamelCase(s) {
    if (!s) return s;
    return s
        // "ACMirage" → "AC Mirage": between a run of caps and a cap+lower group
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        // "camelCase" → "camel Case": between a lower and an upper
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .trim();
}

/**
 * Normalise a string for deduplication comparison.
 * Lowercases and collapses whitespace but preserves word boundaries
 * so "AC Mirage" and "ACMirage" are NOT treated as the same candidate.
 * @param {string} s
 * @returns {string}
 */
function _norm(s) {
    if (!s) return '';
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Normalise a string as a dictionary key (strip all non-alphanumeric).
 * Used for FRANCHISE_ALIASES lookup only.
 * @param {string} s
 * @returns {string}
 */
function _dictKey(s) {
    if (!s) return '';
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Return true if the string looks like a compact/concatenated abbreviation
 * (no spaces, mixes case, 3–20 chars, and the camelCase split produces a
 * materially different string).
 * @param {string} s
 * @returns {boolean}
 */
function _looksCompact(s) {
    if (!s || s.includes(' ') || s.includes('-') || s.includes('_')) return false;
    const split = _splitCamelCase(s);
    return split !== s && split.trim().length > 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate an ordered, deduplicated list of metadata lookup candidates for a
 * manual / non-Steam / non-Epic game.
 *
 * Each candidate: { slug?: string, title?: string, displayName: string }
 *
 * Priority order:
 *   1. Provided custom name / display name
 *   2. Parent folder name (human-readable)
 *   3. EXE stem cleaned (spaces instead of dashes/underscores)
 *   4. Raw EXE stem
 *   5. CamelCase-split variants of any compact strings above
 *   6. Franchise alias expansions for any compact string or abbreviation above
 *   7. Slug-only variants for all of the above
 *
 * @param {{
 *   name?:        string,   // game.name / custom name
 *   folderName?:  string,   // parent directory name of the executable
 *   exeName?:     string,   // executable filename stem (no extension)
 *   pathHint?:    string,   // full path (used to derive folder/exe if not given)
 * }} hints
 * @param {number} [maxCandidates=10]  Cap to avoid retry storms.
 * @returns {Array<{slug?: string, title?: string, displayName: string}>}
 */
function generateMetadataCandidates(hints, maxCandidates = 10) {
    const { name, folderName, exeName, pathHint } = hints || {};

    // 1. Collect raw name strings in priority order
    const rawStrings = [];

    const _push = (s) => { if (s && s.trim()) rawStrings.push(s.trim()); };

    _push(name);
    _push(folderName);
    // Clean exe name: replace dashes/underscores with spaces
    if (exeName) _push(exeName.replace(/[-_]/g, ' ').trim());
    _push(exeName); // raw (may be compact e.g. "ACMirage")

    // Derive from pathHint if exeName/folderName not given
    if (pathHint) {
        const path = require('path');
        if (!exeName) {
            const stem = path.parse(pathHint).name;
            _push(stem.replace(/[-_]/g, ' ').trim());
            _push(stem);
        }
        if (!folderName) {
            _push(path.basename(path.dirname(pathHint)).replace(/[-_]/g, ' ').trim());
        }
    }

    // 2. Expand camelCase variants and franchise aliases for every raw string
    const expandedStrings = [];
    for (const s of rawStrings) {
        expandedStrings.push(s);

        // CamelCase split — always add if it produces something different
        const split = _looksCompact(s) ? _splitCamelCase(s) : null;
        if (split && split !== s) {
            expandedStrings.push(split);
        }

        // Franchise alias lookup (key = compact lowercase, no spaces/special)
        const key = _dictKey(s);
        const aliases = FRANCHISE_ALIASES[key];
        if (aliases) {
            for (const alias of aliases) expandedStrings.push(alias);
        }

        // Also try the slug form (dashes removed) in case key and slug differ
        const slugKey = _toSlug(s).replace(/-/g, '');
        if (slugKey !== key) {
            const slugAliases = FRANCHISE_ALIASES[slugKey];
            if (slugAliases) {
                for (const alias of slugAliases) expandedStrings.push(alias);
            }
        }

        // Partial-prefix alias: for compact names, try the leading uppercase
        // abbreviation (e.g. "NFSMostWanted" → "NFS" → 'Need for Speed').
        // We want the longest leading run of uppercase letters that forms a
        // known alias — check from 2 to min(6, leadingCapsLength) chars.
        const leadingCapsMatch = s.match(/^([A-Z]{2,})/);
        if (leadingCapsMatch) {
            const leadingCaps = leadingCapsMatch[1];
            for (let len = Math.min(leadingCaps.length, 6); len >= 2; len--) {
                const prefixKey = leadingCaps.slice(0, len).toLowerCase();
                const prefixAliases = FRANCHISE_ALIASES[prefixKey];
                if (prefixAliases) {
                    for (const alias of prefixAliases) expandedStrings.push(alias);
                    break; // use the longest matching prefix, stop
                }
            }
        }
    }

    // 3. Deduplicate, build candidate objects
    const seen = new Set();
    const candidates = [];

    for (const s of expandedStrings) {
        if (!s || !s.trim()) continue;
        const norm = _norm(s);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);

        const slug = _toSlug(s);
        const validSlug = (slug && slug.length >= 3 && !/^\d+$/.test(slug)) ? slug : undefined;

        candidates.push({
            slug:        validSlug,
            title:       s,
            displayName: s,
        });

        if (candidates.length >= maxCandidates) break;
    }

    return candidates;
}

/**
 * Compute a deterministic signature string from a candidate list.
 * Used by MRM to detect when the candidate set has changed since the last
 * terminal (not_found / ambiguous) result — allowing a fresh attempt.
 *
 * @param {Array<{slug?: string, title?: string}>} candidates
 * @returns {string}  Short hex hash
 */
function computeCandidateSignature(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return '';
    const parts = candidates.map(c => [c.slug || '', c.title || ''].join('|')).join(',');
    return crypto.createHash('md5').update(parts).digest('hex').slice(0, 12);
}

module.exports = { generateMetadataCandidates, computeCandidateSignature, _toSlug, _splitCamelCase };
