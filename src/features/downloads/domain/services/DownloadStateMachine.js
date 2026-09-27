'use strict';

const { DOWNLOAD_STATUSES } = require('../entities/DownloadTask');

const TRANSITIONS = Object.freeze({
    [DOWNLOAD_STATUSES.PENDING]: new Set([
        DOWNLOAD_STATUSES.PREPARING,
        DOWNLOAD_STATUSES.PAUSED,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.PREPARING]: new Set([
        DOWNLOAD_STATUSES.DOWNLOADING,
        DOWNLOAD_STATUSES.PAUSING,
        DOWNLOAD_STATUSES.FAILED,
        DOWNLOAD_STATUSES.PAUSED,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.DOWNLOADING]: new Set([
        DOWNLOAD_STATUSES.PAUSING,
        DOWNLOAD_STATUSES.PAUSED,
        DOWNLOAD_STATUSES.VERIFYING,
        DOWNLOAD_STATUSES.FAILED,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.PAUSING]: new Set([
        DOWNLOAD_STATUSES.PAUSED,
        DOWNLOAD_STATUSES.FAILED,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.PAUSED]: new Set([
        DOWNLOAD_STATUSES.PENDING,
        DOWNLOAD_STATUSES.PREPARING,
        DOWNLOAD_STATUSES.RESUMING,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.RESUMING]: new Set([
        DOWNLOAD_STATUSES.DOWNLOADING,
        DOWNLOAD_STATUSES.PAUSING,
        DOWNLOAD_STATUSES.PAUSED,
        // A provider can finish a zero-transfer resume (or a repair/update)
        // without emitting a downloading progress sample. The adapter still
        // has to enter the normal completion-verification phase.
        DOWNLOAD_STATUSES.VERIFYING,
        DOWNLOAD_STATUSES.FAILED,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.VERIFYING]: new Set([
        DOWNLOAD_STATUSES.PAUSING,
        DOWNLOAD_STATUSES.INSTALLING,
        DOWNLOAD_STATUSES.COMPLETED,
        DOWNLOAD_STATUSES.FAILED,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.INSTALLING]: new Set([
        DOWNLOAD_STATUSES.PAUSING,
        DOWNLOAD_STATUSES.COMPLETED,
        DOWNLOAD_STATUSES.FAILED,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.FAILED]: new Set([
        DOWNLOAD_STATUSES.PENDING,
        DOWNLOAD_STATUSES.CANCELLED,
    ]),
    [DOWNLOAD_STATUSES.CANCELLED]: new Set([
        DOWNLOAD_STATUSES.PENDING,
    ]),
    // A completed managed install may re-enter the same global queue for an
    // explicit provider update or repair. DownloadQueueManager is the only
    // caller that performs this transition and validates provenance first.
    [DOWNLOAD_STATUSES.COMPLETED]: new Set([DOWNLOAD_STATUSES.PENDING]),
});

function canTransition(from, to) {
    return !!TRANSITIONS[from]?.has(to);
}

function assertTransition(from, to) {
    if (from === to) return true;
    if (!canTransition(from, to)) {
        const err = new Error(`Invalid download transition: ${from} -> ${to}`);
        err.code = 'DOWNLOAD_INVALID_STATE_TRANSITION';
        throw err;
    }
    return true;
}

function applyTransition(task, toStatus, patch = {}, clock = Date) {
    assertTransition(task.status, toStatus);
    const updatedAt = new clock().toISOString();
    return {
        ...task,
        ...patch,
        status: toStatus,
        stage: patch.stage || toStatus,
        updatedAt,
        startedAt: patch.startedAt || task.startedAt || (
            (toStatus === DOWNLOAD_STATUSES.PREPARING || toStatus === DOWNLOAD_STATUSES.DOWNLOADING)
                ? updatedAt
                : task.startedAt
        ),
        completedAt: toStatus === DOWNLOAD_STATUSES.COMPLETED
            ? (patch.completedAt || updatedAt)
            : (Object.prototype.hasOwnProperty.call(patch, 'completedAt') ? patch.completedAt : (task.completedAt || null)),
    };
}

module.exports = {
    TRANSITIONS,
    canTransition,
    assertTransition,
    applyTransition,
};
