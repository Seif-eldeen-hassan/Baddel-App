'use strict';

// ============================================================
// BADDEL LAUNCHER — ANALYTICS
// PostHog  → behavioural events + install confirmed event
// GA4 MP   → optional key events when BADDEL_GA4_API_SECRET is set
// Both use the same persistent installation_id as the user key.
// ============================================================

const https        = require('https');
const crypto       = require('crypto');
const path         = require('path');
const fs           = require('fs').promises;
const os           = require('os');
const { app }      = require('electron');

// PostHog API key is intentionally public (client-side key, not a secret).
const POSTHOG_API_KEY = 'phc_EzwXItVGlqejfHnNielT331MwH6NlO3jZFU80ipU5yO';
const POSTHOG_HOST    = 'us.i.posthog.com';

const GA4_MEASUREMENT_ID = process.env.BADDEL_GA4_MEASUREMENT_ID || 'G-CF8GJT58TP';
// GA4 API secret must be injected via env var — never hard-code in source.
const GA4_API_SECRET = process.env.BADDEL_GA4_API_SECRET || '';
const GA4_HOST       = 'www.google-analytics.com';

const APP_VERSION = app.getVersion?.() || '0.0.0';

// ---- Module state ----
let _installationId  = null;
let _consentGiven    = false;
let _dataDir         = null;
let _eventQueue      = [];
let _isFlushing      = false;
let _cachedOsVersion = 'unknown';

// ============================================================
// INIT
// ============================================================
async function init() {
    _dataDir = path.join(app.getPath('userData'), 'BaddelLauncher');

    _cachedOsVersion = _osVersion();

    // If the ID file is missing this is the first launch after install.
    let isFirstOpenAfterInstall = false;

    const idFile = path.join(_dataDir, 'installation_id.txt');

    try {
        _installationId = (await fs.readFile(idFile, 'utf8')).trim();
    } catch {
        isFirstOpenAfterInstall = true;

        _installationId = crypto.randomUUID();

        try {
            await fs.mkdir(_dataDir, { recursive: true });
            await fs.writeFile(idFile, _installationId, 'utf8');
        } catch {
            // non-fatal
        }
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

    console.log(
        `[Analytics] Ready. ID: ${_installationId?.slice(0, 8)}… consent: ${_consentGiven} firstOpen: ${isFirstOpenAfterInstall}`
    );

    // Essential ping - no consent required
    await _send(
        'launcher_ping',
        {
            status: 'alive',
            first_open_after_install: isFirstOpenAfterInstall,
            app_version: APP_VERSION,
        },
        true,
        true
    );

    // Sent exactly once per machine, on the first launch after install.
    if (isFirstOpenAfterInstall) {
        await _send(
            'baddel_install_confirmed',
            {
                install_confirmed: true,
                first_open_after_install: true,
                app_version: APP_VERSION,
            },
            true,
            true
        );
    }
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
    } catch {
        // non-fatal
    }
}

async function _sendToPostHog(batch) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            api_key: POSTHOG_API_KEY,
            batch: batch.map(ev => ({
                event: ev.event,
                properties: {
                    ...ev.properties,
                    distinct_id: ev.properties.distinct_id,
                    $lib: 'Baddel-Launcher-Electron'
                },
                timestamp: new Date(ev.properties.time * 1000).toISOString()
            }))
        });

        const bodyBuf = Buffer.from(postData, 'utf8');

        const req = https.request(
            {
                hostname: POSTHOG_HOST,
                port: 443,
                path: '/batch/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': bodyBuf.byteLength
                }
            },
            (res) => {
                let body = '';

                res.on('data', chunk => {
                    body += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`PostHog ${res.statusCode}: ${body}`));
                    }
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

        if (_eventQueue.length > 0) {
            setTimeout(_flushQueue, 2000);
        }
    } catch (err) {
        console.warn('[PostHog] Flush failed:', err.message);
    }

    _isFlushing = false;
}

// ============================================================
// GA4 MEASUREMENT PROTOCOL
// ============================================================
async function _sendToGA4(eventName, properties = {}) {
    if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET || !_installationId) return;

    const payload = JSON.stringify({
        client_id: _installationId,
        non_personalized_ads: true,
        events: [
            {
                name: eventName,
                params: {
                    app_name: 'Baddel',
                    app_version: APP_VERSION,
                    os_bucket: _cachedOsVersion,
                    engagement_time_msec: 1,
                    ...properties
                }
            }
        ]
    });

    const bodyBuf = Buffer.from(payload, 'utf8');

    const requestPath =
        `/mp/collect?measurement_id=${encodeURIComponent(GA4_MEASUREMENT_ID)}` +
        `&api_secret=${encodeURIComponent(GA4_API_SECRET)}`;

    return new Promise((resolve) => {
        const req = https.request(
            {
                hostname: GA4_HOST,
                port: 443,
                path: requestPath,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': bodyBuf.byteLength
                }
            },
            (res) => {
                res.resume();

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log(`[GA4] Sent event: ${eventName}`);
                    } else {
                        console.warn(`[GA4] Failed event ${eventName}: ${res.statusCode}`);
                    }

                    resolve();
                });
            }
        );

        req.on('error', (err) => {
            console.warn(`[GA4] Error sending ${eventName}:`, err.message);
            resolve();
        });

        req.write(bodyBuf);
        req.end();
    });
}

// ============================================================
// CORE SEND
// ============================================================
// isEssential:
// - true  = event allowed without consent
// - false = event requires consent
//
// alsoSendToGA4:
// - true  = try sending to GA4 MP as well
// - false = PostHog only
// ============================================================
async function _send(eventName, properties = {}, isEssential = false, alsoSendToGA4 = false) {
    if (!_installationId) return;
    if (!_consentGiven && !isEssential) return;

    const eventPayload = {
        event: eventName,
        properties: {
            distinct_id: _installationId,
            time: Math.floor(Date.now() / 1000),
            $app_version: APP_VERSION,
            $os: isEssential ? 'hidden' : _cachedOsVersion,
            ...properties
        }
    };

    // PostHog queue
    _eventQueue.push(eventPayload);

    await _saveQueue();
    _flushQueue().catch(() => {});

    // Optional GA4 MP
    if (alsoSendToGA4) {
        _sendToGA4(eventName, {
            ...properties,
            consent_required: !isEssential
        }).catch(() => {});
    }
}

// ============================================================
// CONSENT
// ============================================================
async function grantConsent() {
    _consentGiven = true;
    await _saveConsent(true);
    await updateUninstallTelemetryConsent(true);

    await _send('opted_in', {}, false, true);
}

async function revokeConsent() {
    _consentGiven = false;
    await _saveConsent(false);
    await updateUninstallTelemetryConsent(false);
}

async function _saveConsent(value) {
    try {
        await fs.writeFile(
            path.join(_dataDir, 'analytics_consent.txt'),
            String(value),
            'utf8'
        );
    } catch {
        // non-fatal
    }
}

function isConsentGiven() {
    return _consentGiven;
}

// ============================================================
// PUBLIC EVENTS — PostHog behavioural tracking
// ============================================================
async function logAppLaunched({
    platformsConnected = [],
    accountCounts = {},
    librarySize = 0,
    collectionsCount = 0
} = {}) {
    await _send('app_launched', {
        platforms_connected: platformsConnected,
        accounts_count: accountCounts,
        library_size_bucket: _bucketCount(librarySize),
        collections_count: collectionsCount
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

async function logAccountSwitched(platform) {
    await _send('account_switched', { platform });
}

async function logAccountAdded(platform) {
    await _send('account_added', { platform });
}

async function logAddAccountClicked(platform) {
    await _send('add_account_clicked', { platform });
}

async function logAccountDeleted(platform) {
    await _send('account_deleted', { platform });
}

async function logGameRemoved(platform) {
    await _send('game_removed', { platform });
}

async function logGameAddedManual() {
    await _send('game_added_manual', {});
}

async function logGameRestored(count) {
    await _send('game_restored', { count });
}

async function logGameDeletedForever() {
    await _send('game_deleted_forever', {});
}

async function logCollectionCreated(isFav = false) {
    await _send('collection_created', { is_system: isFav });
}

async function logGameAddedToCollection(isFav = false) {
    await _send('game_added_to_collection', { is_favorite: isFav });
}

async function logGameRemovedFromCollection(isFav = false) {
    await _send('game_removed_from_collection', { is_favorite: isFav });
}

async function logGameSpinClicked(isCustomPool = false) {
    await _send('game_spin_clicked', { custom_pool: isCustomPool });
}

async function logHudSensorToggled(isEnabled) {
    await _send('hud_sensor_toggled', { enabled: isEnabled });
}

async function logGameImageChanged(type, isReset = false) {
    await _send('game_image_changed', {
        image_type: type,
        is_reset: isReset
    });
}

async function logFeedbackSent() {
    await _send('feedback_sent', {});
}

// ---- Platform Sync Events ----

/**
 * Fired when an account is successfully linked.
 */
async function logPlatformLinked(platform) {
    await _send('platform_linked', { platform });
}

/**
 * Fired when an account is unlinked/removed.
 */
async function logPlatformUnlinked(platform) {
    await _send('platform_unlinked', { platform });
}

/**
 * Fired when a library sync completes successfully.
 * @param {string} platform
 * @param {number} totalGames
 * @param {number} accountsSynced
 */
async function logSyncCompleted(platform, totalGames, accountsSynced) {
    await _send('platform_sync_completed', {
        platform,
        total_games_bucket: _bucketCount(totalGames),
        accounts_synced: accountsSynced,
    });
}

/**
 * Fired when a library sync fails entirely.
 * @param {string} platform
 * @param {string} reason
 */
async function logSyncFailed(platform, reason = '') {
    await _send('platform_sync_failed', {
        platform,
        reason: String(reason).slice(0, 120),
    });
}

/**
 * Fired on app startup when auto-sync kicks off.
 * @param {string[]} platforms
 */
async function logAutoSyncStarted(platforms = []) {
    await _send('auto_sync_started', { platforms });
}

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
    if (mins < 5) return '<5m';
    if (mins < 15) return '5-15m';
    if (mins < 30) return '15-30m';
    if (mins < 60) return '30-60m';
    if (mins < 120) return '1-2h';
    if (mins < 300) return '2-5h';
    return '5h+';
}

function _bucketCount(n) {
    if (n === 0) return '0';
    if (n < 5) return '1-5';
    if (n < 10) return '5-10';
    if (n < 25) return '10-25';
    if (n < 50) return '25-50';
    if (n < 100) return '50-100';
    return '100+';
}

function _osVersion() {
    try {
        const release = typeof process.getSystemVersion === 'function'
            ? process.getSystemVersion()
            : os.release();
        const parts = String(release || '').split('.');
        const num = parseInt(parts[2] || parts[0] || '0', 10);

        if (num >= 22000) return 'win11';
        if (num >= 10240) return 'win10';

        return 'win_other';
    } catch {
        return 'unknown';
    }
}

// ============================================================
// UNINSTALL TELEMETRY
// ============================================================

// Writes userData/uninstall-telemetry.json so the NSIS uninstaller can read
// installId and consent state without Node.js at uninstall time.
async function writeUninstallTelemetryConfig() {
    if (!_dataDir || !_installationId) return;
    try {
        const config = {
            installId:    _installationId,
            consentGiven: _consentGiven,
            appVersion:   APP_VERSION,
            updatedAt:    new Date().toISOString(),
        };
        await fs.writeFile(
            path.join(path.dirname(_dataDir), 'uninstall-telemetry.json'),
            JSON.stringify(config),
            'utf8'
        );
    } catch (err) {
        console.warn('[Analytics] writeUninstallTelemetryConfig failed (non-fatal):', err.message);
    }
}

// Keeps consent in uninstall-telemetry.json in sync when the user grants or
// revokes consent.  Always writes the full record so the file never lacks
// installId even if called before writeUninstallTelemetryConfig resolves.
async function updateUninstallTelemetryConsent(consent) {
    if (!_dataDir || !_installationId) return;
    try {
        const config = {
            installId:    _installationId,
            consentGiven: consent,
            appVersion:   APP_VERSION,
            updatedAt:    new Date().toISOString(),
        };
        await fs.writeFile(
            path.join(path.dirname(_dataDir), 'uninstall-telemetry.json'),
            JSON.stringify(config),
            'utf8'
        );
    } catch (err) {
        console.warn('[Analytics] updateUninstallTelemetryConsent failed (non-fatal):', err.message);
    }
}

// ============================================================
// HEARTBEAT
// ============================================================

let _heartbeatInterval = null; // stored so startHeartbeat() is idempotent

// Sends app_heartbeat at most once per 24 hours when consent is given.
// Persists last-sent timestamp in userData/analytics-heartbeat.json.
async function logHeartbeat() {
    if (!_consentGiven || !_dataDir) return;
    try {
        const heartbeatFile = path.join(path.dirname(_dataDir), 'analytics-heartbeat.json');
        let lastSent = 0;
        try {
            const data = JSON.parse(await fs.readFile(heartbeatFile, 'utf8'));
            lastSent = data.lastSent || 0;
        } catch {
            // no prior record — send immediately
        }
        if (Date.now() - lastSent < 24 * 60 * 60 * 1000) return;
        await _send('app_heartbeat', { app_version: APP_VERSION }, false);
        await fs.writeFile(heartbeatFile, JSON.stringify({ lastSent: Date.now() }), 'utf8');
    } catch (err) {
        console.warn('[Analytics] logHeartbeat failed (non-fatal):', err.message);
    }
}

// Fires logHeartbeat once at startup and every hour for long-running sessions.
// Idempotent — safe to call multiple times; only one interval is ever active.
function startHeartbeat() {
    if (_heartbeatInterval) return;
    logHeartbeat().catch(() => {});
    _heartbeatInterval = setInterval(() => logHeartbeat().catch(() => {}), 60 * 60 * 1000);
}

// Clears the heartbeat interval (call from app before-quit).
function stopHeartbeat() {
    if (_heartbeatInterval) {
        clearInterval(_heartbeatInterval);
        _heartbeatInterval = null;
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    init,

    grantConsent,
    revokeConsent,
    isConsentGiven,

    logAppLaunched,
    logGameLaunched,
    logSessionEnded,

    logAccountSwitched,
    logAccountAdded,
    logAddAccountClicked,
    logAccountDeleted,

    logLibraryScanned,
    logCollectionCreated,

    logGameAddedToCollection,
    logGameRemovedFromCollection,

    logGameRemoved,
    logGameSpinClicked,
    logHudSensorToggled,

    logGameAddedManual,
    logGameRestored,
    logGameDeletedForever,

    logGameImageChanged,
    logFeedbackSent,

    // Platform sync
    logPlatformLinked,
    logPlatformUnlinked,
    logSyncCompleted,
    logSyncFailed,
    logAutoSyncStarted,

    // Uninstall telemetry
    writeUninstallTelemetryConfig,
    updateUninstallTelemetryConsent,

    // Heartbeat
    startHeartbeat,
    stopHeartbeat,
};
