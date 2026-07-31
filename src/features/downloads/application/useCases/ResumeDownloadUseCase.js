'use strict';

class ResumeDownloadUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    execute(taskId) { return this.queueManager.resume(taskId); }
}

module.exports = { ResumeDownloadUseCase };
