'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

// ── Inline copy of extractYouTubeVideoId (kept in sync with game-details.js) ─
// Pure function, no DOM/Node deps. Used for fast behavioral testing.
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function extractYouTubeVideoId(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const input = rawInput.trim();
    if (!input) return null;
    if (YT_ID_RE.test(input)) return input;
    const iframeSrc = input.match(/src=["']([^"']+)["']/);
    if (iframeSrc) return extractYouTubeVideoId(iframeSrc[1]);
    let u;
    try { u = new URL(input); } catch (_) {
        const m = input.match(
            /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^&\s]*&)*v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
        );
        return m ? m[1] : null;
    }
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
        const id = u.pathname.slice(1).split('/')[0].split('?')[0];
        return YT_ID_RE.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' ||
        host.endsWith('.youtube.com') || host.endsWith('.youtube-nocookie.com')) {
        const v = u.searchParams.get('v');
        if (v && YT_ID_RE.test(v)) return v;
        const pathMatch = u.pathname.match(/\/(?:embed|v|shorts|live)\/([A-Za-z0-9_-]{11})/);
        if (pathMatch) return pathMatch[1];
    }
    return null;
}

const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'js', 'game-details.js'),
    'utf8'
);

// ── Behavioral tests ─────────────────────────────────────────────────────────

const RICK = 'dQw4w9WgXcQ';

test('extractYouTubeVideoId: standard watch URL (www)', () => {
    assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: watch URL no www', () => {
    assert.equal(extractYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: mobile watch URL', () => {
    assert.equal(extractYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: music.youtube.com watch URL', () => {
    assert.equal(extractYouTubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: youtu.be short URL', () => {
    assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: youtu.be short URL with ?si param', () => {
    assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=test'), RICK);
});

test('extractYouTubeVideoId: youtube-nocookie.com embed URL', () => {
    assert.equal(
        extractYouTubeVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'),
        RICK
    );
});

test('extractYouTubeVideoId: youtube.com embed URL', () => {
    assert.equal(
        extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
        RICK
    );
});

test('extractYouTubeVideoId: YouTube Shorts URL', () => {
    assert.equal(extractYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: YouTube Shorts URL (www)', () => {
    assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: YouTube Live URL', () => {
    assert.equal(extractYouTubeVideoId('https://youtube.com/live/dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: youtube.com/v/ URL', () => {
    assert.equal(extractYouTubeVideoId('https://www.youtube.com/v/dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: URL with extra params (&si=, &t=, &feature=)', () => {
    assert.equal(
        extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc&t=30&feature=share'),
        RICK
    );
});

test('extractYouTubeVideoId: embed URL with query params', () => {
    assert.equal(
        extractYouTubeVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0'),
        RICK
    );
});

test('extractYouTubeVideoId: raw 11-char video ID', () => {
    assert.equal(extractYouTubeVideoId('dQw4w9WgXcQ'), RICK);
});

test('extractYouTubeVideoId: iframe embed snippet (double quotes)', () => {
    assert.equal(
        extractYouTubeVideoId('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'),
        RICK
    );
});

test('extractYouTubeVideoId: iframe embed snippet (single quotes)', () => {
    assert.equal(
        extractYouTubeVideoId("<iframe src='https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'></iframe>"),
        RICK
    );
});

test('extractYouTubeVideoId: returns null for empty input', () => {
    assert.equal(extractYouTubeVideoId(''), null);
});

test('extractYouTubeVideoId: returns null for null', () => {
    assert.equal(extractYouTubeVideoId(null), null);
});

test('extractYouTubeVideoId: returns null for Twitch URL', () => {
    assert.equal(extractYouTubeVideoId('https://www.twitch.tv/somestream'), null);
});

test('extractYouTubeVideoId: returns null for direct mp4 URL', () => {
    assert.equal(extractYouTubeVideoId('https://cdn.example.com/trailer.mp4'), null);
});

test('extractYouTubeVideoId: returns null for string shorter than 11 chars', () => {
    assert.equal(extractYouTubeVideoId('abc123'), null);
});

test('extractYouTubeVideoId: returns null for 12-char string (not exact 11)', () => {
    assert.equal(extractYouTubeVideoId('dQw4w9WgXcQx'), null);
});

// ── Source-level structural tests ────────────────────────────────────────────

test('game-details.js: extractYouTubeVideoId is defined', () => {
    assert.match(src, /function extractYouTubeVideoId/,
        'extractYouTubeVideoId must be defined in game-details.js');
});

test('game-details.js: _gdParseYouTubeVideoId is a thin alias for extractYouTubeVideoId', () => {
    assert.match(
        src,
        /function _gdParseYouTubeVideoId\s*\([^)]*\)\s*\{\s*return extractYouTubeVideoId/,
        '_gdParseYouTubeVideoId must delegate to extractYouTubeVideoId'
    );
});

test('game-details.js: no duplicate function _gdParseYouTubeVideoId declarations', () => {
    const matches = [...src.matchAll(/^function _gdParseYouTubeVideoId/gm)];
    assert.equal(matches.length, 1,
        'Exactly one function declaration for _gdParseYouTubeVideoId (the thin alias)');
});

test('game-details.js: _gdGetYouTubeId delegates to extractYouTubeVideoId', () => {
    assert.match(
        src,
        /function _gdGetYouTubeId[\s\S]{0,60}return extractYouTubeVideoId/,
        '_gdGetYouTubeId must delegate to extractYouTubeVideoId'
    );
});

test('game-details.js: _gdRenderTrailerPlayer calls extractYouTubeVideoId before _gdBuildCandidates', () => {
    const fnStart = src.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = src.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = src.slice(fnStart, fnEnd);
    const ytPos   = fn.indexOf('extractYouTubeVideoId(rawUrl)');
    const candPos = fn.indexOf('_gdBuildCandidates');
    assert.ok(ytPos   !== -1, '_gdRenderTrailerPlayer must call extractYouTubeVideoId(rawUrl)');
    assert.ok(candPos !== -1, '_gdRenderTrailerPlayer must call _gdBuildCandidates');
    assert.ok(ytPos < candPos, 'extractYouTubeVideoId must run before _gdBuildCandidates');
});

test('game-details.js: _gdRenderTrailerPlayer emits [GD][Trailer] debug log with youtubeId', () => {
    const fnStart = src.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = src.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = src.slice(fnStart, fnEnd);
    assert.match(fn, /console\.debug.*GD.*Trailer/,
        '_gdRenderTrailerPlayer must emit a console.debug "[GD][Trailer]" log');
    assert.match(fn, /youtubeId/,
        'The debug log must include a youtubeId field');
});

test('game-details.js: YouTube path creates .gd-youtube-shell via _gdRenderYouTubeWebviewPlayer', () => {
    const fnStart = src.indexOf('function _gdRenderYouTubeWebviewPlayer');
    assert.ok(fnStart !== -1, '_gdRenderYouTubeWebviewPlayer must be defined');
    const fn = src.slice(fnStart, fnStart + 1000);
    assert.match(fn, /gd-youtube-shell/,
        '_gdRenderYouTubeWebviewPlayer must create a .gd-youtube-shell element');
    assert.match(fn, /<webview/,
        '_gdRenderYouTubeWebviewPlayer must create a <webview> element on click');
});

test('game-details.js: YouTube path must NOT call showTrailerFallback', () => {
    const fnStart  = src.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd    = src.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn       = src.slice(fnStart, fnEnd);
    // Isolate the YouTube branch only (from extractYouTubeVideoId check to its return)
    const ytStart  = fn.indexOf('extractYouTubeVideoId(rawUrl)');
    const ytEnd    = fn.indexOf('_gdRenderYouTubeWebviewPlayer', ytStart) + 50;
    const ytBranch = fn.slice(ytStart, ytEnd);
    assert.doesNotMatch(ytBranch, /showTrailerFallback/,
        'The YouTube branch must not call showTrailerFallback');
});

test('game-details.js: direct-video trailers still go through _gdBuildCandidates', () => {
    const fnStart = src.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = src.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = src.slice(fnStart, fnEnd);
    assert.match(fn, /_gdBuildCandidates/,
        '_gdRenderTrailerPlayer must still call _gdBuildCandidates for direct-video URLs');
});
