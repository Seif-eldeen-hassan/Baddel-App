'use strict';

const {
    assertCoherentProgress,
    deriveProgressPercent,
    isValidTransferTuple,
} = require('../../domain/services/DownloadProgressReconciliation');

const DEFAULT_EMIT_INTERVAL_MS = 200;
const DEFAULT_SAMPLE_WINDOW_MS = 8000;
const DEFAULT_STALL_WARNING_MS = 30000;
const DEFAULT_HARD_STALL_MS = 2 * 60 * 1000;
const DEFAULT_SPEED_STALE_GRACE_MS = 1500;
const DEFAULT_HISTORY_LIMIT = 90;
const ACTIVITY_PHASE_DEBOUNCE_MS = 1500;
const PROVIDER_ETA_FRESH_MS = 5000;
const TELEMETRY_TERMINAL_STATUSES = new Set(['paused', 'pausing', 'cancelled', 'completed', 'failed']);

class DownloadTelemetryAggregator {
    constructor({
        clock = Date,
        emitIntervalMs = DEFAULT_EMIT_INTERVAL_MS,
        sampleWindowMs = DEFAULT_SAMPLE_WINDOW_MS,
        stallWarningMs = DEFAULT_STALL_WARNING_MS,
        hardStallMs = DEFAULT_HARD_STALL_MS,
        speedStaleGraceMs = DEFAULT_SPEED_STALE_GRACE_MS,
        historyLimit = DEFAULT_HISTORY_LIMIT,
    } = {}) {
        this.clock = clock;
        this.emitIntervalMs = emitIntervalMs;
        this.sampleWindowMs = sampleWindowMs;
        this.stallWarningMs = stallWarningMs;
        this.hardStallMs = hardStallMs;
        this.speedStaleGraceMs = speedStaleGraceMs;
        this.historyLimit = historyLimit;
        this.stateByTask = new Map();
    }

    reset(taskId, { sessionId = null, startedAt = null } = {}) {
        this.stateByTask.set(String(taskId), this.makeState(sessionId, startedAt));
    }

    clear(taskId) {
        this.stateByTask.delete(String(taskId));
    }

    apply(task = {}, sample = {}) {
        const taskId = String(task.id || sample.taskId || '');
        if (!taskId) return { patch: null, shouldEmit: false, meaningful: false };
        let state = this.stateByTask.get(taskId);
        if (!state || (sample.sessionId && state.sessionId && sample.sessionId !== state.sessionId)) {
            state = this.makeState(sample.sessionId || state?.sessionId || null, sample.timestamp);
            this.stateByTask.set(taskId, state);
        }

        const now = Number(sample.timestamp) || Date.now();
        if (!Number.isFinite(state.sessionStartedAt) || state.sessionStartedAt <= 0 || now < state.sessionStartedAt) state.sessionStartedAt = now;
        const patch = normalizeTelemetryPatch(task, normalizeSample(sample));
        const meaningful = hasAuthoritativeByteProgress(task, patch);
        const status = String(patch.status || task.status || '');
        const terminal = TELEMETRY_TERMINAL_STATUSES.has(status);

        updateProviderActivityState(state, patch, now);

        if (meaningful && Number.isFinite(Number(patch.downloadedBytes))) {
            if (!state.firstAuthoritativeProgressAt) state.firstAuthoritativeProgressAt = now;
            state.lastAuthoritativeProgressAt = now;
            state.lastMeaningfulProgressAt = now;
            state.samples.push({ at: now, bytes: Number(patch.downloadedBytes) });
            trimSamples(state.samples, now, this.sampleWindowMs);
            const rollingSpeed = calculateRollingSpeed(state.samples);
            if (Number.isFinite(rollingSpeed)) {
                state.smoothedSpeedBps = state.smoothedSpeedBps == null
                    ? rollingSpeed
                    : Math.round((state.smoothedSpeedBps * 0.7) + (rollingSpeed * 0.3));
            }
        }

        updateProviderTelemetryState(state, patch, now, this.historyLimit);
        applyFreshnessPolicy(state, patch, now, {
            terminal,
            speedStaleGraceMs: this.speedStaleGraceMs,
        });
        if (terminal) {
            state.smoothedSpeedBps = 0;
            state.etaSeconds = null;
            patch.downloadSpeedBps = 0;
            patch.diskUsageBps = 0;
            patch.rawDownloadSpeedBps = Number.isFinite(Number(patch.rawDownloadSpeedBps)) ? Number(patch.rawDownloadSpeedBps) : 0;
            patch.diskWriteSpeedBps = Number.isFinite(Number(patch.diskWriteSpeedBps)) ? Number(patch.diskWriteSpeedBps) : 0;
            patch.etaSeconds = null;
            patch.etaSource = null;
            patch.etaUpdatedAt = null;
            patch.networkState = 'idle';
            patch.telemetryState = 'idle';
        }

        if (!terminal && Number.isFinite(Number(patch.rawDownloadSpeedBps))) {
            patch.downloadSpeedBps = smoothSpeed(state.lastEffectiveDownloadSpeedBps, Number(patch.rawDownloadSpeedBps));
            state.lastEffectiveDownloadSpeedBps = patch.downloadSpeedBps;
            state.lastEffectiveDownloadSpeedAt = now;
        } else if (!terminal && state.smoothedSpeedBps != null && !Number.isFinite(Number(patch.downloadSpeedBps))) {
            patch.downloadSpeedBps = state.smoothedSpeedBps;
            state.lastEffectiveDownloadSpeedBps = patch.downloadSpeedBps;
            state.lastEffectiveDownloadSpeedAt = now;
        }

        const providerEta = Number(sample.etaSeconds);
        if (!terminal && Number.isFinite(providerEta) && providerEta > 0) {
            state.etaSeconds = providerEta;
            state.lastProviderEtaAt = now;
            patch.etaSeconds = providerEta;
            patch.etaSource = 'provider';
            patch.etaUpdatedAt = new Date(now).toISOString();
        } else if (terminal || (state.lastProviderEtaAt && now - state.lastProviderEtaAt >= PROVIDER_ETA_FRESH_MS)) {
            state.etaSeconds = null;
            patch.etaSeconds = null;
            patch.etaSource = null;
            patch.etaUpdatedAt = null;
        }

        applyTransferStageMessage(task, state, patch, { status, terminal, now });

        const liveness = applyTransferLivenessPolicy(task, state, patch, now, {
            status,
            stallWarningMs: this.stallWarningMs,
            hardStallMs: this.hardStallMs,
        });
        appendRuntimeTimingPatch(state, patch);

        const key = stablePatchKey(patch);
        const telemetryOnly = hasTelemetryOnlyChange(patch);
        const shouldEmit = key !== state.lastPatchKey && (
            meaningful ||
            now - state.lastEmitAt >= this.emitIntervalMs ||
            patch.status ||
            patch.errorCode ||
            (telemetryOnly && now - state.lastEmitAt >= this.emitIntervalMs)
        );
        if (shouldEmit) {
            state.lastEmitAt = now;
            state.lastPatchKey = key;
        }

        return { patch: assertCoherentProgress(patch), shouldEmit, meaningful, liveness };
    }

    makeState(sessionId = null, startedAt = null) {
        const suppliedStartedAt = startedAt == null ? null : Number(startedAt);
        const clockNow = typeof this.clock?.now === 'function'
            ? Number(this.clock.now())
            : Number(new this.clock().getTime());
        const sessionStartedAt = suppliedStartedAt != null && Number.isFinite(suppliedStartedAt)
            ? suppliedStartedAt
            : (Number.isFinite(clockNow) ? clockNow : Date.now());
        return {
            sessionId,
            sessionStartedAt,
            samples: [],
            chartSamples: [],
            lastEmitAt: 0,
            lastPatchKey: '',
            smoothedSpeedBps: null,
            etaSeconds: null,
            lastProviderEtaAt: null,
            stableStatusText: null,
            pendingStatusText: null,
            pendingStatusSince: null,
            firstProviderOutputAt: null,
            firstAuthoritativeProgressAt: null,
            lastAuthoritativeProgressAt: null,
            lastTransferCounterAt: null,
            lastProviderActivityAt: null,
            lastMeaningfulProgressAt: null,
            lastRawDownloadSpeedAt: null,
            lastDiskWriteSpeedAt: null,
            lastTransferCountersAt: null,
            lastEffectiveDownloadSpeedAt: null,
            lastEffectiveDownloadSpeedBps: null,
            lastDiskUsageBps: null,
            currentRawDownloadSpeedBps: null,
            currentDiskWriteSpeedBps: null,
            writtenAdvancedInSample: false,
            lastCounterAdvanceAt: null,
            lastPositiveNetworkAt: null,
            lastPositiveDiskAt: null,
            lastRawDownloadedBytes: null,
            lastWrittenBytes: null,
            lastChartDownloadSpeedBps: null,
            lastChartDiskSpeedBps: null,
        };
    }
}

function normalizeTelemetryPatch(task = {}, patch = {}) {
    const next = { ...patch };
    const patchDownloaded = Number(next.downloadedBytes);
    const patchTotal = Number(next.totalBytes);
    if (isValidTransferTuple(patchDownloaded, patchTotal)) {
        next.progressPercent = deriveProgressPercent(patchDownloaded, patchTotal);
        return next;
    }

    const currentDownloaded = Number(task.downloadedBytes);
    const currentTotal = Number(task.totalBytes);
    if (
        Number.isFinite(Number(next.progressPercent)) &&
        isValidTransferTuple(currentDownloaded, currentTotal) &&
        !Number.isFinite(patchDownloaded) &&
        !Number.isFinite(patchTotal)
    ) {
        next.progressPercent = deriveProgressPercent(currentDownloaded, currentTotal);
    }
    return next;
}

function normalizeSample(sample = {}) {
    const patch = {};
    for (const key of [
        'status', 'stage', 'statusMessage', 'providerActivity', 'progressPercent', 'downloadedBytes',
        'totalBytes', 'verifiedBytes', 'downloadSpeedBps', 'diskUsageBps',
        'downloadSizeBytes', 'downloadSizeSource',
        'etaSeconds', 'runtimeVersion', 'processPid', 'processStartedAt',
        'processExitedAt', 'providerProgressMode', 'progressSource',
        'providerReportedPercent', 'providerDownloadedBytes', 'providerTotalBytes',
        'transferDownloadedBytes', 'transferTotalBytes', 'totalBytesSource',
        'downloadedBytesSource', 'authoritativeTransfer', 'eventType',
        'writtenBytes', 'rawDownloadedBytes', 'rawDownloadSpeedBps',
        'decompressionSpeedBps', 'diskWriteSpeedBps', 'diskReadSpeedBps',
        'expectedTotalBytes', 'unexpectedTotalBytes', 'stableTotalBytes',
        'resumeBaseDownloadedBytes', 'sessionDownloadedBytes', 'sessionTotalBytes',
        'progressMode', 'telemetryState',
        'networkState', 'etaSource', 'etaUpdatedAt',
        'statusTextBeforeDebounce', 'statusTextAfterDebounce', 'statusChangeReason',
        'networkStateAtPhaseDecision', 'telemetryStateAtPhaseDecision',
        'stallReason', 'retryable', 'retryAfter',
        'autoResumeEligible', 'errorCode', 'errorMessage',
        'transientProviderWarningCode', 'transientProviderWarningMessage',
        'firstProviderOutputAt', 'firstAuthoritativeProgressAt',
        'lastAuthoritativeProgressAt', 'lastTransferCounterAt',
        'lastProviderActivityAt',
    ]) {
        if (Object.prototype.hasOwnProperty.call(sample, key)) patch[key] = sample[key];
    }
    return patch;
}

function toIso(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value)).toISOString() : null;
}

function appendRuntimeTimingPatch(state, patch) {
    const firstProviderOutputAt = toIso(state.firstProviderOutputAt);
    const firstAuthoritativeProgressAt = toIso(state.firstAuthoritativeProgressAt);
    const lastAuthoritativeProgressAt = toIso(state.lastAuthoritativeProgressAt);
    const lastTransferCounterAt = toIso(state.lastTransferCounterAt);
    const lastProviderActivityAt = toIso(state.lastProviderActivityAt);
    if (firstProviderOutputAt) patch.firstProviderOutputAt = firstProviderOutputAt;
    if (firstAuthoritativeProgressAt) patch.firstAuthoritativeProgressAt = firstAuthoritativeProgressAt;
    if (lastAuthoritativeProgressAt) patch.lastAuthoritativeProgressAt = lastAuthoritativeProgressAt;
    if (lastTransferCounterAt) patch.lastTransferCounterAt = lastTransferCounterAt;
    if (lastProviderActivityAt) patch.lastProviderActivityAt = lastProviderActivityAt;
}
function updateProviderActivityState(state, patch, now) {
    state.writtenAdvancedInSample = false;
    if (patch.eventType) {
        if (!state.firstProviderOutputAt) {
            state.firstProviderOutputAt = now;
        }

        state.lastProviderActivityAt = now;
    }

    const rawDownloadedBytes = Number(patch.rawDownloadedBytes);
    const writtenBytes = Number(patch.writtenBytes);
    const rawDownloadSpeedBps = Number(patch.rawDownloadSpeedBps);
    const diskWriteSpeedBps = Number(patch.diskWriteSpeedBps);

    let counterAdvanced = false;

    if (Number.isFinite(rawDownloadedBytes)) {
        if (
            (state.lastRawDownloadedBytes == null && rawDownloadedBytes > 0) ||
            (state.lastRawDownloadedBytes != null && rawDownloadedBytes > state.lastRawDownloadedBytes)
        ) {
            counterAdvanced = true;
        }

        state.lastRawDownloadedBytes = rawDownloadedBytes;
        state.lastTransferCounterAt = now;
        state.lastProviderActivityAt = now;
    }

    if (Number.isFinite(writtenBytes)) {
        if (
            (state.lastWrittenBytes == null && writtenBytes > 0) ||
            (state.lastWrittenBytes != null && writtenBytes > state.lastWrittenBytes)
        ) {
            counterAdvanced = true;
            state.writtenAdvancedInSample = true;
        }

        state.lastWrittenBytes = writtenBytes;
        state.lastTransferCounterAt = now;
        state.lastProviderActivityAt = now;
    }

    if (counterAdvanced) {
        state.lastCounterAdvanceAt = now;
    }

    if (Number.isFinite(rawDownloadSpeedBps)) {
        state.currentRawDownloadSpeedBps = Math.max(0, rawDownloadSpeedBps);
        if (!state.firstProviderOutputAt) {
            state.firstProviderOutputAt = now;
        }

        state.lastProviderActivityAt = now;

        if (rawDownloadSpeedBps > 0) {
            state.lastPositiveNetworkAt = now;
        }
    }

    if (Number.isFinite(diskWriteSpeedBps)) {
        state.currentDiskWriteSpeedBps = Math.max(0, diskWriteSpeedBps);
        state.lastProviderActivityAt = now;

        if (diskWriteSpeedBps > 0) {
            state.lastPositiveDiskAt = now;
        }
    }
}

function updateProviderTelemetryState(state, patch, now, historyLimit) {
    if (Number.isFinite(Number(patch.rawDownloadSpeedBps))) {
        state.lastRawDownloadSpeedAt = now;
        patch.networkState = Number(patch.rawDownloadSpeedBps) > 0 ? 'active' : 'idle';
    }
    if (Number.isFinite(Number(patch.diskWriteSpeedBps))) {
        state.lastDiskWriteSpeedAt = now;
        patch.telemetryState = Number(patch.diskWriteSpeedBps) > 0 ? 'active' : 'idle';
        patch.diskUsageBps = Number(patch.diskWriteSpeedBps);
        state.lastDiskUsageBps = patch.diskUsageBps;
    }
    if (Number.isFinite(Number(patch.rawDownloadedBytes)) || Number.isFinite(Number(patch.writtenBytes))) {
        state.lastTransferCountersAt = now;
        if (!patch.telemetryState) patch.telemetryState = 'active';
    }
    const incomingDownloadSpeed =
    Number.isFinite(Number(patch.downloadSpeedBps))
        ? Number(patch.downloadSpeedBps)
        : (
            Number.isFinite(Number(patch.rawDownloadSpeedBps))
                ? Number(patch.rawDownloadSpeedBps)
                : null
        );

    const incomingDiskSpeed =
        Number.isFinite(Number(patch.diskUsageBps))
            ? Number(patch.diskUsageBps)
            : (
                Number.isFinite(Number(patch.diskWriteSpeedBps))
                    ? Number(patch.diskWriteSpeedBps)
                    : null
            );

    if (incomingDownloadSpeed !== null) {
        state.lastChartDownloadSpeedBps =
            smoothChartSpeed(
                state.lastChartDownloadSpeedBps,
                incomingDownloadSpeed
            );
    }

    if (incomingDiskSpeed !== null) {
        state.lastDiskUsageBps = Math.max(0, incomingDiskSpeed);
        state.lastChartDiskSpeedBps =
            smoothChartSpeed(
                state.lastChartDiskSpeedBps,
                incomingDiskSpeed
            );
    }

    if (
        incomingDownloadSpeed !== null ||
        incomingDiskSpeed !== null
    ) {
        state.chartSamples.push({
            at: now,

            downloadSpeedBps: Math.max(
                0,
                Number(state.lastChartDownloadSpeedBps) || 0
            ),

            diskUsageBps: Math.max(
                0,
                Number(state.lastChartDiskSpeedBps) || 0
            ),
        });

        while (state.chartSamples.length > historyLimit) {
            state.chartSamples.shift();
        }

        patch.speedHistory =
            state.chartSamples.slice();
    }
}

function applyFreshnessPolicy(state, patch, now, { terminal, speedStaleGraceMs }) {
    if (terminal) return;
    if (!patch.networkState) {
        if (!state.lastRawDownloadSpeedAt && !state.lastEffectiveDownloadSpeedAt) patch.networkState = 'measuring';
        else if (now - Math.max(state.lastRawDownloadSpeedAt || 0, state.lastEffectiveDownloadSpeedAt || 0) > speedStaleGraceMs) {
            patch.networkState = 'stale';
            patch.downloadSpeedBps = decaySpeed(state.lastEffectiveDownloadSpeedBps, now, state.lastEffectiveDownloadSpeedAt, speedStaleGraceMs);
        }
    }
    if (!patch.telemetryState) {
        if (!state.lastDiskWriteSpeedAt && !state.lastTransferCountersAt) patch.telemetryState = 'measuring';
        else if (now - Math.max(state.lastDiskWriteSpeedAt || 0, state.lastTransferCountersAt || 0) > speedStaleGraceMs) {
            patch.telemetryState = 'stale';
            patch.diskUsageBps = decaySpeed(state.lastDiskUsageBps, now, state.lastDiskWriteSpeedAt, speedStaleGraceMs);
        }
    }
}

function applyTransferStageMessage(task, state, patch, { status, terminal, now }) {
    if (terminal || status !== 'downloading') return;
    const stage = String(patch.stage || task.stage || '').toLowerCase();
    if (['verifying', 'installing', 'paused', 'pausing', 'failed', 'stalled'].includes(stage)) return;
    if (patch.errorCode || task.errorCode) return;

    const downloaded = Number.isFinite(Number(patch.downloadedBytes)) ? Number(patch.downloadedBytes) : Number(task.downloadedBytes);
    const total = Number.isFinite(Number(patch.totalBytes)) ? Number(patch.totalBytes) : Number(task.totalBytes);
    const providerPercent = Number.isFinite(Number(patch.providerReportedPercent)) ? Number(patch.providerReportedPercent) : Number(patch.progressPercent);
    const transferComplete = (Number.isFinite(downloaded) && Number.isFinite(total) && total > 0 && downloaded >= total) || providerPercent >= 100;
    const networkActive = patch.networkState !== 'stale' && Number(state.currentRawDownloadSpeedBps) > 0;
    const diskActive = patch.telemetryState !== 'stale' && (Number(state.currentDiskWriteSpeedBps) > 0 || state.writtenAdvancedInSample === true);
    const before = state.stableStatusText || stripEtaFromStatus(task.statusMessage) || 'Preparing download';
    let candidate = before;
    let reason = 'no-active-sample-preserve';

    if (transferComplete) {
        candidate = 'Finalizing installation';
        reason = 'confirmed-transfer-complete';
        patch.stage = 'finalizing';
        patch.etaSeconds = null;
        patch.etaSource = null;
        patch.etaUpdatedAt = null;
    } else if (networkActive && diskActive) {
        candidate = 'Downloading and unpacking';
        reason = 'network-and-disk-active';
    } else if (diskActive) {
        candidate = 'Writing game files';
        reason = state.writtenAdvancedInSample ? 'written-bytes-advanced' : 'disk-active';
    } else if (networkActive) {
        candidate = 'Downloading compressed data';
        reason = 'network-active';
    }

    if (!state.stableStatusText || transferComplete) {
        state.stableStatusText = candidate;
        state.pendingStatusText = null;
        state.pendingStatusSince = null;
    } else if (candidate === state.stableStatusText) {
        state.pendingStatusText = null;
        state.pendingStatusSince = null;
    } else if (state.pendingStatusText !== candidate) {
        state.pendingStatusText = candidate;
        state.pendingStatusSince = now;
        reason = `debounce-start:${reason}`;
    } else if (now - state.pendingStatusSince >= ACTIVITY_PHASE_DEBOUNCE_MS) {
        state.stableStatusText = candidate;
        state.pendingStatusText = null;
        state.pendingStatusSince = null;
        reason = `debounce-commit:${reason}`;
    } else {
        reason = `debounce-hold:${reason}`;
    }

    patch.statusTextBeforeDebounce = before;
    patch.statusTextAfterDebounce = state.stableStatusText;
    patch.statusChangeReason = reason;
    patch.networkStateAtPhaseDecision = patch.networkState || task.networkState || null;
    patch.telemetryStateAtPhaseDecision = patch.telemetryState || task.telemetryState || null;
    patch.statusMessage = state.stableStatusText;
}

function stripEtaFromStatus(value) {
    return String(value || '').replace(/\s*\u00b7\s*[^|]*left\s*$/i, '').trim();
}

function applyTransferLivenessPolicy(
    task,
    state,
    patch,
    now,
    {
        status,
        stallWarningMs,
        hardStallMs,
    }
) {
    const summary = buildLivenessSummary(state, now, { stallWarningMs, hardStallMs });
    appendLivenessPatch(patch, summary);
    if (status !== 'downloading') return summary;

    const inactiveForMs = summary.realActivityStallDurationMs;
    if (inactiveForMs < stallWarningMs) {
        if (
            String(task.stage || '').toLowerCase() === 'stalled' ||
            task.stallReason
        ) {
            patch.stage = 'downloading';
            patch.stallReason = null;
            const currentMessage = String(patch.statusMessage || task.statusMessage || '');
            if (!currentMessage || /waiting for transfer|provider active|not advancing/i.test(currentMessage)) {
                patch.statusMessage = 'Downloading game files';
            }
        }
        return summary;
    }

    patch.statusMessage = 'Waiting for transfer activity';
    patch.stage = 'stalled';
    patch.stallReason = 'no-transfer-activity';
    patch.etaSeconds = null;
    patch.downloadSpeedBps = 0;
    patch.networkState = 'stale';

    if (!state.lastPositiveDiskAt && !state.lastCounterAdvanceAt) {
        patch.telemetryState = 'unsupported';
        patch.diskUsageBps = 0;
    } else {
        patch.telemetryState = 'stale';
        patch.diskUsageBps = 0;
    }

    if (inactiveForMs >= hardStallMs) {
        patch.errorCode = 'GOG_DOWNLOAD_STALLED';
        patch.errorMessage = 'No network, disk, or transfer-counter activity was detected.';
        patch.retryable = true;
        patch.autoResumeEligible = true;
    }
    return summary;
}

function buildLivenessSummary(state, now, { stallWarningMs, hardStallMs }) {
    const lastRealByteMovementAt = Math.max(
        state.lastAuthoritativeProgressAt || 0,
        state.lastCounterAdvanceAt || 0
    );
    const lastPositiveIoAt = Math.max(
        state.lastPositiveNetworkAt || 0,
        state.lastPositiveDiskAt || 0
    );
    const baselineAt = state.sessionStartedAt || now;
    const lastRealActivityAt = Math.max(lastRealByteMovementAt, lastPositiveIoAt, baselineAt);
    const providerReferenceAt = state.lastProviderActivityAt || baselineAt;
    const byteReferenceAt = lastRealByteMovementAt || baselineAt;
    const realActivityStallDurationMs = Math.max(0, now - lastRealActivityAt);
    return {
        sessionId: state.sessionId || null,
        sessionStartedAt: toIso(baselineAt),
        lastRealByteMovementAt: toIso(lastRealByteMovementAt),
        lastPositiveNetworkAt: toIso(state.lastPositiveNetworkAt),
        lastPositiveDiskAt: toIso(state.lastPositiveDiskAt),
        lastProviderActivityAt: toIso(state.lastProviderActivityAt),
        providerSilenceDurationMs: Math.max(0, now - providerReferenceAt),
        byteStallDurationMs: Math.max(0, now - byteReferenceAt),
        realActivityStallDurationMs,
        watchdogWarning: realActivityStallDurationMs >= stallWarningMs,
        hardStallDecision: realActivityStallDurationMs >= hardStallMs,
    };
}

function appendLivenessPatch(patch, summary) {
    patch.lastRealByteMovementAt = summary.lastRealByteMovementAt;
    patch.lastPositiveNetworkAt = summary.lastPositiveNetworkAt;
    patch.lastPositiveDiskAt = summary.lastPositiveDiskAt;
    patch.providerSilenceDurationMs = summary.providerSilenceDurationMs;
    patch.byteStallDurationMs = summary.byteStallDurationMs;
    patch.watchdogWarning = summary.watchdogWarning;
    patch.hardStallDecision = summary.hardStallDecision;
}

function smoothChartSpeed(previous, next) {
    const nextValue = Math.max(
        0,
        Number(next) || 0
    );

    const previousValue = Number(previous);

    if (
        !Number.isFinite(previousValue) ||
        previousValue <= 0
    ) {
        return Math.round(nextValue);
    }

    return Math.max(
        0,
        Math.round(
            previousValue * 0.78 +
            nextValue * 0.22
        )
    );
}

function smoothSpeed(previous, next) {
    if (!Number.isFinite(Number(previous))) return Math.max(0, Math.round(Number(next) || 0));
    return Math.max(0, Math.round((Number(previous) * 0.45) + (Number(next) * 0.55)));
}

function decaySpeed(value, now, lastAt, graceMs) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || !lastAt) return 0;
    const age = Math.max(0, now - lastAt - graceMs);
    const factor = Math.max(0, 1 - (age / graceMs));
    return Math.round(n * factor);
}

function hasTelemetryOnlyChange(patch = {}) {
    return [
        'eventType',
        'rawDownloadedBytes',
        'writtenBytes',
        'rawDownloadSpeedBps',
        'decompressionSpeedBps',
        'diskUsageBps',
        'diskWriteSpeedBps',
        'diskReadSpeedBps',
        'telemetryState',
        'networkState',
        'etaSource',
        'etaUpdatedAt',
        'providerActivity',
        'statusTextBeforeDebounce',
        'statusTextAfterDebounce',
        'statusChangeReason',
        'speedHistory',
        'errorCode',
        'errorMessage',
        'retryable',
        'autoResumeEligible', 'transientProviderWarningCode',
        'transientProviderWarningMessage',
    ].some(key => Object.prototype.hasOwnProperty.call(patch, key));
}

function hasAuthoritativeByteProgress(task = {}, patch = {}) {
    const nextBytes = Number(patch.downloadedBytes);
    const currentBytes = Number(task.downloadedBytes);
    const source = String(patch.progressSource || '');
    const authoritative = patch.authoritativeTransfer === true || (
        patch.providerProgressMode === 'absolute' &&
        (source === 'gogdl-overall-progress' || source === 'bytes')
    );
    if (!authoritative) return false;
    if (Number.isFinite(nextBytes) && (!Number.isFinite(currentBytes) || nextBytes > currentBytes)) return true;
    return false;
}

function trimSamples(samples, now, sampleWindowMs) {
    while (samples.length > 1 && now - samples[0].at > sampleWindowMs) samples.shift();
}

function calculateRollingSpeed(samples) {
    if (!Array.isArray(samples) || samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const deltaBytes = last.bytes - first.bytes;
    const deltaSeconds = (last.at - first.at) / 1000;
    if (deltaBytes <= 0 || deltaSeconds <= 0.1) return null;
    const speed = deltaBytes / deltaSeconds;
    if (!Number.isFinite(speed) || speed < 0) return null;
    return Math.round(speed);
}

function stablePatchKey(patch = {}) {
    return JSON.stringify({
        status: patch.status || null,
        stage: patch.stage || null,
        progressPercent: Number.isFinite(Number(patch.progressPercent)) ? Math.round(Number(patch.progressPercent) * 10) / 10 : null,
        downloadedBytes: Number.isFinite(Number(patch.downloadedBytes)) ? Math.round(Number(patch.downloadedBytes) / 1024) : null,
        totalBytes: Number.isFinite(Number(patch.totalBytes)) ? Math.round(Number(patch.totalBytes) / 1024) : null,
        speed: Number.isFinite(Number(patch.downloadSpeedBps)) ? Math.round(Number(patch.downloadSpeedBps) / 1024) : null,
        eventType: patch.eventType || null,
        rawDownloadedBytes: Number.isFinite(Number(patch.rawDownloadedBytes)) ? Math.round(Number(patch.rawDownloadedBytes) / 1024) : null,
        writtenBytes: Number.isFinite(Number(patch.writtenBytes)) ? Math.round(Number(patch.writtenBytes) / 1024) : null,
        rawDownloadSpeedBps: Number.isFinite(Number(patch.rawDownloadSpeedBps)) ? Math.round(Number(patch.rawDownloadSpeedBps) / 1024) : null,
        decompressionSpeedBps: Number.isFinite(Number(patch.decompressionSpeedBps)) ? Math.round(Number(patch.decompressionSpeedBps) / 1024) : null,
        diskUsageBps: Number.isFinite(Number(patch.diskUsageBps)) ? Math.round(Number(patch.diskUsageBps) / 1024) : null,
        diskWriteSpeedBps: Number.isFinite(Number(patch.diskWriteSpeedBps)) ? Math.round(Number(patch.diskWriteSpeedBps) / 1024) : null,
        diskReadSpeedBps: Number.isFinite(Number(patch.diskReadSpeedBps)) ? Math.round(Number(patch.diskReadSpeedBps) / 1024) : null,
        telemetryState: patch.telemetryState || null,
        networkState: patch.networkState || null,
        eta: Number.isFinite(Number(patch.etaSeconds)) ? Math.round(Number(patch.etaSeconds) / 5) : null,
        message: patch.statusMessage || null,
        providerActivity: patch.providerActivity || null,
        stallReason: patch.stallReason || null,
        errorCode: patch.errorCode || null,
        watchdogWarning: patch.watchdogWarning === true,
        hardStallDecision: patch.hardStallDecision === true,
    });
}

module.exports = {
    DownloadTelemetryAggregator,
};