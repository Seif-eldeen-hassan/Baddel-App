'use strict';

function asId(value) {
    return value == null ? '' : String(value);
}

function cloneGame(game) {
    return JSON.parse(JSON.stringify(game));
}

function orderAccountsForSync(accounts, preferredAccountId) {
    const preferred = asId(preferredAccountId).trim();
    if (!preferred) return [...accounts];
    return [
        ...accounts.filter((account) => asId(account.id) === preferred),
        ...accounts.filter((account) => asId(account.id) !== preferred),
    ];
}

function countGamesForAccount(platform, games, accountId) {
    const aid = asId(accountId);
    if (!aid) return 0;

    return (games || []).filter((game) => {
        if (!game || typeof game !== 'object') return false;

        // Check primary ownership array
        if (Array.isArray(game.ownedByAccountIds) && game.ownedByAccountIds.some((id) => asId(id) === aid)) {
            return true;
        }

        // Steam-specific additional arrays
        if (platform === 'steam') {
            if (Array.isArray(game.steamLicensedAccountIds) && game.steamLicensedAccountIds.some((id) => asId(id) === aid)) {
                return true;
            }
            if (Array.isArray(game.steamDetectedAccountIds) && game.steamDetectedAccountIds.some((id) => asId(id) === aid)) {
                return true;
            }
        }

        return false;
    }).length;
}

function mergeAccountIntoSteamGame(target, source, account) {
    const accountId = asId(account.id);
    const displayName = account.displayName || '';

    if (!Array.isArray(target.ownedBy)) target.ownedBy = [];
    if (!Array.isArray(target.ownedByAccountIds)) target.ownedByAccountIds = [];
    if (!Array.isArray(target.steamLicensedAccountIds)) target.steamLicensedAccountIds = [];

    if (displayName && !target.ownedBy.includes(displayName)) {
        target.ownedBy.push(displayName);
    }
    if (!target.ownedByAccountIds.some((id) => asId(id) === accountId)) {
        target.ownedByAccountIds.push(accountId);
    }

    const sourceLicensed = Array.isArray(source.steamLicensedAccountIds) && source.steamLicensedAccountIds.length > 0
        ? source.steamLicensedAccountIds
        : source.ownedByAccountIds;

    if (Array.isArray(sourceLicensed) && sourceLicensed.some((id) => asId(id) === accountId)) {
        if (!target.steamLicensedAccountIds.some((id) => asId(id) === accountId)) {
            target.steamLicensedAccountIds.push(accountId);
        }
    }
}

function mergeAccountIntoGenericGame(target, account) {
    const accountId = asId(account.id);
    const displayName = account.displayName || '';

    if (!Array.isArray(target.ownedBy)) target.ownedBy = [];
    if (!Array.isArray(target.ownedByAccountIds)) target.ownedByAccountIds = [];

    if (displayName && !target.ownedBy.includes(displayName)) {
        target.ownedBy.push(displayName);
    }
    if (!target.ownedByAccountIds.some((id) => asId(id) === accountId)) {
        target.ownedByAccountIds.push(accountId);
    }
}

function preservePreviousAccountData(platform, previousGames, nextGamesMap, account) {
    const accountId = asId(account.id);
    let restored = 0;

    for (const previousGame of previousGames || []) {
        const ownsGame = countGamesForAccount(platform, [previousGame], accountId) > 0;
        if (!ownsGame) continue;

        if (nextGamesMap.has(previousGame.id)) {
            const existing = nextGamesMap.get(previousGame.id);
            if (platform === 'steam') {
                mergeAccountIntoSteamGame(existing, previousGame, account);
            } else {
                mergeAccountIntoGenericGame(existing, account);
            }
        } else {
            nextGamesMap.set(previousGame.id, cloneGame(previousGame));
        }
        restored++;
    }

    return restored;
}

function sanitizeGames(games, issues) {
    const sanitized = [];
    const seenIds = new Set();

    for (const game of games || []) {
        if (!game || typeof game !== 'object') {
            issues.push('Ignored invalid game record.');
            continue;
        }

        const id = asId(game.id).trim();
        if (!id) {
            issues.push('Ignored game without id.');
            continue;
        }

        if (seenIds.has(id)) {
            issues.push(`Ignored duplicate game id: ${id}`);
            continue;
        }

        seenIds.add(id);
        sanitized.push(cloneGame(game));
    }

    return sanitized;
}

function finalizeLibraryForAccounts({ platform, previousGames = [], nextGames = [], accounts = [], accountResults = {} }) {
    const issues = [];
    const sanitizedGames = sanitizeGames(nextGames, issues);
    const nextGamesMap = new Map(sanitizedGames.map((game) => [game.id, game]));

    for (const account of accounts) {
        const accountId = asId(account.id);
        const previousCount = countGamesForAccount(platform, previousGames, accountId);
        const nextCount = countGamesForAccount(platform, sanitizedGames, accountId);
        const result = accountResults[accountId] || {};
        // Steam collection now carries an explicit authoritative contract.
        // Other platforms retain their existing zero/failure recovery behavior.
        const steamNeedsPreserve = platform === 'steam' && previousCount > 0 && result.authoritative !== true;
        const legacyLooksUnreliable = result.status !== 'success' || result.rawGamesCount === 0 || result.validationFailed === true;
        const legacyNeedsPreserve = platform !== 'steam' && previousCount > 0 && nextCount === 0 && result.allowZeroGames !== true && legacyLooksUnreliable;

        if (!steamNeedsPreserve && !legacyNeedsPreserve) continue;

        const restored = preservePreviousAccountData(platform, previousGames, nextGamesMap, account);
        if (restored > 0) {
            issues.push(`Preserved ${restored} cached games for ${account.displayName || accountId}.`);
        }
    }

    const finalGames = Array.from(nextGamesMap.values());
    const countsByAccount = Object.fromEntries(
        accounts.map((account) => [asId(account.id), countGamesForAccount(platform, finalGames, account.id)])
    );

    return {
        games: finalGames,
        validation: {
            ok: issues.length === 0,
            issues,
            countsByAccount,
            totalGames: finalGames.length,
        },
    };
}

function removeAccountFromLibrary(platform, games = [], account = {}) {
    const accountId = asId(account.id);
    const displayName = String(account.displayName || '').trim();
    if (!accountId) return [...(games || [])]; // Safety check

    const filteredGames = [];

    for (const originalGame of games || []) {
        if (!originalGame || typeof originalGame !== 'object') continue;

        const game = cloneGame(originalGame);

        // 1. Filter out the unlinked account's ID from all possible ID arrays
        if (Array.isArray(game.ownedByAccountIds)) {
            game.ownedByAccountIds = game.ownedByAccountIds.filter((id) => asId(id) !== accountId);
        }
        if (Array.isArray(game.steamLicensedAccountIds)) {
            game.steamLicensedAccountIds = game.steamLicensedAccountIds.filter((id) => asId(id) !== accountId);
        }
        if (Array.isArray(game.steamDetectedAccountIds)) {
            game.steamDetectedAccountIds = game.steamDetectedAccountIds.filter((id) => asId(id) !== accountId);
        }

        // 2. Filter out the unlinked account's name from the display name array
        if (Array.isArray(game.ownedBy) && displayName) {
            game.ownedBy = game.ownedBy.filter((name) => String(name || '').trim().toLowerCase() !== displayName.toLowerCase());
        }

        // 3. Keep the game if at least one OTHER account still has a license for it, OR if it's installed locally.
        // steamDetectedAccountIds is intentionally excluded — local install detection is NOT licensed ownership.
        const hasOtherOwners = (
            (Array.isArray(game.ownedByAccountIds) && game.ownedByAccountIds.length > 0) ||
            (Array.isArray(game.steamLicensedAccountIds) && game.steamLicensedAccountIds.length > 0)
        );

        if (hasOtherOwners || game.installOnly === true) {
            filteredGames.push(game);
        }
    }

    return filteredGames;
}

// ── Epic non-game filter ──────────────────────────────────────────────────────

// Lowercase, strip punctuation/symbols. Safe for word-boundary regex matching.
function normToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[''`™®©]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Extract Epic catalog category paths from metadata.categories.
// Handles both [{path:"games"}] objects and plain string arrays.
function _extractEpicCategories(entry) {
    const cats = entry?.metadata?.categories;
    if (!Array.isArray(cats)) return [];
    return cats.map(c => {
        if (typeof c === 'string') return c.toLowerCase();
        if (c && typeof c === 'object') return String(c.path || c.name || '').toLowerCase();
        return '';
    }).filter(Boolean);
}

// Collect every identifying field Legendary exposes into one searchable string.
function collectEpicEntryTokens(entry) {
    const assetInfos = Object.values(entry?.asset_infos || {});
    const catPaths   = _extractEpicCategories(entry).join(' ');
    return [
        entry?.app_name,
        entry?.app_title,
        entry?.title,
        entry?.catalog_item_id,
        entry?.namespace,
        entry?.metadata?.namespace,
        entry?.metadata?.title,
        entry?.metadata?.description,
        entry?.metadata?.productType,
        catPaths,
        entry?.app_type,
        entry?.type,
        entry?.metadata?.customAttributes?.ProductSlug?.value,
        entry?.metadata?.customAttributes?.productType?.value,
        entry?.metadata?.customAttributes?.com_epicgames_AppBlackList?.value,
        ...assetInfos.map(a => a?.namespace),
        ...assetInfos.map(a => a?.catalog_item_id),
        ...assetInfos.map(a => a?.app_name),
    ].filter(Boolean).join(' ');
}

// Exact normalized-title denylist — these are always non-games no matter what.
const EPIC_NON_GAME_TITLE_DENYLIST = new Set([
    'fab',
    'fab marketplace',
    'blueprint csv parsing',
    'blueprintcsvparsing',
    // Known real examples returned by Legendary
    'advanced flock system multithreaded fish ai and reactive school behavior',
    'agora static mesh thumbnail render extension',
    'assets cleaner project cleaning tool',
    // Tools / engines / non-game products
    'unreal engine marketplace',
    'ue marketplace',
    'epic marketplace',
    'epic games fab',
    'fab plugin',
    'fab library',
    'twinmotion',
    'realityscan',
    'metahuman',
    'unreal editor',
    'unreal engine',
    'uefn',
]);

/**
 * Returns true if the Legendary entry is clearly a non-game: Fab asset, Unreal
 * Marketplace plugin, tool, template, etc. Uses word-boundary regex so titles
 * like "Fable" / "Fabric" / "Fabulous" are NEVER blocked.
 */
function isEpicNonGameAssetEntry(entry) {
    const text    = normToken(collectEpicEntryTokens(entry));
    const title   = normToken(entry?.app_title || entry?.title || entry?.app_name);
    const appName = normToken(entry?.app_name);
    const namespace = normToken(
        entry?.namespace
        || entry?.metadata?.namespace
        || Object.values(entry?.asset_infos || {})[0]?.namespace
    );

    // 1. Exact denylist check.
    if (EPIC_NON_GAME_TITLE_DENYLIST.has(title)    ||
        EPIC_NON_GAME_TITLE_DENYLIST.has(appName)  ||
        EPIC_NON_GAME_TITLE_DENYLIST.has(namespace)) {
        return true;
    }

    // 2. Structural patterns that appear in asset/tool titles but never game titles.
    if (/\bstatic mesh\b/.test(title))             return true;  // "Agora Static Mesh…"
    if (/\bthumbnail render\b/.test(title))        return true;  // "…Thumbnail Render Extension"
    if (/\bassets? cleaner\b/.test(title))         return true;  // "Assets Cleaner…"
    if (/\bproject cleaning\b/.test(title))        return true;  // "…Project Cleaning Tool"
    if (/\bflock system\b/.test(title))            return true;  // "Advanced Flock System…"
    if (/\brender extension\b/.test(title))        return true;  // "…Render Extension"
    if (/\bai system\b/.test(title) &&
        /\b(tool|asset|plugin|unreal|ue|mesh|behavior)\b/.test(title)) return true;

    // 3. Fab/Unreal/marketplace signal + any asset/tool/content keyword in full text.
    if (/\b(fab|unreal|ue|uefn|marketplace)\b/.test(text) &&
        /\b(asset|assets|plugin|plugins|content|template|sample|project|blueprint|csv|editor|tool|library|pack|mesh|material|texture|animation|vfx|sfx|audio)\b/.test(text)) {
        return true;
    }

    // 4. Blueprint-as-tool patterns.
    if (/\bblueprint\b/.test(text) &&
        /\b(csv|parser|parsing|plugin|tool|template|asset|unreal|ue|marketplace)\b/.test(text)) {
        return true;
    }

    // 5. Product/category metadata explicitly says tool/asset/plugin/content.
    const productType = normToken([
        entry?.metadata?.productType,
        entry?.metadata?.customAttributes?.productType?.value,
        entry?.app_type,
        entry?.type,
    ].filter(Boolean).join(' '));
    if (/\b(asset|plugin|tool|editor|engine|marketplace|sample|template|project|mod|content)\b/.test(productType)) {
        return true;
    }

    // 6. Category paths are non-game.
    const catPaths = _extractEpicCategories(entry).join(' ');
    if (catPaths &&
        !/\bgames?\b/.test(catPaths) &&
        /\b(plugin|content|project|asset|template|engine|editor|add[- ]?on|addon|sample|tool|script|blueprint)\b/.test(catPaths)) {
        return true;
    }

    return false;
}

// Backward-compatible alias.
const isFabOrMarketplaceEntry = isEpicNonGameAssetEntry;

/**
 * Returns true if there is a positive, unambiguous signal that this entry is a
 * playable game. Only known-good signals are trusted; unknown = false.
 */
function isEpicPositiveGameEntry(entry) {
    // Third-party store (EA App, Ubisoft Connect, etc.) → unambiguously a game.
    if (entry?.third_party_store &&
        String(entry.app_name  || '').trim() &&
        String(entry.app_title || entry.title || '').trim()) {
        return true;
    }

    // Epic catalog category path starts with "games" → it's a game.
    const catPaths = _extractEpicCategories(entry);
    if (catPaths.some(c => c.startsWith('games') || c === 'game')) return true;

    // Explicit productType === "Game" (case-insensitive).
    const productType = normToken(
        entry?.metadata?.productType ||
        entry?.metadata?.customAttributes?.productType?.value || ''
    );
    if (productType === 'game' || productType === 'base game') return true;

    // Game-specific runtime attributes (cloud save / offline mode).
    const canRunOffline  = entry?.metadata?.customAttributes?.CanRunOffline?.value;
    const cloudSaveFolder = entry?.metadata?.customAttributes?.CloudSaveFolder?.value;
    if ((canRunOffline || cloudSaveFolder) && !isEpicNonGameAssetEntry(entry)) return true;

    // Has launch executable and nothing says it's an asset.
    const hasExecutable = Boolean(
        entry?.executable ||
        entry?.launch_command ||
        entry?.install?.executable
    );
    if (hasExecutable && !isEpicNonGameAssetEntry(entry)) return true;

    return false;
}

/**
 * Classifies a single Legendary entry into one of three buckets:
 *   'keep'    — positive proof it is a game
 *   'reject'  — positive proof it is not a game (asset/tool/marketplace)
 *   'unknown' — neither proven game nor proven non-game → dropped by default
 *
 * Priority order:
 *   1. Hard denylist → always reject (even if Epic tags the entry as "games").
 *   2. Epic category path includes "games" → keep; broad keyword heuristics must
 *      not override what Epic's own catalog says about the entry type.
 *   3. Broad keyword/structural non-game heuristics → reject.
 *   4. Remaining positive game signals (executable, offline mode, …) → keep.
 *   5. No signal either way → unknown (dropped by the public gate).
 */
function classifyEpicEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return { decision: 'reject', reason: 'invalid_entry' };
    }
    const appName = String(entry.app_name || '').trim();
    const title   = String(entry.app_title || entry.title || entry.app_name || '').trim();
    if (!appName || !title) {
        return { decision: 'reject', reason: 'missing_app_name_or_title' };
    }

    // Step 1 — hard denylist wins unconditionally.
    const titleNorm   = normToken(title);
    const appNameNorm = normToken(appName);
    const nsNorm      = normToken(
        entry.namespace ||
        entry?.metadata?.namespace ||
        Object.values(entry?.asset_infos || {})[0]?.namespace
    );
    if (EPIC_NON_GAME_TITLE_DENYLIST.has(titleNorm)   ||
        EPIC_NON_GAME_TITLE_DENYLIST.has(appNameNorm) ||
        EPIC_NON_GAME_TITLE_DENYLIST.has(nsNorm)) {
        return { decision: 'reject', reason: 'non_game_asset_or_marketplace_item' };
    }

    // Step 2 — Epic's own category data is the strongest positive signal available.
    // Trust it over broad keyword heuristics; games like Fortnite carry UEFN/editor
    // references in their metadata that would otherwise trigger false rejections.
    const catPaths = _extractEpicCategories(entry);
    if (catPaths.some(c => c.startsWith('games') || c === 'game')) {
        return { decision: 'keep', reason: 'epic_games_category_signal' };
    }

    // Step 3 — broad keyword and structural heuristics to catch marketplace assets.
    if (isEpicNonGameAssetEntry(entry)) {
        return { decision: 'reject', reason: 'non_game_asset_or_marketplace_item' };
    }

    // Step 4 — remaining positive signals (executable, cloud-save, offline mode, …).
    if (isEpicPositiveGameEntry(entry)) {
        return { decision: 'keep', reason: 'positive_game_signal' };
    }

    return { decision: 'unknown', reason: 'no_positive_game_signal' };
}

/**
 * Returns true if the entry should be included in the library.
 * This is the public gate: unknown entries are dropped by default.
 */
function isEpicPlayableGameEntry(entry) {
    return classifyEpicEntry(entry).decision === 'keep';
}

/**
 * Returns true if an already-cached Epic game record should survive a cleanup pass.
 * Conservative: only evicts confirmed non-game entries, preserves unknowns.
 */
function isEpicSyncedGameAllowed(game) {
    if (!game) return false;
    if (game.platform !== 'epic' && game.source !== 'epic') return true;
    return !isEpicNonGameAssetEntry({
        app_name:  game.appName || game.app_name || game.id,
        app_title: game.title  || game.name,
        title:     game.title  || game.name,
        namespace: game.namespace,
        metadata: {
            namespace:   game.namespace,
            productType: game.productType,
            categories:  game.categories,
        },
    });
}

/** Sync statuses that represent transient in-progress states. */
const TRANSIENT_SYNC_STATUSES = new Set(['queued', 'pending', 'syncing', 'finalizing', 'starting']);

function isEpicFallbackDisplayName(name) {
    if (!name) return true;
    const n = String(name).toLowerCase().trim();
    return n === '' ||
        n === 'epic user' ||
        n === 'epic account' ||
        n.startsWith('epic_tmp') ||
        /^epic epic_tmp/i.test(n) ||
        /^epic [0-9a-f]{6,8}$/i.test(n);
}

/**
 * Resolves an Epic account identity from a Legendary status payload.
 * Handles `legendary status --json` format where `status.account` is a plain string.
 * Never returns "epic_tmp*" as account id or display name.
 * Returns { accountId, displayName, confidence, source }.
 */
function resolveEpicAccountIdentity(status, existingAccount = null, tmpId = null) {
    // Extract account_id — prefer real IDs; epic_tmp is never authoritative
    const rawAccountId =
        status?.account_id          ||
        status?.account?.account_id ||
        status?.user?.account_id    ||
        status?.accountId           ||
        status?.user?.id;

    const isTmpFallback = !rawAccountId || String(rawAccountId).startsWith('epic_tmp');
    const accountId = isTmpFallback ? (tmpId || rawAccountId || null) : rawAccountId;
    const confidence = isTmpFallback ? 'low' : 'high';

    // Display name candidates — include status.account when it's a plain string
    // (Legendary status --json returns { account: "DisplayName", ... })
    const candidates = [
        status?.display_name,
        status?.displayName,
        typeof status?.account === 'string' ? status.account : null,
        status?.account?.display_name,
        status?.account?.displayName,
        status?.user?.display_name,
        status?.user?.displayName,
        status?.account_name,
        status?.username,
        status?.user?.username,
        status?.account?.name,
        status?.user?.name,
        status?.email,
        status?.user?.email,
        !isEpicFallbackDisplayName(existingAccount?.displayName) ? existingAccount?.displayName : null,
    ].map(v => String(v || '').trim()).filter(v => v && !isEpicFallbackDisplayName(v));

    let displayName, source;
    if (candidates.length > 0) {
        displayName = candidates[0];
        source = 'status';
    } else if (accountId && !String(accountId).startsWith('epic_tmp')) {
        displayName = `Epic ${String(accountId).slice(0, 8)}`;
        source = 'id-derived';
    } else {
        displayName = 'Epic Account';
        source = 'fallback';
    }

    return { accountId, displayName, confidence, source };
}

/**
 * Given a persisted account record and the final deduplicated game count,
 * returns the appropriate terminal (non-transient) UI status and message.
 * Used to clean up stale in-progress states for non-target accounts after
 * a targeted sync completes or fails.
 */
function computeTerminalAccountStatus(account, finalCount) {
    if (
        account?.needsReauth ||
        account?.credentialStatus === 'missing' ||
        account?.credentialStatus === 'invalid'
    ) {
        return { status: 'needs_reauth', message: 'Reconnect required' };
    }
    if (finalCount > 0 || account?.lastSyncedAt) {
        return {
            status: 'synced',
            message: finalCount > 0 ? `Synced ${finalCount} games` : 'Previously synced',
        };
    }
    return { status: 'idle', message: '' };
}

/**
 * Compute the user-visible sync message for a Steam account after library
 * finalization, where rawCount and finalCount can differ (dedup, library merge).
 *
 * @param {number} rawCount   - Games returned directly by the Steam API.
 * @param {number} finalCount - Games actually in the Baddel library for this
 *                              account after finalizeLibraryForAccounts().
 * @param {number} prevCount  - Games that were in the cache before this sync.
 */
function computeSteamSyncMessage(rawCount, finalCount, prevCount) {
    if (rawCount === 0 && prevCount > 0) {
        return `Steam returned 0 games. Kept ${prevCount} cached games.`;
    }
    if (rawCount > 0 && finalCount !== rawCount) {
        return `Steam returned ${rawCount} entries; ${finalCount} games synced`;
    }
    if (rawCount > 0) {
        return `Synced ${finalCount} games`;
    }
    return 'No owned games found';
}

// Returns true when an Epic switcher profile folder contains real session data
// (not just a phantom created by the old sync-link bug).
// Accepts the list of entry names (strings) from fs.readdir on the profile dir.
const REAL_EPIC_PROFILE_MARKERS = ['Data', 'Config', 'webcache', '_baddel_meta.json'];
function isRealEpicSwitcherProfile(folderEntryNames) {
    if (!Array.isArray(folderEntryNames)) return false;
    const lower = folderEntryNames.map(n => String(n).toLowerCase());
    return REAL_EPIC_PROFILE_MARKERS.some(m => lower.includes(m.toLowerCase()));
}

module.exports = {
    orderAccountsForSync,
    countGamesForAccount,
    preservePreviousAccountData,
    finalizeLibraryForAccounts,
    removeAccountFromLibrary,
    computeSteamSyncMessage,
    normToken,
    collectEpicEntryTokens,
    EPIC_NON_GAME_TITLE_DENYLIST,
    isEpicNonGameAssetEntry,
    isFabOrMarketplaceEntry,          // backward-compat alias
    isEpicPositiveGameEntry,
    classifyEpicEntry,
    isEpicPlayableGameEntry,
    isEpicSyncedGameAllowed,
    resolveEpicAccountIdentity,
    isEpicFallbackDisplayName,
    computeTerminalAccountStatus,
    TRANSIENT_SYNC_STATUSES,
    isRealEpicSwitcherProfile,
};
