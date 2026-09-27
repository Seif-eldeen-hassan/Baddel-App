'use strict';

const RETRYABLE_SOURCES = new Set(['rate_limited', 'timeout', 'api_failure', 'network_failure', 'exception', 'circuit_open']);
const FAILURE_SOURCES = new Set([
    ...RETRYABLE_SOURCES,
    'graphql_error', 'persisted_query_invalid', 'response_schema_changed', 'invalid_response',
]);
const FINAL_PRICE_STATUSES = new Set(['priced', 'free', 'not_for_sale', 'unavailable']);

function shouldRefreshCachedEpicPrice(cached, pricingCountry, {
    forceRefresh = false,
    nowMs = Date.now(),
    priceTtlMs = 6 * 60 * 60 * 1000,
    unavailableTtlMs = 30 * 24 * 60 * 60 * 1000,
    normalizeCountry = (value) => String(value || '').trim().toUpperCase(),
} = {}) {
    if (forceRefresh) return true;
    if (!cached || !FINAL_PRICE_STATUSES.has(cached.priceStatus)) return true;
    if (normalizeCountry(cached.pricingCountry) !== normalizeCountry(pricingCountry)) return true;
    const unavailable = ['not_for_sale', 'unavailable'].includes(cached.priceStatus);
    const checkedAt = Date.parse(unavailable ? (cached.checkedAt || cached.fetchedAt || cached.resolvedAt || '') : (cached.fetchedAt || cached.resolvedAt || ''));
    const ttlMs = unavailable ? unavailableTtlMs : priceTtlMs;
    return !Number.isFinite(checkedAt) || nowMs - checkedAt >= ttlMs;
}

function abortError(signal) {
    const error = signal?.reason instanceof Error ? signal.reason : new Error('Epic price enrichment cancelled.');
    if (!error.code) error.code = 'EPIC_SYNC_CANCELLED';
    return error;
}

function sleep(ms, signal) {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(done, Math.max(0, Number(ms) || 0));
        const onAbort = () => { clearTimeout(timer); cleanup(); reject(abortError(signal)); };
        function cleanup() { signal?.removeEventListener?.('abort', onAbort); }
        function done() { cleanup(); resolve(); }
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

class EpicPriceEnrichmentService {
    constructor({ fetchEntry, concurrency = 3, batchSize = 25, maxRetries = 2, baseBackoffMs = 600, maxRetryAfterMs = 15_000, jitter = Math.random, sleepFn = sleep, circuitMinAttempts = 12, circuitFailureRatio = 0.7, progressEveryItems = 10, progressIntervalMs = 350, nowMs = () => Date.now() } = {}) {
        if (typeof fetchEntry !== 'function') throw new Error('EpicPriceEnrichmentService requires fetchEntry.');
        this.fetchEntry = fetchEntry;
        this.concurrency = Math.max(1, Math.min(4, Number(concurrency) || 3));
        this.batchSize = Math.max(1, Number(batchSize) || 25);
        this.maxRetries = Math.max(0, Number(maxRetries) || 0);
        this.baseBackoffMs = Math.max(1, Number(baseBackoffMs) || 600);
        this.maxRetryAfterMs = Math.max(0, Number(maxRetryAfterMs) || 0);
        this.jitter = jitter;
        this.sleep = sleepFn;
        this.circuitMinAttempts = Math.max(1, Number(circuitMinAttempts) || 12);
        this.circuitFailureRatio = Math.min(1, Math.max(0.1, Number(circuitFailureRatio) || 0.7));
        this.progressEveryItems = Math.max(1, Number(progressEveryItems) || 10);
        this.progressIntervalMs = Math.max(100, Number(progressIntervalMs) || 350);
        this.nowMs = nowMs;
    }

    async process(entries = [], context = {}) {
        const list = Array.isArray(entries) ? entries : [];
        const signal = context.signal;
        const diagnostics = {
            total: list.length, processed: 0, resolved: 0, priced: 0, free: 0,
            notForSale: 0, unavailable: 0, unresolved: 0, apiFailures: 0, timeouts: 0,
            rateLimits: 0, activeRequests: 0, maxActiveRequests: 0,
            circuitOpen: false, batchesCommitted: 0, resolutionFailures: 0, reasonCounts: {},
        };
        const results = [];
        let cursor = 0;
        let pendingBatch = [];
        let commitChain = Promise.resolve();
        let lastPublishedProcessed = 0;
        let lastPublishedAt = this.nowMs();
        const publish = (force = false) => {
            const now = this.nowMs();
            if (!force
                && (diagnostics.processed - lastPublishedProcessed < this.progressEveryItems
                    || now - lastPublishedAt < this.progressIntervalMs)) return undefined;
            lastPublishedProcessed = diagnostics.processed;
            lastPublishedAt = now;
            return context.onProgress?.({ ...diagnostics });
        };
        const commit = (force = false) => {
            if (!pendingBatch.length || (!force && pendingBatch.length < this.batchSize)) return commitChain;
            const batch = pendingBatch.splice(0, force ? pendingBatch.length : this.batchSize);
            commitChain = commitChain.then(async () => {
                if (signal?.aborted) throw abortError(signal);
                await context.onBatch?.(batch, { ...diagnostics });
                diagnostics.batchesCommitted += 1;
                await context.onProgress?.({ ...diagnostics, event: 'batch_committed', batchSize: batch.length });
            });
            return commitChain;
        };

        const worker = async () => {
            while (true) {
                if (signal?.aborted) throw abortError(signal);
                if (diagnostics.circuitOpen || cursor >= list.length) return;
                const index = cursor++;
                diagnostics.activeRequests += 1;
                diagnostics.maxActiveRequests = Math.max(diagnostics.maxActiveRequests, diagnostics.activeRequests);
                let price;
                try {
                    price = await this._fetchWithRetry(list[index], context, diagnostics);
                } catch (error) {
                    if (signal?.aborted || error?.code === 'EPIC_SYNC_CANCELLED' || error?.code === 'EPIC_SYNC_RUN_STALE') throw error;
                    await context.debug?.record?.('offer_resolution_completed', {
                        classification: 'exception_before_fallback',
                        error: context.errorSummary?.(error) || {
                            name: error?.name || 'Error', code: error?.code || null,
                            message: error?.message || String(error), failedStage: error?.failedStage || null,
                        },
                    });
                    price = context.makeUnresolved?.(list[index], 'exception') || { priceStatus: 'unresolved', resolutionSource: 'exception' };
                } finally {
                    diagnostics.activeRequests -= 1;
                }
                results[index] = price;
                pendingBatch.push(price);
                this._record(price, diagnostics);
                diagnostics.processed += 1;
                const zeroCoverageFailures = diagnostics.apiFailures + diagnostics.timeouts + diagnostics.rateLimits;
                if (diagnostics.processed >= this.circuitMinAttempts
                    && diagnostics.resolved === 0
                    && zeroCoverageFailures / diagnostics.processed >= this.circuitFailureRatio) {
                    diagnostics.circuitOpen = true;
                }
                await publish(false);
                await commit(false);
            }
        };

        await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, list.length)) }, () => worker()));
        await commit(true);
        await commitChain;
        await publish(true);
        const attemptedResults = results.filter(Boolean);
        attemptedResults.diagnostics = { ...diagnostics };
        const serviceFailures = Object.entries(diagnostics.reasonCounts)
            .reduce((total, [reason, count]) => total + (FAILURE_SOURCES.has(reason) ? Number(count || 0) : 0), 0);
        if (list.length > 0 && diagnostics.resolved === 0 && serviceFailures > 0) {
            const error = new Error('Epic prices could not resolve any games because the pricing service was unavailable.');
            error.code = 'EPIC_PRICES_ZERO_COVERAGE';
            error.failedStage = 'price_resolution';
            error.progress = { ...diagnostics };
            throw error;
        }
        const retryable = attemptedResults.filter((price) => RETRYABLE_SOURCES.has(price?.resolutionSource));
        return {
            status: retryable.length || diagnostics.circuitOpen || diagnostics.unresolved ? 'partial' : 'complete',
            prices: attemptedResults,
            retryable,
            progress: { ...diagnostics, unresolved: diagnostics.unresolved + Math.max(0, list.length - diagnostics.processed) },
        };
    }

    async _fetchWithRetry(entry, context, diagnostics) {
        let last;
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            if (context.signal?.aborted) throw abortError(context.signal);
            last = await this.fetchEntry(entry, context.pricingCountry, { signal: context.signal, attempt });
            await context.debug?.record?.('offer_resolution_completed', {
                classification: 'retry_decision', attempt: attempt + 1,
                resolutionSource: last?.resolutionSource || null,
                priceStatus: last?.priceStatus || 'unresolved', retryAfterMs: Number(last?.retryAfterMs || 0),
            });
            if (!RETRYABLE_SOURCES.has(last?.resolutionSource) || attempt >= this.maxRetries) return last;
            const rawRetryAfterMs = Math.max(0, Number(last?.retryAfterMs || 0));
            const retryAfterMs = Math.min(rawRetryAfterMs, this.maxRetryAfterMs);
            const exponential = this.baseBackoffMs * (2 ** attempt);
            const jitterMs = Math.floor(exponential * 0.25 * Number(this.jitter() || 0));
            await context.debug?.record?.('retry_scheduled', {
                attempt: attempt + 1, rawRetryAfterMs, cappedRetryAfterMs: retryAfterMs,
            });
            await this.sleep(Math.max(retryAfterMs, exponential + jitterMs), context.signal);
        }
        return last;
    }

    _record(price, diagnostics) {
        const status = price?.priceStatus || 'unresolved';
        if (status === 'priced') { diagnostics.priced += 1; diagnostics.resolved += 1; }
        else if (status === 'free') { diagnostics.free += 1; diagnostics.resolved += 1; }
        else if (status === 'not_for_sale') { diagnostics.notForSale += 1; diagnostics.resolved += 1; }
        else if (status === 'unavailable') { diagnostics.unavailable += 1; diagnostics.resolved += 1; }
        else diagnostics.unresolved += 1;
        const reason = String(price?.resolutionSource || 'unknown');
        diagnostics.reasonCounts[reason] = Number(diagnostics.reasonCounts[reason] || 0) + 1;
        if (reason === 'rate_limited') diagnostics.rateLimits += 1;
        else if (reason === 'timeout') diagnostics.timeouts += 1;
        else if (['api_failure', 'network_failure', 'exception'].includes(reason)) diagnostics.apiFailures += 1;
        else if (status === 'unresolved') diagnostics.resolutionFailures += 1;
    }
}

module.exports = {
    EpicPriceEnrichmentService, RETRYABLE_SOURCES, FAILURE_SOURCES, FINAL_PRICE_STATUSES,
    shouldRefreshCachedEpicPrice, sleep,
};
