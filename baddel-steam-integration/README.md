# baddel-steam-integration

Steam integration plugin for **Baddel Launcher** — an Electron-based game launcher.

Adapted from [FriendsOfGalaxy/galaxy-integration-steam](https://github.com/FriendsOfGalaxy/galaxy-integration-steam).  
All GOG Galaxy SDK dependencies have been removed. The Python plugin now communicates with Electron via **JSON-RPC over stdin/stdout**.

## Architecture

```
Electron (Node.js)
    │  steamBridge.js  — manages the Python subprocess, exposes async API
    │  JSON-RPC over stdin/stdout
    ▼
src/baddel_bridge.py  — entry point, replaces plugin.py
    │
    ▼
src/steam_network/    — unchanged Steam protocol layer (WebSocket + Protobuf)
```

## Setup

### 1. Install Python dependencies
```bash
pip install galaxy.plugin.api websockets rsa certifi protobuf aiohttp yarl
```

> `galaxy.plugin.api` is used only for its protobuf helpers and enums.  
> No GOG Galaxy client is required.

### 2. Place the plugin next to your Electron app
```
your-electron-app/
├── steam_plugin/        ← this repo
│   └── src/
│       └── baddel_bridge.py
└── steamBridge.js       ← copy from repo root
```

### 3. Use in Electron

```js
const bridge = require('./steamBridge');

// Start the bridge (once, on app launch)
await bridge.start();

// Authenticate (pass null on first run, saved creds on subsequent runs)
const savedCreds = bridge.getSavedCredentials();
const auth = await bridge.authenticate(savedCreds);

if (auth.status === 'need_login') {
    // Show auth.loginUrl in a BrowserView/WebView
    // When it redirects to a URL matching auth.endUriRegex:
    const result = await bridge.passLoginCredentials(theEndUri, {});
}

if (auth.status === 'authenticated') {
    const { games } = await bridge.getOwnedGames();
}

// Listen for background updates
bridge.on('gamesUpdate', (newGames) => { /* merge into library */ });
bridge.on('credentialsChanged', (creds) => { /* auto-saved */ });

// Shutdown cleanly
app.on('before-quit', async () => { await bridge.stop(); });
```

## API Reference

| Method | Returns |
|--------|---------|
| `bridge.start()` | Starts Python subprocess |
| `bridge.stop()` | Graceful shutdown |
| `bridge.authenticate(creds?)` | `{ status, steamId?, personaName?, loginUrl?, endUriRegex? }` |
| `bridge.passLoginCredentials(endUri, params)` | Same as authenticate |
| `bridge.getOwnedGames()` | `{ status, games: [{id, title, appid}] }` |
| `bridge.getFriends()` | `{ status, friends: [{userId, username, avatarUrl}] }` |
| `bridge.getAchievements(gameIds)` | `{ status, achievements: {gameId: [{name, unlockTime}]} }` |
| `bridge.getGameTimes()` | `{ status, times: {appid: {timePlayed, lastPlayed}} }` |

## Events

| Event | Data |
|-------|------|
| `gamesUpdate` | `[{id, title, appid}]` — new games found in background |
| `presenceUpdate` | `{userId, status, gameId, gameTitle}` |
| `credentialsChanged` | encrypted credentials dict (auto-saved) |
| `disconnected` | `{code, signal}` — process exited unexpectedly |

## Credits

Steam protocol layer based on [FriendsOfGalaxy/galaxy-integration-steam](https://github.com/FriendsOfGalaxy/galaxy-integration-steam).  
Original auth flow by [@ABaumher](https://github.com/ABaumher).  
Influenced by [SteamKit](https://github.com/SteamRE/SteamKit) and [ValvePython](https://github.com/ValvePython/steam).
