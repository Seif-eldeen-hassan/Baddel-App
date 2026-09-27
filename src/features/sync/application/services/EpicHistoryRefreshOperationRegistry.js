'use strict';

class EpicHistoryRefreshOperationRegistry {
    constructor({ now = () => new Date().toISOString(), onEvent = () => {} } = {}) {
        this.now = now;
        this.onEvent = onEvent;
        this.entries = new Map();
        this.sequences = new Map();
    }

    get(accountId) {
        return this.entries.get(String(accountId)) || null;
    }

    run({ accountId, operationId, source = 'unknown', start, onOperation = () => {} }) {
        const id = String(accountId);
        const existing = this.entries.get(id);
        if (existing) {
            const joined = {
                accountId: id,
                operationId: String(operationId || ''),
                source: String(source || 'unknown'),
                canonicalOperationId: existing.operationId,
                canonicalSource: existing.source,
                operationSequence: existing.operationSequence,
                startedAt: existing.startedAt,
                phase: existing.phase,
                disposition: 'joined',
            };
            onOperation(joined);
            this.onEvent(joined);
            return existing.promise.then(
                (result) => {
                    this.onEvent({
                        ...joined,
                        disposition: 'joined_terminal',
                        terminalStatus: result?.status || 'success',
                        commitRevision: result?.committedRevision ?? null,
                        purchaseHistoryFetchedAt: result?.fetchedAt || null,
                        phase: existing.phase,
                    });
                    return {
                        ...result,
                        joined: true,
                        canonicalOperationId: existing.operationId,
                        canonicalSource: existing.source,
                        requestedOperationId: String(operationId || ''),
                        operationSequence: existing.operationSequence,
                    };
                },
                (error) => {
                    this.onEvent({
                        ...joined,
                        disposition: 'joined_terminal',
                        terminalStatus: 'error',
                        code: error?.code || 'EPIC_HISTORY_FETCH_FAILED',
                        phase: existing.phase,
                    });
                    throw error;
                }
            );
        }

        const operationSequence = (this.sequences.get(id) || 0) + 1;
        this.sequences.set(id, operationSequence);
        const entry = {
            accountId: id,
            operationId: String(operationId || ''),
            source: String(source || 'unknown'),
            promise: null,
            startedAt: this.now(),
            phase: 'starting',
            operationSequence,
        };
        this.entries.set(id, entry);
        const started = { ...entry, promise: undefined, canonicalOperationId: entry.operationId, disposition: 'started' };
        onOperation(started);
        this.onEvent(started);

        entry.promise = Promise.resolve().then(() => start(entry)).then(
            (result) => {
                const terminal = {
                    ...started,
                    disposition: 'terminal',
                    terminalStatus: result?.status || 'success',
                    commitRevision: result?.committedRevision ?? null,
                    purchaseHistoryFetchedAt: result?.fetchedAt || null,
                    phase: entry.phase,
                };
                this.onEvent(terminal);
                return {
                    ...result,
                    joined: false,
                    canonicalOperationId: entry.operationId,
                    canonicalSource: entry.source,
                    operationSequence,
                };
            },
            (error) => {
                error.operationId = entry.operationId;
                error.operationSequence = operationSequence;
                this.onEvent({
                    ...started,
                    disposition: 'terminal',
                    terminalStatus: 'error',
                    code: error?.code || 'EPIC_HISTORY_FETCH_FAILED',
                    phase: entry.phase,
                });
                throw error;
            }
        ).finally(() => {
            if (this.entries.get(id) === entry) this.entries.delete(id);
        });
        return entry.promise;
    }

    setPhase(accountId, operationId, phase) {
        const entry = this.entries.get(String(accountId));
        if (!entry || String(entry.operationId) !== String(operationId)) return false;
        entry.phase = String(phase || entry.phase);
        return true;
    }
}

module.exports = { EpicHistoryRefreshOperationRegistry };
