'use strict';

class QueueGameDownloadUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    execute(payload) { return this.queueManager.queueInstall(payload); }
}

module.exports = { QueueGameDownloadUseCase };
