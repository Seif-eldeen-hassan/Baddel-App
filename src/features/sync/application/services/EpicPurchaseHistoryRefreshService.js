'use strict';

const { EpicHistoryRefreshOperationRegistry } = require('./EpicHistoryRefreshOperationRegistry');

const EPIC_HISTORY_ERROR_CODES = Object.freeze({
    ACCOUNT_NOT_FOUND: 'EPIC_ACCOUNT_NOT_FOUND',
    REAUTH_REQUIRED: 'EPIC_REAUTH_REQUIRED',
    LOGIN_CANCELLED: 'EPIC_LOGIN_CANCELLED',
    POST_LOGIN_SESSION_NOT_READY: 'EPIC_POST_LOGIN_SESSION_NOT_READY',
    ACCOUNT_MISMATCH: 'EPIC_ACCOUNT_MISMATCH',
    IDENTITY_CHECK_FAILED: 'EPIC_IDENTITY_CHECK_FAILED',
    IDENTITY_ENDPOINT_UNAVAILABLE: 'EPIC_IDENTITY_ENDPOINT_UNAVAILABLE',
    LEGENDARY_RUNTIME_MISSING: 'EPIC_LEGENDARY_RUNTIME_MISSING',
    LEGENDARY_AUTH_FAILED: 'EPIC_LEGENDARY_AUTH_FAILED',
    LEGENDARY_USER_DATA_MISSING: 'EPIC_LEGENDARY_USER_DATA_MISSING',
    LEGENDARY_STATUS_INVALID: 'EPIC_LEGENDARY_STATUS_INVALID',
    FETCH_FAILED: 'EPIC_HISTORY_FETCH_FAILED',
    INVALID_RESPONSE: 'EPIC_HISTORY_INVALID_RESPONSE',
    COMMIT_FAILED: 'EPIC_HISTORY_COMMIT_FAILED',
    ALREADY_RUNNING: 'EPIC_HISTORY_REFRESH_ALREADY_RUNNING',
    TIMEOUT: 'EPIC_HISTORY_REQUEST_TIMEOUT',
    NETWORK_ERROR: 'EPIC_HISTORY_NETWORK_ERROR',
    SERVICE_UNAVAILABLE: 'EPIC_HISTORY_SERVICE_UNAVAILABLE',
    DEADLINE_EXCEEDED: 'EPIC_HISTORY_DEADLINE_EXCEEDED',
    CANCELLED: 'EPIC_SYNC_CANCELLED',
});

class EpicPurchaseHistoryError extends Error {
    constructor(code, message, cause = null, details = null) {
        super(message);
        this.name = 'EpicPurchaseHistoryError';
        this.code = code;
        if (cause) this.cause = cause;
        if (details && typeof details === 'object') this.details = details;
        this.causeCode = details?.causeCode || cause?.code || null;
        this.causeSummary = details?.causeSummary || cause?.safeSummary || null;
    }
}

function epicHistoryError(code, message, cause = null, details = null) {
    if (cause instanceof EpicPurchaseHistoryError && cause.code === code) return cause;
    return new EpicPurchaseHistoryError(code, message, cause, details);
}

function isEpicHistoryAuthError(error) {
    return error?.code === EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED
        || error?.code === EPIC_HISTORY_ERROR_CODES.POST_LOGIN_SESSION_NOT_READY;
}

function _safeDiagnostic(event = {}) {
    const safe = { at: String(event.at || new Date().toISOString()), stage: String(event.stage || 'unknown'), code: String(event.code || 'OK') };
    for (const key of [
        'status', 'originPath', 'contentType', 'redirected', 'classification', 'attempt',
        'causeCode', 'causeSummary', 'command', 'executableExists', 'mode', 'exitCode',
        'signal', 'timeout', 'stderrClassification', 'configDirectoryCreated', 'userJsonExists',
        'operationId', 'accountHash', 'partitionHash', 'cookieCount', 'verificationSource',
        'pagesFetched', 'ordersFetched', 'durationMs',
    ]) {
        if (event[key] !== undefined && event[key] !== null) safe[key] = event[key];
    }
    return safe;
}

function classifyEpicWebResponse(response, bodyText = '') {
    const status = Number(response?.status || 0);
    const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
    const trimmed = String(bodyText || '').trimStart();
    const prefix = trimmed.slice(0, 1200).toLowerCase();
    let classification = 'other';
    if (!trimmed) classification = 'empty';
    else if (contentType.includes('json') || prefix.startsWith('{') || prefix.startsWith('[')) classification = 'json';
    else if (contentType.includes('text/html') || prefix.startsWith('<!doctype html') || prefix.startsWith('<html')) {
        const confirmedLogin = prefix.includes('/id/login')
            || prefix.includes('epicgames.com/id/authorize')
            || (prefix.includes('epic games') && /sign[ -]?in|log[ -]?in/.test(prefix));
        classification = confirmedLogin ? 'login_html' : 'html';
    }
    const redirectTarget = String(response?.url || response?.headers?.get?.('location') || '').toLowerCase();
    const explicitLoginRedirect = response?.redirected === true
        && (redirectTarget.includes('epicgames.com/id/login')
            || redirectTarget.includes('epicgames.com/id/authorize')
            || redirectTarget.includes('/login'));
    return {
        classification,
        authenticationFailure: status === 401 || status === 403 || classification === 'login_html' || explicitLoginRedirect,
        explicitAuthStatus: status === 401 || status === 403,
        explicitLoginRedirect,
    };
}

async function collectEpicPurchaseHistoryPages(fetchPage, options = {}) {
    const maxPages = Number(options.maxPages || 80);
    const requestTimeoutMs = Number(options.requestTimeoutMs || 18000);
    const nowMs = options.nowMs || (() => Date.now());
    const progressDeadlineMs = Math.max(requestTimeoutMs, Number(options.progressDeadlineMs || options.phaseDeadlineMs || 120000));
    const hardDeadlineAt = Number(options.hardDeadlineAt || options.deadlineAt || (nowMs() + Number(options.maxPhaseDurationMs || 15 * 60 * 1000)));
    let progressDeadlineAt = Math.min(hardDeadlineAt, nowMs() + progressDeadlineMs);
    const maxRetries = Math.max(0, Number(options.maxRetries ?? 2));
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const initial = options.initialCheckpoint && typeof options.initialCheckpoint === 'object'
        ? options.initialCheckpoint : {};
    let nextPageToken = String(initial.nextPageToken || '');
    let pagesFetched = Number(initial.pagesFetched || 0);
    const orders = Array.isArray(initial.orders) ? initial.orders.slice() : [];
    const stableId = (order, index) => String(order?.orderId || order?.id || order?.order_id
        || [order?.createdAt || order?.date || '', order?.total || order?.amount || '', index].join(':'));
    const seen = new Set(orders.map(stableId));

    for (let page = pagesFetched; page < maxPages; page += 1) {
        if (options.signal?.aborted) {
            const error = options.signal.reason instanceof Error ? options.signal.reason : epicHistoryError(EPIC_HISTORY_ERROR_CODES.CANCELLED, 'Epic Purchase History was cancelled.');
            if (!error.code) error.code = EPIC_HISTORY_ERROR_CODES.CANCELLED;
            throw error;
        }
        if (nowMs() >= progressDeadlineAt || nowMs() >= hardDeadlineAt) {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.DEADLINE_EXCEEDED, 'Epic Purchase History exceeded its time limit.');
        }
        let data;
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            const controller = new AbortController();
            const forwardAbort = () => controller.abort(options.signal?.reason);
            options.signal?.addEventListener?.('abort', forwardAbort, { once: true });
            const remaining = Math.max(1, Math.min(progressDeadlineAt, hardDeadlineAt) - nowMs());
            const timeoutError = epicHistoryError(EPIC_HISTORY_ERROR_CODES.TIMEOUT, 'Epic Purchase History request timed out.');
            let rejectTimeout;
            const timeoutPromise = new Promise((_resolve, reject) => { rejectTimeout = reject; });
            const timer = setTimeout(() => { controller.abort(timeoutError); rejectTimeout(timeoutError); }, Math.min(requestTimeoutMs, remaining));
            try {
                data = await Promise.race([
                    fetchPage(nextPageToken, page, { signal: controller.signal, attempt }),
                    timeoutPromise,
                ]);
                break;
            } catch (error) {
                lastError = error;
                if (options.signal?.aborted) throw options.signal.reason || error;
                const transient = [EPIC_HISTORY_ERROR_CODES.FETCH_FAILED, EPIC_HISTORY_ERROR_CODES.TIMEOUT]
                    .includes(error?.code) || error?.name === 'AbortError';
                if (!transient || attempt >= maxRetries) {
                    if (controller.signal.aborted && !error?.code) {
                        throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.TIMEOUT, 'Epic Purchase History request timed out.', error);
                    }
                    throw error;
                }
                await sleep(Math.min(2000, 300 * (2 ** attempt)));
            } finally {
                clearTimeout(timer);
                options.signal?.removeEventListener?.('abort', forwardAbort);
            }
        }
        if (!data) throw lastError || epicHistoryError(EPIC_HISTORY_ERROR_CODES.FETCH_FAILED, 'Epic Purchase History request failed.');
        if (!Array.isArray(data?.orders) && !Array.isArray(data?.elements)) {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE, 'Epic order history response did not contain an orders list.');
        }
        const pageOrders = Array.isArray(data.orders) ? data.orders : data.elements;
        for (let index = 0; index < pageOrders.length; index += 1) {
            const order = pageOrders[index];
            const id = stableId(order, orders.length + index);
            if (!seen.has(id)) {
                seen.add(id);
                orders.push(order);
            }
        }
        pagesFetched = page + 1;
        nextPageToken = data.nextPageToken || data.paging?.nextPageToken || '';
        progressDeadlineAt = Math.min(hardDeadlineAt, nowMs() + progressDeadlineMs);
        await options.onCheckpoint?.({
            pagesFetched,
            ordersFetched: orders.length,
            lastSuccessfulPage: page,
            nextPageToken,
            orders: orders.slice(),
        });
        options.onProgress?.({
            pagesFetched,
            ordersFetched: orders.length,
            lastSuccessfulPage: page,
        });
        if (!nextPageToken) {
            Object.defineProperties(orders, {
                pagesFetched: { value: pagesFetched, enumerable: false },
                lastSuccessfulPage: { value: page, enumerable: false },
            });
            return orders;
        }
        if (page + 1 >= maxPages) {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE, 'Epic order history pagination was incomplete.');
        }
        if (options.pageDelayMs !== 0) await sleep(options.pageDelayMs || 250);
    }
    throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE, 'Epic order history pagination was incomplete.');
}

class EpicPurchaseHistoryRefreshService {
    constructor(deps = {}) {
        this.getAccount = deps.getAccount;
        this.getSession = deps.getSession;
        this.openLogin = deps.openLogin;
        this.clearSession = deps.clearSession || (async () => {});
        this.flushSession = deps.flushSession || (async (epicSession) => epicSession?.cookies?.flushStore?.());
        this.verifyIdentity = deps.verifyIdentity;
        this.resolvePersistentSessionIdentity = deps.resolvePersistentSessionIdentity || null;
        this.fetchHistory = deps.fetchHistory;
        this.readVaultAccount = deps.readVaultAccount;
        this.processHistory = deps.processHistory || ((value) => value);
        this.buildVaultAccount = deps.buildVaultAccount;
        this.commitVaultAccount = deps.commitVaultAccount;
        this.now = deps.now || (() => new Date().toISOString());
        this.sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.readinessDelays = deps.readinessDelays || [0, 250, 750, 1500];
        this.operationRegistry = deps.operationRegistry || new EpicHistoryRefreshOperationRegistry();
        this.requestTimeoutMs = Number(deps.requestTimeoutMs || 18000);
        this.phaseDeadlineMs = Number(deps.phaseDeadlineMs || 120000);
        this.maxPhaseDurationMs = Number(deps.maxPhaseDurationMs || 15 * 60 * 1000);
    }

    async refresh(accountId, context = {}) {
        const id = String(accountId || '').trim();
        if (!id) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.ACCOUNT_NOT_FOUND, 'The selected Epic account is not linked.');
        const operationId = String(context.operationId || `history-${Date.now()}`);
        const source = String(context.source || 'unknown');
        return this.operationRegistry.run({
            accountId: id,
            operationId,
            source,
            onOperation: context.onOperation,
            start: () => this._runOwnedRefresh(id, { ...context, operationId, source }),
        });
    }

    async _runOwnedRefresh(id, context) {
        const diagnostics = [];
        const emitState = (phase, details = {}) => {
            this.operationRegistry.setPhase(id, context.operationId, phase);
            try { context.onState?.({ at: new Date().toISOString(), accountId: id, operationId: context.operationId || null, phase, ...details }); } catch (_) {}
        };
        const emit = (event) => {
            const safe = _safeDiagnostic({
                operationId: context.operationId || null,
                accountHash: context.accountHash || null,
                partitionHash: context.partitionHash || null,
                ...event,
            });
            diagnostics.push(safe);
            try { context.onDiagnostic?.(safe); } catch (_) {}
        };
        const pending = this._refresh(id, context, diagnostics, emit, emitState);
        try {
            return await pending;
        } catch (error) {
            error.diagnostics = diagnostics;
            if (!error.failedStage) error.failedStage = diagnostics.at(-1)?.stage || 'unknown';
            emitState(error?.code === EPIC_HISTORY_ERROR_CODES.LOGIN_CANCELLED ? 'cancelled' : 'error', {
                code: error?.code || EPIC_HISTORY_ERROR_CODES.FETCH_FAILED,
                failedStage: error.failedStage,
            });
            throw error;
        }
    }

    async _refresh(accountId, context, diagnostics, emit, emitState) {
        const account = await this.getAccount(accountId);
        if (!account) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.ACCOUNT_NOT_FOUND, 'The selected Epic account is not linked.');
        const epicSession = await this.getSession(accountId);
        const initialCheckpoint = await context.loadCheckpoint?.() || null;
        const progressDeadlineMs = Number(context.phaseDeadlineMs || this.phaseDeadlineMs);
        const hardDeadlineAt = Date.now() + Number(context.maxPhaseDurationMs || this.maxPhaseDurationMs);
        const requestOptions = (stage, attempt = 0) => ({
            stage, attempt, onDiagnostic: emit, signal: context.signal,
            requestTimeoutMs: Number(context.requestTimeoutMs || this.requestTimeoutMs),
            progressDeadlineMs, hardDeadlineAt, deadlineAt: hardDeadlineAt,
            maxPhaseDurationMs: Number(context.maxPhaseDurationMs || this.maxPhaseDurationMs),
            maxRetries: 2, initialCheckpoint,
            onCheckpoint: context.saveCheckpoint,
            onProgress: (progress) => {
                context.onProgress?.(progress);
                emit({ stage: 'history_page_progress', pagesFetched: progress.pagesFetched, ordersFetched: progress.ordersFetched });
                emitState('page_progress', progress);
            },
        });
        let history;
        try {
            emitState('checking_session');
            emit({ stage: 'cached_identity_check' });
            const identity = await this._verifyPersistentSessionIdentity(
                account, epicSession, context.userAgent, emit, requestOptions('cached_identity_check')
            );
            this._assertIdentity(account, identity);
            emit({ stage: 'cached_history_probe' });
            emitState('fetching_history');
            emit({ stage: 'history_page_fetch' });
            history = await this.fetchHistory(epicSession, context.userAgent, requestOptions('history_page_fetch'));
        } catch (error) {
            if (error?.code === EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH) throw error;
            if (!isEpicHistoryAuthError(error)) throw error;
            emit({ stage: 'reauth_required', code: EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED });
            emitState('reauth_required', { code: EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED });
            if (context.allowInteractiveLogin !== true) {
                return {
                    status: 'reauth_required',
                    code: EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED,
                    accountId,
                    accountDisplayName: account.displayName || 'Epic Account',
                    reason: 'expired_session',
                    diagnostics,
                };
            }
            history = await this._loginAndRead(account, epicSession, context, emit, emitState, requestOptions);
        }

        emitState('fetching_history');
        emit({ stage: 'history_process' });
        let processed;
        try {
            processed = await this.processHistory(history);
        } catch (error) {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE, 'Epic Purchase History could not be processed.', error);
        }
        if (!processed || typeof processed !== 'object' || !Array.isArray(processed.purchaseHistoryItems)) {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE, 'Epic returned an invalid Purchase History response.');
        }
        const previous = await this.readVaultAccount(accountId);
        const fetchedAt = this.now();
        const next = await this.buildVaultAccount({ account, previous, processed, fetchedAt });
        emitState('committing');
        emit({ stage: 'vault_commit' });
        try {
            await context.beforeCommit?.();
            const committed = await this.commitVaultAccount(next, { assertCurrent: context.beforeCommit });
            next.committedRevision = committed?.vaultRevision ?? committed?.phaseRevisions?.purchaseHistory ?? null;
            await context.clearCheckpoint?.();
            emit({ stage: 'vault_commit_completed' });
        } catch (error) {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.COMMIT_FAILED, 'Could not save the refreshed Epic Purchase History.', error);
        }
        emit({ stage: 'completed' });
        emitState('success', {
            fetchedAt,
            ordersCount: Number(processed.ordersCount || 0),
            purchaseHistoryItemsCount: processed.purchaseHistoryItems.length,
        });
        return {
            status: 'success', accountId, fetchedAt,
            ordersCount: Number(processed.ordersCount || 0),
            pagesFetched: Number(history?.pagesFetched || initialCheckpoint?.pagesFetched || 0),
            purchaseHistoryItemsCount: processed.purchaseHistoryItems.length,
            committedRevision: next.committedRevision ?? null,
            diagnostics,
        };
    }

    async _loginAndRead(account, epicSession, context, emit, emitState, requestOptions) {
        await this.clearSession(epicSession, account);
        emit({ stage: 'login_started' });
        emitState('login_opened');
        let loginResult;
        try {
            loginResult = await this.openLogin({
                account, epicSession, parentWindow: context.parentWindow, signal: context.signal,
                onDiagnostic: emit,
            });
            emit({ stage: 'authorization_code_received' });
            emitState('authorization_received');
            await loginResult?.waitForSessionReady?.();
            await this.flushSession(epicSession, account);
            const sessionInfo = await context.inspectSession?.(epicSession) || {};
            emit({ stage: 'post_login_cookie_ready', cookieCount: sessionInfo.cookieCount });
            const identity = await this._verifyPostLoginIdentity(
                account, epicSession, loginResult?.userAgent || context.userAgent, emit, requestOptions
            );
            this._assertIdentity(account, identity);
            emit({ stage: 'persistent_session_verified', verificationSource: identity.verificationSource || 'persistent_session' });
            emitState('session_verified', { verificationSource: identity.verificationSource || 'persistent_session' });
            loginResult?.close?.();
            emit({ stage: 'auth_ui_closed' });
            loginResult = null;
            emitState('fetching_history');
            return this._fetchPostLoginHistory(epicSession, context, emit, requestOptions);
        } catch (error) {
            if (error?.code === EPIC_HISTORY_ERROR_CODES.LOGIN_CANCELLED || /cancel/i.test(error?.message || '')) {
                throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.LOGIN_CANCELLED, 'Epic sign-in was cancelled. Your saved Purchase History was not changed.', error);
            }
            if (error instanceof EpicPurchaseHistoryError) throw error;
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.POST_LOGIN_SESSION_NOT_READY, 'Epic sign-in could not be verified.', error);
        } finally {
            loginResult?.close?.();
        }
    }

    async _fetchPostLoginHistory(epicSession, context, emit, requestOptions) {
        let lastError = null;
        for (let attempt = 0; attempt < this.readinessDelays.length; attempt += 1) {
            const delay = Number(this.readinessDelays[attempt] || 0);
            if (delay > 0) await this.sleep(delay);
            emit({ stage: 'history_page_fetch', attempt });
            try {
                return await this.fetchHistory(
                    epicSession,
                    context.userAgent,
                    requestOptions('history_page_fetch', attempt)
                );
            } catch (error) {
                lastError = error;
                const transient = isEpicHistoryAuthError(error);
                if (!transient) throw error;
            }
        }
        throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.POST_LOGIN_SESSION_NOT_READY, 'Epic accepted the sign-in, but the account session was not ready.', lastError);
    }

    async _verifyPersistentSessionIdentity(account, epicSession, userAgent, emit, options) {
        try {
            const identity = await this.verifyIdentity(epicSession, userAgent, options);
            return { ...identity, verificationSource: 'identity_endpoint' };
        } catch (error) {
            if (error?.code !== EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE
                || !this.resolvePersistentSessionIdentity) throw error;
            emit({
                stage: 'persistent_session_identity_fallback',
                code: EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE,
                causeCode: error.code,
                causeSummary: 'Primary Epic identity endpoint returned a non-JSON response.',
            });
            const identity = await this.resolvePersistentSessionIdentity(
                epicSession, account, userAgent, {
                    ...options,
                    stage: 'persistent_session_authorization_check',
                    onDiagnostic: emit,
                }
            );
            this._assertIdentity(account, identity);
            emit({
                stage: 'persistent_session_authorization_verified',
                verificationSource: 'persistent_session_authorization',
            });
            return { ...identity, verificationSource: 'persistent_session_authorization' };
        }
    }

    async _verifyPostLoginIdentity(account, epicSession, userAgent, emit, requestOptions) {
        let lastError = null;
        for (let attempt = 0; attempt < this.readinessDelays.length; attempt += 1) {
            const delay = Number(this.readinessDelays[attempt] || 0);
            if (delay > 0) await this.sleep(delay);
            emit({ stage: 'post_login_identity_check', attempt });
            try {
                const identity = await this._verifyPersistentSessionIdentity(
                    account, epicSession, userAgent, emit, requestOptions('post_login_identity_check', attempt)
                );
                this._assertIdentity(account, identity);
                return identity;
            } catch (error) {
                if (error?.code === EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH) throw error;
                lastError = error;
                const transient = isEpicHistoryAuthError(error) || error?.code === EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED;
                if (!transient) break;
            }
        }
        throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.POST_LOGIN_SESSION_NOT_READY, 'Epic accepted the sign-in, but the account session was not ready.', lastError);
    }

    _assertIdentity(account, identity) {
        const actualId = String(identity?.accountId || identity?.id || '').trim();
        const expectedId = String(account?.id || account?.accountId || '').trim();
        if (!actualId) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'Epic authenticated-session identity is unavailable.');
        if (actualId !== expectedId) {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH, `The signed-in Epic account does not match ${account.displayName || 'the selected account'}.`);
        }
    }
}

module.exports = {
    EPIC_HISTORY_ERROR_CODES,
    EpicPurchaseHistoryError,
    EpicPurchaseHistoryRefreshService,
    classifyEpicWebResponse,
    collectEpicPurchaseHistoryPages,
    epicHistoryError,
    isEpicHistoryAuthError,
};
