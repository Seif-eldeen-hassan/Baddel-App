'use strict';

const defaultFs = require('fs').promises;
const defaultFsSync = require('fs');
const defaultPath = require('path');
const { redactGogSecrets } = require('./GogRuntime');

const GOG_AUTH_URL = 'https://login.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2';
const ALLOWED_AUTH_HOSTS = new Set(['login.gog.com', 'auth.gog.com', 'embed.gog.com', 'www.gog.com', 'gog.com']);
const GOG_AUTH_HEADER_HEIGHT = 84;

function resolveGogAuthShellPath({
    projectRoot,
    isPackaged = false,
    fsSync = defaultFsSync,
    path = defaultPath,
} = {}) {
    const root = String(projectRoot || '').trim();
    if (!root) {
        throw new GogAuthError('GOG_AUTH_SHELL_NOT_FOUND', 'GOG authentication shell root is unavailable.');
    }

    const candidates = isPackaged
        ? [path.join(root, 'gog-auth-shell.html'), path.join(root, 'src', 'gog-auth-shell.html')]
        : [path.join(root, 'src', 'gog-auth-shell.html')];
    const shellPath = candidates.find((candidate) => fsSync.existsSync(candidate));
    if (!shellPath) {
        throw new GogAuthError(
            'GOG_AUTH_SHELL_NOT_FOUND',
            'GOG authentication shell is missing from the application.'
        );
    }
    return shellPath;
}

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

function isGogAuthCallback(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ''));
        return parsed.protocol === 'https:' &&
            parsed.hostname.toLowerCase() === 'embed.gog.com' &&
            parsed.pathname === '/on_login_success' &&
            Boolean(extractAuthCode(parsed.href));
    } catch {
        return false;
    }
}

function isSafeExternalAuthUrl(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ''));
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
        return String(rawUrl || '') === 'about:blank';
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
        WebContentsView,
        session,
        fs = defaultFs,
        path = defaultPath,
        authUrl = GOG_AUTH_URL,
        shellPath = null,
        windowIcon = null,
        profileResolver = null,
    } = {}) {
        this.runtime = runtime;
        this.userDataDir = userDataDir;
        this.BrowserWindow = BrowserWindow;
        this.WebContentsView = WebContentsView;
        this.session = session;
        this.fs = fs;
        this.path = path;
        this.authUrl = authUrl;
        this.shellPath = shellPath;
        this.windowIcon = windowIcon;
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
        if (!this.BrowserWindow || !this.WebContentsView || !this.shellPath) {
            throw new GogAuthError('GOG_AUTH_FAILED', 'GOG login window is unavailable.');
        }
        emitState('authenticating', 'Opening secure GOG sign-in...');
        return new Promise((resolve, reject) => {
            let settled = false;
            let shellReady = false;
            let authReady = false;
            const partition = `temp:gog-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const width = 920;
            const height = 760;
            let parentBounds = null;
            try {
                if (parentWindow && !parentWindow.isDestroyed?.()) parentBounds = parentWindow.getBounds?.() || null;
            } catch {}
            const centered = parentBounds ? {
                x: Math.round(parentBounds.x + (parentBounds.width - width) / 2),
                y: Math.round(parentBounds.y + (parentBounds.height - height) / 2),
            } : {};
            const win = new this.BrowserWindow({
                width,
                height,
                minWidth: 760,
                minHeight: 620,
                ...centered,
                parent: parentWindow || undefined,
                modal: Boolean(parentWindow),
                show: false,
                frame: false,
                titleBarStyle: 'hidden',
                autoHideMenuBar: true,
                backgroundColor: '#080a09',
                title: 'Connect GOG Account',
                ...(this.windowIcon ? { icon: this.windowIcon } : {}),
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                    webSecurity: true,
                },
            });
            win.setMenu?.(null);
            win.removeMenu?.();
            win.setMenuBarVisibility?.(false);

            const authView = new this.WebContentsView({
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                    webSecurity: true,
                    partition,
                },
            });
            win.contentView.addChildView(authView);
            const authContents = authView.webContents;
            const resizeAuthView = () => {
                if (win.isDestroyed?.()) return;
                const bounds = win.getContentBounds?.() || { width, height };
                authView.setBounds({ x: 0, y: GOG_AUTH_HEADER_HEIGHT, width: bounds.width, height: Math.max(1, bounds.height - GOG_AUTH_HEADER_HEIGHT) });
            };
            resizeAuthView();

            const cleanup = async () => {
                try { win.removeAllListeners(); } catch {}
                try { win.webContents.removeAllListeners(); } catch {}
                try { authContents.removeAllListeners(); } catch {}
                try { win.contentView.removeChildView(authView); } catch {}
                try { authContents.close(); } catch {}
                try { await this.session?.fromPartition?.(partition)?.clearStorageData?.(); } catch {}
            };
            const settle = async (fn) => {
                if (settled) return;
                settled = true;
                await cleanup();
                fn();
                try { if (!win.isDestroyed()) win.close(); } catch {}
            };
            const inspectUrl = (url) => {
                if (!isGogAuthCallback(url)) return false;
                const code = extractAuthCode(url);
                if (code) {
                    void settle(() => resolve(decodeURIComponent(code)));
                    return true;
                }
                return false;
            };
            const isAllowed = (rawUrl) => {
                try { return ALLOWED_AUTH_HOSTS.has(new URL(rawUrl).hostname.toLowerCase()); }
                catch { return false; }
            };
            const handleNavigation = (event, url) => {
                if (inspectUrl(url)) return;
                if (!isAllowed(url)) event?.preventDefault?.();
            };
            const revealWhenReady = () => {
                if (!settled && shellReady && authReady && !win.isDestroyed?.()) {
                    resizeAuthView();
                    win.show();
                }
            };
            const popupPreferences = {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                partition,
            };
            const popupDecision = ({ url } = {}) => {
                if (!isSafeExternalAuthUrl(url)) return { action: 'deny' };
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        parent: win,
                        modal: true,
                        show: true,
                        autoHideMenuBar: true,
                        backgroundColor: '#080a09',
                        ...(this.windowIcon ? { icon: this.windowIcon } : {}),
                        webPreferences: popupPreferences,
                    },
                };
            };
            const securePopup = (popup) => {
                try {
                    popup.setMenu?.(null);
                    popup.removeMenu?.();
                    popup.setMenuBarVisibility?.(false);
                    const contents = popup.webContents;
                    contents.setWindowOpenHandler?.(popupDecision);
                    const handlePopupNavigation = (event, url) => {
                        if (inspectUrl(url)) return;
                        if (!isSafeExternalAuthUrl(url)) event?.preventDefault?.();
                    };
                    contents.on?.('will-navigate', handlePopupNavigation);
                    contents.on?.('will-redirect', handlePopupNavigation);
                    contents.on?.('did-navigate', (_event, url) => inspectUrl(url));
                    contents.on?.('did-navigate-in-page', (_event, url) => inspectUrl(url));
                } catch {}
            };

            win.on('resize', resizeAuthView);
            win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
            win.webContents.on('will-navigate', (event, url) => {
                if (!String(url || '').startsWith('file://')) event.preventDefault();
            });
            win.webContents.once('did-finish-load', () => {
                shellReady = true;
                revealWhenReady();
            });
            authContents.setWindowOpenHandler(popupDecision);
            authContents.on('did-create-window', securePopup);
            authContents.on('will-navigate', handleNavigation);
            authContents.on('will-redirect', handleNavigation);
            authContents.on('did-navigate', (_event, url) => inspectUrl(url));
            authContents.on('did-navigate-in-page', (_event, url) => inspectUrl(url));
            authContents.once('dom-ready', () => {
                authReady = true;
                revealWhenReady();
            });
            win.on('closed', () => { void settle(() => reject(new GogAuthError('GOG_LOGIN_CANCELLED', 'GOG login was cancelled.'))); });

            win.loadFile(this.shellPath).catch((err) => {
                void settle(() => reject(new GogAuthError('GOG_AUTH_FAILED', redactGogSecrets(err?.message || 'Could not open the Baddel GOG sign-in window.'))));
            });
            authContents.loadURL(this.authUrl).catch((err) => {
                void settle(() => reject(new GogAuthError('GOG_AUTH_FAILED', redactGogSecrets(err?.message || 'Could not open GOG login.'))));
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
    isGogAuthCallback,
    isSafeExternalAuthUrl,
    readCredentials,
    readCredentialsFromRuntimeResult,
    mergeProfileCredentials,
    resolveGogAuthShellPath,
};
