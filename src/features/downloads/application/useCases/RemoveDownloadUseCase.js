'use strict';

class RemoveDownloadUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    execute(taskId) { return this.queueManager.remove(taskId); }
}

module.exports = { RemoveDownloadUseCase };
