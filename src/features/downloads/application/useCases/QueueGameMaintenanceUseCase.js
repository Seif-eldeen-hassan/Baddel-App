'use strict';

class QueueGameMaintenanceUseCase {
    constructor({ queueManager } = {}) {
        if (!queueManager) throw new Error('QueueGameMaintenanceUseCase requires queueManager');
        this.queueManager = queueManager;
    }

    execute(payload) {
        return this.queueManager.queueMaintenance(payload);
    }
}

module.exports = { QueueGameMaintenanceUseCase };
