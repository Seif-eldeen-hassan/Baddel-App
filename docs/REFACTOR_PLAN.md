# Baddel Launcher — Refactor Plan

**Audit date:** 2026-06-07  
**Baseline:** `npm run check` → 0 errors · `npm test` → 1756/1756 pass  
**Rules:** No behavior changes, no API renames, no userData format changes, no TypeScript, keep CommonJS/plain-browser-JS as-is.

---

## 1. File Inventory — Sizes and Responsibilities

### Main Process

| File | Lines | Responsibility |
|------|------:|----------------|
| `main.js` | 5,331 | App lifecycle, 100+ IPC handlers, playtime tracker, process monitor, auto-updater, tray, platform launch routing, window management |
| `accountsHandler.js` | 2,138 | AES-256-GCM credential storage, all seven platform account handlers, `registerAccountHandlers()`, quick-switcher account aggregator |
| `gameScanner.js` | 3,645 | `BaddelEngine` class — local game DB, six platform scanners (Steam/Epic/Riot/Ubisoft/EA/Xbox), manual games, game ID generation |
| `platformSync.js` | 3,561 | Library sync for Steam + Epic; QR/mobile auth state machine; cover-first asset caching pipeline; `autoSyncOnStartup()` |
| `platformSyncShared.js` | 600 | Pure merge/ordering logic — the only main-process file with real unit-test coverage |
| `steamBridge.js` | 1,103 | Python subprocess (`baddel_bridge.exe`) JSON-RPC bridge; Steam achievements, owned-games, credentials |
| `analytics.js` | 662 | PostHog + optional GA4 event queue; consent gate; heartbeat; uninstall telemetry config |
| `collectionsHandler.js` | 110 | Simple CRUD for named game collections, persisted to `BaddelLauncher/collections.json` |
| `preload.js` | 299 | Context bridge — exposes ~150 `window.electronAPI` methods to the renderer |

### Renderer (plain browser JS)

| File | Lines | Responsibility |
|------|------:|----------------|
| `src/js/app.js` | 7,837 | Home view, explore carousel, installed-games grid, collection UI, sidebar, hero slideshow, global state, 40+ `window.*` assignments |
| `src/js/game-details.js` | 10,598 | Game detail panel, artwork management, metadata pipeline, trailer player, enrichment queue, achievement display |
| `src/js/accounts.js` | 6,247 | All-Games view, Ready-to-Install view, platform-sync panels, account panels for seven platforms, sidebar navigation |
| `src/js/play-launcher.js` | 947 | Launch modal, pre-launch checks, executable selection |
| `src/js/addGameModal.js` | 926 | Manual "Add Game" modal, file-browser UI |
| `src/js/addAccountModal.js` | 668 | Platform "Add Account" modal, OAuth flows for each platform |
| `src/js/platformOwnership.js` | 612 | Ownership detection — maps a game's platform to which synced library it belongs to |
| `src/js/domUtils.js` | 218 | Shared DOM helpers (`qs`, `on`, `off`, toast, spinner, modal) |
| `src/js/platformResolver.js` | 164 | Maps platform names to labels, icons, and sort weights |
| `src/js/analyticsConsent.js` | 56 | Renders and handles the first-launch analytics consent overlay |

### Services

| File | Lines | Responsibility |
|------|------:|----------------|
| `services/baddelApi.js` | 1,107 | HTTP client for Baddel Metadata Server; rate-limiting, retries, `ApiError` |
| `services/launcherPathResolver.js` | ~900 | Detects launcher executables via Windows registry + hardcoded paths (Steam, Epic, EA, Riot, Ubisoft, Rockstar) |
| `services/metadataResolutionManager.js` | ~500 | `MetadataResolutionManager` class — metadata fetch pipeline, candidate scoring |
| `services/accountShortcuts.js` | 254 | Per-account keyboard shortcut storage; blocked-accelerator validation |
| `services/imageWebpCache.js` | 261 | Download → WebP conversion → local cache; graceful sharp fallback |
| `services/quickSwitcher.js` | 199 | Frameless overlay BrowserWindow, hotkey, account list for switcher |
| `services/candidateGenerator.js` | ~350 | Generates metadata search candidates from game metadata |
| `services/riotPathResolver.js` | ~600 | Riot-specific path resolution (League, Valorant) |
| `services/safeLauncher.js` | 158 | Safe subprocess spawn; validates `.exe`/`.lnk` only; no `shell: true` |
| `services/ipcValidation.js` | 78 | IPC argument validators: `assertString`, `assertSafeId`, `assertPlatform`, etc. |
| `services/quickSwitcherSettings.js` | 59 | Hotkey + enabled state in `quick-switcher-settings.json` |
| `services/credentialValidator.js` | ~200 | Validates/redacts credentials before caching |
| `services/steamLibraryAssets.js` | ~60 | Steam library asset file identification |

### Tests

| File | Lines | Primary Source Under Test |
|------|------:|--------------------------|
| `tests/homeUI.test.js` | 2,319 | `app.js`, `game-details.js` |
| `tests/uiPolish.test.js` | 1,748 | `app.js`, `accounts.js` |
| `tests/platformOwnership.test.js` | 850 | `platformOwnership.js`, `platformSync.js` |
| `tests/platformSyncShared.test.js` | 864 | `platformSyncShared.js` (only file with functional unit tests) |
| `tests/gameScanner.test.js` | 519 | `gameScanner.js` |
| `tests/accountShortcuts.test.js` | 526 | `services/accountShortcuts.js` |
| `tests/manualGameLaunch.test.js` | 492 | `main.js` launch handler |
| `tests/launcherPathResolver.test.js` | 470 | `services/launcherPathResolver.js` |
| `tests/startup.test.js` | 464 | `main.js` startup sequence |
| `tests/mrmCandidates.test.js` | 440 | `services/metadataResolutionManager.js` |
| `tests/enrichQueueAssets.test.js` | 757 | `gameScanner.js`, `services/baddelApi.js` |
| `tests/readyToInstallAssets.test.js` | 831 | `game-details.js` |
| `tests/artworkOwnership.test.js` | 775 | `app.js`, `game-details.js` |
| `tests/community.test.js` | 314 | `app.js` (community modal) |
| `tests/credentialSecurity.test.js` | 308 | `accountsHandler.js` |
| `tests/quickSwitcher.test.js` | 729 | `services/quickSwitcher.js` |
| `tests/uninstallTracking.test.js` | 244 | `analytics.js`, `build/installer.nsh` |
| `tests/domUtils.test.js` | 313 | `src/js/domUtils.js` |
| `tests/preloadIntegrity.test.js` | 168 | `preload.js` |
| `tests/safeLauncher.test.js` | 106 | `services/safeLauncher.js` |
| `tests/ipcValidation.test.js` | 65 | `services/ipcValidation.js` |
| *(remaining 15 files)* | ~4,200 | Various feature tests |

**Total test lines: ~17,547 across 36 files.**  
All tests use Node's built-in `node:test` + `node:assert` modules (no external test framework).

---

## 2. Duplicate Functions and Duplicate Global Assignments

### Confirmed duplicates / near-duplicates

| Pattern | Locations | Risk |
|---------|-----------|------|
| `window.setAgField` assigned | `app.js:3163` and `accounts.js:4850` | **Silent clobber** — whichever script loads last wins. Probably intentional (accounts.js is the authoritative owner), but undocumented. |
| `window.setIgField` assigned | `app.js:3164` and `accounts.js` | Same issue as above. |
| `typeof renderAllGamesView === 'function'` guard | `accounts.js` lines 1924, 1941, 5402, 5722 | Four nearly identical defensive calls — extract to a one-liner helper. |
| `getPosterUrl` / `getPosterUrlInstalled` | `app.js:1336` / `app.js:1349` | Two sibling functions that differ only in which image key they prefer; could be unified with a parameter. |
| `_getRecentHeroCandidate` / `_getRecentPosterFallback` / `_getRecentDisplayImage` | `app.js:3473-3487` | Three one-liners implementing the same image-priority logic with slightly different fields; consolidate. |
| `_vs` (view state) / `_agState` (all-games state) | `accounts.js:3797` / `accounts.js:4465` | Two separate state objects with overlapping concerns (both track filter + sort + pagination); could share a factory. |
| Render cycle trigger | `accounts.js`: called as `window.renderAllGamesView(...)` from `app.js` side | Cross-file call via window global — fragile coupling. |
| `_allGamesCache` vs `window.allGamesData` | `accounts.js:1953` vs `app.js:290` | Two caches for what is conceptually the same dataset. `allGamesData` is the installed-games list; `_allGamesCache` is the synced library. Different, but the naming suggests overlap and confuses readers. |

### No truly identical function bodies found
The renderer files are large enough that some functional overlap exists (multiple grid/list renderers), but each handles a meaningfully different view state. These are not bugs — they are candidates for a shared render helper after careful analysis.

---

## 3. IPC Channels Grouped by Feature

Full count: **~108 channels** (`ipcMain.handle` + `ipcMain.on`).  
Account handlers and platform-sync handlers are registered via delegate calls to `registerAccountHandlers()` and `registerPlatformSyncHandlers()` so they do not appear inline in `main.js`.

### Window Controls (3)
```
minimize-app · maximize-app · close-app
```

### Game Library — CRUD (14)
```
get-installed-games · get-game-by-id · add-manual-game · remove-game
rename-game · scan-all-games · reorder-library · unhide-all-games
get-hidden-games · restore-specific-games · delete-game-permanently
get-dynamic-game-exes · select-game-image · probe-local-image
```

### Game Launch (1 + sub-routing)
```
launch-game   (routes internally to platform-specific launchers)
```

### Image & Asset Cache (8)
```
cache-image · cache-all-assets · prune-image-cache · get-cached-image
get-image-cache-dir-url · get-image-cache-dir-url-sync (ipcMain.on, sync)
update-game-image · reset-game-image
```

### Metadata & Playtime (9)
```
get-game-metadata · save-game-metadata · save-full-metadata
load-full-metadata · update-playtime · set-time-tracking-enabled
get-time-tracking-enabled · get-game-achievements · resolve-metadata
```

### Baddel Metadata Server (4)
```
lookup-game-server · enrich-game-server · import-and-enrich-server
baddelapi-cooldown-active
```

### Collections (7)
```
get-collections · create-collection · add-game-collection
remove-game-collection · delete-collection · reorder-collection
update-collection
```

### Platform Accounts — delegated to `accountsHandler.js` (~42)
```
get-steam-accounts · get-steam-image · switch-steam · add-steam-account
get-epic-profiles · save-epic-account · switch-epic · add-epic-account
delete-epic-profile · rename-epic-profile
get-ea-profiles · save-ea-account · switch-ea · add-ea-account
delete-ea-profile · rename-ea-profile
get-riot-profiles · save-riot-account · switch-riot · add-riot-account
delete-riot-profile · rename-riot-profile
detect-riot-client · select-riot-client-manually · clear-manual-riot-client-path
get-ubisoft-profiles · save-ubisoft-account · switch-ubisoft · add-ubisoft-account
delete-ubisoft-profile · rename-ubisoft-profile
get-discord-profiles · save-discord-account · switch-discord-account · add-discord-account
delete-discord-profile · rename-discord-profile
get-rockstar-profiles · save-rockstar-account · switch-rockstar-account · add-rockstar-account
rename-rockstar-profile · delete-rockstar-profile
detect-launcher · select-launcher-manually · clear-manual-launcher-path
```

### Platform Sync — delegated to `platformSync.js` (~10)
```
platform-sync:status · platform-sync:link · platform-sync:sync
platform-sync:get-state · platform-sync:get-accounts · platform-sync:get-cached
platform-sync:unlink
Events: platform-sync:state-changed · platform-sync:completed · platform-sync:failed
        platform-sync:link-state-changed
```

### Quick Switcher (9)
```
quick-switcher:get-settings · quick-switcher:set-settings
quick-switcher:set-hotkey · quick-switcher:clear-hotkey
quick-switcher:validate-hotkey · quick-switcher:list-accounts
quick-switcher:switch-account · quick-switcher:hide · quick-switcher:toggle
```

### Account Shortcuts (4)
```
account-shortcuts:list · account-shortcuts:set
account-shortcuts:clear · account-shortcuts:validate
```

### Auto-Update (8)
```
get-app-version · check-for-updates · start-update-download · restart-and-update
Events: update-found · update-not-found · update-download-progress
        update-ready · update-error · update-status · update-available
```

### Startup & Update Notes (4)
```
get-startup-enabled · set-startup-enabled
get-pending-update-notes · mark-update-notes-shown
```

### File Browser (3)
```
get-drives · list-directories · get-desktop-path
```

### External Links (3)
```
open-external-url · open-community-url · launcher:open-install-url
```

### Analytics (9)
```
analytics-grant-consent · analytics-revoke-consent · analytics-is-enabled
analytics-log-hud-sensor · analytics-log-game-spin · analytics-log-image-changed
analytics-log-feedback · get-consent-shown · set-consent-shown
```

### System Stats (2)
```
get-system-info · get-live-stats
```

### Creator Page (4)
```
export-creator-page-pack · import-creator-page-pack
resolve-creator-page-assets · export-creator-page · import-creator-page
```

> **Observation:** The "colon namespace" pattern (e.g., `platform-sync:*`, `quick-switcher:*`, `account-shortcuts:*`) is good. The 42 account-management channels lack namespacing — a future pass could group them under `account:steam:*`, `account:epic:*`, etc. **Do not rename yet.**

---

## 4. Renderer Globals Grouped by Feature

All `window.*` assignments from `app.js` and `accounts.js`. These are the full renderer API surface that HTML onclick handlers and cross-file calls rely on.

### Library / Game Data
```javascript
window.allGamesData          // app.js  — installed-games array (master source)
window._allGamesCache        // accounts.js — synced-library array (separate concern)
window._agIsUserLibraryGame  // accounts.js — predicate
window._agGetUserLibraryGames // accounts.js
```

### All-Games View State and Controls
```javascript
window._agState              // accounts.js — filter+sort+pagination state object
window._agDisplayPrefs       // accounts.js — view mode, density prefs
window.renderAllGamesView    // accounts.js — primary render trigger
window.filterAllGames        // accounts.js
window.setAgPlatformFilter   // accounts.js
window.setAgSort             // accounts.js
window.setAgAccountFilter    // accounts.js
window.toggleAgAccountDropdown // accounts.js
window.setAgViewMode         // accounts.js
window.setAgDensity          // accounts.js
window.setAgField            // accounts.js (also in app.js — see duplicates)
window.agClearSearch         // accounts.js
window._agUpdateSearchClear  // accounts.js
window._agInitStickyToolbar  // accounts.js
window.toggleAgSortDropdown  // accounts.js
window.setAgSortCustom       // accounts.js
window.toggleAgDisplayPanel  // accounts.js
window.agInstalledOnly       // app.js — boolean flag
window.agReadyOnly           // app.js — boolean flag
window.setSyncedFilter       // app.js
```

### Installed-Games View State
```javascript
window._vs                   // accounts.js — installed-view state object (filters, sort, page)
window._vsRender             // accounts.js — re-render trigger
window._igDisplayPrefs       // accounts.js — view mode, density prefs
window.setIgViewMode         // accounts.js
window.setIgDensity          // accounts.js
window.setIgField            // accounts.js (also in app.js — see duplicates)
```

### Platform Sync & Accounts
```javascript
window.linkEpicLibrary       // accounts.js
window.syncEpicLibrary       // accounts.js
window.unlinkEpicLibrary     // accounts.js
window.refreshAllGamesView   // accounts.js — alias / helper
window.switchPinnedAccount   // app.js
window.handlePinAccount      // accounts.js
window._onSyncLibraryUpdated // app.js
```

### Collections
```javascript
window.renameCollection           // app.js
window.openRenameCollectionModal  // app.js
window.toggleCollectionCardMenu   // app.js
window.openAddGamesToCollection   // app.js
```

### Sidebar / Navigation
```javascript
window.syncSidebarActionButton    // app.js
window._sbSec                     // app.js — section registry object
```

### Artwork / Image Handling
```javascript
window._clearArtworkLocalState    // app.js
window.hydrateManualGameArtworkNow // app.js
window._suggAllGames              // app.js — suggestions cache
window._suggArtCacheGet           // app.js
window.__baddelApplyGameCustomOverride // app.js
```

### Suggestion / Explore Carousel
```javascript
window._agFindInstalledLocalMatches  // app.js
window._agFindInstalledLocalMatch    // app.js
window._debugFindInstalledMatchByTitle // app.js (debug, underscore prefix)
window._suggSelectGame               // app.js
window.suggViewDetails               // app.js
window.suggInstall                   // app.js
window._suggCarouselPrev             // app.js
window._suggCarouselNext             // app.js
```

### Help / Community / Feedback
```javascript
window.handleHelpDropdownAction   // app.js
window.dismissBetaFeedbackBanner  // app.js
window.openBetaFeedbackFromBanner // app.js
window.closeUpdateNotesModal      // app.js
```

### Debug / Internal (underscore-prefixed, not used in HTML)
```javascript
window._debugInstalledPlatformFilter // app.js
window._debugInstalledGridState      // app.js
window._stopSplashCanvas             // app.js
```

### Layout Helpers
```javascript
window.onclick                    // app.js — document click-outside handler
window.setAgField                 // CONFLICT: both app.js and accounts.js
window.setIgField                 // CONFLICT: both app.js and accounts.js
```

> **Key finding:** ~75 window-global assignments. Many are called only from inline HTML `onclick` attributes (`onclick="filterAllGames()"`). This is the main reason they are on `window` — not because they are truly shared state between files. A future refactor could scope most of these to a single module and expose only what HTML actually calls.

---

## 5. Comments: Useful vs Noise

### Useful comments (keep)

These explain *why*, not what:

- **`main.js` playtime tracker** (`~lines 734–806`): The large comment block explaining the process-detection heuristic (fuzzy match, idle threshold, grace period, suspicious-session cap) is load-bearing — the logic is non-obvious and the comment correctly explains the design intent.
- **`accountsHandler.js` encryption header** (`~lines 93–160`): Explains the `BDEL` binary format, key derivation fallback, and why keytar is used. Essential for any future credential migration.
- **`analytics.js` `isEssential` / `alsoSendToGA4` flags** (lines 275–282): The two boolean parameters to `_send()` are subtle; the comment correctly explains what they mean.
- **`services/baddelApi.js` SECURITY NOTE** (lines 10–15): Documents which endpoints are admin-only and must never be called from the client. Keeps this intent visible even without type enforcement.
- **`platformSync.js` concurrency comments** around `_withConcurrency` and `cacheLibraryCoversFirst`: explains the deliberate cover-first / secondary-asset ordering and why.
- **`services/ipcValidation.js`**: The short comments explaining the max-length and format rules for each validator are worth keeping.

### Noise comments (could be removed)

- **Repeated section banners** like `// ============================================================ // INIT // ============================================================` in `analytics.js`. The function name makes the section obvious; the banner adds width, not information.
- **`// non-fatal`** on every catch block that ignores errors. Fine once; becomes noise when repeated 20+ times in the same file. Consider a named helper like `swallowError()` to make it explicit.
- **`// TODO: ...`** — zero such comments exist. Good baseline discipline.
- **Commented-out code blocks**: The agent found none. Healthy baseline.
- **Tautological inline comments** like `// Get the game ID` above `const gameId = game.id;`. Several exist in `main.js`. These can be removed as part of cleanup, not refactor.

---

## 6. Risky Areas — Must Not Touch Without Tests

### 6.1 Playtime Tracker and Process Monitor (`main.js` ~lines 732–1500)

**Why risky:** The process-detection loop (`isGameRunning`, `_safeFuzzyGameNameMatch`) uses `psList()` every 10 seconds. It maintains `activeTrackers = {}` across the entire session. Logic for grace periods, idle detection, and suspicious-session capping is tightly coupled. A regression here silently corrupts playtime data or prevents launch tracking.

**Current test coverage:** Zero direct tests. `manualGameLaunch.test.js` covers the IPC handler but not the monitor internals.

**Required before touching:** Extract `_safeFuzzyGameNameMatch` and the time-bucketing logic into a side-effect-free module (like `platformSyncShared.js`) and add unit tests.

### 6.2 Credential Encryption (`accountsHandler.js` ~lines 93–230)

**Why risky:** AES-256-GCM + keytar. Wrong IV reuse, wrong auth-tag handling, or key-derivation change = permanent data loss for users. Binary format includes a magic header (`BDEL`) and version byte — any format change must be backward-compatible.

**Current test coverage:** `credentialSecurity.test.js` (308 lines) — checks that the module uses keytar, that no plaintext is written, and that the binary format markers are present. Does NOT test encryption/decryption round-trips (would require mocking `keytar`).

**Required before touching:** Add encryption round-trip tests with a mocked keytar before any refactor.

### 6.3 Steam Bridge Subprocess (`steamBridge.js`)

**Why risky:** Spawns `baddel_bridge.exe` (or Python venv fallback) as a child process with JSON RPC over stdio. If the spawn contract changes (argument order, environment variables, stdin/stdout framing) the bridge breaks silently — no type checking on either side.

**Current test coverage:** `steamBridgeRuntime.test.js` (298 lines) — checks spawn path logic and message framing.

**Required before touching:** Any change to the bridge protocol needs a test that sends a real JSON message and verifies the response shape.

### 6.4 Auto-Updater State Machine (`main.js` ~lines 40–300)

**Why risky:** `_updState` drives the user-facing update UI. Stall watchdog (120s), download re-arming, and the `prepareTimer` / `stallTimer` teardown are stateful. A regression causes silent "stuck downloading" or missed updates.

**Current test coverage:** `startup.test.js` covers setup calls; `updateNotes.test.js` covers the update-notes flow. The stall watchdog and state-machine transitions have no direct test.

**Required before touching:** Add tests that inject mock `autoUpdater` events and verify state transitions before modifying `setupAutoUpdater()`.

### 6.5 Epic Sync via Legendary (`platformSync.js` ~lines 2420–2943)

**Why risky:** Invokes the `legendary.exe` CLI with file-system side effects (writes Epic configs, switches active account). Sync failure leaves the user's Epic Launcher in an inconsistent state.

**Current test coverage:** `epicSwitcherSeparation.test.js` (248 lines) covers the profile-separation logic. `platformOwnership.test.js` covers ownership detection.

**Required before touching:** Integration tests that mock the Legendary CLI invocation are needed before refactoring `syncSingleEpicAccount`.

### 6.6 QR/Mobile Approval Poll (`platformSync.js` ~lines 1289–1500)

**Why risky:** `_mobileApprovalPollStep` is a recursive async state machine with a `maxAttempts` cap and exponential-backoff-like delays. Incorrect timeout or retry logic permanently blocks the Steam link flow.

**Current test coverage:** `steamApprovalPolling.test.js` (377 lines) covers the happy path and max-attempts boundary.

**Required before touching:** Edge cases (network timeout mid-poll, partial approval) need test coverage before this code is restructured.

### 6.7 `launch-game` IPC Handler (`main.js` ~lines 2800–2950)

**Why risky:** Routes to eight different platform launchers. Each branch has different process spawn patterns (some use `safeLauncher`, some use `spawn` directly, Xbox uses `explorer.exe`). A mistake here prevents games from launching.

**Current test coverage:** `manualGameLaunch.test.js`, `riotEaLaunchFix.test.js`, `xboxLaunch.test.js`.

**Required before touching:** Do not modify any launch branch that lacks its own dedicated test.

### 6.8 PowerShell Drive Enumeration (`main.js` ~line 2536)

**Why risky:** Uses `exec()` with a PowerShell command. Arguments are fully hardcoded (no user input), so the injection risk is low. However, the output parsing is brittle — changing the format string breaks the file browser.

**Required before touching:** The command string and output parser should be extracted and tested with a mock exec.

---

## 7. Proposed Target Folder Structure

This is a **target state** — to be reached incrementally. No files should be moved until the area has adequate test coverage. Keep existing file names and IPC channels unchanged until a dedicated rename pass.

```
Baddel-App/
│
├── main.js                        # Entry — trim to ≤ 800 lines by extracting handlers
│
├── preload.js                     # Context bridge — unchanged
│
├── analytics.js                   # Analytics — unchanged (already well-scoped)
│
├── accountsHandler.js             # Accounts — unchanged until credential tests added
│
├── gameScanner.js                 # Game DB — unchanged until process-monitor extracted
│
├── collectionsHandler.js          # Collections — already small, leave as-is
│
├── steamBridge.js                 # Steam subprocess bridge — unchanged
│
├── platformSync.js                # Platform sync — unchanged (Epic/Steam coupling)
├── platformSyncShared.js          # Pure merge logic — keep, expand test coverage here
│
├── handlers/                      # NEW: extracted IPC handler modules
│   ├── gameHandlers.js            # CRUD handlers from main.js (~400 lines to extract)
│   ├── imageHandlers.js           # Image/cache handlers from main.js (~200 lines)
│   ├── metadataHandlers.js        # Metadata + playtime handlers from main.js (~200 lines)
│   ├── systemHandlers.js          # Stats, drives, startup handlers from main.js (~100 lines)
│   ├── updateHandlers.js          # Auto-updater handlers from main.js (~150 lines)
│   └── analyticsHandlers.js      # Analytics IPC handlers from main.js (~80 lines)
│
├── services/                      # Unchanged — already well-structured
│   ├── baddelApi.js
│   ├── imageWebpCache.js
│   ├── safeLauncher.js
│   ├── ipcValidation.js
│   ├── quickSwitcher.js
│   ├── quickSwitcherSettings.js
│   ├── accountShortcuts.js
│   ├── launcherPathResolver.js
│   ├── riotPathResolver.js
│   ├── metadataResolutionManager.js
│   ├── candidateGenerator.js
│   ├── credentialValidator.js
│   └── steamLibraryAssets.js
│
├── src/
│   ├── dashboard.html             # Unchanged
│   ├── js/
│   │   ├── app.js                 # Home/collections/sidebar — trim by extracting state
│   │   ├── game-details.js        # Game detail panel — too large; candidate for split
│   │   ├── accounts.js            # Account panels + All-Games view — candidate for split
│   │   ├── play-launcher.js       # Launch modal — already well-scoped
│   │   ├── addGameModal.js        # Add game modal — already well-scoped
│   │   ├── addAccountModal.js     # Add account modal — already well-scoped
│   │   ├── analyticsConsent.js    # Consent overlay — already small
│   │   ├── domUtils.js            # DOM helpers — already well-scoped
│   │   ├── platformResolver.js    # Platform metadata — already well-scoped
│   │   └── platformOwnership.js   # Ownership detection — already well-scoped
│   └── css/
│       └── (unchanged)
│
├── build/
│   └── installer.nsh              # NSIS hook — already present
│
├── tests/                         # Unchanged
│
└── docs/
    └── REFACTOR_PLAN.md           # This file
```

### Rationale for `handlers/` extraction

`main.js` at 5,331 lines is the primary scaling problem. The bulk is ~90 `ipcMain.handle` registrations that belong to distinct features. Each handler module would:
- Export a single `register(ipcMain, deps)` function
- Receive its dependencies (gameScanner, analytics, etc.) as arguments — no circular requires
- Be testable without spinning up a full Electron app

The `launch-game` handler and the playtime tracker should **not** be extracted until they have dedicated tests — they are too tightly coupled to the `activeTrackers` state.

---

## 8. Recommended Refactor Sequence

> Do not start until this document is committed and `npm test` is green on the target branch.

### Phase 0 — Test Gap Fill (prerequisite — no code movement)
1. Add playtime-tracker unit tests (extract `_safeFuzzyGameNameMatch` logic to `platformSyncShared.js` or a new `gameTrackingShared.js` and test it there).
2. Add credential round-trip tests for `accountsHandler.js` with a mocked keytar.
3. Add auto-updater state-machine tests with a mock `autoUpdater` emitter.

### Phase 1 — `main.js` Handler Extraction (low risk)
Extract handler groups into `handlers/` one feature at a time. Each extraction:
1. Move the `ipcMain.handle(...)` blocks verbatim into `handlers/featureHandlers.js`.
2. Replace in `main.js` with `require('./handlers/featureHandlers').register(ipcMain, deps)`.
3. Run `npm test` — zero changes to behavior means zero test changes.

Safe order: `systemHandlers` → `updateHandlers` → `imageHandlers` → `analyticsHandlers` → `metadataHandlers` → `gameHandlers`.

**Leave `launch-game` in `main.js` until Phase 0 tests are added.**

### Phase 2 — Renderer State Consolidation (medium risk)
1. Resolve the `window.setAgField` / `window.setIgField` double-assignment: delete the stub in `app.js` and document `accounts.js` as the canonical owner.
2. Merge `_getRecentHeroCandidate` / `_getRecentPosterFallback` / `_getRecentDisplayImage` into a single parameterized function.
3. Extract the repeated `typeof renderAllGamesView === 'function'` guard into a helper.

### Phase 3 — `game-details.js` Split (higher risk — requires strong test baseline)
At 10,598 lines, `game-details.js` handles: artwork management, metadata pipeline, trailer player, enrichment queue, achievement display, and the detail panel UI. These are genuinely independent concerns. Proposed split:
- `game-details-ui.js` — panel render, tabs, close/open
- `game-details-artwork.js` — image selection, artwork state, upload
- `game-details-metadata.js` — metadata pipeline, MRM integration
- `game-details-media.js` — trailer player, YouTube webview
- `game-details-achievements.js` — achievement display

**Do not start Phase 3 until all `readyToInstallAssets.test.js`, `artworkOwnership.test.js`, `heroBackfill.test.js`, and `youtubeExtractor.test.js` tests cover the code paths being moved.**

---

## 9. Baseline Audit Results

```
Date:        2026-06-07
npm run check:  PASS — 0 syntax errors across all 21 checked files
npm test:       PASS — 1756/1756 tests, 0 failures, 0 skipped
Test files:     36
```

No code was modified during this audit. This document is the sole output.
