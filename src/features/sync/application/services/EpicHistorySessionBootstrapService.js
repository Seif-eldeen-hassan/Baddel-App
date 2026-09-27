'use strict';

const crypto = require('crypto');

function accountHash(accountId) {
    return crypto.createHash('sha256').update(String(accountId || '')).digest('hex').slice(0, 16);
}

function isCanonicalEpicAccountId(accountId) {
    const value = String(accountId || '').trim();
    return Boolean(value) && !/^epic_tmp/i.test(value);
}

function isEpicCookie(cookie = {}) {
    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    return domain === 'epicgames.com' || domain.endsWith('.epicgames.com');
}

function cookieUrl(cookie = {}) {
    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    const path = String(cookie.path || '/').startsWith('/') ? String(cookie.path || '/') : `/${cookie.path}`;
    return `${cookie.secure === false ? 'http' : 'https'}://${domain}${path}`;
}

function cookieDetails(cookie = {}) {
    const details = {
        url: cookieUrl(cookie),
        name: String(cookie.name || ''),
        value: String(cookie.value || ''),
        path: cookie.path || '/',
        secure: cookie.secure !== false,
        httpOnly: cookie.httpOnly === true,
    };
    if (cookie.domain && cookie.hostOnly !== true) details.domain = cookie.domain;
    if (cookie.sameSite && cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite;
    if (Number.isFinite(cookie.expirationDate)) details.expirationDate = cookie.expirationDate;
    return details;
}

async function removeCookies(epicSession, cookies) {
    for (const cookie of cookies) {
        await epicSession.cookies.remove(cookieUrl(cookie), cookie.name);
    }
}

async function setCookies(epicSession, cookies) {
    for (const cookie of cookies) {
        await epicSession.cookies.set(cookieDetails(cookie));
    }
}

async function attemptOptionalEpicHistorySessionBootstrap({ bootstrap, accountId, authResult, context = {} } = {}) {
    try {
        return await bootstrap(accountId, authResult, context);
    } catch (error) {
        const waitingForAuth = [
            'EPIC_REAUTH_REQUIRED',
            'EPIC_POST_LOGIN_SESSION_NOT_READY',
        ].includes(error?.code);
        return {
            status: waitingForAuth ? 'waiting_for_auth'
                : (error?.code === 'EPIC_ACCOUNT_MISMATCH' ? 'mismatch' : 'unavailable'),
            code: error?.code || 'EPIC_IDENTITY_CHECK_FAILED',
            failedStage: error?.failedStage || 'history_session_identity_verified',
        };
    }
}

class EpicHistorySessionBootstrapService {
    constructor({ getTargetSession, verifyIdentity, flushSession, onDiagnostic = () => {} } = {}) {
        if (typeof getTargetSession !== 'function') throw new Error('Epic history session bootstrap requires getTargetSession.');
        if (typeof verifyIdentity !== 'function') throw new Error('Epic history session bootstrap requires verifyIdentity.');
        this.getTargetSession = getTargetSession;
        this.verifyIdentity = verifyIdentity;
        this.flushSession = flushSession || (async (epicSession) => epicSession.cookies.flushStore?.());
        this.onDiagnostic = onDiagnostic;
    }

    async bootstrap(accountId, authResult, context = {}) {
        if (!isCanonicalEpicAccountId(accountId)) {
            const error = new Error('Epic History session requires a canonical account ID.');
            error.code = 'EPIC_IDENTITY_CHECK_FAILED';
            error.failedStage = 'account_identity_resolved';
            throw error;
        }
        const sourceSession = authResult?.epicSession;
        if (!sourceSession?.cookies) {
            const error = new Error('The authenticated Epic login session is unavailable.');
            error.code = 'EPIC_POST_LOGIN_SESSION_NOT_READY';
            error.failedStage = 'history_session_handoff_started';
            throw error;
        }
        const hash = accountHash(accountId);
        const emit = (stage, detail = {}) => {
            const event = { stage, accountHash: hash, ...detail };
            this.onDiagnostic(event);
            context.onDiagnostic?.(event);
        };
        emit('history_session_handoff_started');
        await authResult.waitForSessionReady?.();
        await sourceSession.cookies.flushStore?.();
        const targetSession = await this.getTargetSession(accountId);
        const sourceCookies = (await sourceSession.cookies.get({})).filter(isEpicCookie);
        const previousCookies = (await targetSession.cookies.get({})).filter(isEpicCookie);
        const authoritativeIdentity = context.authoritativeIdentity || null;
        const hasAuthorizationBoundProof = authoritativeIdentity?.authorizationCodeBound === true
            && authoritativeIdentity?.source === 'legendary_authorization_code'
            && String(authoritativeIdentity?.accountId || '') === String(accountId);
        let rolledBack = false;
        const rollback = async () => {
            if (rolledBack) return;
            rolledBack = true;
            const copiedCookies = (await targetSession.cookies.get({})).filter(isEpicCookie);
            await removeCookies(targetSession, copiedCookies);
            await setCookies(targetSession, previousCookies);
            await this.flushSession(targetSession);
            emit('history_session_handoff_rolled_back', { restoredCookieCount: previousCookies.length });
        };
        try {
            await removeCookies(targetSession, previousCookies);
            await setCookies(targetSession, sourceCookies);
            emit('history_cookies_copied', { cookieCount: sourceCookies.length });
            await this.flushSession(targetSession);
            emit('history_cookie_store_flushed');
            let identity;
            try {
                identity = await this.verifyIdentity(targetSession, authResult.userAgent, {
                    stage: 'history_session_identity_verified',
                    onDiagnostic: context.onDiagnostic,
                });
            } catch (error) {
                const indeterminate = [
                    'EPIC_IDENTITY_CHECK_FAILED',
                    'EPIC_IDENTITY_ENDPOINT_UNAVAILABLE',
                    'EPIC_HISTORY_REQUEST_TIMEOUT',
                    'EPIC_HISTORY_FETCH_FAILED',
                ].includes(error?.code);
                if (!indeterminate || !hasAuthorizationBoundProof) throw error;
                emit('history_session_identity_verified', {
                    status: 'identity_indeterminate',
                    code: 'EPIC_IDENTITY_ENDPOINT_UNAVAILABLE',
                    verificationSource: 'legendary_authorization_code',
                });
                return {
                    status: 'identity_indeterminate',
                    verificationSource: 'legendary_authorization_code',
                    epicSession: targetSession,
                    accountHash: hash,
                    cookieCount: sourceCookies.length,
                };
            }
            const actualId = String(identity?.accountId || identity?.id || '').trim();
            if (actualId !== String(accountId)) {
                const error = new Error('The authenticated Epic session does not match the linked account.');
                error.code = 'EPIC_ACCOUNT_MISMATCH';
                error.failedStage = 'history_session_identity_verified';
                error.details = { authoritativeSessionIdentity: true };
                throw error;
            }
            emit('history_session_identity_verified', { status: 'verified', verificationSource: 'epic_web_identity' });
            return {
                status: 'verified', verificationSource: 'epic_web_identity',
                epicSession: targetSession, accountHash: hash, cookieCount: sourceCookies.length, identity,
            };
        } catch (error) {
            emit('history_session_identity_verified', { status: 'failed', code: error?.code || 'EPIC_IDENTITY_CHECK_FAILED' });
            await rollback().catch(() => {});
            if (!error.failedStage) error.failedStage = 'history_session_identity_verified';
            throw error;
        }
    }
}

module.exports = {
    EpicHistorySessionBootstrapService,
    attemptOptionalEpicHistorySessionBootstrap,
    accountHash,
    cookieDetails,
    cookieUrl,
    isCanonicalEpicAccountId,
    isEpicCookie,
};
