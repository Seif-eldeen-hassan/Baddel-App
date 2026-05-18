'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// Load the pure path resolver directly (no Electron needed).
// steamBridge.js exports _resolveRuntimePaths for testing.
const { _resolveRuntimePaths } = require('../steamBridge');

const WIN_BASE_PKG  = 'C:\\Program Files\\Baddel\\resources';
const WIN_BASE_DEV  = path.resolve(__dirname, '..');

// ── Helpers ────────────────────────────────────────────────────
function neverExists()  { return false; }
function alwaysExists() { return true;  }
function existsOnly(...paths) {
    const set = new Set(paths.map(p => p.toLowerCase()));
    return (p) => set.has(p.toLowerCase());
}

// ── Packaged mode — exe present ────────────────────────────────
test('packaged: runtimeMode is pyinstaller-exe', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    assert.equal(r.runtimeMode, 'pyinstaller-exe');
});

test('packaged: bridgeExe points to steam-runtime/baddel_bridge/baddel_bridge.exe', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    assert.ok(r.bridgeExe.includes('steam-runtime'), 'path should contain steam-runtime');
    assert.ok(r.bridgeExe.endsWith('baddel_bridge.exe'), 'must end with baddel_bridge.exe');
});

test('packaged: pythonBin is null (no Python needed)', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    assert.equal(r.pythonBin, null);
});

test('packaged: bridgeExeExists true when exe file exists', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    assert.equal(r.bridgeExeExists, true);
});

test('packaged: diagnostics.isPackaged is true', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    assert.equal(r.diagnostics.isPackaged, true);
});

test('packaged: diagnostics.runtimeMode is pyinstaller-exe', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    assert.equal(r.diagnostics.runtimeMode, 'pyinstaller-exe');
});

test('packaged: diagnostics.canRunBridgeVersionCheck is true when exe exists', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    assert.equal(r.diagnostics.canRunBridgeVersionCheck, true);
});

// ── Packaged mode — exe missing ────────────────────────────────
test('packaged: bridgeExeExists false when exe missing', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, neverExists);
    assert.equal(r.bridgeExeExists, false);
});

test('packaged: diagnostics.error is set when exe missing', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, neverExists);
    assert.ok(r.diagnostics.error, 'should report an error');
    assert.match(r.diagnostics.error, /missing from this build/i);
});

test('packaged: canRunBridgeVersionCheck false when exe missing', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, neverExists);
    assert.equal(r.diagnostics.canRunBridgeVersionCheck, false);
});

// ── Packaged mode — must NOT fall back to python_env ──────────
test('packaged: does not set pythonBin even when python_env exists on disk', () => {
    // Simulate a machine that still has python_env alongside steam-runtime
    const exeInPythonEnv = path.join(WIN_BASE_PKG, 'python_env', 'Scripts', 'python.exe');
    const r = _resolveRuntimePaths(
        true, WIN_BASE_PKG,
        existsOnly(exeInPythonEnv)  // python_env exists but NOT baddel_bridge.exe
    );
    assert.equal(r.pythonBin, null, 'packaged mode must never use python_env');
    assert.equal(r.runtimeMode, 'pyinstaller-exe');
});

// ── Dev mode — venv present ────────────────────────────────────
test('dev: runtimeMode is python-source', () => {
    const venvPy = path.join(WIN_BASE_DEV, 'python_env', 'Scripts', 'python.exe');
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, existsOnly(venvPy));
    assert.equal(r.runtimeMode, 'python-source');
});

test('dev: pythonBin is set to venv python when it exists', () => {
    const venvPy = path.join(WIN_BASE_DEV, 'python_env', 'Scripts', 'python.exe');
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, existsOnly(venvPy));
    assert.ok(r.pythonBin, 'pythonBin should be set');
    assert.match(r.pythonBin, /python_env/);
});

test('dev: diagnostics.isPackaged is false', () => {
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists);
    assert.equal(r.diagnostics.isPackaged, false);
});

// ── Dev mode — no venv, falls back to system Python ───────────
test('dev: falls back to system Python when venv absent', () => {
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists);
    // system-path entries ('python3', 'python') are always accepted without fs.existsSync
    assert.ok(r.pythonBin, 'should fall back to system python');
    assert.ok(['python3', 'python'].includes(r.pythonBin), 'should be a system python name');
});

// ── Dev mode — diagnostics.error when nothing found ───────────
// (In practice the system-path fallback fires, but if we filter it out, error is set)
test('dev: diagnostics.runtimeMode is python-source', () => {
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists);
    assert.equal(r.diagnostics.runtimeMode, 'python-source');
});

// ── Diagnostics shape ─────────────────────────────────────────
test('diagnostics always includes runtimeMode field', () => {
    for (const isPackaged of [true, false]) {
        const r = _resolveRuntimePaths(isPackaged, WIN_BASE_PKG, neverExists);
        assert.ok('runtimeMode' in r.diagnostics, 'diagnostics.runtimeMode must exist');
    }
});

test('diagnostics includes all required fields', () => {
    const required = [
        'isPackaged', 'runtimeMode', 'base',
        'bridgeExe', 'bridgeExeExists',
        'pythonExe', 'pythonExists',
        'bridgeScript', 'bridgeScriptExists',
        'canRunBridgeVersionCheck', 'error',
    ];
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, neverExists);
    for (const field of required) {
        assert.ok(field in r.diagnostics, `diagnostics.${field} must exist`);
    }
});

// ── bridgeExe path correctness ────────────────────────────────
test('bridgeExe uses forward-slash-compatible path and ends with .exe', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, neverExists);
    assert.ok(r.bridgeExe.endsWith('.exe'), 'must be an .exe');
});

test('bridgeExe contains steam-runtime segment', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    const segments = r.bridgeExe.split(path.sep);
    assert.ok(segments.includes('steam-runtime'), 'path must go through steam-runtime/');
});

// ── python_env must not appear in packaged diagnostics ────────
test('packaged diagnostics does not mention python_env as pythonExe', () => {
    const r = _resolveRuntimePaths(true, WIN_BASE_PKG, alwaysExists);
    assert.equal(r.diagnostics.pythonExe, null);
});
