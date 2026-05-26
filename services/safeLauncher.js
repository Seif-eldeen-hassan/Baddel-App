'use strict';

const { spawn } = require('child_process');
const { shell }  = require('electron');
const path       = require('path');
const fs         = require('fs');

// Protocols that may be opened with shell.openExternal or cmd start
const ALLOWED_PROTOCOLS = new Set([
    'https:',
    'steam:',
    'com.epicgames.launcher:',
    'origin:',
    'uplay:',
    'rockstar:',
]);

// Only .exe and .lnk are allowed. Script extensions (.bat, .cmd, .ps1, .vbs,
// .js, .msi) are blocked because they can execute arbitrary commands even
// when the file content looks benign at path-validation time.
const ALLOWED_EXE_EXTS = new Set(['.exe', '.lnk']);

/**
 * Validate that `rawPath` points to an existing file with an allowed extension.
 * Returns the normalized absolute path.
 * Throws with code INVALID_PATH if validation fails.
 */
function validateExecutablePath(rawPath) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
        const e = new Error('Executable path must be a non-empty string.');
        e.code = 'INVALID_PATH';
        throw e;
    }
    let stripped = rawPath.trim();
    if (stripped.startsWith('"') && stripped.endsWith('"')) stripped = stripped.slice(1, -1).trim();
    const normalized = path.normalize(stripped);
    const ext = path.extname(normalized).toLowerCase();
    if (!ALLOWED_EXE_EXTS.has(ext)) {
        const e = new Error(`Extension not allowed: ${ext}`);
        e.code = 'INVALID_EXT';
        throw e;
    }
    if (!fs.existsSync(normalized)) {
        const e = new Error(`Executable not found: ${normalized}`);
        e.code = 'FILE_NOT_FOUND';
        throw e;
    }
    return normalized;
}

/**
 * Validate a protocol URL — must use an allowed protocol scheme.
 * Returns the original URL string unchanged if valid.
 * Throws with code INVALID_URL if not.
 */
function validateProtocolUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl || ''));
    } catch {
        const e = new Error(`Invalid URL: ${String(rawUrl).slice(0, 80)}`);
        e.code = 'INVALID_URL';
        throw e;
    }
    // Normalise: URL parser lowercases the protocol and keeps the trailing colon
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        const e = new Error(`Protocol not allowed: ${parsed.protocol}`);
        e.code = 'PROTOCOL_NOT_ALLOWED';
        throw e;
    }
    return rawUrl;
}

/**
 * Open a protocol URL using shell.openExternal.
 * Falls back to spawning cmd.exe with `start ""` (no shell: true, no string interpolation)
 * if shell.openExternal throws.
 */
async function openProtocolUrl(rawUrl) {
    const safeUrl = validateProtocolUrl(rawUrl);
    try {
        await shell.openExternal(safeUrl);
        return;
    } catch (e) {
        console.warn('[safeLauncher] shell.openExternal failed, falling back to cmd start:', e.message);
    }
    // Safe fallback: spawn cmd.exe with the URL as a literal argument — never via shell string.
    await new Promise((resolve, reject) => {
        const child = spawn('cmd.exe', ['/c', 'start', '', safeUrl], { shell: false, windowsHide: true });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) reject(new Error(`cmd start exited ${code}`));
            else resolve();
        });
    });
}

/**
 * Launch an executable safely using spawn (no shell interpolation).
 * Resolves to `{ ok: true, pid: number }` after 500 ms if no early error,
 * or `{ ok: false, error: Error }` if spawn emits 'error' first.
 *
 * @param {string} rawPath
 * @param {string[]} [args]
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ ok: boolean, pid?: number, error?: Error }>}
 */
function launchExecutable(rawPath, args = [], options = {}) {
    const exePath = validateExecutablePath(rawPath);
    let cwd;
    if (options.cwd && fs.existsSync(options.cwd)) {
        cwd = options.cwd;
    } else {
        const dir = path.dirname(exePath);
        if (dir && fs.existsSync(dir)) cwd = dir;
    }
    let child;
    try {
        child = spawn(exePath, args, {
            shell:       false,
            detached:    true,
            windowsHide: false,
            stdio:       'ignore',
            cwd,
        });
    } catch (syncErr) {
        console.error(`[safeLauncher] sync spawn error exe=${path.basename(exePath)}:`, syncErr.message);
        return Promise.resolve({ ok: false, error: syncErr });
    }
    return new Promise(resolve => {
        child.on('spawn', () =>
            console.log(`[safeLauncher] spawn pid=${child.pid} exe=${path.basename(exePath)}`));
        child.on('error', err => {
            console.error(`[safeLauncher] error exe=${path.basename(exePath)}:`, err.message);
            resolve({ ok: false, error: err });
        });
        child.on('exit', (code, signal) =>
            console.log(`[safeLauncher] exit pid=${child.pid} code=${code} signal=${signal}`));
        setTimeout(() => resolve({ ok: true, pid: child.pid }), 500);
    });
}

module.exports = { validateExecutablePath, validateProtocolUrl, openProtocolUrl, launchExecutable };
