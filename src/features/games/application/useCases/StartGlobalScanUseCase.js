'use strict';

/**
 * Orchestrates a full global game scan across all platforms.
 *
 * All side-effecting operations are injected so this function has no
 * infrastructure or legacy-class imports (boundary: application → domain only).
 *
 * @param {object}   params
 * @param {Function} params.runPlatformScans       - async (scannedPlatforms: Set) => official[]
 * @param {Function} params.buildDetectionMap      - (official, scanStartedAt) => { detectedGames, detectedKeys }
 * @param {Function} params.upsertDetectedGames    - async (detectedGames) => void
 * @param {Function} params.applyStalePass         - (scannedPlatforms, detectedKeys, scanStartedAt) => totalStaleRemoved
 * @param {Function} params.buildScanDiagnostics   - (args) => diagnosticsReport
 * @param {Function} params.writeScanDiagnostics   - async (report) => void
 * @param {Function} params.logScanSummary         - () => void
 * @param {Function} params.syncToMetadataServer   - (detectedGames) => void  (fire-and-forget)
 * @param {Function} params.flushDatabase          - async () => void
 * @param {Function} params.getStoredGames         - () => Game[]
 * @param {Function} params.resetReports           - () => void  (resets accumulator + updates _currentScanReports on engine)
 * @param {boolean}  params.skipMetadataServerSync
 * @returns {Promise<Game[]>}
 */
async function startGlobalScan({
    runPlatformScans,
    buildDetectionMap,
    upsertDetectedGames,
    applyStalePass,
    buildScanDiagnostics,
    writeScanDiagnostics,
    logScanSummary,
    syncToMetadataServer,
    flushDatabase,
    getStoredGames,
    resetReports,
    skipMetadataServerSync,
}) {
    const scanStartedAt = new Date().toISOString();
    const scanStartedMs = Date.now();

    resetReports();

    const scannedPlatforms = new Set();

    const official = await runPlatformScans(scannedPlatforms);
    const { detectedGames, detectedKeys } = buildDetectionMap(official, scanStartedAt);

    await upsertDetectedGames(detectedGames);

    const totalStaleRemoved = applyStalePass(scannedPlatforms, detectedKeys, scanStartedAt);

    await flushDatabase();

    await writeScanDiagnostics(
        buildScanDiagnostics({ scanStartedAt, scanStartedMs, official, detectedGames, totalStaleRemoved, scannedPlatforms })
    );

    logScanSummary();

    if (!skipMetadataServerSync) {
        syncToMetadataServer(detectedGames);
    }

    return getStoredGames();
}

module.exports = { startGlobalScan };
