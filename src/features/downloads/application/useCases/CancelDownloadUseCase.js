'use strict';

class CancelDownloadUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    execute(payload) { return this.queueManager.cancel(payload); }
}

module.exports = { CancelDownloadUseCase };
