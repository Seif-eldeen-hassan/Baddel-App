'use strict';

class ReorderDownloadsUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    execute(orderedIds) { return this.queueManager.reorder(orderedIds); }
}

module.exports = { ReorderDownloadsUseCase };
