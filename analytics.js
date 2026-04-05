'use strict';

// ============================================================
// BADDEL LAUNCHER - ANALYTICS
// PostHog  → behavioural events (game launches, account actions, …)
// GA4 MP   → realtime active-users dashboard only
// Both share the same persistent installation_id as their user key.
// ============================================================

const https   = require('https');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs').promises;
const { app } = require('electron');

// ---- PostHog ----
const POSTHOG_API_KEY = 'phc_EzwXItVGlqejfHnNielT331MwH6NlO3jZFU80ipU5yO';
const POSTHOG_HOST    = 'us.i.posthog.com';

// ---- GA4 Measurement Protocol ----
const GA4_MEASUREMENT_ID = 'G-7C9JNWLNVZ';
const GA4_API_SECRET     = 'wqv6PpiRRSu4S4gWSi7Fog';

const APP_VERSION = app.getVersion?.() || '0.0.0';

// ---- Module state ----
let _installationId  = null;
let _consentGiven    = false;
let _dataDir         = null;
let _eventQueue      = [];
let _isFlushing      = false;
let _cachedOsVersion = 'unknown';

// GA4 realtime state
let _ga4SessionId      = null;
let _ga4UserCountry    = 'Unknown';
let _ga4HeartbeatTimer = null;
const GA4_HEARTBEAT_MS = 120_000; // 2 min — keeps user inside GA4's 5-min realtime window

// ============================================================
// INIT
// ============================================================
async function init() {
    _dataDir = path.join(app.getPath('userData'), 'BaddelLauncher');

    _cachedOsVersion = _osVersion();

    // Persistent installation ID (shared with GA4 so both tools track the same user)
    const idFile = path.join(_dataDir, 'installation_id.txt');
    try {
        _installationId = (await fs.readFile(idFile, 'utf8')).trim();
    } catch {
        _installationId = crypto.randomUUID();
        try {
            await fs.mkdir(_dataDir, { recursive: true });
            await fs.writeFile(idFile, _installationId, 'utf8');
        } catch { /* non-fatal */ }
    }

    // Analytics consent
    const consentFile = path.join(_dataDir, 'analytics_consent.txt');
    try {
        _consentGiven = (await fs.readFile(consentFile, 'utf8')).trim() === 'true';
    } catch {
        _consentGiven = false;
    }

    await _loadQueue();
    setInterval(_flushQueue, 60_000);

    console.log(`[Analytics] Ready. ID: ${_installationId?.slice(0, 8)}… consent: ${_consentGiven}`);

    // PostHog essential ping (no consent required)
    await _send('launcher_ping', { status: 'alive' }, true);

    // GA4 realtime: fire app_open once, then keep user visible via heartbeat
    _ga4SessionId = Math.floor(Date.now() / 1000); 
    _fetchCountryThenPing();
}

// ============================================================
// POSTHOG — OFFLINE QUEUE
// ============================================================
async function _loadQueue() {
    try {
        const data = await fs.readFile(path.join(_dataDir, 'analytics_queue.json'), 'utf-8');
        _eventQueue = JSON.parse(data);
    } catch {
        _eventQueue = [];
    }
}

async function _saveQueue() {
    try {
        await fs.writeFile(
            path.join(_dataDir, 'analytics_queue.json'),
            JSON.stringify(_eventQueue)
        );
    } catch { /* non-fatal */ }
}

async function _sendToPostHog(batch) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            api_key: POSTHOG_API_KEY,
            batch:   batch.map(ev => ({
                event:      ev.event,
                properties: {
                    ...ev.properties,
                    distinct_id: ev.properties.distinct_id,
                    $lib:        'Baddel-Launcher-Electron'
                },
                timestamp: new Date(ev.properties.time * 1000).toISOString()
            }))
        });

        const bodyBuf = Buffer.from(postData, 'utf8');

        const req = https.request(
            {
                hostname: POSTHOG_HOST,
                port:     443,
                path:     '/batch/',
                method:   'POST',
                headers:  {
                    'Content-Type':   'application/json',
                    'Content-Length': bodyBuf.byteLength
                }
            },
            (res) => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) resolve();
                    else reject(new Error(`PostHog ${res.statusCode}: ${body}`));
                });
            }
        );
        req.on('error', reject);
        req.write(bodyBuf);
        req.end();
    });
}

async function _flushQueue() {
    if (_isFlushing || _eventQueue.length === 0) return;
    _isFlushing = true;

    const batch = _eventQueue.slice(0, 50);
    try {
        await _sendToPostHog(batch);
        _eventQueue.splice(0, batch.length);
        await _saveQueue();
        console.log(`[PostHog] Sent ${batch.length} event(s).`);
        if (_eventQueue.length > 0) setTimeout(_flushQueue, 2000);
    } catch (err) {
        console.warn('[PostHog] Flush failed:', err.message);
    }

    _isFlushing = false;
}

async function _send(eventName, properties = {}, isEssential = false) {
    if (!_installationId) return;
    if (!_consentGiven && !isEssential) return;

    _eventQueue.push({
        event:      eventName,
        properties: {
            distinct_id:  _installationId,
            time:         Math.floor(Date.now() / 1000),
            $app_version: APP_VERSION,
            $os:          isEssential ? 'hidden' : _cachedOsVersion,
            ...properties
        }
    });

    await _saveQueue();
    _flushQueue().catch(() => {});
}

// ============================================================
// GA4 — REALTIME ACTIVE USERS
// ============================================================

/**
 * Fetch the user's country once (best-effort), then fire the initial
 * app_open event and start the heartbeat loop.
 */
function _fetchCountryThenPing() {
    const req = https.get('https://api.country.is', (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
            try { _ga4UserCountry = JSON.parse(raw).country || 'Unknown'; }
            catch { _ga4UserCountry = 'Unknown'; }
            _ga4SendEvent('app_open');
            _startGa4Heartbeat();
        });
    });
    req.on('error', () => {
        // Country fetch failed — fire ping anyway
        _ga4SendEvent('app_open');
        _startGa4Heartbeat();
    });
    req.end();
}

/**
 * Send `user_engagement` every GA4_HEARTBEAT_MS so the user stays
 * inside GA4's 5-minute sliding realtime window until the app closes.
 */
function _startGa4Heartbeat() {
    if (_ga4HeartbeatTimer) return;
    _ga4HeartbeatTimer = setInterval(() => {
        _ga4SendEvent('user_engagement');
    }, GA4_HEARTBEAT_MS);
    // Allow Node to exit cleanly even when timer is active
    if (_ga4HeartbeatTimer.unref) _ga4HeartbeatTimer.unref();
}

/**
 * Low-level GA4 Measurement Protocol POST. Fire-and-forget.
 */
function _ga4SendEvent(eventName, extraParams = {}) {
    if (!_installationId || !_ga4SessionId) return;

    const safeEventName = eventName === 'app_open' ? 'launcher_open' : eventName;

    const payload = JSON.stringify({
        client_id: _installationId,
        events: [{
            name:   safeEventName,
            params: {
                session_id:           _ga4SessionId,
                session_engaged:      1,                 
                engagement_time_msec: GA4_HEARTBEAT_MS,   
                user_country:         _ga4UserCountry,
                app_version:          APP_VERSION,
                ...extraParams
            }
        }]
    });

    const body = Buffer.from(payload, 'utf8');

    const req = https.request({
        hostname: 'www.google-analytics.com',
        port:     443,
        path:     `/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
        method:   'POST',
        headers:  {
            'Content-Type':   'application/json',
            'Content-Length': body.byteLength
        }
    });
    req.on('error', () => {}); // fire-and-forget
    req.write(body);
    req.end();
}

// ============================================================
// CONSENT
// ============================================================
async function grantConsent() {
    _consentGiven = true;
    await _saveConsent(true);
    await _send('opted_in', {});
}

async function revokeConsent() {
    _consentGiven = false;
    await _saveConsent(false);
}

async function _saveConsent(value) {
    try {
        await fs.writeFile(
            path.join(_dataDir, 'analytics_consent.txt'),
            String(value),
            'utf8'
        );
    } catch { /* non-fatal */ }
}

function isConsentGiven() { return _consentGiven; }

// ============================================================
// PUBLIC EVENTS — PostHog behavioural tracking
// ============================================================
async function logAppLaunched({ platformsConnected = [], accountCounts = {}, librarySize = 0, collectionsCount = 0 } = {}) {
    await _send('app_launched', {
        platforms_connected:  platformsConnected,
        accounts_count:       accountCounts,
        library_size_bucket:  _bucketCount(librarySize),
        collections_count:    collectionsCount
    });
}

async function logGameLaunched(platform, source = 'library') {
    await _send('game_launched', { platform, source });
}

async function logSessionEnded(platform, durationMins) {
    await _send('game_session_ended', {
        platform,
        duration_bucket: _bucketMinutes(durationMins)
    });
}

async function logAccountSwitched(platform)           { await _send('account_switched',              { platform }); }
async function logAccountAdded(platform)              { await _send('account_added',                 { platform }); }
async function logAddAccountClicked(platform)         { await _send('add_account_clicked',           { platform }); }
async function logAccountDeleted(platform)            { await _send('account_deleted',               { platform }); }
async function logGameRemoved(platform)               { await _send('game_removed',                  { platform }); }
async function logGameAddedManual()                   { await _send('game_added_manual',             {}); }
async function logGameRestored(count)                 { await _send('game_restored',                 { count }); }
async function logGameDeletedForever()                { await _send('game_deleted_forever',          {}); }
async function logCollectionCreated(isFav = false)    { await _send('collection_created',            { is_system: isFav }); }
async function logGameAddedToCollection(isFav = false)      { await _send('game_added_to_collection',      { is_favorite: isFav }); }
async function logGameRemovedFromCollection(isFav = false)  { await _send('game_removed_from_collection',  { is_favorite: isFav }); }
async function logGameSpinClicked(isCustomPool = false)     { await _send('game_spin_clicked',             { custom_pool: isCustomPool }); }
async function logHudSensorToggled(isEnabled)         { await _send('hud_sensor_toggled',            { enabled: isEnabled }); }
async function logGameImageChanged(type, isReset = false)   { await _send('game_image_changed',       { image_type: type, is_reset: isReset }); }
async function logFeedbackSent()                      { await _send('feedback_sent',                 {}); }

async function logLibraryScanned(gamesFound, platforms = []) {
    await _send('library_scanned', {
        games_count_bucket: _bucketCount(gamesFound),
        platforms_detected: platforms
    });
}

// ============================================================
// HELPERS
// ============================================================
function _bucketMinutes(mins) {
    if (mins <   5) return '<5m';
    if (mins <  15) return '5-15m';
    if (mins <  30) return '15-30m';
    if (mins <  60) return '30-60m';
    if (mins < 120) return '1-2h';
    if (mins < 300) return '2-5h';
    return '5h+';
}

function _bucketCount(n) {
    if (n ===  0) return '0';
    if (n <    5) return '1-5';
    if (n <   10) return '5-10';
    if (n <   25) return '10-25';
    if (n <   50) return '25-50';
    if (n <  100) return '50-100';
    return '100+';
}

function _osVersion() {
    const { execSync } = require('child_process');
    try {
        const build = execSync(
            'powershell -NoProfile -Command "(Get-WmiObject Win32_OperatingSystem).BuildNumber"',
            { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }
        ).toString().trim();
        const num = parseInt(build, 10);
        if (num >= 22000) return 'win11';
        if (num >= 10240) return 'win10';
        return 'win_other';
    } catch {
        return 'unknown';
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    init,
    grantConsent, revokeConsent, isConsentGiven,
    logAppLaunched, logGameLaunched, logSessionEnded,
    logAccountSwitched, logAccountAdded, logAddAccountClicked, logAccountDeleted,
    logLibraryScanned, logCollectionCreated,
    logGameAddedToCollection, logGameRemovedFromCollection,
    logGameRemoved, logGameSpinClicked, logHudSensorToggled,
    logGameAddedManual, logGameRestored, logGameDeletedForever,
    logGameImageChanged, logFeedbackSent
};
