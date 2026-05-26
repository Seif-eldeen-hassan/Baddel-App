// ============================================================
// BADDEL LAUNCHER - PRELOAD (Context Bridge)
// ============================================================
const { contextBridge, ipcRenderer, webUtils, shell } = require('electron');

// Expose the image-cache directory URL synchronously so domUtils.js can
// initialise its file:// trust policy before any renderer code runs.
// Uses sendSync so it is available immediately (no async IPC round-trip needed).
// Wrapped in try/catch so a failure here NEVER prevents electronAPI from loading.
try {
    const cacheUrl = ipcRenderer.sendSync('get-image-cache-dir-url-sync');
    if (cacheUrl) contextBridge.exposeInMainWorld('__BADDEL_CACHE_URL__', cacheUrl);
} catch (err) {
    console.warn('[Preload] Could not resolve image cache URL:', err && err.message);
}

contextBridge.exposeInMainWorld('electronAPI', {

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
        ipcRenderer.removeAllListeners('library-updated');
        ipcRenderer.on('library-updated', (_, games) => cb(games));
    },
    onGameImageUpdated:     (cb)                      => ipcRenderer.on('game-image-updated', (_, game) => cb(game)),
    onGameDeletedPermanently: (cb)                    => {
        ipcRenderer.removeAllListeners('game-deleted-permanently');
        ipcRenderer.on('game-deleted-permanently', (_, payload) => cb(payload));
    },
    onAllGamesCoverCached:  (cb)                      => ipcRenderer.on('all-games-cover-cached', (_, payload) => cb(payload)),

    // ---- Images ----
    selectImage:            ()                        => ipcRenderer.invoke('select-game-image'),
    updateGameImage:        (id, imgPath, type)       => ipcRenderer.invoke('update-game-image', id, imgPath, type),
    resetGameImage:         (id, type)                => ipcRenderer.invoke('reset-game-image', id, type),
    cacheImage:             (url, gameId, type)       => ipcRenderer.invoke('cache-image', url, gameId, type),
    getCachedImage:         (gameId, type)             => ipcRenderer.invoke('get-cached-image', gameId, type),
    probeLocalImage:        (fileUrl)                 => ipcRenderer.invoke('probe-local-image', fileUrl),
    cacheAllAssets:         (assets, gameId)          => ipcRenderer.invoke('cache-all-assets', assets, gameId),
    pruneImageCache:        ()                        => ipcRenderer.invoke('prune-image-cache'),
    getImageCacheDirUrl:    ()                        => ipcRenderer.invoke('get-image-cache-dir-url'),
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
    saveEpicAccount:      (name)       => ipcRenderer.invoke('save-epic-account', name),
    switchEpic:           (name)       => ipcRenderer.invoke('switch-epic', name),
    addNewEpicAccount:    ()           => ipcRenderer.invoke('add-new-epic-account'),

    // ============================================================
    // ---- EA APP ACCOUNTS ----
    // ============================================================
    getEAProfiles:        ()           => ipcRenderer.invoke('get-ea-profiles'),
    saveEAAccount:        (name)       => ipcRenderer.invoke('save-ea-account', name),
    switchEA:             (name)       => ipcRenderer.invoke('switch-ea', name),
    addNewEAAccount:      ()           => ipcRenderer.invoke('add-new-ea-account'),

    // ============================================================
    // ---- RIOT GAMES ACCOUNTS ----
    // ============================================================
    getRiotProfiles:      ()           => ipcRenderer.invoke('get-riot-profiles'),
    saveRiotAccount:      (name)       => ipcRenderer.invoke('save-riot-account', name),
    switchRiot:           (name)       => ipcRenderer.invoke('switch-riot-account', name),
    addNewRiotAccount:    ()           => ipcRenderer.invoke('add-new-riot-account'),

    // ============================================================
    // ---- UBISOFT ACCOUNTS ----
    // ============================================================
    getUbisoftProfiles:   ()           => ipcRenderer.invoke('get-ubisoft-profiles'),
    saveUbisoftAccount:   (name)       => ipcRenderer.invoke('save-ubisoft-account', name),
    switchUbisoft:        (name)       => ipcRenderer.invoke('switch-ubisoft-account', name),
    addNewUbisoftAccount: ()           => ipcRenderer.invoke('add-new-ubisoft-account'),

    // ---- Riot Client path helpers (kept for backward compat — UI still calls these) ----
    detectRiotClient:           ()   => ipcRenderer.invoke('detect-riot-client'),
    selectRiotClientManually:   ()   => ipcRenderer.invoke('select-riot-client-manually'),
    clearManualRiotClientPath:  ()   => ipcRenderer.invoke('clear-manual-riot-client-path'),

    // ---- Generic launcher path helpers (all platforms) ----
    detectLauncher:             (platform) => ipcRenderer.invoke('detect-launcher', platform),
    selectLauncherManually:     (platform) => ipcRenderer.invoke('select-launcher-manually', platform),
    clearManualLauncherPath:    (platform) => ipcRenderer.invoke('clear-manual-launcher-path', platform),

    deleteEpicProfile:    (name) => ipcRenderer.invoke('delete-epic-profile', name),
    deleteEAProfile:      (name) => ipcRenderer.invoke('delete-ea-profile', name),
    deleteRiotProfile:    (name) => ipcRenderer.invoke('delete-riot-profile', name),
    deleteUbisoftProfile: (name) => ipcRenderer.invoke('delete-ubisoft-profile', name),

    getDiscordProfiles:   ()       => ipcRenderer.invoke('get-discord-profiles'),
    saveDiscordAccount:   (name)   => ipcRenderer.invoke('save-discord-account', name),
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
    saveRockstarAccount: (name) => ipcRenderer.invoke('save-rockstar-account', name),
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
    platformSyncSync:        (platform, accountId) => ipcRenderer.invoke('platform-sync:sync', platform, accountId),
    platformSyncGetState:    (platform)   => ipcRenderer.invoke('platform-sync:get-state', platform),
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
    openInstallUrl:    (payload) => ipcRenderer.invoke('launcher:open-install-url', payload),

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

    getDynamicGameExes: (gameId, gamePath) => ipcRenderer.invoke('get-dynamic-game-exes', gameId, gamePath),

    // ---- Creator Page Pack ----
    exportCreatorPagePack:  (defaultName, pageJson) => ipcRenderer.invoke('export-creator-page-pack', defaultName, pageJson),
    importCreatorPagePack:  ()                      => ipcRenderer.invoke('import-creator-page-pack'),
    resolveCreatorPageAssets: (pagePack, gameKey)   => ipcRenderer.invoke('resolve-creator-page-assets', pagePack, gameKey),
    exportCreatorPage:      (defaultName, pageJson) => ipcRenderer.invoke('export-creator-page-pack', defaultName, pageJson),
    importCreatorPage:      ()                      => ipcRenderer.invoke('import-creator-page-pack'),
});