'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT    = path.join(__dirname, '..');
const APP_JS  = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HERO_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/hero.js'), 'utf8');
const HTML    = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── Extraction helper ─────────────────────────────────────────────────────────

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

// ── Section 1: Source presence in hero.js ────────────────────────────────────

describe('Phase 2.13B: hero — source presence in hero.js', () => {
    it('applyHeroForHome is defined', () => {
        assert.match(HERO_JS, /function applyHeroForHome\s*\(\s*\)/);
    });
    it('updateHeroSection is defined', () => {
        assert.match(HERO_JS, /function updateHeroSection\s*\(/);
    });
    it('updateHeroForCollection is defined', () => {
        assert.match(HERO_JS, /function updateHeroForCollection\s*\(/);
    });
    it('triggerPlayFromHero is defined', () => {
        assert.match(HERO_JS, /function triggerPlayFromHero\s*\(\s*\)/);
    });
    it('openCurrentGameSettings is defined', () => {
        assert.match(HERO_JS, /function openCurrentGameSettings\s*\(\s*\)/);
    });
    it('currentHeroGameId state var is declared', () => {
        assert.match(HERO_JS, /^let currentHeroGameId\s*=/m);
    });
    it('currentHeroSlideshowInterval state var is declared', () => {
        assert.match(HERO_JS, /^let currentHeroSlideshowInterval\s*=/m);
    });
});

// ── Section 2: applyHeroForHome behaviour ─────────────────────────────────────

describe('Phase 2.13B: hero — applyHeroForHome behaviour', () => {
    it('applyHeroForHome calls getRecentGames', () => {
        const fn = getFunctionBody(HERO_JS, 'applyHeroForHome');
        assert.match(fn, /getRecentGames\(\)/);
    });
    it('applyHeroForHome delegates to updateHeroSection when recent games exist', () => {
        const fn = getFunctionBody(HERO_JS, 'applyHeroForHome');
        assert.match(fn, /updateHeroSection\(/);
    });
    it('applyHeroForHome falls back to allGamesData[0] when no recent games', () => {
        const fn = getFunctionBody(HERO_JS, 'applyHeroForHome');
        assert.match(fn, /allGamesData\[0\]/);
    });
    it('applyHeroForHome hides heroLogo, heroStats, heroPlayBtn, heroSettingsBtn when no games', () => {
        const fn = getFunctionBody(HERO_JS, 'applyHeroForHome');
        assert.match(fn, /getElementById\('heroLogo'\)/);
        assert.match(fn, /getElementById\('heroStats'\)/);
        assert.match(fn, /getElementById\('heroPlayBtn'\)/);
        assert.match(fn, /getElementById\('heroSettingsBtn'\)/);
    });
    it('applyHeroForHome sets heroBg fallback gradient when no games', () => {
        const fn = getFunctionBody(HERO_JS, 'applyHeroForHome');
        assert.match(fn, /getElementById\('heroBg'\)/);
        assert.match(fn, /backgroundImage/);
    });
});

// ── Section 3: updateHeroSection behaviour ────────────────────────────────────

describe('Phase 2.13B: hero — updateHeroSection behaviour', () => {
    it('updateHeroSection reads game from allGamesData', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /allGamesData\.find/);
    });
    it('updateHeroSection sets currentHeroGameId', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /currentHeroGameId\s*=/);
    });
    it('updateHeroSection clears currentHeroSlideshowInterval', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /clearInterval\(currentHeroSlideshowInterval\)/);
    });
    it('updateHeroSection calls checkBackgroundAssets to hydrate hero/logo', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /checkBackgroundAssets\(/);
    });
    it('updateHeroSection gets heroBg, heroLogo, heroTitle, heroStats elements', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /getElementById\('heroBg'\)/);
        assert.match(fn, /getElementById\('heroLogo'\)/);
        assert.match(fn, /getElementById\('heroTitle'\)/);
        assert.match(fn, /getElementById\('heroStats'\)/);
    });
    it('updateHeroSection gets heroPlayBtn and heroSettingsBtn elements', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /getElementById\('heroPlayBtn'\)/);
        assert.match(fn, /getElementById\('heroSettingsBtn'\)/);
    });
    it('updateHeroSection queries .hero-actions container', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /querySelector\('\.hero-actions'\)/);
    });
    it('updateHeroSection reads game.heroImage or game.image for background', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /game\.heroImage/);
        assert.match(fn, /game\.image/);
    });
    it('updateHeroSection uses game.logo to show logo or falls back to game.name as title', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /game\.logo/);
        assert.match(fn, /game\.name/);
    });
    it('updateHeroSection reads playtimeData for the game', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /playtimeData\[game\.id\]/);
    });
    it('updateHeroSection calls formatPlaytime to display playtime', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /formatPlaytime\(/);
    });
    it('updateHeroSection calls formatLastPlayed to display last-played date', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /formatLastPlayed\(/);
    });
    it('updateHeroSection sets heroPlaytime and heroLastPlayed span IDs', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /heroPlaytime/);
        assert.match(fn, /heroLastPlayed/);
    });
    it('updateHeroSection wires settingsBtn.onclick to openGameSettings', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /openGameSettings\(/);
        assert.match(fn, /settingsBtn\.onclick/);
    });
    it('updateHeroSection wires playBtn.onclick to triggerLaunchSequence', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /triggerLaunchSequence\(/);
        assert.match(fn, /playBtn\.onclick/);
    });
    it('updateHeroSection guards against isLaunching before proceeding', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /isLaunching/);
    });
    it('updateHeroSection guards background update against stale gameId via currentHeroGameId check', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        const occurrences = (fn.match(/currentHeroGameId !== String\(gameId\)/g) || []).length;
        assert.ok(occurrences >= 2, 'stale-guard must appear in both onload and onerror callbacks');
    });
    it('updateHeroSection falls back to a gradient when backgroundImage probe fails', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /linear-gradient/);
    });
});

// ── Section 4: updateHeroForCollection behaviour ──────────────────────────────

describe('Phase 2.13B: hero — updateHeroForCollection behaviour', () => {
    it('updateHeroForCollection clears currentHeroSlideshowInterval', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /clearInterval\(currentHeroSlideshowInterval\)/);
    });
    it('updateHeroForCollection gets all hero DOM elements', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /getElementById\('heroBg'\)/);
        assert.match(fn, /getElementById\('heroLogo'\)/);
        assert.match(fn, /getElementById\('heroTitle'\)/);
        assert.match(fn, /getElementById\('heroStats'\)/);
        assert.match(fn, /getElementById\('heroPlayBtn'\)/);
        assert.match(fn, /getElementById\('heroSettingsBtn'\)/);
    });
    it('updateHeroForCollection iterates coll.gameIds to accumulate playtime', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /coll\.gameIds/);
        assert.match(fn, /playtimeData\[/);
    });
    it('updateHeroForCollection builds validImages from heroImage or image', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /validImages/);
        assert.match(fn, /heroImage/);
    });
    it('updateHeroForCollection rotates images via setInterval slideshow when multiple images', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /currentHeroSlideshowInterval\s*=\s*setInterval/);
        assert.match(fn, /validImages\.length\s*>\s*1/);
    });
    it('updateHeroForCollection uses coll.image as background when available', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /coll\.image/);
    });
    it('updateHeroForCollection hides heroLogo and shows collection name as title', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /logoImg\.style\.display\s*=\s*'none'/);
        assert.match(fn, /coll\.name/);
    });
    it('updateHeroForCollection hides heroPlayBtn (no single-game launch for collections)', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /playBtn\.style\.display\s*=\s*'none'/);
    });
    it('updateHeroForCollection shows heroPlaytime and game count via heroLastPlayed span', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /heroPlaytime/);
        assert.match(fn, /heroLastPlayed/);
    });
    it('updateHeroForCollection wires settingsBtn.onclick to openCollectionSettings', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /openCollectionSettings\(/);
        assert.match(fn, /settingsBtn\.onclick/);
    });
    it('updateHeroForCollection calls formatPlaytime', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /formatPlaytime\(/);
    });
    it('updateHeroForCollection reads allGamesData to resolve game objects from coll.gameIds', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /allGamesData\.find/);
    });
});

// ── Section 5: triggerPlayFromHero and openCurrentGameSettings ────────────────

describe('Phase 2.13B: hero — inline handlers in hero.js', () => {
    it('triggerPlayFromHero delegates to triggerLaunchSequence with currentHeroGameId', () => {
        const fn = getFunctionBody(HERO_JS, 'triggerPlayFromHero');
        assert.match(fn, /triggerLaunchSequence\(currentHeroGameId\)/);
    });
    it('triggerPlayFromHero guards on currentHeroGameId before launching', () => {
        const fn = getFunctionBody(HERO_JS, 'triggerPlayFromHero');
        assert.match(fn, /if\s*\(\s*currentHeroGameId\s*\)/);
    });
    it('openCurrentGameSettings delegates to openGameSettings with currentHeroGameId', () => {
        const fn = getFunctionBody(HERO_JS, 'openCurrentGameSettings');
        assert.match(fn, /openGameSettings\(currentHeroGameId\)/);
    });
    it('openCurrentGameSettings guards on currentHeroGameId before opening', () => {
        const fn = getFunctionBody(HERO_JS, 'openCurrentGameSettings');
        assert.match(fn, /if\s*\(\s*currentHeroGameId\s*\)/);
    });
});

// ── Section 6: DOM IDs and classes in dashboard.html ─────────────────────────

describe('Phase 2.13B: hero — DOM IDs in dashboard.html', () => {
    it('heroSection element exists', () => {
        assert.match(HTML, /id="heroSection"/);
    });
    it('heroBg element exists', () => {
        assert.match(HTML, /id="heroBg"/);
    });
    it('heroLogo element exists', () => {
        assert.match(HTML, /id="heroLogo"/);
    });
    it('heroTitle element exists', () => {
        assert.match(HTML, /id="heroTitle"/);
    });
    it('heroStats element exists', () => {
        assert.match(HTML, /id="heroStats"/);
    });
    it('heroPlayBtn element exists', () => {
        assert.match(HTML, /id="heroPlayBtn"/);
    });
    it('heroSettingsBtn element exists', () => {
        assert.match(HTML, /id="heroSettingsBtn"/);
    });
    it('heroPlaytime span exists in initial markup', () => {
        assert.match(HTML, /id="heroPlaytime"/);
    });
    it('heroLastPlayed span exists in initial markup', () => {
        assert.match(HTML, /id="heroLastPlayed"/);
    });
    it('.hero-actions container exists', () => {
        assert.match(HTML, /class="hero-actions"/);
    });
    it('heroPlayBtn calls triggerPlayFromHero via inline onclick', () => {
        assert.match(HTML, /id="heroPlayBtn"[^>]*onclick="triggerPlayFromHero\(\)"|onclick="triggerPlayFromHero\(\)"[^>]*id="heroPlayBtn"/);
    });
    it('heroSettingsBtn calls openCurrentGameSettings via inline onclick', () => {
        assert.match(HTML, /id="heroSettingsBtn"[^>]*onclick="openCurrentGameSettings\(\)"|onclick="openCurrentGameSettings\(\)"[^>]*id="heroSettingsBtn"/);
    });
    it('heroSection has cinematic-hero class', () => {
        assert.match(HTML, /class="cinematic-hero"[^>]*id="heroSection"|id="heroSection"[^>]*class="cinematic-hero"/);
    });
    it('heroBg has hero-bg-parallax class', () => {
        assert.match(HTML, /class="hero-bg-parallax"[^>]*id="heroBg"|id="heroBg"[^>]*class="hero-bg-parallax"/);
    });
    it('stat-badge and playtime-stat classes appear in hero stats', () => {
        assert.match(HTML, /stat-badge playtime-stat/);
    });
});

// ── Section 7: Intentional dependencies ──────────────────────────────────────

describe('Phase 2.13B: hero — intentional dependencies', () => {
    it('updateHeroSection depends on allGamesData', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /\ballGamesData\b/);
    });
    it('updateHeroSection depends on playtimeData', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /\bplaytimeData\b/);
    });
    it('applyHeroForHome depends on allGamesData', () => {
        const fn = getFunctionBody(HERO_JS, 'applyHeroForHome');
        assert.match(fn, /\ballGamesData\b/);
    });
    it('applyHeroForHome calls updateHeroSection', () => {
        const fn = getFunctionBody(HERO_JS, 'applyHeroForHome');
        assert.match(fn, /\bupdateHeroSection\b/);
    });
    it('updateHeroForCollection depends on allGamesData', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /\ballGamesData\b/);
    });
    it('updateHeroForCollection depends on playtimeData', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroForCollection');
        assert.match(fn, /\bplaytimeData\b/);
    });
    it('formatPlaytime wrapper is still in app.js (delegated to BaddelPlaytime)', () => {
        assert.match(APP_JS, /function formatPlaytime\s*\(/);
        const fn = getFunctionBody(APP_JS, 'formatPlaytime');
        assert.match(fn, /BaddelPlaytime\.formatPlaytime/);
    });
    it('formatLastPlayed wrapper is still in app.js (delegated to BaddelPlaytime)', () => {
        assert.match(APP_JS, /function formatLastPlayed\s*\(/);
        const fn = getFunctionBody(APP_JS, 'formatLastPlayed');
        assert.match(fn, /BaddelPlaytime\.formatLastPlayed/);
    });
    it('updateHeroSection calls checkBackgroundAssets (hydrates hero/logo from localStorage)', () => {
        const fn = getFunctionBody(HERO_JS, 'updateHeroSection');
        assert.match(fn, /checkBackgroundAssets/);
    });
    it('game-details.js calls applyHeroForHome via typeof guard', () => {
        const GD_JS = fs.readFileSync(path.join(ROOT, 'src/js/game-details.js'), 'utf8');
        assert.match(GD_JS, /typeof applyHeroForHome\s*===\s*'function'/);
    });
    it('applyHeroForHome is still called in app.js after library load / filter apply', () => {
        assert.match(APP_JS, /applyHeroForHome\(\)/);
    });
    it('updateHeroSection is still called from app.js when current game updates', () => {
        assert.match(APP_JS, /updateHeroSection\(/);
    });
});

// ── Section 8: Dependency isolation ──────────────────────────────────────────

describe('Phase 2.13B: hero — dependency isolation in hero.js', () => {
    it('hero.js content is non-empty', () => {
        assert.ok(HERO_JS.length > 500, 'hero.js must be non-empty');
    });
    it('hero functions do not reference currentAccountPlatform', () => {
        assert.doesNotMatch(HERO_JS, /\bcurrentAccountPlatform\b/);
    });
    it('hero functions do not reference activePlatformView', () => {
        assert.doesNotMatch(HERO_JS, /\bactivePlatformView\b/);
    });
    it('hero functions do not reference openPlatformsModal', () => {
        assert.doesNotMatch(HERO_JS, /\bopenPlatformsModal\b/);
    });
    it('hero functions do not reference renderPlatformAccounts', () => {
        assert.doesNotMatch(HERO_JS, /\brenderPlatformAccounts\b/);
    });
    it('hero functions do not reference AG_DISPLAY_DEFAULTS', () => {
        assert.doesNotMatch(HERO_JS, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('hero functions do not reference IG_DISPLAY_DEFAULTS', () => {
        assert.doesNotMatch(HERO_JS, /\bIG_DISPLAY_DEFAULTS\b/);
    });
    it('hero.js does not reference window._agDisplayPrefs', () => {
        assert.doesNotMatch(HERO_JS, /window\._agDisplayPrefs/);
    });
    it('hero.js does not reference window._igDisplayPrefs', () => {
        assert.doesNotMatch(HERO_JS, /window\._igDisplayPrefs/);
    });
});

// ── Section 9: app.js no longer declares moved identifiers ───────────────────

describe('Phase 2.13B: hero — app.js does NOT redeclare moved identifiers', () => {
    it('app.js does NOT declare currentHeroGameId (moved to hero.js)', () => {
        assert.doesNotMatch(APP_JS, /^let currentHeroGameId\s*=/m);
    });
    it('app.js does NOT declare currentHeroSlideshowInterval (moved to hero.js)', () => {
        assert.doesNotMatch(APP_JS, /^let currentHeroSlideshowInterval\s*=/m);
    });
    it('app.js does NOT define applyHeroForHome (moved to hero.js)', () => {
        assert.doesNotMatch(APP_JS, /function applyHeroForHome\s*\(\s*\)/);
    });
    it('app.js does NOT define updateHeroSection (moved to hero.js)', () => {
        assert.doesNotMatch(APP_JS, /function updateHeroSection\s*\(/);
    });
    it('app.js does NOT define updateHeroForCollection (moved to hero.js)', () => {
        assert.doesNotMatch(APP_JS, /function updateHeroForCollection\s*\(/);
    });
    it('app.js does NOT define triggerPlayFromHero (moved to hero.js)', () => {
        assert.doesNotMatch(APP_JS, /function triggerPlayFromHero\s*\(\s*\)/);
    });
    it('app.js does NOT define openCurrentGameSettings (moved to hero.js)', () => {
        assert.doesNotMatch(APP_JS, /function openCurrentGameSettings\s*\(\s*\)/);
    });
});

// ── Section 10: Window exports in hero.js ────────────────────────────────────

describe('Phase 2.13B: hero — window exports in hero.js', () => {
    it('window.applyHeroForHome is exported', () => {
        assert.match(HERO_JS, /window\.applyHeroForHome\s*=/);
    });
    it('window.updateHeroSection is exported', () => {
        assert.match(HERO_JS, /window\.updateHeroSection\s*=/);
    });
    it('window.updateHeroForCollection is exported', () => {
        assert.match(HERO_JS, /window\.updateHeroForCollection\s*=/);
    });
    it('window.triggerPlayFromHero is exported', () => {
        assert.match(HERO_JS, /window\.triggerPlayFromHero\s*=/);
    });
    it('window.openCurrentGameSettings is exported', () => {
        assert.match(HERO_JS, /window\.openCurrentGameSettings\s*=/);
    });
});

// ── Section 11: Script load order in dashboard.html ──────────────────────────

describe('Phase 2.13B: hero — script load order in dashboard.html', () => {
    it('hero.js is present in dashboard.html', () => {
        assert.match(HTML, /js\/app\/hero\.js/);
    });
    it('hero.js loads before app.js', () => {
        const heroIdx = HTML.indexOf('js/app/hero.js');
        const appIdx  = HTML.indexOf('js/app.js');
        assert.ok(heroIdx > -1, 'hero.js must be in dashboard.html');
        assert.ok(heroIdx < appIdx, 'hero.js must load before app.js');
    });
    it('artwork-sync.js loads before hero.js', () => {
        const artworkIdx = HTML.indexOf('js/app/artwork-sync.js');
        const heroIdx    = HTML.indexOf('js/app/hero.js');
        assert.ok(artworkIdx < heroIdx, 'artwork-sync.js must load before hero.js');
    });
});

// ── Section 12: Comment hygiene in hero.js ───────────────────────────────────

describe('Phase 2.13B: hero — comment hygiene', () => {
    it('hero.js contains no Arabic-script characters', () => {
        assert.doesNotMatch(HERO_JS, /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/,
            'hero.js must not contain Arabic-script characters');
    });
});
