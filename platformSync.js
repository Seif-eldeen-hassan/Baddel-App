'use strict';

// ============================================================
// BADDEL LAUNCHER — platformSync.js
// ============================================================

const path        = require('path');
const fs          = require('fs').promises;
const fsSync      = require('fs');
const { execFile, exec } = require('child_process');
const { app, BrowserWindow, ipcMain } = require('electron');
const https = require('https');
const util = require('util');
const execAsync = util.promisify(exec);
const { getLocalSteamGames } = require('./gameScanner');

// ─── Paths ───────────────────────────────────────────────────
const LEGENDARY_BIN      = path.join(__dirname, 'bin', 'legendary.exe');
const SYNC_CACHE_DIR     = path.join(app.getPath('userData'), 'platform-sync');
const COVERS_DIR         = path.join(SYNC_CACHE_DIR, 'covers');

// Epic Paths
const EPIC_ACCOUNTS_FILE = path.join(SYNC_CACHE_DIR, 'epic_accounts.json');
const EPIC_MERGED_CACHE  = path.join(SYNC_CACHE_DIR, 'epic_library_merged.json');

// Steam Paths
const STEAM_ACCOUNTS_FILE = path.join(SYNC_CACHE_DIR, 'steam_accounts.json');
const STEAM_MERGED_CACHE  = path.join(SYNC_CACHE_DIR, 'steam_library_merged.json');


// ─── Helpers ─────────────────────────────────────────────────

async function ensureDirs() {
    await fs.mkdir(SYNC_CACHE_DIR, { recursive: true });
    await fs.mkdir(COVERS_DIR, { recursive: true });
}

async function _writeSwitcherSyncLink(platform, switcherProfileName, platformAccountId, extra = {}) {
    try {
        const switcherDir = path.join(app.getPath('userData'), 'accounts', platform, switcherProfileName.trim());
        await fs.mkdir(switcherDir, { recursive: true });
        const linkFile = path.join(switcherDir, 'sync_link.json');
        await fs.writeFile(linkFile, JSON.stringify({
            platformAccountId: String(platformAccountId),
            linkedAt: new Date().toISOString(),
            ...extra
        }, null, 2), 'utf8');
    } catch (e) {
        console.warn(`[PlatformSync] Could not write sync_link.json for ${platform}/${switcherProfileName}:`, e.message);
    }
}

async function downloadAndCacheCover(url, gameId) {
    if (!url) return null;
    if (!url.startsWith('https')) return url;

    const safeGameId = gameId.replace(/[^a-zA-Z0-9_-]/g, '');
    const destPath = path.join(COVERS_DIR, `${safeGameId}.jpg`);
    const localUrl = `file:///${destPath.replace(/\\/g, '/')}`;

    if (fsSync.existsSync(destPath)) return localUrl;

    try {
        const response = await fetch(url);
        if (!response.ok) return url; 

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(destPath, buffer);
        return localUrl;
    } catch (err) {
        console.error(`[Cover Sync] Error downloading ${gameId}:`, err);
        return url;
    }
}

// ─── Steam Bridge ────────────────────────────────────────────

const steamBridge = require('./steamBridge');

let _bridgeStarted = false;
async function _ensureBridgeRunning() {
    if (_bridgeStarted && steamBridge.isRunning) return;
    await steamBridge.start();
    _bridgeStarted = true;

    steamBridge.on('gamesUpdate', async (newGames) => {
        console.log(`[SteamBridge] 🎮 Background: ${newGames.length} new games discovered`);
        try {
            const existing = JSON.parse(await fs.readFile(STEAM_MERGED_CACHE, 'utf8').catch(() => '[]'));
            const map = new Map(existing.map(g => [g.id, g]));
            const accs = steamConnector.getAccounts();
            const ids = accs.map((a) => String(a.id));
            for (const g of newGames) {
                if (!map.has(g.id)) {
                    const coverUrl = await downloadAndCacheCover(
                        `https://steamcdn-a.akamaihd.net/steam/apps/${g.appid}/library_600x900.jpg`, g.id
                    );
                    map.set(g.id, {
                        id: g.id, title: g.title, platform: 'steam', source: 'steam',
                        coverUrl, appName: String(g.appid), playtime: 0,
                        lastSynced: new Date().toISOString(),
                        ownedBy: accs.map((a) => a.displayName),
                        ownedByAccountIds: ids,
                        steamLicensedAccountIds: ids,
                    });
                } else {
                    const ex = map.get(g.id);
                    if (!ex.steamLicensedAccountIds) ex.steamLicensedAccountIds = [];
                    for (const id of ids) {
                        if (!ex.steamLicensedAccountIds.includes(id)) ex.steamLicensedAccountIds.push(id);
                    }
                }
            }
            await fs.writeFile(STEAM_MERGED_CACHE, JSON.stringify([...map.values()], null, 2), 'utf8');
        } catch (e) {
            console.error('[SteamBridge] Failed to merge background games:', e.message);
        }
    });
}

// ─── Steam Login Window ───────────────────────────────────────
//
// steamId = null  →  أكاونت جديد — لازم نـ force fresh login حتى لو البريدج
//                    authenticated بأكاونت قديم
// steamId = "xxx" →  re-auth لأكاونت موجود باستخدام credentials المحفوظة

async function _openSteamLoginWindow(parentWindow, steamId = null) {
    const { BrowserWindow } = require('electron');

    return new Promise(async (resolve, reject) => {
        await _ensureBridgeRunning();

        let authResult;

        if (steamId) {
            // ─ Re-auth لأكاونت موجود ─────────────────────────
            const storedCreds = steamBridge.getCredentialsForAccount(steamId);
            authResult = await steamBridge.authenticate(storedCreds);

            // لو رجع authenticated بنفس الأكاونت — تمام
            if (authResult.status === 'authenticated') {
                if (String(authResult.steamId) === String(steamId)) {
                    return resolve(authResult);
                }
                // رجع بأكاونت مختلف — نكمّل ونفتح login
                console.warn(`[SteamBridge] Re-auth returned wrong account: ${authResult.steamId} !== ${steamId}`);
            }
        } else {
            // ─ أكاونت جديد: force fresh login ───────────────
            // مهم: نـ authenticate بـ null عشان البريدج ما يرجعش
            // الأكاونت اللي مسجّل دخوله قبل كده
            authResult = await steamBridge.authenticate(null);

            // لو البريدج رجع authenticated (session قديمة)، نطلب login جديد
            // بـ null credentials صريح — البريدج المفروض يرجع need_login
            if (authResult.status === 'authenticated') {
                // ده معناه في session نشطة — نـ logout أولاً
                try { await steamBridge._call('logout', {}); } catch {}
                authResult = await steamBridge.authenticate(null);
            }
        }

        if (authResult.status === 'error') {
            return reject(new Error(authResult.message));
        }

        // فتح نافذة الـ Login
        const win = new BrowserWindow({
            width: 500, height: 600,
            parent: parentWindow || undefined,
            modal: !!parentWindow,
            frame: false,
            backgroundColor: '#1a1a2e',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: false,
                allowRunningInsecureContent: true,
            },
            title: 'Connect Steam',
        });

        let currentEndUriRegex = authResult.endUriRegex;

        const checkUrl = async (url) => {
            if (!currentEndUriRegex) return;
            const regex = new RegExp(currentEndUriRegex);
            if (!regex.test(url)) return;

            try {
                const urlObj = new URL(url);
                const params = {};
                urlObj.searchParams.forEach((v, k) => { params[k] = v; });

                const result = await steamBridge.passLoginCredentials(url, params);

                if (result.status === 'authenticated') {
                    win.close();
                    resolve(result);
                } else if (result.status === 'need_2fa' || result.status === 'need_login') {
                    currentEndUriRegex = result.endUriRegex;
                    win.loadURL(result.loginUrl);
                } else {
                    win.close();
                    reject(new Error(result.message || 'Steam login failed'));
                }
            } catch (e) {
                win.close();
                reject(e);
            }
        };

        win.webContents.on('will-navigate', (_e, url) => { _e.preventDefault(); checkUrl(url); });
        win.webContents.on('did-navigate', (_e, url) => checkUrl(url));
        win.webContents.on('did-navigate-in-page', (_e, url) => checkUrl(url));
        win.on('closed', () => reject(new Error('Steam login window closed.')));

        win.loadURL(authResult.loginUrl);
        win.webContents.openDevTools({ mode: 'detach' });
    });
}

// ─── steamConnector ───────────────────────────────────────────

const steamConnector = {
    isLinked() {
        try {
            if (!fsSync.existsSync(STEAM_ACCOUNTS_FILE)) return false;
            return JSON.parse(fsSync.readFileSync(STEAM_ACCOUNTS_FILE, 'utf8')).length > 0;
        } catch { return false; }
    },

    getAccounts() {
        try {
            if (!fsSync.existsSync(STEAM_ACCOUNTS_FILE)) return [];
            const raw = JSON.parse(fsSync.readFileSync(STEAM_ACCOUNTS_FILE, 'utf8'));
            return Array.isArray(raw)
                ? raw.map((a) => ({ ...a, id: String(a.id) }))
                : [];
        } catch { return []; }
    },

    async link(parentWindow) {
        await ensureDirs();
        await _ensureBridgeRunning();

        // فتح login window لأكاونت جديد (steamId = null = force fresh login)
        const authResult = await _openSteamLoginWindow(parentWindow, null);

        if (authResult.status !== 'authenticated') {
            throw new Error('Steam authentication failed');
        }

        const { steamId, personaName } = authResult;
        const displayName = personaName || 'Steam User';
        const steamIdStr = String(steamId);

        // خزّن الـ credentials بالـ steamId الصح فوراً
        // (البريدج بيعمل ده أوتوماتيك عبر store_credentials event،
        //  بس نتأكد مانيالياً هنا عشان multi-account)
        // Steam64 ids exceed Number.MAX_SAFE_INTEGER — always store as string.

        let accounts = this.getAccounts();
        const existingIndex = accounts.findIndex(a => String(a.id) === steamIdStr);
        if (existingIndex > -1) {
            accounts[existingIndex].displayName = displayName;
            accounts[existingIndex].id = steamIdStr;
        } else {
            accounts.push({ id: steamIdStr, displayName });
        }

        await fs.writeFile(STEAM_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
        await _writeSwitcherSyncLink('steam', displayName, steamIdStr, { steamDisplayName: displayName });

        console.log(`[SteamBridge] ✅ Linked Steam account: ${displayName} (${steamIdStr})`);
        return displayName;
    },

    async syncLibrary() {
        await ensureDirs();
        const accounts = this.getAccounts();
        if (accounts.length === 0) throw new Error('No Steam accounts linked.');

        await _ensureBridgeRunning();

        const mergedLibrary = new Map();

        // ══════════════════════════════════════════════════════
        // STEP 1: لف على كل أكاونت وجيب ألعابه
        // ══════════════════════════════════════════════════════
        for (const account of accounts) {
            console.log(`[SteamBridge] 🔄 Syncing: ${account.displayName} (${account.id})`);

            try {
                const creds = steamBridge.getCredentialsForAccount(account.id) || { steam_id: account.id };
                const authResult = await steamBridge.authenticate(creds);

                if (authResult.status !== 'authenticated') {
                    console.warn(`[SteamBridge] ⚠️ ${account.displayName} not authenticated — skipping`);
                    continue;
                }

                // لو البريدج رجع بأكاونت مختلف — ده معناه الـ credentials مش صح
                // بـ safe نكمّل بس نسجّل warning
                if (authResult.steamId && String(authResult.steamId) !== String(account.id)) {
                    console.warn(`[SteamBridge] ⚠️ Expected ${account.id}, got ${authResult.steamId} — credentials mismatch`);
                }

                const result = await steamBridge.getOwnedGames();
                if (result.status !== 'success') {
                    console.warn(`[SteamBridge] getOwnedGames failed for ${account.displayName}:`, result);
                    continue;
                }

                console.log(`[SteamBridge] ✅ ${result.games.length} games for ${account.displayName}`);

                for (const game of result.games) {
                    const coverUrl = await downloadAndCacheCover(
                        `https://steamcdn-a.akamaihd.net/steam/apps/${game.appid}/library_600x900.jpg`,
                        game.id
                    );

                    const aid = String(account.id);
                    if (mergedLibrary.has(game.id)) {
                        const existing = mergedLibrary.get(game.id);
                        if (!existing.ownedBy.includes(account.displayName))
                            existing.ownedBy.push(account.displayName);
                        if (!existing.ownedByAccountIds.map(String).includes(aid))
                            existing.ownedByAccountIds.push(aid);
                        if (!existing.steamLicensedAccountIds) existing.steamLicensedAccountIds = [];
                        if (!existing.steamLicensedAccountIds.map(String).includes(aid))
                            existing.steamLicensedAccountIds.push(aid);
                    } else {
                        mergedLibrary.set(game.id, {
                            id:                      game.id,
                            title:                   game.title,
                            platform:                'steam',
                            source:                  'steam',
                            coverUrl,
                            appName:                 String(game.appid),
                            playtime:                0,
                            lastSynced:              new Date().toISOString(),
                            ownedBy:                 [account.displayName],
                            ownedByAccountIds:       [aid],
                            steamLicensedAccountIds: [aid],
                        });
                    }
                }
            } catch (err) {
                console.error(`[SteamBridge] ❌ Failed to sync ${account.displayName}:`, err.message);
            }
        }

        // ══════════════════════════════════════════════════════
        // STEP 2: ضم الألعاب المحلية (Family Share + Offline)
        // ══════════════════════════════════════════════════════
        try {
            const localGames = await getLocalSteamGames();
            let addedFromLocal = 0;

            for (const game of localGames) {
                const gameId = `steam_${game.appid}`;
                if (mergedLibrary.has(gameId)) {
                    // Keep steamLicensedAccountIds / ownedBy* as from API only — do not mark every linked account as "owning" a family-shared install.
                    const existing = mergedLibrary.get(gameId);
                    if (!existing.steamLicensedAccountIds) existing.steamLicensedAccountIds = [];
                } else {
                    addedFromLocal++;
                    const coverUrl = await downloadAndCacheCover(
                        `https://steamcdn-a.akamaihd.net/steam/apps/${game.appid}/library_600x900.jpg`,
                        gameId
                    );
                    mergedLibrary.set(gameId, {
                        id:                      gameId,
                        title:                   game.name,
                        platform:                'steam',
                        source:                  'steam',
                        coverUrl,
                        appName:                 String(game.appid),
                        playtime:                0,
                        lastSynced:              new Date().toISOString(),
                        ownedBy:                 [],
                        ownedByAccountIds:       [],
                        steamLicensedAccountIds: [],
                        installOnly:             true,
                    });
                }
            }
            console.log(`[MERGE] 📁 Added ${addedFromLocal} games from local manifests`);
        } catch (err) {
            console.error('[PlatformSync] Failed to merge local Steam games:', err);
        }

        const finalGames = Array.from(mergedLibrary.values());
        console.log(`\n🎉 Final Steam Library: ${finalGames.length} games from ${accounts.length} account(s)\n`);

        await fs.writeFile(STEAM_MERGED_CACHE, JSON.stringify(finalGames, null, 2), 'utf8');
        return finalGames;
    },

    async getCachedLibrary() {
        try { return JSON.parse(await fs.readFile(STEAM_MERGED_CACHE, 'utf8')); }
        catch { return []; }
    },

    async unlink(accountId) {
        let accounts = this.getAccounts();

        if (accountId) {
            accounts = accounts.filter(a => a.id !== accountId);
            steamBridge.deleteCredentialsForAccount(accountId);
        } else {
            for (const acc of accounts) steamBridge.deleteCredentialsForAccount(acc.id);
            accounts = [];
        }

        await fs.writeFile(STEAM_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');

        if (accounts.length === 0) {
            try { await fs.unlink(STEAM_MERGED_CACHE); } catch {}
            if (steamBridge.isRunning) await steamBridge.stop();
            _bridgeStarted = false;
        }
    },
};


// ============================================================
// ─── EPIC CONNECTOR ─────────────────────────────────────────
// ============================================================

function getLegendaryConfPath(accountId) {
    return path.join(app.getPath('userData'), `legendary-config-${accountId}`);
}

async function getEpicAccountsList() {
    try { return JSON.parse(await fs.readFile(EPIC_ACCOUNTS_FILE, 'utf8')); } 
    catch { return []; }
}

async function saveEpicAccountsList(accounts) {
    await ensureDirs();
    await fs.writeFile(EPIC_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
}

function runLegendary(args, configPath, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
        if (!fsSync.existsSync(LEGENDARY_BIN)) {
            return reject(new Error(`legendary.exe not found at ${LEGENDARY_BIN}`));
        }

        const env  = { ...process.env, LEGENDARY_CONFIG_PATH: configPath };
        const proc = execFile(LEGENDARY_BIN, args, { env, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 50 });

        let out = '', err = '';
        proc.stdout?.on('data', d => { out += d; });
        proc.stderr?.on('data', d => { err += d; });

        proc.on('close', code => {
            if (code === 0) resolve(out);
            else reject(new Error(err.trim() || `legendary exited with code ${code}`));
        });
        proc.on('error', reject);
    });
}

function openEpicLoginWindow(parentWindow) {
    return new Promise((resolve, reject) => {
        let codeFound = false;

        const win = new BrowserWindow({
            width: 480, height: 660, parent: parentWindow || undefined, modal: !!parentWindow,
            frame: false, backgroundColor: '#121212', 
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
            title: 'Connect Epic Games',
        });

        const customUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        win.webContents.on('did-finish-load', () => {
            win.webContents.insertCSS(`
                #nav-logo-con, .site-navbar, footer { display: none !important; }
            `).catch(()=>{});

            win.webContents.executeJavaScript(`
                if (!document.getElementById('baddel-close-btn')) {
                    const btn = document.createElement('div');
                    btn.id = 'baddel-close-btn';
                    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                    btn.style.cssText = 'position:fixed; top:12px; right:12px; width:32px; height:32px; background:rgba(255,255,255,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:999999; transition:0.2s;';
                    btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.2)';
                    btn.onmouseout = () => btn.style.background = 'rgba(255,255,255,0.1)';
                    btn.onclick = () => window.close();
                    document.body.appendChild(btn);
                    
                    const drag = document.createElement('div');
                    drag.style.cssText = 'position:fixed; top:0; left:0; right:50px; height:40px; -webkit-app-region: drag; z-index:999998;';
                    document.body.appendChild(drag);
                }
            `).catch(()=>{});
        });

        const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(`https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code`)}`;
        
        win.webContents.session.clearStorageData().then(() => win.loadURL(LOGIN_URL, { userAgent: customUserAgent }));
        
        win.webContents.on('did-navigate', async (_e, url) => {
            if (!url.includes('/id/api/redirect')) return;
            try {
                const bodyText = await win.webContents.executeJavaScript('document.body.innerText');
                const data = JSON.parse(bodyText);
                if (data?.authorizationCode) {
                    codeFound = true;
                    win.close();
                    resolve(data.authorizationCode);
                }
            } catch { /* wait */ }
        });

        win.on('closed', () => { if (!codeFound) reject(new Error('Epic login cancelled.')); });
    });
}

function _pickEpicCover(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    const PREF = ['DieselGameBoxTall', 'DieselGameBox', 'OfferImageTall', 'Thumbnail'];
    for (const type of PREF) {
        const img = keyImages.find(k => k.type === type);
        if (img?.url) return img.url;
    }
    return keyImages[0]?.url || null;
}

const epicConnector = {
    isLinked() {
        try { return fsSync.existsSync(EPIC_ACCOUNTS_FILE) && JSON.parse(fsSync.readFileSync(EPIC_ACCOUNTS_FILE, 'utf8')).length > 0; } 
        catch { return false; }
    },
    getAccounts() {
        try { return fsSync.existsSync(EPIC_ACCOUNTS_FILE) ? JSON.parse(fsSync.readFileSync(EPIC_ACCOUNTS_FILE, 'utf8')) : []; } 
        catch { return []; }
    },
    async link(parentWindow) {
        await ensureDirs();
        const authCode = await openEpicLoginWindow(parentWindow);
        const tmpId = `epic_tmp_${Date.now()}`;
        const confPath = getLegendaryConfPath(tmpId);
        await fs.mkdir(confPath, { recursive: true });
        try {
            await runLegendary(['auth', '--code', authCode], confPath);
            const raw = await runLegendary(['status', '--json'], confPath);
            const status = JSON.parse(raw);
            const accountId   = status.account_id   || status.user?.account_id   || tmpId;
            const displayName = status.display_name  || status.user?.display_name || 'Epic User';
            const realConfPath = getLegendaryConfPath(accountId);
            if (confPath !== realConfPath) {
                await fs.rename(confPath, realConfPath).catch(async () => {
                    await fs.cp(confPath, realConfPath, { recursive: true });
                    await fs.rm(confPath, { recursive: true, force: true });
                });
            }
            let accounts = await getEpicAccountsList();
            if (!accounts.find(a => a.id === accountId)) {
                accounts.push({ id: accountId, displayName });
                await saveEpicAccountsList(accounts);
            }
            await _writeSwitcherSyncLink('epic', displayName, accountId, { epicDisplayName: displayName });
            return displayName;
        } catch (err) {
            await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            throw err;
        }
    },
    async syncLibrary() {
        await ensureDirs();
        const accounts = await getEpicAccountsList();
        if (accounts.length === 0) throw new Error('No Epic accounts linked.');

        const mergedLibrary = new Map();
        for (const acc of accounts) {
            const confPath = getLegendaryConfPath(acc.id);
            if (!fsSync.existsSync(confPath)) continue;

            try {
                const raw = await runLegendary(['list', '--json'], confPath, 120_000);
                const parsed = JSON.parse(raw);

                for (const entry of parsed) {
                    const gameId = `epic_${entry.app_name}`;
                    const remoteCoverUrl = _pickEpicCover(entry.metadata?.keyImages);
                    const cachedCoverUrl = await downloadAndCacheCover(remoteCoverUrl, gameId);

                    if (mergedLibrary.has(gameId)) {
                        const existingGame = mergedLibrary.get(gameId);
                        if (!existingGame.ownedBy.includes(acc.displayName)) existingGame.ownedBy.push(acc.displayName);
                        if (!existingGame.ownedByAccountIds.includes(acc.id)) existingGame.ownedByAccountIds.push(acc.id);
                    } else {
                        mergedLibrary.set(gameId, {
                            id: gameId, title: entry.app_title || entry.app_name,
                            platform: 'epic', source: 'epic', coverUrl: cachedCoverUrl, appName: entry.app_name,
                            namespace: entry.namespace || entry.metadata?.namespace || '',
                            catalogItemId: entry.catalog_item_id || entry.metadata?.id || '',
                            lastSynced: new Date().toISOString(),
                            ownedBy: [acc.displayName], ownedByAccountIds: [acc.id] 
                        });
                    }
                }
            } catch (err) { console.error(`Failed to sync Epic:`, err); }
        }
        const finalGames = Array.from(mergedLibrary.values());
        await fs.writeFile(EPIC_MERGED_CACHE, JSON.stringify(finalGames, null, 2), 'utf8');
        return finalGames;
    },
    async getCachedLibrary() {
        try { return JSON.parse(await fs.readFile(EPIC_MERGED_CACHE, 'utf8')); } 
        catch { return []; }
    },
    async unlink(accountId) {
        let accounts = await getEpicAccountsList();
        if (accountId) {
            const confPath = getLegendaryConfPath(accountId);
            try { await runLegendary(['auth', '--delete'], confPath); } catch {}
            await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            accounts = accounts.filter(a => a.id !== accountId);
        } else {
            for (const acc of accounts) {
                const confPath = getLegendaryConfPath(acc.id);
                try { await runLegendary(['auth', '--delete'], confPath); } catch {}
                await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            }
            accounts = [];
        }
        await saveEpicAccountsList(accounts);
        if (accounts.length === 0) { try { await fs.unlink(EPIC_MERGED_CACHE); } catch {} }
    },
};

// ─── IPC Handler Registry ────────────────────────────────────

function registerPlatformSyncHandlers(ipcMainRef, getMainWindow) {
    const connectors = {
        epic: epicConnector,
        steam: steamConnector 
    };

    function safeHandle(fn) {
        return async (...args) => {
            try { return await fn(...args); } 
            catch (err) {
                console.error('[PlatformSync] IPC error:', err);
                return { status: 'error', message: err?.message || 'Unknown error.' };
            }
        };
    }

    ipcMainRef.handle('platform-sync:status', safeHandle(async () => {
        return Object.fromEntries(Object.entries(connectors).map(([k, v]) => [k, v.isLinked()]));
    }));

    ipcMainRef.handle('platform-sync:get-accounts', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector || !connector.getAccounts) return { status: 'success', accounts: [] };
        return { status: 'success', accounts: connector.getAccounts() };
    }));

    ipcMainRef.handle('platform-sync:link', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        console.log(`[PlatformSync] Linking platform: ${platform}`);
        const displayName = await connector.link(getMainWindow?.());
        return { status: 'success', displayName };
    }));

    ipcMainRef.handle('platform-sync:sync', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        const games = await connector.syncLibrary();
        return { status: 'success', games };
    }));

    ipcMainRef.handle('platform-sync:get-cached', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        const games = await connector.getCachedLibrary?.() ?? [];
        return { status: 'success', games };
    }));

    ipcMainRef.handle('platform-sync:unlink', safeHandle(async (_e, platform, accountId) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        await connector.unlink(accountId);
        return { status: 'success' };
    }));
}

// ─── Data Enrichment Helper ───────────────────────────────────

const ALL_CONNECTORS = {
    epic: epicConnector,
    steam: steamConnector 
};

async function enrichProfilesWithSyncData(platform, switcherProfiles) {
    const connector = ALL_CONNECTORS[platform];

    const normalized = switcherProfiles.map(p => {
        if (typeof p === 'string') return { name: p, username: p, displayName: p, id: p };
        return { name: p.name || p.username || p.displayName || String(p.id || ''), ...p };
    });

    if (!connector || !connector.getCachedLibrary || !connector.getAccounts) {
        return normalized.map(p => ({ ...p, isSynced: false, ownedGames: [] }));
    }

    try {
        const syncedAccounts = await connector.getAccounts();
        const library = await connector.getCachedLibrary();

        return normalized.map(profile => {
            const realId = profile.platformAccountId ? String(profile.platformAccountId) : String(profile.id || profile.accountId || profile.username || profile.name);
            const isSynced = syncedAccounts.some(sa => String(sa.id) === realId);
            const ownedGames = library.filter((g) => {
                if (platform === 'steam' && Array.isArray(g.steamLicensedAccountIds)) {
                    return g.steamLicensedAccountIds.some((id) => String(id) === realId);
                }
                return g.ownedByAccountIds && g.ownedByAccountIds.some((id) => String(id) === realId);
            }).map((g) => g.title);

            return { ...profile, isSynced, ownedGames, _resolvedSyncId: realId };
        });
    } catch (e) {
        console.error(`[PlatformSync] Error enriching profiles for ${platform}:`, e);
        return normalized;
    }
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
    registerPlatformSyncHandlers,
    epicConnector,
    steamConnector,
    enrichProfilesWithSyncData 
};
