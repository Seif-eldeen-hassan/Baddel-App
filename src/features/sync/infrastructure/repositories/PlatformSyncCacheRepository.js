'use strict';

const defaultFs = require('fs').promises;
const defaultFsSync = require('fs');
const defaultPath = require('path');
const { performance } = require('perf_hooks');
const { AtomicJsonFileStore } = require('../runtime/AtomicJsonFileStore');
const { sanitizeMergedLibraryArtwork } = require('../../../games/infrastructure/services/ManagedArtworkPersistence');

function isGogAmazonPrimeEntitlement(game) {
    const values = [
        game?.title,
        game?.name,
        game?.originalTitle,
        game?.originalName,
        game?.info?.title,
        game?.info?.name,
    ];

    return values.some((value) => /\bamazon\s+prime\b/i.test(String(value || '')));
}

function _epicVaultKeyPart(value) {
    return String(value || '').trim().toLowerCase();
}

function _epicVaultTitle(value) {
    return _epicVaultKeyPart(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function _epicArtworkCandidateUrl(item) {
    const url = typeof item === 'string' ? item : (item?.url || item?.href || item?.src);
    const clean = String(url || '').trim();
    return /^https?:\/\//i.test(clean) ? clean : '';
}

function _normalizeEpicArtworkCandidates(items = []) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : [items]) {
        const url = _epicArtworkCandidateUrl(item);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(typeof item === 'string' ? { url, source: 'vault' } : { ...item, url, source: item?.source || 'vault' });
    }
    return out;
}

function _epicStableArtworkKeys(entry = {}) {
    const keys = new Set();
    const namespace = _epicVaultKeyPart(entry.namespace || entry.sandboxId || entry.epicMetadata?.namespace || entry.allIds?.epic);
    const catalogItemId = _epicVaultKeyPart(entry.catalogItemId || entry.catalog_item_id || entry.catalogId);
    const appName = _epicVaultKeyPart(entry.appName || entry.app_name || entry.launcherGameId);
    const offerId = _epicVaultKeyPart(entry.offerId || entry.catalogOfferId || entry.offer_id);
    const productId = _epicVaultKeyPart(entry.productId || entry.productSlug || entry.slug);
    if (namespace && catalogItemId) keys.add(`ns:${namespace}:catalog:${catalogItemId}`);
    if (namespace && appName) keys.add(`ns:${namespace}:app:${appName}`);
    if (namespace && offerId) keys.add(`ns:${namespace}:offer:${offerId}`);
    if (namespace) keys.add(`ns:${namespace}`);
    if (catalogItemId) keys.add(`catalog:${catalogItemId}`);
    if (appName) keys.add(`app:${appName}`);
    if (offerId) keys.add(`offer:${offerId}`);
    if (productId) keys.add(`product:${productId}`);
    return [...keys];
}

function _epicVaultCanonicalGameKey(entry = {}) {
    if (!entry || typeof entry !== 'object') return '';
    const namespace = _epicVaultKeyPart(entry.namespace || entry.sandboxId || entry.epicMetadata?.namespace);
    const catalogItemId = _epicVaultKeyPart(entry.catalogItemId || entry.catalog_item_id || entry.catalogId);
    const appName = _epicVaultKeyPart(entry.appName || entry.app_name);
    const productSlug = _epicVaultKeyPart(entry.productSlug || entry.slug);
    const title = _epicVaultTitle(entry.title || entry.name || entry.description);
    const offerId = _epicVaultKeyPart(entry.offerId || entry.catalogOfferId || entry.offer_id);
    if (namespace && catalogItemId) return `epic:ns:${namespace}:catalog:${catalogItemId}`;
    if (namespace && appName) return `epic:ns:${namespace}:app:${appName}`;
    if (namespace && productSlug) return `epic:ns:${namespace}:slug:${productSlug}`;
    if (catalogItemId) return `epic:catalog:${catalogItemId}`;
    if (namespace && title) return `epic:ns:${namespace}:title:${title}`;
    if (appName) return `epic:app:${appName}`;
    if (productSlug) return `epic:slug:${productSlug}`;
    if (title && !/\b(dlc|add on|add-on|pack|bundle|edition|soundtrack|demo|beta|test)\b/i.test(title)) return `epic:title:${title}`;
    return offerId ? `epic:offer:${offerId}` : '';
}

function _dedupeEpicVaultGames(games = []) {
    const byKey = new Map();
    const unique = [];
    for (const game of Array.isArray(games) ? games : []) {
        if (!game) continue;
        const key = _epicVaultCanonicalGameKey(game) || `epic:row:${unique.length}`;
        const withKey = { ...game, vaultCanonicalKey: game.vaultCanonicalKey || key };
        if (!byKey.has(key)) {
            byKey.set(key, unique.length);
            unique.push(withKey);
            continue;
        }
        const existing = unique[byKey.get(key)];
        unique[byKey.get(key)] = {
            ...existing,
            ...withKey,
            id: existing.id || withKey.id,
            title: existing.title || withKey.title,
            coverUrl: existing.coverUrl || withKey.coverUrl || null,
            coverCandidates: Array.from(new Map([...(existing.coverCandidates || []), ...(withKey.coverCandidates || [])].map((item) => [typeof item === 'string' ? item : item?.url, item])).values()).filter(Boolean),
            appName: existing.appName || withKey.appName || null,
            namespace: existing.namespace || withKey.namespace || null,
            catalogItemId: existing.catalogItemId || withKey.catalogItemId || null,
            offerId: existing.offerId || withKey.offerId || null,
            livePrice: existing.livePrice || withKey.livePrice || null,
            priceStatus: existing.priceStatus || withKey.priceStatus || 'unresolved',
            duplicateOfferIds: [...new Set([...(existing.duplicateOfferIds || []), existing.offerId, withKey.offerId].filter(Boolean).map(String))],
            vaultCanonicalKey: key,
        };
    }
    return unique;
}

function sanitizeEpicVaultCache(vault = {}) {
    const safeVault = vault && typeof vault === 'object' ? vault : { accounts: [], generatedAt: null };
    const accounts = Array.isArray(safeVault.accounts) ? safeVault.accounts.map((account) => ({
        ...account,
        games: _dedupeEpicVaultGames(account?.games),
    })) : [];
    return { ...safeVault, accounts };
}

function _buildEpicVaultArtworkIndex(vault = {}) {
    const index = new Map();
    const add = (entry, source = 'vault') => {
        if (!entry || typeof entry !== 'object') return;
        const candidates = _normalizeEpicArtworkCandidates([
            ...(Array.isArray(entry.coverCandidates) ? entry.coverCandidates : []),
            entry.coverUrl,
            entry.image,
            entry.defaultImage,
            entry.cover,
        ]).map(candidate => ({ ...candidate, source: candidate.source || source }));
        if (!candidates.length) return;
        for (const key of _epicStableArtworkKeys(entry)) {
            const current = index.get(key) || [];
            const merged = _normalizeEpicArtworkCandidates([...current, ...candidates]);
            index.set(key, merged);
        }
    };
    for (const account of Array.isArray(vault.accounts) ? vault.accounts : []) {
        for (const bucket of ['games', 'livePrices', 'purchaseGames', 'purchaseHistoryItems', 'paidItems']) {
            for (const entry of Array.isArray(account?.[bucket]) ? account[bucket] : []) add(entry, `vault_${bucket}`);
        }
    }
    return index;
}

function _mergeEpicVaultArtworkIntoLibrary(games = [], vault = {}) {
    const index = _buildEpicVaultArtworkIndex(vault);
    if (!index.size) return { games, changed: 0 };
    let changed = 0;
    const enriched = (Array.isArray(games) ? games : []).map((game) => {
        const keys = _epicStableArtworkKeys(game);
        const candidates = [];
        for (const key of keys) {
            for (const candidate of index.get(key) || []) candidates.push(candidate);
        }
        const merged = _normalizeEpicArtworkCandidates([...(Array.isArray(game.coverCandidates) ? game.coverCandidates : []), ...candidates]);
        if (!merged.length) return game;
        const nextCover = game.coverUrl || game.image || game.defaultImage || merged[0].url;
        const sameCandidates = JSON.stringify(game.coverCandidates || []) === JSON.stringify(merged);
        if (sameCandidates && (game.coverUrl || game.image || game.defaultImage)) return game;
        changed += 1;
        return {
            ...game,
            coverUrl: game.coverUrl || nextCover,
            image: game.image || nextCover,
            defaultImage: game.defaultImage || nextCover,
            coverCandidates: merged,
            artworkSource: game.artworkSource || 'epic_vault_artwork_index',
        };
    });
    return { games: enriched, changed };
}

function mergedLibrarySignature(games) {
    return JSON.stringify(Array.isArray(games) ? games : []);
}

class PlatformSyncCacheRepository {
    constructor({ userDataDir, fs = defaultFs, fsSync = defaultFsSync, path = defaultPath } = {}) {
        if (!userDataDir) {
            throw new Error('PlatformSyncCacheRepository requires userDataDir');
        }

        this.fs = fs;
        this.fsSync = fsSync;
        this.path = path;
        this.userDataDir = userDataDir;
        this.syncCacheDir = path.join(userDataDir, 'platform-sync');
        this.syncLogsDir = path.join(this.syncCacheDir, 'logs');
        this.atomicJson = new AtomicJsonFileStore({ fs, path });
        this._lastKnownGood = new Map();
        this._revisions = new Map();
        this._authoritativeEmpty = new Set();
        this._lastWriteDiagnostics = new Map();
        this._epicVaultAccountQueues = new Map();

        this.epicAccountsFile = path.join(this.syncCacheDir, 'epic_accounts.json');
        this.epicMergedCacheFile = path.join(this.syncCacheDir, 'epic_library_merged.json');
        this.epicClassificationReportFile = path.join(this.syncCacheDir, 'epic_sync_classification_report.json');
        this.epicVaultFile = path.join(this.syncCacheDir, 'epic_vault.json');

        this.steamAccountsFile = path.join(this.syncCacheDir, 'steam_accounts.json');
        this.steamMergedCacheFile = path.join(this.syncCacheDir, 'steam_library_merged.json');

        this.gogAccountsFile = path.join(this.syncCacheDir, 'gog_accounts.json');
        this.gogMergedCacheFile = path.join(this.syncCacheDir, 'gog_library_merged.json');
        this.gogBasicIndexFile = path.join(this.syncCacheDir, 'gog_basic_index.json');
    }

    async ensureDirs() {
        await this.fs.mkdir(this.syncCacheDir, { recursive: true });
        await this.fs.mkdir(this.syncLogsDir, { recursive: true });
    }

    async _readJson(filePath, fallback) {
        try {
            return JSON.parse(await this.fs.readFile(filePath, 'utf8'));
        } catch (err) {
            if (err?.code !== 'ENOENT') {
                console.warn(`[PlatformSyncCache] Failed to read ${this.path.basename(filePath)}: ${err.message}`);
            }
            return fallback;
        }
    }

    _readJsonSync(filePath, fallback) {
        try {
            if (!this.fsSync.existsSync(filePath)) return fallback;
            return JSON.parse(this.fsSync.readFileSync(filePath, 'utf8'));
        } catch {
            return fallback;
        }
    }

    async _writeJson(filePath, value) {
        await this._writeJsonAtomic(filePath, value);
    }

    async _writeJsonAtomic(filePath, value) {
        await this.ensureDirs();
        return this.atomicJson.writeJson(filePath, value);
    }

    async writeJsonFileAtomic(filePath, value) {
        return this._writeJsonAtomic(filePath, value);
    }

    _platformForMergedFile(filePath) {
        const resolved = this.path.resolve(filePath);
        if (resolved === this.path.resolve(this.steamMergedCacheFile)) return 'steam';
        if (resolved === this.path.resolve(this.epicMergedCacheFile)) return 'epic';
        if (resolved === this.path.resolve(this.gogMergedCacheFile)) return 'gog';
        return null;
    }

    _sanitizeMergedLibrary(platform, value) {
        const library = Array.isArray(value) ? value : [];
        const filtered = platform === 'gog' ? library.filter((game) => !isGogAmazonPrimeEntitlement(game)) : library;
        return sanitizeMergedLibraryArtwork(filtered, { userDataDir: this.userDataDir, path: this.path }).games;
    }

    async migrateManagedArtworkUrlsFromMergedLibraries(platforms = ['steam', 'epic', 'gog']) {
        const summary = { platforms: {}, changed: false };
        for (const platform of platforms) {
            const filePath = this.getMergedCacheFile(platform);
            let parsed;
            try {
                parsed = JSON.parse(await this.fs.readFile(filePath, 'utf8'));
            } catch (err) {
                if (err?.code !== 'ENOENT') {
                    summary.platforms[platform] = { skipped: true, error: err.message };
                } else {
                    summary.platforms[platform] = { skipped: true, missing: true };
                }
                continue;
            }
            const base = platform === 'gog' ? (Array.isArray(parsed) ? parsed.filter((game) => !isGogAmazonPrimeEntitlement(game)) : []) : parsed;
            const migration = sanitizeMergedLibraryArtwork(base, { userDataDir: this.userDataDir, path: this.path });
            summary.platforms[platform] = migration.summary;
            if (migration.changed || base !== parsed) {
                await this._writeJsonAtomic(filePath, migration.games);
                const revision = this._revision(platform) + 1;
                this._revisions.set(platform, revision);
                this._lastKnownGood.set(platform, { games: migration.games, revision });
                summary.changed = true;
            }
        }
        return summary;
    }

    _isPlatformLinkedSync(platform) {
        try {
            if (platform === 'steam') return this.isSteamLinked();
            if (platform === 'epic') return this.isEpicLinked();
            if (platform === 'gog') return this.isGogLinked();
        } catch {}
        return false;
    }

    _revision(platform) {
        return Number(this._revisions.get(platform) || 0);
    }

    async readMergedLibrarySnapshot(platform) {
        const filePath = this.getMergedCacheFile(platform);
        try {
            const raw = await this.fs.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            let games = this._sanitizeMergedLibrary(platform, parsed);
            if (platform === 'epic') {
                const vault = await this.readEpicVault();
                games = _mergeEpicVaultArtworkIntoLibrary(games, vault).games;
            }
            const revision = this._revision(platform);
            this._lastKnownGood.set(platform, { games, revision });
            this._authoritativeEmpty.delete(platform);
            return { status: 'success', platform, games, revision, stale: false, authoritativeEmpty: games.length === 0 };
        } catch (err) {
            const linked = this._isPlatformLinkedSync(platform);
            const last = this._lastKnownGood.get(platform);
            if (err?.code === 'ENOENT') {
                if (!linked || this._authoritativeEmpty.has(platform)) {
                    const games = [];
                    const revision = this._revision(platform);
                    this._lastKnownGood.set(platform, { games, revision });
                    return { status: 'success', platform, games, revision, stale: false, authoritativeEmpty: true };
                }
                if (last) {
                    console.warn(`[PlatformSyncCache] Missing ${platform} cache while linked; using last-known-good snapshot.`);
                    return { status: 'success', platform, games: last.games, revision: last.revision, stale: true, authoritativeEmpty: false };
                }
                console.warn(`[PlatformSyncCache] Missing ${platform} cache while linked and no last-known-good snapshot is available.`);
                return { status: 'success', platform, games: [], revision: this._revision(platform), stale: true, authoritativeEmpty: false };
            }
            console.warn(`[PlatformSyncCache] Failed to read ${platform} merged cache: ${err.message}`);
            if (last) {
                return { status: 'success', platform, games: last.games, revision: last.revision, stale: true, authoritativeEmpty: false };
            }
            return { status: 'success', platform, games: [], revision: this._revision(platform), stale: true, authoritativeEmpty: false };
        }
    }

    async _writeMergedLibrarySnapshot(platform, library) {
        const totalStart = performance.now();
        const sanitizeStart = performance.now();
        const games = this._sanitizeMergedLibrary(platform, library);
        const sanitizeMs = performance.now() - sanitizeStart;
        const signatureStart = performance.now();
        const nextSignature = mergedLibrarySignature(games);
        const signatureMs = performance.now() - signatureStart;
        const previous = this._lastKnownGood.get(platform);
        const previousSignature = previous ? mergedLibrarySignature(previous.games) : null;
        let diskSignature = null;
        let diskReadMs = 0;
        if (previous && previousSignature === nextSignature) {
            const diskReadStart = performance.now();
            try {
                const raw = await this.fs.readFile(this.getMergedCacheFile(platform), "utf8");
                diskSignature = mergedLibrarySignature(JSON.parse(raw));
            } catch {}
            diskReadMs = performance.now() - diskReadStart;
        }
        if (previous && previousSignature === nextSignature && diskSignature === nextSignature) {
            const revision = this._revision(platform);
            this._lastWriteDiagnostics.set(platform, {
                changed: false,
                skipped: true,
                reason: "no-op",
                sanitizeMs,
                signatureMs,
                diskReadMs,
                totalMs: performance.now() - totalStart,
                games: games.length,
                bytes: Buffer.byteLength(nextSignature, "utf8"),
            });
            this._lastKnownGood.set(platform, { games, revision });
            if (games.length === 0) this._authoritativeEmpty.add(platform);
            else this._authoritativeEmpty.delete(platform);
            return { status: "success", platform, games, revision, stale: false, authoritativeEmpty: games.length === 0, changed: false, writeDiagnostics: this._lastWriteDiagnostics.get(platform) };
        }
        const writeStart = performance.now();
        const writeTimings = await this._writeJsonAtomic(this.getMergedCacheFile(platform), games);
        const writeMs = performance.now() - writeStart;
        const revision = this._revision(platform) + 1;
        this._revisions.set(platform, revision);
        this._lastKnownGood.set(platform, { games, revision });
        if (games.length === 0) this._authoritativeEmpty.add(platform);
        else this._authoritativeEmpty.delete(platform);
        this._lastWriteDiagnostics.set(platform, {
            changed: true,
            skipped: false,
            sanitizeMs,
            signatureMs,
            writeMs,
            atomic: writeTimings || null,
            totalMs: performance.now() - totalStart,
            games: games.length,
            bytes: Buffer.byteLength(nextSignature, "utf8"),
        });
        return { status: "success", platform, games, revision, stale: false, authoritativeEmpty: games.length === 0, changed: true, writeDiagnostics: this._lastWriteDiagnostics.get(platform) };
    }

    async _deleteMergedLibrarySnapshot(platform) {
        try { await this.fs.unlink(this.getMergedCacheFile(platform)); } catch {}
        const revision = this._revision(platform) + 1;
        const games = [];
        this._revisions.set(platform, revision);
        this._lastKnownGood.set(platform, { games, revision });
        this._authoritativeEmpty.add(platform);
        return { status: 'success', platform, games, revision, stale: false, authoritativeEmpty: true };
    }

    async readSteamAccounts() {
        const accounts = await this._readJson(this.steamAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    readSteamAccountsSync() {
        const accounts = this._readJsonSync(this.steamAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    isSteamLinked() {
        return this.readSteamAccountsSync().length > 0;
    }

    async writeSteamAccounts(accounts) {
        await this._writeJson(this.steamAccountsFile, accounts);
    }

    async writeSteamAccountsAtomic(accounts) {
        await this._writeJsonAtomic(this.steamAccountsFile, accounts);
    }

    async readSteamMergedLibrary() {
        return (await this.readMergedLibrarySnapshot('steam')).games;
    }

    async writeSteamMergedLibrary(library) {
        return this._writeMergedLibrarySnapshot('steam', library);
    }

    async deleteSteamMergedLibrary() {
        await this._deleteMergedLibrarySnapshot('steam');
    }

    async readEpicAccounts() {
        const accounts = await this._readJson(this.epicAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    readEpicAccountsSync() {
        const accounts = this._readJsonSync(this.epicAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    isEpicLinked() {
        return this.readEpicAccountsSync().length > 0;
    }

    async writeEpicAccounts(accounts) {
        await this._writeJson(this.epicAccountsFile, accounts);
    }

    async readEpicMergedLibrary() {
        return (await this.readMergedLibrarySnapshot('epic')).games;
    }

    async writeEpicMergedLibrary(library) {
        return this._writeMergedLibrarySnapshot('epic', library);
    }

    async deleteEpicMergedLibrary() {
        await this._deleteMergedLibrarySnapshot('epic');
    }

    async readEpicVault() {
        const data = await this._readJson(this.epicVaultFile, { accounts: [], generatedAt: null });
        return sanitizeEpicVaultCache(data);
    }

    async writeEpicVault(vault) {
        const safeVault = sanitizeEpicVaultCache(vault);
        await this._writeJson(this.epicVaultFile, {
            ...safeVault,
            generatedAt: safeVault.generatedAt || new Date().toISOString(),
        });
    }

    async _withEpicVaultAccountLock(accountId, task) {
        const id = String(accountId || '');
        const previous = this._epicVaultAccountQueues.get(id) || Promise.resolve();
        const current = previous.catch(() => {}).then(task);
        this._epicVaultAccountQueues.set(id, current.catch(() => {}));
        try {
            return await current;
        } finally {
            if (this._epicVaultAccountQueues.get(id) === current) this._epicVaultAccountQueues.delete(id);
        }
    }

    async _mergeEpicVaultAccountUnlocked(accountVault, assertCurrent = null) {
        const current = await this.readEpicVault();
        const accounts = Array.isArray(current.accounts) ? current.accounts.slice() : [];
        const safeAccountVault = { ...(accountVault || {}), games: _dedupeEpicVaultGames(accountVault?.games) };
        const accountId = String(safeAccountVault?.accountId || '');
        if (!accountId) return current;
        const idx = accounts.findIndex((account) => String(account.accountId) === accountId);
        if (idx >= 0) {
            accounts[idx] = {
                ...accounts[idx],
                ...safeAccountVault,
                permissions: { ...(accounts[idx].permissions || {}), ...(safeAccountVault.permissions || {}) },
                updatedAt: new Date().toISOString(),
            };
        } else {
            accounts.push({ ...safeAccountVault, updatedAt: new Date().toISOString() });
        }
        await assertCurrent?.();
        const next = { ...current, accounts, generatedAt: new Date().toISOString() };
        await this.writeEpicVault(next);
        return next;
    }

    async mergeEpicVaultAccount(accountVault, options = {}) {
        const accountId = String(accountVault?.accountId || '');
        return this._withEpicVaultAccountLock(accountId, () =>
            this._mergeEpicVaultAccountUnlocked(accountVault, options.assertCurrent));
    }

    async mergeEpicVaultAccountPhase({ accountId, phase, patch = {}, assertCurrent = null }) {
        const id = String(accountId || '');
        if (!id) throw new Error('Epic Vault phase commit requires an account ID.');
        const fieldsByPhase = {
            prices: [
                'displayName', 'pricingCountry', 'currency', 'totalGamesOwned', 'games',
                'livePrices', 'currentValueMinor', 'currentValueByCurrency',
                'priceCoverage', 'priceDiagnostics', 'pricesFetchedAt', 'permissions',
                'libraryRevision', 'libraryDiagnostics',
            ],
            purchaseHistory: [
                'displayName', 'currency', 'primaryCurrency', 'multipleCurrencies', 'region',
                'grossPurchasesMinor', 'refundsMinor', 'netSpentMinor', 'actualSpentMinor',
                'paidItemsCount', 'freeItemsCount', 'ordersCount', 'purchaseGames',
                'paidItems', 'fabItems', 'refunds', 'purchaseHistoryItems', 'purchaseHistory',
                'gameSpendMinor', 'fabSpendMinor', 'freeClaimsCount', 'cancelledOrdersCount',
                'duplicateOrdersDropped', 'grossPurchasesByCurrency', 'refundsByCurrency',
                'netSpentByCurrency', 'gameSpendByCurrency', 'fabSpendByCurrency', 'spendDiagnostics',
                'purchaseHistoryFetchedAt', 'historyError', 'permissions',
                'libraryRevision', 'libraryDiagnostics',
            ],
            library: ['displayName', 'totalGamesOwned', 'games', 'pricingCountry', 'libraryRevision', 'libraryDiagnostics'],
        };
        const allowed = fieldsByPhase[phase];
        if (!allowed) throw new Error('Unsupported Epic Vault phase commit.');
        return this._withEpicVaultAccountLock(id, async () => {
            const vault = await this.readEpicVault();
            const accounts = Array.isArray(vault.accounts) ? vault.accounts.slice() : [];
            const index = accounts.findIndex((account) => String(account.accountId) === id);
            const previous = index >= 0 ? accounts[index] : { accountId: id };
            const phasePatch = { accountId: id };
            for (const field of allowed) {
                if (Object.prototype.hasOwnProperty.call(patch, field)) phasePatch[field] = patch[field];
            }
            if (phase === 'prices' && Array.isArray(phasePatch.games)) {
                phasePatch.games = _dedupeEpicVaultGames(phasePatch.games);
            }
            if (phasePatch.permissions) {
                phasePatch.permissions = { ...(previous.permissions || {}), ...phasePatch.permissions };
            }
            await assertCurrent?.();
            const committedRevision = Number(previous.vaultRevision || 0) + 1;
            const merged = {
                ...previous,
                ...phasePatch,
                vaultRevision: committedRevision,
                phaseRevisions: { ...(previous.phaseRevisions || {}), [phase]: committedRevision },
                updatedAt: new Date().toISOString(),
            };
            if (index >= 0) accounts[index] = merged;
            else accounts.push(merged);
            const nextVault = { ...vault, accounts, generatedAt: new Date().toISOString() };
            await this.writeEpicVault(nextVault);
            return merged;
        });
    }


    async removeEpicVaultAccount(accountId) {
        const targetId = String(accountId || '');
        if (!targetId) return this.readEpicVault();
        const current = await this.readEpicVault();
        const accounts = Array.isArray(current.accounts)
            ? current.accounts.filter((account) => String(account?.accountId || '') !== targetId)
            : [];
        const next = { ...current, accounts, generatedAt: new Date().toISOString() };
        await this.writeEpicVault(next);
        return next;
    }

    async deleteEpicVault() {
        try { await this.fs.unlink(this.epicVaultFile); } catch {}
    }

    async writeEpicAccountsAtomic(accounts) {
        await this._writeJsonAtomic(this.epicAccountsFile, accounts);
    }

    async readGogAccounts() {
        const accounts = await this._readJson(this.gogAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    readGogAccountsSync() {
        const accounts = this._readJsonSync(this.gogAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    isGogLinked() {
        return this.readGogAccountsSync().length > 0;
    }

    async writeGogAccounts(accounts) {
        await this._writeJson(this.gogAccountsFile, accounts);
    }

    async writeGogAccountsAtomic(accounts) {
        await this._writeJsonAtomic(this.gogAccountsFile, accounts);
    }

    async readGogMergedLibrary() {
        return (await this.readMergedLibrarySnapshot('gog')).games;
    }

    async writeGogMergedLibrary(library) {
        return this._writeMergedLibrarySnapshot('gog', library);
    }

    async readGogBasicIndex() {
        const index = await this._readJson(this.gogBasicIndexFile, {});
        return index && typeof index === 'object' && !Array.isArray(index) ? index : {};
    }

    async writeGogBasicIndex(index) {
        await this._writeJsonAtomic(this.gogBasicIndexFile, index || {});
    }

    async deleteGogMergedLibrary() {
        await this._deleteMergedLibrarySnapshot('gog');
    }

    async readEpicClassificationReport() {
        return this._readJson(this.epicClassificationReportFile, null);
    }

    async writeEpicClassificationReport(report) {
        await this.fs.writeFile(this.epicClassificationReportFile, JSON.stringify(report, null, 2), 'utf8');
    }

    getMergedCacheFile(platform) {
        switch (platform) {
            case 'steam': return this.steamMergedCacheFile;
            case 'epic': return this.epicMergedCacheFile;
            case 'gog': return this.gogMergedCacheFile;
            default: throw new Error(`Unsupported platform cache: ${platform}`);
        }
    }

    async readMergedLibrary(platform) {
        switch (platform) {
            case 'steam': return this.readSteamMergedLibrary();
            case 'epic': return this.readEpicMergedLibrary();
            case 'gog': return this.readGogMergedLibrary();
            default: throw new Error(`Unsupported platform library: ${platform}`);
        }
    }

    async writeMergedLibrary(platform, library) {
        switch (platform) {
            case 'steam':
                return this.writeSteamMergedLibrary(library);
            case 'epic':
                return this.writeEpicMergedLibrary(library);
            case 'gog':
                return this.writeGogMergedLibrary(library);
            default:
                throw new Error(`Unsupported platform library: ${platform}`);
        }
    }
}

module.exports = {
    PlatformSyncCacheRepository,
    isGogAmazonPrimeEntitlement,
};
