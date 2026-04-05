'use strict';

const path          = require('path');
const fs            = require('fs').promises;
const fsSync        = require('fs');
const os            = require('os');
const { exec, spawn } = require('child_process');
const { execSync }    = require('child_process');
const crypto          = require('crypto');
const { app, net, shell } = require('electron');
const util          = require('util');
const execAsync     = util.promisify(exec);
const DiscordRPC    = require('discord-rpc');
const analytics = require('./analytics');

// ─── Constants ───────────────────────────────────────────────────────────────

const DATA_DIR                  = () => path.join(app.getPath('userData'), 'accounts');
const activeEpicProfilePath     = path.join(app.getPath('userData'), 'active_epic_profile.json');
const activeRiotProfilePath     = path.join(app.getPath('userData'), 'active_riot_profile.json');
const activeEAProfilePath       = path.join(app.getPath('userData'), 'active_ea_profile.json');
const activeUbisoftProfilePath  = path.join(app.getPath('userData'), 'active_ubisoft_profile.json');
const activeDiscordProfilePath  = path.join(app.getPath('userData'), 'active_discord_profile.json');
const activeRockstarProfilePath = path.join(app.getPath('userData'), 'active_rockstar_profile.json');

const STEAM_REG   = 'HKCU\\Software\\Valve\\Steam';
const STEAM_REG64 = 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam';

const RIOT_PROCESSES = [
    'RiotClientServices.exe',
    'RiotClientUx.exe',
    'VALORANT.exe',
    'LeagueClient.exe',
];

const UBISOFT_REG = 'HKCU\\Software\\Ubisoft\\Launcher';

const DISCORD_RPC_CLIENT_ID = '207646673902501888';

// ─── Secure Process Launcher ─────────────────────────────────────────────────

/**
 * Launches an executable safely using spawn() instead of exec().
 * This avoids shell interpretation entirely, eliminating Command Injection risk.
 * @param {string} exePath - Absolute path to the executable (already validated to exist).
 * @param {string[]} [args=[]] - Array of arguments (never concatenated into a shell string).
 */
function spawnExe(exePath, args = []) {
    const child = spawn(exePath, args, {
        detached: true,   // Let the child outlive this process
        stdio:    'ignore',
        shell:    false,  // CRITICAL: no shell → no injection surface
    });
    child.unref(); // Don't keep the event loop alive
}

// ─── Encryption Layer ─────────────────────────────────────────────────────────

/**
 * AES-256-GCM encryption layer with Windows Credential Manager key storage.
 *
 * Key lifecycle:
 *   1. On first run: generate a random 256-bit key, store it in Windows
 *      Credential Manager via `keytar` (DPAPI-protected, tied to the Windows
 *      user account — NOT just a file path).
 *   2. On subsequent runs: load the key from Credential Manager into memory.
 *   3. The raw key bytes are NEVER written to disk.
 *
 * Fallback (keytar unavailable / non-Windows):
 *   Derives a key from userData path + salt via scrypt — weaker but functional.
 *   A warning is logged in this case.
 *
 * Layout of an encrypted file (all binary):
 *   [4 bytes: magic "BDEL"] [1 byte: version=1]
 *   [12 bytes: IV] [16 bytes: authTag] [N bytes: ciphertext]
 */

const ENCRYPT_MAGIC         = Buffer.from('BDEL');
const ENCRYPT_VERSION       = 1;
const KEYTAR_SERVICE        = 'baddel-account-switcher';
const KEYTAR_ACCOUNT        = 'master-encryption-key';
const ENCRYPT_SALT_FALLBACK = 'baddel-accounts-v1';

let _encKey    = null; // in-memory only, never written to disk
let _keytarLib = null; // lazy-loaded

/** Lazily load keytar — optional native dependency. */
function tryLoadKeytar() {
    if (_keytarLib !== null) return _keytarLib;
    try {
        _keytarLib = require('keytar');
    } catch {
        _keytarLib = undefined;
        console.warn('[ENCRYPT] keytar not available — falling back to scrypt key derivation. ' +
                     'Install keytar for Windows Credential Manager protection.');
    }
    return _keytarLib;
}

/**
 * Returns the 256-bit encryption key (async).
 * Tries Windows Credential Manager first, falls back to scrypt derivation.
 */
async function getEncryptionKey() {
    if (_encKey) return _encKey;

    const keytar = tryLoadKeytar();

    if (keytar) {
        try {
            let storedB64 = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);

            if (!storedB64) {
                // First run: generate a cryptographically random key and persist it.
                // keytar stores it via DPAPI — tied to the Windows user account.
                const newKey = crypto.randomBytes(32);
                await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, newKey.toString('base64'));
                storedB64 = newKey.toString('base64');
                console.log('[ENCRYPT] New master key generated and stored in Windows Credential Manager.');
            }

            _encKey = Buffer.from(storedB64, 'base64');
            return _encKey;
        } catch (err) {
            console.error('[ENCRYPT] Credential Manager error, falling back to scrypt:', err.message);
        }
    }

    // Fallback: derive key from machine path + salt
    const secret = app.getPath('userData') + ENCRYPT_SALT_FALLBACK;
    _encKey = crypto.scryptSync(secret, ENCRYPT_SALT_FALLBACK, 32);
    return _encKey;
}

/** Zero-out and clear the in-memory key (call on app quit). */
function clearEncryptionKeyCache() {
    if (_encKey) { _encKey.fill(0); _encKey = null; }
}

async function encryptBuffer(plainBuf) {
    const key = await getEncryptionKey();
    const iv  = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
    const authTag   = cipher.getAuthTag(); // 128-bit tag

    return Buffer.concat([
        ENCRYPT_MAGIC,
        Buffer.from([ENCRYPT_VERSION]),
        iv,
        authTag,
        encrypted,
    ]);
}

async function decryptBuffer(encBuf) {
    // Validate magic + version
    if (encBuf.length < 4 + 1 + 12 + 16) throw new Error('Encrypted file too short.');
    if (!encBuf.slice(0, 4).equals(ENCRYPT_MAGIC)) throw new Error('Not an encrypted baddel file.');
    if (encBuf[4] !== ENCRYPT_VERSION)             throw new Error('Unknown encryption version.');

    const iv         = encBuf.slice(5,  17);
    const authTag    = encBuf.slice(17, 33);
    const ciphertext = encBuf.slice(33);

    const key      = await getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Returns true if a file on disk starts with our magic header. */
function isEncryptedFile(buf) {
    return buf.length >= 4 && buf.slice(0, 4).equals(ENCRYPT_MAGIC);
}

/** Encrypt a string value → base64 string (for storing in JSON fields). */
async function encryptString(plainText) {
    if (!plainText) return plainText;
    const buf = await encryptBuffer(Buffer.from(plainText, 'utf8'));
    return buf.toString('base64');
}

/** Decrypt a base64-encoded encrypted string back to plaintext. */
async function decryptString(encBase64) {
    if (!encBase64) return encBase64;
    try {
        const buf = Buffer.from(encBase64, 'base64');
        if (!isEncryptedFile(buf)) return encBase64; // not encrypted yet (legacy)
        return (await decryptBuffer(buf)).toString('utf8');
    } catch {
        return encBase64; // fallback: return as-is if decryption fails
    }
}

/**
 * Sensitive file extensions/names that should be stored encrypted.
 * Covers Riot YAML tokens, Ubisoft JSON sessions, EA session blobs, etc.
 */
const SENSITIVE_PATTERNS = [
    /\.yaml$/i, /\.yml$/i,
    /RiotGamesPrivateSettings/i,
    /token/i, /session/i, /credential/i, /auth/i,
    /\.json$/i,   // EA & Ubisoft store tokens in JSON
];

function isSensitiveFile(filePath) {
    const base = path.basename(filePath);
    return SENSITIVE_PATTERNS.some(re => re.test(base));
}

/**
 * Encrypting copyFile: encrypts sensitive files on the way into the vault,
 * decrypts them on the way out to the live directory.
 *
 * Direction:
 *   'encrypt' → reading plaintext from live dir, writing ciphertext to vault
 *   'decrypt' → reading ciphertext from vault, writing plaintext to live dir
 *   'passthrough' → plain copy (non-sensitive files, e.g. images, binaries)
 */
async function secureCopyFile(srcPath, destPath, direction = 'passthrough') {
    const srcBuf = await fs.readFile(srcPath);

    let destBuf;
    if (direction === 'encrypt' && isSensitiveFile(srcPath)) {
        destBuf = await encryptBuffer(srcBuf);
    } else if (direction === 'decrypt' && isEncryptedFile(srcBuf)) {
        try {
            destBuf = await decryptBuffer(srcBuf);
        } catch {
            // Fallback: file may have been saved before encryption was introduced
            destBuf = srcBuf;
        }
    } else {
        destBuf = srcBuf;
    }

    await fs.writeFile(destPath, destBuf);
}

/**
 * Encrypting/decrypting directory copy.
 * Drop-in replacement for copyDir() when security context is needed.
 */
async function secureCopyDir(src, dest, direction = 'passthrough') {
    if (!src || !dest) return;
    if (!fsSync.existsSync(dest)) await ensureDir(dest);
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.name) continue;
        const srcPath  = path.join(src,  entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await secureCopyDir(srcPath, destPath, direction);
        } else {
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await secureCopyFile(srcPath, destPath, direction);
                    break;
                } catch (err) {
                    if (attempt === 3) console.error(`[SecureCopyDir] Failed: ${srcPath}`, err.message);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
    }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function createLogger(prefix) {
    const icons = { INFO: '🔵 [INFO]', SUCCESS: '🟢 [SUCCESS]', WARN: '🟠 [WARN]', ERROR: '🔴 [ERROR]' };
    return (message, type = 'INFO') => {
        const time = new Date().toISOString();
        const line = `[${prefix}] [${time}] ${icons[type] || icons.INFO} ${message}`;
        console.log(line);
        // Persist logs to disk in production
        try {
            const logPath = path.join(app.getPath('userData'), 'accounts_handler.log');
            fsSync.appendFileSync(logPath, line + '\n', 'utf8');
        } catch { /* non-fatal */ }
    };
}

const eaLog      = createLogger('EA');
const ubiLog     = createLogger('UBISOFT');
const discordLog = createLogger('DISCORD');
const rockstarLog = createLogger('ROCKSTAR');

// ─── Security Helpers ────────────────────────────────────────────────────────

/**
 * Sanitizes a profile name to prevent path traversal attacks.
 * Strips any directory separators or relative path components.
 */
function sanitizeName(name) {
    if (!name || typeof name !== 'string') throw new Error('Invalid profile name.');
    const trimmed = name.trim();
    // Reject names with path separators or relative components
    if (/[/\\]/.test(trimmed) || trimmed === '..' || trimmed === '.') {
        throw new Error('Invalid profile name: must not contain path separators.');
    }
    // Only allow safe characters: letters, numbers, spaces, hyphens, underscores, dots
    if (!/^[\w\s\-. ]+$/.test(trimmed)) {
        throw new Error('Invalid profile name: contains disallowed characters.');
    }
    if (trimmed.length > 64) throw new Error('Profile name is too long (max 64 characters).');
    return trimmed;
}

// ─── File System Helpers ─────────────────────────────────────────────────────

async function ensureDir(p) {
    await fs.mkdir(p, { recursive: true });
    return p;
}

async function removeDir(p) {
    if (!fsSync.existsSync(p)) return;
    try {
        const trashPath = `${p}_OLD_${Date.now()}`;
        await fs.rename(p, trashPath);
        fs.rm(trashPath, { recursive: true, force: true }).catch(() => {});
    } catch {
        try { await fs.rm(p, { recursive: true, force: true }); } catch { /* ignored */ }
    }
}

async function copyDir(src, dest) {
    if (!src || !dest) return;
    if (!fsSync.existsSync(dest)) await ensureDir(dest);
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.name) continue;
        const srcPath  = path.join(src,  entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await fs.copyFile(srcPath, destPath);
                    break;
                } catch (err) {
                    if (attempt === 3) console.error(`[CopyDir] Failed: ${srcPath}`, err.message);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
    }
}

async function safeReadFile(p) {
    try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

async function safeWriteFile(p, content) {
    await ensureDir(path.dirname(p));
    await fs.writeFile(p, content, 'utf8');
}

async function safeReadJson(p) {
    try {
        const raw = await fs.readFile(p, 'utf8');
        return JSON.parse(raw);
    } catch { return null; }
}

async function safeWriteJson(p, obj) {
    await safeWriteFile(p, JSON.stringify(obj, null, 2));
}

// ─── Registry Helpers ────────────────────────────────────────────────────────

function regQuery(key, value) {
    return execAsync(`reg query "${key}" /v "${value}" 2>nul`)
        .then(r => {
            const m = r.stdout.match(/REG_\w+\s+(.+)/);
            return m ? m[1].trim() : null;
        })
        .catch(() => null);
}

function regSet(key, value, type, data) {
    return execAsync(`reg add "${key}" /v "${value}" /t ${type} /d "${data}" /f`).catch(() => null);
}

function regDelete(key, value) {
    return execAsync(`reg delete "${key}" /v "${value}" /f 2>nul`).catch(() => null);
}

// ─── Process Helpers ─────────────────────────────────────────────────────────

async function killProcess(exeName) {
    try { await execAsync(`taskkill /IM "${exeName}" /F 2>nul`); } catch { /* already dead */ }
}

async function waitForProcessDeath(exeName, maxMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH 2>nul`);
            if (!stdout.toLowerCase().includes(exeName.toLowerCase())) return true;
        } catch { return true; }
        await new Promise(r => setTimeout(r, 400));
    }
    return false;
}

async function createEABridge(target, link) {
    if (fsSync.existsSync(link)) {
        await fs.rm(link, { recursive: true, force: true }).catch(() => {});
    }
    await fs.mkdir(path.dirname(link), { recursive: true });
    try {
        execSync(`mklink /J "${link}" "${target}"`, { stdio: 'ignore' });
    } catch {
        await fs.symlink(target, link, 'junction');
    }
}

async function findExeFromShortcut(shortcutName) {
    const searchPaths = [
        path.join(process.env['PROGRAMDATA'] || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
        path.join(process.env['APPDATA']     || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft\\Windows\\Start Menu\\Programs'),
    ];

    for (const searchDir of searchPaths) {
        if (!fsSync.existsSync(searchDir)) continue;
        try {
            const { stdout } = await execAsync(`where /r "${searchDir}" "${shortcutName}.lnk" 2>nul`);
            const lnkPath = stdout.trim().split(/\r?\n/)[0];
            if (!lnkPath || !fsSync.existsSync(lnkPath)) continue;

            const psCmd = `powershell -NoProfile -Command "(New-Object -COM WScript.Shell).CreateShortcut('${lnkPath.trim().replace(/'/g, "''")}').TargetPath"`;
            const { stdout: target } = await execAsync(psCmd);
            const exePath = target.trim();
            if (exePath && fsSync.existsSync(exePath)) return exePath;
        } catch { /* continue */ }
    }
    return null;
}

async function findUbisoftExe() {
    return await findExeFromShortcut('Ubisoft Connect')
        || path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe');
}

// ─── Profile Helpers ─────────────────────────────────────────────────────────

async function getProfiles(savedDir) {
    try {
        if (!fsSync.existsSync(savedDir)) return [];
        const entries = await fs.readdir(savedDir, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && !e.name.includes('_OLD_'))
            .map(e => e.name);
    } catch { return []; }
}

// نفس getProfiles بس بترجع objects بدل strings
// وبتضم platformAccountId من sync_link.json لو موجود
async function getProfilesWithMeta(savedDir) {
    const names = await getProfiles(savedDir);
    return names.map(name => {
        let platformAccountId = null;
        try {
            const raw = fsSync.readFileSync(path.join(savedDir, name, 'sync_link.json'), 'utf8');
            platformAccountId = JSON.parse(raw).platformAccountId || null;
        } catch { /* no sync_link yet */ }
        return {
            id:                name,
            displayName:       name,
            username:          name,
            platformAccountId,
        };
    });
}

// ─── STEAM ───────────────────────────────────────────────────────────────────

async function getSteamPath() {
    const fromReg = await regQuery(STEAM_REG64, 'InstallPath')
                 || await regQuery(STEAM_REG,   'SteamPath');
    if (fromReg && fsSync.existsSync(fromReg)) return fromReg;

    const defaults = [
        'C:\\Program Files (x86)\\Steam',
        'C:\\Program Files\\Steam',
        path.join(os.homedir(), '.steam', 'steam'),
    ];
    return defaults.find(p => fsSync.existsSync(p)) || null;
}

async function parseSteamLoginUsers(steamPath) {
    const vdfPath = path.join(steamPath, 'config', 'loginusers.vdf');
    const raw = await safeReadFile(vdfPath);
    if (!raw) return [];

    const accounts = [];
    const blocks = [...raw.matchAll(/"(\d{17,})"\s*\{([^}]+)\}/gs)];

    for (const [, steamId, body] of blocks) {
        const get = k => {
            const m = body.match(new RegExp(`"${k}"\\s+"([^"]*)"`, 'i'));
            return m ? m[1] : '';
        };
        accounts.push({
            steamId,
            username:    get('AccountName'),
            displayName: get('PersonaName'),
            mostRecent:  get('mostrecent') === '1',
        });
    }
    return accounts.sort((a, b) => (b.mostRecent ? 1 : 0) - (a.mostRecent ? 1 : 0));
}

async function getSteamAccounts() {
    const steamPath = await getSteamPath();
    if (!steamPath) return [];
    return parseSteamLoginUsers(steamPath);
}

async function getLocalSteamAvatar(steamId) {
    try {
        const steamPath = await getSteamPath();
        if (!steamPath) return null;

        const cacheDir = path.join(steamPath, 'config', 'avatarcache');
        const candidates = [
            path.join(cacheDir, `${steamId}_full.jpg`),
            path.join(cacheDir, `${steamId}_medium.jpg`),
            path.join(cacheDir, `${steamId}.jpg`),
        ];
        for (const p of candidates) {
            if (fsSync.existsSync(p)) return `file://${p.replace(/\\/g, '/')}`;
        }
        return null;
    } catch {
        return null;
    }
}

async function getSteamAvatarUrl(steamId) {
    return new Promise(resolve => {
        const request = net.request(`https://steamcommunity.com/profiles/${steamId}/?xml=1`);

        request.on('response', response => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                const match = data.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
                if (match?.[1]) {
                    resolve(match[1]);
                } else {
                    resolve(getLocalSteamAvatar(steamId));
                }
            });
        });

        request.on('error', () => resolve(getLocalSteamAvatar(steamId)));
        request.end();
    });
}

async function switchSteam(username) {
    const steamPath = await getSteamPath();
    if (!steamPath) throw new Error('Steam installation not found.');

    await killProcess('steam.exe');
    await waitForProcessDeath('steam.exe', 4000);

    await regSet(STEAM_REG, 'AutoLoginUser',    'REG_SZ',    username);
    await regSet(STEAM_REG, 'RememberPassword', 'REG_DWORD', '1');

    const vdfPath = path.join(steamPath, 'config', 'loginusers.vdf');
    let raw = await safeReadFile(vdfPath);
    if (raw) {
        raw = raw.replace(/("mostrecent"\s+)"[01]"/g, '$1"0"');
        raw = raw.replace(
            new RegExp(`("AccountName"\\s+"${username}"[^}]*"mostrecent"\\s+)"0"`, 's'),
            '$1"1"'
        );
        await safeWriteFile(vdfPath, raw);
    }

    const steamExe = path.join(steamPath, 'steam.exe');
    // Pass username as a separate argv element — no shell, no injection surface.
    const safeUsername = username.replace(/[^a-zA-Z0-9_\-@.]/g, '');
    if (fsSync.existsSync(steamExe)) spawnExe(steamExe, ['-login', safeUsername]);
    analytics.logAccountSwitched('steam').catch(() => {});
    return { status: 'success', username };
}

async function addNewSteamAccount() {
    analytics.logAddAccountClicked('steam').catch(() => {});
    const steamPath = await getSteamPath();
    if (!steamPath) throw new Error('Steam not found.');

    await killProcess('steam.exe');
    await new Promise(r => setTimeout(r, 2000));

    for (const p of ['steam.exe', 'steamwebhelper.exe', 'steamerrorreporter.exe']) {
        await killProcess(p);
    }
    await new Promise(r => setTimeout(r, 1500));

    await regSet(STEAM_REG, 'AutoLoginUser',    'REG_SZ',    '');
    await regSet(STEAM_REG, 'RememberPassword', 'REG_DWORD', '0');

    const vdfPath = path.join(steamPath, 'config', 'loginusers.vdf');
    let raw = await safeReadFile(vdfPath);
    if (raw) {
        raw = raw.replace(/("mostrecent"\s+)"1"/gi,       '$1"0"');
        raw = raw.replace(/("RememberPassword"\s+)"1"/gi, '$1"0"');
        raw = raw.replace(/("AllowAutoLogin"\s+)"1"/gi,   '$1"0"');
        await safeWriteFile(vdfPath, raw);
    }

    const steamExe = path.join(steamPath, 'steam.exe');
    if (fsSync.existsSync(steamExe)) spawnExe(steamExe);

    return { status: 'success' };
}

// ─── EPIC GAMES ───────────────────────────────────────────────────────────────

function getEpicSavedDir() { return path.join(DATA_DIR(), 'epic'); }

async function getEpicProfiles() {
    const dir = getEpicSavedDir();
    const names = await getProfiles(dir);
    return names.map(name => {
        // نحاول نقرأ sync_link.json عشان نجيب الـ Epic Account ID الحقيقي
        const linkFile = path.join(dir, name, 'sync_link.json');
        let platformAccountId = null;
        try {
            const raw = fsSync.readFileSync(linkFile, 'utf8');
            platformAccountId = JSON.parse(raw).platformAccountId || null;
        } catch { /* مفيش sync_link بعد — هيشتغل بالـ fallback */ }

        return {
            id:                name,          // اسم الفولدر — بيُستخدم للـ switch
            displayName:       name,
            username:          name,
            platformAccountId,               // الـ Epic ID الحقيقي (لو موجود)
        };
    });
}

function getEpicLivePaths() {
    const savedPath = path.join(process.env.LOCALAPPDATA, 'EpicGamesLauncher', 'Saved');
    return {
        savedPath,
        data:     path.join(savedPath, 'Data'),
        config:   path.join(savedPath, 'Config'),
        webCache: path.join(savedPath, 'webcache'),
    };
}

async function syncEpicCurrentAccount() {
    if (!fsSync.existsSync(activeEpicProfilePath)) return;
    try {
        const lastActive = ((await safeReadFile(activeEpicProfilePath)) || '').trim();
        if (!lastActive) return;

        const { data, config, webCache } = getEpicLivePaths();
        const lastStore = path.join(getEpicSavedDir(), lastActive);
        const isDataValid = fsSync.existsSync(data) && fsSync.readdirSync(data).length > 1;

        if (isDataValid && fsSync.existsSync(lastStore)) {
            await removeDir(path.join(lastStore, 'Data'));
            await secureCopyDir(data, path.join(lastStore, 'Data'), 'encrypt');
            if (fsSync.existsSync(config))   await secureCopyDir(config,   path.join(lastStore, 'Config'),   'encrypt');
            if (fsSync.existsSync(webCache)) await secureCopyDir(webCache, path.join(lastStore, 'webcache'), 'encrypt');
        }
    } catch { /* sync errors are non-fatal */ }
}

async function killEpicProcesses() {
    await killProcess('EpicGamesLauncher.exe');
    await killProcess('EpicWebHelper.exe');
    await waitForProcessDeath('EpicGamesLauncher.exe', 4000);
    await new Promise(r => setTimeout(r, 2000));
}

async function saveEpicAccount(name) {
    if (!name?.trim()) throw new Error('Account name is required.');
    name = sanitizeName(name);

    await killEpicProcesses();

    const { data, config, webCache } = getEpicLivePaths();
    if (!fsSync.existsSync(data)) throw new Error('No login data found. Please login manually.');

    const destProfile = path.join(getEpicSavedDir(), name.trim());
    await removeDir(destProfile);
    await ensureDir(destProfile);

    await secureCopyDir(data, path.join(destProfile, 'Data'), 'encrypt');
    if (fsSync.existsSync(config))   await secureCopyDir(config,   path.join(destProfile, 'Config'),   'encrypt');
    if (fsSync.existsSync(webCache)) await secureCopyDir(webCache, path.join(destProfile, 'webcache'), 'encrypt');

    await safeWriteFile(activeEpicProfilePath, name.trim());
    await safeWriteJson(path.join(destProfile, '_baddel_meta.json'), {
        savedAt: new Date().toISOString(),
        name: name.trim(),
    });

    // ─── Auto-link: نقرأ الـ Epic Account ID مباشرة من ملفات الـ session ────
    // Epic بيحفظ الـ accountId في Data/EpicGamesLauncher/user.json
    // أو في أي json فيه accountId/account_id field
    // بنعمل ده هنا عشان عندنا الـ Data folder بعد ما اتنسخ فوق
    try {
        const epicAccountId = await _readEpicAccountIdFromData(data);
        if (epicAccountId) {
            await safeWriteJson(path.join(destProfile, 'sync_link.json'), {
                platformAccountId: String(epicAccountId),
                linkedAt:          new Date().toISOString(),
                source:            'auto-save',
            });
            console.log(`[EpicSave] sync_link written: "${name}" → ${epicAccountId}`);
        }
    } catch (e) {
        console.warn('[EpicSave] Could not auto-link sync_link.json:', e.message);
    }

    analytics.logAccountAdded('epic').catch(() => {});
    return { status: 'success', name: name.trim() };
}

// Epic بيحفظ الـ session في ملف اسمه OC_<accountId>.dat جوه Data/ مباشرةً
// بنقرأ الـ ID من اسم الملف نفسه — مش من جواه
async function _readEpicAccountIdFromData(dataDir) {
    if (!fsSync.existsSync(dataDir)) return null;
    try { return await _scanDirForOCDat(dataDir, 0); }
    catch { return null; }
}

async function _scanDirForOCDat(dir, depth) {
    if (depth > 4) return null;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return null; }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const found = await _scanDirForOCDat(path.join(dir, entry.name), depth + 1);
            if (found) return found;
        } else {
            const match = entry.name.match(/^OC_([a-f0-9]{16,})/i);
            if (match) {
                console.log("[EpicSave] Found OC dat:", entry.name, "-> ID:", match[1]);
                return match[1];
            }
        }
    }
    return null;
}

async function switchEpic(nextProfileName) {
    if (!nextProfileName?.trim()) throw new Error('Account name required.');
    nextProfileName = sanitizeName(nextProfileName);

    if (fsSync.existsSync(activeEpicProfilePath)) {
        try {
            const lastActive = ((await safeReadFile(activeEpicProfilePath)) || '').trim();
            if (lastActive === nextProfileName.trim()) {
                analytics.logAccountSwitched('epic').catch(() => {});
                shell.openExternal('com.epicgames.launcher://');
                return { status: 'success', name: nextProfileName.trim() };
            }
        } catch { /* ignored */ }
    }

    const sourceProfile = path.join(getEpicSavedDir(), nextProfileName.trim());
    const sourceData    = path.join(sourceProfile, 'Data');
    if (!fsSync.existsSync(sourceData)) throw new Error(`No saved data found for "${nextProfileName}".`);

    await killEpicProcesses();
    await syncEpicCurrentAccount();

    const { data, config, webCache } = getEpicLivePaths();
    await removeDir(data);
    await removeDir(config);
    await removeDir(webCache);

    await secureCopyDir(sourceData, data, 'decrypt');
    if (fsSync.existsSync(path.join(sourceProfile, 'Config')))   await secureCopyDir(path.join(sourceProfile, 'Config'),   config,    'decrypt');
    if (fsSync.existsSync(path.join(sourceProfile, 'webcache'))) await secureCopyDir(path.join(sourceProfile, 'webcache'), webCache,  'decrypt');

    await safeWriteFile(activeEpicProfilePath, nextProfileName.trim());
    shell.openExternal('com.epicgames.launcher://');

    analytics.logAccountSwitched('epic').catch(() => {});
    return { status: 'success', name: nextProfileName };
}

async function addNewEpicAccount() {
    analytics.logAddAccountClicked('epic').catch(() => {});
    await killEpicProcesses();
    await syncEpicCurrentAccount();
    await fs.unlink(activeEpicProfilePath).catch(() => {});

    const { savedPath } = getEpicLivePaths();
    if (fsSync.existsSync(savedPath)) await removeDir(savedPath);
    await ensureDir(savedPath);

    shell.openExternal('com.epicgames.launcher://');
    return { status: 'success' };
}

// ─── EA APP ───────────────────────────────────────────────────────────────────

function getEASavedDir() { return path.join(DATA_DIR(), 'ea'); }
function getEALivePath() { return path.join(process.env.LOCALAPPDATA, 'Electronic Arts', 'EA Desktop'); }

async function getEAProfiles() { return getProfilesWithMeta(getEASavedDir()); }

async function ensureEAKilled() {
    eaLog('Initiating smart graceful shutdown...', 'INFO');

    await killProcess('EADesktop.exe');
    await killProcess('EAConnect_microsoft.exe');

    const isDead = await waitForProcessDeath('EADesktop.exe', 15000);
    if (!isDead) eaLog('EA Desktop took too long. Forcing termination.', 'WARN');

    try { await execAsync(`net stop EABackgroundService 2>nul`); } catch { /* ignored */ }
    await waitForProcessDeath('EABackgroundService.exe', 5000);

    for (const p of ['EADesktop.exe', 'Link2EA.exe', 'EABackgroundService.exe', 'EAConnect_microsoft.exe', 'EACrashReporter.exe']) {
        await killProcess(p);
    }

    await new Promise(r => setTimeout(r, 1000));
    return true;
}

async function moveEAFolder(src, dest) {
    if (!fsSync.existsSync(src)) return false;
    await fs.mkdir(path.dirname(dest), { recursive: true });

    if (fsSync.existsSync(dest)) {
        const trash = `${dest}_TRASH_${Date.now()}`;
        try {
            await fs.rename(dest, trash);
            fs.rm(trash, { recursive: true, force: true }).catch(() => {});
        } catch {
            await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
        }
    }

    for (let i = 1; i <= 5; i++) {
        try {
            await fs.rename(src, dest);
            return true;
        } catch (e) {
            if (i === 5) {
                eaLog(`Rename failed, fallback to copy: ${e.message}`, 'WARN');
                await fs.cp(src, dest, { recursive: true, force: true });
                await fs.rm(src, { recursive: true, force: true }).catch(() => {});
                return true;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

async function saveEAAccount(profileName) {
    if (!profileName?.trim()) throw new Error('Name required.');
    profileName = sanitizeName(profileName);
    await ensureEAKilled();

    const eaLocal   = getEALivePath();
    const destData  = path.join(getEASavedDir(), profileName.trim(), 'EA_Data');
    if (!fsSync.existsSync(eaLocal)) throw new Error('Login first!');

    await fs.mkdir(path.dirname(destData), { recursive: true });
    if (fsSync.existsSync(destData)) await fs.rm(destData, { recursive: true, force: true }).catch(() => {});

    eaLog('Cloning live session securely (encrypted)...', 'INFO');
    // Use secureCopyDir with 'encrypt' so sensitive JSON/token files are
    // AES-256-GCM encrypted before being written to the vault.
    // We replicate the lock/log filter inside secureCopyDir by pre-filtering entries.
    await (async function encryptedCpWithFilter(src, dest) {
        if (!fsSync.existsSync(dest)) await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            const name = entry.name.toLowerCase();
            if (name.startsWith('lock') || name.endsWith('.log') || name === 'logs') continue;
            const s = path.join(src,  entry.name);
            const d = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                await encryptedCpWithFilter(s, d);
            } else {
                await secureCopyFile(s, d, 'encrypt');
            }
        }
    })(eaLocal, destData);

    await safeWriteFile(activeEAProfilePath, profileName.trim());
    eaLog(`Account (${profileName}) saved successfully.`, 'SUCCESS');
    analytics.logAccountAdded('ea').catch(() => {});
    return { status: 'success', name: profileName.trim() };
}

async function findEAExe() {
    const candidates = [
        path.join(process.env['ProgramFiles']       || 'C:\\Program Files',       'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
    ];
    for (const c of candidates) if (fsSync.existsSync(c)) return c;
    return await findExeFromShortcut('EA') || candidates[0];
}

async function launchEA() {
    const exe = await findEAExe();
    if (exe && fsSync.existsSync(exe)) {
        spawnExe(exe);
    } else {
        eaLog('EA Desktop executable not found.', 'WARN');
    }
}

async function switchEA(nextProfileName) {
    if (!nextProfileName?.trim()) throw new Error('Name required.');
    nextProfileName = sanitizeName(nextProfileName);

    const eaLocal  = getEALivePath();
    const current  = ((await safeReadFile(activeEAProfilePath)) || '').trim();

    if (current === nextProfileName.trim()) {
        analytics.logAccountSwitched('ea').catch(() => {});
        await launchEA();
        return { status: 'success' };
    }

    const targetProfile = path.join(getEASavedDir(), nextProfileName.trim());
    const targetData    = path.join(targetProfile, 'EA_Data');

    if (fsSync.existsSync(path.join(targetProfile, 'CEF'))) {
        throw new Error('Profile format is outdated. Please delete this account and re-login.');
    }
    if (!fsSync.existsSync(targetData)) throw new Error('Backup not found. Please re-login.');

    await ensureEAKilled();

    if (current) {
        const lastProfile = path.join(getEASavedDir(), current);
        if (fsSync.existsSync(lastProfile) && fsSync.existsSync(eaLocal)) {
            eaLog(`Vaulting active account (${current})...`, 'INFO');
            await moveEAFolder(eaLocal, path.join(lastProfile, 'EA_Data'));
        }
    }

    if (fsSync.existsSync(eaLocal)) await fs.rm(eaLocal, { recursive: true, force: true }).catch(() => {});

    eaLog(`Unvaulting target account (${nextProfileName})...`, 'INFO');
    await moveEAFolder(targetData, eaLocal);

    // Decrypt sensitive files in-place now that they're in the live directory.
    eaLog('Decrypting session files...', 'INFO');
    await secureCopyDir(eaLocal, eaLocal, 'decrypt');

    await safeWriteFile(activeEAProfilePath, nextProfileName.trim());
    await launchEA();

    analytics.logAccountSwitched('ea').catch(() => {});
    return { status: 'success' };
}

async function addNewEAAccount() {
    analytics.logAddAccountClicked('ea').catch(() => {});
    await ensureEAKilled();

    const eaLocal = getEALivePath();
    const current = ((await safeReadFile(activeEAProfilePath)) || '').trim();

    if (current) {
        const lastProfile = path.join(getEASavedDir(), current);
        if (fsSync.existsSync(lastProfile) && fsSync.existsSync(eaLocal)) {
            eaLog(`Vaulting active account (${current}) before adding new...`, 'INFO');
            await moveEAFolder(eaLocal, path.join(lastProfile, 'EA_Data'));
        }
        await fs.unlink(activeEAProfilePath).catch(() => {});
    }

    if (fsSync.existsSync(eaLocal)) await fs.rm(eaLocal, { recursive: true, force: true }).catch(() => {});

    await launchEA();
    return { status: 'success' };
}

// ─── RIOT GAMES ───────────────────────────────────────────────────────────────

function getRiotSavedDir() { return path.join(DATA_DIR(), 'riot'); }

function getRiotLivePath() {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Riot Games', 'Riot Client');
}

async function getRiotProfiles() { return getProfilesWithMeta(getRiotSavedDir()); }

async function findRiotClientExe() {
    const candidates = [
        'C:\\Riot Games\\Riot Client\\RiotClientServices.exe',
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
    ];
    for (const c of candidates) if (fsSync.existsSync(c)) return c;
    return null;
}

function launchRiotClient() {
    findRiotClientExe().then(exe => {
        if (exe) spawnExe(exe);
        else shell.openExternal('riotclient://launch');
    });
}

async function ensureRiotKilled() {
    for (const exe of RIOT_PROCESSES) await killProcess(exe);
    await waitForProcessDeath('RiotClientServices.exe', 5000);
    await new Promise(r => setTimeout(r, 2000));
}

async function saveRiotAccount(name) {
    if (!name?.trim()) throw new Error('Account name is required.');
    name = sanitizeName(name);

    await ensureRiotKilled();

    const riotLivePath = getRiotLivePath();
    const tokenFile    = path.join(riotLivePath, 'Data', 'RiotGamesPrivateSettings.yaml');
    if (!fsSync.existsSync(tokenFile)) throw new Error('Please login to Riot first.');

    const destProfile = path.join(getRiotSavedDir(), name.trim());
    await removeDir(destProfile);
    await ensureDir(destProfile);

    if (fsSync.existsSync(path.join(riotLivePath, 'Data')))   await secureCopyDir(path.join(riotLivePath, 'Data'),   path.join(destProfile, 'Data'),   'encrypt');
    if (fsSync.existsSync(path.join(riotLivePath, 'Config'))) await secureCopyDir(path.join(riotLivePath, 'Config'), path.join(destProfile, 'Config'), 'encrypt');

    await safeWriteFile(activeRiotProfilePath, name.trim());
    analytics.logAccountAdded('riot').catch(() => {});
    return { status: 'success', name: name.trim() };
}

async function syncRiotCurrentAccount() {
    if (!fsSync.existsSync(activeRiotProfilePath)) return;
    try {
        const lastActive = ((await safeReadFile(activeRiotProfilePath)) || '').trim();
        if (!lastActive) return;

        const riotLivePath = getRiotLivePath();
        const liveData   = path.join(riotLivePath, 'Data');
        const liveConfig = path.join(riotLivePath, 'Config');
        const lastStore  = path.join(getRiotSavedDir(), lastActive);

        if (fsSync.existsSync(lastStore) && fsSync.existsSync(liveData)) {
            await removeDir(path.join(lastStore, 'Data'));
            await secureCopyDir(liveData, path.join(lastStore, 'Data'), 'encrypt');
            if (fsSync.existsSync(liveConfig)) await secureCopyDir(liveConfig, path.join(lastStore, 'Config'), 'encrypt');
        }
    } catch (e) {
        console.error('[RIOT] Auto-sync failed:', e.message);
    }
}

async function switchRiotAccount(nextProfileName) {
    if (!nextProfileName?.trim()) throw new Error('Account name required.');
    nextProfileName = sanitizeName(nextProfileName);

    if (fsSync.existsSync(activeRiotProfilePath)) {
        const lastActive = ((await safeReadFile(activeRiotProfilePath)) || '').trim();
        if (lastActive === nextProfileName.trim()) {
            launchRiotClient();
            analytics.logAccountSwitched('riot').catch(() => {});
            return { status: 'success', name: nextProfileName.trim() };
        }
    }

    const sourceProfile = path.join(getRiotSavedDir(), nextProfileName.trim());
    if (!fsSync.existsSync(path.join(sourceProfile, 'Data'))) throw new Error('No saved data found.');

    await ensureRiotKilled();
    await syncRiotCurrentAccount();

    const riotLivePath = getRiotLivePath();
    await removeDir(path.join(riotLivePath, 'Data'));
    await removeDir(path.join(riotLivePath, 'Config'));

    await secureCopyDir(path.join(sourceProfile, 'Data'), path.join(riotLivePath, 'Data'), 'decrypt');
    if (fsSync.existsSync(path.join(sourceProfile, 'Config'))) {
        await secureCopyDir(path.join(sourceProfile, 'Config'), path.join(riotLivePath, 'Config'), 'decrypt');
    }

    await safeWriteFile(activeRiotProfilePath, nextProfileName.trim());
    launchRiotClient();

    analytics.logAccountSwitched('riot').catch(() => {});
    return { status: 'success', name: nextProfileName };
}

async function addNewRiotAccount() {
    analytics.logAddAccountClicked('riot').catch(() => {});
    await ensureRiotKilled();

    if (fsSync.existsSync(activeRiotProfilePath)) await fs.unlink(activeRiotProfilePath).catch(() => {});

    const tokenFile = path.join(getRiotLivePath(), 'Data', 'RiotGamesPrivateSettings.yaml');
    if (fsSync.existsSync(tokenFile)) await fs.unlink(tokenFile).catch(() => {});

    launchRiotClient();
    return { status: 'success' };
}

async function renameProfile(platform, oldName, newName) {
    if (!oldName || !newName) throw new Error('Names required.');
    oldName = sanitizeName(oldName);
    newName = sanitizeName(newName);

    const baseDir = {
        epic:    getEpicSavedDir(),
        ea:      getEASavedDir(),
        riot:    getRiotSavedDir(),
        ubisoft: getUbisoftSavedDir(),
        discord: getDiscordSavedDir(),
        rockstar: getRockstarSavedDir()
    }[platform];

    const oldPath = path.join(baseDir, oldName.trim());
    const newPath = path.join(baseDir, newName.trim());

    if (fsSync.existsSync(newPath)) throw new Error('Name already exists.');
    await fs.rename(oldPath, newPath);

    const metaPath = path.join(newPath, '_baddel_meta.json');
    const meta = await safeReadJson(metaPath);
    if (meta) { meta.name = newName.trim(); await safeWriteJson(metaPath, meta); }

    const activePathMap = {
        riot:    activeRiotProfilePath,
        epic:    activeEpicProfilePath,
        ea:      activeEAProfilePath,
        ubisoft: activeUbisoftProfilePath,
        rockstar: activeRockstarProfilePath,
        discord: activeDiscordProfilePath
    };
    const activePath = activePathMap[platform];
    if (activePath && fsSync.existsSync(activePath)) {
        const current = ((await safeReadFile(activePath)) || '').trim();
        if (current === oldName.trim()) await safeWriteFile(activePath, newName.trim());
    }
    return { status: 'success' };
}

// ─── UBISOFT CONNECT ─────────────────────────────────────────────────────────

function getUbisoftDataPath() {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Ubisoft Game Launcher');
}

function getUbisoftSavedDir() { return path.join(DATA_DIR(), 'ubisoft'); }

async function getUbisoftProfiles() { return getProfilesWithMeta(getUbisoftSavedDir()); }

async function ensureUbisoftKilled() {
    ubiLog('Shutting down Ubisoft processes...', 'INFO');
    for (const proc of ['UbisoftConnect.exe', 'upc.exe', 'UplayWebCore.exe', 'UbisoftGameLauncher.exe', 'UbisoftGameLauncher64.exe']) {
        try { await killProcess(proc); } catch { /* ignored */ }
    }
    await waitForProcessDeath('UbisoftConnect.exe', 4000);
    return true;
}

async function moveUbiFolder(src, dest) {
    if (!fsSync.existsSync(src)) return false;
    try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        if (fsSync.existsSync(dest)) await fs.rm(dest, { recursive: true, force: true });
        await fs.rename(src, dest);
        return true;
    } catch (e) {
        ubiLog(`Rename failed, falling back to copy: ${e.message}`, 'WARN');
        await fs.cp(src, dest, { recursive: true, force: true, preserveTimestamps: true });
        await fs.rm(src, { recursive: true, force: true });
        return true;
    }
}

async function cloneUbiFolder(src, dest) {
    if (!fsSync.existsSync(src)) return;
    try {
        await fs.mkdir(dest, { recursive: true });
        await fs.cp(src, dest, {
            recursive: true,
            force: true,
            preserveTimestamps: true,
            filter: sourcePath => {
                const name = path.basename(sourcePath).toLowerCase();
                return !['cache', 'logs', 'crash_dumps', 'spool', 'cefcache'].includes(name);
            },
        });
    } catch { /* ignored */ }
}

async function saveUbisoftAccount(name) {
    if (!name?.trim()) throw new Error('Account name is required.');
    name = sanitizeName(name);
    ubiLog(`Saving account: ${name}`, 'INFO');

    await ensureUbisoftKilled();

    const src  = getUbisoftDataPath();
    const dest = path.join(getUbisoftSavedDir(), name.trim());

    if (!fsSync.existsSync(src)) throw new Error('Ubisoft data folder not found. Please login first.');

    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dest, { recursive: true });

    ubiLog('Cloning Ubisoft folder...', 'INFO');
    await cloneUbiFolder(src, path.join(dest, 'Ubisoft_Data'));

    ubiLog('Saving registry keys (encrypted)...', 'INFO');
    const token  = await regQuery(UBISOFT_REG, 'Remembered login');
    const userId = await regQuery(UBISOFT_REG, 'Uid');

    await safeWriteJson(path.join(dest, '_baddel_meta.json'), {
        savedAt:   new Date().toISOString(),
        name:      name.trim(),
        regToken:  encryptString(token),   // stored encrypted
        regUserId: userId,                 // not a secret, no encryption needed
    });

    await safeWriteFile(activeUbisoftProfilePath, name.trim());
    ubiLog('Account saved successfully.', 'SUCCESS');
    analytics.logAccountAdded('ubisoft').catch(() => {});
    return { status: 'success', name };
}

async function switchUbisoftAccount(name) {
    if (!name?.trim()) throw new Error('Account name required.');
    name = sanitizeName(name);
    ubiLog(`Switch request to: ${name}`, 'INFO');

    if (fsSync.existsSync(activeUbisoftProfilePath)) {
        const lastActive = ((await safeReadFile(activeUbisoftProfilePath)) || '').trim();
        if (lastActive === name.trim()) {
            ubiLog('Account already active. Launching...', 'SUCCESS');
            const ubisoftExe = await findUbisoftExe();
            if (ubisoftExe && fsSync.existsSync(ubisoftExe)) spawnExe(ubisoftExe);
            analytics.logAccountSwitched('ubisoft').catch(() => {});
            return { status: 'success', name: name.trim() };
        }
    }

    await ensureUbisoftKilled();

    const srcProfile  = path.join(getUbisoftSavedDir(), name.trim());
    const liveDataPath = getUbisoftDataPath();

    if (!fsSync.existsSync(path.join(srcProfile, 'Ubisoft_Data'))) {
        throw new Error('Backup is incomplete. Please delete this account and re-login.');
    }

    if (fsSync.existsSync(activeUbisoftProfilePath)) {
        const lastActive = ((await safeReadFile(activeUbisoftProfilePath)) || '').trim();
        if (lastActive && lastActive !== name.trim()) {
            ubiLog(`Vaulting current account (${lastActive})...`, 'INFO');
            const lastStore = path.join(getUbisoftSavedDir(), lastActive);

            if (fsSync.existsSync(liveDataPath)) {
                await moveUbiFolder(liveDataPath, path.join(lastStore, 'Ubisoft_Data'));
            }

            const token  = await regQuery(UBISOFT_REG, 'Remembered login');
            const userId = await regQuery(UBISOFT_REG, 'Uid');
            const meta   = await safeReadJson(path.join(lastStore, '_baddel_meta.json')) || {};
            await safeWriteJson(path.join(lastStore, '_baddel_meta.json'), {
                ...meta,
                regToken:  encryptString(token),  // encrypt before vaulting
                regUserId: userId,
            });
        }
    }

    await fs.rm(liveDataPath, { recursive: true, force: true }).catch(() => {});

    ubiLog(`Unvaulting target account: ${name}...`, 'INFO');
    await moveUbiFolder(path.join(srcProfile, 'Ubisoft_Data'), liveDataPath);

    // Decrypt in-place after move
    ubiLog('Decrypting session files...', 'INFO');
    await secureCopyDir(liveDataPath, liveDataPath, 'decrypt');

    ubiLog('Restoring registry keys...', 'INFO');
    const meta = await safeReadJson(path.join(srcProfile, '_baddel_meta.json'));
    if (meta?.regToken)  await regSet(UBISOFT_REG, 'Remembered login', 'REG_SZ', decryptString(meta.regToken));
    if (meta?.regUserId) await regSet(UBISOFT_REG, 'Uid',              'REG_SZ', meta.regUserId);

    await safeWriteFile(activeUbisoftProfilePath, name.trim());

    ubiLog('Switch successful. Launching...', 'SUCCESS');
    const ubisoftExe = await findUbisoftExe();
    if (ubisoftExe && fsSync.existsSync(ubisoftExe)) spawnExe(ubisoftExe);

    analytics.logAccountSwitched('ubisoft').catch(() => {});
    return { status: 'success', name };
}

async function addNewUbisoftAccount() {
    ubiLog('Adding new Ubisoft account...', 'INFO');
    await ensureUbisoftKilled();

    const liveDataPath = getUbisoftDataPath();

    if (fsSync.existsSync(activeUbisoftProfilePath)) {
        const lastActive = ((await safeReadFile(activeUbisoftProfilePath)) || '').trim();
        if (lastActive) {
            ubiLog(`Vaulting active account (${lastActive}) before clearing launcher...`, 'INFO');
            const lastStore = path.join(getUbisoftSavedDir(), lastActive);

            if (fsSync.existsSync(liveDataPath)) {
                await moveUbiFolder(liveDataPath, path.join(lastStore, 'Ubisoft_Data'));
            }

            const token  = await regQuery(UBISOFT_REG, 'Remembered login');
            const userId = await regQuery(UBISOFT_REG, 'Uid');
            const meta   = await safeReadJson(path.join(lastStore, '_baddel_meta.json')) || {};
            await safeWriteJson(path.join(lastStore, '_baddel_meta.json'), {
                ...meta,
                regToken:  encryptString(token),  // encrypt before vaulting
                regUserId: userId,
            });
        }
        await fs.unlink(activeUbisoftProfilePath).catch(() => {});
    }

    ubiLog('Clearing launcher for new account...', 'INFO');
    await fs.rm(liveDataPath, { recursive: true, force: true }).catch(() => {});
    await regDelete(UBISOFT_REG, 'Remembered login');
    await regDelete(UBISOFT_REG, 'Uid');

    const ubisoftExe = await findUbisoftExe();
    if (ubisoftExe && fsSync.existsSync(ubisoftExe)) spawnExe(ubisoftExe);

    return { status: 'success' };
}


// ─── ROCKSTAR GAMES ──────────────────────────────────────────────────────────

function getRockstarDataPath() {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Rockstar Games', 'Launcher');
}

function getRockstarSavedDir() { return path.join(DATA_DIR(), 'rockstar'); }

async function getRockstarProfiles() { return getProfilesWithMeta(getRockstarSavedDir()); }

async function ensureRockstarKilled() {
    rockstarLog('Shutting down Rockstar processes...', 'INFO');
    for (const proc of ['Launcher.exe', 'LauncherPatcher.exe', 'RockstarService.exe', 'SocialClubHelper.exe']) {
        try { await killProcess(proc); } catch { /* ignored */ }
    }
    await waitForProcessDeath('Launcher.exe', 4000);
    return true;
}

async function findRockstarExe() {
    const candidates = [
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Rockstar Games', 'Launcher', 'Launcher.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Rockstar Games', 'Launcher', 'Launcher.exe'),
    ];
    for (const c of candidates) if (fsSync.existsSync(c)) return c;
    return await findExeFromShortcut('Rockstar Games Launcher') || candidates[0];
}

async function launchRockstar() {
    const exe = await findRockstarExe();
    if (exe && fsSync.existsSync(exe)) {
        spawnExe(exe);
        rockstarLog('Launched Rockstar Launcher.', 'SUCCESS');
    } else {
        rockstarLog('Rockstar Launcher executable not found.', 'WARN');
    }
}

async function saveRockstarAccount(name) {
    try {
        // المسار الأساسي اللي فيه بيانات الدخول
        const socialClubProfiles = path.join(app.getPath('documents'), 'Rockstar Games', 'Social Club', 'Profiles');
        // المسار اللي هنحفظ فيه الأكونت جوه Baddel
        const backupPath = path.join(app.getPath('userData'), 'accounts', 'rockstar', name);

        // نعمل الفولدر لو مش موجود وننسخ فيه البروفايل
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        await fs.cp(socialClubProfiles, backupPath, { recursive: true, force: true });
        
        return { success: true };
    } catch (error) {
        console.error('Error saving Rockstar account:', error);
        throw error;
    }
}

async function switchRockstarAccount(name) {
    try {
        try {
            await execAsync('taskkill /F /IM Launcher.exe /T');
            await execAsync('taskkill /F /IM RockstarService.exe /T');
            await execAsync('taskkill /F /IM SocialClubHelper.exe /T');
        } catch (e) { }

        const socialClubProfiles = path.join(app.getPath('documents'), 'Rockstar Games', 'Social Club', 'Profiles');
        const backupPath = path.join(app.getPath('userData'), 'accounts', 'rockstar', name);

        // هنمسح فولدر الحساب الحالي بس، من غير ما نلمس الكاش بتاع اللانشر
        try { await fs.rm(socialClubProfiles, { recursive: true, force: true }); } catch (e) { }

        // نرجع ملفات الأكونت اللي اليوزر اختاره
        await fs.cp(backupPath, socialClubProfiles, { recursive: true, force: true });

        const activeProfilePath = path.join(app.getPath('userData'), 'active_rockstar_profile.json');
        await fs.writeFile(activeProfilePath, JSON.stringify({ name }));

        const rockstarExe = "C:\\Program Files\\Rockstar Games\\Launcher\\Launcher.exe";
        spawn(rockstarExe, [], { detached: true, stdio: 'ignore' }).unref();

        return { success: true };
    } catch (error) {
        console.error('Error switching Rockstar account:', error);
        throw error;
    }
}

async function addNewRockstarAccount() {
    try {
        try {
            await execAsync('taskkill /F /IM Launcher.exe /T');
            await execAsync('taskkill /F /IM RockstarService.exe /T');
            await execAsync('taskkill /F /IM SocialClubHelper.exe /T');
        } catch (e) { }

        const socialClubProfiles = path.join(app.getPath('documents'), 'Rockstar Games', 'Social Club', 'Profiles');

        // نمسح بروفايل الدخول عشان نجبره يطلب إيميل وباسورد جديد
        try { await fs.rm(socialClubProfiles, { recursive: true, force: true }); } catch (err) {}

        const rockstarExe = "C:\\Program Files\\Rockstar Games\\Launcher\\Launcher.exe";
        spawn(rockstarExe, [], { detached: true, stdio: 'ignore' }).unref();

        return { success: true };
    } catch (error) {
        console.error('Error in addNewRockstarAccount:', error);
        throw error;
    }
}

// ─── DISCORD ─────────────────────────────────────────────────────────────────

function getDiscordDataPath() {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'discord');
}

function getDiscordSavedDir() { return path.join(DATA_DIR(), 'discord'); }

async function getDiscordProfiles() {
    try {
        if (!fsSync.existsSync(getDiscordSavedDir())) return [];
        const entries = await fs.readdir(getDiscordSavedDir(), { withFileTypes: true });

        const profiles = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.includes('_OLD_')) continue;
            const meta = await safeReadJson(path.join(getDiscordSavedDir(), entry.name, '_baddel_meta.json')) || {};
            profiles.push({
                name:            entry.name,
                avatarUrl:       meta.avatarUrl || null,
                discordUsername: meta.discordUsername || null,
            });
        }
        return profiles;
    } catch { return []; }
}

async function ensureDiscordKilled() {
    discordLog('Terminating all Discord processes...', 'INFO');
    try { await execAsync('taskkill /IM "Discord.exe" 2>nul'); } catch {}
    try { await execAsync('taskkill /IM "DiscordPTB.exe" 2>nul'); } catch {}
    try { await execAsync('taskkill /IM "DiscordCanary.exe" 2>nul'); } catch {}

    await new Promise(r => setTimeout(r, 1500));
    await killProcess('Discord.exe');
    await killProcess('DiscordPTB.exe');
    await killProcess('DiscordCanary.exe');
    await killProcess('Update.exe');

    await waitForProcessDeath('Discord.exe', 5000);
    await new Promise(r => setTimeout(r, 1500)); 

    return true;
}

async function moveDiscordFolder(src, dest) {
    if (!fsSync.existsSync(src)) return false;
    await fs.mkdir(path.dirname(dest), { recursive: true });

    if (fsSync.existsSync(dest)) {
        try {
            const trashPath = `${dest}_TRASH_${Date.now()}`;
            await fs.rename(dest, trashPath);
            fs.rm(trashPath, { recursive: true, force: true }).catch(() => {});
        } catch {
            await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
        }
    }

    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            await fs.rename(src, dest);
            return true;
        } catch (e) {
            if (attempt === 10) {
                discordLog(`Rename failed definitively: ${e.message}`, 'ERROR');
                throw new Error('Discord files are locked by Windows. Please close Discord from the System Tray and try again.');
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

async function launchDiscord() {
    const localDiscord = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Discord');
    let exePath = path.join(localDiscord, 'Update.exe');
    let args    = '--processStart Discord.exe';

    if (!fsSync.existsSync(exePath)) {
        try {
            const dirs    = await fs.readdir(localDiscord);
            const appDirs = dirs.filter(d => d.startsWith('app-')).sort().reverse();
            if (appDirs.length > 0) {
                exePath = path.join(localDiscord, appDirs[0], 'Discord.exe');
                args    = '';
            }
        } catch { /* ignored */ }
    }

    if (fsSync.existsSync(exePath)) {
        spawnExe(exePath, args ? args.split(" ").filter(Boolean) : []);
        discordLog(`Launched Discord: ${exePath}`, 'SUCCESS');
    } else {
        discordLog('Discord.exe not found.', 'ERROR');
    }
}

async function fetchActiveDiscordAvatar() {
    return new Promise(resolve => {
        discordLog('Fetching avatar via RPC...', 'INFO');
        const rpc = new DiscordRPC.Client({ transport: 'ipc' });

        const timeout = setTimeout(() => {
            rpc.destroy().catch(() => {});
            resolve(null);
        }, 4000);

        rpc.on('ready', () => {
            clearTimeout(timeout);
            const user = rpc.user;
            const avatarUrl = user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
                : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || user.id.slice(-1)) % 5}.png`;

            discordLog('Avatar fetched successfully.', 'SUCCESS');
            rpc.destroy().catch(() => {});
            resolve({ id: user.id, username: user.username, avatarUrl });
        });

        rpc.login({ clientId: DISCORD_RPC_CLIENT_ID }).catch(() => {
            clearTimeout(timeout);
            resolve(null);
        });
    });
}

async function saveDiscordAccount(name) {
    if (!name?.trim()) throw new Error('Account name is required.');
    name = sanitizeName(name);

    const liveDataPath = getDiscordDataPath();
    if (!fsSync.existsSync(path.join(liveDataPath, 'Local Storage'))) {
        throw new Error('Please login to Discord first before saving.');
    }

    const userData    = await fetchActiveDiscordAvatar();
    const destProfile = path.join(getDiscordSavedDir(), name.trim());
    await fs.mkdir(destProfile, { recursive: true });

    await safeWriteJson(path.join(destProfile, '_baddel_meta.json'), {
        savedAt:         new Date().toISOString(),
        name:            name.trim(),
        discordId:       userData?.id       || null,
        discordUsername: userData?.username || null,
        avatarUrl:       userData?.avatarUrl || null,
    });

    await safeWriteFile(activeDiscordProfilePath, name.trim());
    discordLog(`Account (${name}) saved.`, 'SUCCESS');
    // مثال داخل دالة saveEAAccount قبل الـ return مباشرة
    analytics.logAccountAdded('discord').catch(() => {});
    return { status: 'success', name: name.trim(), avatarUrl: userData?.avatarUrl };
}

async function addNewDiscordAccount() {
    analytics.logAddAccountClicked('discord').catch(() => {});
    discordLog('Adding new Discord account...', 'INFO');
    await ensureDiscordKilled();

    const liveDataPath = getDiscordDataPath();

    if (fsSync.existsSync(activeDiscordProfilePath)) {
        const lastActive = ((await safeReadFile(activeDiscordProfilePath)) || '').trim();
        if (lastActive) {
            const lastProfile   = path.join(getDiscordSavedDir(), lastActive);
            const lastStoreData = path.join(lastProfile, 'Discord_Data');

            if (fsSync.existsSync(lastProfile) && fsSync.existsSync(liveDataPath)) {
                discordLog('Parking active account to vault...', 'INFO');
                await moveDiscordFolder(liveDataPath, lastStoreData);
            }
        }
        await fs.unlink(activeDiscordProfilePath).catch(() => {});
    }

    if (fsSync.existsSync(liveDataPath)) {
        await fs.rm(liveDataPath, { recursive: true, force: true }).catch(() => {});
    }

    discordLog('Discord cleared. Launching...', 'SUCCESS');
    await launchDiscord();
    return { status: 'success' };
}

async function switchDiscordAccount(name) {
    if (!name?.trim()) throw new Error('Account name required.');
    name = sanitizeName(name);

    if (fsSync.existsSync(activeDiscordProfilePath)) {
        const currentActive = ((await safeReadFile(activeDiscordProfilePath)) || '').trim();
        if (currentActive === name.trim()) {
            await launchDiscord();
            analytics.logAccountSwitched('discord').catch(() => {});
            return { status: 'success', name: name.trim() };
        }
    }

    const targetProfile = path.join(getDiscordSavedDir(), name.trim());
    if (!fsSync.existsSync(targetProfile)) throw new Error('Profile not found.');

    await ensureDiscordKilled();
    const liveDataPath = getDiscordDataPath();

    if (fsSync.existsSync(activeDiscordProfilePath)) {
        const lastActive = ((await safeReadFile(activeDiscordProfilePath)) || '').trim();
        if (lastActive && lastActive !== name.trim()) {
            const lastProfile   = path.join(getDiscordSavedDir(), lastActive);
            const lastStoreData = path.join(lastProfile, 'Discord_Data');

            if (fsSync.existsSync(lastProfile) && fsSync.existsSync(liveDataPath)) {
                discordLog('Parking current account...', 'INFO');
                await moveDiscordFolder(liveDataPath, lastStoreData);
            }
        }
    }

    if (fsSync.existsSync(liveDataPath)) {
        await fs.rm(liveDataPath, { recursive: true, force: true }).catch(() => {});
    }

    discordLog('Unparking target account...', 'INFO');
    const targetData = path.join(targetProfile, 'Discord_Data');
    if (fsSync.existsSync(targetData)) {
        await moveDiscordFolder(targetData, liveDataPath);
    }

    await safeWriteFile(activeDiscordProfilePath, name.trim());
    await launchDiscord();

    analytics.logAccountSwitched('discord').catch(() => {});
    return { status: 'success', name: name.trim() };
}

// ─── Delete / IPC Registration ───────────────────────────────────────────────

/**
 * Wraps an IPC handler so that any thrown error is returned as
 * { status: 'error', message: '...' } instead of crashing the main process.
 */
function safeHandle(fn) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (err) {
            console.error('[IPC] Handler error:', err);
            return { status: 'error', message: err?.message || 'An unexpected error occurred.' };
        }
    };
}

async function deleteProfile(platform, name) {
    if (!name?.trim()) throw new Error('Profile name required.');
    name = sanitizeName(name);

    const dirMap = {
        epic:    path.join(getEpicSavedDir(),     name.trim()),
        ea:      path.join(getEASavedDir(),        name.trim()),
        riot:    path.join(getRiotSavedDir(),      name.trim()),
        ubisoft: path.join(getUbisoftSavedDir(),   name.trim()),
        discord: path.join(getDiscordSavedDir(),   name.trim()),
        rockstar: path.join(getRockstarSavedDir(),   name.trim()),
    };

    const activePathMap = {
        epic:    activeEpicProfilePath,
        ea:      activeEAProfilePath,
        riot:    activeRiotProfilePath,
        ubisoft: activeUbisoftProfilePath,
        discord: activeDiscordProfilePath,
        rockstar: activeRockstarProfilePath,
    };

    const dir = dirMap[platform];
    if (dir && fsSync.existsSync(dir)) await removeDir(dir);

    const activePath = activePathMap[platform];
    if (activePath && fsSync.existsSync(activePath)) {
        const activeName = ((await safeReadFile(activePath)) || '').trim();
        if (activeName === name.trim()) {
            if (platform === 'discord') {
                await fs.rm(getDiscordDataPath(), { recursive: true, force: true }).catch(() => {});
            }
            await fs.unlink(activePath).catch(() => {});
        }
    }
    analytics.logAccountDeleted(platform).catch(() => {});
    return { status: 'success', name };
}

// ─── IPC Handler Registry ────────────────────────────────────────────────────
//
// Each entry is: [channel, handler]
// Handler receives (...args) where args[0] is the Electron event object (ignored).
// Keeping all handlers in a declarative table makes it trivial to audit, add,
// or remove channels without touching any registration logic.
//
// safeHandle() wraps every handler so thrown errors → { status:'error', message }
// instead of crashing the main process.

const IPC_HANDLERS = [
    // ── Steam ──────────────────────────────────────────────────────────────
    ['get-steam-accounts',    async () => require('./platformSync').enrichProfilesWithSyncData('steam', await getSteamAccounts().catch(() => []))],
    ['get-steam-image',       (_, id)      => getSteamAvatarUrl(id).catch(() => null)],
    ['switch-steam',          (_, user)    => switchSteam(user)],
    ['add-new-steam-account', ()           => addNewSteamAccount()],

    // ── Epic Games ─────────────────────────────────────────────────────────
    ['get-epic-profiles',     async () => require('./platformSync').enrichProfilesWithSyncData('epic', await getEpicProfiles().catch(() => []))],
    ['save-epic-account',     (_, name)    => saveEpicAccount(name)],
    ['switch-epic',           (_, name)    => switchEpic(name)],
    ['add-new-epic-account',  ()           => addNewEpicAccount()],

    // ── EA ─────────────────────────────────────────────────────────────────
    ['get-ea-profiles',       async () => require('./platformSync').enrichProfilesWithSyncData('ea', await getEAProfiles().catch(() => []))],
    ['save-ea-account',       (_, name)    => saveEAAccount(name)],
    ['switch-ea',             (_, name)    => switchEA(name)],
    ['add-new-ea-account',    ()           => addNewEAAccount()],

    // ── Riot ───────────────────────────────────────────────────────────────
    ['get-riot-profiles',     async () => require('./platformSync').enrichProfilesWithSyncData('riot', await getRiotProfiles().catch(() => []))],
    ['save-riot-account',     (_, name)    => saveRiotAccount(name)],
    ['switch-riot-account',   (_, name)    => switchRiotAccount(name)],
    ['add-new-riot-account',  ()           => addNewRiotAccount()],

    // ── Ubisoft ────────────────────────────────────────────────────────────
    ['get-ubisoft-profiles',    async () => require('./platformSync').enrichProfilesWithSyncData('ubisoft', await getUbisoftProfiles().catch(() => []))],
    ['save-ubisoft-account',    (_, name)  => saveUbisoftAccount(name)],
    ['switch-ubisoft-account',  (_, name)  => switchUbisoftAccount(name)],
    ['add-new-ubisoft-account', ()         => addNewUbisoftAccount()],

    // ── Rockstar ───────────────────────────────────────────────────────────
    ['get-rockstar-profiles',    async () => require('./platformSync').enrichProfilesWithSyncData('rockstar', await getRockstarProfiles().catch(() => []))],
    ['save-rockstar-account',    (_, name)  => saveRockstarAccount(name)],
    ['switch-rockstar-account',  (_, name)  => switchRockstarAccount(name)],
    ['add-new-rockstar-account', ()         => addNewRockstarAccount()],

    // ── Discord ────────────────────────────────────────────────────────────
    ['get-discord-profiles',    async () => require('./platformSync').enrichProfilesWithSyncData('discord', await getDiscordProfiles().catch(() => []))],
    ['save-discord-account',    (_, name)  => saveDiscordAccount(name)],
    ['switch-discord-account',  (_, name)  => switchDiscordAccount(name)],
    ['add-new-discord-account', ()         => addNewDiscordAccount()],

    // ── Cross-platform ─────────────────────────────────────────────────────
    ...['epic', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar'].map(p =>
        [`rename-${p}-profile`, (_, o, n) => renameProfile(p, o, n)]
    ),

    ...['epic', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar'].map(p =>
        [`delete-${p}-profile`, (_, n) => deleteProfile(p, n)]
    ),
];

/**
 * Registers all IPC handlers in one pass.
 * ipcMain is only touched here — no module-level coupling.
 */
function registerAccountHandlers(ipcMain) {
    for (const [channel, handler] of IPC_HANDLERS) {
        ipcMain.handle(channel, safeHandle(handler));
    }
}



module.exports = { registerAccountHandlers, clearEncryptionKeyCache };
