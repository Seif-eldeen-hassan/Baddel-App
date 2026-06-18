# IPC Contracts — Baddel Launcher

**Generated:** 2026-06-17  
**Purpose:** Safety artifact for the Clean Architecture migration. Every IPC channel is documented here. Any migration step that changes a channel name, its argument shape, or its return type is a **breaking change** and must be flagged explicitly.

> **Rule:** Channel names are frozen. Never rename a channel during a structural migration. If a rename is ever needed, it requires a dedicated PR with a renderer-side compatibility shim.

---

## How to Read This Document

Each entry uses the following format:

```
CHANNEL:    <exact string passed to ipcMain.handle / ipcMain.on / ipcRenderer.invoke / ipcRenderer.send>
TYPE:       handle (async request/reply) | on (fire-and-forget or sync)
INPUT:      argument list with types
OUTPUT:     return value shape
OWNER FILE: the main-process file that registers the handler
USED IN:    the renderer/preload file that calls it
NOTES:      special behaviors, invariants, or migration warnings
```

---

## Persisted Configuration Keys (electron-store / disk)

These key names must never change during migration. They survive app restarts.

| Key / File | Purpose | Owner |
|---|---|---|
| `userData/games-db.json` | Full game library | `gameScanner.js` |
| `userData/BaddelLauncher/collections.json` | Collections | `collectionsHandler.js` |
| `userData/platform-sync/steam_accounts.json` | Steam account list | `platformSync.js` |
| `userData/platform-sync/steam_library_merged.json` | Merged Steam library | `platformSync.js` |
| `userData/platform-sync/epic_library_merged.json` | Merged Epic library | `platformSync.js` |
| `userData/platform-sync/steam_bridge_cache.json` | Steam bridge cache | `steamBridge.js` |
| `userData/update-notes-state.json` | Which update notes were shown | `main.js` |
| `userData/analytics_consent_shown.json` | Whether consent dialog was shown | `analyticsHandlers.js` |
| `userData/image_cache/` | WebP image cache | `imageWebpCache.js` |

---

## Section 1 — Game Library

---

```
CHANNEL:    get-installed-games
TYPE:       handle
INPUT:      none
OUTPUT:     Game[]  (array of game objects from games-db.json, or [] on error)
OWNER FILE: handlers/installedGamesHandlers.js
USED IN:    preload.js → electronAPI.getGames()
            src/js/app.js, src/js/accounts.js
NOTES:      Returns stored games immediately. Launches background scan in parallel.
            Only one background scan may run at a time (_backgroundScanInProgress guard).
            Background scan fires 'library-updated' push event when complete.
```

```
CHANNEL:    get-game-by-id
TYPE:       handle
INPUT:      gameId: string
OUTPUT:     Game | null
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.getGameById(id)
            src/js/game-details.js
NOTES:      Lightweight read — does not trigger background scan.
```

```
CHANNEL:    scan-all-games
TYPE:       handle
INPUT:      none
OUTPUT:     Game[]
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.scanAllGames()
```

```
CHANNEL:    add-manual-game
TYPE:       handle
INPUT:      exePath: string, customName: string | undefined
OUTPUT:     { status: 'success' | 'error', game?: Game, error?: string }
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.addManualGame(exePath, customName)
NOTES:      Handles .lnk shortcuts transparently (reads target via shell.readShortcutLink).
            Fires 'game-image-updated' push event after metadata is fetched.
```

```
CHANNEL:    remove-game
TYPE:       handle
INPUT:      id: string (game MD5 hash)
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.removeGame(id)
```

```
CHANNEL:    rename-game
TYPE:       handle
INPUT:      id: string, name: string (max 256 chars)
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.renameGame(id, name)
```

```
CHANNEL:    reorder-library
TYPE:       handle
INPUT:      ids: string[]
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.reorderLibrary(ids)
```

```
CHANNEL:    unhide-all-games
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.unhideAllGames()
```

```
CHANNEL:    get-hidden-games
TYPE:       handle
INPUT:      none
OUTPUT:     Game[]
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.getHiddenGames()
```

```
CHANNEL:    restore-specific-games
TYPE:       handle
INPUT:      ids: string[]
OUTPUT:     { status: 'success' | 'error', count?: number }
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.restoreSpecificGames(ids)
```

```
CHANNEL:    delete-game-permanently
TYPE:       handle
INPUT:      id: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.deleteGamePermanently(id)
NOTES:      Fires 'game-deleted-permanently' push event on success: { id }
```

```
CHANNEL:    get-dynamic-game-exes
TYPE:       handle
INPUT:      gameId: string, gamePath: string
OUTPUT:     string[]  (list of .exe paths found under gamePath)
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.getDynamicGameExes(gameId, gamePath)
```

---

## Section 1B — Library Push Events (main → renderer)

```
CHANNEL:    library-updated
TYPE:       on (push — main sends, renderer receives)
PAYLOAD:    Game[]
OWNER FILE: handlers/installedGamesHandlers.js (sends), main.js (sends)
USED IN:    preload.js → electronAPI.onLibraryUpdated(cb)
NOTES:      Multi-subscriber fanout implemented in preload.js via _libraryUpdatedCallbacks Set.
            Both app.js and accounts.js subscribe independently.
```

```
CHANNEL:    game-image-updated
TYPE:       on (push)
PAYLOAD:    Game
OWNER FILE: handlers/installedGamesHandlers.js, handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.onGameImageUpdated(cb)
```

```
CHANNEL:    game-deleted-permanently
TYPE:       on (push)
PAYLOAD:    { id: string }
OWNER FILE: handlers/gameLibraryHandlers.js
USED IN:    preload.js → electronAPI.onGameDeletedPermanently(cb)
```

```
CHANNEL:    all-games-cover-cached
TYPE:       on (push)
PAYLOAD:    varies
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.onAllGamesCoverCached(cb)
```

---

## Section 2 — Images & Cache

---

```
CHANNEL:    get-image-cache-dir-url-sync
TYPE:       on (synchronous — uses event.returnValue, NOT handle)
INPUT:      none
OUTPUT:     string (file:// URL of image cache directory)
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js (top-level, before contextBridge — ipcRenderer.sendSync)
NOTES:      CRITICAL: This is the only synchronous IPC in the app.
            Must be registered before app.whenReady() so it is available at preload load time.
            Returns '' on error (graceful degradation).
```

```
CHANNEL:    get-image-cache-dir-url
TYPE:       handle
INPUT:      none
OUTPUT:     string (file:// URL of image cache directory + '/')
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.getImageCacheDirUrl()
```

```
CHANNEL:    cache-image
TYPE:       handle
INPUT:      url: string (max 2048), gameId: string, type: string (max 32)
OUTPUT:     string (local file:// URL, or original URL on failure)
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.cacheImage(url, gameId, type)
```

```
CHANNEL:    cache-all-assets
TYPE:       handle
INPUT:      assets: { [type: string]: url: string }, gameId: string
OUTPUT:     { [type: string]: localUrl: string }
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.cacheAllAssets(assets, gameId)
```

```
CHANNEL:    prune-image-cache
TYPE:       handle
INPUT:      none
OUTPUT:     { pruned: number, protected: number, freshSkipped: number, error?: string }
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.pruneImageCache()
```

```
CHANNEL:    select-game-image
TYPE:       handle
INPUT:      none
OUTPUT:     string | null (file path selected by user, or null if canceled)
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.selectImage()
```

```
CHANNEL:    probe-local-image
TYPE:       handle
INPUT:      fileUrl: string
OUTPUT:     boolean (true if file:// image exists on disk and size > 0)
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.probeLocalImage(fileUrl)
```

```
CHANNEL:    get-cached-image
TYPE:       handle
INPUT:      gameId: string, type: string (default 'cover')
OUTPUT:     string | null (file:// URL of cached image, or null)
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.getCachedImage(gameId, type)
```

```
CHANNEL:    update-game-image
TYPE:       handle
INPUT:      id: string, imgPath: string, type: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.updateGameImage(id, imgPath, type)
```

```
CHANNEL:    reset-game-image
TYPE:       handle
INPUT:      id: string, type: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/imageHandlers.js
USED IN:    preload.js → electronAPI.resetGameImage(id, type)
```

---

## Section 3 — Metadata

---

```
CHANNEL:    get-game-metadata
TYPE:       handle
INPUT:      gameName: string, hints: { platform?, id?, appId?, namespace?, allIds?, ... }
OUTPUT:     MetadataObject | { _mrmStatus, _cooldownUntil } | { _serverData, source } | null
OWNER FILE: handlers/gameMetadataHandlers.js
USED IN:    preload.js → electronAPI.getMetadata(gameName, hints)
NOTES:      Routes through Steam/Epic fast path OR MetadataResolutionManager (MRM) for others.
            MRM enforces cooldown/not_found/ambiguous state across restarts.
```

```
CHANNEL:    save-game-metadata
TYPE:       handle
INPUT:      id: string, meta: object, opts: object
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/localMetadataHandlers.js
USED IN:    preload.js → electronAPI.saveMetadata(gameId, meta, opts)
NOTES:      Fires 'game-image-updated' push event on success.
```

```
CHANNEL:    save-full-metadata
TYPE:       handle
INPUT:      gameId: string, title: string, platform: string, meta: object
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/localMetadataHandlers.js
USED IN:    preload.js → electronAPI.saveFullMetadata(gameId, title, platform, meta)
```

```
CHANNEL:    load-full-metadata
TYPE:       handle
INPUT:      gameId: string
OUTPUT:     object | null
OWNER FILE: handlers/localMetadataHandlers.js
USED IN:    preload.js → electronAPI.loadFullMetadata(gameId)
```

```
CHANNEL:    get-game-achievements
TYPE:       handle
INPUT:      payload: { appId?, gameName?, steamUsername?, ... }
OUTPUT:     { status: 'success' | 'error', achievements?: Achievement[], message?: string }
OWNER FILE: handlers/achievementHandlers.js
USED IN:    preload.js → electronAPI.getGameAchievements(payload)
NOTES:      Serialized through _achievementIpcChain in main.js — only one fetch at a time.
            Calls Python Steam bridge via steamBridge.js.
```

---

## Section 4 — Baddel Server API

---

```
CHANNEL:    lookup-game-server
TYPE:       handle
INPUT:      query: { title?, platform?, id?, uuid? }
OUTPUT:     NormalizedMetadata | null
OWNER FILE: handlers/baddelApiHandlers.js
USED IN:    preload.js → electronAPI.lookupGameServer(query)
```

```
CHANNEL:    enrich-game-server
TYPE:       handle
INPUT:      gameId: string (server UUID), clientData: object
OUTPUT:     { status: 'accepted' | 'not_found' } | null
OWNER FILE: handlers/baddelApiHandlers.js
USED IN:    preload.js → electronAPI.enrichGameServer(gameId, data)
```

```
CHANNEL:    import-and-enrich-server
TYPE:       handle
INPUT:      { platform: string, game: object }
OUTPUT:     { _serverData: object, source: string, info: object } | null
OWNER FILE: handlers/baddelApiHandlers.js
USED IN:    preload.js → electronAPI.importAndEnrichServer(platform, game)
NOTES:      Only Steam and Epic are supported in this release.
```

```
CHANNEL:    baddelapi-cooldown-active
TYPE:       handle
INPUT:      none
OUTPUT:     boolean
OWNER FILE: handlers/baddelApiHandlers.js
USED IN:    preload.js → electronAPI.isCooldownActive()
```

```
CHANNEL:    resolve-metadata
TYPE:       handle
INPUT:      params: object (title, platform, hints, etc.)
OUTPUT:     ResolveMetadataResult | null
OWNER FILE: handlers/baddelApiHandlers.js
USED IN:    preload.js → electronAPI.resolveMetadataServer(params)
```

```
CHANNEL:    game-enriched
TYPE:       on (push — server poll fires this)
PAYLOAD:    { gameId, meta, ... }
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.onGameEnriched(cb)
```

---

## Section 5 — Playtime

---

```
CHANNEL:    update-playtime
TYPE:       handle
INPUT:      id: string, minutes: number
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/playtimeHandlers.js
USED IN:    preload.js → electronAPI.updatePlaytime(gameId, minutes)
```

```
CHANNEL:    set-time-tracking-enabled
TYPE:       handle
INPUT:      gameId: string, enabled: boolean
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/playtimeHandlers.js
USED IN:    preload.js → electronAPI.setTimeTrackingEnabled(gameId, enabled)
NOTES:      Also stops active tracker immediately if disabled mid-session.
```

```
CHANNEL:    get-time-tracking-enabled
TYPE:       handle
INPUT:      gameId: string
OUTPUT:     { status: 'success' | 'error', enabled?: boolean }
OWNER FILE: handlers/playtimeHandlers.js
USED IN:    preload.js → electronAPI.getTimeTrackingEnabled(gameId)
```

```
CHANNEL:    playtime-updated
TYPE:       on (push)
PAYLOAD:    { gameId: string, totalMinutes: number, sessionMinutes: number }
OWNER FILE: main.js (fires during active game tracking)
USED IN:    preload.js → electronAPI.onPlaytimeUpdated(cb)
```

---

## Section 6 — Game Launcher

---

```
CHANNEL:    launch-game
TYPE:       handle
INPUT:      command: string | null, gameId: string, gamePath: string | null,
            gameName: string | null, options: { platform?, ... }
OUTPUT:     { status: 'success' | 'error', message?: string }
OWNER FILE: handlers/launchHandlers.js
USED IN:    preload.js → electronAPI.launchGame(...)
NOTES:      Supports both legacy 5-arg call and new object-based call (see preload.js shim).
            Handles process monitoring, playtime session start, and per-platform launch strategies.
```

```
CHANNEL:    launcher:open-install-url
TYPE:       handle
INPUT:      payload: { platform: string, url?: string, gameId?: string }
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/launchHandlers.js
USED IN:    preload.js → electronAPI.openInstallUrl(payload)
```

```
CHANNEL:    detect-riot-client
TYPE:       handle
INPUT:      none
OUTPUT:     { found: boolean, path?: string, diagnostics?: object }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.detectRiotClient()
```

```
CHANNEL:    select-riot-client-manually
TYPE:       handle
INPUT:      none (opens system file dialog)
OUTPUT:     { success: boolean, path?: string, platform?: string, canceled?: boolean, message?: string }
OWNER FILE: handlers/launcherPathHandlers.js
USED IN:    preload.js → electronAPI.selectRiotClientManually()
```

```
CHANNEL:    clear-manual-riot-client-path
TYPE:       handle
INPUT:      none
OUTPUT:     { success: boolean }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.clearManualRiotClientPath()
```

```
CHANNEL:    detect-launcher
TYPE:       handle
INPUT:      platform: string
OUTPUT:     { found: boolean, path?: string, platform: string, diagnostics?: object }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.detectLauncher(platform)
```

```
CHANNEL:    select-launcher-manually
TYPE:       handle
INPUT:      platform: string (opens system file dialog)
OUTPUT:     { success: boolean, path?: string, platform?: string, canceled?: boolean, message?: string }
OWNER FILE: handlers/launcherPathHandlers.js
USED IN:    preload.js → electronAPI.selectLauncherManually(platform)
```

```
CHANNEL:    clear-manual-launcher-path
TYPE:       handle
INPUT:      platform: string
OUTPUT:     { success: boolean, platform: string }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.clearManualLauncherPath(platform)
```

---

## Section 7 — Collections

---

```
CHANNEL:    get-collections
TYPE:       handle
INPUT:      none
OUTPUT:     Collection[]
OWNER FILE: handlers/collectionHandlers.js
USED IN:    preload.js → electronAPI.getCollections()
```

```
CHANNEL:    create-collection
TYPE:       handle
INPUT:      name: string, img: string | null
OUTPUT:     { status: 'success' | 'error', collection?: Collection }
OWNER FILE: handlers/collectionHandlers.js
USED IN:    preload.js → electronAPI.createCollection(name, img)
```

```
CHANNEL:    add-game-collection
TYPE:       handle
INPUT:      colId: string, gameId: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/collectionHandlers.js
USED IN:    preload.js → electronAPI.addGameToCollection(colId, gameId)
```

```
CHANNEL:    remove-game-collection
TYPE:       handle
INPUT:      colId: string, gameId: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/collectionHandlers.js
USED IN:    preload.js → electronAPI.removeGameFromCollection(colId, gameId)
```

```
CHANNEL:    delete-collection
TYPE:       handle
INPUT:      colId: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/collectionHandlers.js
USED IN:    preload.js → electronAPI.deleteCollection(colId)
```

```
CHANNEL:    reorder-collection
TYPE:       handle
INPUT:      colId: string, order: string[]
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/collectionHandlers.js
USED IN:    preload.js → electronAPI.reorderCollection(colId, order)
```

```
CHANNEL:    update-collection
TYPE:       handle
INPUT:      colId: string, name: string, img: string | null
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/collectionHandlers.js
USED IN:    preload.js → electronAPI.updateCollection(colId, name, img)
```

---

## Section 8 — Accounts

---

### Steam

```
CHANNEL:    get-steam-accounts
TYPE:       handle
INPUT:      none
OUTPUT:     SteamAccount[]
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.getSteamAccounts()
```

```
CHANNEL:    get-steam-image
TYPE:       handle
INPUT:      steamId: string
OUTPUT:     string | null (avatar URL)
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.getSteamImage(steamId)
```

```
CHANNEL:    switch-steam
TYPE:       handle
INPUT:      username: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.switchSteam(username)
```

```
CHANNEL:    add-new-steam-account
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.addNewSteamAccount()
```

### Epic Games

```
CHANNEL:    get-epic-profiles
TYPE:       handle
INPUT:      none
OUTPUT:     EpicProfile[]
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.getEpicProfiles()
```

```
CHANNEL:    save-epic-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.saveEpicAccount(name)
```

```
CHANNEL:    switch-epic
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.switchEpic(name)
```

```
CHANNEL:    add-new-epic-account
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.addNewEpicAccount()
```

```
CHANNEL:    delete-epic-profile
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.deleteEpicProfile(name)
```

```
CHANNEL:    rename-epic-profile
TYPE:       handle
INPUT:      oldName: string, newName: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.renameEpicProfile(oldName, newName)
```

### EA App

```
CHANNEL:    get-ea-profiles
TYPE:       handle
INPUT:      none
OUTPUT:     EAProfile[]
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.getEAProfiles()
```

```
CHANNEL:    save-ea-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.saveEAAccount(name)
```

```
CHANNEL:    switch-ea
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.switchEA(name)
```

```
CHANNEL:    add-new-ea-account
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.addNewEAAccount()
```

```
CHANNEL:    delete-ea-profile
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.deleteEAProfile(name)
```

```
CHANNEL:    rename-ea-profile
TYPE:       handle
INPUT:      oldName: string, newName: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.renameEaProfile(oldName, newName)
```

### Riot Games

```
CHANNEL:    get-riot-profiles
TYPE:       handle
INPUT:      none
OUTPUT:     RiotProfile[]
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.getRiotProfiles()
```

```
CHANNEL:    save-riot-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.saveRiotAccount(name)
```

```
CHANNEL:    switch-riot-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.switchRiot(name)
```

```
CHANNEL:    add-new-riot-account
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.addNewRiotAccount()
```

```
CHANNEL:    delete-riot-profile
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.deleteRiotProfile(name)
```

```
CHANNEL:    rename-riot-profile
TYPE:       handle
INPUT:      oldName: string, newName: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.renameRiotProfile(oldName, newName)
```

### Ubisoft Connect

```
CHANNEL:    get-ubisoft-profiles
TYPE:       handle
INPUT:      none
OUTPUT:     UbisoftProfile[]
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.getUbisoftProfiles()
```

```
CHANNEL:    save-ubisoft-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.saveUbisoftAccount(name)
```

```
CHANNEL:    switch-ubisoft-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.switchUbisoft(name)
```

```
CHANNEL:    add-new-ubisoft-account
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.addNewUbisoftAccount()
```

```
CHANNEL:    delete-ubisoft-profile
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.deleteUbisoftProfile(name)
```

```
CHANNEL:    rename-ubisoft-profile
TYPE:       handle
INPUT:      oldName: string, newName: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.renameUbisoftProfile(oldName, newName)
```

### Discord

```
CHANNEL:    get-discord-profiles
TYPE:       handle
INPUT:      none
OUTPUT:     DiscordProfile[]
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.getDiscordProfiles()
```

```
CHANNEL:    save-discord-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.saveDiscordAccount(name)
```

```
CHANNEL:    switch-discord-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.switchDiscordAccount(name)
```

```
CHANNEL:    add-new-discord-account
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.addNewDiscordAccount()
```

```
CHANNEL:    delete-discord-profile
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.deleteDiscordProfile(name)
```

```
CHANNEL:    rename-discord-profile
TYPE:       handle
INPUT:      oldName: string, newName: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.renameDiscordProfile(oldName, newName)
```

### Rockstar

```
CHANNEL:    get-rockstar-profiles
TYPE:       handle
INPUT:      none
OUTPUT:     RockstarProfile[]
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.getRockstarProfiles()
```

```
CHANNEL:    save-rockstar-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.saveRockstarAccount(name)
```

```
CHANNEL:    switch-rockstar-account
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.switchRockstarAccount(name)
```

```
CHANNEL:    add-new-rockstar-account
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.addNewRockstarAccount()
```

```
CHANNEL:    rename-rockstar-profile
TYPE:       handle
INPUT:      oldName: string, newName: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.renameRockstarProfile(oldName, newName)
```

```
CHANNEL:    delete-rockstar-profile
TYPE:       handle
INPUT:      name: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: accountsHandler.js
USED IN:    preload.js → electronAPI.deleteRockstarProfile(name)
```

---

## Section 9 — Platform Sync

---

```
CHANNEL:    platform-sync:status
TYPE:       handle
INPUT:      none
OUTPUT:     { [platform]: SyncState }  (one key per platform: steam, epic, riot, ea, ubisoft, rockstar, xbox, discord)
OWNER FILE: platformSync.js → registerPlatformSyncHandlers()
USED IN:    preload.js → electronAPI.platformSyncStatus()
```

```
CHANNEL:    platform-sync:get-accounts
TYPE:       handle
INPUT:      platform: string
OUTPUT:     Account[]
OWNER FILE: platformSync.js → registerPlatformSyncHandlers()
USED IN:    preload.js → electronAPI.platformSyncGetAccounts(platform)
```

```
CHANNEL:    platform-sync:link
TYPE:       handle
INPUT:      platform: string, opts: object
OUTPUT:     { status: 'success' | 'error', ... }
OWNER FILE: platformSync.js → registerPlatformSyncHandlers()
USED IN:    preload.js → electronAPI.platformSyncLink(platform, opts)
```

```
CHANNEL:    platform-sync:sync
TYPE:       handle
INPUT:      platform: string, accountId: string
OUTPUT:     { status: 'success' | 'error', ... }
OWNER FILE: platformSync.js → registerPlatformSyncHandlers()
USED IN:    preload.js → electronAPI.platformSyncSync(platform, accountId)
```

```
CHANNEL:    platform-sync:get-state
TYPE:       handle
INPUT:      platform: string
OUTPUT:     SyncState object for that platform
OWNER FILE: platformSync.js → registerPlatformSyncHandlers()
USED IN:    preload.js → electronAPI.platformSyncGetState(platform)
```

```
CHANNEL:    platform-sync:get-cached
TYPE:       handle
INPUT:      platform: string
OUTPUT:     CachedLibrary | null
OWNER FILE: platformSync.js → registerPlatformSyncHandlers()
USED IN:    preload.js → electronAPI.platformSyncGetCached(platform)
```

```
CHANNEL:    platform-sync:unlink
TYPE:       handle
INPUT:      platform: string, accountId: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: platformSync.js → registerPlatformSyncHandlers()
USED IN:    preload.js → electronAPI.platformSyncUnlink(platform, accountId)
```

### Platform Sync Push Events

```
CHANNEL:    platform-sync:state
TYPE:       on (push)
PAYLOAD:    SyncState object
OWNER FILE: platformSync.js
USED IN:    preload.js → electronAPI.onPlatformSyncState(cb)
```

```
CHANNEL:    platform-sync:completed
TYPE:       on (push)
PAYLOAD:    SyncState object
OWNER FILE: platformSync.js
USED IN:    preload.js → electronAPI.onPlatformSyncCompleted(cb)
```

```
CHANNEL:    platform-sync:failed
TYPE:       on (push)
PAYLOAD:    SyncState object
OWNER FILE: platformSync.js
USED IN:    preload.js → electronAPI.onPlatformSyncFailed(cb)
```

```
CHANNEL:    platform-sync:link-state-changed
TYPE:       on (push)
PAYLOAD:    { platform, state, ... }
OWNER FILE: platformSync.js
USED IN:    preload.js → electronAPI.onPlatformLinkStateChanged(cb)
```

---

## Section 10 — Account Shortcuts

---

```
CHANNEL:    account-shortcuts:list
TYPE:       handle
INPUT:      none
OUTPUT:     { shortcuts: Shortcut[] } | { status: 'error', message: string }
OWNER FILE: handlers/accountShortcutHandlers.js
USED IN:    preload.js → electronAPI.accountShortcuts.list()
```

```
CHANNEL:    account-shortcuts:set
TYPE:       handle
INPUT:      { platform, accountId, accelerator, accountName }
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/accountShortcutHandlers.js
USED IN:    preload.js → electronAPI.accountShortcuts.set(params)
```

```
CHANNEL:    account-shortcuts:clear
TYPE:       handle
INPUT:      { platform, accountId }
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/accountShortcutHandlers.js
USED IN:    preload.js → electronAPI.accountShortcuts.clear(params)
```

```
CHANNEL:    account-shortcuts:validate
TYPE:       handle
INPUT:      accelerator: string
OUTPUT:     { valid: boolean, normalized?: string, error?: string }
OWNER FILE: handlers/accountShortcutHandlers.js
USED IN:    preload.js → electronAPI.accountShortcuts.validate(accel)
```

---

## Section 11 — Quick Switcher

---

```
CHANNEL:    quick-switcher:get-settings
TYPE:       handle
INPUT:      none
OUTPUT:     QuickSwitcherSettings object | error
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.getSettings()
```

```
CHANNEL:    quick-switcher:set-settings
TYPE:       handle
INPUT:      payload: { enabled?, accelerator?, ... }
OUTPUT:     { status: 'ok', settings: object } | error
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.setSettings(payload)
```

```
CHANNEL:    quick-switcher:set-hotkey
TYPE:       handle
INPUT:      accelerator: string
OUTPUT:     { status: 'ok', accelerator: string } | { status: 'error', message: string }
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.setHotkey(accel)
```

```
CHANNEL:    quick-switcher:clear-hotkey
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'ok' } | error
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.clearHotkey()
```

```
CHANNEL:    quick-switcher:validate-hotkey
TYPE:       handle
INPUT:      accelerator: string
OUTPUT:     { valid: boolean, normalized?: string, error?: string }
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.validateHotkey(accel)
```

```
CHANNEL:    quick-switcher:list-accounts
TYPE:       handle
INPUT:      none
OUTPUT:     AccountGroup[]
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.listAccounts()
```

```
CHANNEL:    quick-switcher:switch-account
TYPE:       handle
INPUT:      { platform: string, accountId: string }
OUTPUT:     { status: 'ok' } | error
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.switchAccount(payload)
```

```
CHANNEL:    quick-switcher:hide
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'ok' }
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.hide()
```

```
CHANNEL:    quick-switcher:toggle
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'ok' } | error
OWNER FILE: handlers/quickSwitcherHandlers.js
USED IN:    preload.js → electronAPI.quickSwitcher.toggle()
```

```
CHANNEL:    qs:renderer-ready
TYPE:       on (send — renderer → main, no reply)
INPUT:      none
OWNER FILE: main.js (quickSwitcher overlay lifecycle)
USED IN:    preload.js → electronAPI.quickSwitcher.rendererReady()
```

```
CHANNEL:    qs:visible-ready
TYPE:       on (send — renderer → main, no reply)
INPUT:      data: object
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.quickSwitcher.visibleReady(data)
```

```
CHANNEL:    qs:show
TYPE:       on (push — main → renderer)
PAYLOAD:    data: object
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.quickSwitcher.onShow(cb)
```

```
CHANNEL:    qs:hide
TYPE:       on (push — main → renderer)
PAYLOAD:    data: object
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.quickSwitcher.onHide(cb)
```

---

## Section 12 — Window Controls

---

```
CHANNEL:    minimize-app
TYPE:       on (send — no reply)
INPUT:      none
OWNER FILE: handlers/windowHandlers.js
USED IN:    preload.js → electronAPI.minimizeApp()
```

```
CHANNEL:    maximize-app
TYPE:       on (send — no reply)
INPUT:      none
OWNER FILE: handlers/windowHandlers.js
USED IN:    preload.js → electronAPI.maximizeApp()
NOTES:      Toggles maximize/unmaximize based on current state.
```

```
CHANNEL:    close-app
TYPE:       on (send — no reply)
INPUT:      none
OWNER FILE: handlers/windowHandlers.js
USED IN:    preload.js → electronAPI.closeApp()
```

```
CHANNEL:    get-app-version
TYPE:       handle
INPUT:      none
OUTPUT:     string (semver, e.g. "1.1.4")
OWNER FILE: handlers/windowHandlers.js
USED IN:    preload.js → electronAPI.getAppVersion()
```

---

## Section 13 — System

---

```
CHANNEL:    get-desktop-path
TYPE:       handle
INPUT:      none
OUTPUT:     string (absolute path to user Desktop)
OWNER FILE: handlers/systemHandlers.js
USED IN:    preload.js → electronAPI.getDesktopPath()
```

```
CHANNEL:    get-drives
TYPE:       handle
INPUT:      none
OUTPUT:     DriveEntry[] (with icons, special folders, mounted drives)
OWNER FILE: handlers/systemHandlers.js
USED IN:    preload.js → electronAPI.getDrives()
```

```
CHANNEL:    list-directories
TYPE:       handle
INPUT:      path: string
OUTPUT:     FSEntry[] ({ name, type: 'dir'|'file', path?, icon? })
OWNER FILE: handlers/systemHandlers.js
USED IN:    preload.js → electronAPI.listDirs(p)
NOTES:      Only returns .exe, .lnk, .url files. Blocks $RECYCLE.BIN, system folders.
```

```
CHANNEL:    get-system-info
TYPE:       handle
INPUT:      none
OUTPUT:     { osName, cpuModel, cpuCores, totalRam, ramSpeed, gpuModel? }
OWNER FILE: handlers/systemHandlers.js
USED IN:    preload.js → electronAPI.getSystemInfo()
NOTES:      Slow on first call (queries systeminformation). Result is cached internally.
```

```
CHANNEL:    get-live-stats
TYPE:       handle
INPUT:      none
OUTPUT:     { cpuLoad, ramUsed, ramTotal, gpuLoad?, gpuVram? }
OWNER FILE: handlers/systemHandlers.js
USED IN:    preload.js → electronAPI.getLiveStats()
```

```
CHANNEL:    get-startup-enabled
TYPE:       handle
INPUT:      none
OUTPUT:     boolean
OWNER FILE: handlers/systemHandlers.js
USED IN:    preload.js → electronAPI.getStartupEnabled()
```

```
CHANNEL:    set-startup-enabled
TYPE:       handle
INPUT:      enable: boolean
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/systemHandlers.js
USED IN:    preload.js → electronAPI.setStartupEnabled(enable)
```

---

## Section 14 — Auto Update

---

```
CHANNEL:    check-for-updates
TYPE:       handle
INPUT:      none
OUTPUT:     { status: string }
OWNER FILE: handlers/autoUpdateHandlers.js
USED IN:    preload.js → electronAPI.checkForUpdates()
```

```
CHANNEL:    start-update-download
TYPE:       handle
INPUT:      none
OUTPUT:     { status: string }
OWNER FILE: handlers/autoUpdateHandlers.js
USED IN:    preload.js → electronAPI.startUpdateDownload()
```

```
CHANNEL:    restart-and-update
TYPE:       on (send — no reply)
INPUT:      none
OWNER FILE: handlers/autoUpdateHandlers.js
USED IN:    preload.js → electronAPI.sendRestartUpdate()
```

### Auto Update Push Events

```
CHANNEL:    update-found
TYPE:       on (push)
PAYLOAD:    version: string
OWNER FILE: main.js (autoUpdater event listener)
USED IN:    preload.js → electronAPI.onUpdateFound(cb) / onUpdateAvailable(cb)
```

```
CHANNEL:    update-not-found
TYPE:       on (push)
PAYLOAD:    none
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.onUpdateNotFound(cb)
```

```
CHANNEL:    update-download-progress
TYPE:       on (push)
PAYLOAD:    progress: { percent, bytesPerSecond, transferred, total }
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.onUpdateProgress(cb)
```

```
CHANNEL:    update-ready
TYPE:       on (push)
PAYLOAD:    version: string
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.onUpdateReady(cb)
```

```
CHANNEL:    update-error
TYPE:       on (push)
PAYLOAD:    message: string
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.onUpdateError(cb)
```

```
CHANNEL:    update-status
TYPE:       on (push)
PAYLOAD:    { status: 'preparing'|'downloading'|'downloaded'|'error'|'available', ... }
OWNER FILE: main.js
USED IN:    preload.js → electronAPI.onUpdateStatus(cb)
```

---

## Section 15 — Update Notes

---

```
CHANNEL:    get-pending-update-notes
TYPE:       handle
INPUT:      none
OUTPUT:     { status: 'success' | 'error', notes: object | null }
OWNER FILE: handlers/updateNotesHandlers.js
USED IN:    preload.js → electronAPI.getPendingUpdateNotes()
```

```
CHANNEL:    mark-update-notes-shown
TYPE:       handle
INPUT:      version: string
OUTPUT:     { status: 'success' | 'error' }
OWNER FILE: handlers/updateNotesHandlers.js
USED IN:    preload.js → electronAPI.markUpdateNotesShown(version)
```

---

## Section 16 — Analytics

---

```
CHANNEL:    analytics-grant-consent
TYPE:       handle
INPUT:      none
OUTPUT:     void
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.grantAnalyticsConsent()
```

```
CHANNEL:    analytics-revoke-consent
TYPE:       handle
INPUT:      none
OUTPUT:     void
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.revokeAnalyticsConsent()
```

```
CHANNEL:    analytics-is-enabled
TYPE:       handle
INPUT:      none
OUTPUT:     boolean
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.isAnalyticsEnabled()
```

```
CHANNEL:    get-consent-shown
TYPE:       handle
INPUT:      none
OUTPUT:     boolean
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.getConsentShown()
```

```
CHANNEL:    set-consent-shown
TYPE:       handle
INPUT:      none
OUTPUT:     void
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.setConsentShown()
```

```
CHANNEL:    analytics-log-game-spin
TYPE:       handle
INPUT:      isCustom: boolean
OUTPUT:     void
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.logGameSpinClicked(isCustom)
```

```
CHANNEL:    analytics-log-hud-sensor
TYPE:       handle
INPUT:      isEnabled: boolean
OUTPUT:     void
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.logHudSensorToggled(isEnabled)
```

```
CHANNEL:    analytics-log-image-changed
TYPE:       handle
INPUT:      type: string, isReset: boolean
OUTPUT:     void
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.logGameImageChanged(type, isReset)
```

```
CHANNEL:    analytics-log-feedback
TYPE:       handle
INPUT:      none
OUTPUT:     void
OWNER FILE: handlers/analyticsHandlers.js
USED IN:    preload.js → electronAPI.logFeedbackSent()
```

---

## Section 17 — Shell / External Links

---

```
CHANNEL:    open-external-url
TYPE:       handle
INPUT:      url: string (max 2048)
OUTPUT:     void | error object
OWNER FILE: handlers/externalLinkHandlers.js
USED IN:    preload.js → electronAPI.openExternal(url)
NOTES:      Routes through safeLauncher.openProtocolUrl — validates protocol allowlist.
```

```
CHANNEL:    open-community-url
TYPE:       handle
INPUT:      url: string (max 2048)
OUTPUT:     { status: 'success' } | error object
OWNER FILE: handlers/externalLinkHandlers.js
USED IN:    preload.js → electronAPI.openCommunityUrl(url)
NOTES:      Strict domain allowlist (discord.gg, instagram.com, x.com, linkedin.com, tiktok.com).
            Requires https: protocol.
```

---

## Section 18 — Creator Page

---

```
CHANNEL:    export-creator-page-pack
TYPE:       handle
INPUT:      defaultName: string, pageJson: object
OUTPUT:     { status: 'success' | 'canceled' | 'error', path?: string }
OWNER FILE: handlers/creatorPageHandlers.js
USED IN:    preload.js → electronAPI.exportCreatorPagePack(defaultName, pageJson)
            preload.js → electronAPI.exportCreatorPage(defaultName, pageJson)  (alias)
```

```
CHANNEL:    import-creator-page-pack
TYPE:       handle
INPUT:      none (opens system file dialog)
OUTPUT:     { status: 'success' | 'canceled' | 'error', pack?: object }
OWNER FILE: handlers/creatorPageHandlers.js
USED IN:    preload.js → electronAPI.importCreatorPagePack()
            preload.js → electronAPI.importCreatorPage()  (alias)
```

```
CHANNEL:    resolve-creator-page-assets
TYPE:       handle
INPUT:      pagePack: object, gameKey: string
OUTPUT:     object (resolved pack with local file:// URLs for assets)
OWNER FILE: handlers/creatorPageHandlers.js
USED IN:    preload.js → electronAPI.resolveCreatorPageAssets(pagePack, gameKey)
```

---

## Section 19 — Runtime Diagnostics

---

```
CHANNEL:    log-runtime-error
TYPE:       handle
INPUT:      message: string
OUTPUT:     void
OWNER FILE: main.js (direct ipcMain.handle — not in handlers/)
USED IN:    preload.js → electronAPI.logRuntimeError(message)
NOTES:      Only handler registered directly in main.js (not in handlers/).
            Writes to app log file. Safe to call from renderer global error handler.
```

---

## Channel Count Summary

| Section | Count |
|---|---|
| Game Library (request/reply) | 11 |
| Game Library (push events) | 4 |
| Images & Cache | 11 |
| Metadata | 5 |
| Baddel Server API | 5 + 1 push |
| Playtime | 3 + 1 push |
| Launcher | 8 |
| Collections | 7 |
| Accounts (all platforms) | 36 |
| Platform Sync | 7 + 4 push |
| Account Shortcuts | 4 |
| Quick Switcher | 9 + 4 send/push |
| Window Controls | 4 |
| System | 6 |
| Auto Update | 2 + 6 push |
| Update Notes | 2 |
| Analytics | 9 |
| External Links | 2 |
| Creator Page | 3 |
| Runtime Diagnostics | 1 |
| **TOTAL** | **~145** |
