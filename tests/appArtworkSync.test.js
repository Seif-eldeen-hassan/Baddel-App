'use strict';

const fs   = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT            = path.join(__dirname, '..');
const APP_JS          = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'), 'utf8');
const COLLECTIONS_JS  = fs.readFileSync(path.join(ROOT, 'src/js/app/collections.js'), 'utf8');
const HTML            = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── Extraction helpers ────────────────────────────────────────────────────────
//
// These use brace-balanced extraction so tests never break due to function
// growth — they always see the full function body regardless of line count.

/**
 * Extract the full body of a named function declaration or expression.
 * Matches: function NAME(...) { ... } or async function NAME(...) { ... }
 * Returns the source from the function keyword through its closing brace.
 */
function getFunctionBody(source, functionName) {
    const marker = 'function ' + functionName;
    const start = source.indexOf(marker);
    if (start === -1) return '';
    const braceOpen = source.indexOf('{', start);
    if (braceOpen === -1) return '';
    let depth = 0;
    for (let i = braceOpen; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return source.slice(start);
}

/**
 * Extract the full body of a window-assigned function.
 * Matches: window.NAME = function(...) { ... }  or  window.NAME = async function(...) { ... }
 * Returns source from "window.NAME" through the closing brace.
 * Skips past the parameter list before looking for the body's opening brace so
 * default-object parameters (e.g. patch = {}) do not confuse brace counting.
 */
function getWindowAssignedFunctionBody(source, assignmentName) {
    const marker = 'window.' + assignmentName;
    const start = source.indexOf(marker);
    if (start === -1) return '';
    const funcKw = source.indexOf('function', start);
    if (funcKw === -1) return '';
    const parenOpen = source.indexOf('(', funcKw);
    if (parenOpen === -1) return '';
    // Balance parens to skip past the parameter list.
    let parenDepth = 0;
    let parenClose = -1;
    for (let i = parenOpen; i < source.length; i++) {
        if (source[i] === '(') parenDepth++;
        else if (source[i] === ')') {
            parenDepth--;
            if (parenDepth === 0) { parenClose = i; break; }
        }
    }
    if (parenClose === -1) return '';
    // Now find the opening brace of the function body.
    const braceOpen = source.indexOf('{', parenClose);
    if (braceOpen === -1) return '';
    let depth = 0;
    for (let i = braceOpen; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return source.slice(start);
}

/**
 * Extract source between two comment/string markers (exclusive of the end marker).
 * Returns '' if either marker is not found.
 */
function getSectionBetween(source, startMarker, endMarker) {
    const s = source.indexOf(startMarker);
    const e = source.indexOf(endMarker);
    if (s === -1 || e === -1 || e <= s) return '';
    return source.slice(s, e);
}

// ── Section 1: Image URL helpers ─────────────────────────────────────────────

describe('Phase 2.12B: artwork-sync — image URL helpers in artwork-sync.js', () => {
    it('isUsableImageUrl is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function isUsableImageUrl\s*\(/);
    });
    it('_preferLocalImage is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _preferLocalImage\s*\(/);
    });
    it('isCacheBackedArtworkUrl is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function isCacheBackedArtworkUrl\s*\(/);
    });
    it('getPosterUrl is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function getPosterUrl\s*\(/);
    });
    it('getPosterUrlInstalled is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function getPosterUrlInstalled\s*\(/);
    });
    it('_cardImageApply is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _cardImageApply\s*\(/);
    });
    it('setCardImageStable is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function setCardImageStable\s*\(/);
    });
    it('_heroBgApply is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _heroBgApply\s*\(/);
    });
    it('setHeroBgStable is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function setHeroBgStable\s*\(/);
    });
    it('normal artwork setters reject direct remote renderer URLs', () => {
        const guard = getFunctionBody(ARTWORK_SYNC_JS, 'isCacheBackedArtworkUrl');
        const card = getFunctionBody(ARTWORK_SYNC_JS, 'setCardImageStable');
        const hero = getFunctionBody(ARTWORK_SYNC_JS, 'setHeroBgStable');

        assert.match(guard, /startsWith\('http:\/\/'\)/);
        assert.match(guard, /startsWith\('https:\/\/'\)/);
        assert.match(card, /isCacheBackedArtworkUrl\(newUrl\)/);
        assert.match(card, /isCacheBackedArtworkUrl\(fallbackUrl\)/);
        assert.match(hero, /isCacheBackedArtworkUrl\(newUrl\)/);
        assert.match(hero, /isCacheBackedArtworkUrl\(fallbackUrl\)/);
    });
    it('_getGameCoverUrl is defined in collections.js', () => {
        assert.match(COLLECTIONS_JS, /function _getGameCoverUrl\s*\(/);
    });
});

// ── Section 2: Artwork alias normalisation and in-memory patching ─────────────

describe('Phase 2.12B: artwork-sync — normalise and patch helpers', () => {
    it('_normalizeArtworkAliases is defined in artwork-sync.js', () => {
        assert.match(ARTWORK_SYNC_JS, /function _normalizeArtworkAliases\s*\(/);
    });
    it('_patchGameInMemory is defined in app.js', () => {
        assert.match(APP_JS, /function _patchGameInMemory\s*\(/);
    });
    it('_patchVisibleGameCard is defined in artwork-sync.js', () => {
        assert.match(ARTWORK_SYNC_JS, /function _patchVisibleGameCard\s*\(/);
    });

    it('_normalizeArtworkAliases normalises cover aliases', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_normalizeArtworkAliases');
        assert.match(fn, /g\.image\s*=/);
        assert.match(fn, /g\.coverUrl\s*=/);
        assert.match(fn, /g\.defaultImage\s*=/);
    });
    it('_normalizeArtworkAliases normalises hero aliases', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_normalizeArtworkAliases');
        assert.match(fn, /g\.heroImage\s*=/);
        assert.match(fn, /g\.heroUrl\s*=/);
        assert.match(fn, /g\.defaultHero\s*=/);
    });
    it('_normalizeArtworkAliases normalises logo aliases', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_normalizeArtworkAliases');
        assert.match(fn, /g\.logo\s*=/);
        assert.match(fn, /g\.logoUrl\s*=/);
        assert.match(fn, /g\.defaultLogo\s*=/);
    });

    it('_patchGameInMemory calls _normalizeArtworkAliases', () => {
        const fn = getFunctionBody(APP_JS, '_patchGameInMemory');
        assert.match(fn, /_normalizeArtworkAliases/);
    });
    it('_patchGameInMemory updates allGamesData', () => {
        const fn = getFunctionBody(APP_JS, '_patchGameInMemory');
        assert.match(fn, /allGamesData/);
        assert.match(fn, /window\.allGamesData\s*=/);
    });
    it('_patchGameInMemory updates _allGamesCache', () => {
        const fn = getFunctionBody(APP_JS, '_patchGameInMemory');
        assert.match(fn, /window\._allGamesCache/);
    });
    it('_patchGameInMemory clears virtual-scroll card cache', () => {
        const fn = getFunctionBody(APP_JS, '_patchGameInMemory');
        assert.match(fn, /window\._vs\?\.cardCache/);
    });

    it('_patchVisibleGameCard targets [data-id] selector', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_patchVisibleGameCard');
        assert.match(fn, /data-id/);
    });
    it('_patchVisibleGameCard targets .actual-img selector', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_patchVisibleGameCard');
        assert.match(fn, /\.actual-img/);
    });
});

// ── Section 3: Metadata fetch and image queue pipeline ───────────────────────

describe('Phase 2.12B: artwork-sync — image queue pipeline in app.js', () => {
    it('imageQueue state var is declared', () => {
        assert.match(APP_JS, /^const imageQueue\s*=\s*\[\]/m);
    });
    it('activeRequests state var is declared', () => {
        assert.match(APP_JS, /^let activeRequests\s*=/m);
    });

    it('fetchMetadata is defined', () => {
        assert.match(APP_JS, /async function fetchMetadata\s*\(/);
    });
    it('processQueue is defined', () => {
        assert.match(APP_JS, /async function processQueue\s*\(/);
    });
    it('checkBackgroundAssets is defined', () => {
        assert.match(APP_JS, /function checkBackgroundAssets\s*\(/);
    });

    it('fetchMetadata pushes to imageQueue and calls processQueue', () => {
        const fn = getFunctionBody(APP_JS, 'fetchMetadata');
        assert.match(fn, /imageQueue\.push/);
        assert.match(fn, /processQueue\(\)/);
    });
    it('fetchMetadata probes local file:// URLs before trusting them', () => {
        const fn = getFunctionBody(APP_JS, 'fetchMetadata');
        assert.match(fn, /probeLocalImage/);
        assert.match(fn, /file:\/\//);
    });
    it('fetchMetadata checks disk cache via getCachedImage', () => {
        const fn = getFunctionBody(APP_JS, 'fetchMetadata');
        assert.match(fn, /getCachedImage/);
    });
    it('processQueue calls getMetadata for fresh metadata', () => {
        const fn = getFunctionBody(APP_JS, 'processQueue');
        assert.match(fn, /getMetadata/);
    });
    it('processQueue calls cacheAllAssets to persist local copies', () => {
        const fn = getFunctionBody(APP_JS, 'processQueue');
        assert.match(fn, /cacheAllAssets/);
    });
    it('processQueue calls saveMetadata after caching', () => {
        const fn = getFunctionBody(APP_JS, 'processQueue');
        assert.match(fn, /saveMetadata/);
    });
    it('processQueue routes cached artwork through canonical coordinator instead of direct card patching', () => {
        const fn = getFunctionBody(APP_JS, 'processQueue');
        assert.match(fn, /__baddelCommitCanonicalGameUpdate/);
        assert.doesNotMatch(fn, /_patchVisibleGameCard\(patched\)/);
    });
    it('processQueue caps activeRequests to 3', () => {
        const fn = getFunctionBody(APP_JS, 'processQueue');
        assert.match(fn, /activeRequests\s*>=\s*3/);
    });
    it('processQueue retries server-pending results up to 3 times', () => {
        const fn = getFunctionBody(APP_JS, 'processQueue');
        assert.match(fn, /_coverRetries\s*<\s*3/);
        assert.match(fn, /setTimeout/);
    });
    it('checkBackgroundAssets reads hero and logo from localStorage', () => {
        const fn = getFunctionBody(APP_JS, 'checkBackgroundAssets');
        assert.match(fn, /localStorage\.getItem\('hero_'/);
        assert.match(fn, /localStorage\.getItem\('logo_'/);
    });
});

// ── Section 4: RTIA — Ready-to-Install Asset Hydrator ────────────────────────

describe('Phase 2.12B: artwork-sync — RTIA asset hydrator in artwork-sync.js', () => {
    it('_RTIA_DISK_CONCURRENCY constant is declared', () => {
        assert.match(ARTWORK_SYNC_JS, /const _RTIA_DISK_CONCURRENCY\s*=/);
    });
    it('_RTIA_HYDRATE_TIMEOUT constant is declared', () => {
        assert.match(ARTWORK_SYNC_JS, /const _RTIA_HYDRATE_TIMEOUT\s*=/);
    });
    it('_rtia_running state var is declared', () => {
        assert.match(ARTWORK_SYNC_JS, /let\s+_rtia_running\s*=/);
    });
    it('_rtia_warmOne is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /async function _rtia_warmOne\s*\(/);
    });
    it('_rtia_warmBatch is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /async function _rtia_warmBatch\s*\(/);
    });
    it('_rtia_awaitHydration is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _rtia_awaitHydration\s*\(/);
    });
    it('_rtia_hydrateAll is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /async function _rtia_hydrateAll\s*\(/);
    });

    it('_rtia_warmOne validates file:// URLs via probeLocalImage', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_rtia_warmOne');
        assert.match(fn, /probeLocalImage/);
        assert.match(fn, /file:\/\//);
    });
    it('_rtia_warmOne falls back to disk cache via getCachedImage', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_rtia_warmOne');
        assert.match(fn, /getCachedImage/);
    });
    it('_rtia_warmOne calls _suggArtCachePopulate after hydration', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_rtia_warmOne');
        assert.match(fn, /_suggArtCachePopulate/);
    });
    it('_rtia_warmBatch processes games with _RTIA_DISK_CONCURRENCY parallel workers', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_rtia_warmBatch');
        assert.match(fn, /_RTIA_DISK_CONCURRENCY/);
        assert.match(fn, /Promise\.all/);
    });
    it('_rtia_hydrateAll guards against concurrent runs via _rtia_running', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_rtia_hydrateAll');
        assert.match(fn, /_rtia_running/);
    });
    it('_rtia_hydrateAll awaits _rtia_warmBatch before kicking off network hydration', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_rtia_hydrateAll');
        assert.match(fn, /await _rtia_warmBatch/);
        assert.match(fn, /_suggHydrateArt/);
    });
});

// ── Section 5: Suggestion art cache helpers ───────────────────────────────────

describe('Phase 2.12B: artwork-sync — suggestion art cache helpers in artwork-sync.js', () => {
    it('_SUGG_ART_CACHE_KEY constant is declared', () => {
        assert.match(ARTWORK_SYNC_JS, /const _SUGG_ART_CACHE_KEY\s*=/);
    });
    it('_suggArtCache state var is declared', () => {
        assert.match(ARTWORK_SYNC_JS, /let _suggArtCache\s*=/);
    });
    it('_suggArtCacheGet is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _suggArtCacheGet\s*\(/);
    });
    it('_suggArtCacheSave is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _suggArtCacheSave\s*\(/);
    });
    it('_suggArtCacheSet is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _suggArtCacheSet\s*\(/);
    });
    it('_suggArtCacheDeleteField is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _suggArtCacheDeleteField\s*\(/);
    });
    it('_suggArtCachePopulate is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _suggArtCachePopulate\s*\(/);
    });

    it('_suggArtCacheSave writes to localStorage', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_suggArtCacheSave');
        assert.match(fn, /localStorage\.setItem/);
        assert.match(fn, /_SUGG_ART_CACHE_KEY/);
    });
    it('_suggArtCacheSet merges with existing entry before saving', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_suggArtCacheSet');
        assert.match(fn, /_suggArtCache\[key\]\s*\|\|\s*\{\}/);
        assert.match(fn, /_suggArtCacheSave/);
    });
    it('_suggArtCacheDeleteField removes entry when last field is deleted', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_suggArtCacheDeleteField');
        assert.match(fn, /delete _suggArtCache\[key\]/);
        assert.match(fn, /_suggArtCacheSave/);
    });
    it('_suggArtCachePopulate uses _preferLocalImage for poster, hero, logo', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_suggArtCachePopulate');
        assert.match(fn, /_preferLocalImage/);
        assert.match(fn, /poster/);
        assert.match(fn, /hero/);
        assert.match(fn, /logo/);
    });
});

// ── Section 6: Artwork local state management ─────────────────────────────────

describe('Phase 2.12B: artwork-sync — local artwork state management in artwork-sync.js', () => {
    it('_clearArtworkLocalState is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /function _clearArtworkLocalState\s*\(/);
    });
    it('_isUsableLocalArtwork is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /async function _isUsableLocalArtwork\s*\(/);
    });
    it('hydrateManualGameArtworkNow is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /async function hydrateManualGameArtworkNow\s*\(/);
    });
    it('hydrateRecentHeroArtwork is defined', () => {
        assert.match(ARTWORK_SYNC_JS, /async function hydrateRecentHeroArtwork\s*\(/);
    });

    it('_clearArtworkLocalState removes cover/hero/logo from localStorage', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_clearArtworkLocalState');
        assert.match(fn, /localStorage\.removeItem\('cover_'/);
        assert.match(fn, /localStorage\.removeItem\('hero_'/);
        assert.match(fn, /localStorage\.removeItem\('logo_'/);
    });
    it('_clearArtworkLocalState purges virtual-scroll and games caches', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_clearArtworkLocalState');
        assert.match(fn, /window\._vs\?\.cardCache/);
        assert.match(fn, /window\._allGamesCache/);
        assert.match(fn, /allGamesData/);
    });

    it('_isUsableLocalArtwork probes file:// URLs via probeLocalImage', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_isUsableLocalArtwork');
        assert.match(fn, /probeLocalImage/);
        assert.match(fn, /file:\/\//);
    });
    it('_isUsableLocalArtwork returns true for non-file URLs without probing', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_isUsableLocalArtwork');
        assert.match(fn, /return true/);
    });

    it('hydrateManualGameArtworkNow reads cover/hero/logo from localStorage', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateManualGameArtworkNow');
        assert.match(fn, /localStorage\.getItem\('cover_'/);
        assert.match(fn, /localStorage\.getItem\('hero_'/);
        assert.match(fn, /localStorage\.getItem\('logo_'/);
    });
    it('hydrateManualGameArtworkNow calls getMetadata to fetch fresh art', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateManualGameArtworkNow');
        assert.match(fn, /getMetadata/);
    });
    it('hydrateManualGameArtworkNow calls cacheAllAssets to persist local copies', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateManualGameArtworkNow');
        assert.match(fn, /cacheAllAssets/);
    });
    it('hydrateManualGameArtworkNow calls saveMetadata after caching', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateManualGameArtworkNow');
        assert.match(fn, /saveMetadata/);
    });
    it('hydrateManualGameArtworkNow calls _patchGameInMemory and _patchVisibleGameCard', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateManualGameArtworkNow');
        assert.match(fn, /_patchGameInMemory/);
        assert.match(fn, /_patchVisibleGameCard/);
    });

    it('hydrateRecentHeroArtwork calls getMetadata with preferHero flag', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateRecentHeroArtwork');
        assert.match(fn, /getMetadata/);
        assert.match(fn, /preferHero/);
    });
    it('hydrateRecentHeroArtwork calls cacheAllAssets and saveMetadata', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateRecentHeroArtwork');
        assert.match(fn, /cacheAllAssets/);
        assert.match(fn, /saveMetadata/);
    });
    it('hydrateRecentHeroArtwork calls _patchGameInMemory', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateRecentHeroArtwork');
        assert.match(fn, /_patchGameInMemory/);
    });
});

// ── Section 7: Custom artwork override ────────────────────────────────────────

describe('Phase 2.12B: artwork-sync — custom artwork override in artwork-sync.js', () => {
    it('__baddelApplyGameCustomOverride is defined on window', () => {
        assert.match(ARTWORK_SYNC_JS, /window\.__baddelApplyGameCustomOverride\s*=/);
    });
    it('__baddelApplyGameCustomOverride no longer applies committed cover fields', () => {
        const fn = getWindowAssignedFunctionBody(ARTWORK_SYNC_JS, '__baddelApplyGameCustomOverride');
        assert.match(fn, /patch\.cover/);
        assert.doesNotMatch(fn, /g\.image\s*=/);
        assert.doesNotMatch(fn, /g\.coverUrl\s*=/);
    });
    it('__baddelApplyGameCustomOverride no longer applies committed hero fields', () => {
        const fn = getWindowAssignedFunctionBody(ARTWORK_SYNC_JS, '__baddelApplyGameCustomOverride');
        assert.match(fn, /patch\.hero/);
        assert.doesNotMatch(fn, /g\.heroImage\s*=/);
    });
    it('__baddelApplyGameCustomOverride applies logo patch and supports logoCleared', () => {
        const fn = getWindowAssignedFunctionBody(ARTWORK_SYNC_JS, '__baddelApplyGameCustomOverride');
        assert.match(fn, /patch\.logo/);
        assert.match(fn, /patch\.logoCleared/);
    });
    it('__baddelApplyGameCustomOverride does not set artwork ownership on patched game', () => {
        const fn = getWindowAssignedFunctionBody(ARTWORK_SYNC_JS, '__baddelApplyGameCustomOverride');
        assert.doesNotMatch(fn, /customArtworkLocked\s*=\s*true/);
    });
    it('__baddelApplyGameCustomOverride removes stale cover/hero/logo localStorage keys instead of writing them', () => {
        const fn = getWindowAssignedFunctionBody(ARTWORK_SYNC_JS, '__baddelApplyGameCustomOverride');
        assert.doesNotMatch(fn, /localStorage\.setItem\('cover_'/);
        assert.match(fn, /localStorage\.removeItem\('cover_'/);
    });
    it('__baddelApplyGameCustomOverride invalidates virtual-scroll card cache after patch', () => {
        const fn = getWindowAssignedFunctionBody(ARTWORK_SYNC_JS, '__baddelApplyGameCustomOverride');
        assert.match(fn, /window\._vs\?\.cardCache/);
    });
});

// ── Section 8: Window exports ─────────────────────────────────────────────────

describe('Phase 2.12B: artwork-sync — window exports in artwork-sync.js', () => {
    it('window._clearArtworkLocalState is exported', () => {
        assert.match(ARTWORK_SYNC_JS, /window\._clearArtworkLocalState\s*=/);
    });
    it('window.hydrateManualGameArtworkNow is exported', () => {
        assert.match(ARTWORK_SYNC_JS, /window\.hydrateManualGameArtworkNow\s*=/);
    });
    it('window._suggArtCacheGet is exported', () => {
        assert.match(ARTWORK_SYNC_JS, /window\._suggArtCacheGet\s*=/);
    });
    it('window.__baddelApplyGameCustomOverride is exported', () => {
        assert.match(ARTWORK_SYNC_JS, /window\.__baddelApplyGameCustomOverride\s*=/);
    });
});

// ── Section 9: electronAPI dependencies ──────────────────────────────────────

describe('Phase 2.12B: artwork-sync — electronAPI calls', () => {
    // Calls split between artwork-sync.js and app.js; check combined source.
    const COMBINED = ARTWORK_SYNC_JS + '\n' + APP_JS;
    const artworkApiCalls = [
        'pruneImageCache',
        'probeLocalImage',
        'getCachedImage',
        'cacheAllAssets',
        'getMetadata',
        'saveMetadata',
        'saveFullMetadata',
    ];
    for (const call of artworkApiCalls) {
        it(`artwork sync references window.electronAPI.${call}`, () => {
            assert.match(COMBINED, new RegExp(`window\\.electronAPI[?.]?\\.${call}\\b`));
        });
    }
});

// ── Section 10: localStorage keys used by artwork sync ───────────────────────

describe('Phase 2.12B: artwork-sync — localStorage keys', () => {
    it("cover_/hero_/logo_ keys are read/written in app.js", () => {
        assert.match(APP_JS, /['"]cover_['"]/);
        assert.match(APP_JS, /['"]hero_['"]/);
        assert.match(APP_JS, /['"]logo_['"]/);
    });
    it("cover_/hero_/logo_ keys are read/written in artwork-sync.js", () => {
        assert.match(ARTWORK_SYNC_JS, /['"]cover_['"]/);
        assert.match(ARTWORK_SYNC_JS, /['"]hero_['"]/);
        assert.match(ARTWORK_SYNC_JS, /['"]logo_['"]/);
    });
    it('artwork-sync.js declares _SUGG_ART_CACHE_KEY for the suggestion art cache localStorage key', () => {
        assert.match(ARTWORK_SYNC_JS, /const _SUGG_ART_CACHE_KEY\s*=\s*['"]baddel_sugg_art_cache_v1['"]/);
    });
});

// ── Section 11: DOM selectors used by artwork sync ───────────────────────────

describe('Phase 2.12B: artwork-sync — DOM selectors in artwork-sync.js', () => {
    it('_patchVisibleGameCard targets [data-id] attribute selector', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_patchVisibleGameCard');
        assert.match(fn, /data-id/);
    });
    it('_patchVisibleGameCard targets .actual-img class', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_patchVisibleGameCard');
        assert.match(fn, /\.actual-img/);
    });
    it('_patchVisibleGameCard adds img-loaded class on successful load', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_patchVisibleGameCard');
        assert.match(fn, /img-loaded/);
    });
    it('_cardImageApply sets data-lastGoodImage on the element', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_cardImageApply');
        assert.match(fn, /dataset\.lastGoodImage\s*=/);
    });
    it('_heroBgApply sets data-lastGoodBg on the element', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_heroBgApply');
        assert.match(fn, /dataset\.lastGoodBg\s*=/);
    });
    it('failedImageIds Set is declared in artwork-sync.js', () => {
        assert.match(ARTWORK_SYNC_JS, /const failedImageIds\s*=\s*new Set/);
    });
});

// ── Section 12: Intentional dependencies from artwork sync section ────────────

describe('Phase 2.12B: artwork-sync — intentional dependencies', () => {
    it('processQueue calls updateHeroSection for the currently-displayed game', () => {
        const fn = getFunctionBody(APP_JS, 'processQueue');
        assert.match(fn, /updateHeroSection/);
        assert.match(fn, /currentHeroGameId/);
    });
    it('hydrateManualGameArtworkNow calls applyFilters to refresh visible cards', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, 'hydrateManualGameArtworkNow');
        assert.match(fn, /applyFilters\(\)/);
    });
    it('_patchGameInMemory consults window._agIsUserLibraryGame for cache membership', () => {
        const fn = getFunctionBody(APP_JS, '_patchGameInMemory');
        assert.match(fn, /window\._agIsUserLibraryGame/);
    });
    it('_rtia_warmOne uses _suggArtCacheSet from the suggestion art cache', () => {
        const fn = getFunctionBody(ARTWORK_SYNC_JS, '_rtia_warmOne');
        assert.match(fn, /_suggArtCacheSet/);
    });
    it('fetchMetadata calls checkBackgroundAssets after loading from local cache', () => {
        const fn = getFunctionBody(APP_JS, 'fetchMetadata');
        assert.match(fn, /checkBackgroundAssets/);
    });
    it('safeImageUrl is called by artwork functions', () => {
        assert.match(ARTWORK_SYNC_JS, /safeImageUrl\(/);
    });
});

// ── Section 13: Dependency isolation — artwork-sync.js avoids unrelated state ─

describe('Phase 2.12B: artwork-sync — dependency isolation in artwork-sync.js', () => {
    it('artwork-sync.js content is non-empty', () => {
        assert.ok(ARTWORK_SYNC_JS.length > 500, 'artwork-sync.js must be non-empty');
    });
    it('artwork-sync.js does not reference currentSidebarSection', () => {
        assert.doesNotMatch(ARTWORK_SYNC_JS, /\bcurrentSidebarSection\b/);
    });
    it('artwork-sync.js does not reference currentAccountPlatform', () => {
        assert.doesNotMatch(ARTWORK_SYNC_JS, /\bcurrentAccountPlatform\b/);
    });
    it('artwork-sync.js does not reference activePlatformView', () => {
        assert.doesNotMatch(ARTWORK_SYNC_JS, /\bactivePlatformView\b/);
    });
    it('artwork-sync.js does not reference openPlatformsModal', () => {
        assert.doesNotMatch(ARTWORK_SYNC_JS, /\bopenPlatformsModal\b/);
    });
    it('artwork-sync.js does not reference renderAccountsView', () => {
        assert.doesNotMatch(ARTWORK_SYNC_JS, /\brenderAccountsView\b/);
    });
    it('artwork-sync.js does not reference _agLoadDisplayPrefs', () => {
        assert.doesNotMatch(ARTWORK_SYNC_JS, /\b_agLoadDisplayPrefs\b/);
    });
    it('artwork-sync.js does not reference _igLoadDisplayPrefs', () => {
        assert.doesNotMatch(ARTWORK_SYNC_JS, /\b_igLoadDisplayPrefs\b/);
    });
});

// ── Section 14: app.js no longer declares moved identifiers ──────────────────

describe('Phase 2.12B: artwork-sync — app.js does NOT redeclare moved identifiers', () => {
    it('app.js does NOT define isUsableImageUrl (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function isUsableImageUrl\s*\(/);
    });
    it('app.js does NOT define _preferLocalImage (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _preferLocalImage\s*\(/);
    });
    it('app.js does NOT define getPosterUrl (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function getPosterUrl\s*\(/);
    });
    it('app.js does NOT define getPosterUrlInstalled (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function getPosterUrlInstalled\s*\(/);
    });
    it('app.js does NOT define _cardImageApply (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _cardImageApply\s*\(/);
    });
    it('app.js does NOT define setCardImageStable (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function setCardImageStable\s*\(/);
    });
    it('app.js does NOT define _heroBgApply (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _heroBgApply\s*\(/);
    });
    it('app.js does NOT define setHeroBgStable (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function setHeroBgStable\s*\(/);
    });
    it('app.js does NOT define _normalizeArtworkAliases (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _normalizeArtworkAliases\s*\(/);
    });
    it('app.js does NOT define _patchVisibleGameCard (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _patchVisibleGameCard\s*\(/);
    });
    it('app.js does NOT define _SUGG_ART_CACHE_KEY (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /const _SUGG_ART_CACHE_KEY\s*=/);
    });
    it('app.js does NOT define _suggArtCache (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /let _suggArtCache\s*=/);
    });
    it('app.js does NOT define _suggArtCacheGet (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _suggArtCacheGet\s*\(/);
    });
    it('app.js does NOT define _suggArtCacheSave (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _suggArtCacheSave\s*\(/);
    });
    it('app.js does NOT define _suggArtCacheSet (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _suggArtCacheSet\s*\(/);
    });
    it('app.js does NOT define _suggArtCacheDeleteField (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _suggArtCacheDeleteField\s*\(/);
    });
    it('app.js does NOT define _suggArtCachePopulate (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _suggArtCachePopulate\s*\(/);
    });
    it('app.js does NOT assign window.__baddelApplyGameCustomOverride (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /window\.__baddelApplyGameCustomOverride\s*=/);
    });
    it('app.js does NOT define _RTIA_DISK_CONCURRENCY (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /const _RTIA_DISK_CONCURRENCY\s*=/);
    });
    it('app.js does NOT define _RTIA_HYDRATE_TIMEOUT (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /const _RTIA_HYDRATE_TIMEOUT\s*=/);
    });
    it('app.js does NOT define _rtia_running (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /let\s+_rtia_running\s*=/);
    });
    it('app.js does NOT define _rtia_warmOne (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _rtia_warmOne\s*\(/);
    });
    it('app.js does NOT define _rtia_warmBatch (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _rtia_warmBatch\s*\(/);
    });
    it('app.js does NOT define _rtia_awaitHydration (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _rtia_awaitHydration\s*\(/);
    });
    it('app.js does NOT define _rtia_hydrateAll (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _rtia_hydrateAll\s*\(/);
    });
    it('app.js does NOT define _clearArtworkLocalState (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _clearArtworkLocalState\s*\(/);
    });
    it('app.js does NOT define _isUsableLocalArtwork (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function _isUsableLocalArtwork\s*\(/);
    });
    it('app.js does NOT define hydrateManualGameArtworkNow (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function hydrateManualGameArtworkNow\s*\(/);
    });
    it('app.js does NOT define hydrateRecentHeroArtwork (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /function hydrateRecentHeroArtwork\s*\(/);
    });
    it('app.js does NOT declare failedImageIds (moved to artwork-sync.js)', () => {
        assert.doesNotMatch(APP_JS, /const failedImageIds\s*=\s*new Set/);
    });
});

// ── Section 15: Script load order in dashboard.html ──────────────────────────

describe('Phase 2.12B: artwork-sync — script load order in dashboard.html', () => {
    it('artwork-sync.js is present in dashboard.html', () => {
        assert.match(HTML, /js\/app\/artwork-sync\.js/);
    });
    it('artwork-sync.js loads before app.js', () => {
        const artworkIdx = HTML.indexOf('js/app/artwork-sync.js');
        const appIdx     = HTML.indexOf('js/app.js');
        assert.ok(artworkIdx > -1, 'artwork-sync.js must be in dashboard.html');
        assert.ok(artworkIdx < appIdx, 'artwork-sync.js must load before app.js');
    });
    it('account-shortcuts.js loads before artwork-sync.js', () => {
        const shortcutsIdx = HTML.indexOf('js/app/account-shortcuts.js');
        const artworkIdx   = HTML.indexOf('js/app/artwork-sync.js');
        assert.ok(shortcutsIdx < artworkIdx, 'account-shortcuts.js must load before artwork-sync.js');
    });
});
