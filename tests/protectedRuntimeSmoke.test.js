'use strict';

/**
 * protectedRuntimeSmoke.test.js
 *
 * Structural smoke tests for the protected production bundle.
 *
 * These tests do not launch Electron — they inspect the bundle contents to
 * confirm that startup, navigation, and error-recovery code is present and
 * correctly wired up.  Tests that require a prior build run are automatically
 * skipped when the protected build directory does not exist.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const ROOT          = path.resolve(__dirname, '..');
const PROTECTED_DIR = path.join(ROOT, '.protected-build', 'app');
const BUNDLE_JS     = path.join(PROTECTED_DIR, 'renderer.bundle.js');
const BUNDLE_CSS    = path.join(PROTECTED_DIR, 'renderer.bundle.css');
const INDEX_HTML    = path.join(PROTECTED_DIR, 'index.html');
const QS_HTML       = path.join(PROTECTED_DIR, 'quick-switcher.html');
const MAIN_BUNDLE   = path.join(PROTECTED_DIR, 'main.bundle.cjs');
const PRELOAD_BUNDLE = path.join(PROTECTED_DIR, 'preload.bundle.cjs');

const bundleExists   = fs.existsSync(BUNDLE_JS);
const mainExists     = fs.existsSync(MAIN_BUNDLE);
const preloadExists  = fs.existsSync(PRELOAD_BUNDLE);
const indexExists    = fs.existsSync(INDEX_HTML);

// ── Source-level checks (always run — no build required) ──────────────────────

const APP_JS     = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

test('app.js: traceStartupStep is defined', () => {
    assert.ok(APP_JS.includes('function traceStartupStep'), 'traceStartupStep helper not found in app.js');
});

test('app.js: traceHomeStep is defined', () => {
    assert.ok(APP_JS.includes('function traceHomeStep'), 'traceHomeStep helper not found in app.js');
});

test('app.js: initSystem uses traceStartupStep for renderSidebar', () => {
    assert.ok(APP_JS.includes("traceStartupStep('renderSidebar'") || APP_JS.includes('traceStartupStep("renderSidebar"'),
        'initSystem must trace renderSidebar step');
});

test('app.js: initSystem uses traceStartupStep for navigateToHome', () => {
    assert.ok(APP_JS.includes("traceStartupStep('navigateToHome'") || APP_JS.includes('traceStartupStep("navigateToHome"'),
        'initSystem must trace navigateToHome step');
});

test('app.js: initSystem uses traceStartupStep for initSortable', () => {
    assert.ok(APP_JS.includes("traceStartupStep('initSortable'") || APP_JS.includes('traceStartupStep("initSortable"'),
        'initSystem must trace initSortable step');
});

test('app.js: navigateToHome uses traceHomeStep for renderRecentlyPlayed', () => {
    assert.ok(APP_JS.includes("traceHomeStep('renderRecentlyPlayed'") || APP_JS.includes('traceHomeStep("renderRecentlyPlayed"'),
        'navigateToHome must isolate renderRecentlyPlayed with traceHomeStep');
});

test('app.js: navigateToHome uses traceHomeStep for renderExploreCarousel', () => {
    assert.ok(APP_JS.includes("traceHomeStep('renderExploreCarousel'") || APP_JS.includes('traceHomeStep("renderExploreCarousel"'),
        'navigateToHome must isolate renderExploreCarousel with traceHomeStep');
});

test('app.js: navigateToHome uses traceHomeStep for renderSyncedSuggestions', () => {
    assert.ok(APP_JS.includes("traceHomeStep('renderSyncedSuggestions'") || APP_JS.includes('traceHomeStep("renderSyncedSuggestions"'),
        'navigateToHome must isolate renderSyncedSuggestions with traceHomeStep');
});

test('app.js: navigateToHome uses traceHomeStep for applyHeroForHome', () => {
    assert.ok(APP_JS.includes("traceHomeStep('applyHeroForHome'") || APP_JS.includes('traceHomeStep("applyHeroForHome"'),
        'navigateToHome must isolate applyHeroForHome with traceHomeStep');
});

test('app.js: traceHomeStep swallows errors (does not rethrow)', () => {
    const idx   = APP_JS.indexOf('function traceHomeStep');
    const block = APP_JS.slice(idx, idx + 700);
    assert.ok(!block.includes('throw err'), 'traceHomeStep must not rethrow — one failing section must not crash home view');
});

test('app.js: window.onerror handler is registered', () => {
    assert.ok(APP_JS.includes('window.onerror'), 'window.onerror handler must be present in app.js');
});

test('app.js: window.onunhandledrejection handler is registered', () => {
    assert.ok(APP_JS.includes('window.onunhandledrejection'), 'window.onunhandledrejection handler must be present in app.js');
});

test('app.js: window.onerror forwards to logRuntimeError', () => {
    const idx   = APP_JS.indexOf('window.onerror');
    const block = APP_JS.slice(idx, idx + 300);
    assert.ok(block.includes('logRuntimeError'), 'window.onerror must forward errors to electronAPI.logRuntimeError');
});

test('app.js: window.onunhandledrejection forwards to logRuntimeError', () => {
    const idx   = APP_JS.indexOf('window.onunhandledrejection');
    const block = APP_JS.slice(idx, idx + 300);
    assert.ok(block.includes('logRuntimeError'), 'window.onunhandledrejection must forward errors to electronAPI.logRuntimeError');
});

test('preload.js: exposes logRuntimeError via contextBridge', () => {
    assert.ok(PRELOAD_JS.includes('logRuntimeError'), 'preload.js must expose logRuntimeError in electronAPI');
    assert.ok(PRELOAD_JS.includes('log-runtime-error'), 'preload.js must invoke the log-runtime-error IPC channel');
});

test('main.js: registers log-runtime-error IPC handler', () => {
    assert.ok(MAIN_JS.includes('log-runtime-error'), 'main.js must register the log-runtime-error ipcMain handler');
    assert.ok(MAIN_JS.includes('protected-renderer-runtime.log'), 'main.js must write to protected-renderer-runtime.log');
});

test('main.js: console-message listener writes to log file in production', () => {
    assert.ok(MAIN_JS.includes('console-message'), 'main.js must listen to webContents console-message events');
    assert.ok(MAIN_JS.includes('protected-renderer-runtime.log'), 'main.js must write console-message output to the runtime log');
    assert.ok(MAIN_JS.includes('isProductionBuild()'), 'console-message logging must be gated on isProductionBuild()');
});

test('main.js: log-runtime-error handler is gated on isProductionBuild', () => {
    const idx   = MAIN_JS.indexOf('log-runtime-error');
    assert.ok(idx !== -1, 'log-runtime-error handler not found');
    const block = MAIN_JS.slice(Math.max(0, idx - 50), idx + 500);
    assert.ok(block.includes('isProductionBuild'), 'log-runtime-error IPC handler must check isProductionBuild()');
});

// ── Protected bundle checks (skip if build has not been run) ──────────────────

// Note: the renderer bundle is obfuscated with base64 string encoding, so
// literal strings like '[Startup]' or 'unhandledrejection' may be stored as
// encoded values in the string array.  Source-level tests verify the code is
// present; bundle tests verify the bundle is non-trivially large and obfuscated.

test('renderer.bundle.js: is non-trivially large (requires prior build:protected)', {
    skip: !bundleExists,
}, () => {
    const stat = fs.statSync(BUNDLE_JS);
    assert.ok(stat.size > 50000, `renderer.bundle.js is too small (${stat.size} bytes) — JS may not have bundled correctly`);
});

test('renderer.bundle.js: is obfuscated (requires prior build:protected)', {
    skip: !bundleExists,
}, () => {
    const src = fs.readFileSync(BUNDLE_JS, 'utf8');
    assert.ok(/\b_0x[0-9a-f]{4,}\b/.test(src), 'renderer.bundle.js must contain obfuscated _0x identifiers');
});

test('renderer.bundle.js: contains onerror symbol (requires prior build:protected)', {
    skip: !bundleExists,
}, () => {
    const src = fs.readFileSync(BUNDLE_JS, 'utf8');
    // 'onerror' is a property name assignment — property names are not string-encoded by the obfuscator.
    assert.ok(src.includes('onerror'), 'renderer.bundle.js must contain the onerror property assignment');
});

test('renderer.bundle.css: has content (requires prior build:protected)', {
    skip: !fs.existsSync(BUNDLE_CSS),
}, () => {
    const stat = fs.statSync(BUNDLE_CSS);
    assert.ok(stat.size > 1024, `renderer.bundle.css is suspiciously small (${stat.size} bytes) — CSS may not have bundled`);
});

test('protected index.html: references renderer.bundle.css (requires prior build:protected)', {
    skip: !indexExists,
}, () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    assert.ok(html.includes('renderer.bundle.css'), 'index.html must reference renderer.bundle.css');
});

test('protected index.html: references renderer.bundle.js (requires prior build:protected)', {
    skip: !indexExists,
}, () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    assert.ok(html.includes('renderer.bundle.js'), 'index.html must reference renderer.bundle.js');
});

test('protected index.html: does not reference original src/css paths (requires prior build:protected)', {
    skip: !indexExists,
}, () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    assert.ok(!/<link[^>]*href=["']css\//i.test(html),
        'index.html must not contain original src/css/ stylesheet links — bundle injection may have failed');
});

test('protected index.html: does not contain Init Error in source (requires prior build:protected)', {
    skip: !indexExists,
}, () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    assert.ok(!html.includes('Init Error'), 'index.html must not contain a static Init Error string');
});

test('protected quick-switcher.html: references qs.bundle.css (requires prior build:protected)', {
    skip: !fs.existsSync(QS_HTML),
}, () => {
    const html = fs.readFileSync(QS_HTML, 'utf8');
    assert.ok(html.includes('qs.bundle.css'), 'quick-switcher.html must reference qs.bundle.css');
});

test('protected quick-switcher.html: references qs.bundle.js (requires prior build:protected)', {
    skip: !fs.existsSync(QS_HTML),
}, () => {
    const html = fs.readFileSync(QS_HTML, 'utf8');
    assert.ok(html.includes('qs.bundle.js'), 'quick-switcher.html must reference qs.bundle.js');
});

// 'log-runtime-error' is a string literal that the obfuscator base64-encodes,
// so we cannot check for it directly in the bundle.  The source-level test
// (preload.js: exposes logRuntimeError via contextBridge) already covers the
// code path; here we just confirm the bundle is obfuscated and non-trivial.
test('preload.bundle.cjs: is obfuscated and non-trivially large (requires prior build:protected)', {
    skip: !preloadExists,
}, () => {
    const stat = fs.statSync(PRELOAD_BUNDLE);
    assert.ok(stat.size > 5000, `preload.bundle.cjs is suspiciously small (${stat.size} bytes)`);
    const src = fs.readFileSync(PRELOAD_BUNDLE, 'utf8');
    assert.ok(/\b_0x[0-9a-f]{4,}\b/.test(src), 'preload.bundle.cjs must contain obfuscated _0x identifiers');
});

// main.bundle.cjs is also obfuscated — 'console-message' and
// 'protected-renderer-runtime.log' may be encoded in the string array.
// Verify the bundle is non-trivially large and obfuscated; source-level tests
// confirm the actual code paths.

test('main.bundle.cjs: is non-trivially large (requires prior build:protected)', {
    skip: !mainExists,
}, () => {
    const stat = fs.statSync(MAIN_BUNDLE);
    assert.ok(stat.size > 50000, `main.bundle.cjs is too small (${stat.size} bytes) — main process may not have bundled correctly`);
});

test('main.bundle.cjs: is obfuscated (requires prior build:protected)', {
    skip: !mainExists,
}, () => {
    const src = fs.readFileSync(MAIN_BUNDLE, 'utf8');
    assert.ok(/\b_0x[0-9a-f]{4,}\b/.test(src), 'main.bundle.cjs must contain obfuscated _0x identifiers');
});

test('protected build: assets/ directory exists (requires prior build:protected)', {
    skip: !fs.existsSync(PROTECTED_DIR),
}, () => {
    assert.ok(fs.existsSync(path.join(PROTECTED_DIR, 'assets')), 'assets/ must be present in the protected build');
});

test('protected build: node_modules/ junction exists (requires prior build:protected)', {
    skip: !fs.existsSync(PROTECTED_DIR),
}, () => {
    assert.ok(fs.existsSync(path.join(PROTECTED_DIR, 'node_modules')), 'node_modules/ junction must be present in the protected build');
});

test('protected build: package.json main points to main.bundle.cjs (requires prior build:protected)', {
    skip: !fs.existsSync(path.join(PROTECTED_DIR, 'package.json')),
}, () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROTECTED_DIR, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.main, 'main.bundle.cjs', 'protected package.json main must be main.bundle.cjs');
});
