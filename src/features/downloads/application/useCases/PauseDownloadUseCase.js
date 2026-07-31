'use strict';

class PauseDownloadUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    execute(taskId) { return this.queueManager.pause(taskId); }
}

module.exports = { PauseDownloadUseCase };
