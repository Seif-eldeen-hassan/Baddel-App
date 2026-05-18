# Security Hardening Notes

## BrowserWindow settings

| Setting | Value | Why |
|---|---|---|
| `contextIsolation` | `true` | Isolates renderer JS from preload world |
| `nodeIntegration` | `false` | Renderer cannot call Node APIs directly |
| `webSecurity` | `true` | Enforces same-origin policy and blocks mixed content |
| `webviewTag` | `false` | No `<webview>` elements — removes an attack surface |
| `allowRunningInsecureContent` | `false` | Blocks HTTP subresources in an HTTPS context |
| `sandbox` | **omitted (false)** | See below |

### Why `sandbox: true` is not set

Electron's full sandbox (`sandbox: true`) prevents the preload script from using `require()`.  
Our preload ([preload.js](../preload.js)) calls `require('electron')` to obtain `ipcRenderer`, `webUtils`, and `shell`.  
With `sandbox: true` on Electron 34, these calls throw at startup and the app fails to open.

**Migration path:** Electron 29+ supports a `utilityProcess` approach where preload helpers can run in a sandboxed utility process. Once all platform-sync and OS helpers are migrated to IPC-only calls, enabling full sandbox is straightforward. Tracked as a future hardening item.

## IPC trust boundary

All `ipcMain.handle` registrations go through [services/ipcValidation.js](../services/ipcValidation.js).  
The validator rejects calls with missing or incorrectly typed required fields before they reach the handler body.

### launch-game hardening

`ipcMain.handle('launch-game', ...)` previously accepted an arbitrary `command` string from the renderer, which could be used to execute any process.

**Current behavior (hardened):**
- If a `gameId` is provided, the handler looks up the game in the trusted in-memory games DB (`getSavedGames()`).  
- The `command` and `path` from the DB record replace any renderer-supplied values.  
- If the `gameId` is not found in the DB, the call is rejected with `{ status: 'error', message: 'Game not found.' }`.
- The renderer ([preload.js](../preload.js)) now exposes `launchGame(gameId, options)` — it never forwards a command string.

**What remains:** For manually-added games without a DB entry (rare edge case), the fallback still accepts a renderer command. A future improvement is to require all games to be DB-backed before launch.

## open-external-url hardening

`open-external-url` IPC is gated by `safeLauncher.openProtocolUrl` ([services/safeLauncher.js](../services/safeLauncher.js)), which validates that the URL is either an allowed protocol (`https:`, `steam:`, `com.epicgames.launcher:`) or a verified executable path. Arbitrary `file://` and `javascript:` URLs are rejected.

## URL safety helpers (domUtils.js)

Three purpose-specific helpers in [src/js/domUtils.js](../src/js/domUtils.js):

### `safeImageUrl(value)`
For `img.src`, `background-image`, and cover/hero/logo art slots.

Allowed: `https://`, `http://`, `blob:`, `data:image/*`, relative `./assets/` paths, `file://` within trusted directories.  
Blocked: `javascript:`, `vbscript:`, `data:text/`, `data:application/`, `//evil.com` (protocol-relative).

### `safeMediaUrl(value)`
For `video.src`, HLS/DASH stream sources, and trailer player URLs.

Allowed: `https://` (YouTube, CDN streams, direct mp4/webm/m3u8/mpd), `blob:`, `data:video/*`, `file://` within trusted directories.  
Blocked: same protocol blocklist as above.

### `safeEmbedUrl(value)`
For `<iframe src>` embed players. **Only** `https://www.youtube.com/embed/<id>` and `https://youtube.com/embed/<id>` are allowed. Everything else returns `''`.

### Trusted file:// directories

`[preload.js](../preload.js)` synchronously exposes `window.__BADDEL_CACHE_URL__` (the `image_cache/` directory URL built from `app.getPath('userData')`) before any renderer script executes. `domUtils.js` reads this global at module-load time so the trust policy is in effect before the first card renders — no async IPC needed.

Additional directories can be registered via `addTrustedFileDir(url)`.

Steam avatar files are copied from Steam's `avatarcache/` into `image_cache/` by `getLocalSteamAvatar()` in `accountsHandler.js` so all local image paths returned by the main process are within the trusted directory.

## XSS mitigations

- `escapeHtml` / `safeText` / `safeImageUrl` helpers in `domUtils.js` used throughout renderer files.
- All account card builders and avatar setters use `safeImageUrl` + `escapeHtml`.
- No `innerHTML` assignments use un-escaped user/server-supplied strings.
- `executeJavaScript` call removed from main process (was dead code for an obsolete animation readiness signal).

## Known remaining risks

1. **Full sandbox disabled** — preload uses `require('electron')`. See migration path above.
2. **Manual-game launch fallback** — very rare; a manually added game without a DB `id` may still supply its own command string through the old code path.
3. **CSP** — no Content-Security-Policy header is set for the renderer. Electron's `webSecurity: true` enforces same-origin for network fetches but does not restrict inline scripts.
