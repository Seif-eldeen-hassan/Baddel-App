'use strict';

const fs = require('fs');
const safeLauncher = require('./safeLauncher');

function launcherDisplayName(platform) {
    return platform === 'gog' ? 'GOG Galaxy' : 'Launcher';
}

function openError(platform, code, message, cause) {
    const error = new Error(message);
    error.code = code;
    error.platform = platform;
    if (cause) error.cause = cause;
    return error;
}

async function launchResolvedLauncher(platform, spec, options = {}) {
    const exists = options.exists || (candidate => {
        try { return fs.statSync(candidate).isFile(); } catch { return false; }
    });
    const launchExecutable = options.launchExecutable || safeLauncher.launchExecutable;
    const log = options.log || console;
    const source = String(spec?.source || 'unknown');
    const prefix = platform === 'gog' ? '[GOG_OPEN]' : '[LAUNCHER_OPEN]';
    const diagnostic = (values) => log.info?.(`${prefix} ${Object.entries(values).map(([key, value]) => `${key}=${value}`).join(' ')}`);

    diagnostic({ requested: true, candidateSource: source, candidateFound: Boolean(spec?.exePath), candidateExists: Boolean(spec?.exePath && exists(spec.exePath)), launchAttempted: false });
    if (!spec?.exePath || !exists(spec.exePath)) {
        diagnostic({ launchResult: 'failure', failureCode: 'LAUNCHER_NOT_FOUND' });
        throw openError(platform, 'LAUNCHER_NOT_FOUND', `${launcherDisplayName(platform)} could not be found.`);
    }

    diagnostic({ launchAttempted: true, candidateSource: source });
    let result;
    try {
        result = await launchExecutable(spec.exePath, Array.isArray(spec.args) ? spec.args : [], { requireSpawnConfirmation: true });
    } catch (error) {
        diagnostic({ launchResult: 'failure', failureCode: 'LAUNCH_FAILED' });
        throw openError(platform, 'LAUNCH_FAILED', `${launcherDisplayName(platform)} could not be opened.`, error);
    }
    if (!result?.ok) {
        diagnostic({ launchResult: 'failure', failureCode: 'LAUNCH_FAILED' });
        throw openError(platform, 'LAUNCH_FAILED', `${launcherDisplayName(platform)} could not be opened.`, result?.error);
    }
    diagnostic({ launchResult: 'success', failureCode: 'none', candidateSource: source });
    return { ok: true, method: 'executable', source };
}

module.exports = { launchResolvedLauncher };
