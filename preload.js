// ============================================================
// BADDEL LAUNCHER - PRELOAD (Context Bridge)
// ============================================================
const { contextBridge, ipcRenderer, webUtils, shell } = require('electron');
// Electron loads this source file directly in development. Sandboxed preloads
// cannot require local CommonJS files, so keep this small adapter self-contained.
const artworkInvoke = ((ipc, enabled = process.env.BADDEL_ARTWORK_STARTUP_TRACE === '1') => {
    let sequence = 0;
    const started = Date.now();
    const emit = payload => { try { ipc.send('artwork-startup-trace:preload', payload); } catch {} };
    return (channel, ...args) => {
        if (!enabled || Date.now() - started > 120000) return ipc.invoke(channel, ...args);
        const id = ++sequence;
        const at = Date.now();
        emit({ channel, stage: 'invoke', id, at, count: Array.isArray(args[0]) ? args[0].length : 0 });
        return ipc.invoke(channel, ...args).then(result => {
            emit({ channel, stage: 'resolved', id, at: Date.now(), durationMs: Date.now() - at });
            return result;
        }, error => {
            emit({ channel, stage: 'rejected', id, at: Date.now(), durationMs: Date.now() - at });
            throw error;
        });
    };
})(ipcRenderer);
const performanceDiagnosticsEnabled = process.env.BADDEL_PERF_DIAGNOSTICS === '1';

// Expose the image-cache directory URL synchronously so domUtils.js can
// initialise its file:// trust policy before any renderer code runs.
// Uses sendSync so it is available immediately (no async IPC round-trip needed).
// Wrapped in try/catch so a failure here NEVER prevents electronAPI from loading.
try {
    const cacheUrl = ipcRenderer.sendSync('get-image-cache-dir-url-sync');
    if (cacheUrl) contextBridge.exposeInMainWorld('__BADDEL_CACHE_URL__', cacheUrl);
    const v2ArtworkCacheUrl = ipcRenderer.sendSync('get-artwork-cache-dir-url-sync');
    if (v2ArtworkCacheUrl) contextBridge.exposeInMainWorld('__BADDEL_ARTWORK_CACHE_URL__', v2ArtworkCacheUrl);
    const artworkUrl = ipcRenderer.sendSync('get-user-artwork-dir-url-sync');
    if (artworkUrl) contextBridge.exposeInMainWorld('__BADDEL_USER_ARTWORK_URL__', artworkUrl);
} catch (err) {
    console.warn('[Preload] Could not resolve trusted artwork URLs:', err && err.message);
}

// Multi-subscriber fanout for library-updated — lets app.js and accounts.js
// both receive the event without one registration evicting the other.
const _libraryUpdatedCallbacks = new Set();
let _libraryUpdatedListenerAttached = false;
const _platformLibraryCommittedCallbacks = new Set();
let _platformLibraryCommittedListenerAttached = false;
const _platformAccountsChangedCallbacks = new Set();
let _platformAccountsChangedListenerAttached = false;
const _installedGamesScanStateCallbacks = new Set();
let _installedGamesScanStateListenerAttached = false;
const _storeNavigationCallbacks = new Set();
let _storeNavigationListenerAttached = false;

contextBridge.exposeInMainWorld('electronAPI', {

    // ---- Stores ----
    openStore:              (provider) => ipcRenderer.invoke('stores:open', provider),
    storeBack:              () => ipcRenderer.invoke('stores:command', 'back'),
    storeForward:           () => ipcRenderer.invoke('stores:command', 'forward'),
    storeReload:            () => ipcRenderer.invoke('stores:command', 'reload'),
    storeStop:              () => ipcRenderer.invoke('stores:command', 'stop'),
    storeHome:              () => ipcRenderer.invoke('stores:command', 'home'),
    storeOpenExternal:      () => ipcRenderer.invoke('stores:open-external'),
    copyStoreUrl:           (context) => ipcRenderer.invoke('stores:copy-url', context),
    setStoreViewBounds:     (bounds) => ipcRenderer.invoke('stores:set-bounds', bounds),
    setStoreViewVisible:    (visible) => ipcRenderer.invoke('stores:set-visible', visible),
    onStoreNavigationState: (callback) => {
        if (typeof callback !== 'function') return () => {};
        _storeNavigationCallbacks.add(callback);
        if (!_storeNavigationListenerAttached) {
            _storeNavigationListenerAttached = true;
            ipcRenderer.on('stores:navigation-state', (_event, state) => {
                _storeNavigationCallbacks.forEach(fn => { try { fn(state); } catch {} });
            });
        }
        return () => _storeNavigationCallbacks.delete(callback);
    },

    // ---- Library ----
    getGames:               ()                        => ipcRenderer.invoke('get-installed-games'),
    getGameById:            (id)                      => ipcRenderer.invoke('get-game-by-id', id),
    scanAllGames:           ()                        => ipcRenderer.invoke('scan-all-games'),
    addManualGame:          (exePath, customName)     => ipcRenderer.invoke('add-manual-game', exePath, customName),
    removeGame:             (id)                      => ipcRenderer.invoke('remove-game', id),
    renameGame:             (id, name)                => ipcRenderer.invoke('rename-game', id, name),
    reorderLibrary:         (ids)                     => ipcRenderer.invoke('reorder-library', ids),
    unhideAllGames:         ()                        => ipcRenderer.invoke('unhide-all-games'),
    getHiddenGames:         ()                        => ipcRenderer.invoke('get-hidden-games'),
    restoreSpecificGames:   (ids)                     => ipcRenderer.invoke('restore-specific-games', ids),
    deleteGamePermanently:  (id)                      => ipcRenderer.invoke('delete-game-permanently', id),
    onLibraryUpdated:       (cb)                      => {
        _libraryUpdatedCallbacks.add(cb);
        if (!_libraryUpdatedListenerAttached) {
            _libraryUpdatedListenerAttached = true;
            ipcRenderer.on('library-updated', (_, games) => {
                _libraryUpdatedCallbacks.forEach(fn => { try { fn(games); } catch (_e) {} });
            });
        }
    },
    onPlatformLibraryCommitted: (cb)                  => {
        _platformLibraryCommittedCallbacks.add(cb);
        if (!_platformLibraryCommittedListenerAttached) {
            _platformLibraryCommittedListenerAttached = true;
            ipcRenderer.on('platform-library-committed', (_, payload) => {
                _platformLibraryCommittedCallbacks.forEach(fn => { try { fn(payload); } catch (_e) {} });
            });
        }
    },
    onPlatformSyncAccountsChanged: (cb)                => {
        _platformAccountsChangedCallbacks.add(cb);
        if (!_platformAccountsChangedListenerAttached) {
            _platformAccountsChangedListenerAttached = true;
            ipcRenderer.on('platform-sync:accounts-changed', (_, payload) => {
                _platformAccountsChangedCallbacks.forEach(fn => { try { fn(payload); } catch (_e) {} });
            });
        }
    },
    onGameImageUpdated:     (cb)                      => ipcRenderer.on('game-image-updated', (_, game) => cb(game)),
    onInstalledGamesScanState: (cb)                   => {
        _installedGamesScanStateCallbacks.add(cb);
        if (!_installedGamesScanStateListenerAttached) {
            _installedGamesScanStateListenerAttached = true;
            ipcRenderer.on('installed-games-scan-state', (_, payload) => {
                _installedGamesScanStateCallbacks.forEach(fn => { try { fn(payload); } catch (_e) {} });
            });
        }
    },
    onGameDeletedPermanently: (cb)                    => {
        ipcRenderer.removeAllListeners('game-deleted-permanently');
        ipcRenderer.on('game-deleted-permanently', (_, payload) => cb(payload));
    },
    onAllGamesCoverCached:  (cb)                      => ipcRenderer.on('all-games-cover-cached', (_, payload) => cb(payload)),
    onColdCoverBootstrapBatch: (cb)                  => ipcRenderer.on('artwork-cold-cover-bootstrap:batch', (_, payload) => cb(payload)),

    // ---- Images ----
    selectImage:            ()                        => ipcRenderer.invoke('select-game-image'),
    updateGameImage:        (id, imgPath, type, opts) => ipcRenderer.invoke('update-game-image', id, imgPath, type, opts),
    setGameArtwork:         (id, updates, opts)       => ipcRenderer.invoke('set-game-artwork', id, updates, opts),
    resetGameArtwork:       (id, opts)                => ipcRenderer.invoke('reset-game-artwork', id, opts),
    resetGameImage:         (id, type)                => ipcRenderer.invoke('reset-game-image', id, type),
    cacheImage:             (url, gameId, type, opts) => ipcRenderer.invoke('cache-image', url, gameId, type, opts),
    getCachedImage:         (gameId, type)             => ipcRenderer.invoke('get-cached-image', gameId, type),
    getCachedImagesBulk:     (identities, type)         => artworkInvoke('get-cached-images-bulk', identities, type),
    getGridArtworkThumbnails: (sourceUrls, opts = {})    => artworkInvoke('get-grid-artwork-thumbnails', sourceUrls, opts),
    setGridArtworkScrollActive: (active)                  => ipcRenderer.send('grid-artwork-scroll-active', active === true),
    probeLocalImage:        (fileUrl)                 => ipcRenderer.invoke('probe-local-image', fileUrl),
    cacheAllAssets:         (assets, gameId, opts)    => ipcRenderer.invoke('cache-all-assets', assets, gameId, opts),
    getArtworkDownloadStats: ()                       => ipcRenderer.invoke('artwork-download-stats'),
    startColdCoverBootstrap: (games, opts = {})       => ipcRenderer.invoke('artwork-cold-cover-bootstrap:start', games, opts),
    boostColdCoverBootstrap: (games, opts = {})       => ipcRenderer.invoke('artwork-cold-cover-bootstrap:boost', games, opts),
    getColdCoverBootstrapStats: ()                    => ipcRenderer.invoke('artwork-cold-cover-bootstrap:stats'),
    getArtworkPersistenceAudit: (payload = {})       => ipcRenderer.invoke('get-artwork-persistence-audit', payload),
    getScrollDiagnosticConfig: ()                    => ipcRenderer.invoke('scroll-diagnostic:get-config'),
    writeScrollDiagnosticReport: (report)            => ipcRenderer.invoke('scroll-diagnostic:write-report', report),
    pruneImageCache:        ()                        => ipcRenderer.invoke('prune-image-cache'),
    getImageCacheDirUrl:    ()                        => ipcRenderer.invoke('get-image-cache-dir-url'),
    getArtworkCacheDirUrl:  ()                        => ipcRenderer.invoke('get-artwork-cache-dir-url'),
    getUserArtworkDirUrl:   ()                        => ipcRenderer.invoke('get-user-artwork-dir-url'),
    getArtworkNetworkDiagnostics: ()                  => ipcRenderer.invoke('get-artwork-network-diagnostics'),
    getFilePath:            (file)                    => webUtils.getPathForFile(file),

    // ---- Metadata & Playtime ----
    getMetadata:            (gameName, hints = {})    => ipcRenderer.invoke('get-game-metadata', gameName, hints),
    getGameAchievements:    (payload)                 => ipcRenderer.invoke('get-game-achievements', payload),
    saveMetadata:           (gameId, meta, opts)      => ipcRenderer.invoke('save-game-metadata', gameId, meta, opts),
    saveFullMetadata:       (gameId, title, platform, meta) => ipcRenderer.invoke('save-full-metadata', gameId, title, platform, meta),
    loadFullMetadata:       (gameId)                        => ipcRenderer.invoke('load-full-metadata', gameId),
    updatePlaytime:         (gameId, minutes)         => ipcRenderer.invoke('update-playtime', gameId, minutes),
    setTimeTrackingEnabled: (gameId, enabled)         => ipcRenderer.invoke('set-time-tracking-enabled', gameId, enabled),
    getTimeTrackingEnabled: (gameId)                  => ipcRenderer.invoke('get-time-tracking-enabled', gameId),
    onPlaytimeUpdated:      (cb)                      => ipcRenderer.on('playtime-updated', (_, data) => cb(data)),

    // ---- Launch ----
    launchGame: (arg1, arg2 = {}, arg3 = null, arg4 = null, arg5 = {}) => {
        const isLegacyCall =
            typeof arg2 === 'string' ||
            typeof arg3 === 'string' ||
            typeof arg4 === 'string';
        if (isLegacyCall) {
            return ipcRenderer.invoke('launch-game', arg1, arg2, arg3, arg4, arg5 || {});
        }
        return ipcRenderer.invoke('launch-game', null, arg1, null, null, arg2 || {});
    },

    // ---- File Browser ----
    getDrives:              ()       => ipcRenderer.invoke('get-drives'),
    listDirs:               (p)      => ipcRenderer.invoke('list-directories', p),
    getDesktopPath:         ()       => ipcRenderer.invoke('get-desktop-path'),

    // ---- Collections ----
    getCollections:             ()                    => ipcRenderer.invoke('get-collections'),
    createCollection:           (name, img)           => ipcRenderer.invoke('create-collection', name, img),
    addGameToCollection:        (colId, gameId)       => ipcRenderer.invoke('add-game-collection', colId, gameId),
    removeGameFromCollection:   (colId, gameId)       => ipcRenderer.invoke('remove-game-collection', colId, gameId),
    deleteCollection:           (colId)               => ipcRenderer.invoke('delete-collection', colId),
    reorderCollection:          (colId, order)        => ipcRenderer.invoke('reorder-collection', colId, order),
    updateCollection:           (colId, name, img)    => ipcRenderer.invoke('update-collection', colId, name, img),

    // ---- Window Controls ----
    minimizeApp:    () => ipcRenderer.send('minimize-app'),
    maximizeApp:    () => ipcRenderer.send('maximize-app'),
    closeApp:       () => ipcRenderer.send('close-app'),

    // ---- System Stats ----
    getSystemInfo:  () => ipcRenderer.invoke('get-system-info'),
    getLiveStats:   () => ipcRenderer.invoke('get-live-stats'),

    // ---- Auto Update ----
    // بيجيب الـ version الحالية من الـ package.json
    getAppVersion:          ()   => ipcRenderer.invoke('get-app-version'),
    // بيبدأ check يدوي
    checkForUpdates:        ()   => ipcRenderer.invoke('check-for-updates'),
    // update متاحة — بيجيب الـ version الجديدة
    onUpdateFound:          (cb) => ipcRenderer.on('update-found',             (_, version)  => cb(version)),
    // مفيش update
    onUpdateNotFound:       (cb) => ipcRenderer.on('update-not-found',         ()            => cb()),
    // تقدم التحميل
    onUpdateProgress:       (cb) => ipcRenderer.on('update-download-progress', (_, progress) => cb(progress)),
    // التحميل خلص — جاهز للـ install
    onUpdateReady:          (cb) => ipcRenderer.on('update-ready',             (_, version)  => cb(version)),
    // خطأ
    onUpdateError:          (cb) => ipcRenderer.on('update-error',             (_, msg)      => cb(msg)),
    // اليوزر يضغط "Download" — invoke بدل send عشان يرجع result فوراً
    startUpdateDownload:    ()   => ipcRenderer.invoke('start-update-download'),
    // اليوزر يضغط "Restart & Install"
    sendRestartUpdate:      ()   => ipcRenderer.send('restart-and-update'),
    // status stream (preparing | downloading | downloaded | error | available)
    onUpdateStatus:         (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),
    // باقي من القديم للـ backward compat
    onUpdateAvailable:      (cb) => ipcRenderer.on('update-found', (_, version) => cb(version)),

    // ---- STARTUP TOGGLE ----
    getStartupEnabled:   ()       => ipcRenderer.invoke('get-startup-enabled'),
    setStartupEnabled:   (enable) => ipcRenderer.invoke('set-startup-enabled', enable),

    // ---- UPDATE NOTES ----
    getPendingUpdateNotes:  ()        => ipcRenderer.invoke('get-pending-update-notes'),
    markUpdateNotesShown:   (version) => ipcRenderer.invoke('mark-update-notes-shown', version),

    // ============================================================
    // ---- STEAM ACCOUNTS ----
    // ============================================================
    getSteamAccounts:     ()           => ipcRenderer.invoke('get-steam-accounts'),
    getSteamImage:        (steamId)    => ipcRenderer.invoke('get-steam-image', steamId),
    switchSteam:          (username)   => ipcRenderer.invoke('switch-steam', username),
    addNewSteamAccount:   ()           => ipcRenderer.invoke('add-new-steam-account'),

    // ============================================================
    // ---- EPIC GAMES ACCOUNTS ----
    // ============================================================
    getEpicProfiles:      ()           => ipcRenderer.invoke('get-epic-profiles'),
    saveEpicAccount:      (accountName) => ipcRenderer.invoke('save-epic-account', { accountName }),
    switchEpic:           (name)       => ipcRenderer.invoke('switch-epic', name),
    addNewEpicAccount:    ()           => ipcRenderer.invoke('add-new-epic-account'),

    // ---- GOG GALAXY SWITCHER PROFILES (not GOG Library Sync accounts) ----
    getGogProfiles:       ()                 => ipcRenderer.invoke('get-gog-profiles'),
    getGogAddState:       ()                 => ipcRenderer.invoke('get-gog-add-state'),
    addNewGogAccount:     (expectedAccountId = null) => ipcRenderer.invoke('add-new-gog-account', expectedAccountId),
    saveGogAccount:       (accountName)       => ipcRenderer.invoke('save-gog-account', { accountName }),
    cancelAddGogAccount:  ()                 => ipcRenderer.invoke('cancel-add-gog-account'),
    switchGogAccount:     (profileId)        => ipcRenderer.invoke('switch-gog-account', profileId),
    renameGogProfile:     (profileId, name)  => ipcRenderer.invoke('rename-gog-profile', profileId, name),
    deleteGogProfile:     (profileId)        => ipcRenderer.invoke('delete-gog-profile', profileId),

    // ============================================================
    // ---- EA APP ACCOUNTS ----
    // ============================================================
    getEAProfiles:        ()           => ipcRenderer.invoke('get-ea-profiles'),
    saveEAAccount:        (accountName) => ipcRenderer.invoke('save-ea-account', { accountName }),
    switchEA:             (name)       => ipcRenderer.invoke('switch-ea', name),
    addNewEAAccount:      ()           => ipcRenderer.invoke('add-new-ea-account'),

    // ============================================================
    // ---- RIOT GAMES ACCOUNTS ----
    // ============================================================
    getRiotProfiles:      ()           => ipcRenderer.invoke('get-riot-profiles'),
    saveRiotAccount:      (accountName) => ipcRenderer.invoke('save-riot-account', { accountName }),
    switchRiot:           (name)       => ipcRenderer.invoke('switch-riot-account', name),
    addNewRiotAccount:    ()           => ipcRenderer.invoke('add-new-riot-account'),

    // ============================================================
    // ---- UBISOFT ACCOUNTS ----
    // ============================================================
    getUbisoftProfiles:   ()           => ipcRenderer.invoke('get-ubisoft-profiles'),
    saveUbisoftAccount:   (accountName) => ipcRenderer.invoke('save-ubisoft-account', { accountName }),
    switchUbisoft:        (name)       => ipcRenderer.invoke('switch-ubisoft-account', name),
    addNewUbisoftAccount: ()           => ipcRenderer.invoke('add-new-ubisoft-account'),

    // ---- Riot Client path helpers (kept for backward compat — UI still calls these) ----
    detectRiotClient:           ()   => ipcRenderer.invoke('detect-riot-client'),
    selectRiotClientManually:   ()   => ipcRenderer.invoke('select-riot-client-manually'),
    clearManualRiotClientPath:  ()   => ipcRenderer.invoke('clear-manual-riot-client-path'),

    // ---- Generic launcher path helpers (all platforms) ----
    detectLauncher:             (platform) => ipcRenderer.invoke('detect-launcher', platform),
    selectLauncherManually:     (platform) => ipcRenderer.invoke('select-launcher-manually', platform),
    getLauncherAvailability:    (platform) => ipcRenderer.invoke('launcher:get-availability', platform),
    clearManualLauncherPath:    (platform) => ipcRenderer.invoke('clear-manual-launcher-path', platform),

    deleteEpicProfile:    (name) => ipcRenderer.invoke('delete-epic-profile', name),
    deleteEAProfile:      (name) => ipcRenderer.invoke('delete-ea-profile', name),
    deleteRiotProfile:    (name) => ipcRenderer.invoke('delete-riot-profile', name),
    deleteUbisoftProfile: (name) => ipcRenderer.invoke('delete-ubisoft-profile', name),

    getDiscordProfiles:   ()       => ipcRenderer.invoke('get-discord-profiles'),
    saveDiscordAccount:   (accountName) => ipcRenderer.invoke('save-discord-account', { accountName }),
    switchDiscordAccount: (name)   => ipcRenderer.invoke('switch-discord-account', name),
    addNewDiscordAccount: ()       => ipcRenderer.invoke('add-new-discord-account'),
    deleteDiscordProfile: (name)   => ipcRenderer.invoke('delete-discord-profile', name),

    renameRiotProfile: (oldName, newName) => ipcRenderer.invoke('rename-riot-profile', oldName, newName),
    renameUbisoftProfile: (oldName, newName) => ipcRenderer.invoke('rename-ubisoft-profile', oldName, newName),
    renameDiscordProfile: (oldName, newName) => ipcRenderer.invoke('rename-discord-profile', oldName, newName),
    renameEpicProfile:    (oldName, newName) => ipcRenderer.invoke('rename-epic-profile', oldName, newName),
    renameEaProfile:      (oldName, newName) => ipcRenderer.invoke('rename-ea-profile', oldName, newName),

    // ── Rockstar ──
    getRockstarProfiles: () => ipcRenderer.invoke('get-rockstar-profiles'),
    saveRockstarAccount: (accountName) => ipcRenderer.invoke('save-rockstar-account', { accountName }),
    switchRockstarAccount: (name) => ipcRenderer.invoke('switch-rockstar-account', name),
    addNewRockstarAccount: () => ipcRenderer.invoke('add-new-rockstar-account'),
    renameRockstarProfile: (oldName, newName) => ipcRenderer.invoke('rename-rockstar-profile', oldName, newName),
    deleteRockstarProfile: (name) => ipcRenderer.invoke('delete-rockstar-profile', name),

    // ============================================================
    // ---- PLATFORM LIBRARY SYNC ----
    // ============================================================
    platformSyncStatus:      ()           => ipcRenderer.invoke('platform-sync:status'),
    platformSyncGetAccounts: (platform)   => ipcRenderer.invoke('platform-sync:get-accounts', platform), // السطر الجديد
    platformSyncLink:        (platform, opts = {}) => ipcRenderer.invoke('platform-sync:link', platform, opts),
    platformSyncSync:        (platform, accountId = null, opts = {}) => ipcRenderer.invoke('platform-sync:sync', platform, accountId, opts),
    platformSyncRefreshEpicPurchaseHistory: (accountId, options = {}) => ipcRenderer.invoke('platform-sync:refresh-epic-purchase-history', accountId, {
        allowInteractiveLogin: options?.allowInteractiveLogin === true,
        operationId: options?.operationId,
    }),
    platformSyncConfirmEpicPurchaseHistoryHydrated: (accountId, operationId, details = {}) => ipcRenderer.invoke(
        'platform-sync:epic-purchase-history-renderer-hydrated', accountId, operationId, { durationMs: details?.durationMs }
    ),
    onEpicPurchaseHistoryRefreshState: (cb) => {
        const handler = (_, payload) => cb(payload);
        ipcRenderer.on('epic-purchase-history-refresh-state', handler);
        return () => ipcRenderer.removeListener('epic-purchase-history-refresh-state', handler);
    },
    platformSyncGetEpicVault: ()           => ipcRenderer.invoke('platform-sync:get-epic-vault'),
    exportVaultShowcase: (snapshot)         => ipcRenderer.invoke('vault-showcase:export', snapshot),
    copyVaultShowcase: (exportId)           => ipcRenderer.invoke('vault-showcase:copy', exportId),
    onVaultShowcaseProgress: (cb) => {
        if (typeof cb !== 'function') return () => {};
        const handler = (_, payload) => cb(payload);
        ipcRenderer.on('vault-showcase:progress', handler);
        return () => ipcRenderer.removeListener('vault-showcase:progress', handler);
    },
    platformSyncGetEpicProgressState: (accountId = null) => ipcRenderer.invoke('platform-sync:get-epic-progress-state', accountId),
    platformSyncRetryEpicPhase: (accountId, phase) => ipcRenderer.invoke('platform-sync:retry-epic-phase', accountId, phase),
    platformSyncRefreshEpicPrices: (accountId) => ipcRenderer.invoke('platform-sync:refresh-epic-prices', accountId),
    onEpicPriceRefreshState: (cb) => {
        const handler = (_, payload) => cb(payload);
        ipcRenderer.on('epic-price-refresh-state', handler);
        return () => ipcRenderer.removeListener('epic-price-refresh-state', handler);
    },
    onEpicSyncProgress: (cb) => {
        const handler = (_, payload) => cb(payload);
        ipcRenderer.on('epic-sync-progress', handler);
        return () => ipcRenderer.removeListener('epic-sync-progress', handler);
    },
    platformSyncGetState:    (platform)   => ipcRenderer.invoke('platform-sync:get-state', platform),
    platformSyncEnrichGogDetails: (gameId) => ipcRenderer.invoke('platform-sync:enrich-gog-details', gameId),
    onPlatformSyncState:     (cb)         => {
        const handler = (_, state) => cb(state);
        ipcRenderer.on('platform-sync:state', handler);
        return () => ipcRenderer.removeListener('platform-sync:state', handler);
    },
    onPlatformSyncCompleted: (cb)         => {
        const handler = (_, state) => cb(state);
        ipcRenderer.on('platform-sync:completed', handler);
        return () => ipcRenderer.removeListener('platform-sync:completed', handler);
    },
    onPlatformSyncFailed:    (cb)         => {
        const handler = (_, state) => cb(state);
        ipcRenderer.on('platform-sync:failed', handler);
        return () => ipcRenderer.removeListener('platform-sync:failed', handler);
    },
    onPlatformLinkStateChanged: (cb) => {
        const handler = (_, payload) => cb(payload);
        ipcRenderer.on('platform-sync:link-state-changed', handler);
        return () => ipcRenderer.removeListener('platform-sync:link-state-changed', handler);
    },
    removePlatformLinkListeners: () => {
        ipcRenderer.removeAllListeners('platform-sync:link-state-changed');
    },
    platformSyncGetCached:   (platform)   => ipcRenderer.invoke('platform-sync:get-cached', platform),
    platformSyncUnlink:      (platform, accountId) => ipcRenderer.invoke('platform-sync:unlink', platform, accountId), // التعديل هنا
    // ---- Baddel Server ----
    lookupGameServer:      (query)            => ipcRenderer.invoke('lookup-game-server', query),
    enrichGameServer:      (gameId, data)     => ipcRenderer.invoke('enrich-game-server', gameId, data),
    importAndEnrichServer: (platform, game)   => ipcRenderer.invoke('import-and-enrich-server', { platform, game }),
    isCooldownActive:      ()                 => ipcRenderer.invoke('baddelapi-cooldown-active'),
    resolveMetadataServer: (params)           => ipcRenderer.invoke('resolve-metadata', params),

    // ---- Shell ----
    openExternal:      (url)     => ipcRenderer.invoke('open-external-url', url),
    openCommunityUrl:  (url)     => ipcRenderer.invoke('open-community-url', url),
    openBaddelSupport: ()        => ipcRenderer.invoke('open-baddel-support'),
    openInstallUrl:    (payload) => ipcRenderer.invoke('launcher:open-install-url', payload),

    // ---- Downloads ----
    downloads: {
        getSnapshot:            ()        => ipcRenderer.invoke('downloads:get-snapshot'),
        getStorageOptions:      ()        => ipcRenderer.invoke('downloads:get-storage-options'),
        prefetchInstallSize:    (payload) => ipcRenderer.invoke('downloads:prefetch-install-size', payload),
        resolveInstallPlan:     (payload) => ipcRenderer.invoke('downloads:resolve-install-plan', payload),
        queueInstall:           (payload) => ipcRenderer.invoke('downloads:queue-install', payload),
        pause:                  (taskId)  => ipcRenderer.invoke('downloads:pause', taskId),
        resume:                 (taskId)  => ipcRenderer.invoke('downloads:resume', taskId),
        cancel:                 (payload) => ipcRenderer.invoke('downloads:cancel', payload),
        retry:                  (taskId)  => ipcRenderer.invoke('downloads:retry', taskId),
        remove:                 (taskId)  => ipcRenderer.invoke('downloads:remove', taskId),
        uninstall:              (taskId)  => ipcRenderer.invoke('downloads:uninstall', taskId),
        startNow:               (taskId)  => ipcRenderer.invoke('downloads:start-now', taskId),
        reorder:                (ids)     => ipcRenderer.invoke('downloads:reorder', ids),
        clearCompleted:         ()        => ipcRenderer.invoke('downloads:clear-completed'),
        getHistory:             ()        => ipcRenderer.invoke('downloads:get-history'),
        clearHistory:           ()        => ipcRenderer.invoke('downloads:clear-history'),
        selectInstallDirectory: (options) => ipcRenderer.invoke('downloads:select-install-directory', options || {}),
        openInstallDirectory:   (taskId)  => ipcRenderer.invoke('downloads:open-install-directory', taskId),
        getSettings:            ()        => ipcRenderer.invoke('downloads:get-settings'),
        updateSettings:         (patch)   => ipcRenderer.invoke('downloads:update-settings', patch || {}),
        getCapabilities:        ()        => ipcRenderer.invoke('downloads:get-capabilities'),
        checkUpdate:            (taskId)  => ipcRenderer.invoke('downloads:check-update', taskId),
        queueMaintenance:       (taskId, operationKind) => ipcRenderer.invoke('downloads:queue-maintenance', { taskId, operationKind }),
        resolveEpicPlayTarget:  (taskId) => ipcRenderer.invoke('downloads:resolve-epic-play-target', taskId),
        launchEpicLegendary:    (gameId, accountId, taskId = null) => ipcRenderer.invoke('downloads:launch-epic-legendary', { gameId, accountId, taskId }),
        getDirectEpicAccounts:  (game) => ipcRenderer.invoke('downloads:get-direct-epic-accounts', game || {}),
        diagnosticsEnabled:      process.env.BADDEL_GOG_DOWNLOAD_DEBUG === '1' || process.env.BADDEL_DOWNLOAD_PROGRESS_DIAGNOSTICS === '1',
        epicTraceEnabled:        process.env.BADDEL_EPIC_DOWNLOAD_TRACE === '1',
        recordDiagnostic:        (payload) => ipcRenderer.invoke('downloads:record-diagnostic', payload),
        onSnapshot: (cb) => {
            const handler = (_, payload) => cb(payload);
            ipcRenderer.on('downloads:snapshot', handler);
            return () => ipcRenderer.removeListener('downloads:snapshot', handler);
        },
        onTaskUpdated: (cb) => {
            const handler = (_, payload) => cb(payload);
            ipcRenderer.on('downloads:task-updated', handler);
            return () => ipcRenderer.removeListener('downloads:task-updated', handler);
        },
        onQueueChanged: (cb) => {
            const handler = (_, payload) => cb(payload);
            ipcRenderer.on('downloads:queue-changed', handler);
            return () => ipcRenderer.removeListener('downloads:queue-changed', handler);
        },
    },

    // ---- Named event subscriptions (allowlisted — no generic channel access) ----
    onGameEnriched: (cb) => {
        const handler = (_, payload) => cb(payload);
        ipcRenderer.on('game-enriched', handler);
        return () => ipcRenderer.removeListener('game-enriched', handler);
    },

    // ---- Analytics Consent ----
    grantAnalyticsConsent:  () => ipcRenderer.invoke('analytics-grant-consent'),
    revokeAnalyticsConsent: () => ipcRenderer.invoke('analytics-revoke-consent'),
    isAnalyticsEnabled:     () => ipcRenderer.invoke('analytics-is-enabled'),
    getConsentShown:        () => ipcRenderer.invoke('get-consent-shown'),
    setConsentShown:        () => ipcRenderer.invoke('set-consent-shown'),
    logHudSensorToggled: (isEnabled) => ipcRenderer.invoke('analytics-log-hud-sensor', isEnabled),
    logGameSpinClicked: (isCustom) => ipcRenderer.invoke('analytics-log-game-spin', isCustom),
    logGameImageChanged:    (type, isReset) => ipcRenderer.invoke('analytics-log-image-changed', type, isReset),
    logFeedbackSent:        () => ipcRenderer.invoke('analytics-log-feedback'),
    trackFeatureEvent:      (eventName, properties) => ipcRenderer.invoke('analytics-track-feature', eventName, properties),

    getDynamicGameExes: (gameId, gamePath) => ipcRenderer.invoke('get-dynamic-game-exes', gameId, gamePath),

    // ---- Creator Page Pack ----
    exportCreatorPagePack:  (defaultName, pageJson) => ipcRenderer.invoke('export-creator-page-pack', defaultName, pageJson),
    importCreatorPagePack:  ()                      => ipcRenderer.invoke('import-creator-page-pack'),
    resolveCreatorPageAssets: (pagePack, gameKey)   => ipcRenderer.invoke('resolve-creator-page-assets', pagePack, gameKey),
    exportCreatorPage:      (defaultName, pageJson) => ipcRenderer.invoke('export-creator-page-pack', defaultName, pageJson),
    importCreatorPage:      ()                      => ipcRenderer.invoke('import-creator-page-pack'),

    // ---- Account Shortcuts ----
    accountShortcuts: {
        list:     ()       => ipcRenderer.invoke('account-shortcuts:list'),
        set:      (params) => ipcRenderer.invoke('account-shortcuts:set', params),
        clear:    (params) => ipcRenderer.invoke('account-shortcuts:clear', params),
        validate: (accel)  => ipcRenderer.invoke('account-shortcuts:validate', accel),
    },

    // ---- Quick Switcher ----
    quickSwitcher: {
        getSettings:    ()        => ipcRenderer.invoke('quick-switcher:get-settings'),
        setSettings:    (payload) => ipcRenderer.invoke('quick-switcher:set-settings', payload),
        setHotkey:      (accel)   => ipcRenderer.invoke('quick-switcher:set-hotkey', accel),
        clearHotkey:    ()        => ipcRenderer.invoke('quick-switcher:clear-hotkey'),
        validateHotkey: (accel)   => ipcRenderer.invoke('quick-switcher:validate-hotkey', accel),
        listAccounts:   ()        => ipcRenderer.invoke('quick-switcher:list-accounts'),
        listGames:      ()        => ipcRenderer.invoke('quick-switcher:list-games'),
        switchAccount:  (payload) => ipcRenderer.invoke('quick-switcher:switch-account', payload),
        launchGame:     (gameId, options = {}) => ipcRenderer.invoke('launch-game', null, gameId, null, null, options || {}),
        endGame:        (payload) => ipcRenderer.invoke('quick-switcher:end-game', payload),
        hide:           ()        => ipcRenderer.invoke('quick-switcher:hide'),
        toggle:         ()        => ipcRenderer.invoke('quick-switcher:toggle'),
        onShow:        (cb)    => ipcRenderer.on('qs:show', (_, data) => cb(data)),
        onHide:        (cb)    => ipcRenderer.on('qs:hide', (_, data) => cb(data)),
        rendererReady: ()      => ipcRenderer.send('qs:renderer-ready'),
        visibleReady:  (data)  => ipcRenderer.send('qs:visible-ready', data),
    },

    // ---- Development-only performance diagnostics ----
    performanceDiagnostics: {
        enabled: performanceDiagnosticsEnabled,
        snapshot: () => performanceDiagnosticsEnabled
            ? ipcRenderer.invoke('perf-diagnostics:snapshot')
            : Promise.resolve({ enabled: false }),
        report: (report) => performanceDiagnosticsEnabled
            ? ipcRenderer.invoke('perf-diagnostics:renderer-report', report)
            : Promise.resolve({ accepted: false }),
    },

    // ---- Runtime diagnostics ----
    logRuntimeError: (message) => ipcRenderer.invoke('log-runtime-error', message),
});
