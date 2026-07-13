'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// _mobileApprovalPollStep is a pure function — no Electron needed.
// We mock the Electron-dependent parts of platformSync.js before requiring it.
const Module = require('module');
const _origLoad = Module._load;
const _mockApp = { getPath: () => '/tmp/baddel-test' };
const _mockGamesContainer = {
    getGamesFeature: () => ({
        getLocalSteamGames: () => [],
        getSavedGames: () => [],
        removeEpicNonGameEntries: async () => {},
    }),
};
Module._load = function (id, parent, isMain) {
    if (id === 'electron') return { app: _mockApp, BrowserWindow: null, Notification: null };
    if (id === './src/features/games/infrastructure/composition/GamesContainer') return _mockGamesContainer;
    if (id === './platformSyncShared') return {};
    if (id === './services/baddelApi') return {};
    if (id === './services/credentialValidator') return { redactSecrets: x => x };
    if (id === './steamBridge') return {};
    return _origLoad.apply(this, arguments);
};

const { _mobileApprovalPollStep } = require('../platformSync');

Module._load = _origLoad; // restore

const MAX = 90;

// ── Status → action mapping ────────────────────────────────────

test('authenticated → resolved', () => {
    const r = _mobileApprovalPollStep('authenticated', 1, MAX);
    assert.equal(r.action, 'resolved');
});

test('pending_approval → poll with message', () => {
    const r = _mobileApprovalPollStep('pending_approval', 5, MAX);
    assert.equal(r.action, 'poll');
    assert.ok(r.message, 'should include status message');
    assert.match(r.message, /waiting/i);
});

test('approval_denied → stop, re-enable button, write diag', () => {
    const r = _mobileApprovalPollStep('approval_denied', 3, MAX);
    assert.equal(r.action, 'stop');
    assert.equal(r.reenableButton, true);
    assert.equal(r.writeDiag, 'approval_denied');
    assert.match(r.message, /denied/i);
});

test('approval_expired → stop, re-enable button, write diag', () => {
    const r = _mobileApprovalPollStep('approval_expired', 3, MAX);
    assert.equal(r.action, 'stop');
    assert.equal(r.reenableButton, true);
    assert.equal(r.writeDiag, 'approval_expired');
    assert.match(r.message, /expired/i);
});

test('need_login → stop, re-enable button, write diag', () => {
    const r = _mobileApprovalPollStep('need_login', 3, MAX);
    assert.equal(r.action, 'stop');
    assert.equal(r.reenableButton, true);
    assert.equal(r.writeDiag, 'need_login');
});

test('error → stop, re-enable button, write diag', () => {
    const r = _mobileApprovalPollStep('error', 3, MAX);
    assert.equal(r.action, 'stop');
    assert.equal(r.reenableButton, true);
    assert.equal(r.writeDiag, 'error');
});

test('need_2fa (legacy) → poll (no message)', () => {
    const r = _mobileApprovalPollStep('need_2fa', 1, MAX);
    assert.equal(r.action, 'poll');
});

test('unknown status → poll (no stop)', () => {
    const r = _mobileApprovalPollStep('some_future_status', 1, MAX);
    assert.equal(r.action, 'poll');
});

// ── Max attempts guard ─────────────────────────────────────────

test('max_attempts: exactly at limit → stop', () => {
    const r = _mobileApprovalPollStep('pending_approval', MAX, MAX);
    assert.equal(r.action, 'stop');
    assert.equal(r.writeDiag, 'max_attempts');
    assert.equal(r.reenableButton, true);
});

test('max_attempts: over limit → stop', () => {
    const r = _mobileApprovalPollStep('authenticated', MAX + 1, MAX);
    assert.equal(r.action, 'stop');
    assert.equal(r.writeDiag, 'max_attempts');
});

test('max_attempts: under limit → normal handling', () => {
    const r = _mobileApprovalPollStep('authenticated', MAX - 1, MAX);
    assert.equal(r.action, 'resolved');
});

// ── Message content ────────────────────────────────────────────

test('pending_approval message includes attempt number', () => {
    const r = _mobileApprovalPollStep('pending_approval', 7, MAX);
    assert.match(r.message, /7/);
});

test('approval_denied message mentions steam app', () => {
    const r = _mobileApprovalPollStep('approval_denied', 1, MAX);
    assert.match(r.message, /steam/i);
});

test('error message mentions login error', () => {
    const r = _mobileApprovalPollStep('error', 1, MAX);
    assert.match(r.message, /login error/i);
});

// ── Diag field presence ────────────────────────────────────────

test('non-stop statuses have no writeDiag', () => {
    for (const status of ['pending_approval', 'need_2fa', null]) {
        const r = _mobileApprovalPollStep(status, 1, MAX);
        if (r.action !== 'stop') {
            assert.ok(!r.writeDiag, `${status} should not writeDiag`);
        }
    }
});

test('all stop statuses with failure have writeDiag set', () => {
    const failStatuses = ['approval_denied', 'approval_expired', 'need_login', 'error'];
    for (const status of failStatuses) {
        const r = _mobileApprovalPollStep(status, 1, MAX);
        assert.ok(r.writeDiag, `${status} should set writeDiag`);
    }
});

// ── reenableButton ─────────────────────────────────────────────

test('authenticated does not reenable button (window closes instead)', () => {
    const r = _mobileApprovalPollStep('authenticated', 1, MAX);
    assert.ok(!r.reenableButton);
});

test('pending_approval does not reenable button', () => {
    const r = _mobileApprovalPollStep('pending_approval', 1, MAX);
    assert.ok(!r.reenableButton);
});

test('all failure-stop statuses reenable button', () => {
    const stops = ['approval_denied', 'approval_expired', 'need_login', 'error'];
    for (const s of stops) {
        const r = _mobileApprovalPollStep(s, 1, MAX);
        assert.equal(r.reenableButton, true, `${s} should reenable button`);
    }
});

// ── HTML structure: index.html routing ────────────────────────

const fs   = require('fs');
const path = require('path');
const HTML_PATH = path.join(__dirname, '../baddel-steam-integration/src/steam_network/custom_login/index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

test('index.html has #chooseMethod fieldset', () => {
    assert.ok(html.includes('id="chooseMethod"'), 'missing #chooseMethod fieldset');
});

test('index.html has #steamGuardQR fieldset', () => {
    assert.ok(html.includes('id="steamGuardQR"'), 'missing #steamGuardQR fieldset');
});

test('index.html has #steamQRCode container inside QR fieldset', () => {
    assert.ok(html.includes('id="steamQRCode"'), 'missing #steamQRCode element');
});

test('index.html has baddel://auth/qr-start link', () => {
    assert.ok(html.includes('baddel://auth/qr-start'), 'missing qr-start navigation link');
});

test('index.html has baddel://auth/login-form link', () => {
    assert.ok(html.includes('baddel://auth/login-form'), 'missing login-form navigation link');
});

test('index.html viewLookup has chooseMethod key', () => {
    assert.ok(html.includes('chooseMethod:'), 'viewLookup missing chooseMethod entry');
    assert.ok(html.includes('"choose_method"'), 'viewLookup choose_method value missing');
});

test('index.html viewLookup has steamQR key', () => {
    assert.ok(html.includes('steamQR:'), 'viewLookup missing steamQR entry');
    assert.ok(html.includes('"steam_qr"'), 'viewLookup steam_qr value missing');
});

test('index.html switch handles choose_method: shows chooser fieldset', () => {
    assert.ok(html.includes('chooseMethodFieldset'), 'fieldSetsObj missing chooseMethodFieldset');
    assert.ok(html.includes('viewLookup.chooseMethod'), 'switch missing chooseMethod case');
});

test('index.html switch handles steam_qr: shows QR fieldset', () => {
    assert.ok(html.includes('steamQRFieldset'), 'fieldSetsObj missing steamQRFieldset');
    assert.ok(html.includes('viewLookup.steamQR'), 'switch missing steamQR case');
});

test('index.html choose_method and steam_qr views hide Continue button', () => {
    // Both cases must set continueBtn.style.display = 'none' — check it appears twice in the switch
    const matches = [...html.matchAll(/continueBtn\.style\.display\s*=\s*['"]none['"]/g)];
    assert.ok(matches.length >= 2, `continueBtn hidden in ${matches.length} case(s), expected >= 2`);
});

// ── _startQrLoginFlow functional tests ───────────────────────

// Re-require platformSync with a steamBridge that has QR methods mocked.
{
    const psKey = require.resolve('../platformSync');
    delete require.cache[psKey];

    let _startQrCalled = 0;
    let _pollResponses = [];

    const _fakeSteamBridge = {
        startQrLogin: async () => {
            _startQrCalled++;
            return { status: 'need_qr', challengeUrl: 'steam://qr/testcode', interval: 0.05 };
        },
        pollSteamAuth: async () => _pollResponses.shift() ?? { status: 'pending_approval' },
    };

    const _fakeMod = Module._load;
    Module._load = function (id, parent, isMain) {
        if (id === 'electron') return { app: _mockApp, BrowserWindow: null, Notification: null };
        if (id === './src/features/games/infrastructure/composition/GamesContainer') return _mockGamesContainer;
        if (id === './platformSyncShared') return {};
        if (id === './services/baddelApi') return {};
        if (id === './services/credentialValidator') return { redactSecrets: x => x };
        if (id === './steamBridge') return _fakeSteamBridge;
        if (id === 'qrcode') return { toDataURL: async (url) => `data:image/png;base64,fake=${url}` };
        return _origLoad.apply(this, arguments);
    };

    const { _startQrLoginFlow: _sqf } = require('../platformSync');
    Module._load = _origLoad;

    // Re-insert real platformSync into cache so other tests still work
    require.cache[psKey] = require.cache[require.resolve('../platformSync')];

    const _makeFakeWin = () => {
        const loaded = [];
        return {
            isDestroyed: () => false,
            close: () => {},
            loadURL: async (u) => { loaded.push(u); },
            webContents: { executeJavaScript: async () => {}, getURL: () => 'file:///index.html?view=choose_method' },
            _loaded: loaded,
        };
    };

    test('_startQrLoginFlow calls steamBridge.startQrLogin()', async () => {
        _startQrCalled = 0;
        _pollResponses = [{ status: 'authenticated', steamId: '123' }];
        const win = _makeFakeWin();
        await new Promise((resolve, reject) => {
            _sqf(win, resolve, reject, () => {});
            // resolve/reject will fire from the poll
        });
        assert.ok(_startQrCalled >= 1, 'startQrLogin not called');
    });

    test('_startQrLoginFlow loads steam_qr view URL', async () => {
        _startQrCalled = 0;
        _pollResponses = [{ status: 'authenticated', steamId: '123' }];
        const win = _makeFakeWin();
        await new Promise((resolve, reject) => {
            _sqf(win, resolve, reject, () => {});
        });
        assert.ok(win._loaded.some(u => u.includes('steam_qr')), 'steam_qr view URL not loaded');
    });

    test('_startQrLoginFlow resolves on authenticated poll result', async () => {
        _pollResponses = [{ status: 'authenticated', steamId: '999' }];
        const win = _makeFakeWin();
        const result = await new Promise((resolve, reject) => {
            _sqf(win, resolve, reject, () => {});
        });
        assert.equal(result.status, 'authenticated');
    });

    test('_startQrLoginFlow rejects on approval_denied poll result', async () => {
        _pollResponses = [{ status: 'approval_denied', message: 'User denied' }];
        const win = _makeFakeWin();
        await assert.rejects(
            new Promise((resolve, reject) => { _sqf(win, resolve, reject, () => {}); }),
            /User denied/
        );
    });

    test('_startQrLoginFlow restarts (calls startQrLogin again) on approval_expired', async () => {
        _startQrCalled = 0;
        // First poll: expired. Second start + poll: authenticated.
        let callIdx = 0;
        _fakeSteamBridge.pollSteamAuth = async () => {
            callIdx++;
            if (callIdx === 1) return { status: 'approval_expired' };
            return { status: 'authenticated', steamId: '42' };
        };
        const win = _makeFakeWin();
        await new Promise((resolve, reject) => {
            _sqf(win, resolve, reject, () => {});
        });
        assert.ok(_startQrCalled >= 2, `startQrLogin should be called at least twice on expiry, got ${_startQrCalled}`);
        // restore
        _fakeSteamBridge.pollSteamAuth = async () => _pollResponses.shift() ?? { status: 'pending_approval' };
    });
}

// ── Quiet-mode / debug-mode structural checks ─────────────────

test('main.js contains BADDEL_DISABLE_STARTUP_SYNC gate', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    assert.ok(mainJs.includes('BADDEL_DISABLE_STARTUP_SYNC'), 'BADDEL_DISABLE_STARTUP_SYNC gate missing from main.js');
    assert.ok(mainJs.includes("!== '1'"), 'gate comparison missing');
});

test('main.js autoSyncOnStartup is not permanently commented out', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    assert.ok(mainJs.includes('autoSyncOnStartup()'), 'autoSyncOnStartup call removed from main.js');
});

test('platformSync.js contains [STEAM-LINK-DEBUG] initial authResult log', () => {
    const ps = fs.readFileSync(path.join(__dirname, '../platformSync.js'), 'utf8');
    assert.ok(ps.includes('[STEAM-LINK-DEBUG] initial authResult'), 'debug log missing from platformSync.js');
});

test('platformSync.js exports autoSyncOnStartup (not removed)', () => {
    const ps = fs.readFileSync(path.join(__dirname, '../platformSync.js'), 'utf8');
    assert.ok(ps.includes('autoSyncOnStartup'), 'autoSyncOnStartup was removed from platformSync.js');
});

test('platformSync.js defines QUIET_LOGS and STEAM_AUTH_DEBUG flags', () => {
    const ps = fs.readFileSync(path.join(__dirname, '../platformSync.js'), 'utf8');
    assert.ok(ps.includes('BADDEL_QUIET_LOGS'), 'QUIET_LOGS gate missing from platformSync.js');
    assert.ok(ps.includes('BADDEL_STEAM_AUTH_DEBUG'), 'STEAM_AUTH_DEBUG gate missing from platformSync.js');
});

test('platformSync.js uses the GamesContainer singleton instead of the gameScanner shim', () => {
    const ps = fs.readFileSync(path.join(__dirname, '../platformSync.js'), 'utf8');
    assert.match(ps, /getGamesFeature/);
    assert.doesNotMatch(ps, /require\s*\(\s*['"]\.\/gameScanner['"]\s*\)/);
    assert.doesNotMatch(ps, /createGamesFeature/);
});

test('steamBridge.js filters protocol noise in QUIET mode', () => {
    const sb = fs.readFileSync(path.join(__dirname, '../steamBridge.js'), 'utf8');
    assert.ok(sb.includes('BADDEL_QUIET_LOGS'), 'QUIET mode filter missing from steamBridge.js');
    assert.ok(sb.includes('ClientPersonaState'), 'known noise pattern not referenced in filter');
    assert.ok(sb.includes('isAuthRelevant'), 'auth-relevant keep-list missing');
});

test('steamBridge.js keeps ERROR lines visible in quiet mode', () => {
    const sb = fs.readFileSync(path.join(__dirname, '../steamBridge.js'), 'utf8');
    assert.ok(sb.includes("line.includes('ERROR')"), "ERROR lines not preserved in quiet filter");
});

test('steamBridge.js keeps QR/2FA/Steam Guard lines visible in quiet mode', () => {
    const sb = fs.readFileSync(path.join(__dirname, '../steamBridge.js'), 'utf8');
    assert.ok(sb.includes("'QRCode'") || sb.includes("' QR '") || sb.includes("'QR"), 'QR not preserved');
    assert.ok(sb.includes("line.includes('2FA')"), '2FA not preserved');
    assert.ok(sb.includes("line.includes('Steam Guard')"), 'Steam Guard not preserved');
});

test('baddelApi.js has throttled warn helper to suppress repeated enrich failures', () => {
    const api = fs.readFileSync(path.join(__dirname, '../services/baddelApi.js'), 'utf8');
    assert.ok(api.includes('_throttledWarn'), '_throttledWarn missing from baddelApi.js');
    assert.ok(api.includes('60_000'), '60s throttle window missing');
});

test('package.json has start:steam-debug script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert.ok(pkg.scripts['start:steam-debug'], 'start:steam-debug script missing from package.json');
    assert.ok(pkg.scripts['start:steam-debug'].includes('BADDEL_DISABLE_STARTUP_SYNC'), 'env flag missing from script');
});

test('package.json has cross-env as devDependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert.ok(pkg.devDependencies['cross-env'], 'cross-env missing from devDependencies');
});
