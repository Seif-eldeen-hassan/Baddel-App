'use strict';

class RetryDownloadUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    execute(taskId) { return this.queueManager.retry(taskId); }
}

module.exports = { RetryDownloadUseCase };
