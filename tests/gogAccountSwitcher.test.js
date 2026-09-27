'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { GogAccountSwitcher, normalizeProfileName } = require('../services/gogAccountSwitcher');

const ROOT = path.resolve(__dirname, '..');
const HELPER = fs.readFileSync(path.join(ROOT, 'resources/gog-account-switcher-helper.ps1'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const HANDLER = fs.readFileSync(path.join(ROOT, 'accountsHandler.js'), 'utf8');
const PANELS = fs.readFileSync(path.join(ROOT, 'src/js/accounts/platform-panels.js'), 'utf8');
const MODAL = fs.readFileSync(path.join(ROOT, 'src/js/addAccountModal.js'), 'utf8');
const PLAY = fs.readFileSync(path.join(ROOT, 'src/js/play-launcher.js'), 'utf8');
const OWNERSHIP = fs.readFileSync(path.join(ROOT, 'src/js/platformOwnership.js'), 'utf8');
const QUICK = fs.readFileSync(path.join(ROOT, 'src/js/quick-switcher.js'), 'utf8');
const ACCOUNTS_CSS = fs.readFileSync(path.join(ROOT, 'src/css/accounts.css'), 'utf8');
const DASHBOARD_CSS = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');

const IDS = Array.from({ length: 20 }, (_, i) => (i + 1).toString(16).padStart(32, '0'));

async function fixture(helperImpl) {
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'baddel-gog-switcher-'));
    const root = path.join(temp, 'accounts', 'gog');
    const calls = [];
    const launches = [];
    let sequence = 0;
    let service;
    service = new GogAccountSwitcher({
        root,
        randomId: () => IDS[sequence++],
        now: () => new Date('2026-09-06T12:00:00.000Z'),
        fsSync: { existsSync: () => true },
        launcherPathResolver: { getLauncherLaunchSpec: async () => ({ exePath: 'C:\\GOG Galaxy\\GalaxyClient.exe', args: [], source: 'gog-registration' }) },
        launchExecutable: async (exe, args, options) => {
            launches.push({ exe, args, options });
            return { ok: true, pid: 1234 };
        },
        isLauncherFile: () => true,
        log: { info() {} },
        accountShortcuts: { renameAccount: async () => {}, clearShortcut: async () => {} },
        analytics: {},
        helperRunner: async call => {
            calls.push(call);
            if (helperImpl) return helperImpl(call, service);
            return { success: true };
        },
    });
    await service._ensureRoot();
    return { temp, root, service, calls, launches, cleanup: () => fsp.rm(temp, { recursive: true, force: true }) };
}

async function writeProfile(service, id, name, active = false) {
    const p = service.paths();
    await fsp.mkdir(path.join(p.profiles, id), { recursive: true });
    await fsp.writeFile(path.join(p.profiles, id, 'manifest.json'), '{}');
    await service._writeJson(p.metadata, { version: 1, profiles: [{ id, displayName: name, createdAt: 'now', lastUsedAt: 'now', platformAccountId: null }] });
    if (active) await service._writeJson(p.active, { version: 1, profileId: id });
}

test('helper enumerates every stable file and persistent session root', () => {
    for (const value of ['Configuration\\config.json', 'etags-updater.db', 'etags.db', 'galaxy-2.0.db', 'webcache', 'WebStorage', 'Local Storage', 'Session Storage', 'IndexedDB', 'Network', 'remote_config_cache_production_worldwide.json']) {
        assert.match(HELPER, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
});

test('helper captures and clears the current Galaxy ProgramData web session', () => {
    assert.match(HELPER, /Join-Path \$env:PROGRAMDATA 'GOG\.com\\Galaxy\\webcache'/);
    const sessionRoots = HELPER.slice(HELPER.indexOf('function Get-SessionRoots'), HELPER.indexOf('function Test-IsDisposableCachePath'));
    assert.match(sessionRoots, /PROGRAMDATA[\s\S]*webcache/);
    const clear = HELPER.slice(HELPER.indexOf('function Clear-CurrentSession'), HELPER.indexOf('function Restore-State'));
    assert.match(clear, /GOG session cleanup left/);
    assert.match(clear, /Registry::HKEY_CURRENT_USER\\Software\\GOG\.com/);
});

test('helper excludes disposable caches and applies 100 MB only to recursive browser discovery', () => {
    for (const part of ['cache', 'code cache', 'gpucache', 'dawncache', 'shadercache', 'grshadercache', 'crashpad', 'logs', 'log', 'temp', 'tmp']) {
        assert.match(HELPER.toLowerCase(), new RegExp('\\\\' + part.replace(' ', '\\s') + '\\\\'));
    }
    const capture = HELPER.slice(HELPER.indexOf('function Get-CaptureEntries'), HELPER.indexOf('function Test-IsAllowedRestorePath'));
    assert.match(capture, /category = 'stable'/);
    assert.doesNotMatch(capture.slice(capture.indexOf("category = 'stable'"), capture.indexOf('foreach ($root')), /MaxBrowserFileBytes/);
    assert.match(capture.slice(capture.indexOf('foreach ($root')), /Length -le \$MaxBrowserFileBytes/);
});

test('every captured file and registry export is DPAPI CurrentUser encrypted', () => {
    assert.match(HELPER, /DataProtectionScope\]::CurrentUser/);
    assert.match(HELPER, /Protect-Bytes \$plain/);
    assert.match(HELPER, /Protect-Bytes \$plainRegistry/);
    assert.doesNotMatch(HELPER, /Copy-Item[^\r\n]+\$filesDirectory/i);
});

test('restore validates destinations against known roots and atomically replaces files', () => {
    assert.match(HELPER, /Test-IsAllowedRestorePath/);
    assert.match(HELPER, /contains a disallowed restore path/);
    assert.match(HELPER, /MoveFileEx/);
    assert.match(HELPER, /Clear-GogRegistry[\s\S]*Import-GogRegistry/);
});

test('add transaction verifies Galaxy then delegates atomic pending-before-clear flow and launches non-elevated Galaxy', async t => {
    const f = await fixture(async (call, service) => {
        await service._writeJson(service.paths().pending, { version: 1, rollbackId: call.request.rollbackId, startedAt: call.request.startedAt, previousActiveProfileId: null });
        return { success: true };
    });
    t.after(f.cleanup);
    const result = await f.service.addNewAccount();
    assert.equal(result.pending, true);
    assert.deepEqual({ ok: result.ok, method: result.method, source: result.source }, { ok: true, method: 'executable', source: 'gog-registration' });
    assert.equal(f.calls[0].operation, 'BeginAdd');
    assert.equal((await f.service.getAddState()).pending, true);
    assert.equal(f.launches.length, 1);
    assert.equal(f.launches[0].options.requireSpawnConfirmation, true);
    const beginBlock = HELPER.slice(HELPER.lastIndexOf("'BeginAdd' {"), HELPER.lastIndexOf("'CaptureProfile' {"));
    assert.match(beginBlock, /Capture-State[\s\S]*Write-AtomicJson \$PendingFile[\s\S]*Clear-CurrentSession/);
});

test('detected custom GOG launcher path is persisted before account work starts', async t => {
    const f = await fixture();
    t.after(f.cleanup);
    let saved = null;
    const customExe = path.win32.join('E:', 'Custom', 'GalaxyClient.exe');
    f.service.launcherPathResolver = {
        getLauncherLaunchSpec: async () => ({
            exePath: customExe,
            args: [],
            source: 'deep-drive-search',
        }),
        saveManualLauncherPath: async (platform, exePath) => {
            saved = { platform, exePath };
        },
    };
    await f.service.addNewAccount();
    assert.deepEqual(saved, { platform: 'gog', exePath: customExe });
});

test('save captures UUID profile, writes metadata atomically, activates it, and clears pending', async t => {
    const f = await fixture(async (call, service) => {
        if (call.operation === 'CaptureProfile') {
            const dir = path.join(service.paths().profiles, call.request.profileId);
            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(path.join(dir, 'manifest.json'), '{}');
        }
        return { success: true };
    });
    t.after(f.cleanup);
    await f.service._writeJson(f.service.paths().pending, { version: 1, rollbackId: IDS[9], startedAt: 'now' });
    const result = await f.service.saveCurrentAccount('  gg  ');
    assert.equal(result.profile.displayName, 'gg');
    const savedProfiles = await f.service.getProfiles();
    assert.equal(savedProfiles[0].displayName, 'gg');
    assert.equal(savedProfiles[0].isActive, true);
    assert.equal((await f.service.getAddState()).pending, false);
    assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.tmp')), false);
});

test('save current captures an already logged-in account without requiring Add first', async t => {
    const f = await fixture(async (call, service) => {
        const dir = path.join(service.paths().profiles, call.request.profileId);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, 'manifest.json'), '{}');
        return { success: true };
    });
    t.after(f.cleanup);
    const result = await f.service.saveCurrentAccount('Already Open');
    assert.equal(result.profile.displayName, 'Already Open');
    assert.equal(f.calls[0].operation, 'CaptureProfile');
    assert.equal((await f.service.getProfiles())[0].isActive, true);
    assert.equal((await f.service.getAddState()).pending, false);
});

test('cancel restores pending rollback and previous active marker before clearing pending', async t => {
    const f = await fixture();
    t.after(f.cleanup);
    await writeProfile(f.service, IDS[8], 'Previous', true);
    await f.service._writeJson(f.service.paths().pending, { version: 1, rollbackId: IDS[9], previousActiveProfileId: IDS[8], startedAt: 'now' });
    await f.service.cancelAdd();
    assert.equal(f.calls[0].operation, 'CancelAdd');
    assert.equal((await f.service.getProfiles())[0].isActive, true);
    assert.equal((await f.service.getAddState()).pending, false);
});

test('failed cancel preserves pending rollback data', async t => {
    const f = await fixture(async () => { throw Object.assign(new Error('restore failed'), { code: 'GOG_TRANSACTION_FAILED' }); });
    t.after(f.cleanup);
    await f.service._writeJson(f.service.paths().pending, { version: 1, rollbackId: IDS[9], startedAt: 'now' });
    await assert.rejects(() => f.service.cancelAdd(), /restore failed/);
    assert.equal((await f.service.getAddState()).pending, true);
});

test('switch helper captures rollback before clear and automatically restores on failure', () => {
    const switchStart = HELPER.lastIndexOf("'SwitchProfile' {");
    const block = HELPER.slice(switchStart, HELPER.indexOf('Prune-Rollbacks', switchStart) + 100);
    assert.match(block, /Capture-State[\s\S]*Clear-CurrentSession[\s\S]*Restore-State/);
    assert.match(block, /catch[\s\S]*Restore-State \(Join-Path \$RollbacksRoot/);
    assert.doesNotMatch(HELPER, /Stop-GalaxyService|Start-GalaxyService|GalaxyClientService/);
});

test('switch updates active metadata only after helper success; active selection skips restore', async t => {
    const f = await fixture();
    t.after(f.cleanup);
    await writeProfile(f.service, IDS[7], 'Account');
    await f.service.switchAccount(IDS[7]);
    assert.equal(f.calls[0].operation, 'SwitchProfile');
    assert.equal((await f.service.getProfiles())[0].isActive, true);
    f.calls.length = 0;
    await f.service.switchAccount(IDS[7]);
    assert.equal(f.calls.length, 0);
    assert.equal(f.launches.length, 2);
});

test('failed switch never changes active metadata', async t => {
    const f = await fixture(async () => { throw Object.assign(new Error('switch failed'), { rollbackSucceeded: true }); });
    t.after(f.cleanup);
    await writeProfile(f.service, IDS[6], 'Target');
    await assert.rejects(() => f.service.switchAccount(IDS[6]), /switch failed/);
    assert.equal((await f.service.getProfiles())[0].isActive, false);
});

test('main-process mutex rejects concurrent GOG operations', async t => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const f = await fixture(async (call, service) => {
        await service._writeJson(service.paths().pending, { version: 1, rollbackId: call.request.rollbackId, startedAt: 'now' });
        await gate;
        return { success: true };
    });
    t.after(f.cleanup);
    const first = f.service.addNewAccount();
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(() => f.service.addNewAccount(), { code: 'GOG_OPERATION_IN_PROGRESS' });
    release();
    await first;
});

test('profile names and profile IDs are strictly validated', () => {
    assert.equal(normalizeProfileName('  Personal   GOG '), 'Personal GOG');
    for (const bad of ['', '../escape', 'CON', 'x'.repeat(65)]) assert.throws(() => normalizeProfileName(bad));
});

test('GOG Library Sync remains separate from switcher profiles and only reliable platformAccountId may match', () => {
    assert.match(HANDLER, /getDefaultGogAccountSwitcher\(\)\.getProfiles/);
    assert.match(PANELS, /getGogProfiles/);
    assert.doesNotMatch(PANELS.slice(PANELS.indexOf('else if (platform === \'gog\')'), PANELS.indexOf('} else {', PANELS.indexOf('else if (platform === \'gog\')'))), /platformSyncGetAccounts/);
    assert.match(OWNERSHIP, /platform === 'gog'[\s\S]*raw\.platformAccountId \|\| null/);
    assert.match(OWNERSHIP, /platform === 'gog'[\s\S]*Boolean\(aId && bId && aId === bId\)/);
});

test('all GOG IPC, Accounts, recovery, shortcuts, Quick Switcher, and Play Launcher mappings are wired', () => {
    for (const api of ['getGogProfiles', 'getGogAddState', 'addNewGogAccount', 'saveGogAccount', 'cancelAddGogAccount', 'switchGogAccount', 'renameGogProfile', 'deleteGogProfile']) assert.match(PRELOAD, new RegExp(api));
    for (const channel of ['get-gog-profiles', 'get-gog-add-state', 'add-new-gog-account', 'save-gog-account', 'cancel-add-gog-account', 'switch-gog-account', 'rename-gog-profile', 'delete-gog-profile']) assert.match(HANDLER, new RegExp(channel));
    assert.match(PANELS, /PLATFORM_CONFIG[\s\S]*gog:[\s\S]*switchFn: switchGogAccount/);
    assert.match(PANELS, /gogPendingAddBanner[\s\S]*Cancel Add/);
    assert.match(MODAL, /gogSpecial[\s\S]*Cancel Add/);
    assert.match(PLAY, /gog:\s+\(id\) => window\.electronAPI\.switchGogAccount/);
    assert.match(PLAY, /gog:\s+\(\) => window\.electronAPI\.getGogProfiles/);
    assert.match(QUICK, /if \(platform === 'gog'\) return 10000/);
});

test('helper closes every Galaxy process that can retain or lock the account session', () => {
    const close = HELPER.slice(HELPER.indexOf('function Close-GalaxyProcesses'), HELPER.indexOf('function Export-GogRegistry'));
    for (const name of ['GalaxyClient', 'GalaxyCommunication', 'GOG Galaxy Notifications Renderer', 'QtWebEngineProcess']) {
        assert.ok(close.includes(`'${name}'`), `missing process ${name}`);
    }
});

test('active GOG sidebar item uses its purple accent with readable white text', () => {
    assert.match(ACCOUNTS_CSS, /#nav-gog\.active\s*\{[^}]*background:\s*#8638e5[^}]*color:\s*#fff/is);
    assert.match(DASHBOARD_CSS, /#sbBodyAccounts #nav-gog\.active \.nav-text\s*\{[^}]*color:\s*#ffffff/is);
    const darkTextGroup = DASHBOARD_CSS.slice(
        DASHBOARD_CSS.indexOf('#sbBodyAccounts #nav-steam.active .nav-text'),
        DASHBOARD_CSS.indexOf('#sbBodyAccounts #nav-gog.active .nav-text')
    );
    assert.doesNotMatch(darkTextGroup, /#nav-gog\.active/);
});

test('helper uses Windows PowerShell 5.1-compatible literal-safe directory creation', () => {
    assert.doesNotMatch(HELPER, /New-Item\s+-LiteralPath/);
    assert.match(HELPER, /\[IO\.Directory\]::CreateDirectory\(\$directory\)/);
    assert.match(HELPER, /\[IO\.Directory\]::CreateDirectory\(\$filesDirectory\)/);
    assert.match(HELPER, /\[IO\.Directory\]::CreateDirectory\(\$parent\)/);
});

test('helper validates operations and runs normal account work without elevation or service control', () => {
    assert.match(HELPER, /ValidateSet\('BeginAdd', 'CaptureProfile', 'CancelAdd', 'SwitchProfile'\)/);
    assert.match(HELPER, /ValidatePattern\('\^\[0-9a-f\]\{32\}\$'\)/);
    assert.doesNotMatch(HELPER, /-Verb RunAs|Test-IsAdministrator|GOG_ELEVATION_|\[switch\]\$Elevated/);
    assert.doesNotMatch(HELPER, /Stop-Service|Start-Service|GalaxyClientService/);
    assert.match(HELPER, /GOG_SWITCHER_STORAGE_ACCESS_DENIED/);
    assert.match(HELPER, /GOG_LOCAL_SESSION_ACCESS_DENIED/);
    assert.match(HELPER, /GOG_PROGRAMDATA_ACCESS_DENIED/);
    assert.match(HELPER, /GOG_REGISTRY_ACCESS_DENIED/);
    assert.match(HELPER, /GOG_SESSION_FILES_LOCKED/);
});

test('main process invokes the PowerShell helper directly without elevation arguments', async t => {
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'baddel-gog-helper-runner-'));
    t.after(() => fsp.rm(temp, { recursive: true, force: true }));
    const root = path.join(temp, 'accounts', 'gog');
    let invocation = null;
    let service;
    service = new GogAccountSwitcher({
        root,
        helperPath: path.join(ROOT, 'resources', 'gog-account-switcher-helper.ps1'),
        fsSync: fs,
        execFileAsync: async (exe, args, options) => {
            invocation = { exe, args, options };
            await service._writeJson(path.join(service.paths().results, IDS[0] + '.json'), { success: true, code: 'OK' });
        },
        analytics: {},
    });
    const result = await service._runHelper({
        operation: 'SwitchProfile',
        operationId: IDS[0],
        request: { profileId: IDS[1], rollbackId: IDS[2] },
    });
    assert.equal(result.success, true);
    assert.equal(invocation.exe, 'powershell.exe');
    assert.equal(invocation.args.includes('-File'), true);
    assert.equal(invocation.args.includes('-Elevated'), false);
    assert.equal(invocation.args.includes('-EncodedCommand'), false);
});

test('real helper failures preserve bounded process diagnostics and transaction errors', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'gogAccountSwitcher.js'), 'utf8');
    assert.match(source, /last-helper-diagnostic\.json/);
    assert.match(source, /helperExists/);
    assert.match(source, /String\(error\?\.stderr \|\| ''\)\.slice\(0, 4000\)/);
    assert.match(HELPER, /Get-SafeFailure \$_/);
    assert.match(HELPER, /\$resultCode = \[string\]\$safeFailure\.code/);
});

test('normal and protected packaging include the helper as an extraResource', () => {
    for (const file of ['package.json', 'electron-builder.protected.json']) {
        const config = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        const extra = file === 'package.json' ? config.build.extraResources : config.extraResources;
        assert.ok(extra.some(item => item.from === 'resources/gog-account-switcher-helper.ps1' && item.to === 'gog-account-switcher-helper.ps1'));
    }
});

test('targeted GOG add stores the verified canonical account ID', async t => {
    const f = await fixture(async (call, service) => {
        if (call.operation === 'BeginAdd') {
            await service._writeJson(service.paths().pending, { version: 1, rollbackId: call.request.rollbackId, expectedPlatformAccountId: call.request.expectedPlatformAccountId });
        } else if (call.operation === 'CaptureProfile') {
            const dir = path.join(service.paths().profiles, call.request.profileId);
            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(path.join(dir, 'manifest.json'), '{}');
            return { success: true, identityNamespace: 'gog-user-id', platformAccountId: '55050878658202451' };
        }
        return { success: true };
    });
    t.after(f.cleanup);
    await f.service.addNewAccount('55050878658202451');
    const saved = await f.service.saveCurrentAccount('Verified');
    assert.equal(saved.profile.platformAccountId, '55050878658202451');
    assert.equal((await f.service.getProfiles())[0].platformAccountId, '55050878658202451');
});

test('targeted GOG add rejects a different signed-in account and preserves recovery state', async t => {
    const f = await fixture(async (call, service) => {
        if (call.operation === 'BeginAdd') await service._writeJson(service.paths().pending, { version: 1, rollbackId: call.request.rollbackId, expectedPlatformAccountId: call.request.expectedPlatformAccountId });
        if (call.operation === 'CaptureProfile') {
            const dir = path.join(service.paths().profiles, call.request.profileId);
            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(path.join(dir, 'manifest.json'), 'encrypted');
            return { success: true, identityNamespace: 'gog-user-id', platformAccountId: '222' };
        }
        return { success: true };
    });
    t.after(f.cleanup);
    await f.service.addNewAccount('111');
    await assert.rejects(() => f.service.saveCurrentAccount('Wrong'), { code: 'GOG_ACCOUNT_MISMATCH' });
    assert.equal((await f.service.getProfiles()).length, 0);
    assert.equal((await f.service.getAddState()).pending, true);
});

test('duplicate GOG platform-account binding is rejected without overwriting metadata', async t => {
    const f = await fixture();
    t.after(f.cleanup);
    await writeProfile(f.service, IDS[1], 'First');
    const p = f.service.paths();
    await f.service.linkProfileAccount(IDS[1], '777');
    await fsp.mkdir(path.join(p.profiles, IDS[2]), { recursive: true });
    await fsp.writeFile(path.join(p.profiles, IDS[2], 'manifest.json'), '{}');
    const metadata = await f.service._metadata();
    metadata.profiles.push({ id: IDS[2], displayName: 'Second', platformAccountId: null });
    await f.service._writeJson(p.metadata, metadata);
    await assert.rejects(() => f.service.linkProfileAccount(IDS[2], '777'), { code: 'GOG_ACCOUNT_ALREADY_LINKED' });
    assert.equal((await f.service.getProfiles()).find(profile => profile.id === IDS[2]).platformAccountId, null);
});

test('null-ID profile backfills only from helper-proven GOG identity, never its display name', async t => {
    const f = await fixture(async call => call.operation === 'SwitchProfile'
        ? { success: true, identityNamespace: 'gog-user-id', platformAccountId: '999' }
        : { success: true });
    t.after(f.cleanup);
    await writeProfile(f.service, IDS[3], '999');
    assert.equal((await f.service.getProfiles())[0].platformAccountId, null);
    await f.service.switchAccount(IDS[3]);
    assert.equal((await f.service.getProfiles())[0].platformAccountId, '999');
    const raw = await fsp.readFile(f.service.paths().metadata, 'utf8');
    assert.doesNotMatch(raw, /accessToken|refreshToken|cookie|password/i);
});
