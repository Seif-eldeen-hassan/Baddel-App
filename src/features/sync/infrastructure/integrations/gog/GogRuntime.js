'use strict';

const crypto = require('crypto');
const defaultFs = require('fs');
const defaultFsPromises = require('fs').promises;
const defaultPath = require('path');
const { execFile: defaultExecFile } = require('child_process');

const SECRET_RE = /(access[_-]?token|refresh[_-]?token|authorization|auth[_-]?code|code|cookie|password|secret)(["'\s:=]+)([^"'\s,}]+)/gi;
const MAX_CAPTURE_BYTES = 64 * 1024;

class GogRuntimeError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'GogRuntimeError';
        this.code = code;
        this.details = details;
    }
}

function redactGogSecrets(value) {
    return String(value || '').replace(SECRET_RE, (_m, key, sep) => `${key}${sep}[REDACTED]`);
}

function boundedAppend(current, chunk, maxBytes = MAX_CAPTURE_BYTES) {
    const next = current + String(chunk || '');
    if (Buffer.byteLength(next, 'utf8') <= maxBytes) return next;
    return next.slice(Math.max(0, next.length - maxBytes));
}

class GogRuntime {
    constructor({
        projectRoot = process.cwd(),
        resourcesPath = process.resourcesPath,
        isPackaged = false,
        fs = defaultFs,
        fsPromises = defaultFsPromises,
        path = defaultPath,
        execFile = defaultExecFile,
        expectedSha256 = null,
        versionInfo = null,
    } = {}) {
        this.projectRoot = projectRoot;
        this.resourcesPath = resourcesPath;
        this.isPackaged = Boolean(isPackaged);
        this.fs = fs;
        this.fsPromises = fsPromises;
        this.path = path;
        this.execFile = execFile;
        this.expectedSha256 = expectedSha256 || versionInfo?.sha256 || null;
        this.versionInfo = versionInfo || null;
    }

    get runtimeDir() {
        return this.isPackaged
            ? this.path.join(this.resourcesPath || '', 'gog-runtime')
            : this.path.join(this.projectRoot || '', 'gog-runtime');
    }

    get exePath() {
        return this.path.join(this.runtimeDir, 'gogdl.exe');
    }

    async assertExists() {
        if (!this.fs.existsSync(this.exePath)) {
            throw new GogRuntimeError(
                'GOG_RUNTIME_MISSING',
                'GOG runtime is missing. Please reinstall Baddel or restore gog-runtime/gogdl.exe.',
                { exePath: this.exePath }
            );
        }
        return this.exePath;
    }

    async verifyChecksum() {
        if (!this.expectedSha256) return null;
        await this.assertExists();
        const data = await this.fsPromises.readFile(this.exePath);
        const actual = crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
        const expected = String(this.expectedSha256).toUpperCase();
        if (actual !== expected) {
            throw new GogRuntimeError('GOG_RUNTIME_INVALID', 'GOG runtime checksum does not match the pinned version.', {
                expected,
                actual,
            });
        }
        return actual;
    }

    async verify({ timeoutMs = 5000 } = {}) {
        await this.assertExists();
        await this.verifyChecksum();
        const result = await this.run(['--version'], { timeoutMs });
        const version = String(result.stdout || '').trim();
        if (!version) {
            throw new GogRuntimeError('GOG_RUNTIME_INVALID', 'GOG runtime did not report a version.');
        }
        return { exePath: this.exePath, version };
    }

    run(args = [], { timeoutMs = 45000, env = {}, signal = null, cwd = null, redactOutput = true } = {}) {
        return new Promise((resolve, reject) => {
            if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
                reject(new GogRuntimeError('GOG_RUNTIME_INVALID', 'Invalid GOG runtime arguments.'));
                return;
            }

            try {
                this.fs.accessSync(this.exePath);
            } catch {
                reject(new GogRuntimeError('GOG_RUNTIME_MISSING', 'GOG runtime executable was not found.', { exePath: this.exePath }));
                return;
            }

            let stdout = '';
            let stderr = '';
            let settled = false;
            const proc = this.execFile(this.exePath, args, {
                cwd: cwd || this.projectRoot,
                env: { ...process.env, ...env },
                windowsHide: true,
                timeout: timeoutMs,
                maxBuffer: MAX_CAPTURE_BYTES,
            });

            const cleanupSignal = () => {
                if (signal && onAbort) signal.removeEventListener('abort', onAbort);
            };

            const finish = (fn) => {
                if (settled) return;
                settled = true;
                cleanupSignal();
                fn();
            };

            const onAbort = signal
                ? () => {
                    try { proc.kill(); } catch {}
                    finish(() => reject(new GogRuntimeError('GOG_RUNTIME_CANCELLED', 'GOG runtime operation was cancelled.')));
                }
                : null;

            if (signal) {
                if (signal.aborted) {
                    onAbort();
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }

            proc.stdout?.on('data', (data) => { stdout = boundedAppend(stdout, data); });
            proc.stderr?.on('data', (data) => { stderr = boundedAppend(stderr, data); });
            proc.on('error', (err) => {
                finish(() => reject(new GogRuntimeError('GOG_RUNTIME_INVALID', redactGogSecrets(err?.message || 'Failed to start GOG runtime.'))));
            });
            proc.on('close', (code, signalName) => {
                finish(() => {
                    if (code === 0) {
                        resolve({
                            stdout: redactOutput ? redactGogSecrets(stdout) : stdout,
                            stderr: redactOutput ? redactGogSecrets(stderr) : stderr,
                            code,
                        });
                        return;
                    }
                    const detail = redactGogSecrets(stderr.trim() || stdout.trim() || `gogdl exited with code ${code || signalName}`);
                    reject(new GogRuntimeError('GOG_RUNTIME_INVALID', detail, { code, signal: signalName }));
                });
            });
        });
    }
}

module.exports = {
    GogRuntime,
    GogRuntimeError,
    redactGogSecrets,
};
