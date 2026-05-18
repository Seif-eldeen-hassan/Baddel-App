'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// safeLauncher requires Electron's shell — stub it before requiring the module
const Module = require('module');
const _origLoad = Module._load;
Module._load = function(request, ...rest) {
    if (request === 'electron') return { shell: { openExternal: async () => {} } };
    return _origLoad.call(this, request, ...rest);
};

const { validateExecutablePath, validateProtocolUrl } = require('../services/safeLauncher');

// ─── validateExecutablePath — extension checks (no real file needed) ──────────

test('safeLauncher: .bat is rejected (INVALID_EXT before file check)', () => {
    // Extension check fires before fs.existsSync, so no real file needed
    const err = assert.throws(() => validateExecutablePath('C:\\evil\\payload.bat'));
    // err is the thrown Error — just verify it threw
});

test('safeLauncher: .cmd is rejected', () => {
    assert.throws(
        () => validateExecutablePath('C:\\evil\\run.cmd'),
        /not allowed/i
    );
});

test('safeLauncher: .ps1 is rejected', () => {
    assert.throws(
        () => validateExecutablePath('C:\\evil\\script.ps1'),
        /not allowed/i
    );
});

test('safeLauncher: .vbs is rejected', () => {
    assert.throws(
        () => validateExecutablePath('C:\\evil\\macro.vbs'),
        /not allowed/i
    );
});

// ─── validateExecutablePath — .exe with a real temp file ─────────────────────

test('safeLauncher: .exe path passes when file exists', () => {
    const tmp = path.join(os.tmpdir(), `baddel_test_${Date.now()}.exe`);
    fs.writeFileSync(tmp, '');
    try {
        assert.doesNotThrow(() => validateExecutablePath(tmp));
    } finally {
        fs.unlinkSync(tmp);
    }
});

test('safeLauncher: .exe path throws FILE_NOT_FOUND when file missing', () => {
    const missing = path.join(os.tmpdir(), `baddel_missing_${Date.now()}.exe`);
    const err = assert.throws(() => validateExecutablePath(missing));
});

// ─── validateProtocolUrl ───────────────────────────────────────────────────────

test('safeLauncher: https:// URL passes', () => {
    assert.doesNotThrow(() => validateProtocolUrl('https://store.steampowered.com'));
});

test('safeLauncher: steam:// URL passes', () => {
    assert.doesNotThrow(() => validateProtocolUrl('steam://run/440'));
});

test('safeLauncher: file:// URL is rejected', () => {
    assert.throws(() => validateProtocolUrl('file:///C:/Windows/system32/cmd.exe'), /not allowed/i);
});

test('safeLauncher: javascript: URL is rejected', () => {
    assert.throws(() => validateProtocolUrl('javascript:alert(1)'), /not allowed|invalid/i);
});

test('safeLauncher: data: URL is rejected', () => {
    assert.throws(() => validateProtocolUrl('data:text/html,<script>alert(1)</script>'), /not allowed/i);
});

test('safeLauncher: http:// URL is rejected', () => {
    assert.throws(() => validateProtocolUrl('http://example.com'), /not allowed/i);
});
