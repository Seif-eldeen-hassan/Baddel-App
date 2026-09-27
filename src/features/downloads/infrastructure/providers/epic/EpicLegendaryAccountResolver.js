'use strict';

const fs = require('fs');
const path = require('path');
const { makeDownloadError } = require('../../services/DownloadPreflightService');

function clean(value) {
    const text = String(value || '').trim();
    return text || null;
}

function same(a, b) {
    return Boolean(clean(a) && clean(b) && clean(a) === clean(b));
}

function titleKey(value) {
    return String(value || '').toLowerCase().replace(/[\u00ae\u00a9\u2122]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function epicTuple(game = {}) {
    const encoded = clean(game.launcherGameId);
    if (encoded) {
        const parts = encoded.split(encoded.includes('%3A') ? /%3A/i : ':').map(part => {
            try { return decodeURIComponent(part); } catch { return part; }
        });
        if (parts.length === 3) return { namespace: clean(parts[0]), catalogItemId: clean(parts[1]), appName: clean(parts[2]) };
    }
    return {
        namespace: clean(game.namespace),
        catalogItemId: clean(game.catalogItemId),
        appName: clean(game.appName || game.providerAppName || game?.allIds?.epic),
    };
}

function findEpicLibraryGame(library = [], wanted = {}) {
    const games = Array.isArray(library) ? library : [];
    const target = epicTuple(wanted);
    if (target.catalogItemId) {
        const match = games.find(game => {
            const tuple = epicTuple(game);
            return same(tuple.catalogItemId, target.catalogItemId)
                && (!target.namespace || !tuple.namespace || same(tuple.namespace, target.namespace));
        });
        if (match) return match;
    }
    if (target.appName) {
        const match = games.find(game => {
            const tuple = epicTuple(game);
            return same(tuple.appName, target.appName)
                && (!target.catalogItemId || !tuple.catalogItemId || same(tuple.catalogItemId, target.catalogItemId))
                && (!target.namespace || !tuple.namespace || same(tuple.namespace, target.namespace));
        });
        if (match) return match;
    }

    const wantedTitle = titleKey(wanted.title || wanted.name);
    if (!wantedTitle) return null;
    return games.find(game => {
        const candidate = epicTuple(game);
        const stableConflict = ['appName', 'catalogItemId', 'namespace'].some(field => target[field] && candidate[field] && !same(target[field], candidate[field]));
        return !stableConflict && titleKey(game.title || game.name) === wantedTitle;
    }) || null;
}

function configDirectory(userDataDir, accountId) {
    if (!/^[a-z0-9_-]+$/i.test(String(accountId)) || /^(ghost|tmp|temp)-/i.test(String(accountId))) {
        throw makeDownloadError('EPIC_ACCOUNT_ID_INVALID', 'Choose a canonical synced Epic account.');
    }
    return path.join(userDataDir, `legendary-config-${String(accountId)}`);
}

function hasUsableAuth(userDataDir, accountId, fsSync = fs) {
    try {
        const userFile = path.join(configDirectory(userDataDir, accountId), 'user.json');
        const parsed = JSON.parse(fsSync.readFileSync(userFile, 'utf8'));
        const storedId = clean(parsed.account_id || parsed.accountId || parsed.account?.id);
        const isLive = (token, expiry) => {
            if (!clean(token)) return false;
            if (!expiry) return true;
            const expiresAt = Date.parse(expiry);
            return Number.isFinite(expiresAt) && expiresAt > Date.now();
        };
        const hasCredential = isLive(parsed.refresh_token, parsed.refresh_expires_at) || isLive(parsed.access_token, parsed.expires_at);
        return hasCredential && storedId === String(accountId);
    } catch {
        return false;
    }
}

function requiresReauth(account) {
    return account.needsReauth === true || ['missing', 'expired', 'invalid'].includes(account.credentialStatus) || ['needs_reauth', 'expired'].includes(account.status);
}

class EpicLegendaryAccountResolver {
    constructor({ userDataDir, epicConnector, fsSync = fs } = {}) {
        this.userDataDir = userDataDir;
        this.epicConnector = epicConnector;
        this.fs = fsSync;
    }

    async getContext(game) {
        const accounts = this.epicConnector?.getAccounts?.() || [];
        const library = await this.epicConnector?.getCachedLibrary?.() || [];
        return { accounts, library, libraryGame: findEpicLibraryGame(library, game) };
    }

    async resolveOptions(game) {
        const { accounts, libraryGame } = await this.getContext(game);
        const owners = new Set((libraryGame?.ownedByAccountIds || []).map(String));
        return accounts.filter(account => /^[a-z0-9_-]+$/i.test(String(account?.id || '')) && !/^(ghost|tmp|temp)-/i.test(String(account.id))).map(account => {
            const accountId = String(account.id);
            const needsReauth = requiresReauth(account) || !hasUsableAuth(this.userDataDir, accountId, this.fs);
            const ownsGame = owners.has(accountId);
            return {
                id: accountId,
                displayName: clean(account.displayName || account.name) || `Epic ${accountId.slice(-6)}`,
                ownsGame,
                needsReauth,
                enabled: ownsGame && !needsReauth,
                actionStatus: needsReauth ? 'reconnect' : (ownsGame ? 'ready' : 'does_not_own'),
            };
        });
    }

    async validateTask(task = {}) {
        const accountId = clean(task.accountId);
        if (!accountId || !/^[a-z0-9_-]+$/i.test(accountId) || /^(ghost|tmp|temp)-/i.test(accountId)) throw makeDownloadError('EPIC_ACCOUNT_ID_INVALID', 'Choose a synced Epic account before installing.');
        const { accounts, libraryGame } = await this.getContext(task);
        const account = accounts.find(item => String(item?.id || '') === accountId);
        if (!account) throw makeDownloadError('EPIC_ACCOUNT_NOT_LINKED', 'The selected Epic account is no longer linked.');
        if (requiresReauth(account) || !hasUsableAuth(this.userDataDir, accountId, this.fs)) {
            throw makeDownloadError('EPIC_AUTH_REQUIRED', `Reconnect ${clean(account.displayName) || 'this Epic account'} to continue.`);
        }
        if (!libraryGame) throw makeDownloadError('EPIC_LIBRARY_IDENTITY_MISSING', 'Sync this Epic account so Baddel can refresh the game identity.');
        if (!(libraryGame.ownedByAccountIds || []).map(String).includes(accountId)) {
            throw makeDownloadError('EPIC_GAME_NOT_OWNED', 'The selected Epic account does not own this game.');
        }
        const tuple = epicTuple(libraryGame);
        if (!tuple.appName) throw makeDownloadError('EPIC_APP_NAME_UNRESOLVED', 'This game is missing its Epic app name. Sync Epic again and retry.');
        return {
            account: { id: accountId, displayName: clean(account.displayName || account.name) },
            game: libraryGame,
            ...tuple,
            ownedByAccountIds: [...new Set((libraryGame.ownedByAccountIds || []).map(String))],
            configPath: configDirectory(this.userDataDir, accountId),
            provenancePatch: {
                accountId,
                providerAppName: tuple.appName,
                appName: tuple.appName,
                namespace: tuple.namespace,
                catalogItemId: tuple.catalogItemId,
                ownedByAccountIds: [...new Set((libraryGame.ownedByAccountIds || []).map(String))],
                ownershipVerified: true,
            },
        };
    }

    async reconcileMaintenanceTask(task = {}) {
        const resolved = await this.validateTask(task);
        return { task: { ...task, ...resolved.provenancePatch }, resolved };
    }

    async resolveForQueue(payload = {}) {
        const resolved = await this.validateTask(payload);
        return {
            ...payload,
            platform: 'epic',
            installProvider: 'legendary',
            accountId: resolved.account.id,
            accountDisplayName: resolved.account.displayName,
            providerAppName: resolved.appName,
            appName: resolved.appName,
            namespace: resolved.namespace,
            catalogItemId: resolved.catalogItemId,
            ownedByAccountIds: resolved.ownedByAccountIds,
            ownershipVerified: true,
        };
    }
}

module.exports = {
    EpicLegendaryAccountResolver,
    configDirectory,
    epicTuple,
    findEpicLibraryGame,
    hasUsableAuth,
};
