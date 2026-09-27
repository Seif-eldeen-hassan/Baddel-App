'use strict';

function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function nullableString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validateDownloadCompletion(task = {}, receipt = {}) {
    if (!receipt || typeof receipt !== 'object') {
        throw makeDownloadError('DOWNLOAD_COMPLETION_UNCONFIRMED', 'The download ended before Baddel could confirm completion.');
    }
    if (!receipt.provider || !['gog', 'epic'].includes(String(receipt.provider).toLowerCase())) {
        throw makeDownloadError('DOWNLOAD_COMPLETION_UNCONFIRMED', 'The provider did not return a valid completion receipt.');
    }
    if (receipt.processExitCode !== 0) {
        throw makeDownloadError('DOWNLOAD_PROCESS_FAILED', 'The provider process did not exit successfully.');
    }
    if (receipt.completionConfirmed !== true) {
        throw makeDownloadError(receipt.diagnosticCode || 'DOWNLOAD_COMPLETION_UNCONFIRMED', 'The provider did not confirm the download completed.');
    }
    const transfer = receipt.transfer || {};
    const downloadedBytes = finiteNumber(transfer.downloadedBytes);
    const totalBytes = finiteNumber(transfer.totalBytes);
    if (downloadedBytes == null || totalBytes == null || totalBytes <= 0) {
        throw makeDownloadError('DOWNLOAD_INCOMPLETE_TRANSFER', 'Baddel could not confirm the final downloaded size.');
    }
    if (downloadedBytes > totalBytes) {
        throw makeDownloadError('DOWNLOAD_EXPECTED_SIZE_MISMATCH', 'The provider reported an impossible downloaded size.');
    }
    if (downloadedBytes < totalBytes) {
        throw makeDownloadError('DOWNLOAD_INCOMPLETE_TRANSFER', 'The provider stopped before the full game was downloaded.');
    }
    const verification = receipt.verification || {};
    if (verification.status !== 'passed') {
        throw makeDownloadError(receipt.diagnosticCode || 'DOWNLOAD_VERIFICATION_FAILED', 'Baddel could not verify the downloaded installation.');
    }
    if (verification.actualBytes != null && Number(verification.actualBytes) <= 0) {
        throw makeDownloadError('DOWNLOAD_INSTALLATION_EMPTY', 'The install folder does not contain a completed game installation.');
    }
    return {
        provider: String(receipt.provider).toLowerCase(),
        processExitCode: receipt.processExitCode,
        completionConfirmed: true,
        transfer: {
            downloadedBytes,
            totalBytes,
            source: transfer.source || 'provider-receipt',
        },
        verification: {
            status: 'passed',
            method: verification.method || 'provider-verification',
            expectedFileCount: nullableNumber(verification.expectedFileCount),
            verifiedFileCount: nullableNumber(verification.verifiedFileCount),
            expectedBytes: nullableNumber(verification.expectedBytes),
            actualBytes: nullableNumber(verification.actualBytes),
            executableFound: nullableBoolean(verification.executableFound),
            executablePath: nullableString(verification.executablePath),
            manifestFound: nullableBoolean(verification.manifestFound),
        },
        buildId: nullableString(receipt.buildId),
        diagnosticCode: receipt.diagnosticCode || null,
        completedAt: receipt.completedAt || new Date().toISOString(),
    };
}

function makeDownloadError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
}

function isAuthoritativeDownloadTransferSource(source) {
    return ['gogdl-overall-progress', 'legendary-runtime-transfer', 'legendary-completion-transfer', 'legendary-info-manifest', 'gog-public-windows-manifest', 'gogdl-info'].includes(String(source || ''));
}

function makeCompletionPatch(receipt = {}, task = {}) {
    const transfer = receipt.transfer || {};
    const verification = receipt.verification || {};
    const resumedSessionRelative = Number(task.resumeBaseDownloadedBytes) > 0 &&
        (task.downloadedBytesSource === 'resume-base-plus-session' || task.progressMode === 'session-relative');
    const displayedDownloadedBytes = resumedSessionRelative
        ? Math.max(Number(transfer.downloadedBytes) || 0, Number(task.downloadedBytes) || 0, Number(task.checkpointDownloadedBytes) || 0)
        : transfer.downloadedBytes;
    const displayedTotalBytes = resumedSessionRelative
        ? Math.max(Number(transfer.totalBytes) || 0, Number(task.totalBytes) || 0, Number(task.checkpointTotalBytes) || 0, displayedDownloadedBytes)
        : transfer.totalBytes;
    const diskBasedTransfer = /filesystem|verified-disk|installed/i.test(String(transfer.source || ''));
    const authoritativeTransfer = receipt.provider === 'epic'
        ? !diskBasedTransfer
        : isAuthoritativeDownloadTransferSource(transfer.source);
    const taskDownloadIsAuthoritative = receipt.provider !== 'gog' || isAuthoritativeDownloadTransferSource(task.downloadSizeSource || task.sizeSource);
    const existingDownload = taskDownloadIsAuthoritative && task.downloadSizeBytes > 0 ? task.downloadSizeBytes : null;
    const completionSizes = ['epic', 'gog'].includes(receipt.provider) ? {
        downloadSizeBytes: existingDownload || (authoritativeTransfer ? transfer.totalBytes : null),
        downloadSizeSource: existingDownload ? task.downloadSizeSource : authoritativeTransfer ? (receipt.provider === 'epic' ? transfer.source || 'legendary-completion-transfer' : transfer.source) : null,
        installedDiskSizeBytes: verification.actualBytes > 0 ? verification.actualBytes : task.installedDiskSizeBytes,
        installedSizeSource: verification.actualBytes > 0 ? 'verified-filesystem' : task.installedSizeSource,
        buildVersion: receipt.buildId || task.buildVersion || null,
    } : {};
    return {
        ...completionSizes,
        providerCompletionReceipt: receipt,
        completionConfirmed: true,
        verificationStatus: verification.status || null,
        verificationMethod: verification.method || null,
        verificationExpectedFileCount: verification.expectedFileCount ?? null,
        verificationVerifiedFileCount: verification.verifiedFileCount ?? null,
        verificationExpectedBytes: verification.expectedBytes ?? null,
        verificationActualBytes: verification.actualBytes ?? null,
        verificationExecutableFound: verification.executableFound ?? null,
        verificationExecutablePath: verification.executablePath ?? null,
        resolvedExecutablePath: verification.executablePath ?? null,
        verificationManifestFound: verification.manifestFound ?? null,
        downloadedBytes: displayedDownloadedBytes,
        totalBytes: displayedTotalBytes,
        transferDownloadedBytes: displayedDownloadedBytes,
        transferTotalBytes: displayedTotalBytes,
        progressPercent: 100,
        progressSource: transfer.source || 'provider-receipt',
        totalBytesSource: transfer.source || 'provider-receipt',
        downloadedBytesSource: transfer.source || 'provider-receipt',
    };
}

function nullableNumber(value) {
    const n = finiteNumber(value);
    return n == null ? null : n;
}

function nullableBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}

module.exports = {
    makeCompletionPatch,
    validateDownloadCompletion,
};
