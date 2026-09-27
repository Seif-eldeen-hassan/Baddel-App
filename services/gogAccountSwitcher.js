'use strict';

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');
const { launchResolvedLauncher } = require('./launcherOpenService');

const execFileAsync = util.promisify(execFile);
const PROFILE_ID_RE = /^[0-9a-f]{32}$/;
const MAX_PROFILE_NAME = 64;
const GOG_ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function errorWithCode(message, code, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
}

function normalizeProfileName(value) {
    const name = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!name) throw errorWithCode('Enter a name for this GOG account.', 'GOG_PROFILE_NAME_REQUIRED');
    if (name.length > MAX_PROFILE_NAME) throw errorWithCode(`GOG account names must be ${MAX_PROFILE_NAME} characters or fewer.`, 'GOG_PROFILE_NAME_TOO_LONG');
    if (/[\u0000-\u001f\u007f<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) {
        throw errorWithCode('That GOG account name contains unsupported characters.', 'GOG_PROFILE_NAME_INVALID');
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
        throw errorWithCode('Choose a different GOG account name.', 'GOG_PROFILE_NAME_INVALID');
    }
    return name;
}

function isProfileId(value) { return PROFILE_ID_RE.test(String(value || '')); }

function normalizeGogAccountId(value, { required = false } = {}) {
    const id = String(value ?? '').normalize('NFKC').trim();
    if (!id && !required) return null;
    if (!id || !GOG_ACCOUNT_ID_RE.test(id)) {
        throw errorWithCode('Invalid GOG account ID.', 'GOG_ACCOUNT_ID_INVALID');
    }
    return id;
}

async function atomicWriteJson(filePath, value, deps = {}) {
    const fsApi = deps.fs || fs;
    const randomId = deps.randomId || (() => crypto.randomUUID().replace(/-/g, ''));
    await fsApi.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${randomId()}.tmp`;
    try {
        await fsApi.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await fsApi.rename(temp, filePath);
    } finally {
        await fsApi.unlink(temp).catch(() => {});
    }
}

class GogAccountSwitcher {
    constructor(options = {}) {
        this.fs = options.fs || fs;
        this.fsSync = options.fsSync || fsSync;
        this.root = options.root || path.join(options.userDataPath || os.tmpdir(), 'accounts', 'gog');
        this.launcherPathResolver = options.launcherPathResolver || require('./launcherPathResolver');
        this.accountShortcuts = options.accountShortcuts || require('./accountShortcuts');
        this.analytics = options.analytics || require('../analytics');
        this.execFileAsync = options.execFileAsync || execFileAsync;
        this.launchExecutable = options.launchExecutable;
        this.launchResolvedLauncher = options.launchResolvedLauncher || launchResolvedLauncher;
        this.log = options.log || console;
        this.isLauncherFile = options.isLauncherFile;
        this.helperPath = options.helperPath || null;
        this.now = options.now || (() => new Date());
        this.randomId = options.randomId || (() => crypto.randomUUID().replace(/-/g, ''));
        this.helperRunner = options.helperRunner || (request => this._runHelper(request));
        this.busy = false;
    }

    paths() {
        return {
            profiles: path.join(this.root, 'profiles'),
            rollbacks: path.join(this.root, 'rollbacks'),
            operations: path.join(this.root, 'operations'),
            results: path.join(this.root, 'results'),
            temp: path.join(this.root, 'temp'),
            metadata: path.join(this.root, 'profiles.json'),
            active: path.join(this.root, 'active.json'),
            pending: path.join(this.root, 'pending.json'),
        };
    }

    async _ensureRoot() {
        const p = this.paths();
        await Promise.all([p.profiles, p.rollbacks, p.operations, p.results, p.temp].map(dir => this.fs.mkdir(dir, { recursive: true })));
    }

    async _readJson(filePath, fallback = null) {
        try { return JSON.parse(await this.fs.readFile(filePath, 'utf8')); }
        catch { return fallback; }
    }

    async _writeJson(filePath, value) {
        return atomicWriteJson(filePath, value, { fs: this.fs, randomId: this.randomId });
    }

    async _removeFile(filePath) { await this.fs.unlink(filePath).catch(() => {}); }

    async _withMutex(action) {
        if (this.busy) throw errorWithCode('Another GOG account operation is already running.', 'GOG_OPERATION_IN_PROGRESS');
        this.busy = true;
        try { return await action(); }
        finally { this.busy = false; }
    }

    _resolveHelperPath() {
        if (this.helperPath) return this.helperPath;
        if (process.resourcesPath && process.resourcesPath !== path.dirname(process.execPath)) {
            const packaged = path.join(process.resourcesPath, 'gog-account-switcher-helper.ps1');
            if (this.fsSync.existsSync(packaged)) return packaged;
        }
        return path.join(__dirname, '..', 'resources', 'gog-account-switcher-helper.ps1');
    }

    async _runHelper({ operation, operationId, request }) {
        if (!['BeginAdd', 'CaptureProfile', 'CancelAdd', 'SwitchProfile'].includes(operation) || !isProfileId(operationId)) {
            throw errorWithCode('Invalid GOG helper operation.', 'GOG_HELPER_REQUEST_INVALID');
        }
        await this._ensureRoot();
        const p = this.paths();
        const requestPath = path.join(p.operations, `${operationId}.json`);
        const resultPath = path.join(p.results, `${operationId}.json`);
        const diagnosticPath = path.join(this.root, 'last-helper-diagnostic.json');
        const helperPath = this._resolveHelperPath();
        await this._writeJson(requestPath, { version: 1, operation, operationId, ...request });
        await this._removeFile(resultPath);
        const rootB64 = Buffer.from(this.root, 'utf16le').toString('base64');
        const startedAt = this.now().toISOString();
        try {
            await this.execFileAsync('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath,
                '-Operation', operation, '-OperationId', operationId, '-DataRootB64', rootB64,
            ], { timeout: 240000, windowsHide: true, maxBuffer: 1024 * 1024 });
        } catch (error) {
            const result = await this._readJson(resultPath, null);
            await this._writeJson(diagnosticPath, {
                version: 1,
                operation,
                operationId,
                startedAt,
                finishedAt: this.now().toISOString(),
                helperPath,
                helperExists: this.fsSync.existsSync(helperPath),
                processError: {
                    code: error?.code ?? null,
                    errno: error?.errno ?? null,
                    syscall: error?.syscall ?? null,
                    killed: error?.killed === true,
                    signal: error?.signal ?? null,
                    exitCode: error?.exitCode ?? error?.status ?? null,
                    message: String(error?.message || 'PowerShell helper failed').slice(0, 2000),
                    stderr: String(error?.stderr || '').slice(0, 4000),
                },
                helperResult: result && typeof result === 'object' ? result : null,
            }).catch(() => {});
            if (result?.code) throw errorWithCode(result.message || 'The GOG operation failed.', result.code, { rollbackSucceeded: result.rollbackSucceeded });
            const code = error?.killed ? 'GOG_HELPER_TIMEOUT' : 'GOG_HELPER_FAILED';
            throw errorWithCode('The GOG account helper could not complete.', code, { diagnosticPath });
        } finally {
            await this._removeFile(requestPath);
        }
        const result = await this._readJson(resultPath, null);
        await this._removeFile(resultPath);
        if (!result?.success) throw errorWithCode(result?.message || 'The GOG operation failed.', result?.code || 'GOG_HELPER_FAILED', { rollbackSucceeded: result?.rollbackSucceeded });
        return result;
    }

    async _launcherSpec() {
        let timer;
        let spec;
        try {
            spec = await Promise.race([
                this.launcherPathResolver.getLauncherLaunchSpec('gog'),
                new Promise((_, reject) => { timer = setTimeout(() => reject(errorWithCode(
                    'GOG Galaxy detection timed out. Locate GalaxyClient.exe manually.', 'LAUNCHER_NOT_FOUND'
                )), 40000); }),
            ]);
        } finally { clearTimeout(timer); }
        if (!spec?.exePath || !this.fsSync.existsSync(spec.exePath)) {
            throw errorWithCode('GOG Galaxy could not be found. Install it or locate GalaxyClient.exe.', 'LAUNCHER_NOT_FOUND');
        }
        if (spec.source !== 'manual' && typeof this.launcherPathResolver.saveManualLauncherPath === 'function') {
            await this.launcherPathResolver.saveManualLauncherPath('gog', spec.exePath).catch(error => {
                this.log.warn?.('[GOG_OPEN] Could not persist detected launcher path:', error?.message || String(error));
            });
        }
        return spec;
    }

    async _openGalaxy(spec = null) {
        const launch = spec || await this._launcherSpec();
        return this.launchResolvedLauncher('gog', launch, {
            launchExecutable: this.launchExecutable,
            ...(this.isLauncherFile ? { exists: this.isLauncherFile } : {}),
            log: this.log,
        });
    }

    async _metadata() {
        const data = await this._readJson(this.paths().metadata, { version: 1, profiles: [] });
        const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
        return { version: 1, profiles: profiles.filter(item => isProfileId(item?.id) && typeof item?.displayName === 'string') };
    }

    _verifiedIdentity(result) {
        if (result?.identityNamespace !== 'gog-user-id') return null;
        return normalizeGogAccountId(result?.platformAccountId);
    }

    async _linkProfileInMetadata(metadata, profileId, platformAccountId) {
        if (!isProfileId(profileId)) throw errorWithCode('Invalid GOG profile.', 'GOG_PROFILE_ID_INVALID');
        const accountId = normalizeGogAccountId(platformAccountId, { required: true });
        const profile = metadata.profiles.find(item => item.id === profileId);
        if (!profile) throw errorWithCode('That saved GOG profile no longer exists.', 'GOG_PROFILE_NOT_FOUND');
        const conflict = metadata.profiles.find(item => item.id !== profileId && normalizeGogAccountId(item.platformAccountId) === accountId);
        if (conflict) {
                throw errorWithCode('Account already linked to another switcher profile.', 'GOG_ACCOUNT_ALREADY_LINKED', { conflictProfileId: conflict.id });
        }
        const existingId = normalizeGogAccountId(profile.platformAccountId);
        if (existingId && existingId !== accountId) {
            throw errorWithCode('This switcher profile is linked to a different GOG account.', 'GOG_PROFILE_LINK_CONFLICT');
        }
        if (existingId === accountId) return { profile, changed: false };
        profile.platformAccountId = accountId;
        profile.linkedAt = this.now().toISOString();
        await this._writeJson(this.paths().metadata, metadata);
        return { profile, changed: true };
    }

    async linkProfileAccount(profileId, platformAccountId) {
        return this._withMutex(async () => {
            const metadata = await this._metadata();
            const result = await this._linkProfileInMetadata(metadata, profileId, platformAccountId);
            return { status: 'success', profileId, platformAccountId: result.profile.platformAccountId, changed: result.changed };
        });
    }

    // Reconciliation is deliberately ID-only. It never creates profile folders and
    // never uses display names; it is safe to call after every successful GOG sync.
    async reconcilePlatformAccountId(platformAccountId) {
        const accountId = normalizeGogAccountId(platformAccountId, { required: true });
        const profiles = await this.getProfiles();
        const matches = profiles.filter(profile => normalizeGogAccountId(profile.platformAccountId) === accountId);
        if (matches.length > 1) throw errorWithCode('This GOG account is linked to multiple switcher profiles.', 'GOG_ACCOUNT_LINK_CONFLICT');
        return { status: 'success', linked: matches.length === 1, profileId: matches[0]?.id || null, platformAccountId: accountId };
    }

    async getProfiles() {
        await this._ensureRoot();
        const [metadata, active] = await Promise.all([this._metadata(), this._readJson(this.paths().active, null)]);
        const profiles = [];
        for (const item of metadata.profiles) {
            const manifest = path.join(this.paths().profiles, item.id, 'manifest.json');
            if (!this.fsSync.existsSync(manifest)) continue;
            profiles.push({
                id: item.id,
                displayName: item.displayName,
                createdAt: item.createdAt || null,
                lastUsedAt: item.lastUsedAt || null,
                platformAccountId: item.platformAccountId || null,
                isActive: active?.profileId === item.id,
            });
        }
        return profiles;
    }

    async getAddState() {
        await this._ensureRoot();
        const pending = await this._readJson(this.paths().pending, null);
        if (!pending || !isProfileId(pending.rollbackId)) return { pending: false };
        return { pending: true, startedAt: pending.startedAt || null, previousActiveProfileId: isProfileId(pending.previousActiveProfileId) ? pending.previousActiveProfileId : null, expectedPlatformAccountId: normalizeGogAccountId(pending.expectedPlatformAccountId) };
    }

    async addNewAccount(expectedPlatformAccountId = null) {
        return this._withMutex(async () => {
            const expectedId = normalizeGogAccountId(expectedPlatformAccountId);
            const launcher = await this._launcherSpec();
            if (expectedId) {
                const metadata = await this._metadata();
                const linked = metadata.profiles.find(profile => normalizeGogAccountId(profile.platformAccountId) === expectedId);
                if (linked) throw errorWithCode('Account already linked to another switcher profile.', 'GOG_ACCOUNT_ALREADY_LINKED', { conflictProfileId: linked.id });
            }
            const pending = await this.getAddState();
            if (pending.pending) throw errorWithCode('A GOG account is already waiting to be saved or cancelled.', 'GOG_ADD_ALREADY_PENDING');
            const active = await this._readJson(this.paths().active, null);
            const operationId = this.randomId();
            const rollbackId = this.randomId();
            await this.helperRunner({ operation: 'BeginAdd', operationId, request: { rollbackId, previousActiveProfileId: isProfileId(active?.profileId) ? active.profileId : null, startedAt: this.now().toISOString(), expectedPlatformAccountId: expectedId } });
            const open = await this._openGalaxy(launcher);
            this.analytics.logAccountAddStarted?.('gog').catch?.(() => {});
            return { status: 'success', pending: true, targeted: Boolean(expectedId), ...open };
        });
    }

    async saveCurrentAccount(rawName) {
        return this._withMutex(async () => {
            const displayName = normalizeProfileName(rawName);
            const pending = await this.getAddState();
            const metadata = await this._metadata();
            if (metadata.profiles.some(item => item.displayName.localeCompare(displayName, undefined, { sensitivity: 'accent' }) === 0)) {
                throw errorWithCode('A saved GOG account already uses that name.', 'GOG_PROFILE_NAME_DUPLICATE');
            }
            const profileId = this.randomId();
            const capture = await this.helperRunner({ operation: 'CaptureProfile', operationId: this.randomId(), request: { profileId } });
            const actualId = this._verifiedIdentity(capture);
            const expectedId = normalizeGogAccountId(pending.expectedPlatformAccountId);
            if (expectedId && actualId !== expectedId) {
                await this.fs.rm(path.join(this.paths().profiles, profileId), { recursive: true, force: true }).catch(() => {});
                throw errorWithCode('GOG account mismatch: the signed-in account is not the selected synced account.', 'GOG_ACCOUNT_MISMATCH', { expectedPlatformAccountId: expectedId, actualPlatformAccountId: actualId });
            }
            if (actualId) {
                const conflict = metadata.profiles.find(item => normalizeGogAccountId(item.platformAccountId) === actualId);
                if (conflict) {
                    await this.fs.rm(path.join(this.paths().profiles, profileId), { recursive: true, force: true }).catch(() => {});
                    throw errorWithCode('Account already linked to another switcher profile.', 'GOG_ACCOUNT_ALREADY_LINKED', { conflictProfileId: conflict.id });
                }
            }
            const timestamp = this.now().toISOString();
            metadata.profiles.push({ id: profileId, displayName, createdAt: timestamp, lastUsedAt: timestamp, platformAccountId: actualId, ...(actualId ? { linkedAt: timestamp } : {}) });
            await this._writeJson(this.paths().metadata, metadata);
            await this._writeJson(this.paths().active, { version: 1, profileId, updatedAt: timestamp });
            await this._removeFile(this.paths().pending);
            this.analytics.logAccountAdded?.('gog').catch?.(() => {});
            return { status: 'success', profile: { id: profileId, displayName, createdAt: timestamp, lastUsedAt: timestamp, platformAccountId: actualId, isActive: true } };
        });
    }

    async cancelAdd() {
        return this._withMutex(async () => {
            const pendingRaw = await this._readJson(this.paths().pending, null);
            if (!pendingRaw || !isProfileId(pendingRaw.rollbackId)) throw errorWithCode('There is no pending GOG account to cancel.', 'GOG_ADD_NOT_PENDING');
            const launcher = await this._launcherSpec();
            await this.helperRunner({ operation: 'CancelAdd', operationId: this.randomId(), request: { rollbackId: pendingRaw.rollbackId } });
            if (isProfileId(pendingRaw.previousActiveProfileId)) {
                await this._writeJson(this.paths().active, { version: 1, profileId: pendingRaw.previousActiveProfileId, updatedAt: this.now().toISOString() });
            } else await this._removeFile(this.paths().active);
            await this._removeFile(this.paths().pending);
            await this._openGalaxy(launcher);
            return { status: 'success', restored: true };
        });
    }

    async switchAccount(profileId) {
        return this._withMutex(async () => {
            if (!isProfileId(profileId)) throw errorWithCode('Invalid GOG profile.', 'GOG_PROFILE_ID_INVALID');
            const launcher = await this._launcherSpec();
            const metadata = await this._metadata();
            const profile = metadata.profiles.find(item => item.id === profileId);
            if (!profile) throw errorWithCode('That saved GOG profile no longer exists.', 'GOG_PROFILE_NOT_FOUND');
            const active = await this._readJson(this.paths().active, null);
            if (active?.profileId === profileId) {
                await this._openGalaxy(launcher);
                return { status: 'success', profileId, alreadyActive: true };
            }
            const result = await this.helperRunner({ operation: 'SwitchProfile', operationId: this.randomId(), request: { profileId, rollbackId: this.randomId() } });
            const timestamp = this.now().toISOString();
            profile.lastUsedAt = timestamp;
            const verifiedId = this._verifiedIdentity(result);
            if (verifiedId && !profile.platformAccountId) await this._linkProfileInMetadata(metadata, profileId, verifiedId);
            else await this._writeJson(this.paths().metadata, metadata);
            await this._writeJson(this.paths().active, { version: 1, profileId, updatedAt: timestamp });
            await this._openGalaxy(launcher);
            this.analytics.logAccountSwitched?.('gog').catch?.(() => {});
            return { status: 'success', profileId, rollbackSucceeded: result.rollbackSucceeded };
        });
    }

    async renameProfile(profileId, rawName) {
        return this._withMutex(async () => {
            if (!isProfileId(profileId)) throw errorWithCode('Invalid GOG profile.', 'GOG_PROFILE_ID_INVALID');
            const displayName = normalizeProfileName(rawName);
            const metadata = await this._metadata();
            const profile = metadata.profiles.find(item => item.id === profileId);
            if (!profile) throw errorWithCode('That saved GOG profile no longer exists.', 'GOG_PROFILE_NOT_FOUND');
            if (metadata.profiles.some(item => item.id !== profileId && item.displayName.localeCompare(displayName, undefined, { sensitivity: 'accent' }) === 0)) {
                throw errorWithCode('A saved GOG account already uses that name.', 'GOG_PROFILE_NAME_DUPLICATE');
            }
            profile.displayName = displayName;
            await this._writeJson(this.paths().metadata, metadata);
            await this.accountShortcuts.renameAccount?.('gog', profileId, displayName);
            return { status: 'success', profileId, displayName };
        });
    }

    async deleteProfile(profileId) {
        return this._withMutex(async () => {
            if (!isProfileId(profileId)) throw errorWithCode('Invalid GOG profile.', 'GOG_PROFILE_ID_INVALID');
            const metadata = await this._metadata();
            const profile = metadata.profiles.find(item => item.id === profileId);
            if (!profile) throw errorWithCode('That saved GOG profile no longer exists.', 'GOG_PROFILE_NOT_FOUND');
            await this.fs.rm(path.join(this.paths().profiles, profileId), { recursive: true, force: true });
            metadata.profiles = metadata.profiles.filter(item => item.id !== profileId);
            await this._writeJson(this.paths().metadata, metadata);
            const active = await this._readJson(this.paths().active, null);
            if (active?.profileId === profileId) await this._removeFile(this.paths().active);
            await this.accountShortcuts.clearShortcut?.({ platform: 'gog', accountId: profileId });
            this.analytics.logAccountDeleted?.('gog').catch?.(() => {});
            return { status: 'success', profileId, displayName: profile.displayName };
        });
    }
}

let defaultInstance = null;
function getDefaultGogAccountSwitcher() {
    if (!defaultInstance) {
        let app = null;
        try { app = require('electron').app; } catch {}
        const userDataPath = app?.getPath?.('userData') || process.env.BADDEL_TEST_USER_DATA || path.join(os.tmpdir(), 'BaddelLauncher-userData');
        defaultInstance = new GogAccountSwitcher({ userDataPath });
    }
    return defaultInstance;
}

module.exports = { GogAccountSwitcher, getDefaultGogAccountSwitcher, normalizeProfileName, normalizeGogAccountId, isProfileId, atomicWriteJson, PROFILE_ID_RE, GOG_ACCOUNT_ID_RE };
