(function attachVaultOverviewModel(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.VaultOverviewModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createVaultOverviewModel() {
    'use strict';

    const VALID_PRICE_STATUSES = new Set(['priced', 'free']);
    const ACTIVE_PHASE_STATUSES = new Set(['pending', 'running']);

    function normalizeVaultAccountId(value) {
        return String(value || '').trim().toLowerCase();
    }

    function normalizeCurrency(value) {
        const currency = String(value || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(currency) && currency !== 'MULTI' ? currency : null;
    }

    function canonicalEpicGameKey(game = {}, index = 0) {
        const direct = String(game.canonicalGameId || game.vaultCanonicalKey || '').trim().toLowerCase();
        if (direct) return direct;
        const namespace = String(game.namespace || game.sandboxId || game.epicMetadata?.namespace || '').trim().toLowerCase();
        const catalogItemId = String(game.catalogItemId || game.catalog_item_id || game.catalogId || '').trim().toLowerCase();
        const appName = String(game.appName || game.app_name || '').trim().toLowerCase();
        if (namespace && catalogItemId) return `epic:ns:${namespace}:catalog:${catalogItemId}`;
        if (namespace && appName) return `epic:ns:${namespace}:app:${appName}`;
        if (catalogItemId) return `epic:catalog:${catalogItemId}`;
        if (appName) return `epic:app:${appName}`;
        const id = String(game.id || game.gameId || '').trim().toLowerCase();
        return id ? `epic:id:${id}` : `epic:unidentified:${index}`;
    }

    function dedupeEpicGames(games = []) {
        const byKey = new Map();
        (Array.isArray(games) ? games : []).forEach((game, index) => {
            if (!game || typeof game !== 'object') return;
            const key = canonicalEpicGameKey(game, index);
            const previous = byKey.get(key);
            const previousResolved = VALID_PRICE_STATUSES.has(previous?.priceStatus || previous?.livePrice?.priceStatus);
            const incomingResolved = VALID_PRICE_STATUSES.has(game.priceStatus || game.livePrice?.priceStatus);
            if (!previous || (!previousResolved && incomingResolved)) byKey.set(key, game);
        });
        return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, game]) => game);
    }

    function accountRank(account = {}) {
        const revision = Number(account.vaultRevision || 0);
        const games = Array.isArray(account.games) ? account.games.length : 0;
        const enrichment = Number(account.permissions?.currentPrices === true) + Number(account.permissions?.purchaseHistory === true);
        return [revision, games, enrichment, String(account.updatedAt || '')];
    }

    function compareRank(left, right) {
        for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
            if (left[index] === right[index]) continue;
            return left[index] > right[index] ? 1 : -1;
        }
        return 0;
    }

    function normalizeEpicAccounts(accounts = []) {
        const byId = new Map();
        for (const account of Array.isArray(accounts) ? accounts : []) {
            const accountId = normalizeVaultAccountId(account?.accountId || account?.id);
            if (!accountId) continue;
            const candidate = { ...account, accountId, games: dedupeEpicGames(account.games) };
            const previous = byId.get(accountId);
            if (!previous || compareRank(accountRank(candidate), accountRank(previous)) > 0) byId.set(accountId, candidate);
        }
        return [...byId.values()].sort((left, right) => left.accountId.localeCompare(right.accountId));
    }

    function addMinorUnitsToCurrencyBucket(buckets, currency, minorUnits, resolved, total = 1) {
        const code = normalizeCurrency(currency);
        if (!code) return false;
        if (!buckets[code]) buckets[code] = { minorUnits: 0, resolvedItems: 0, totalItems: 0, status: 'unavailable' };
        const bucket = buckets[code];
        bucket.totalItems += Math.max(0, Number(total) || 0);
        if (resolved) {
            bucket.resolvedItems += Math.max(0, Number(total) || 0);
            bucket.minorUnits += Number.isSafeInteger(minorUnits) ? minorUnits : Math.trunc(Number(minorUnits) || 0);
        }
        bucket.status = bucket.totalItems > 0 && bucket.resolvedItems === bucket.totalItems
            ? 'complete'
            : (bucket.resolvedItems > 0 ? 'partial' : 'unavailable');
        return true;
    }

    function progressForAccount(progressStates, accountId) {
        if (!progressStates || typeof progressStates !== 'object') return null;
        return progressStates[accountId]
            || Object.entries(progressStates).find(([key]) => normalizeVaultAccountId(key) === accountId)?.[1]
            || null;
    }

    function aggregateEpicPlatformSummary(accounts = [], progressStates = {}) {
        const normalizedAccounts = normalizeEpicAccounts(accounts);
        const libraryValueByCurrency = {};
        const realSpentByCurrency = {};
        let totalGames = 0;
        let resolvedPriceItems = 0;
        let totalPriceItems = 0;
        let unassignedPriceItems = 0;
        let historyResolvedAccounts = 0;
        let historyActiveAccounts = 0;
        let historyFailedAccounts = 0;
        let historyNotRequestedAccounts = 0;
        let pricesActive = false;
        let pricesFailed = false;
        let pricesRequested = false;
        const covers = [];

        for (const account of normalizedAccounts) {
            const progress = progressForAccount(progressStates, account.accountId);
            const games = account.games;
            totalGames += games.length;
            const fallbackCurrency = normalizeCurrency(account.primaryCurrency || account.currency || account.livePrices?.[0]?.currency);
            const priceStatus = progress?.phases?.prices?.status;
            pricesActive ||= ACTIVE_PHASE_STATUSES.has(priceStatus);
            pricesFailed ||= ['failed', 'partial'].includes(priceStatus);
            pricesRequested ||= account.permissions?.currentPrices === true || (priceStatus && priceStatus !== 'skipped');

            for (const game of games) {
                totalPriceItems += 1;
                const status = game.priceStatus || game.livePrice?.priceStatus;
                const resolved = VALID_PRICE_STATUSES.has(status);
                const amount = status === 'free' ? 0 : Number(game.livePrice?.amount);
                const safeResolved = resolved && Number.isSafeInteger(amount) && amount >= 0;
                if (safeResolved) resolvedPriceItems += 1;
                const currency = normalizeCurrency(game.livePrice?.currency) || fallbackCurrency;
                if (!addMinorUnitsToCurrencyBucket(libraryValueByCurrency, currency, safeResolved ? amount : 0, safeResolved)) {
                    unassignedPriceItems += 1;
                }
                const cover = game.coverUrl || game.image || game.defaultImage || game.coverCandidates?.[0]?.url;
                if (cover && covers.length < 4 && !covers.includes(cover)) covers.push(cover);
            }

            const historyStatus = progress?.phases?.purchaseHistory?.status;
            const historyImported = account.permissions?.purchaseHistory === true;
            if (ACTIVE_PHASE_STATUSES.has(historyStatus)) historyActiveAccounts += 1;
            if (['failed', 'partial', 'waiting_for_auth'].includes(historyStatus)) historyFailedAccounts += 1;
            if (!historyImported && ['skipped', undefined, null].includes(historyStatus)) historyNotRequestedAccounts += 1;
            if (!historyImported) continue;

            historyResolvedAccounts += 1;
            const storedBuckets = account.netSpentByCurrency && typeof account.netSpentByCurrency === 'object'
                ? Object.entries(account.netSpentByCurrency)
                : [];
            if (storedBuckets.length) {
                for (const [currency, minorUnits] of storedBuckets) {
                    addMinorUnitsToCurrencyBucket(realSpentByCurrency, currency, Number(minorUnits), true);
                }
            } else {
                const currency = normalizeCurrency(account.primaryCurrency || account.currency);
                const minorUnits = Number(account.netSpentMinor ?? account.actualSpentMinor);
                if (currency && Number.isSafeInteger(minorUnits)) {
                    addMinorUnitsToCurrencyBucket(realSpentByCurrency, currency, minorUnits, true);
                }
            }
        }

        let libraryValueStatus = 'not_requested';
        if (totalPriceItems > 0 && resolvedPriceItems === totalPriceItems) libraryValueStatus = 'complete';
        else if (resolvedPriceItems > 0) libraryValueStatus = 'partial';
        else if (pricesActive) libraryValueStatus = 'loading';
        else if (pricesFailed || pricesRequested) libraryValueStatus = 'unavailable';

        let realSpentStatus = 'not_requested';
        if (historyResolvedAccounts === normalizedAccounts.length && normalizedAccounts.length > 0 && !historyActiveAccounts && !historyFailedAccounts) realSpentStatus = 'complete';
        else if (historyResolvedAccounts > 0) realSpentStatus = 'partial';
        else if (historyActiveAccounts > 0) realSpentStatus = 'loading';
        else if (historyFailedAccounts > 0) realSpentStatus = 'unavailable';

        return {
            platform: 'epic',
            connected: normalizedAccounts.length > 0,
            accountCount: normalizedAccounts.length,
            totalGames,
            accounts: normalizedAccounts,
            covers,
            libraryValue: {
                buckets: libraryValueByCurrency,
                resolvedItems: resolvedPriceItems,
                totalItems: totalPriceItems,
                unassignedItems: unassignedPriceItems,
                status: libraryValueStatus,
            },
            realSpent: {
                buckets: realSpentByCurrency,
                resolvedItems: historyResolvedAccounts,
                totalItems: normalizedAccounts.length,
                status: realSpentStatus,
                activeAccounts: historyActiveAccounts,
                failedAccounts: historyFailedAccounts,
                notRequestedAccounts: historyNotRequestedAccounts,
            },
        };
    }

    function vaultSnapshotRevision(vault = {}) {
        return Math.max(0, ...(Array.isArray(vault.accounts) ? vault.accounts : []).flatMap((account) => [
            Number(account?.vaultRevision || 0),
            ...Object.values(account?.phaseRevisions || {}).map((value) => Number(value || 0)),
        ]));
    }

    function shouldAcceptVaultSnapshot({ incomingRevision = 0, acceptedRevision = 0, requiredRevision = 0 } = {}) {
        return Number(incomingRevision || 0) >= Math.max(Number(acceptedRevision || 0), Number(requiredRevision || 0));
    }

    function buildVaultOverviewModel({ epicVault = {}, epicProgressStates = {} } = {}) {
        const epic = aggregateEpicPlatformSummary(epicVault.accounts, epicProgressStates);
        const platforms = [
            epic,
            { platform: 'steam', connected: false, enabled: false, status: 'coming_soon' },
            { platform: 'valorant', connected: false, enabled: false, status: 'coming_soon' },
            { platform: 'league', connected: false, enabled: false, status: 'coming_soon' },
        ];
        return {
            revision: vaultSnapshotRevision(epicVault),
            generatedAt: epicVault.generatedAt || null,
            totalGames: epic.totalGames,
            accountCount: epic.accountCount,
            platformCount: epic.connected ? 1 : 0,
            libraryValue: epic.libraryValue,
            realSpent: epic.realSpent,
            platforms,
        };
    }

    function formatMinorUnits(minorUnits, currency, locale = 'en-US') {
        const code = normalizeCurrency(currency);
        if (!code) return '';
        const value = (Number.isSafeInteger(minorUnits) ? minorUnits : Math.trunc(Number(minorUnits) || 0)) / 100;
        try {
            return `${code} ${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        } catch {
            return `${code} ${value.toFixed(2)}`;
        }
    }

    function formatVaultCurrencyBuckets(summary = {}, locale = 'en-US') {
        return Object.entries(summary.buckets || {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([currency, bucket]) => ({
                currency,
                minorUnits: bucket.minorUnits,
                resolvedItems: bucket.resolvedItems,
                totalItems: bucket.totalItems,
                status: bucket.status,
                text: formatMinorUnits(bucket.minorUnits, currency, locale),
            }));
    }

    return {
        addMinorUnitsToCurrencyBucket,
        aggregateEpicPlatformSummary,
        buildVaultOverviewModel,
        canonicalEpicGameKey,
        dedupeEpicGames,
        formatMinorUnits,
        formatVaultCurrencyBuckets,
        normalizeEpicAccounts,
        normalizeVaultAccountId,
        shouldAcceptVaultSnapshot,
        vaultSnapshotRevision,
    };
}));
