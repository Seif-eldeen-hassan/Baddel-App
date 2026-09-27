'use strict';

class UninstallDownloadUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    execute(taskId) { return this.queueManager.uninstall(taskId); }
}

module.exports = { UninstallDownloadUseCase };
