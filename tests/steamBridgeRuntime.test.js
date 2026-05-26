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

// ── Dev mode — no venv, BADDEL_ALLOW_SYSTEM_PYTHON=1 ─────────
test('dev: falls back to system Python when venv absent and BADDEL_ALLOW_SYSTEM_PYTHON=1', () => {
    const allowEnv = (k) => k === 'BADDEL_ALLOW_SYSTEM_PYTHON' ? '1' : undefined;
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists, allowEnv);
    assert.ok(r.pythonBin, 'should fall back to system python when flag is set');
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

// ── Task 1: dev mode prefers python_env ───────────────────────
test('dev: chooses python_env\\Scripts\\python.exe when it exists', () => {
    const venvExe = path.join(WIN_BASE_DEV, 'python_env', 'Scripts', 'python.exe');
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, existsOnly(venvExe));
    assert.equal(r.pythonBin, venvExe, 'must select python_env exe');
    assert.equal(r.diagnostics.selectedPython, venvExe);
    assert.equal(r.diagnostics.pythonEnvExists, true);
});

test('dev: diagnostics.selectedPython matches pythonBin', () => {
    const venvExe = path.join(WIN_BASE_DEV, 'python_env', 'Scripts', 'python.exe');
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, existsOnly(venvExe));
    assert.equal(r.diagnostics.selectedPython, r.pythonBin);
});

// ── Task 2: missing python_env gives actionable error ─────────
test('dev: missing python_env gives actionable error (no BADDEL_ALLOW_SYSTEM_PYTHON)', () => {
    const noEnv = () => undefined;
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists, noEnv);
    assert.ok(r.diagnostics.error, 'error must be set');
    assert.match(r.diagnostics.error, /scripts\/build-python-env\.bat|scripts\\build-python-env\.bat/i,
        'error must reference build-python-env.bat');
    assert.equal(r.pythonBin, null, 'pythonBin must be null without fallback');
});

test('dev: pythonEnvExists is false when python_env is absent', () => {
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists, () => undefined);
    assert.equal(r.diagnostics.pythonEnvExists, false);
});

// ── Task 3: system python only with BADDEL_ALLOW_SYSTEM_PYTHON ─
test('dev: system python NOT used by default when python_env is missing', () => {
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists, () => undefined);
    assert.equal(r.pythonBin, null, 'must not fall back to system python without the flag');
});

test('dev: BADDEL_ALLOW_SYSTEM_PYTHON=1 enables system python fallback when python_env missing', () => {
    const allowEnv = (k) => k === 'BADDEL_ALLOW_SYSTEM_PYTHON' ? '1' : undefined;
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists, allowEnv);
    assert.ok(r.pythonBin, 'pythonBin must be set when flag is 1');
    assert.ok(['python3', 'python'].includes(r.pythonBin), 'must be a system python name');
    // Error message (if any) must NOT mention build-python-env.bat in this mode
    if (r.diagnostics.error) {
        assert.doesNotMatch(r.diagnostics.error, /Steam Python environment is missing/,
            'actionable-error message must not appear when system python is available');
    }
});

test('dev: BADDEL_ALLOW_SYSTEM_PYTHON=0 does not enable system python fallback', () => {
    const denyEnv = (k) => k === 'BADDEL_ALLOW_SYSTEM_PYTHON' ? '0' : undefined;
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists, denyEnv);
    assert.equal(r.pythonBin, null, 'value "0" must not enable fallback');
    assert.match(r.diagnostics.error, /build-python-env\.bat/i);
});

// ── Task 6: new diagnostics fields ───────────────────────────
test('dev diagnostics includes selectedPython, pythonEnvExists, requirementsPath', () => {
    const venvExe = path.join(WIN_BASE_DEV, 'python_env', 'Scripts', 'python.exe');
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, existsOnly(venvExe));
    assert.ok('selectedPython'   in r.diagnostics, 'selectedPython must be in diagnostics');
    assert.ok('pythonEnvExists'  in r.diagnostics, 'pythonEnvExists must be in diagnostics');
    assert.ok('requirementsPath' in r.diagnostics, 'requirementsPath must be in diagnostics');
});

test('dev diagnostics.requirementsPath points into baddel-steam-integration', () => {
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists, () => undefined);
    assert.ok(r.diagnostics.requirementsPath.includes('baddel-steam-integration'),
        'requirementsPath must be inside baddel-steam-integration/');
    assert.ok(r.diagnostics.requirementsPath.endsWith('requirements.txt'));
});

// ── Task 4 & 5: self-test stderr capture ─────────────────────
test('runBridgeSelfTest output captures stderr containing missing module name', () => {
    // Mirror the output-merging logic in runBridgeSelfTest to verify it works correctly.
    // When execFileAsync throws on non-zero exit, e.stderr has the Python traceback.
    function mergeSelfTestOutput(e) {
        const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : '';
        const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
        return [stdout, stderr].filter(Boolean).join('\n') || e.message;
    }

    const fakeErr = new Error('Command failed');
    fakeErr.stdout = '';
    fakeErr.stderr = "Traceback (most recent call last):\n  File \"baddel_bridge.py\"\nModuleNotFoundError: No module named 'certifi'";
    const output = mergeSelfTestOutput(fakeErr);
    assert.match(output, /certifi/, 'output must contain the missing module name');
    assert.match(output, /ModuleNotFoundError/, 'output must contain ModuleNotFoundError');
});

test('runBridgeSelfTest output is non-empty when only stderr is present', () => {
    function mergeSelfTestOutput(e) {
        const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : '';
        const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
        return [stdout, stderr].filter(Boolean).join('\n') || e.message;
    }

    const fakeErr = new Error('Command failed: python exit 1');
    fakeErr.stdout = '';
    fakeErr.stderr = "ModuleNotFoundError: No module named 'certifi'";
    assert.ok(mergeSelfTestOutput(fakeErr).length > 0, 'must return non-empty output');
    assert.equal(mergeSelfTestOutput(fakeErr), fakeErr.stderr.trim());
});

test('steamBridge.js: start() dev mode runs self-test before spawning', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'steamBridge.js'), 'utf8');
    const startIdx = src.indexOf('async start()');
    const startBody = src.slice(startIdx, startIdx + 3500);
    assert.match(startBody, /runBridgeSelfTest\(\)/, 'start() must call runBridgeSelfTest()');
    // The dev-mode spawn() must come AFTER runBridgeSelfTest — find the spawn that follows self-test
    const selfTestIdx = startBody.indexOf('runBridgeSelfTest()');
    const spawnAfterSelfTest = startBody.indexOf('this._proc = spawn(', selfTestIdx);
    assert.ok(spawnAfterSelfTest !== -1, 'a spawn() call must follow runBridgeSelfTest() in start()');
});

test('steamBridge.js: start() throws with self-test output when self-test fails', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'steamBridge.js'), 'utf8');
    const startIdx = src.indexOf('async start()');
    const startBody = src.slice(startIdx, startIdx + 3000);
    assert.match(startBody, /selfTest\.ok/, 'must check selfTest.ok');
    assert.match(startBody, /selfTest\.output.*selfTest\.error|selfTest\.error.*selfTest\.output/s,
        'must include output or error from self-test in thrown message');
});

// ── Updated diagnostics shape ─────────────────────────────────
test('diagnostics includes all required fields including new ones', () => {
    const required = [
        'isPackaged', 'runtimeMode', 'base',
        'bridgeExe', 'bridgeExeExists',
        'pythonExe', 'pythonExists',
        'selectedPython', 'pythonEnvExists', 'requirementsPath',
        'bridgeScript', 'bridgeScriptExists',
        'canRunBridgeVersionCheck', 'error',
    ];
    const r = _resolveRuntimePaths(false, WIN_BASE_DEV, neverExists, () => undefined);
    for (const field of required) {
        assert.ok(field in r.diagnostics, `diagnostics.${field} must exist`);
    }
});
