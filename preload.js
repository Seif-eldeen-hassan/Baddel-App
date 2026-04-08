// ============================================================
// BADDEL LAUNCHER - PRELOAD (Context Bridge)
// ============================================================
const { contextBridge, ipcRenderer, webUtils, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

    // ---- Library ----
    getGames:               ()                        => ipcRenderer.invoke('get-installed-games'),
    scanAllGames:           ()                        => ipcRenderer.invoke('scan-all-games'),
    addManualGame:          (exePath, customName)     => ipcRenderer.invoke('add-manual-game', exePath, customName),
    removeGame:             (id)                      => ipcRenderer.invoke('remove-game', id),
    renameGame:             (id, name)                => ipcRenderer.invoke('rename-game', id, name),
    reorderLibrary:         (ids)                     => ipcRenderer.invoke('reorder-library', ids),
    unhideAllGames:         ()                        => ipcRenderer.invoke('unhide-all-games'),
    getHiddenGames:         ()                        => ipcRenderer.invoke('get-hidden-games'),
    restoreSpecificGames:   (ids)                     => ipcRenderer.invoke('restore-specific-games', ids),
    deleteGamePermanently:  (id)                      => ipcRenderer.invoke('delete-game-permanently', id),
    onLibraryUpdated:       (cb)                      => ipcRenderer.on('library-updated', (_, games) => cb(games)),
    onGameImageUpdated:     (cb)                      => ipcRenderer.on('game-image-updated', (_, game) => cb(game)),

    // ---- Images ----
    selectImage:            ()                        => ipcRenderer.invoke('select-game-image'),
    updateGameImage:        (id, imgPath, type)       => ipcRenderer.invoke('update-game-image', id, imgPath, type),
    resetGameImage:         (id, type)                => ipcRenderer.invoke('reset-game-image', id, type),
    cacheImage:             (url, gameId, type)       => ipcRenderer.invoke('cache-image', url, gameId, type),
    getCachedImage:         (gameId, type)             => ipcRenderer.invoke('get-cached-image', gameId, type),
    cacheAllAssets:         (assets, gameId)          => ipcRenderer.invoke('cache-all-assets', assets, gameId),
    getFilePath:            (file)                    => webUtils.getPathForFile(file),

    // ---- Metadata & Playtime ----
    getMetadata:            (gameName, hints = {})    => ipcRenderer.invoke('get-game-metadata', gameName, hints),
    getGameAchievements:    (payload)                 => ipcRenderer.invoke('get-game-achievements', payload),
    saveMetadata:           (gameId, meta)            => ipcRenderer.invoke('save-game-metadata', gameId, meta),
    updatePlaytime:         (gameId, minutes)         => ipcRenderer.invoke('update-playtime', gameId, minutes),
    onPlaytimeUpdated:      (cb)                      => ipcRenderer.on('playtime-updated', (_, data) => cb(data)),

    // ---- Launch ----
    launchGame:             (command, gameId, gamePath, gameName) =>
                                ipcRenderer.invoke('launch-game', command, gameId, gamePath, gameName),

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
    onUpdateAvailable:  (cb) => ipcRenderer.on('update-available', (_, version) => cb(version)),
    sendRestartUpdate:  ()   => ipcRenderer.send('restart-and-update'),

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
    platformSyncLink:        (platform)   => ipcRenderer.invoke('platform-sync:link', platform),
    platformSyncSync:        (platform, accountId) => ipcRenderer.invoke('platform-sync:sync', platform, accountId),
    platformSyncGetState:    (platform)   => ipcRenderer.invoke('platform-sync:get-state', platform),
    onPlatformSyncState:     (cb)         => {
        const handler = (_, state) => cb(state);
        ipcRenderer.on('platform-sync:state', handler);
        return () => ipcRenderer.removeListener('platform-sync:state', handler);
    },
    platformSyncGetCached:   (platform)   => ipcRenderer.invoke('platform-sync:get-cached', platform),
    platformSyncUnlink:      (platform, accountId) => ipcRenderer.invoke('platform-sync:unlink', platform, accountId), // التعديل هنا
    // ---- Shell ----
    openExternal: (url) => ipcRenderer.invoke('open-external-url', url),

    // ---- Analytics Consent ----
    grantAnalyticsConsent:  () => ipcRenderer.invoke('analytics-grant-consent'),
    revokeAnalyticsConsent: () => ipcRenderer.invoke('analytics-revoke-consent'),
    isAnalyticsEnabled:     () => ipcRenderer.invoke('analytics-is-enabled'),
    logHudSensorToggled: (isEnabled) => ipcRenderer.invoke('analytics-log-hud-sensor', isEnabled),
    logGameSpinClicked: (isCustom) => ipcRenderer.invoke('analytics-log-game-spin', isCustom),
    logGameImageChanged:    (type, isReset) => ipcRenderer.invoke('analytics-log-image-changed', type, isReset),
    logFeedbackSent:        () => ipcRenderer.invoke('analytics-log-feedback'),
});
