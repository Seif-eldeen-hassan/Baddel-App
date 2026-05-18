# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run in dev mode (electron .)
npm test           # Run tests (node --test tests/*.test.js)
npm run dist       # Build Windows installer (electron-builder)
```

To run a single test file:
```bash
node --test tests/platformSyncShared.test.js
```

## Architecture

Baddel is an Electron-based multi-platform game launcher for Windows. It aggregates libraries from Steam, Epic, EA, Ubisoft, Xbox, Riot, Discord, and Rockstar into a single UI.

### Process boundary

**Main process** (`main.js`, ~2 100 lines) owns all privileged work: game launching, playtime tracking, process monitoring, auto-update (electron-updater via GitHub releases), and tray integration. It registers 50+ IPC handlers that the renderer calls through the context bridge.

**Renderer** (`src/dashboard.html` + `src/js/app.js`, `game-details.js`, `play-launcher.js`, `accounts.js`) is a plain HTML/CSS/JS frontend. It never talks to the OS or filesystem directly — everything goes through `window.electronAPI` exposed by `preload.js`.

**preload.js** is the full API surface between renderer and main. When adding a feature that needs OS access, add an IPC handler in `main.js` and expose it here.

### Game database

`gameScanner.js` (`BaddelEngine` class) owns the local game DB (`userData/games-db.json`). Game IDs are stable MD5 hashes of the executable path or game name. All scan, add, rename, remove, hide, reorder, and metadata-update operations live here.

Metadata is fetched from the Baddel Metadata Server (Railway.app) through `services/baddelApi.js`. That file handles rate-limiting, retries, and an `ApiError` class that preserves HTTP status codes.

### Platform sync

`platformSync.js` (2 260 lines) orchestrates library syncing for each linked account. It persists merged libraries in `userData/platform-sync/` as `steam_library_merged.json` / `epic_library_merged.json`.

Pure merge/ordering logic lives in `platformSyncShared.js` — this is the only file with real unit-test coverage. Keep side-effect-free logic here so it stays testable.

### Steam integration

`steamBridge.js` spawns `baddel-steam-integration/src/baddel_bridge.py` as a child process and communicates via JSON over stdin/stdout. It never uses `exec()` or a shell. Achievements, owned-game lists, and Steam credentials all flow through this subprocess. Credentials are stored in Windows Credential Manager via **keytar** (with a scrypt-derived key fallback).

### Account management

`accountsHandler.js` (~1 830 lines) handles all platform accounts (Steam, Epic, EA, Ubisoft, Riot, Discord, Rockstar). Passwords/tokens are encrypted with AES-256-GCM using a key from Windows Credential Manager. Each platform exposes an OAuth or credential flow; never use `shell: true` when spawning platform executables.

### Image caching

`services/imageWebpCache.js` downloads remote artwork URLs to a local cache directory and converts them to WebP via **sharp**. It degrades gracefully if sharp is unavailable. Minimum valid file size is 512 bytes (to reject HTML error pages masquerading as images).

### Analytics

`analytics.js` batches events to PostHog and GA4. It is consent-gated — check `analyticsConsent` before firing events. The installation ID (a persistent UUID) is used for rate-limit bucketing by the Baddel API as well.

### Bundled binaries

- `bin/legendary.exe` — Epic Games library scanner/launcher (do not replace without testing Epic sync)
- `baddel-steam-integration/` — Python package; has its own venv. The bridge looks for a bundled venv first, then falls back to system Python.

### Key data paths (all under `app.getPath('userData')`)

| File | Owner |
|---|---|
| `games-db.json` | gameScanner |
| `BaddelLauncher/collections.json` | collectionsHandler |
| `platform-sync/steam_accounts.json` | platformSync |
| `platform-sync/steam_library_merged.json` | platformSync |
| `platform-sync/epic_accounts.json` | platformSync |
| `platform-sync/epic_library_merged.json` | platformSync |
| `platform-sync/steam_bridge_cache.json` | steamBridge |
