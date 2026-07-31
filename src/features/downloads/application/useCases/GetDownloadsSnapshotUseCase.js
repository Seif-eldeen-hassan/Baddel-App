'use strict';

class GetDownloadsSnapshotUseCase {
    constructor({ queueManager }) { this.queueManager = queueManager; }
    async execute() {
        await this.queueManager.ensureLoaded();
        return this.queueManager.getSnapshot();
    }
}

module.exports = { GetDownloadsSnapshotUseCase };
