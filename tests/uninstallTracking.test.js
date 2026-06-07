'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.resolve(__dirname, '..');
const ANALYTICS = fs.readFileSync(path.join(ROOT, 'analytics.js'),             'utf8');
const MAIN_JS   = fs.readFileSync(path.join(ROOT, 'main.js'),                  'utf8');
const NSIS_NSH  = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'),   'utf8');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'),  'utf8'));

// ─── 1. analytics.js — writeUninstallTelemetryConfig ─────────────────────────

test('analytics.js: writeUninstallTelemetryConfig is defined', () => {
    assert.match(ANALYTICS, /function writeUninstallTelemetryConfig/);
});

test('analytics.js: writeUninstallTelemetryConfig writes uninstall-telemetry.json', () => {
    const idx = ANALYTICS.indexOf('function writeUninstallTelemetryConfig');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.match(fn, /uninstall-telemetry\.json/, 'must target uninstall-telemetry.json');
    assert.match(fn, /fs\.writeFile/,             'must call fs.writeFile');
});

test('analytics.js: writeUninstallTelemetryConfig includes installId field', () => {
    const idx = ANALYTICS.indexOf('function writeUninstallTelemetryConfig');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.match(fn, /installId/);
});

test('analytics.js: writeUninstallTelemetryConfig includes consentGiven field', () => {
    const idx = ANALYTICS.indexOf('function writeUninstallTelemetryConfig');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.match(fn, /consentGiven/);
});

test('analytics.js: writeUninstallTelemetryConfig includes appVersion field', () => {
    const idx = ANALYTICS.indexOf('function writeUninstallTelemetryConfig');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.match(fn, /appVersion/);
});

test('analytics.js: writeUninstallTelemetryConfig is exported', () => {
    const exportIdx = ANALYTICS.lastIndexOf('module.exports');
    const exportBlock = ANALYTICS.slice(exportIdx, exportIdx + 1300);
    assert.match(exportBlock, /writeUninstallTelemetryConfig/);
});

// ─── 2. analytics.js — updateUninstallTelemetryConsent ───────────────────────

test('analytics.js: updateUninstallTelemetryConsent is defined', () => {
    assert.match(ANALYTICS, /function updateUninstallTelemetryConsent/);
});

test('analytics.js: updateUninstallTelemetryConsent updates uninstall-telemetry.json', () => {
    const idx = ANALYTICS.indexOf('function updateUninstallTelemetryConsent');
    const fn  = ANALYTICS.slice(idx, idx + 600);
    assert.match(fn, /uninstall-telemetry\.json/);
    assert.match(fn, /consentGiven/);
    assert.match(fn, /fs\.writeFile/);
});

test('analytics.js: updateUninstallTelemetryConsent is exported', () => {
    const exportIdx = ANALYTICS.lastIndexOf('module.exports');
    const exportBlock = ANALYTICS.slice(exportIdx, exportIdx + 1300);
    assert.match(exportBlock, /updateUninstallTelemetryConsent/);
});

test('analytics.js: grantConsent calls updateUninstallTelemetryConsent', () => {
    const idx = ANALYTICS.indexOf('async function grantConsent');
    const fn  = ANALYTICS.slice(idx, idx + 350);
    assert.match(fn, /updateUninstallTelemetryConsent\(true\)/);
});

test('analytics.js: revokeConsent calls updateUninstallTelemetryConsent', () => {
    const idx = ANALYTICS.indexOf('async function revokeConsent');
    const fn  = ANALYTICS.slice(idx, idx + 250);
    assert.match(fn, /updateUninstallTelemetryConsent\(false\)/);
});

// ─── 3. analytics.js — logHeartbeat ──────────────────────────────────────────

test('analytics.js: logHeartbeat is defined', () => {
    assert.match(ANALYTICS, /function logHeartbeat/);
});

test('analytics.js: logHeartbeat gates on _consentGiven', () => {
    const idx = ANALYTICS.indexOf('function logHeartbeat');
    const fn  = ANALYTICS.slice(idx, idx + 500);
    assert.match(fn, /_consentGiven/, 'must check consent before sending');
});

test('analytics.js: logHeartbeat reads analytics-heartbeat.json', () => {
    const idx = ANALYTICS.indexOf('function logHeartbeat');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.match(fn, /analytics-heartbeat\.json/);
});

test('analytics.js: logHeartbeat sends app_heartbeat event', () => {
    const idx = ANALYTICS.indexOf('function logHeartbeat');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.match(fn, /app_heartbeat/);
});

test('analytics.js: logHeartbeat enforces 24-hour cooldown', () => {
    const idx = ANALYTICS.indexOf('function logHeartbeat');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.match(fn, /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|86400000/, 'must have 24h gate in ms');
});

test('analytics.js: logHeartbeat writes lastSent timestamp to heartbeat file', () => {
    const idx = ANALYTICS.indexOf('function logHeartbeat');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.match(fn, /lastSent/);
    assert.match(fn, /fs\.writeFile/);
});

// ─── 4. analytics.js — startHeartbeat ────────────────────────────────────────

test('analytics.js: startHeartbeat is defined', () => {
    assert.match(ANALYTICS, /function startHeartbeat/);
});

test('analytics.js: startHeartbeat sets up a recurring interval', () => {
    const idx = ANALYTICS.indexOf('function startHeartbeat');
    const fn  = ANALYTICS.slice(idx, idx + 300);
    assert.match(fn, /setInterval/);
});

test('analytics.js: startHeartbeat calls logHeartbeat immediately', () => {
    const idx = ANALYTICS.indexOf('function startHeartbeat');
    const fn  = ANALYTICS.slice(idx, idx + 300);
    assert.match(fn, /logHeartbeat\(\)/);
});

test('analytics.js: startHeartbeat is exported', () => {
    const exportIdx = ANALYTICS.lastIndexOf('module.exports');
    const exportBlock = ANALYTICS.slice(exportIdx, exportIdx + 1300);
    assert.match(exportBlock, /startHeartbeat/);
});

// ─── 5. Privacy checks ───────────────────────────────────────────────────────

test('analytics.js: writeUninstallTelemetryConfig does not write email or account data', () => {
    const idx = ANALYTICS.indexOf('function writeUninstallTelemetryConfig');
    const fn  = ANALYTICS.slice(idx, idx + 700);
    assert.doesNotMatch(fn, /email|accountName|password|token|cookie|sessionPath/i);
});

test('analytics.js: app_heartbeat event does not include PII fields', () => {
    const idx   = ANALYTICS.indexOf('app_heartbeat');
    const block = ANALYTICS.slice(idx - 30, idx + 250);
    assert.doesNotMatch(block, /email|accountName|password|token|libraryPath/i);
});

test('analytics.js: logHeartbeat does not send without consent', () => {
    const idx = ANALYTICS.indexOf('function logHeartbeat');
    const fn  = ANALYTICS.slice(idx, idx + 150);
    // First thing after the opening should be the consent guard
    assert.match(fn, /if\s*\(\s*!_consentGiven/);
});

// ─── 6. main.js — lifecycle integration ──────────────────────────────────────

test('main.js: calls analytics.writeUninstallTelemetryConfig after analytics.init', () => {
    const initIdx = MAIN_JS.indexOf("runAfterStartupGrace('analytics.init'");
    assert.ok(initIdx !== -1, 'analytics.init call must exist');
    const block = MAIN_JS.slice(initIdx, initIdx + 300);
    assert.match(block, /analytics\.writeUninstallTelemetryConfig/);
});

test('main.js: calls analytics.startHeartbeat after analytics.init', () => {
    const initIdx = MAIN_JS.indexOf("runAfterStartupGrace('analytics.init'");
    const block   = MAIN_JS.slice(initIdx, initIdx + 300);
    assert.match(block, /analytics\.startHeartbeat/);
});

test('main.js: writeUninstallTelemetryConfig is fire-and-forget (.catch)', () => {
    const idx   = MAIN_JS.indexOf('analytics.writeUninstallTelemetryConfig');
    const block = MAIN_JS.slice(idx, idx + 80);
    assert.match(block, /\.catch\(/);
});

// ─── 7. package.json — nsis.include ──────────────────────────────────────────

test('package.json: build.nsis.include is set', () => {
    assert.ok(PKG?.build?.nsis?.include, 'build.nsis.include must be defined');
});

test('package.json: build.nsis.include points to installer.nsh', () => {
    assert.match(PKG.build.nsis.include, /installer\.nsh/);
});

test('package.json: build.nsis.include is inside build/ directory', () => {
    assert.match(PKG.build.nsis.include, /build[/\\]/);
});

// ─── 8. build/installer.nsh — NSIS hook ──────────────────────────────────────

test('build/installer.nsh: customInstall macro is defined', () => {
    assert.match(NSIS_NSH, /!macro\s+customInstall/);
});

test('build/installer.nsh: customUnInstall macro is defined', () => {
    assert.match(NSIS_NSH, /!macro\s+customUnInstall/);
});

test('build/installer.nsh: reads uninstall-telemetry.json', () => {
    assert.match(NSIS_NSH, /uninstall-telemetry\.json/);
});

test('build/installer.nsh: checks consentGiven before sending', () => {
    assert.match(NSIS_NSH, /consentGiven/);
});

test('build/installer.nsh: sends app_uninstall_started event name', () => {
    assert.match(NSIS_NSH, /app_uninstall_started/);
});

test('build/installer.nsh: posts to api.baddel.app/v1/events', () => {
    assert.match(NSIS_NSH, /api\.baddel\.app\/v1\/events/);
});

test('build/installer.nsh: enforces 2-second TIMEOUT', () => {
    assert.match(NSIS_NSH, /TIMEOUT=2000/);
});

test('build/installer.nsh: sends installId (not email or passwords)', () => {
    assert.match(NSIS_NSH,    /installId/);
    assert.doesNotMatch(NSIS_NSH, /email|password|accountName|token|cookie/i);
});

test('build/installer.nsh: uses TLS 1.2 for the HTTPS request', () => {
    assert.match(NSIS_NSH, /Tls12|SecurityProtocol/);
});

test('build/installer.nsh: errors are silently swallowed', () => {
    assert.match(NSIS_NSH, /SilentlyContinue|catch\s*\{\}/);
});

test('build/installer.nsh: uses PowerShell to send the event', () => {
    assert.match(NSIS_NSH, /powershell\.exe/i);
});
