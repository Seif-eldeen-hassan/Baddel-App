'use strict';

const defaultFs = require('fs').promises;
const defaultPath = require('path');
const { redactGogSecrets } = require('./GogRuntime');

const GOG_AUTH_URL = 'https://login.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2';
const ALLOWED_AUTH_HOSTS = new Set(['login.gog.com', 'auth.gog.com', 'embed.gog.com', 'www.gog.com', 'gog.com']);

class GogAuthError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'GogAuthError';
        this.code = code;
    }
}

function extractAuthCode(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return parsed.searchParams.get('code') || parsed.hash.match(/[?&]code=([^&]+)/)?.[1] || null;
    } catch {
        return null;
    }
}

function findAuthValue(input, wantedKeys) {
    const stack = [input];
    const normalizedWanted = new Set(wantedKeys.map((key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')));
    const seen = new Set();
    while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item);
        for (const [key, value] of Object.entries(item)) {
            const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalizedWanted.has(normalizedKey) && value != null && String(value).trim()) {
                return value;
            }
            if (value && typeof value === 'object') stack.push(value);
        }
    }
    return null;
}

function readCredentials(authJson, { allowMissingUserId = false } = {}) {
    const userId =
        authJson?.user_id ||
        authJson?.userId ||
        authJson?.galaxyUserId ||
        authJson?.gog_user_id ||
        authJson?.user?.id ||
        authJson?.user?.userId ||
        authJson?.user?.galaxyUserId ||
        findAuthValue(authJson, ['user_id', 'userId', 'galaxyUserId', 'gog_user_id', 'account_id']);
    const accessToken =
        authJson?.access_token ||
        authJson?.accessToken ||
        authJson?.tokens?.access_token ||
        authJson?.tokens?.accessToken ||
        findAuthValue(authJson, ['access_token', 'accessToken']);
    const refreshToken =
        authJson?.refresh_token ||
        authJson?.refreshToken ||
        authJson?.tokens?.refresh_token ||
        authJson?.tokens?.refreshToken ||
        findAuthValue(authJson, ['refresh_token', 'refreshToken']);
    if (!userId || !accessToken) {
        if (allowMissingUserId && accessToken) {
            return { userId: null, accessToken, refreshToken };
        }
        throw new GogAuthError('GOG_AUTH_FAILED', 'GOG authentication did not return usable credentials.');
    }
    return { userId: String(userId), accessToken, refreshToken };
}

function readCredentialsFromRuntimeResult(result, fallbackAuthJson = null, options = {}) {
    const raw = String(result?.stdout || '').trim();
    if (raw) {
        try {
            return readCredentials(JSON.parse(raw), options);
        } catch (err) {
            if (!fallbackAuthJson) throw err;
        }
    }
    return readCredentials(fallbackAuthJson, options);
}

function mergeProfileCredentials(credentials, profile = {}) {
    const userId =
        credentials?.userId ||
        profile?.userId ||
        profile?.id ||
        profile?.galaxyUserId ||
        profile?.user_id ||
        profile?.user?.id ||
        profile?.user?.userId ||
        findAuthValue(profile, ['user_id', 'userId', 'galaxyUserId', 'account_id']);
    if (!userId) {
        throw new GogAuthError('GOG_AUTH_FAILED', 'GOG authentication did not return a usable account id.');
    }
    return {
        ...credentials,
        userId: String(userId),
        username: credentials?.username || profile?.username || profile?.login || profile?.nickname || profile?.email || profile?.user?.username,
        displayName: credentials?.displayName || profile?.username || profile?.login || profile?.nickname || profile?.email || profile?.user?.displayName,
        user: profile?.user || credentials?.user || profile,
    };
}

class GogAuthService {
    constructor({
        runtime,
        userDataDir,
        BrowserWindow,
        session,
        fs = defaultFs,
        path = defaultPath,
        authUrl = GOG_AUTH_URL,
        profileResolver = null,
    } = {}) {
        this.runtime = runtime;
        this.userDataDir = userDataDir;
        this.BrowserWindow = BrowserWindow;
        this.session = session;
        this.fs = fs;
        this.path = path;
        this.authUrl = authUrl;
        this.profileResolver = profileResolver;
    }

    get accountsRootDir() {
        return this.path.join(this.userDataDir, 'gog', 'accounts');
    }

    getAuthFilePath(accountId) {
        return this.path.join(this.accountsRootDir, String(accountId), 'auth.json');
    }

    async readAuthJson(accountId) {
        return JSON.parse(await this.fs.readFile(this.getAuthFilePath(accountId), 'utf8'));
    }

    async readCredentials(accountId) {
        const credentials = readCredentials(await this.readAuthJson(accountId), { allowMissingUserId: true });
        return {
            ...credentials,
            userId: credentials.userId || String(accountId),
        };
    }

    async refreshCredentials(accountId) {
        const authPath = this.getAuthFilePath(accountId);
        const result = await this.runtime.run(['--auth-config-path', authPath, 'auth'], { timeoutMs: 30000, redactOutput: false });
        let authJson = null;
        try { authJson = await this.readAuthJson(accountId); } catch {}
        const credentials = readCredentialsFromRuntimeResult(result, authJson, { allowMissingUserId: true });
        return {
            ...credentials,
            userId: credentials.userId || String(accountId),
        };
    }

    async _openLoginWindow(parentWindow, emitState = () => {}) {
        if (!this.BrowserWindow) {
            throw new GogAuthError('GOG_AUTH_FAILED', 'GOG login window is unavailable.');
        }
        emitState('authenticating', 'Opening secure GOG sign-in...');
        return new Promise((resolve, reject) => {
            let settled = false;
            const partition = `temp:gog-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const win = new this.BrowserWindow({
                width: 900,
                height: 720,
                parent: parentWindow || undefined,
                modal: Boolean(parentWindow),
                show: true,
                title: 'Link GOG Account',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                    partition,
                },
            });

            const cleanup = () => {
                try { win.removeAllListeners(); } catch {}
                try { win.webContents.removeAllListeners(); } catch {}
                try { this.session?.fromPartition?.(partition)?.clearStorageData?.(); } catch {}
            };
            const settle = (fn) => {
                if (settled) return;
                settled = true;
                cleanup();
                fn();
                try { if (!win.isDestroyed()) win.close(); } catch {}
            };
            const inspectUrl = (url) => {
                const code = extractAuthCode(url);
                if (code) {
                    settle(() => resolve(decodeURIComponent(code)));
                    return true;
                }
                return false;
            };
            const isAllowed = (rawUrl) => {
                try { return ALLOWED_AUTH_HOSTS.has(new URL(rawUrl).hostname.toLowerCase()); }
                catch { return false; }
            };

            win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            win.webContents.on('will-navigate', (event, url) => {
                if (inspectUrl(url)) return;
                if (!isAllowed(url)) event.preventDefault();
            });
            win.webContents.on('will-redirect', (_event, url) => inspectUrl(url));
            win.webContents.on('did-navigate', (_event, url) => inspectUrl(url));
            win.webContents.on('did-navigate-in-page', (_event, url) => inspectUrl(url));
            win.on('closed', () => settle(() => reject(new GogAuthError('GOG_LOGIN_CANCELLED', 'GOG login was cancelled.'))));
            win.loadURL(this.authUrl).catch((err) => {
                settle(() => reject(new GogAuthError('GOG_AUTH_FAILED', redactGogSecrets(err?.message || 'Could not open GOG login.'))));
            });
        });
    }

    async link(parentWindow, emitState = () => {}) {
        await this.runtime.verify();
        const code = await this._openLoginWindow(parentWindow, emitState);
        const tmpDir = this.path.join(this.userDataDir, 'gog', 'tmp');
        const tmpAuthPath = this.path.join(tmpDir, `auth-${Date.now()}.json`);
        await this.fs.mkdir(tmpDir, { recursive: true });
        try {
            emitState('saving_account', 'Saving linked GOG account...');
            const result = await this.runtime.run(['--auth-config-path', tmpAuthPath, 'auth', '--code', code], { timeoutMs: 45000, redactOutput: false });
            const authJson = JSON.parse(await this.fs.readFile(tmpAuthPath, 'utf8'));
            let credentials = readCredentialsFromRuntimeResult(result, authJson, { allowMissingUserId: true });
            if (!credentials.userId && typeof this.profileResolver === 'function') {
                credentials = mergeProfileCredentials(credentials, await this.profileResolver(credentials));
            }
            if (!credentials.userId) {
                throw new GogAuthError('GOG_AUTH_FAILED', 'GOG authentication did not return a usable account id.');
            }
            const accountDir = this.path.join(this.accountsRootDir, credentials.userId);
            await this.fs.mkdir(accountDir, { recursive: true });
            await this.fs.rename(tmpAuthPath, this.path.join(accountDir, 'auth.json')).catch(async () => {
                await this.fs.copyFile(tmpAuthPath, this.path.join(accountDir, 'auth.json'));
                await this.fs.rm(tmpAuthPath, { force: true });
            });
            return credentials;
        } catch (err) {
            await this.fs.rm(tmpAuthPath, { force: true }).catch(() => {});
            if (err.code) throw err;
            throw new GogAuthError('GOG_AUTH_FAILED', redactGogSecrets(err?.message || 'GOG authentication failed.'));
        }
    }

    async unlink(accountId) {
        await this.fs.rm(this.path.join(this.accountsRootDir, String(accountId)), { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = {
    GogAuthService,
    GogAuthError,
    GOG_AUTH_URL,
    extractAuthCode,
    readCredentials,
    readCredentialsFromRuntimeResult,
    mergeProfileCredentials,
};
