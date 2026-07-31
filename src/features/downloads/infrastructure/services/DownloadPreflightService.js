'use strict';

const path = require('path');
const fs = require('fs');
const { DownloadFileSafetyService } = require('./DownloadFileSafetyService');

const SUPPORTED_DOWNLOAD_PLATFORMS = new Set(['gog']);

function makeDownloadError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
}

class DownloadPreflightService {
    constructor({ fsSync = fs, pathModule = path, fileSafety = null } = {}) {
        this.fs = fsSync;
        this.path = pathModule;
        this.fileSafety = fileSafety || new DownloadFileSafetyService({ fsSync, pathModule });
    }

    validateQueuePayload(payload = {}) {
        const platform = String(payload.platform || '').trim().toLowerCase();
        if (platform === 'epic') {
            throw makeDownloadError('EPIC_DIRECT_DOWNLOAD_NOT_AVAILABLE', 'Epic direct downloads are not available in this build.');
        }
        if (!SUPPORTED_DOWNLOAD_PLATFORMS.has(platform)) {
            throw makeDownloadError('DOWNLOAD_UNSUPPORTED_PLATFORM', 'Direct downloads are only available for GOG in this build.');
        }
        if (!String(payload.accountId || '').trim()) {
            throw makeDownloadError('DOWNLOAD_ACCOUNT_NOT_READY', 'Choose a linked account before adding this game to the queue.');
        }
        const gogIdentity = payload.gogIdentity && typeof payload.gogIdentity === 'object' ? payload.gogIdentity : {};
        if (!String(
            payload.gogdlAppName ||
            payload.contentSystemProductId ||
            payload.providerAppName ||
            payload.providerProductId ||
            gogIdentity.galaxyExternalId ||
            gogIdentity.gamesDbExternalId ||
            payload.canonicalGameId ||
            payload.gameId ||
            ''
        ).trim()) {
            throw makeDownloadError('DOWNLOAD_PROVIDER_ID_MISSING', 'This game is missing a provider install identity.');
        }
        const installPath = String(payload.installPath || '').trim();
        if (!installPath || !this.path.isAbsolute(installPath)) {
            throw makeDownloadError('DOWNLOAD_INVALID_INSTALL_PATH', 'Choose a full installation path.');
        }
        const preflight = this.fileSafety.inspectInstallPath({ ...payload, platform, installPath });
        const expectedDownloadBytes = Number.isFinite(Number(payload.expectedDownloadBytes || payload.expectedTotalBytes || payload.totalBytes || payload.downloadSizeBytes))
            ? Number(payload.expectedDownloadBytes || payload.expectedTotalBytes || payload.totalBytes || payload.downloadSizeBytes)
            : null;
        const expectedInstalledBytes = Number.isFinite(Number(payload.expectedInstalledBytes || payload.installedDiskSizeBytes))
            ? Number(payload.expectedInstalledBytes || payload.installedDiskSizeBytes)
            : null;
        return {
            ...payload,
            ...preflight,
            platform,
            expectedDownloadBytes,
            expectedInstalledBytes,
            expectedTotalBytes: expectedDownloadBytes,
            sizeResolutionStatus: Number.isFinite(Number(preflight.requiredSpaceBytes)) && Number(preflight.requiredSpaceBytes) > 0 ? 'resolved' : 'unresolved',
            sizeResolutionFailureReason: Number.isFinite(Number(preflight.requiredSpaceBytes)) && Number(preflight.requiredSpaceBytes) > 0 ? null : 'not-provided-before-queue',
        };
    }
}

module.exports = {
    DownloadPreflightService,
    SUPPORTED_DOWNLOAD_PLATFORMS,
    makeDownloadError,
};
