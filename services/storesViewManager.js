'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROVIDERS = Object.freeze({
    steam: {
        label: 'Steam',
        home: 'https://store.steampowered.com/',
        hosts: ['store.steampowered.com', 'login.steampowered.com', 'steamcommunity.com', 'checkout.steampowered.com'],
    },
    epic: {
        label: 'Epic Games',
        home: 'https://store.epicgames.com/',
        hosts: ['store.epicgames.com', 'www.epicgames.com', 'accounts.epicgames.com'],
    },
    gog: {
        label: 'GOG',
        home: 'https://www.gog.com/',
        hosts: ['www.gog.com', 'gog.com', 'login.gog.com', 'auth.gog.com'],
    },
});

function normalizeProvider(value) {
    const provider = String(value || '').toLowerCase();
    return Object.hasOwn(PROVIDERS, provider) ? provider : null;
}

function isPrivateHostname(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
    const match = host.match(/^172\.(\d{1,3})\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function classifyStoreUrl(providerValue, rawUrl) {
    const provider = normalizeProvider(providerValue);
    if (!provider) return { allowed: false, reason: 'provider' };
    let parsed;
    try { parsed = new URL(String(rawUrl || '')); } catch { return { allowed: false, reason: 'invalid' }; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) {
        return { allowed: false, reason: 'protocol-or-network' };
    }
    const hostname = parsed.hostname.toLowerCase();
    const allowed = PROVIDERS[provider].hosts.includes(hostname);
    return { allowed, external: !allowed, reason: allowed ? null : 'domain', url: parsed.toString(), origin: parsed.origin };
}

function safePartition(provider, accountIdentity) {
    const scope = String(accountIdentity || 'guest');
    const digest = crypto.createHash('sha256').update(provider + '\0' + scope).digest('hex').slice(0, 24);
    return `persist:baddel-store-${provider}-${digest}`;
}

function validateBounds(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const values = ['x', 'y', 'width', 'height'].map(key => Number(source[key]));
    if (!values.every(Number.isFinite)) return null;
    const [x, y, width, height] = values.map(Math.round);
    if (x < 0 || y < 0 || width < 1 || height < 1 || width > 10000 || height > 10000) return null;
    return { x, y, width, height };
}

class StoresViewManager {
    constructor({ electron, mainWindow, userDataPath, resolveActiveAccount, shell, log = console, loadTimeoutMs = 45000 }) {
        this.electron = electron;
        this.mainWindow = mainWindow;
        this.resolveActiveAccount = resolveActiveAccount || (async () => null);
        this.shell = shell;
        this.log = log;
        this.statePath = path.join(userDataPath, 'stores-state.json');
        this.state = this._readState();
        this.view = null;
        this.popups = new Set();
        this.provider = null;
        this.scopeKey = null;
        this.generation = 0;
        this.bounds = null;
        this.visible = false;
        this.loadTimeoutMs = Math.max(1000, Number(loadTimeoutMs) || 45000);
        this.loadTimer = null;
    }

    _clearLoadTimer() {
        if (this.loadTimer) clearTimeout(this.loadTimer);
        this.loadTimer = null;
    }

    _armLoadTimer(view, generation) {
        this._clearLoadTimer();
        this.loadTimer = setTimeout(() => {
            if (this.view !== view || this.generation !== generation || !view.webContents.isLoading()) return;
            view.webContents.stop();
            this._emit('timeout');
        }, this.loadTimeoutMs);
    }

    _readState() {
        try {
            const value = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            return { selectedProvider: normalizeProvider(value.selectedProvider) || 'steam', lastUrls: value.lastUrls || {} };
        } catch { return { selectedProvider: 'steam', lastUrls: {} }; }
    }

    _saveState() {
        const temp = this.statePath + '.tmp';
        try {
            fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), 'utf8');
            fs.renameSync(temp, this.statePath);
        } catch (error) {
            try { fs.rmSync(temp, { force: true }); } catch {}
            this.log.warn('[Stores] state persistence failed:', error?.message);
        }
    }

    _emit(error = null) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        const wc = this.view?.webContents;
        const rawUrl = wc && !wc.isDestroyed() ? wc.getURL() : PROVIDERS[this.provider || this.state.selectedProvider].home;
        const checked = classifyStoreUrl(this.provider || this.state.selectedProvider, rawUrl);
        this.mainWindow.webContents.send('stores:navigation-state', {
            provider: this.provider || this.state.selectedProvider,
            url: checked.allowed ? checked.url : PROVIDERS[this.provider || this.state.selectedProvider].home,
            origin: checked.allowed ? checked.origin : new URL(PROVIDERS[this.provider || this.state.selectedProvider].home).origin,
            canGoBack: Boolean(wc && !wc.isDestroyed() && wc.navigationHistory.canGoBack()),
            canGoForward: Boolean(wc && !wc.isDestroyed() && wc.navigationHistory.canGoForward()),
            isLoading: Boolean(wc && !wc.isDestroyed() && wc.isLoading()),
            title: String(wc && !wc.isDestroyed() ? wc.getTitle() : '').slice(0, 160),
            error,
            generation: this.generation,
        });
    }

    async open(providerValue, { visible = true } = {}) {
        const provider = normalizeProvider(providerValue || this.state.selectedProvider);
        if (!provider) throw Object.assign(new Error('Unsupported store provider.'), { code: 'STORES_PROVIDER_INVALID' });
        const accountIdentity = await this.resolveActiveAccount(provider);
        const scopeKey = safePartition(provider, accountIdentity);
        this.state.selectedProvider = provider;
        this._saveState();
        if (!this.view || this.provider !== provider || this.scopeKey !== scopeKey) {
            this._destroyView();
            this._createView(provider, scopeKey);
        }
        this.visible = visible === true;
        this.view.setVisible(this.visible);
        if (this.bounds && this.visible) this.view.setBounds(this.bounds);
        const last = this.state.lastUrls[scopeKey];
        const target = classifyStoreUrl(provider, last).allowed ? last : PROVIDERS[provider].home;
        if (!this.view.webContents.getURL()) {
            const view = this.view;
            const generation = this.generation;
            this._armLoadTimer(view, generation);
            Promise.resolve(view.webContents.loadURL(target)).catch(() => {
                if (this.view === view && this.generation === generation) {
                    this._clearLoadTimer();
                    this._emit('load_failed');
                }
            });
        }
        this._emit();
        return { provider, home: PROVIDERS[provider].home, generation: this.generation };
    }

    _createView(provider, scopeKey) {
        const { WebContentsView, session, BrowserWindow } = this.electron;
        const ses = session.fromPartition(scopeKey, { cache: true });
        ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        ses.setPermissionCheckHandler(() => false);
        const view = new WebContentsView({
            webPreferences: {
                session: ses,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                allowRunningInsecureContent: false,
                devTools: false,
            },
        });
        this.provider = provider;
        this.scopeKey = scopeKey;
        this.view = view;
        this.generation += 1;
        const generation = this.generation;
        this.mainWindow.contentView.addChildView(view);
        view.setVisible(false);
        const wc = view.webContents;
        const current = () => this.view === view && generation === this.generation;

        wc.setWindowOpenHandler(({ url }) => {
            const checked = classifyStoreUrl(provider, url);
            if (!checked.allowed) {
                if (checked.external) this.shell.openExternal(checked.url).catch(() => {});
                return { action: 'deny' };
            }
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    parent: this.mainWindow,
                    modal: false,
                    show: true,
                    autoHideMenuBar: true,
                    webPreferences: {
                        session: ses,
                        nodeIntegration: false,
                        contextIsolation: true,
                        sandbox: true,
                        webSecurity: true,
                        devTools: false,
                    },
                },
            };
        });
        wc.on('did-create-window', popup => {
            this.popups.add(popup);
            popup.on('closed', () => this.popups.delete(popup));
        });
        wc.on('will-navigate', (event, url) => {
            const checked = classifyStoreUrl(provider, url);
            if (!checked.allowed) {
                event.preventDefault();
                if (checked.external) this.shell.openExternal(checked.url).catch(() => {});
            }
        });
        wc.on('will-redirect', (event, url) => {
            if (!classifyStoreUrl(provider, url).allowed) event.preventDefault();
        });
        this.downloadSession = ses;
        this.downloadListener = event => event.preventDefault();
        ses.on('will-download', this.downloadListener);
        wc.on('did-start-loading', () => { if (current()) this._armLoadTimer(view, generation); });
        wc.on('did-stop-loading', () => { if (current()) this._clearLoadTimer(); });
        for (const eventName of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
            wc.on(eventName, () => {
                if (!current()) return;
                const checked = classifyStoreUrl(provider, wc.getURL());
                if (checked.allowed) {
                    this.state.lastUrls[scopeKey] = checked.url;
                    this._saveState();
                }
                this._emit();
            });
        }
        wc.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
            if (!current() || !isMainFrame || code === -3) return;
            this._clearLoadTimer();
            this._emit(code === -106 ? 'offline' : code === -105 ? 'dns' : 'load_failed');
        });
        wc.on('render-process-gone', () => { if (current()) this._emit('renderer_failed'); });
    }

    command(name) {
        const wc = this.view?.webContents;
        if (!wc || wc.isDestroyed()) return false;
        const history = wc.navigationHistory;
        if (name === 'back' && history.canGoBack()) history.goBack();
        else if (name === 'forward' && history.canGoForward()) history.goForward();
        else if (name === 'reload') wc.reload();
        else if (name === 'stop') wc.stop();
        else if (name === 'home') wc.loadURL(PROVIDERS[this.provider].home);
        else return false;
        return true;
    }

    openExternal() {
        const checked = classifyStoreUrl(this.provider, this.view?.webContents?.getURL());
        if (!checked.allowed) return false;
        this.shell.openExternal(checked.url).catch(() => {});
        return true;
    }

    copyCurrentUrl(expected) {
        const request = expected && typeof expected === 'object' ? expected : {};
        const checked = classifyStoreUrl(this.provider, this.view?.webContents?.getURL());
        const sameContext = normalizeProvider(request.provider) === this.provider
            && Number(request.generation) === this.generation
            && String(request.url || '') === checked.url;
        if (!checked.allowed || !sameContext) {
            return { ok: false, error: 'stale_or_invalid_url' };
        }
        return { ok: true, provider: this.provider, generation: this.generation, url: checked.url };
    }

    setBounds(raw) {
        const bounds = validateBounds(raw);
        if (!bounds) throw Object.assign(new Error('Invalid store view bounds.'), { code: 'STORES_BOUNDS_INVALID' });
        this.bounds = bounds;
        if (this.view && this.visible) this.view.setBounds(bounds);
        return bounds;
    }

    setVisible(value) {
        this.visible = value === true;
        if (this.view) this.view.setVisible(this.visible);
        return this.visible;
    }

    async accountChanged(platform) {
        if (normalizeProvider(platform) !== this.provider) return;
        await this.open(this.provider, { visible: this.visible });
    }

    _destroyView() {
        this._clearLoadTimer();
        if (this.downloadSession && this.downloadListener) this.downloadSession.removeListener('will-download', this.downloadListener);
        this.downloadSession = null;
        this.downloadListener = null;
        for (const popup of this.popups) { try { popup.destroy(); } catch {} }
        this.popups.clear();
        if (!this.view) return;
        try { this.mainWindow.contentView.removeChildView(this.view); } catch {}
        try { this.view.webContents.close(); } catch {}
        this.view = null;
    }

    destroy() {
        this.visible = false;
        this._destroyView();
    }
}

module.exports = { StoresViewManager, PROVIDERS, normalizeProvider, classifyStoreUrl, safePartition, validateBounds };
