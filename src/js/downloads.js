(function downloadsModule() {
    'use strict';

    let downloadsSnapshot = null;
    let downloadsUnsubscribers = [];
    const downloadsPendingActions = new Set();
    const downloadsChartBuffers = new Map();
    const DOWNLOAD_CHART_LIMIT = 90;
    const downloadPresentationStates = new Map();
    let downloadsPresentationTimer = null;

    const DOWNLOAD_PRESENTATION_TICK_MS = 250;
    const DOWNLOAD_PRESENTATION_FRESH_MS = 1500;
    const DOWNLOAD_PRESENTATION_STOP_MS = 4000;
    const DOWNLOAD_PRESENTATION_LEAD_BUFFER_SECONDS = 3;
    const DOWNLOAD_PRESENTATION_MAX_PROJECTION_SECONDS = 120;
    const DOWNLOAD_PRESENTATION_MIN_LEAD_BYTES = 2 * 1024 * 1024;

    const DOWNLOAD_PRESENTATION_ACTIVE_STATUSES = new Set([
        'preparing',
        'downloading',
        'verifying',
        'installing',
    ]);

    function dlEsc(value) {
        if (typeof escapeHtml === 'function') return escapeHtml(value);
        return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function dlCssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value ?? ''));
        return String(value ?? '').replace(/["\\]/g, '\\$&');
    }

    function dlFormatBytes(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = n;
        let idx = 0;
        while (value >= 1000 && idx < units.length - 1) {
            value /= 1000;
            idx += 1;
        }
        return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
    }

    function dlFormatRate(bytes, task = {}) {
        const n = Number(bytes);
        const state = String(task?.networkState || task?.telemetryState || '');
        if (!Number.isFinite(n)) return state === 'unsupported' ? 'Unsupported' : 'Measuring';
        if (n <= 0) {
            if (['paused', 'completed', 'cancelled', 'failed'].includes(String(task?.status))) return '0 B/s';
            if (state === 'stale') return 'Stale';
            return 'Measuring';
        }
        return `${dlFormatBytes(n)}/s`;
    }

    function dlFormatDuration(seconds) {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        if (!total) return 'Calculating';
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        if (hours > 0) return `${hours}h ${minutes}m left`;
        if (minutes > 0) return `${minutes}m ${secs}s left`;
        return `${secs}s left`;
    }

    function getDisplayDownloadedBytes(task = {}) {
        const authoritativeBytes = Number(task.downloadedBytes);
        const writtenBytes = Number(task.writtenBytes);
        const totalBytes = Number(task.totalBytes);

        const authoritative = Number.isFinite(authoritativeBytes)
            ? Math.max(0, authoritativeBytes)
            : 0;

        const written = Number.isFinite(writtenBytes)
            ? Math.max(0, writtenBytes)
            : 0;

        let displayedBytes = Math.max(authoritative, written);

        if (Number.isFinite(totalBytes) && totalBytes > 0) {
            displayedBytes = Math.min(displayedBytes, totalBytes);
        }

        return displayedBytes;
    }

    function dlPresentationNow() {
    if (
        typeof performance !== 'undefined' &&
        typeof performance.now === 'function'
    ) {
        return performance.now();
    }

    return Date.now();
}

    function dlHasOwn(object, key) {
        return Boolean(
            object &&
            Object.prototype.hasOwnProperty.call(object, key)
        );
    }

    function dlFinitePositive(value) {
        const number = Number(value);

        return Number.isFinite(number) && number > 0
            ? number
            : 0;
    }

    function dlPresentationSessionId(task = {}) {
        return String(
            task.progressSessionId ||
            task.sessionId ||
            ''
        );
    }

    function dlBestPresentationRate(source = {}) {
        const candidates = [
            dlFinitePositive(source.decompressionSpeedBps),
            dlFinitePositive(source.downloadSpeedBps),
            dlFinitePositive(source.rawDownloadSpeedBps),
            dlFinitePositive(source.diskWriteSpeedBps),
        ];

        return candidates.find(value => value > 0) || 0;
    }

    function dlCreatePresentationState(task = {}, now = dlPresentationNow()) {
        const confirmedBytes = getDisplayDownloadedBytes(task);
        const totalBytes = Number(task.totalBytes);
        const safeConfirmedBytes = Number.isFinite(totalBytes) && totalBytes > 0
            ? Math.min(confirmedBytes, totalBytes)
            : confirmedBytes;
        const initialRate = dlBestPresentationRate(task);
        const initialEta = Number(task.etaSeconds);

        return {
            sessionId: dlPresentationSessionId(task),

            displayedBytes: safeConfirmedBytes,
            targetBytes: safeConfirmedBytes,
            lastConfirmedBytes: safeConfirmedBytes,
            preserveDisplayAcrossResume: false,
            lastConfirmedAt: now,

            displayedRateBps: initialRate,
            displayedEtaSeconds:
                Number.isFinite(initialEta) && initialEta > 0
                    ? initialEta
                    : null,

            lastTickAt: now,
            lastActivityAt: initialRate > 0 ? now : 0,

            lastRawDownloadedBytes:
                Number.isFinite(Number(task.rawDownloadedBytes))
                    ? Number(task.rawDownloadedBytes)
                    : null,

            lastWrittenBytes:
                Number.isFinite(Number(task.writtenBytes))
                    ? Number(task.writtenBytes)
                    : null,
        };
    }

    function dlSyncPresentationState(task = {}, incomingPatch = null) {
        const taskId = String(task.id || '');

        if (!taskId) {
            return null;
        }

        const now = dlPresentationNow();
        const sessionId = dlPresentationSessionId(task);

        let state = downloadPresentationStates.get(taskId);

        if (!state) {
            state = dlCreatePresentationState(task, now);
            downloadPresentationStates.set(taskId, state);
        } else {
            const sessionChanged =
                Boolean(
                    sessionId &&
                    state.sessionId &&
                    sessionId !== state.sessionId
                );

            if (sessionChanged) {
                const shouldPreserveDisplay =
                    state.preserveDisplayAcrossResume === true;

                const carriedDisplayedBytes =
                    Number(state.displayedBytes) || 0;

                const carriedEtaSeconds =
                    Number.isFinite(Number(state.displayedEtaSeconds))
                        ? Number(state.displayedEtaSeconds)
                        : null;

                const nextState =
                    dlCreatePresentationState(task, now);

                if (shouldPreserveDisplay) {
                    const canonicalBytes = getDisplayDownloadedBytes(task);
                    const canonicalTotal = Number(task.totalBytes);
                    const safeCarriedBytes = Number.isFinite(canonicalTotal) && canonicalTotal > 0
                        ? Math.min(carriedDisplayedBytes, canonicalTotal)
                        : Math.min(carriedDisplayedBytes, canonicalBytes);
                    nextState.displayedBytes = Math.max(
                        nextState.displayedBytes,
                        safeCarriedBytes
                    );

                    nextState.targetBytes = Math.max(
                        nextState.targetBytes,
                        nextState.displayedBytes
                    );

                    if (carriedEtaSeconds !== null) {
                        nextState.displayedEtaSeconds =
                            carriedEtaSeconds;
                    }
                }

                nextState.preserveDisplayAcrossResume = false;

                state = nextState;

                downloadPresentationStates.set(
                    taskId,
                    state
                );
            }
        }

        if (sessionId) {
            state.sessionId = sessionId;
        }

        const confirmedBytes = getDisplayDownloadedBytes(task);
        const canonicalTotal = Number(task.totalBytes);
        const safeConfirmedBytes = Number.isFinite(canonicalTotal) && canonicalTotal > 0
            ? Math.min(confirmedBytes, canonicalTotal)
            : confirmedBytes;
        const rawDownloadedBytes = Number(task.rawDownloadedBytes);
        const writtenBytes = Number(task.writtenBytes);

        const confirmedAdvanced =
            safeConfirmedBytes > state.lastConfirmedBytes;
        if (confirmedAdvanced) {
            state.lastConfirmedAt = now;
        }
        const rawAdvanced =
            Number.isFinite(rawDownloadedBytes) &&
            (
                state.lastRawDownloadedBytes == null ||
                rawDownloadedBytes > state.lastRawDownloadedBytes
            );

        const writtenAdvanced =
            Number.isFinite(writtenBytes) &&
            (
                state.lastWrittenBytes == null ||
                writtenBytes > state.lastWrittenBytes
            );

        if (
            confirmedAdvanced ||
            rawAdvanced ||
            writtenAdvanced
        ) {
            state.lastActivityAt = now;
        }

        state.lastConfirmedBytes = Math.max(
            state.lastConfirmedBytes,
            safeConfirmedBytes
        );

        state.targetBytes = Math.max(
            state.targetBytes,
            safeConfirmedBytes
        );

        if (Number.isFinite(rawDownloadedBytes)) {
            state.lastRawDownloadedBytes = rawDownloadedBytes;
        }

        if (Number.isFinite(writtenBytes)) {
            state.lastWrittenBytes = writtenBytes;
        }

        let patchRate = incomingPatch
            ? dlBestPresentationRate(incomingPatch)
            : 0;

        if (
            patchRate <= 0 &&
            Array.isArray(incomingPatch?.speedHistory) &&
            incomingPatch.speedHistory.length
        ) {
            const latestSample =
                incomingPatch.speedHistory[
                    incomingPatch.speedHistory.length - 1
                ];

            patchRate = dlBestPresentationRate({
                downloadSpeedBps:
                    latestSample?.downloadSpeedBps,

                diskWriteSpeedBps:
                    latestSample?.diskUsageBps,
            });
        }

        if (patchRate > 0) {
            state.lastActivityAt = now;

            state.displayedRateBps =
                state.displayedRateBps > 0
                    ? Math.round(
                        state.displayedRateBps * 0.65 +
                        patchRate * 0.35
                    )
                    : Math.round(patchRate);
        }

        const status = String(task.status || '');

        if (status === 'completed') {
            const totalBytes = Number(task.totalBytes);

            if (Number.isFinite(totalBytes) && totalBytes > 0) {
                state.displayedBytes = totalBytes;
                state.targetBytes = totalBytes;
            } else {
                state.displayedBytes = Math.max(
                    state.displayedBytes,
                    safeConfirmedBytes
                );
            }

            state.displayedRateBps = 0;
            state.displayedEtaSeconds = 0;
            state.lastTickAt = now;
        } else if (
            ['paused', 'failed', 'cancelled'].includes(status)
        ) {
            state.displayedRateBps = 0;
            state.lastTickAt = now;

            if (status !== 'paused') {
                state.preserveDisplayAcrossResume = false;
            }
        }

        return state;
    }

    function dlFreshPresentationRate(state, now) {
        const rate = Number(state?.displayedRateBps);

        if (!Number.isFinite(rate) || rate <= 0) {
            return 0;
        }

        if (!state.lastActivityAt) {
            return 0;
        }

        const age = Math.max(
            0,
            now - state.lastActivityAt
        );

        if (age <= DOWNLOAD_PRESENTATION_FRESH_MS) {
            return rate;
        }

        if (age >= DOWNLOAD_PRESENTATION_STOP_MS) {
            return 0;
        }

        const fadeDuration =
            DOWNLOAD_PRESENTATION_STOP_MS -
            DOWNLOAD_PRESENTATION_FRESH_MS;

        const fadeProgress =
            (age - DOWNLOAD_PRESENTATION_FRESH_MS) /
            fadeDuration;

        return Math.max(
            0,
            rate * (1 - fadeProgress)
        );
    }

    function dlAdvancePresentationState(task, state, now) {
        if (!task || !state) {
            return false;
        }

        const status = String(task.status || '');

        if (!DOWNLOAD_PRESENTATION_ACTIVE_STATUSES.has(status)) {
            state.lastTickAt = now;
            return false;
        }

        const elapsedSeconds = Math.min(
            1,
            Math.max(
                0,
                (now - state.lastTickAt) / 1000
            )
        );

        state.lastTickAt = now;

        if (elapsedSeconds <= 0) {
            return false;
        }

        const rate = dlFreshPresentationRate(state, now);
        const confirmedBytes = getDisplayDownloadedBytes(task);
        const canonicalTotal = Number(task.totalBytes);
        const safeConfirmedBytes = Number.isFinite(canonicalTotal) && canonicalTotal > 0
            ? Math.min(confirmedBytes, canonicalTotal)
            : confirmedBytes;

        state.targetBytes = Math.max(
            state.targetBytes,
            safeConfirmedBytes
        );

        const targetGap = Math.max(
            0,
            state.targetBytes - state.displayedBytes
        );

        const normalStep = rate * elapsedSeconds;

        const catchUpFactor = Math.min(
            0.35,
            elapsedSeconds * 2.4
        );

        const catchUpStep =
            targetGap > 0
                ? Math.min(
                    targetGap,
                    Math.max(
                        normalStep,
                        targetGap * catchUpFactor
                    )
                )
                : 0;

        let nextBytes =
            state.displayedBytes +
            normalStep +
            catchUpStep;

        const confirmedAgeSeconds = Math.max(
            0,
            (
                now -
                (
                    state.lastConfirmedAt ||
                    now
                )
            ) / 1000
        );

        const projectionSeconds = Math.min(
            DOWNLOAD_PRESENTATION_MAX_PROJECTION_SECONDS,
            confirmedAgeSeconds +
                DOWNLOAD_PRESENTATION_LEAD_BUFFER_SECONDS
        );

        const maximumLeadBytes = Math.max(
            DOWNLOAD_PRESENTATION_MIN_LEAD_BYTES,
            rate * projectionSeconds
        );

        const leadCeiling =
            Math.max(
                safeConfirmedBytes,
                state.targetBytes
            ) + maximumLeadBytes;

        nextBytes = Math.min(
            nextBytes,
            leadCeiling
        );

        const totalBytes = Number(task.totalBytes);

        if (Number.isFinite(totalBytes) && totalBytes > 0) {
            const completionCap =
                status === 'completed'
                    ? totalBytes
                    : totalBytes * 0.995;

            nextBytes = Math.min(
                nextBytes,
                completionCap
            );
        }

        nextBytes = Math.max(
            state.displayedBytes,
            safeConfirmedBytes,
            nextBytes
        );

        const changed =
            nextBytes - state.displayedBytes >= 1;

        state.displayedBytes = nextBytes;

        if (
            rate >= 1024 &&
            Number.isFinite(totalBytes) &&
            totalBytes > state.displayedBytes
        ) {
            const nextEta =
                (totalBytes - state.displayedBytes) /
                rate;

            state.displayedEtaSeconds =
                state.displayedEtaSeconds == null
                    ? nextEta
                    : (
                        state.displayedEtaSeconds * 0.8 +
                        nextEta * 0.2
                    );
        }

        return changed;
    }

    function dlPresentedBytes(task = {}) {
        const state = dlSyncPresentationState(task);

        return state
            ? state.displayedBytes
            : getDisplayDownloadedBytes(task);
    }

    function dlPresentedPercent(task = {}) {
        const displayedBytes = dlPresentedBytes(task);
        const totalBytes = Number(task.totalBytes);

        if (
            Number.isFinite(displayedBytes) &&
            Number.isFinite(totalBytes) &&
            displayedBytes >= 0 &&
            totalBytes > 0
        ) {
            return Math.max(
                0,
                Math.min(
                    100,
                    (displayedBytes / totalBytes) * 100
                )
            );
        }

        const progressPercent = Number(task.progressPercent);

        return Number.isFinite(progressPercent)
            ? Math.max(0, Math.min(100, progressPercent))
            : null;
    }

    function dlPresentedRate(task = {}) {
        const state = dlSyncPresentationState(task);

        if (!state) {
            return Number(task.downloadSpeedBps) || 0;
        }

        return dlFreshPresentationRate(
            state,
            dlPresentationNow()
        );
    }

    function dlPresentedEta(task = {}) {
        const state = dlSyncPresentationState(task);

        if (
            state &&
            Number.isFinite(Number(state.displayedEtaSeconds))
        ) {
            return Math.max(
                0,
                Number(state.displayedEtaSeconds)
            );
        }

        const taskEta = Number(task.etaSeconds);

        return Number.isFinite(taskEta)
            ? taskEta
            : null;
    }

    function dlCleanupPresentationStates(tasks = []) {
        const currentIds = new Set(
            tasks.map(task => String(task.id || ''))
        );

        for (const taskId of downloadPresentationStates.keys()) {
            if (!currentIds.has(taskId)) {
                downloadPresentationStates.delete(taskId);
            }
        }
    }

    function dlPatchPresentationDom(task, state) {
        if (!task || !state) {
            return;
        }

        const card = document.querySelector(
            `[data-download-task-id="${dlCssEscape(task.id)}"]`
        );

        if (!card) {
            return;
        }

        const percent = dlPresentedPercent(task);
        const fill = card.querySelector(
            '.download-progress-fill'
        );

        const label = card.querySelector(
            '.download-progress-percent'
        );

        if (fill && percent !== null) {
            fill.style.width =
                `${Math.max(0, Math.min(100, percent))}%`;

            fill.style.opacity = '';
        }

        if (label && percent !== null) {
            label.textContent = `${percent.toFixed(1)}%`;
        }

        setText(
            card,
            'downloaded',
            `${dlFormatBytes(state.displayedBytes)}${
                task.totalBytes
                    ? ` / ${dlFormatBytes(task.totalBytes)}`
                    : ''
            }`
        );

        const visibleRate = dlFreshPresentationRate(
            state,
            dlPresentationNow()
        );

        setText(
            card,
            'speed',
            dlFormatRate(
                visibleRate || task.downloadSpeedBps,
                task
            )
        );

        const etaSeconds = dlPresentedEta(task);

        const etaText =
            Number.isFinite(Number(etaSeconds)) &&
            Number(etaSeconds) > 0
                ? dlFormatDuration(etaSeconds)
                : 'Calculating';

        setText(card, 'eta', etaText);
        setText(card, 'eta-top', etaText);
    }

    function dlFreezePresentationForPause(taskId) {
        const task = Array.isArray(downloadsSnapshot?.tasks)
            ? downloadsSnapshot.tasks.find(
                item => String(item.id) === String(taskId)
            )
            : null;

        if (!task) {
            return;
        }

        const state =
            dlSyncPresentationState(task);

        if (!state) {
            return;
        }

        const now =
            dlPresentationNow();

        // حدّث الرقم حتى لحظة الضغط نفسها.
        dlAdvancePresentationState(
            task,
            state,
            now
        );

        state.displayedBytes = Math.max(
            Number(state.displayedBytes) || 0,
            getDisplayDownloadedBytes(task)
        );

        state.targetBytes = Math.max(
            Number(state.targetBytes) || 0,
            state.displayedBytes
        );

        state.preserveDisplayAcrossResume = true;
        state.displayedRateBps = 0;
        state.lastTickAt = now;
    }

    function tickDownloadPresentations() {
        const tasks = Array.isArray(downloadsSnapshot?.tasks)
            ? downloadsSnapshot.tasks
            : [];

        const now = dlPresentationNow();

        for (const task of tasks) {
            const state = dlSyncPresentationState(task);

            if (!state) {
                continue;
            }

            const changed = dlAdvancePresentationState(
                task,
                state,
                now
            );

            if (changed) {
                dlPatchPresentationDom(task, state);
            }
        }
    }

    function startDownloadPresentationTimer() {
        if (downloadsPresentationTimer) {
            return;
        }

        downloadsPresentationTimer = setInterval(
            tickDownloadPresentations,
            DOWNLOAD_PRESENTATION_TICK_MS
        );
    }

    function dlPlatformLabel(platform) {
        const p = String(platform || '').toLowerCase();
        if (p === 'gog') return 'GOG';
        if (p === 'epic') return 'Epic Games';
        return p || 'Unknown';
    }

    function getEffectiveTransferPercent(task) {
        const downloadedBytes = dlPresentedBytes(task);
        const totalBytes = Number(task?.totalBytes);
        if (
            Number.isFinite(downloadedBytes) &&
            Number.isFinite(totalBytes) &&
            downloadedBytes >= 0 &&
            totalBytes > 0 &&
            downloadedBytes <= totalBytes
        ) {
            return Math.max(0, Math.min(100, (downloadedBytes / totalBytes) * 100));
        }
        const n = Number(task?.progressPercent);
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    }

    function dlCleanStatus(task) {
        const stage = String(task?.stage || task?.status || '').toLowerCase();
        const raw = String(task?.statusMessage || '').trim();
        const failure = task?.failureDetails && typeof task.failureDetails === 'object' ? task.failureDetails : null;
        if (task?.status === 'failed' && failure?.userMessage) return String(failure.userMessage).replace(/\s+/g, ' ').slice(0, 140);
        if (/^\[?PROGRESS INFO/i.test(raw) || /Progress:\s*\d/i.test(raw)) {
            if (stage === 'verifying') return 'Verifying files';
            if (stage === 'installing') return 'Finishing installation';
            return 'Downloading game files';
        }
        if (!raw) {
            if (task?.status === 'pending') return 'Waiting in queue';
            if (task?.status === 'paused') return 'Paused';
            if (task?.status === 'failed') return 'Needs attention';
            if (task?.status === 'completed') return 'Ready to play';
            return 'Preparing download';
        }
        if (/\[GENERIC[_ ]DOWNLOAD_MANAGER\]/i.test(raw) || /\[V2\]\s+INFO/i.test(raw)) {
            return task?.status === 'failed' ? 'GOG download needs attention' : 'Preparing GOG download';
        }
        return raw.replace(/\s+/g, ' ').slice(0, 90);
    }

    function dlStatCard(label, valueHtml) {
        return `<div class="download-stat-card"><span>${dlEsc(label)}</span><strong>${valueHtml}</strong></div>`;
    }

    function dlDownloadedText(task) {
        const displayedBytes = dlPresentedBytes(task);

        return `${dlFormatBytes(displayedBytes)}${
            task.totalBytes
                ? ` / ${dlFormatBytes(task.totalBytes)}`
                : ''
        }`;
    }

    function dlTaskChartSamples(task = {}) {
        const id = String(task.id || '');
        const incoming = Array.isArray(task.speedHistory) ? task.speedHistory : null;
        if (incoming && incoming.length) {
            const normalized = incoming.slice(-DOWNLOAD_CHART_LIMIT).map(sample => ({
                at: Number(sample.at) || Date.now(),
                downloadSpeedBps: Math.max(0, Number(sample.downloadSpeedBps) || 0),
                diskUsageBps: Math.max(0, Number(sample.diskUsageBps) || 0),
            }));
            downloadsChartBuffers.set(id, normalized);
            return normalized;
        }
        const existing = downloadsChartBuffers.get(id) || [];
        if (['completed', 'failed', 'cancelled', 'paused'].includes(String(task.status))) {
            if (existing.length && existing[existing.length - 1].downloadSpeedBps !== 0) {
                existing.push({ at: Date.now(), downloadSpeedBps: 0, diskUsageBps: 0 });
                while (existing.length > DOWNLOAD_CHART_LIMIT) existing.shift();
            }
            downloadsChartBuffers.set(id, existing);
        }
        return existing;
    }

    function dlBuildSmoothChartPath(
        samples,
        key,
        width,
        height,
        maxValue
    ) {
        if (!Array.isArray(samples) || samples.length < 2) {
            return '';
        }

        const points = samples.map((sample, index) => {
            const x =
                samples.length <= 1
                    ? 0
                    : (
                        index /
                        (samples.length - 1)
                    ) * width;

            const value = Math.max(
                0,
                Number(sample[key]) || 0
            );

            const y =
                height -
                (
                    Math.min(value, maxValue) /
                    maxValue
                ) * (height - 8) -
                4;

            return { x, y };
        });

        let path =
            `M ${points[0].x.toFixed(1)} ` +
            `${points[0].y.toFixed(1)}`;

        for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            const current = points[index];

            const controlX =
                (previous.x + current.x) / 2;

            path +=
                ` C ${controlX.toFixed(1)} ` +
                `${previous.y.toFixed(1)}, ` +
                `${controlX.toFixed(1)} ` +
                `${current.y.toFixed(1)}, ` +
                `${current.x.toFixed(1)} ` +
                `${current.y.toFixed(1)}`;
        }

        return path;
    }

    function dlRenderSpeedChart(task = {}) {
        const samples = dlTaskChartSamples(task);

        const width = 420;
        const height = 72;

        const values = samples.flatMap(sample => [
            Math.max(
                0,
                Number(sample.downloadSpeedBps) || 0
            ),
            Math.max(
                0,
                Number(sample.diskUsageBps) || 0
            ),
        ]);

        const peak = Math.max(1, ...values);

        const downloadPath =
            dlBuildSmoothChartPath(
                samples,
                'downloadSpeedBps',
                width,
                height,
                peak
            );

        const diskPath =
            dlBuildSmoothChartPath(
                samples,
                'diskUsageBps',
                width,
                height,
                peak
            );

        const empty =
            samples.length < 2 ||
            peak <= 1;

        return `
            <div class="download-speed-chart" data-download-field="chart">
                <div class="download-speed-chart-head">
                    <span>Transfer Activity</span>
                    <span>${
                        empty
                            ? 'Measuring'
                            : `Peak ${dlEsc(dlFormatRate(peak))}`
                    }</span>
                </div>

                <svg
                    viewBox="0 0 ${width} ${height}"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <path
                        class="download-chart-line download-chart-line-disk"
                        d="${empty ? '' : diskPath}"
                    ></path>

                    <path
                        class="download-chart-line download-chart-line-download"
                        d="${empty ? '' : downloadPath}"
                    ></path>
                </svg>

                <div class="download-speed-chart-legend">
                    <span>
                        <i class="download-legend-download"></i>
                        Download
                    </span>

                    <span>
                        <i class="download-legend-disk"></i>
                        Disk
                    </span>
                </div>
            </div>
        `;
    }


    function dlFailurePanel(task = {}) {
        if (task.status !== 'failed') return '';
        const failure = task.failureDetails && typeof task.failureDetails === 'object' ? task.failureDetails : null;
        const evidence = failure?.evidence || {};
        const message = failure?.userMessage || task.errorMessage || task.statusMessage || 'Download failed.';
        const action = failure?.suggestedAction || task.failureSuggestedAction || '';
        const diskRows = [
            ['Required', evidence.requiredSpaceBytes || task.requiredSpaceBytes],
            ['Available', evidence.freeSpaceBytesAtFailure || task.freeSpaceBytesAtQueue],
            ['Missing', evidence.shortfallBytes],
        ].filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0);
        return `
            <div class="download-failure-panel">
                <strong>${dlEsc(message)}</strong>
                ${action ? `<p>${dlEsc(action)}</p>` : ''}
                ${diskRows.length ? `<div class="download-failure-metrics">${diskRows.map(([label, value]) => dlStatCard(label, dlEsc(dlFormatBytes(value)))).join('')}</div>` : ''}
            </div>`;
    }

    function dlAdvancedDetails(task = {}, isOpen = false) {
        return `
            <details class="download-advanced-details"${isOpen ? ' open' : ''}>
                <summary>Advanced details</summary>
                <div class="download-advanced-grid">
                    ${dlStatCard('Raw Network', dlEsc(dlFormatBytes(task.rawDownloadedBytes)))}
                    ${dlStatCard('Written Data', dlEsc(dlFormatBytes(task.writtenBytes)))}
                    ${dlStatCard('Raw Speed', dlEsc(dlFormatRate(task.rawDownloadSpeedBps, task)))}
                    ${dlStatCard('Decompression', dlEsc(dlFormatRate(task.decompressionSpeedBps, task)))}
                    ${dlStatCard('Disk Read', dlEsc(dlFormatRate(task.diskReadSpeedBps, task)))}
                    ${dlStatCard('Runtime', dlEsc(task.runtimeVersion || 'Unknown'))}
                    ${dlStatCard('Progress Source', dlEsc(task.progressSource || 'Unknown'))}
                    ${dlStatCard('Session', dlEsc(task.progressSessionId || 'None'))}
                    ${dlStatCard('Free Space at Queue', dlEsc(dlFormatBytes(task.freeSpaceBytesAtQueue)))}
                    ${dlStatCard('Required Space', dlEsc(dlFormatBytes(task.requiredSpaceBytes)))}
                    ${dlStatCard('Safety Margin', dlEsc(dlFormatBytes(task.diskSafetyMarginBytes)))}
                    ${dlStatCard('Failure Code', dlEsc(task.errorCode || 'None'))}
                    ${dlStatCard('Failure Rule', dlEsc(task.failureDetails?.evidence?.classificationRule || 'None'))}
                    ${dlStatCard('Diagnostic File', dlEsc(task.providerDiagnosticPath || 'None'))}
                </div>
                ${task.errorTechnicalSummary ? `<pre class="download-technical-summary">${dlEsc(task.errorTechnicalSummary).slice(0, 2000)}</pre>` : ''}
            </details>`;
    }

    window.__baddelDownloadsFormatters = {
        formatBytes: dlFormatBytes,
        formatRate: dlFormatRate,
        formatDuration: dlFormatDuration,
        downloadedText: dlDownloadedText,
        percent: getEffectiveTransferPercent,
    };

    function dlButton({ label, action, taskId, tone = 'secondary', disabled = false }) {
        return `<button class="download-btn download-btn-${tone}" ${disabled ? 'disabled' : ''} onclick="${action}('${dlEsc(taskId)}')">${dlEsc(label)}</button>`;
    }

   function dlTaskCard(task, active = false, index = 0) {
        const pct = getEffectiveTransferPercent(task);

        const presentationState =
            dlSyncPresentationState(task);

        const presentedRate =
            presentationState
                ? dlFreshPresentationRate(
                    presentationState,
                    dlPresentationNow()
                )
                : Number(task.downloadSpeedBps) || 0;

        const presentedEta =
            presentationState?.displayedEtaSeconds ??
            task.etaSeconds;

        const progressStyle =
            pct === null
                ? 'width:35%;opacity:.45'
                : `width:${pct}%`;

        const cover =
            task.coverUrl ||
            task.heroUrl ||
            '';

        const isBusy =
            downloadsPendingActions.has(task.id);

        const statusText =
            isBusy
                ? 'Stopping download...'
                : dlCleanStatus(task);

        const etaText =
            Number.isFinite(Number(presentedEta)) &&
            Number(presentedEta) > 0
                ? dlFormatDuration(presentedEta)
                : 'Calculating';

        const showDetails =
            active ||
            task.status === 'paused' ||
            task.status === 'failed';

        const isActiveTask = [
            'preparing',
            'resuming',
            'downloading',
            'pausing',
            'verifying',
            'installing',
        ].includes(task.status);

        const isTerminalTask = [
            'completed',
            'failed',
            'cancelled',
        ].includes(task.status);

        const canDeletePartial =
            task.partialDeletionEligible &&
            task.status !== 'completed';

        const diskUsage =
            Number(task.diskUsageBps) || 0;

        const speedText =
            task.status === 'paused'
                ? 'Paused'
                : dlFormatRate(
                    presentedRate || task.downloadSpeedBps,
                    task
                );

        const diskText =
            task.status === 'paused'
                ? 'Paused'
                : (
                    diskUsage > 0
                        ? dlFormatRate(diskUsage, task)
                        : 'Measuring'
                );
        const actionButtons = [
            task.status === 'completed' ? dlButton({ label: 'Play', action: 'downloadsPlay', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.status === 'paused' ? dlButton({ label: 'Resume', action: 'downloadsResume', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.status === 'resuming' ? dlButton({ label: 'Resuming...', action: 'downloadsPause', taskId: task.id, disabled: true }) : '',
            task.status === 'pausing' ? dlButton({ label: 'Pausing...', action: 'downloadsPause', taskId: task.id, disabled: true }) : '',
            isActiveTask && !['resuming', 'pausing'].includes(task.status) ? dlButton({ label: isBusy ? 'Pausing...' : 'Pause', action: 'downloadsPause', taskId: task.id, disabled: isBusy }) : '',
            task.status === 'pending' ? dlButton({ label: 'Start Now', action: 'downloadsStartNow', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.status === 'failed' ? dlButton({ label: 'Retry', action: 'downloadsRetry', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.installPath ? dlButton({ label: 'Open Folder', action: 'downloadsOpenFolder', taskId: task.id }) : '',
            !isTerminalTask ? dlButton({ label: 'Cancel', action: 'downloadsCancel', taskId: task.id, tone: 'danger', disabled: isBusy }) : '',
            canDeletePartial ? dlButton({ label: 'Delete Partial', action: 'downloadsDeletePartial', taskId: task.id, tone: 'danger', disabled: isBusy }) : '',
            isTerminalTask ? dlButton({ label: 'Remove', action: 'downloadsRemove', taskId: task.id, disabled: isBusy && task.status !== 'failed' }) : '',
        ].filter(Boolean).join('');

        return `
                <div class="${active ? 'download-card' : 'download-row'}" data-download-task-id="${dlEsc(task.id)}" data-task-revision="${Number(task.taskRevision) || 0}" data-task-status="${dlEsc(task.status || '')}">
                ${active ? '' : `<div class="download-row-index">${index + 1}</div>`}
                ${cover ? `<img class="${active ? 'download-cover' : 'download-thumb'}" src="${dlEsc(cover)}" alt="">` : `<div class="${active ? 'download-cover' : 'download-thumb'}"></div>`}
                <div class="download-info">
                    <div class="download-title-row">
                        <h3 class="download-title">${dlEsc(task.title)}</h3>
                        <span class="download-platform">${dlEsc(dlPlatformLabel(task.platform))}</span>
                    </div>
                    <div class="download-meta"><span data-download-field="account">${dlEsc(task.accountDisplayName || task.accountId || 'Selected account')}</span> - <span data-download-field="status">${dlEsc(statusText)}</span></div>
                    <div class="download-path" data-download-field="path" title="${dlEsc(task.installPath || '')}">${dlEsc(task.installPath || 'Install folder not selected')}</div>
                    ${dlFailurePanel(task)}
                    ${showDetails ? `
                        <div class="download-progress-wrap">
                            <div class="download-progress-top">
                                <span class="download-progress-percent" data-download-field="percent">${pct === null ? 'Preparing' : `${pct.toFixed(1)}%`}</span>
                                <span data-download-field="eta-top">${dlEsc(etaText)}</span>
                            </div>
                            <div class="download-progress"><div class="download-progress-fill" style="${progressStyle}"></div></div>
                        </div>
                        <div class="download-stats">
                            ${dlStatCard('Game Files', `<span data-download-field="downloaded">${dlEsc(dlDownloadedText(task))}</span>`)}
                            ${dlStatCard('Download Speed', `<span data-download-field="speed">${dlEsc(speedText)}</span>`)}
                            ${dlStatCard('Disk Usage', `<span data-download-field="disk">${dlEsc(diskText)}</span>`)}
                            ${dlStatCard('Estimated Time', `<span data-download-field="eta">${dlEsc(etaText)}</span>`)}
                        </div>
                        ${dlRenderSpeedChart(task)}
                        ${dlAdvancedDetails(task)}
                    ` : ''}
                </div>
                <div class="download-actions">${actionButtons}</div>
            </div>`;
    }

    function renderDownloads(snapshot = downloadsSnapshot) {
        downloadsSnapshot = snapshot || { tasks: [], badgeCount: 0, activeCount: 0, pendingCount: 0, aggregateSpeedBps: 0 };
        const root = document.getElementById('downloadsRoot');
        const badge = document.getElementById('downloadsBadge');
        const speed = document.getElementById('downloadsSpeed');
        const activeCount = document.getElementById('downloadsActiveCount');
        const pendingCount = document.getElementById('downloadsPendingCount');
        const clearBtn = document.getElementById('downloadsClearCompleted');
        const tasks = Array.isArray(downloadsSnapshot.tasks) ? downloadsSnapshot.tasks : [];
        dlCleanupPresentationStates(tasks);
        for (const task of tasks) {
            dlSyncPresentationState(task);
        }

        if (badge) {
            badge.textContent = downloadsSnapshot.badgeCount > 0 ? String(downloadsSnapshot.badgeCount) : '';
            badge.style.display = downloadsSnapshot.badgeCount > 0 ? '' : 'none';
        }
        if (speed) speed.textContent = tasks.some(t => (Number(t.progressPercent) || 0) >= 1)
            ? `${dlFormatBytes(downloadsSnapshot.aggregateSpeedBps)}/s`
            : 'Starting';
        if (activeCount) activeCount.textContent = String(downloadsSnapshot.activeCount || 0);
        if (pendingCount) pendingCount.textContent = String(downloadsSnapshot.pendingCount || 0);
        if (clearBtn) clearBtn.style.display = tasks.some(t => t.status === 'completed') ? '' : 'none';
        if (!root) return;

        if (!tasks.length) {
            root.innerHTML = `
                <div class="downloads-empty">
                    <div>
                        <div class="downloads-empty-icon">
                            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><polyline points="7 10 12 15 17 10"></polyline><path d="M5 21h14"></path></svg>
                        </div>
                        <h3>No downloads yet</h3>
                        <p>Games you install directly from GOG will appear here.</p>
                        <button class="download-btn download-btn-primary" onclick="navigateToReadyToInstall()">Browse Ready to Install</button>
                    </div>
                </div>`;
            return;
        }

        const activeStatuses = new Set([
            'preparing',
            'resuming',
            'downloading',
            'pausing',
            'verifying',
            'installing',
        ]);
        const active = tasks.find(t => activeStatuses.has(t.status));
        const pending = tasks.filter(t => t.status === 'pending');
        const paused = tasks.filter(t => t.status === 'paused');
        const failed = tasks.filter(t => t.status === 'failed');
        const completed = tasks.filter(t => t.status === 'completed');
        root.innerHTML = [
            active ? `<section><h3 class="downloads-section-title">Active Download</h3>${dlTaskCard(active, true)}</section>` : '',
            pending.length ? `<section><h3 class="downloads-section-title">Up Next</h3>${pending.map((t, i) => dlTaskCard(t, false, i)).join('')}</section>` : '',
            paused.length ? `<section><h3 class="downloads-section-title">Paused</h3>${paused.map((t, i) => dlTaskCard(t, true, i)).join('')}</section>` : '',
            failed.length ? `<section><h3 class="downloads-section-title">Needs Attention</h3>${failed.map((t, i) => dlTaskCard(t, false, i)).join('')}</section>` : '',
            completed.length ? `<section><h3 class="downloads-section-title">Completed</h3>${completed.map((t, i) => dlTaskCard(t, false, i)).join('')}</section>` : '',
        ].filter(Boolean).join('');
    }

    function mergeTaskPatch(update = {}) {
        if (!downloadsSnapshot || !Array.isArray(downloadsSnapshot.tasks)) return null;
        const taskId = update.taskId || update.id;
        const idx = downloadsSnapshot.tasks.findIndex(task => task.id === taskId);
        if (idx < 0) return null;
        const current = downloadsSnapshot.tasks[idx];
        const incomingRevision = Number(update.taskRevision ?? update.patch?.taskRevision ?? update.task?.taskRevision ?? update.taskRevision);
        const currentRevision = Number(current.taskRevision) || 0;
        if (Number.isFinite(incomingRevision) && incomingRevision < currentRevision) return null;
        const patch = update.patch && typeof update.patch === 'object' ? update.patch : update;
        const next = { ...current, ...patch, taskRevision: Number.isFinite(incomingRevision) ? incomingRevision : currentRevision };
        downloadsSnapshot.tasks[idx] = next;
        dlSyncPresentationState(next, patch);
        downloadsSnapshot.aggregateSpeedBps = downloadsSnapshot.tasks.reduce((sum, task) => sum + (Number(task.downloadSpeedBps) || 0), 0);
        return next;
    }

    function setText(card, field, value) {
        const el = card.querySelector(`[data-download-field="${field}"]`);
        if (el) el.textContent = value;
    }

    function patchDownloadTaskCard(update = {}) {
        const task = mergeTaskPatch(update);
        if (!task) return;
        const card = document.querySelector(`[data-download-task-id="${dlCssEscape(task.id)}"]`);
        if (!card) {
            renderDownloads(downloadsSnapshot);
            return;
        }
        if (card.dataset.taskStatus !== String(task.status || '') || ['completed', 'failed', 'cancelled'].includes(String(task.status))) {
            renderDownloads(downloadsSnapshot);
            return;
        }
        card.dataset.taskRevision = String(Number(task.taskRevision) || 0);
        card.dataset.taskStatus = String(task.status || '');
        const pct = getEffectiveTransferPercent(task);
        const presentationState =
            dlSyncPresentationState(task);

        const presentedRate =
            presentationState
                ? dlFreshPresentationRate(
                    presentationState,
                    dlPresentationNow()
                )
                : Number(task.downloadSpeedBps) || 0;

        const presentedEta =
            presentationState?.displayedEtaSeconds ??
            task.etaSeconds;
        const fill = card.querySelector('.download-progress-fill');
        const label = card.querySelector('.download-progress-percent');
        if (fill) {
            fill.style.width = pct === null ? '35%' : `${Math.max(0, Math.min(100, pct))}%`;
            fill.style.opacity = pct === null ? '.45' : '';
        }
        if (label) label.textContent = pct === null ? 'Preparing' : `${pct.toFixed(1)}%`;
        setText(card, 'status', dlCleanStatus(task));
        setText(card, 'downloaded', dlDownloadedText(task));
        setText(
            card,
            'speed',
            dlFormatRate(
                presentedRate || task.downloadSpeedBps,
                task
            )
        );
        setText(card, 'disk', Number(task.diskUsageBps) > 0 ? dlFormatRate(task.diskUsageBps, task) : 'Measuring');
        const etaText =
            Number.isFinite(Number(presentedEta)) &&
            Number(presentedEta) > 0
                ? dlFormatDuration(presentedEta)
                : 'Calculating';
        setText(card, 'eta', etaText);
        setText(card, 'eta-top', etaText);
        const chart = card.querySelector('[data-download-field="chart"]');
        if (chart) chart.outerHTML = dlRenderSpeedChart(task);
        const advanced = card.querySelector('.download-advanced-details');
        if (advanced) {
            const wasOpen = advanced.open;
            advanced.outerHTML = dlAdvancedDetails(task, wasOpen);
        }
        const speed = document.getElementById('downloadsSpeed');
        if (speed) speed.textContent = downloadsSnapshot.aggregateSpeedBps > 0 ? `${dlFormatBytes(downloadsSnapshot.aggregateSpeedBps)}/s` : 'Measuring';
    }

    async function refreshDownloads() {
        const res = await window.electronAPI?.downloads?.getSnapshot?.();
        if (res?.status === 'success') renderDownloads(res.snapshot);
        else if (res?.message && typeof showToast === 'function') showToast(res.message, 'error');
    }

    window.navigateToDownloads = async function navigateToDownloads() {
        window.agReadyOnly = false;
        currentView = 'downloads';
        if (typeof _hideAllViews === 'function') _hideAllViews();
        const view = document.getElementById('downloadsView');
        if (view) view.style.display = 'block';
        const main = document.getElementById('mainContentArea');
        if (main) main.scrollTop = 0;
        if (typeof updateSidebarActiveState === 'function') updateSidebarActiveState();
        if (typeof syncSidebarActionButton === 'function') syncSidebarActionButton();
        await refreshDownloads();
    };

    async function dlAction(label, fn) {
        try {
            const res = await fn();
            if (res?.status === 'error') {
                if (typeof showToast === 'function') showToast(res.message || `${label} failed`, 'error');
                return;
            }
            if (res?.snapshot) renderDownloads(res.snapshot);
            else await refreshDownloads();
        } catch (err) {
            if (typeof showToast === 'function') showToast(err?.message || `${label} failed`, 'error');
        }
    }

    window.downloadsPause = taskId => {
        dlFreezePresentationForPause(taskId);

        downloadsPendingActions.add(taskId);
        renderDownloads();

        return dlAction(
            'Pause',
            () => window.electronAPI.downloads.pause(taskId)
        ).finally(() => {
            downloadsPendingActions.delete(taskId);
            renderDownloads();
        });
    };
    window.downloadsResume = taskId => dlAction('Resume', () => window.electronAPI.downloads.resume(taskId));
    window.downloadsRetry = taskId => dlAction('Retry', () => window.electronAPI.downloads.retry(taskId));
    function dlFindTask(taskId, predicate = null) {
        const matches = (downloadsSnapshot?.tasks || []).filter(task => String(task.id) === String(taskId));
        if (!matches.length) return null;
        if (typeof predicate === 'function') {
            const matched = matches.find(predicate);
            if (matched) return matched;
        }
        return matches.find(task => task.status === 'completed') || matches[matches.length - 1];
    }

    function dlTaskIdentityValues(task = {}) {
        const allIds = task.allIds && typeof task.allIds === 'object' ? task.allIds : {};
        return [
            task.providerProductId,
            task.contentSystemProductId,
            task.gogProductId,
            task.gogdlAppName,
            task.providerAppName,
            task.gameId,
            task.canonicalGameId,
            allIds.gog,
            allIds.gogProductId,
            allIds.contentSystemProductId,
            allIds.gogdlAppName,
            allIds[task.platform],
        ].map(value => String(value || '').trim()).filter(Boolean);
    }

    function dlGameIdentityValues(game = {}) {
        const allIds = game.allIds && typeof game.allIds === 'object' ? game.allIds : {};
        return [
            game.providerProductId,
            game.contentSystemProductId,
            game.gogProductId,
            game.gogdlAppName,
            game.providerAppName,
            game.appName,
            game.launcherGameId,
            game.gameId,
            game.canonicalGameId,
            allIds.gog,
            allIds.gogProductId,
            allIds.contentSystemProductId,
            allIds.gogdlAppName,
            allIds[game.platform],
        ].map(value => String(value || '').trim()).filter(Boolean);
    }

    function dlPathKey(value) {
        return String(value || '').trim().toLowerCase().replace(/^"|"$/g, '').replace(/\\/g, '/');
    }

    function dlInstalledGameCanLaunch(game = {}) {
        return Boolean(game && (game.command || game.launchCommand || game.executablePath || game.path));
    }

    function dlFindInstalledGameByTask(task = {}, games = window.allGamesData) {
        const list = Array.isArray(games) ? games : [];
        const wantedIds = new Set(dlTaskIdentityValues(task));
        const wantedInstallPath = dlPathKey(task.installPath);
        const wantedExe = dlPathKey(task.resolvedExecutablePath || task.verificationExecutablePath || task.executablePath);
        const platform = String(task.platform || '').trim().toLowerCase();
        const title = String(task.title || '').trim().toLowerCase();
        return list.find(game => task.installedGameId && String(game.id) === String(task.installedGameId) && dlInstalledGameCanLaunch(game)) ||
            list.find(game => dlInstalledGameCanLaunch(game) && dlGameIdentityValues(game).some(id => wantedIds.has(id))) ||
            list.find(game => {
                if (!dlInstalledGameCanLaunch(game)) return false;
                const paths = [game.installPath, game.path, game.executablePath, game.command, game.launchCommand].map(dlPathKey).filter(Boolean);
                return (wantedExe && paths.some(p => p === wantedExe || p.includes(wantedExe) || wantedExe.includes(p))) ||
                    (wantedInstallPath && paths.some(p => p === wantedInstallPath || p.startsWith(`${wantedInstallPath}/`) || wantedInstallPath.startsWith(`${p}/`)));
            }) ||
            list.find(game => dlInstalledGameCanLaunch(game) && platform && String(game.platform || game.scannerPlatform || '').trim().toLowerCase() === platform && title && String(game.name || game.title || '').trim().toLowerCase() === title) ||
            null;
    }

    async function dlResolveInstalledGameForTask(task = {}) {
        let game = dlFindInstalledGameByTask(task);
        if (game) return game;
        if (window.electronAPI?.getGames) {
            try {
                const fresh = await window.electronAPI.getGames();
                if (Array.isArray(fresh)) {
                    window.allGamesData = fresh;
                    try { if (typeof allGamesData !== 'undefined') allGamesData = fresh; } catch (_) {}
                    game = dlFindInstalledGameByTask(task, fresh);
                }
            } catch (_) {}
        }
        if (game && !task.installedGameId) task.installedGameId = game.id || task.installedGameId;
        return game;
    }

    function dlBuildLaunchGameFromTask(task = {}) {
        const executablePath = task.resolvedExecutablePath || task.verificationExecutablePath || task.executablePath || null;
        if (!executablePath && !task.command && !task.launchCommand && !task.path) return null;
        return {
            id: task.installedGameId || task.canonicalGameId || task.gameId || task.id,
            name: task.title || 'Downloaded Game',
            title: task.title || 'Downloaded Game',
            platform: task.platform,
            path: task.path || task.installPath || executablePath,
            executablePath,
            command: task.command || (executablePath ? `"${executablePath}"` : ''),
            launchCommand: task.launchCommand || task.command || (executablePath ? `"${executablePath}"` : ''),
        };
    }
    async function dlFindInstalledGame(installedGameId) {
        const id = String(installedGameId || '');
        if (!id) return null;
        const local = Array.isArray(window.allGamesData) ? window.allGamesData : [];
        let game = local.find(g => String(g.id) === id) || null;
        if (game) return game;
        if (window.electronAPI?.getGames) {
            try {
                const fresh = await window.electronAPI.getGames();
                if (Array.isArray(fresh)) {
                    window.allGamesData = fresh;
                    try { if (typeof allGamesData !== 'undefined') allGamesData = fresh; } catch (_) {}
                    game = fresh.find(g => String(g.id) === id) || null;
                }
            } catch (_) {}
        }
        return game;
    }

    async function dlLaunchInstalledGame(game) {
        if (!game) return false;
        if (typeof window.openPlayLauncher === 'function') {
            window.openPlayLauncher(game);
            return true;
        }
        if (typeof window.triggerLaunchSequence === 'function') {
            window.triggerLaunchSequence(game.id);
            return true;
        }
        return false;
    }

    window.downloadsPlay = async taskId => {
        const task = dlFindTask(taskId, t => t.status === 'completed');
        if (!task || task.status !== 'completed') {
            if (typeof showToast === 'function') showToast('This download is not ready to play yet.', 'error');
            return;
        }
        const game = await dlResolveInstalledGameForTask(task) || dlBuildLaunchGameFromTask(task);
        if (!game || !dlInstalledGameCanLaunch(game)) {
            if (typeof showToast === 'function') showToast('Baddel could not find the installed launch target.', 'error');
            return;
        }
        if (!task.installedGameId && game.id) {
            task.installedGameId = game.id;
            renderDownloads(downloadsSnapshot);
        }
        const launched = await dlLaunchInstalledGame(game);
        if (!launched && typeof showToast === 'function') showToast('Play launcher is not available right now.', 'error');
    };

    window.downloadsRemove = taskId => dlAction('Remove', () => window.electronAPI.downloads.remove(taskId));
    window.downloadsStartNow = taskId => dlAction('Start', () => window.electronAPI.downloads.startNow(taskId));
    window.downloadsClearCompleted = () => dlAction('Clear', () => window.electronAPI.downloads.clearCompleted());
    window.downloadsOpenFolder = taskId => dlAction('Open folder', () => window.electronAPI.downloads.openInstallDirectory(taskId));
    window.downloadsCancel = taskId => {
        const run = () => {
            downloadsPendingActions.add(taskId);
            renderDownloads();
            return dlAction('Cancel', () => window.electronAPI.downloads.cancel({ taskId, deletePartial: false }))
                .finally(() => {
                    downloadsPendingActions.delete(taskId);
                    renderDownloads();
                });
        };
        if (typeof openConfirmModal === 'function') {
            openConfirmModal('Cancel download?', 'This will stop the provider process and remove the download from this list. Partial files are preserved.', 'Cancel Download', run);
        } else {
            run();
        }
    };
    window.downloadsDeletePartial = taskId => {
        const run = () => dlAction('Delete partial', () => window.electronAPI.downloads.cancel({ taskId, deletePartial: true }));
        if (typeof openConfirmModal === 'function') {
            openConfirmModal('Delete partial files?', 'This will cancel the download and delete only the Baddel-marked partial folder for this task.', 'Delete Partial', run);
        } else {
            run();
        }
    };

    window.queueDirectDownload = async function queueDirectDownload(payload = {}) {
        const res = await window.electronAPI?.downloads?.queueInstall?.(payload);
        if (res?.status === 'success') {
            renderDownloads(res.snapshot);
            if (typeof showToast === 'function') showToast('Added to Downloads.', 'success');
            return res;
        }
        if (typeof showToast === 'function') showToast(res?.message || 'Could not add download.', 'error');
        return res;
    };

    function initDownloads() {
        if (!window.electronAPI?.downloads) return;
        startDownloadPresentationTimer();
        downloadsUnsubscribers.forEach(fn => { try { fn(); } catch (_) {} });
        downloadsUnsubscribers = [
            window.electronAPI.downloads.onSnapshot(renderDownloads),
            window.electronAPI.downloads.onTaskUpdated?.(patchDownloadTaskCard),
        ].filter(Boolean);
        refreshDownloads().catch(() => {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDownloads);
    } else {
        initDownloads();
    }
})();
