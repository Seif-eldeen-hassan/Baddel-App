'use strict';

function createSteamQrPollingLoop({
    pollSteamAuth,
    isWindowDestroyed,
    closeWindow,
    resolve,
    reject,
    restart,
    logger,
    setTimeoutFn,
    clearTimeoutFn,
}) {
    let active = true;
    let pollTimeout = null;
    let pollIntervalMs = 2000;

    const stop = () => {
        active = false;
        if (pollTimeout) {
            clearTimeoutFn(pollTimeout);
            pollTimeout = null;
        }
    };

    const schedulePoll = () => {
        pollTimeout = setTimeoutFn(poll, pollIntervalMs);
    };

    const poll = async () => {
        if (!active || isWindowDestroyed()) return;
        try {
            const result = await pollSteamAuth();
            if (!active) return;

            if (result?.status === 'authenticated') {
                stop();
                if (!isWindowDestroyed()) closeWindow();
                resolve(result);
            } else if (result?.status === 'approval_expired') {
                stop();
                if (!isWindowDestroyed()) restart();
            } else if (result?.status === 'approval_denied' || result?.status === 'error') {
                stop();
                reject(new Error(result.message || 'QR login failed'));
            } else {
                schedulePoll();
            }
        } catch (e) {
            logger.error('[QR] poll error:', e.message);
            if (active) schedulePoll();
        }
    };

    const start = (nextPollIntervalMs) => {
        pollIntervalMs = nextPollIntervalMs;
        schedulePoll();
    };

    return { start, stop };
}

module.exports = {
    createSteamQrPollingLoop,
};
