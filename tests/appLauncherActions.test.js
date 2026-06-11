'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT                = path.join(__dirname, '..');
const APP_JS              = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const LAUNCHER_ACTIONS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/launcher-actions.js'), 'utf8');
const GAME_CONTEXT_JS     = fs.readFileSync(path.join(ROOT, 'src/js/app/game-context-actions.js'), 'utf8');
const HTML                = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

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

// ── Section 1: Source presence in launcher-actions.js ────────────────────────

describe('Phase 2.14B: launcher actions — source presence in launcher-actions.js', () => {
    it('triggerLaunchSequence is defined as an async function', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /async function triggerLaunchSequence\s*\(/);
    });
    it('triggerPlay is defined', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /function triggerPlay\s*\(\s*\)/);
    });
    it('closeGameSettings is defined', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /function closeGameSettings\s*\(\s*\)/);
    });
    it('isLaunching state variable is declared', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /^let isLaunching\s*=\s*false/m);
    });
});

// ── Section 2: triggerLaunchSequence behaviour ────────────────────────────────

describe('Phase 2.14B: launcher actions — triggerLaunchSequence behaviour', () => {
    it('guards against re-entry with isLaunching', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /if\s*\(\s*isLaunching\s*\)\s*return/);
    });
    it('reads game from allGamesData', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /allGamesData\.find/);
    });
    it('delegates to window.openPlayLauncher when available', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /window\.openPlayLauncher/);
        assert.match(fn, /typeof window\.openPlayLauncher\s*===\s*'function'/);
    });
    it('sets isLaunching = true in fallback path', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /isLaunching\s*=\s*true/);
    });
    it('activates launchOverlay by adding .active class', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /overlay\.classList\.add\('active'\)/);
    });
    it('removes launchOverlay .active class on finish', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /overlay\.classList\.remove\('active'\)/);
    });
    it('calls window.electronAPI.launchGame with game.command, game.id, trackPath, game.name', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /window\.electronAPI\.launchGame\s*\(/);
        assert.match(fn, /game\.command/);
        assert.match(fn, /game\.id/);
        assert.match(fn, /trackPath/);
        assert.match(fn, /game\.name/);
    });
    it('calls window.electronAPI.minimizeApp after successful launch', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /window\.electronAPI\.minimizeApp\s*\(\s*\)/);
    });
    it('resets isLaunching = false on error', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        const errorBlock = fn.slice(fn.indexOf('catch'));
        assert.match(errorBlock, /isLaunching\s*=\s*false/);
    });
    it('calls showToast on launch error', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /showToast\(/);
    });
    it('sets launchBg backgroundImage from game.heroImage or game.image', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /game\.heroImage/);
        assert.match(fn, /game\.image/);
        assert.match(fn, /backgroundImage/);
    });
    it('shows launchLogo when game.logo is available', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /game\.logo/);
        assert.match(fn, /logoImg\.src\s*=/);
    });
    it('shows launchTitle as fallback when game.logo is absent', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /titleTxt\.innerText\s*=/);
        assert.match(fn, /game\.name/);
    });
    it('derives trackPath from game.command when game.path is absent', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /game\.command/);
        assert.match(fn, /trackPath/);
    });
    it('installs a focus listener to detect game exit and finish overlay', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /window\.addEventListener\('focus'/);
        assert.match(fn, /window\.removeEventListener\('focus'/);
    });
    it('has an 8-second safety timeout to dismiss the overlay if no focus event fires', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /8000/);
    });
    it('checks launchRes.status === "error" to detect IPC-level launch failures', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /launchRes\.status\s*===\s*'error'/);
    });
});

// ── Section 3: triggerPlay behaviour ─────────────────────────────────────────

describe('Phase 2.14B: launcher actions — triggerPlay behaviour', () => {
    it('triggerPlay calls triggerLaunchSequence with selectedGameId', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerPlay');
        assert.match(fn, /triggerLaunchSequence\(selectedGameId\)/);
    });
    it('triggerPlay guards on selectedGameId before launching', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerPlay');
        assert.match(fn, /if\s*\(\s*selectedGameId\s*\)/);
    });
    it('triggerPlay calls hideContextMenu after launch', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerPlay');
        assert.match(fn, /hideContextMenu\(\)/);
    });
});

// ── Section 4: closeGameSettings behaviour ────────────────────────────────────

describe('Phase 2.14B: launcher actions — closeGameSettings behaviour', () => {
    it('closeGameSettings removes .active from gameSettingsModal', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'closeGameSettings');
        assert.match(fn, /getElementById\('gameSettingsModal'\)/);
        assert.match(fn, /classList\.remove\('active'\)/);
    });
    it('closeGameSettings resets selectedGameId to null', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'closeGameSettings');
        assert.match(fn, /selectedGameId\s*=\s*null/);
    });
    it('closeGameSettings clears pendingImageChanges', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'closeGameSettings');
        assert.match(fn, /pendingImageChanges\s*=\s*\{\}/);
    });
});

// ── Section 5: DOM IDs in dashboard.html ─────────────────────────────────────

describe('Phase 2.14B: launcher actions — DOM IDs in dashboard.html', () => {
    it('launchOverlay element exists', () => {
        assert.match(HTML, /id="launchOverlay"/);
    });
    it('launchBg element exists', () => {
        assert.match(HTML, /id="launchBg"/);
    });
    it('launchLogo element exists', () => {
        assert.match(HTML, /id="launchLogo"/);
    });
    it('launchTitle element exists', () => {
        assert.match(HTML, /id="launchTitle"/);
    });
    it('launchText element exists', () => {
        assert.match(HTML, /id="launchText"/);
    });
    it('gameSettingsModal element exists', () => {
        assert.match(HTML, /id="gameSettingsModal"/);
    });
    it('contextMenu element exists (used by triggerPlay/hideContextMenu)', () => {
        assert.match(HTML, /id="contextMenu"/);
    });
});

// ── Section 6: Intentional dependencies ──────────────────────────────────────

describe('Phase 2.14B: launcher actions — intentional dependencies', () => {
    it('triggerLaunchSequence depends on allGamesData', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /\ballGamesData\b/);
    });
    it('triggerLaunchSequence depends on isLaunching', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /\bisLaunching\b/);
    });
    it('triggerLaunchSequence depends on showToast', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /\bshowToast\b/);
    });
    it('triggerLaunchSequence depends on window.electronAPI.launchGame (IPC boundary)', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /window\.electronAPI\.launchGame/);
    });
    it('triggerLaunchSequence depends on window.electronAPI.minimizeApp (IPC boundary)', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /window\.electronAPI\.minimizeApp/);
    });
    it('triggerLaunchSequence depends on window.openPlayLauncher (play-launcher.js bridge)', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.match(fn, /window\.openPlayLauncher/);
    });
    it('isLaunching state var is declared at top-level in launcher-actions.js', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /^let isLaunching\s*=/m);
    });
    it('openGameSettings is defined in addGameModal.js, not launcher-actions.js', () => {
        const ADD_GAME_MODAL_JS = fs.readFileSync(path.join(ROOT, 'src/js/addGameModal.js'), 'utf8');
        assert.match(ADD_GAME_MODAL_JS, /function openGameSettings\s*\(/);
        assert.doesNotMatch(LAUNCHER_ACTIONS_JS, /function openGameSettings\s*\(/);
    });
    it('openGameDetails is defined in game-details.js via window.openGameDetails', () => {
        const GD_JS = fs.readFileSync(path.join(ROOT, 'src/js/game-details.js'), 'utf8');
        assert.match(GD_JS, /window\.openGameDetails\s*=/);
        assert.doesNotMatch(LAUNCHER_ACTIONS_JS, /function openGameDetails\s*\(/);
    });
    it('triggerPlay depends on selectedGameId and hideContextMenu', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerPlay');
        assert.match(fn, /\bselectedGameId\b/);
        assert.match(fn, /\bhideContextMenu\b/);
    });
    it('closeGameSettings depends on selectedGameId and pendingImageChanges', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'closeGameSettings');
        assert.match(fn, /\bselectedGameId\b/);
        assert.match(fn, /\bpendingImageChanges\b/);
    });
});

// ── Section 7: Cross-file callers ─────────────────────────────────────────────

describe('Phase 2.14B: launcher actions — cross-file callers', () => {
    it('hero.js calls triggerLaunchSequence (from updateHeroSection play button)', () => {
        const HERO_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/hero.js'), 'utf8');
        assert.match(HERO_JS, /triggerLaunchSequence\(/);
    });
    it('hero.js calls openGameSettings (from updateHeroSection settings button)', () => {
        const HERO_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/hero.js'), 'utf8');
        assert.match(HERO_JS, /openGameSettings\(/);
    });
    it('triggerPlay in launcher-actions.js wraps triggerLaunchSequence for context menu', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /function triggerPlay[^{]*\{[^}]*triggerLaunchSequence/);
    });
    it('createGameCard in app.js wires play button to triggerLaunchSequence', () => {
        const createGameCardBody = getFunctionBody(APP_JS, 'createGameCard');
        assert.match(createGameCardBody, /triggerLaunchSequence\(/);
    });
    it('createRecentCard in app.js wires JumpBackIn play button to triggerLaunchSequence', () => {
        const createRecentCardBody = getFunctionBody(APP_JS, 'createRecentCard');
        assert.match(createRecentCardBody, /triggerLaunchSequence\(/);
    });
    it('playRouletteResult in app.js calls triggerLaunchSequence for play-mode winner', () => {
        const fn = getFunctionBody(APP_JS, 'playRouletteResult');
        assert.match(fn, /triggerLaunchSequence\(/);
    });
    it('context menu HTML in game-context-actions.js uses openGameSettings onclick', () => {
        assert.match(GAME_CONTEXT_JS, /onclick="openGameSettings\('/);
    });
    it('hero.js triggerPlayFromHero delegates to triggerLaunchSequence via currentHeroGameId', () => {
        const HERO_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/hero.js'), 'utf8');
        assert.match(HERO_JS, /triggerLaunchSequence\(currentHeroGameId\)/);
    });
});

// ── Section 8: Dependency isolation ──────────────────────────────────────────

describe('Phase 2.14B: launcher actions — dependency isolation', () => {
    it('triggerLaunchSequence does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('triggerLaunchSequence does not reference activePlatformView', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.doesNotMatch(fn, /\bactivePlatformView\b/);
    });
    it('triggerLaunchSequence does not reference openPlatformsModal', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.doesNotMatch(fn, /\bopenPlatformsModal\b/);
    });
    it('triggerLaunchSequence does not reference renderPlatformAccounts', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.doesNotMatch(fn, /\brenderPlatformAccounts\b/);
    });
    it('triggerLaunchSequence does not reference AG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.doesNotMatch(fn, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('triggerLaunchSequence does not reference IG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.doesNotMatch(fn, /\bIG_DISPLAY_DEFAULTS\b/);
    });
    it('triggerLaunchSequence does not reference window._agDisplayPrefs', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.doesNotMatch(fn, /window\._agDisplayPrefs/);
    });
    it('triggerLaunchSequence does not reference window._igDisplayPrefs', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        assert.doesNotMatch(fn, /window\._igDisplayPrefs/);
    });
    it('triggerPlay does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerPlay');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('triggerPlay does not reference AG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerPlay');
        assert.doesNotMatch(fn, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('closeGameSettings does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'closeGameSettings');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
});

// ── Section 9: isLaunching state usage ────────────────────────────────────────

describe('Phase 2.14B: launcher actions — isLaunching state usage', () => {
    it('isLaunching is initialized to false', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /^let isLaunching\s*=\s*false\s*;/m);
    });
    it('isLaunching is read in hero.js updateHeroSection guard', () => {
        const HERO_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/hero.js'), 'utf8');
        assert.match(HERO_JS, /\bisLaunching\b/);
    });
    it('triggerLaunchSequence references isLaunching at least 3 times (guard, set, reset)', () => {
        const fn = getFunctionBody(LAUNCHER_ACTIONS_JS, 'triggerLaunchSequence');
        const refs = (fn.match(/\bisLaunching\b/g) || []).length;
        assert.ok(refs >= 3, 'isLaunching should be referenced at least 3 times in triggerLaunchSequence');
    });
});

// ── Section 10: app.js does NOT redeclare moved identifiers ──────────────────

describe('Phase 2.14B: launcher actions — app.js does NOT redeclare moved identifiers', () => {
    it('app.js does NOT declare isLaunching (moved to launcher-actions.js)', () => {
        assert.doesNotMatch(APP_JS, /^let isLaunching\s*=/m);
    });
    it('app.js does NOT define triggerLaunchSequence (moved to launcher-actions.js)', () => {
        assert.doesNotMatch(APP_JS, /async function triggerLaunchSequence\s*\(/);
    });
    it('app.js does NOT define triggerPlay (moved to launcher-actions.js)', () => {
        assert.doesNotMatch(APP_JS, /function triggerPlay\s*\(\s*\)\s*\{/);
    });
    it('app.js does NOT define closeGameSettings (moved to launcher-actions.js)', () => {
        assert.doesNotMatch(APP_JS, /function closeGameSettings\s*\(\s*\)\s*\{/);
    });
});

// ── Section 11: Window exports in launcher-actions.js ────────────────────────

describe('Phase 2.14B: launcher actions — window exports', () => {
    it('window.triggerLaunchSequence is exported', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /window\.triggerLaunchSequence\s*=/);
    });
    it('window.triggerPlay is exported', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /window\.triggerPlay\s*=/);
    });
    it('window.closeGameSettings is exported', () => {
        assert.match(LAUNCHER_ACTIONS_JS, /window\.closeGameSettings\s*=/);
    });
});

// ── Section 12: Script load order in dashboard.html ──────────────────────────

describe('Phase 2.14B: launcher actions — script load order in dashboard.html', () => {
    it('launcher-actions.js is present in dashboard.html', () => {
        assert.match(HTML, /js\/app\/launcher-actions\.js/);
    });
    it('launcher-actions.js loads before hero.js', () => {
        const launcherIdx = HTML.indexOf('js/app/launcher-actions.js');
        const heroIdx     = HTML.indexOf('js/app/hero.js');
        assert.ok(launcherIdx > -1, 'launcher-actions.js must be in dashboard.html');
        assert.ok(launcherIdx < heroIdx, 'launcher-actions.js must load before hero.js');
    });
    it('hero.js loads before app.js', () => {
        const heroIdx = HTML.indexOf('js/app/hero.js');
        const appIdx  = HTML.indexOf('js/app.js');
        assert.ok(heroIdx < appIdx, 'hero.js must load before app.js');
    });
    it('artwork-sync.js loads before launcher-actions.js', () => {
        const artworkIdx  = HTML.indexOf('js/app/artwork-sync.js');
        const launcherIdx = HTML.indexOf('js/app/launcher-actions.js');
        assert.ok(artworkIdx < launcherIdx, 'artwork-sync.js must load before launcher-actions.js');
    });
});

// ── Section 13: Comment hygiene in launcher-actions.js ───────────────────────

describe('Phase 2.14B: launcher actions — comment hygiene', () => {
    it('launcher-actions.js contains no Arabic-script characters', () => {
        assert.doesNotMatch(LAUNCHER_ACTIONS_JS, /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/,
            'launcher-actions.js must not contain Arabic-script characters');
    });
});
