'use strict';

const path = require('path');
const fs = require('fs');
const { DownloadFileSafetyService } = require('./DownloadFileSafetyService');

const SUPPORTED_DOWNLOAD_PLATFORMS = new Set(['gog', 'epic']);

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
        if (!SUPPORTED_DOWNLOAD_PLATFORMS.has(platform)) {
            throw makeDownloadError('DOWNLOAD_UNSUPPORTED_PLATFORM', 'This direct-download provider is not supported.');
        }
        const installProvider = String(payload.installProvider || (platform === 'gog' ? 'gogdl' : '')).trim().toLowerCase();
        if ((platform === 'gog' && installProvider !== 'gogdl') || (platform === 'epic' && installProvider !== 'legendary')) {
            throw makeDownloadError('DOWNLOAD_PROVIDER_UNAVAILABLE', 'This installation provider is not available.');
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
        const positiveSize = values => values.find(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ?? null;
        const expectedDownloadBytes = positiveSize([payload.downloadSizeBytes, payload.expectedDownloadBytes, payload.expectedTotalBytes, payload.totalBytes]);
        const expectedInstalledBytes = positiveSize([payload.installedDiskSizeBytes, payload.expectedInstalledBytes]);
        return {
            ...payload,
            ...preflight,
            platform,
            installProvider,
            expectedDownloadBytes,
            expectedInstalledBytes,
            expectedTotalBytes: expectedDownloadBytes,
            sizeStatus: Number.isFinite(Number(preflight.requiredSpaceBytes)) && Number(preflight.requiredSpaceBytes) > 0 ? 'resolved' : 'unknown',
            sizeReason: Number.isFinite(Number(preflight.requiredSpaceBytes)) && Number(preflight.requiredSpaceBytes) > 0 ? null : (payload.sizeReason || 'not-provided-before-queue'),
            sizeCheckedAt: payload.sizeCheckedAt || new Date().toISOString(),
            sizeResolutionStatus: Number.isFinite(Number(preflight.requiredSpaceBytes)) && Number(preflight.requiredSpaceBytes) > 0 ? 'resolved' : 'unresolved',
            sizeResolutionFailureReason: Number.isFinite(Number(preflight.requiredSpaceBytes)) && Number(preflight.requiredSpaceBytes) > 0 ? null : (payload.sizeReason || 'not-provided-before-queue'),
        };
    }
}

module.exports = {
    DownloadPreflightService,
    SUPPORTED_DOWNLOAD_PLATFORMS,
    makeDownloadError,
};
