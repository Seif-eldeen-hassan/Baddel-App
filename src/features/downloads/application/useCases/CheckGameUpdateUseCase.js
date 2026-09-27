'use strict';

class CheckGameUpdateUseCase {
    constructor({ queueManager } = {}) {
        if (!queueManager) throw new Error('CheckGameUpdateUseCase requires queueManager');
        this.queueManager = queueManager;
    }

    execute(taskId) {
        return this.queueManager.checkForUpdate(taskId);
    }
}

module.exports = { CheckGameUpdateUseCase };
