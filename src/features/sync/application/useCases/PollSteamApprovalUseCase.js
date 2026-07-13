'use strict';

function resolveSteamApprovalPollStep(status, attempt, maxAttempts) {
    if (attempt >= maxAttempts) {
        return { action: 'stop', message: 'Approval request expired. Click Continue to try again.', reenableButton: true, writeDiag: 'max_attempts' };
    }
    switch (status) {
        case 'authenticated':     return { action: 'resolved' };
        case 'pending_approval':  return { action: 'poll', message: `Waiting for mobile approval… (attempt ${attempt})` };
        case 'approval_denied':   return { action: 'stop', message: 'Request denied in Steam app. Close and try again.', reenableButton: true, writeDiag: 'approval_denied' };
        case 'approval_expired':  return { action: 'stop', message: 'Approval request expired. Click Continue to try again.', reenableButton: true, writeDiag: 'approval_expired' };
        case 'need_login':        return { action: 'stop', message: 'Session expired. Close this window and try again.', reenableButton: true, writeDiag: 'need_login' };
        case 'error':             return { action: 'stop', message: 'Login error. Close this window and try again.', reenableButton: true, writeDiag: 'error' };
        case 'need_2fa':          return { action: 'poll' };
        default:                  return { action: 'poll' };
    }
}

class PollSteamApprovalUseCase {
    pollStep({ status, attempt, maxAttempts }) {
        return resolveSteamApprovalPollStep(status, attempt, maxAttempts);
    }
}

module.exports = {
    PollSteamApprovalUseCase,
    resolveSteamApprovalPollStep,
};
