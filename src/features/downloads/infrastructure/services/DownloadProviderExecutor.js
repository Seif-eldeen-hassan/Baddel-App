'use strict';

const { makeDownloadError } = require('./DownloadPreflightService');

class DownloadProviderExecutor {
    constructor({ providers = [] } = {}) {
        this.providers = providers;
    }

    findProvider(task) {
        return this.providers.find(provider => provider?.supports?.(task));
    }

    async start(task, options = {}) {
        const provider = this.findProvider(task);
        if (!provider) {
            const platform = String(task?.platform || '').toLowerCase();
            const code = platform === 'epic' ? 'EPIC_DIRECT_DOWNLOAD_NOT_AVAILABLE' : 'DOWNLOAD_PROVIDER_UNAVAILABLE';
            throw makeDownloadError(code, platform === 'epic'
                ? 'Epic direct downloads are not available in this build.'
                : 'Direct downloads are not available for this provider.');
        }
        return provider.start(task, options);
    }

    async checkForUpdate(task) {
        const provider = this.findProvider(task);
        if (!provider?.checkForUpdate) {
            throw makeDownloadError('DOWNLOAD_UPDATE_UNSUPPORTED', 'This provider cannot check for game updates.');
        }
        return provider.checkForUpdate(task);
    }

    async assertMaintenanceSupported(task, operationKind) {
        const provider = this.findProvider(task);
        if (!provider) throw makeDownloadError('DOWNLOAD_PROVIDER_UNAVAILABLE', 'Direct downloads are not available for this provider.');
        const capabilities = await provider.getCapabilityStatus?.() || {};
        const supported = operationKind === 'update' ? capabilities.supportsUpdate === true : capabilities.supportsRepair === true;
        if (!supported) throw makeDownloadError('DOWNLOAD_MAINTENANCE_UNSUPPORTED', `This provider does not support ${operationKind}.`);
        return capabilities;
    }

    async pause(taskId, options = {}) {
        const results = await Promise.all(this.providers.map(provider => provider?.pause?.(taskId, options)).filter(Boolean));
        return summarizeStopResults(results);
    }

    async cancel(taskId, options = {}) {
        const results = await Promise.all(this.providers.map(provider => provider?.cancel?.(taskId, options)).filter(Boolean));
        return summarizeStopResults(results);
    }

    async getCapabilities() {
        const statuses = [];
        for (const provider of this.providers) {
            if (typeof provider.getCapabilityStatus === 'function') {
                statuses.push(await provider.getCapabilityStatus());
            }
        }
        return statuses;
    }
}

module.exports = {
    DownloadProviderExecutor,
};

function summarizeStopResults(results = []) {
    const meaningful = results.filter(Boolean);
    if (!meaningful.length) return { requested: false, exitConfirmed: true };
    return {
        requested: meaningful.some(result => result.requested !== false),
        exitConfirmed: meaningful.every(result => result.exitConfirmed !== false),
        results: meaningful,
    };
}
