(function attachVaultShowcaseModel(root, factory) {
    const overview = typeof module === 'object' && module.exports
        ? require('./vault-overview-model')
        : root?.VaultOverviewModel;
    const api = factory(overview || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.VaultShowcaseModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createVaultShowcaseModel(overview) {
    'use strict';

    const SCHEMA_VERSION = 1;
    const EXPORT_WIDTH = 1920;
    const TRUSTED_COVER_RE = /^(file:|app:|baddel-cache:|data:image\/(?:png|jpe?g|webp);base64,)/i;
    const SENSITIVE_KEY_RE = /(token|cookie|credential|authorization|password|secret|email|accountid|account_id|transaction|command|environment)/i;
    const DISPLAY_OPTION_KEYS = ['currentLibraryValue', 'totalPaid', 'totalRefunded', 'netSpend'];

    function normalizeDisplayOptions(input) {
        const defaults = Object.fromEntries(DISPLAY_OPTION_KEYS.map((key) => [key, true]));
        if (input == null) return defaults;
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || DISPLAY_OPTION_KEYS.some((key) => typeof input[key] !== 'boolean')) {
            const error = new Error('Vault showcase display options are invalid.');
            error.code = 'VAULT_EXPORT_SNAPSHOT_FAILED';
            throw error;
        }
        return Object.fromEntries(DISPLAY_OPTION_KEYS.map((key) => [key, input[key]]));
    }

    function currencyCode(value, fallback = 'USD') {
        const code = String(value || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(code) && code !== 'MULTI' ? code : fallback;
    }

    function formatMinorUnits(minorUnits, currency, locale = 'en-US') {
        if (typeof overview.formatMinorUnits === 'function') {
            return overview.formatMinorUnits(minorUnits, currencyCode(currency), locale);
        }
        const amount = (Number.isSafeInteger(minorUnits) ? minorUnits : Math.trunc(Number(minorUnits) || 0)) / 100;
        return `${currencyCode(currency)} ${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function safeMinor(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.trunc(number) : 0;
    }

    function normalizeTitle(value) {
        return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function structuredProductText(entry = {}) {
        const fields = [
            entry.productType, entry.offerType, entry.offer_type, entry.entitlementType, entry.entitlement_type,
            entry.kind, entry.categories, entry.category, entry.tags, entry.epicMetadata?.productType,
            entry.epicMetadata?.offerType, entry.epicMetadata?.entitlementType, entry.epicMetadata?.categories,
        ];
        return normalizeTitle(fields.flatMap((value) => {
            if (Array.isArray(value)) return value;
            if (value && typeof value === 'object') return Object.values(value);
            return value == null ? [] : [value];
        }).join(' '));
    }

    function productKind(entry = {}) {
        const structured = structuredProductText(entry);
        if (/\b(base game|game|games)\b/.test(structured) && !/\b(dlc|add on|addon|soundtrack|virtual currency|consumable)\b/.test(structured)) return 'game';
        if (/\b(soundtrack|original soundtrack|ost|music)\b/.test(structured)) return 'soundtrack';
        if (/\b(dlc|add on|addon|season pass|expansion|skin|consumable)\b/.test(structured)) return 'addon';
        if (/\b(demo|beta|test|server|editor|tool|virtual currency|currency)\b/.test(structured)) return 'utility';

        // Title-only fallback is deliberately narrow. Words such as Pack, Bundle, and Episode are valid game titles.
        const title = normalizeTitle(entry.title || entry.name || '');
        if (/\b(soundtrack|original soundtrack)\b|\bost\b/.test(title)) return 'soundtrack';
        if (/\bseason pass\b|\bdlc\b|\badd on\b/.test(title)) return 'addon';
        if (/\b(demo|tech beta|beta test|test server|pre game editor|virtual currency|v bucks|credits)\b/.test(title)) return 'utility';
        return 'game';
    }
    function strongCanonicalKey(game = {}, index = 0) {
        const direct = String(game.canonicalGameId || game.vaultCanonicalKey || '').trim().toLowerCase();
        if (direct && !/^epic:(?:title|row|unidentified):/.test(direct)) return direct;
        const namespace = String(game.namespace || game.sandboxId || game.epicMetadata?.namespace || '').trim().toLowerCase();
        const catalogItemId = String(game.catalogItemId || game.catalog_item_id || game.catalogId || '').trim().toLowerCase();
        const appName = String(game.appName || game.app_name || '').trim().toLowerCase();
        const productId = String(game.productId || game.productSlug || game.slug || '').trim().toLowerCase();
        const id = String(game.id || game.gameId || '').trim().toLowerCase();
        if (namespace && catalogItemId) return `epic:ns:${namespace}:catalog:${catalogItemId}`;
        if (namespace && appName) return `epic:ns:${namespace}:app:${appName}`;
        if (catalogItemId) return `epic:catalog:${catalogItemId}`;
        if (appName) return `epic:app:${appName}`;
        if (productId) return `epic:product:${productId}`;
        if (id) return `epic:id:${id}`;
        // Deliberately unique: title-only identity must never merge two entitlements.
        return `epic:unidentified:${index}`;
    }

    function priceStatus(game = {}) {
        const price = game.livePrice || null;
        const status = game.priceStatus || price?.priceStatus
            || (price?.priceResolved ? (Number(price.amount || 0) === 0 ? 'free' : 'priced') : 'unavailable');
        if (status === 'priced' && price) return 'priced';
        if (status === 'free') return 'free';
        if (status === 'not_for_sale' || status === 'unavailable') return status;
        return 'unresolved';
    }

    function statusRank(game) {
        return { priced: 5, unresolved: 4, free: 3, not_for_sale: 2, unavailable: 1 }[priceStatus(game)] || 0;
    }

    function dedupeCanonicalGames(games = []) {
        const byKey = new Map();
        (Array.isArray(games) ? games : []).forEach((game, index) => {
            if (!game || typeof game !== 'object') return;
            const key = strongCanonicalKey(game, index);
            const previous = byKey.get(key);
            if (!previous || statusRank(game) > statusRank(previous.game)) byKey.set(key, { key, game, index });
        });
        return [...byKey.values()];
    }

    function safeDisplayName(account = {}) {
        const value = String(account.displayName || account.safeDisplayName || account.nickname || '').trim();
        if (!value || value.includes('@')) return null;
        const rawId = String(account.accountId || account.id || '').trim();
        if (rawId && value.toLowerCase() === rawId.toLowerCase()) return null;
        if (/^[a-f0-9-]{24,}$/i.test(value)) return null;
        return value.slice(0, 80);
    }

    function trustedCoverSource(value) {
        const source = String(value || '').trim();
        return TRUSTED_COVER_RE.test(source) ? source : null;
    }

    function financialLines(account = {}, minorField, options = {}) {
        const mapField = {
            grossPurchasesMinor: 'grossPurchasesByCurrency',
            refundsMinor: 'refundsByCurrency',
            netSpentMinor: 'netSpentByCurrency',
        }[minorField];
        const bucket = mapField && account[mapField] && typeof account[mapField] === 'object' ? account[mapField] : null;
        const entries = bucket
            ? Object.entries(bucket)
                .map(([currency, minorUnits]) => ({ currency: currencyCode(currency, ''), minorUnits: safeMinor(minorUnits) }))
                .filter((line) => line.currency && line.minorUnits !== 0)
            : [];
        const fallbackCurrency = currencyCode(account.primaryCurrency || account.currency || 'USD');
        const fallbackMinor = safeMinor(account[minorField] ?? Math.round(Number(account.actualSpent || 0) * 100));
        const lines = entries.length ? entries : [{ currency: fallbackCurrency, minorUnits: fallbackMinor }];
        return lines.map((line) => {
            const minorUnits = options.absolute ? Math.abs(line.minorUnits) : line.minorUnits;
            return { currency: line.currency, minorUnits, text: formatMinorUnits(minorUnits, line.currency, options.locale) };
        });
    }

    function buildAccountMetrics(account = {}, games = null, locale = 'en-US') {
        const canonical = games || dedupeCanonicalGames(account.games);
        const currentByCurrency = new Map();
        let pricedGames = 0;
        let currentValueMinor = 0;
        let unresolvedGames = 0;
        let freeGames = 0;
        let unavailableGames = 0;
        for (const item of canonical) {
            const game = item.game || item;
            const status = priceStatus(game);
            if (status === 'priced') {
                pricedGames += 1;
                currentValueMinor += safeMinor(game.livePrice?.amount);
                const currency = currencyCode(game.livePrice?.currency || account.livePrices?.[0]?.currency || account.currency || account.primaryCurrency || 'USD');
                currentByCurrency.set(currency, (currentByCurrency.get(currency) || 0) + safeMinor(game.livePrice?.amount));
            } else if (status === 'unresolved') unresolvedGames += 1;
            else if (status === 'free') freeGames += 1;
            else unavailableGames += 1;
        }
        const currentLibraryValue = [...currentByCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minorUnits]) => ({
            currency, minorUnits, text: formatMinorUnits(minorUnits, currency, locale),
        }));
        return {
            totalGames: canonical.length,
            pricedGames,
            unresolvedGames,
            freeGames,
            unavailableGames,
            resolvedGames: pricedGames + freeGames + unavailableGames,
            currentValueMinor,
            currency: currencyCode(account.livePrices?.[0]?.currency || account.currency || account.primaryCurrency || currentLibraryValue[0]?.currency || 'USD'),
            currentLibraryValue,
            totalPaid: financialLines(account, 'grossPurchasesMinor', { locale }),
            totalRefunded: financialLines(account, 'refundsMinor', { locale, absolute: true }),
            netSpend: financialLines(account, 'netSpentMinor', { locale }),
        };
    }

    function comparePriced(left, right) {
        const amount = safeMinor(right.priceMinor) - safeMinor(left.priceMinor);
        if (amount) return amount;
        const title = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
        return title || left.key.localeCompare(right.key);
    }

    function compareUnresolved(left, right) {
        const title = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
        return title || left.key.localeCompare(right.key);
    }

    function buildVaultShowcaseSnapshot({ account, generatedAt = new Date().toISOString(), locale = 'en-US', resolveCover = null, displayOptions = null } = {}) {
        if (!account || typeof account !== 'object') {
            const error = new Error('Select an Epic account before exporting.');
            error.code = 'VAULT_EXPORT_NO_ACCOUNT';
            throw error;
        }
        const rawGames = Array.isArray(account.games) ? account.games : [];
        const canonical = dedupeCanonicalGames(rawGames);
        const metrics = buildAccountMetrics(account, canonical, locale);
        const priced = [];
        const priceUnavailable = [];
        let unresolved = 0;
        let nonGameExcluded = 0;
        let freeExcluded = 0;
        for (const item of canonical) {
            const game = item.game;
            if (productKind(game) !== 'game') {
                nonGameExcluded += 1;
                continue;
            }
            const status = priceStatus(game);
            if (status === 'free') { freeExcluded += 1; continue; }
            const cover = trustedCoverSource(typeof resolveCover === 'function' ? resolveCover(game, account) : game.resolvedCover);
            const row = {
                key: item.key,
                title: String(game.title || game.name || 'Untitled game').trim().slice(0, 160),
                coverSource: cover,
                priceStatus: status === 'priced' ? 'priced' : 'price_unavailable',
            };
            if (status === 'priced') {
                row.priceMinor = safeMinor(game.livePrice?.amount);
                row.priceCurrency = currencyCode(game.livePrice?.currency || metrics.currency);
                priced.push(row);
            } else {
                if (status === 'unresolved') unresolved += 1;
                priceUnavailable.push(row);
            }
        }
        priced.sort(comparePriced);
        priceUnavailable.sort(compareUnresolved);
        if (!priced.length && !priceUnavailable.length) {
            const error = new Error('This Vault has no genuine games to export.');
            error.code = 'VAULT_EXPORT_NO_ELIGIBLE_GAMES';
            throw error;
        }
        const normalizedDisplayOptions = normalizeDisplayOptions(displayOptions);
        const rawPriceDataAt = account.pricesFetchedAt || account.priceDataAt || account.priceUpdatedAt || null;
        const priceDataAt = rawPriceDataAt && !Number.isNaN(Date.parse(String(rawPriceDataAt)))
            ? new Date(rawPriceDataAt).toISOString()
            : null;
        return {
            schemaVersion: SCHEMA_VERSION,
            width: EXPORT_WIDTH,
            generatedAt: new Date(generatedAt).toISOString(),
            priceDataAt,
            displayOptions: normalizedDisplayOptions,
            displayName: safeDisplayName(account),
            counts: {
                rawOwned: rawGames.length,
                canonicalOwned: canonical.length,
                duplicatesRemoved: Math.max(0, rawGames.length - canonical.length),
                included: priced.length + priceUnavailable.length,
                priced: priced.length,
                unresolved,
                priceUnavailable: priceUnavailable.length,
                freeExcluded,
                unavailableExcluded: 0,
                nonGameExcluded,
            },
            financials: {
                currentLibraryValue: metrics.currentLibraryValue,
                currentValueCoverage: metrics.pricedGames,
                historyImported: account.permissions?.purchaseHistory === true,
                totalPaid: account.permissions?.purchaseHistory === true ? metrics.totalPaid : [],
                totalRefunded: account.permissions?.purchaseHistory === true ? metrics.totalRefunded : [],
                netSpend: account.permissions?.purchaseHistory === true ? metrics.netSpend : [],
            },
            sections: [
                { key: 'priced', title: 'Priced Games', count: priced.length, games: priced },
                { key: 'price_unavailable', title: 'Price Unavailable', count: priceUnavailable.length, games: priceUnavailable },
            ],
        };
    }

    function containsSensitiveFields(value) {
        if (!value || typeof value !== 'object') return false;
        return Object.entries(value).some(([key, child]) => SENSITIVE_KEY_RE.test(key) || containsSensitiveFields(child));
    }

    return {
        EXPORT_WIDTH,
        SCHEMA_VERSION,
        buildAccountMetrics,
        buildVaultShowcaseSnapshot,
        containsSensitiveFields,
        dedupeCanonicalGames,
        financialLines,
        formatMinorUnits,
        priceStatus,
        productKind,
        safeDisplayName,
        strongCanonicalKey,
        trustedCoverSource,
    };
}));
