'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
    escapeHtml,
    safeText,
    safeImageUrl,
    safeMediaUrl,
    safeEmbedUrl,
    safeExternalUrl,
    setSafeImageCacheDir,
    addTrustedFileDir,
} = require('../src/js/domUtils');

// ── Trusted cache dir used in all file:// tests ───────────────────────────────
const TRUSTED_CACHE = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/image_cache/';
setSafeImageCacheDir(TRUSTED_CACHE);

// A second trusted dir (e.g. avatar cache copied here)
const TRUSTED_CACHE_2 = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/media_cache/';
addTrustedFileDir(TRUSTED_CACHE_2);

// ─── escapeHtml ───────────────────────────────────────────────────────────────

test('escapeHtml: escapes < and >', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});

test('escapeHtml: escapes & ampersand', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml: escapes double-quote', () => {
    assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
});

test('escapeHtml: escapes single-quote', () => {
    assert.equal(escapeHtml("it's"), 'it&#x27;s');
});

test('escapeHtml: returns empty string for null', () => {
    assert.equal(escapeHtml(null), '');
});

test('escapeHtml: returns empty string for undefined', () => {
    assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml: coerces numbers to string', () => {
    assert.equal(escapeHtml(42), '42');
});

test('escapeHtml: complete injection payload is fully escaped', () => {
    const payload = '<img src=x onerror="alert(\'xss\')">';
    const result  = escapeHtml(payload);
    assert.ok(!result.includes('<img'));
    assert.ok(!result.includes('>'));
    assert.ok(result.includes('&lt;'));
});

// ─── safeImageUrl — allowed ───────────────────────────────────────────────────

test('safeImageUrl: https:// URL passes', () => {
    const url = 'https://cdn.example.com/image.jpg';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: http:// URL passes', () => {
    const url = 'http://cdn.example.com/image.jpg';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: blob: URL passes', () => {
    const url = 'blob:https://example.com/abc';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: data:image/ URL passes', () => {
    const url = 'data:image/png;base64,abc123';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: ./assets/ relative path passes', () => {
    const url = './assets/Steam.png';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: ../assets/ relative path passes', () => {
    const url = '../assets/discord.webp';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: assets/ relative path passes', () => {
    const url = 'assets/placeholder.png';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: file:// URL within primary trusted cache passes', () => {
    const url = TRUSTED_CACHE + 'abc123_cover.webp';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: file:// URL within second trusted dir passes', () => {
    const url = TRUSTED_CACHE_2 + 'steam_avatar_76561199123.jpg';
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: file:// URL with encoded spaces in trusted cache passes', () => {
    const encoded = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/image_cache/abc%20123.webp';
    assert.equal(safeImageUrl(encoded), encoded);
});

test('safeImageUrl: artwork-cache-v2 trusted root passes', () => {
    const trusted = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/';
    const url = trusted + 'assets/ab/cd/abcdef_cover.webp';
    addTrustedFileDir(trusted);
    assert.equal(safeImageUrl(url), url);
});

test('safeImageUrl: artwork-cache-v2 trust does not allow sibling files', () => {
    const trusted = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/';
    addTrustedFileDir(trusted);
    assert.equal(safeImageUrl('file:///C:/Users/test/AppData/Roaming/BaddelLauncher/platform-sync/secret.jpg'), '');
});

test('safeImageUrl: artwork-cache-v2 trust blocks encoded traversal', () => {
    const trusted = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/artwork-cache-v2/';
    addTrustedFileDir(trusted);
    assert.equal(safeImageUrl(trusted + '%2e%2e/secret.jpg'), '');
});

// ─── safeImageUrl — blocked ───────────────────────────────────────────────────

test('safeImageUrl: javascript: URL is blocked', () => {
    assert.equal(safeImageUrl('javascript:alert(1)'), '');
});

test('safeImageUrl: JAVASCRIPT: (uppercase) is blocked', () => {
    assert.equal(safeImageUrl('JAVASCRIPT:alert(1)'), '');
});

test('safeImageUrl: vbscript: URL is blocked', () => {
    assert.equal(safeImageUrl('vbscript:MsgBox(1)'), '');
});

test('safeImageUrl: data:text/html is blocked', () => {
    assert.equal(safeImageUrl('data:text/html,<h1>test</h1>'), '');
});

test('safeImageUrl: data:application/javascript is blocked', () => {
    assert.equal(safeImageUrl('data:application/javascript,alert(1)'), '');
});

test('safeImageUrl: //evil.com protocol-relative URL is blocked', () => {
    assert.equal(safeImageUrl('//evil.com/img.png'), '');
});

test('safeImageUrl: file:// URL outside trusted dir is blocked', () => {
    assert.equal(safeImageUrl('file:///C:/Windows/system32/calc.exe'), '');
});

test('safeImageUrl: file:// URL to arbitrary user path is blocked', () => {
    assert.equal(safeImageUrl('file:///C:/Users/test/Documents/secret.jpg'), '');
});

test('safeImageUrl: empty string returns empty', () => {
    assert.equal(safeImageUrl(''), '');
});

test('safeImageUrl: null returns empty', () => {
    assert.equal(safeImageUrl(null), '');
});

// ─── safeMediaUrl ─────────────────────────────────────────────────────────────

test('safeMediaUrl: https:// YouTube watch URL passes', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    assert.equal(safeMediaUrl(url), url);
});

test('safeMediaUrl: https:// direct mp4 URL passes', () => {
    const url = 'https://cdn.steamstatic.com/steam/apps/12345/movie_max_vp9.webm';
    assert.equal(safeMediaUrl(url), url);
});

test('safeMediaUrl: http:// Steam CDN URL passes (Steam CDN uses http)', () => {
    const url = 'http://video.akamai.steamstatic.com/store_trailers/256843772/movie480.mp4?t=1591381980';
    assert.equal(safeMediaUrl(url), url);
});

test('safeMediaUrl: http:// CDN webm with query params passes', () => {
    const url = 'http://cdn.akamai.steamstatic.com/steam/apps/12345/movie480_vp9.webm?t=123';
    assert.equal(safeMediaUrl(url), url);
});

test('safeMediaUrl: blob: URL passes', () => {
    const url = 'blob:https://example.com/video123';
    assert.equal(safeMediaUrl(url), url);
});

test('safeMediaUrl: data:video/ passes', () => {
    const url = 'data:video/mp4;base64,AAAA';
    assert.equal(safeMediaUrl(url), url);
});

test('safeMediaUrl: file:// inside trusted cache passes', () => {
    const url = TRUSTED_CACHE + 'trailer_720p.mp4';
    assert.equal(safeMediaUrl(url), url);
});

test('safeMediaUrl: javascript: is blocked', () => {
    assert.equal(safeMediaUrl('javascript:alert(1)'), '');
});

test('safeMediaUrl: //evil.com is blocked', () => {
    assert.equal(safeMediaUrl('//evil.com/video.mp4'), '');
});

test('safeMediaUrl: file:// outside trusted dir is blocked', () => {
    assert.equal(safeMediaUrl('file:///C:/Windows/system32/bad.mp4'), '');
});

test('safeMediaUrl: null returns empty', () => {
    assert.equal(safeMediaUrl(null), '');
});

// ─── safeEmbedUrl ─────────────────────────────────────────────────────────────

test('safeEmbedUrl: valid YouTube embed with www passes', () => {
    const url = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
    assert.equal(safeEmbedUrl(url), url);
});

test('safeEmbedUrl: valid YouTube embed without www passes', () => {
    const url = 'https://youtube.com/embed/dQw4w9WgXcQ';
    assert.equal(safeEmbedUrl(url), url);
});

test('safeEmbedUrl: YouTube embed with query params passes', () => {
    const url = 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0';
    assert.equal(safeEmbedUrl(url), url);
});

test('safeEmbedUrl: YouTube watch URL is blocked (not embed)', () => {
    assert.equal(safeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), '');
});

test('safeEmbedUrl: non-YouTube https URL is blocked', () => {
    assert.equal(safeEmbedUrl('https://evil.com/embed/abc'), '');
});

test('safeEmbedUrl: javascript: is blocked', () => {
    assert.equal(safeEmbedUrl('javascript:alert(1)'), '');
});

test('safeEmbedUrl: empty returns empty', () => {
    assert.equal(safeEmbedUrl(''), '');
});

test('safeEmbedUrl: youtube-nocookie embed passes', () => {
    const url = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1';
    assert.equal(safeEmbedUrl(url), url);
});

test('safeEmbedUrl: youtu.be short URL is blocked', () => {
    assert.equal(safeEmbedUrl('https://youtu.be/dQw4w9WgXcQ'), '');
});

test('safeEmbedUrl: protocol-relative URL is blocked', () => {
    assert.equal(safeEmbedUrl('//www.youtube.com/embed/dQw4w9WgXcQ'), '');
});

test('safeEmbedUrl: embed URL with short video ID (<11 chars) is blocked', () => {
    assert.equal(safeEmbedUrl('https://www.youtube.com/embed/short'), '');
});

test('safeEmbedUrl: embed URL with long video ID (>11 chars) is blocked', () => {
    assert.equal(safeEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQextratoo'), '');
});

// ─── safeExternalUrl ──────────────────────────────────────────────────────────

test('safeExternalUrl: https:// URL passes', () => {
    const url = 'https://store.steampowered.com';
    assert.equal(safeExternalUrl(url), url);
});

test('safeExternalUrl: steam:// URL passes', () => {
    const url = 'steam://run/440';
    assert.equal(safeExternalUrl(url), url);
});

test('safeExternalUrl: com.epicgames.launcher:// URL passes', () => {
    const url = 'com.epicgames.launcher://apps/fortnite';
    assert.equal(safeExternalUrl(url), url);
});

test('safeExternalUrl: file:// URL is blocked', () => {
    assert.equal(safeExternalUrl('file:///C:/Windows/system32/cmd.exe'), '');
});

test('safeExternalUrl: javascript: URL is blocked', () => {
    assert.equal(safeExternalUrl('javascript:alert(1)'), '');
});

test('safeExternalUrl: http:// URL is blocked', () => {
    assert.equal(safeExternalUrl('http://example.com'), '');
});

test('safeExternalUrl: empty returns empty', () => {
    assert.equal(safeExternalUrl(''), '');
});

// ─── setSafeImageCacheDir / addTrustedFileDir ─────────────────────────────────

test('setSafeImageCacheDir: accepts path without trailing slash and adds it', () => {
    const { setSafeImageCacheDir: setDir, safeImageUrl: siu } = require('../src/js/domUtils');
    const dir = 'file:///C:/Users/test/AppData/Roaming/BaddelLauncher/extra_cache';
    setDir(dir);
    const url = dir + '/some_image.jpg';
    assert.equal(siu(url), url);
});

test('setSafeImageCacheDir: ignores non-file:// input', () => {
    // Should not throw; just silently ignored
    const { setSafeImageCacheDir: setDir } = require('../src/js/domUtils');
    assert.doesNotThrow(() => setDir('https://example.com/not-a-dir'));
    assert.doesNotThrow(() => setDir(null));
    assert.doesNotThrow(() => setDir(undefined));
});
