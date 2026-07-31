'use strict';

const SPACE_PAIR_RE = /\(([-+]?\d+(?:\.\d+)?),\s*['"]([KMGT]i?B|[KMGT]B|bytes?)['"]\)\s+(\d+)/gi;
const SECRET_RE = /(access[_-]?token|refresh[_-]?token|authorization|auth[_-]?code|code|cookie|password|secret)(["'\s:=]+)([^"'\s,}]+)/gi;

function redactGogSecrets(value) {
    return String(value || '').replace(SECRET_RE, '$1$2[redacted]');
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function latestDiagnosticsText(diagnostics = []) {
    return (Array.isArray(diagnostics) ? diagnostics : [])
        .map(item => item?.line || '')
        .filter(Boolean)
        .join('\n');
}

function parseGogSizeEvidence(text) {
    const sizes = [];
    const raw = String(text || '');
    let match;
    while ((match = SPACE_PAIR_RE.exec(raw)) !== null) {
        const bytes = Number(match[3]);
        if (Number.isFinite(bytes) && bytes > 0) sizes.push(bytes);
    }
    return {
        allBytes: sizes,
        downloadBytes: sizes[0] || null,
        installedBytes: sizes.length ? Math.max(...sizes) : null,
    };
}

function formatBytes(bytes) {
    const value = toFiniteNumber(bytes);
    if (value === null || value <= 0) return null;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let scaled = value;
    let unit = 0;
    while (scaled >= 1024 && unit < units.length - 1) {
        scaled /= 1024;
        unit += 1;
    }
    const digits = scaled >= 10 || unit === 0 ? 0 : 1;
    return `${scaled.toFixed(digits)} ${units[unit]}`;
}

function deriveRequiredBytes({ task = {}, sizeEvidence = {} } = {}) {
    const values = [
        task.expectedInstalledBytes,
        task.installedDiskSizeBytes,
        task.expectedTotalBytes,
        task.totalBytes,
        task.requiredSpaceBytes,
        sizeEvidence.installedBytes,
        sizeEvidence.downloadBytes,
    ].map(toFiniteNumber).filter(value => value !== null && value > 0);
    return values.length ? Math.max(...values) : null;
}

function makeUserMessage(code, evidence = {}) {
    if (code === 'DOWNLOAD_INSUFFICIENT_DISK_SPACE') {
        const free = formatBytes(evidence.freeSpaceBytesAtFailure ?? evidence.freeSpaceBytesAtQueue);
        const required = formatBytes(evidence.requiredSpaceBytes);
        const missing = formatBytes(evidence.shortfallBytes);
        const drive = evidence.installDriveRoot ? `${evidence.installDriveRoot} ` : '';
        if (free && required && missing) {
            return `${drive}does not have enough free space. Required ${required}, available ${free}, missing ${missing}.`;
        }
        if (free && required) return `${drive}does not have enough free space. Required ${required}, available ${free}.`;
        return 'There is not enough free disk space for this download.';
    }
    if (code === 'GOG_AUTH_REQUIRED') return 'GOG authentication expired. Relink the GOG account and retry.';
    if (code === 'GOG_GAME_NOT_OWNED') return 'The selected GOG account does not own this game.';
    if (code === 'GOG_BUILD_NOT_AVAILABLE') return 'No downloadable Windows build was found for this GOG game.';
    if (code === 'GOG_MANIFEST_RESOLUTION_FAILED') return 'Baddel could not resolve the GOG download manifest. Retry or relink the account.';
    if (code === 'DOWNLOAD_INSTALL_PATH_NOT_WRITABLE') return 'Baddel cannot write to this install folder. Choose another folder or fix permissions.';
    if (code === 'DOWNLOAD_FILE_ACCESS_DENIED') return 'Baddel could not write the downloaded files. Close anything using the folder and retry.';
    if (code === 'GOG_NETWORK_ERROR') return 'The GOG download hit a network error. Retry when the connection is stable.';
    if (code === 'GOG_PROGRESS_FORMAT_UNRECOGNIZED') return 'GOG wrote files, but Baddel could not understand the progress output. Retry and keep the diagnostics.';
    if (code === 'GOG_DOWNLOAD_NO_PROGRESS') return 'GOG opened the download manager but stopped before transferring game data.';
    return 'The GOG download process failed. Open technical details for the captured diagnostics.';
}

function classifyFromText(text, { folderBefore = null, folderAfter = null } = {}) {
    const raw = String(text || '').toLowerCase();
    if (/not enough disk space|no space left on device|disk full|enospc|system error\s*112|there is not enough space/.test(raw)) {
        return { code: 'DOWNLOAD_INSUFFICIENT_DISK_SPACE', category: 'disk_space', retryable: false, rule: 'provider-disk-space-output' };
    }
    if (/unauthorized|forbidden|authentication failed|auth(?:entication)?\s+(?:expired|required|failed)|credentials/.test(raw)) {
        return { code: 'GOG_AUTH_REQUIRED', category: 'auth', retryable: false, rule: 'auth-output' };
    }
    if (/not owned|ownership|license|licence/.test(raw)) {
        return { code: 'GOG_GAME_NOT_OWNED', category: 'ownership', retryable: false, rule: 'ownership-output' };
    }
    if (/network|timeout|connection|temporar|econnreset|etimedout/.test(raw)) {
        return { code: 'GOG_NETWORK_ERROR', category: 'network', retryable: true, rule: 'network-output' };
    }
    if (/access is denied|permission denied|eacces|eperm/.test(raw)) {
        return { code: 'DOWNLOAD_FILE_ACCESS_DENIED', category: 'filesystem', retryable: true, rule: 'filesystem-access-output' };
    }
    if (/no compatible (windows )?(build|manifest)s?|windows build (was )?not found|build resolution failed|no builds? found/.test(raw)) {
        return { code: 'GOG_BUILD_NOT_AVAILABLE', category: 'build', retryable: true, rule: 'build-output' };
    }
    if (/does(?:n't| not) support content system api|content system generation (?:is )?unsupported|manifest (?:or )?build data unavailable|manifest resolution failed|no manifest|repository/.test(raw)) {
        return { code: 'GOG_MANIFEST_RESOLUTION_FAILED', category: 'manifest', retryable: true, rule: 'manifest-output' };
    }
    if ((folderAfter?.actualBytes || 0) > (folderBefore?.actualBytes || 0)) {
        return { code: 'GOG_PROGRESS_FORMAT_UNRECOGNIZED', category: 'progress', retryable: true, rule: 'folder-growth-without-authoritative-progress' };
    }
    if (/\[generic_download_manager\]\s+info:/.test(raw) && !/\berror\b|\bfailed\b|traceback|exception/.test(raw)) {
        return { code: 'GOG_DOWNLOAD_NO_PROGRESS', category: 'progress', retryable: true, rule: 'info-only-output' };
    }
    return { code: 'GOG_DOWNLOAD_PROCESS_FAILED', category: 'process', retryable: true, rule: 'fallback-process-failure' };
}

function diagnoseGogDownloadFailure({
    task = {},
    err = null,
    diagnostics = [],
    folderBefore = null,
    folderAfter = null,
    diskBefore = null,
    diskAfter = null,
    executionInfo = null,
    commandShape = null,
    runtimeVersion = null,
} = {}) {
    const diagnosticText = latestDiagnosticsText(diagnostics);
    const rawText = redactGogSecrets([
        err?.message || '',
        diagnosticText,
    ].filter(Boolean).join('\n'));
    const sizeEvidence = parseGogSizeEvidence(rawText);
    const requiredSpaceBytes = deriveRequiredBytes({ task, sizeEvidence });
    const freeSpaceBytesAtQueue = toFiniteNumber(task.freeSpaceBytesAtQueue);
    const freeSpaceBytesAtFailure = toFiniteNumber(diskAfter?.freeSpaceBytes ?? diskBefore?.freeSpaceBytes);
    const diskSafetyMarginBytes = toFiniteNumber(task.diskSafetyMarginBytes) || (
        requiredSpaceBytes ? Math.max(1024 * 1024 * 1024, Math.ceil(requiredSpaceBytes * 0.1)) : null
    );
    const classification = classifyFromText(rawText, { folderBefore, folderAfter });
    let code = classification.code;
    if (
        classification.code !== 'DOWNLOAD_INSUFFICIENT_DISK_SPACE' &&
        requiredSpaceBytes &&
        Number.isFinite(freeSpaceBytesAtFailure) &&
        freeSpaceBytesAtFailure < requiredSpaceBytes + (diskSafetyMarginBytes || 0)
    ) {
        code = 'DOWNLOAD_INSUFFICIENT_DISK_SPACE';
        classification.category = 'disk_space';
        classification.retryable = false;
        classification.rule = 'measured-free-space-below-required';
    }
    const available = Number.isFinite(freeSpaceBytesAtFailure) ? freeSpaceBytesAtFailure : freeSpaceBytesAtQueue;
    const shortfallBytes = requiredSpaceBytes && Number.isFinite(available)
        ? Math.max(0, requiredSpaceBytes + (diskSafetyMarginBytes || 0) - available)
        : null;
    const evidence = {
        classificationRule: classification.rule,
        processPid: executionInfo?.pid || task.processPid || null,
        processStartedAt: executionInfo?.processStartedAt || task.processStartedAt || null,
        firstProviderOutputAt: executionInfo?.firstOutputAt || task.firstProviderOutputAt || null,
        runtimeVersion: runtimeVersion || task.runtimeVersion || null,
        providerProductId: task.providerProductId || task.contentSystemProductId || task.gogdlAppName || null,
        verifiedBuildId: task.verifiedBuildId || null,
        verifiedBuildGeneration: task.verifiedBuildGeneration || null,
        installPath: task.installPath || null,
        installDriveRoot: task.installDriveRoot || null,
        expectedDownloadBytes: sizeEvidence.downloadBytes || toFiniteNumber(task.expectedTotalBytes) || toFiniteNumber(task.totalBytes),
        expectedInstalledBytes: sizeEvidence.installedBytes || toFiniteNumber(task.expectedInstalledBytes) || toFiniteNumber(task.installedDiskSizeBytes),
        requiredSpaceBytes,
        diskSafetyMarginBytes,
        freeSpaceBytesAtQueue,
        freeSpaceBytesAtFailure,
        shortfallBytes,
        folderBefore,
        folderAfter,
        commandShape,
        diagnosticTail: (Array.isArray(diagnostics) ? diagnostics : []).slice(-12),
    };
    return {
        version: 1,
        code,
        category: code === 'DOWNLOAD_INSUFFICIENT_DISK_SPACE' ? 'disk_space' : classification.category,
        retryable: code === 'DOWNLOAD_INSUFFICIENT_DISK_SPACE' ? false : classification.retryable,
        userMessage: makeUserMessage(code, evidence),
        suggestedAction: code === 'DOWNLOAD_INSUFFICIENT_DISK_SPACE'
            ? 'Free disk space or choose another drive, then retry.'
            : 'Retry the download or relink the GOG account if the problem continues.',
        technicalSummary: rawText.slice(0, 2000),
        evidence,
    };
}

module.exports = {
    diagnoseGogDownloadFailure,
    parseGogSizeEvidence,
    redactGogSecrets,
};
