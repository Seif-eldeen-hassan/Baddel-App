'use strict';

const PROGRESS_TOLERANCE_PERCENT = 0.25;

function clampPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
}

function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function isValidTransferTuple(downloadedBytes, totalBytes) {
    return (
        Number.isFinite(downloadedBytes) &&
        Number.isFinite(totalBytes) &&
        downloadedBytes >= 0 &&
        totalBytes > 0 &&
        downloadedBytes <= totalBytes
    );
}

function deriveProgressPercent(downloadedBytes, totalBytes) {
    if (!isValidTransferTuple(downloadedBytes, totalBytes)) return null;
    return clampPercent((downloadedBytes / totalBytes) * 100);
}

function currentTransferTuple(task = {}) {
    const downloadedBytes = finiteNumber(task.downloadedBytes);
    const totalBytes = finiteNumber(task.totalBytes);
    if (!isValidTransferTuple(downloadedBytes, totalBytes)) return null;
    return {
        downloadedBytes,
        totalBytes,
        progressPercent: deriveProgressPercent(downloadedBytes, totalBytes),
        providerProgressMode: task.providerProgressMode || null,
        progressSource: task.progressSource || task.totalBytesSource || 'checkpoint',
        totalBytesSource: task.totalBytesSource || 'checkpoint',
        downloadedBytesSource: task.downloadedBytesSource || 'checkpoint',
        isAuthoritative: false,
    };
}

function positiveFinite(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeFinite(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function stableGlobalTotal(task = {}) {
    return positiveFinite(task.stableTotalBytes) ||
        positiveFinite(task.expectedTotalBytes) ||
        positiveFinite(task.totalBytes) ||
        positiveFinite(task.checkpointTotalBytes) ||
        null;
}

function confirmedGlobalDownloaded(task = {}) {
    return nonNegativeFinite(task.downloadedBytes) ??
        nonNegativeFinite(task.checkpointDownloadedBytes) ??
        0;
}

function resumeBaseDownloaded(task = {}) {
    return nonNegativeFinite(task.resumeBaseDownloadedBytes) ??
        nonNegativeFinite(task.checkpointDownloadedBytes) ??
        confirmedGlobalDownloaded(task);
}

function isResumeSession(currentTask = {}, sessionId = null) {
    if (!currentTask.resumeStartedAt) return false;
    if (sessionId && currentTask.progressSessionId && sessionId !== currentTask.progressSessionId) return false;
    return Boolean(currentTask.checkpointSessionId && currentTask.progressSessionId && currentTask.checkpointSessionId !== currentTask.progressSessionId) ||
        nonNegativeFinite(currentTask.resumeBaseDownloadedBytes) !== null;
}

function tupleWithDiagnostics(currentTask, providerPatch, values) {
    const progressPercent = deriveProgressPercent(values.downloadedBytes, values.totalBytes);
    return {
        tuple: {
            sessionId: values.sessionId,
            providerProgressMode: values.providerProgressMode,
            downloadedBytes: values.downloadedBytes,
            totalBytes: values.totalBytes,
            progressPercent,
            providerReportedPercent: values.providerReportedPercent,
            providerDownloadedBytes: values.providerDownloadedBytes,
            providerTotalBytes: values.providerTotalBytes,
            sessionDownloadedBytes: values.sessionDownloadedBytes ?? null,
            sessionTotalBytes: values.sessionTotalBytes ?? null,
            resumeBaseDownloadedBytes: values.resumeBaseDownloadedBytes ?? null,
            stableTotalBytes: values.stableTotalBytes ?? values.totalBytes,
            progressMode: values.progressMode,
            progressSource: values.progressSource,
            totalBytesSource: values.totalBytesSource,
            downloadedBytesSource: values.downloadedBytesSource,
            isAuthoritative: values.isAuthoritative === true,
            timestamp: providerPatch.timestamp || Date.now(),
        },
        diagnostics: makeDiagnostics(currentTask, providerPatch, {
            sessionId: values.sessionId,
            providerProgressMode: values.providerProgressMode,
            providerReportedPercent: values.providerReportedPercent,
            acceptedDownloadedBytes: values.downloadedBytes,
            acceptedTotalBytes: values.totalBytes,
            derivedProgressPercent: progressPercent,
            totalBytesSource: values.totalBytesSource,
            reconciliationDecision: values.reconciliationDecision,
            resumeBaseDownloadedBytes: values.resumeBaseDownloadedBytes ?? null,
            stableTotalBytes: values.stableTotalBytes ?? values.totalBytes,
            sessionDownloadedBytes: values.sessionDownloadedBytes ?? null,
            sessionTotalBytes: values.sessionTotalBytes ?? null,
            rejectedDownloadedBytes: values.rejectedDownloadedBytes ?? null,
            rejectedTotalBytes: values.rejectedTotalBytes ?? null,
        }),
    };
}

function reconcileDownloadProgress(currentTask = {}, providerPatch = {}) {
    const sessionId = providerPatch.sessionId || currentTask.progressSessionId || null;
    const providerProgressMode = providerPatch.providerProgressMode || currentTask.providerProgressMode || null;
    const reportedPercent = finiteNumber(providerPatch.progressPercent);
    const patchHasDownloaded = hasOwn(providerPatch, 'downloadedBytes');
    const patchHasTotal = hasOwn(providerPatch, 'totalBytes');
    const downloadedBytes = finiteNumber(providerPatch.downloadedBytes);
    const totalBytes = finiteNumber(providerPatch.totalBytes);
    const source = providerPatch.progressSource || null;
    const absoluteAuthoritative = providerProgressMode === 'absolute' && patchHasDownloaded && patchHasTotal;
    const currentTuple = currentTransferTuple(currentTask);
    const stableTotal = stableGlobalTotal(currentTask);
    const currentDownloaded = confirmedGlobalDownloaded(currentTask);
    const resumeSession = isResumeSession(currentTask, sessionId);
    const resumeBase = resumeBaseDownloaded(currentTask);

    if (absoluteAuthoritative) {
        if (!isValidTransferTuple(downloadedBytes, totalBytes)) {
            return {
                tuple: null,
                diagnostics: makeDiagnostics(currentTask, providerPatch, {
                    sessionId,
                    providerProgressMode,
                    providerReportedPercent: reportedPercent,
                    rejectedDownloadedBytes: downloadedBytes,
                    rejectedTotalBytes: totalBytes,
                    reconciliationDecision: 'rejected-invalid-absolute-tuple',
                }),
            };
        }

        if (resumeSession && stableTotal && totalBytes < stableTotal) {
            const remainingTotal = Math.max(0, stableTotal - resumeBase);
            const looksSessionRelative = downloadedBytes <= totalBytes && (
                downloadedBytes <= remainingTotal || totalBytes <= Math.max(remainingTotal * 1.25, remainingTotal + (64 * 1024 * 1024))
            );
            if (looksSessionRelative) {
                const acceptedDownloaded = Math.min(stableTotal, Math.max(currentDownloaded, resumeBase + downloadedBytes));
                return tupleWithDiagnostics(currentTask, providerPatch, {
                    sessionId,
                    providerProgressMode: 'session-relative',
                    providerReportedPercent: reportedPercent,
                    providerDownloadedBytes: downloadedBytes,
                    providerTotalBytes: totalBytes,
                    sessionDownloadedBytes: downloadedBytes,
                    sessionTotalBytes: totalBytes,
                    resumeBaseDownloadedBytes: resumeBase,
                    stableTotalBytes: stableTotal,
                    downloadedBytes: acceptedDownloaded,
                    totalBytes: stableTotal,
                    progressMode: 'session-relative',
                    progressSource: 'provider-session-relative',
                    totalBytesSource: 'stable-global-total',
                    downloadedBytesSource: 'resume-base-plus-session',
                    isAuthoritative: true,
                    reconciliationDecision: downloadedBytes > 0 ? 'accepted-session-relative-progress' : 'preserved-resume-checkpoint-session-start',
                });
            }

            return {
                tuple: currentTuple ? {
                    ...currentTuple,
                    sessionId,
                    providerProgressMode: 'rejected-resume-denominator',
                    providerReportedPercent: reportedPercent,
                    providerDownloadedBytes: downloadedBytes,
                    providerTotalBytes: totalBytes,
                    sessionDownloadedBytes: downloadedBytes,
                    sessionTotalBytes: totalBytes,
                    resumeBaseDownloadedBytes: resumeBase,
                    stableTotalBytes: stableTotal,
                    progressMode: 'preserved-global',
                    timestamp: providerPatch.timestamp || Date.now(),
                } : null,
                diagnostics: makeDiagnostics(currentTask, providerPatch, {
                    sessionId,
                    providerProgressMode,
                    providerReportedPercent: reportedPercent,
                    acceptedDownloadedBytes: currentTuple?.downloadedBytes ?? null,
                    acceptedTotalBytes: currentTuple?.totalBytes ?? null,
                    derivedProgressPercent: currentTuple?.progressPercent ?? null,
                    totalBytesSource: currentTuple?.totalBytesSource || 'stable-global-total',
                    rejectedDownloadedBytes: downloadedBytes,
                    rejectedTotalBytes: totalBytes,
                    resumeBaseDownloadedBytes: resumeBase,
                    stableTotalBytes: stableTotal,
                    reconciliationDecision: 'rejected-smaller-resume-denominator',
                }),
            };
        }

        if (stableTotal && totalBytes < stableTotal && downloadedBytes < currentDownloaded) {
            return {
                tuple: currentTuple,
                diagnostics: makeDiagnostics(currentTask, providerPatch, {
                    sessionId,
                    providerProgressMode,
                    providerReportedPercent: reportedPercent,
                    acceptedDownloadedBytes: currentTuple?.downloadedBytes ?? null,
                    acceptedTotalBytes: currentTuple?.totalBytes ?? null,
                    derivedProgressPercent: currentTuple?.progressPercent ?? null,
                    rejectedDownloadedBytes: downloadedBytes,
                    rejectedTotalBytes: totalBytes,
                    stableTotalBytes: stableTotal,
                    reconciliationDecision: 'rejected-regressive-smaller-denominator',
                }),
            };
        }

        return tupleWithDiagnostics(currentTask, providerPatch, {
            sessionId,
            providerProgressMode,
            providerReportedPercent: reportedPercent,
            providerDownloadedBytes: downloadedBytes,
            providerTotalBytes: totalBytes,
            stableTotalBytes: totalBytes,
            downloadedBytes,
            totalBytes,
            progressMode: 'global-absolute',
            progressSource: 'provider-absolute',
            totalBytesSource: 'provider-absolute',
            downloadedBytesSource: 'provider-absolute',
            isAuthoritative: true,
            reconciliationDecision: 'accepted-provider-absolute',
        });
    }

    if (currentTuple && (patchHasDownloaded || patchHasTotal) && !(patchHasDownloaded && patchHasTotal)) {
        return {
            tuple: null,
            diagnostics: makeDiagnostics(currentTask, providerPatch, {
                sessionId,
                providerProgressMode,
                providerReportedPercent: reportedPercent,
                acceptedDownloadedBytes: currentTuple.downloadedBytes,
                acceptedTotalBytes: currentTuple.totalBytes,
                derivedProgressPercent: currentTuple.progressPercent,
                totalBytesSource: currentTuple.totalBytesSource,
                reconciliationDecision: 'preserved-existing-tuple-incomplete-sample',
            }),
        };
    }

    if (currentTuple && patchHasDownloaded && patchHasTotal && providerPatch.progressSource !== 'bytes') {
        return {
            tuple: null,
            diagnostics: makeDiagnostics(currentTask, providerPatch, {
                sessionId,
                providerProgressMode,
                providerReportedPercent: reportedPercent,
                acceptedDownloadedBytes: currentTuple.downloadedBytes,
                acceptedTotalBytes: currentTuple.totalBytes,
                derivedProgressPercent: currentTuple.progressPercent,
                totalBytesSource: currentTuple.totalBytesSource,
                reconciliationDecision: 'preserved-existing-tuple-nonauthoritative-sample',
            }),
        };
    }

    if (patchHasDownloaded && patchHasTotal && isValidTransferTuple(downloadedBytes, totalBytes)) {
        return tupleWithDiagnostics(currentTask, providerPatch, {
            sessionId,
            providerProgressMode,
            providerReportedPercent: reportedPercent,
            providerDownloadedBytes: downloadedBytes,
            providerTotalBytes: totalBytes,
            stableTotalBytes: totalBytes,
            downloadedBytes,
            totalBytes,
            progressMode: providerPatch.progressSource === 'bytes' ? 'global-absolute' : 'provider-tuple',
            progressSource: providerPatch.progressSource === 'bytes' ? 'provider-absolute' : 'provider-tuple',
            totalBytesSource: providerPatch.progressSource === 'bytes' ? 'provider-absolute' : 'provider-tuple',
            downloadedBytesSource: providerPatch.progressSource === 'bytes' ? 'provider-absolute' : 'provider-tuple',
            isAuthoritative: providerPatch.progressSource === 'bytes',
            reconciliationDecision: providerPatch.progressSource === 'bytes' ? 'accepted-byte-sourced-tuple' : 'accepted-provider-tuple',
        });
    }

    if (currentTuple && reportedPercent != null) {
        const corrected = deriveProgressPercent(currentTuple.downloadedBytes, currentTuple.totalBytes);
        return {
            tuple: {
                ...currentTuple,
                sessionId,
                providerProgressMode,
                progressPercent: corrected,
                providerReportedPercent: reportedPercent,
                timestamp: providerPatch.timestamp || Date.now(),
            },
            diagnostics: makeDiagnostics(currentTask, providerPatch, {
                sessionId,
                providerProgressMode,
                providerReportedPercent: reportedPercent,
                acceptedDownloadedBytes: currentTuple.downloadedBytes,
                acceptedTotalBytes: currentTuple.totalBytes,
                derivedProgressPercent: corrected,
                totalBytesSource: currentTuple.totalBytesSource,
                reconciliationDecision: 'rederived-existing-tuple-percent',
            }),
        };
    }

    if (reportedPercent != null && !patchHasDownloaded && !patchHasTotal) {
        return {
            tuple: {
                sessionId,
                providerProgressMode,
                downloadedBytes: null,
                totalBytes: null,
                progressPercent: clampPercent(reportedPercent),
                providerReportedPercent: reportedPercent,
                progressSource: providerPatch.progressSource || 'provider-percent',
                totalBytesSource: 'unknown',
                downloadedBytesSource: 'unknown',
                isAuthoritative: false,
                timestamp: providerPatch.timestamp || Date.now(),
            },
            diagnostics: makeDiagnostics(currentTask, providerPatch, {
                sessionId,
                providerProgressMode,
                providerReportedPercent: reportedPercent,
                derivedProgressPercent: clampPercent(reportedPercent),
                totalBytesSource: 'unknown',
                reconciliationDecision: 'accepted-percent-only',
            }),
        };
    }

    return {
        tuple: null,
        diagnostics: makeDiagnostics(currentTask, providerPatch, {
            sessionId,
            providerProgressMode,
            providerReportedPercent: reportedPercent,
            reconciliationDecision: 'no-progress-tuple',
        }),
    };
}

function makeProgressPatch(tuple = {}) {
    if (!tuple) return {};
    const patch = {
        progressPercent: tuple.progressPercent,
        providerReportedPercent: tuple.providerReportedPercent ?? null,
        providerProgressMode: tuple.providerProgressMode || null,
        totalBytesSource: tuple.totalBytesSource || 'unknown',
        downloadedBytesSource: tuple.downloadedBytesSource || 'unknown',
        progressSource: tuple.progressSource || 'unknown',
        progressMode: tuple.progressMode || null,
    };
    for (const key of ['stableTotalBytes', 'resumeBaseDownloadedBytes', 'sessionDownloadedBytes', 'sessionTotalBytes']) {
        if (Number.isFinite(Number(tuple[key]))) patch[key] = Number(tuple[key]);
    }
    if (Number.isFinite(tuple.downloadedBytes)) {
        patch.downloadedBytes = tuple.downloadedBytes;
        patch.transferDownloadedBytes = tuple.downloadedBytes;
        patch.providerDownloadedBytes = tuple.providerDownloadedBytes ?? tuple.downloadedBytes;
    }
    if (Number.isFinite(tuple.totalBytes)) {
        patch.totalBytes = tuple.totalBytes;
        patch.transferTotalBytes = tuple.totalBytes;
        patch.providerTotalBytes = tuple.providerTotalBytes ?? tuple.totalBytes;
    }
    return patch;
}

function assertCoherentProgress(patch = {}) {
    const downloadedBytes = finiteNumber(patch.downloadedBytes);
    const totalBytes = finiteNumber(patch.totalBytes);
    if (!isValidTransferTuple(downloadedBytes, totalBytes)) return patch;
    const derived = deriveProgressPercent(downloadedBytes, totalBytes);
    const reported = finiteNumber(patch.progressPercent);
    if (reported == null || Math.abs(reported - derived) > PROGRESS_TOLERANCE_PERCENT) {
        return {
            ...patch,
            progressPercent: derived,
            progressInvariantRepaired: true,
        };
    }
    return {
        ...patch,
        progressPercent: derived,
    };
}

function makeDiagnostics(currentTask = {}, providerPatch = {}, result = {}) {
    return {
        taskId: currentTask.id || providerPatch.taskId || null,
        sessionId: result.sessionId || providerPatch.sessionId || currentTask.progressSessionId || null,
        providerProgressMode: result.providerProgressMode || providerPatch.providerProgressMode || currentTask.providerProgressMode || null,
        providerReportedPercent: result.providerReportedPercent ?? finiteNumber(providerPatch.progressPercent),
        providerDownloadedBytes: finiteNumber(providerPatch.downloadedBytes),
        providerTotalBytes: finiteNumber(providerPatch.totalBytes),
        resumeBaseDownloadedBytes: result.resumeBaseDownloadedBytes ?? null,
        stableTotalBytes: result.stableTotalBytes ?? null,
        sessionDownloadedBytes: result.sessionDownloadedBytes ?? null,
        sessionTotalBytes: result.sessionTotalBytes ?? null,
        rejectedDownloadedBytes: result.rejectedDownloadedBytes ?? null,
        rejectedTotalBytes: result.rejectedTotalBytes ?? null,
        previousDownloadedBytes: finiteNumber(currentTask.downloadedBytes),
        previousTotalBytes: finiteNumber(currentTask.totalBytes),
        acceptedDownloadedBytes: result.acceptedDownloadedBytes ?? null,
        acceptedTotalBytes: result.acceptedTotalBytes ?? null,
        derivedProgressPercent: result.derivedProgressPercent ?? null,
        totalBytesSource: result.totalBytesSource || null,
        reconciliationDecision: result.reconciliationDecision || 'unknown',
    };
}

module.exports = {
    PROGRESS_TOLERANCE_PERCENT,
    assertCoherentProgress,
    clampPercent,
    deriveProgressPercent,
    isValidTransferTuple,
    makeProgressPatch,
    reconcileDownloadProgress,
};
