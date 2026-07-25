(function downloadsModule() {
    'use strict';

    let downloadsSnapshot = null;
    let downloadsUnsubscribers = [];
    const downloadsPendingActions = new Set();
    const downloadsChartBuffers = new Map();
    const DOWNLOAD_CHART_LIMIT = 90;

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
        while (value >= 1024 && idx < units.length - 1) {
            value /= 1024;
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

    function dlPlatformLabel(platform) {
        const p = String(platform || '').toLowerCase();
        if (p === 'gog') return 'GOG';
        if (p === 'epic') return 'Epic Games';
        return p || 'Unknown';
    }

    function getEffectiveTransferPercent(task) {
        const downloadedBytes = Number(task?.downloadedBytes);
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
        return `${dlFormatBytes(task.downloadedBytes)}${task.totalBytes ? ` / ${dlFormatBytes(task.totalBytes)}` : ''}`;
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

    function dlRenderSpeedChart(task = {}) {
        const samples = dlTaskChartSamples(task);
        const width = 420;
        const height = 72;
        const max = Math.max(1, ...samples.flatMap(s => [Number(s.downloadSpeedBps) || 0, Number(s.diskUsageBps) || 0]));
        const points = (key) => samples.map((sample, index) => {
            const x = samples.length <= 1 ? 0 : (index / (samples.length - 1)) * width;
            const y = height - ((Math.max(0, Number(sample[key]) || 0) / max) * (height - 8)) - 4;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        const empty = samples.length < 2 || max <= 1;
        return `
            <div class="download-speed-chart" data-download-field="chart">
                <div class="download-speed-chart-head">
                    <span>Transfer Activity</span>
                    <span>${empty ? 'Measuring' : `Peak ${dlEsc(dlFormatRate(max))}`}</span>
                </div>
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
                    <polyline class="download-chart-line download-chart-line-disk" points="${empty ? '' : points('diskUsageBps')}"></polyline>
                    <polyline class="download-chart-line download-chart-line-download" points="${empty ? '' : points('downloadSpeedBps')}"></polyline>
                </svg>
                <div class="download-speed-chart-legend">
                    <span><i class="download-legend-download"></i>Download</span>
                    <span><i class="download-legend-disk"></i>Disk</span>
                </div>
            </div>`;
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

    function dlButton({ label, action, taskId, tone = 'secondary', disabled = false }) {
        return `<button class="download-btn download-btn-${tone}" ${disabled ? 'disabled' : ''} onclick="${action}('${dlEsc(taskId)}')">${dlEsc(label)}</button>`;
    }

    function dlTaskCard(task, active = false, index = 0) {
        const pct = getEffectiveTransferPercent(task);
        const progressStyle = pct === null ? 'width:35%;opacity:.45' : `width:${pct}%`;
        const cover = task.coverUrl || task.heroUrl || '';
        const isBusy = downloadsPendingActions.has(task.id);
        const statusText = isBusy ? 'Stopping download...' : dlCleanStatus(task);
        const etaText = Number.isFinite(Number(task.etaSeconds)) ? dlFormatDuration(task.etaSeconds) : 'Calculating';
        const showDetails = active || task.status === 'paused' || task.status === 'failed';
        const isActiveTask = ['preparing','downloading','verifying','installing'].includes(task.status);
        const isTerminalTask = ['completed','failed','cancelled'].includes(task.status);
        const canDeletePartial = task.partialDeletionEligible && task.status !== 'completed';
        const diskUsage = Number(task.diskUsageBps) || 0;
        const speedText = task.status === 'paused' ? 'Paused' : dlFormatRate(task.downloadSpeedBps, task);
        const diskText = task.status === 'paused' ? 'Paused' : (diskUsage > 0 ? dlFormatRate(diskUsage, task) : 'Measuring');
        const actionButtons = [
            task.status === 'paused' ? dlButton({ label: 'Resume', action: 'downloadsResume', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            isActiveTask ? dlButton({ label: isBusy ? 'Pausing...' : 'Pause', action: 'downloadsPause', taskId: task.id, disabled: isBusy }) : '',
            task.status === 'pending' ? dlButton({ label: 'Start Now', action: 'downloadsStartNow', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.status === 'failed' ? dlButton({ label: 'Retry', action: 'downloadsRetry', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.installPath ? dlButton({ label: 'Open Folder', action: 'downloadsOpenFolder', taskId: task.id }) : '',
            !isTerminalTask ? dlButton({ label: 'Cancel', action: 'downloadsCancel', taskId: task.id, tone: 'danger', disabled: isBusy }) : '',
            canDeletePartial ? dlButton({ label: 'Delete Partial', action: 'downloadsDeletePartial', taskId: task.id, tone: 'danger', disabled: isBusy }) : '',
            isTerminalTask ? dlButton({ label: 'Remove', action: 'downloadsRemove', taskId: task.id, disabled: isBusy && task.status !== 'failed' }) : '',
        ].filter(Boolean).join('');

        return `
                <div class="${active ? 'download-card' : 'download-row'}" data-download-task-id="${dlEsc(task.id)}" data-task-revision="${Number(task.taskRevision) || 0}">
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

        const activeStatuses = new Set(['preparing', 'downloading', 'verifying', 'installing']);
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
        if (['completed', 'failed', 'cancelled'].includes(String(task.status))) {
            renderDownloads(downloadsSnapshot);
            return;
        }
        card.dataset.taskRevision = String(Number(task.taskRevision) || 0);
        const pct = getEffectiveTransferPercent(task);
        const fill = card.querySelector('.download-progress-fill');
        const label = card.querySelector('.download-progress-percent');
        if (fill) {
            fill.style.width = pct === null ? '35%' : `${Math.max(0, Math.min(100, pct))}%`;
            fill.style.opacity = pct === null ? '.45' : '';
        }
        if (label) label.textContent = pct === null ? 'Preparing' : `${pct.toFixed(1)}%`;
        setText(card, 'status', dlCleanStatus(task));
        setText(card, 'downloaded', dlDownloadedText(task));
        setText(card, 'speed', dlFormatRate(task.downloadSpeedBps, task));
        setText(card, 'disk', Number(task.diskUsageBps) > 0 ? dlFormatRate(task.diskUsageBps, task) : 'Measuring');
        const etaText = Number.isFinite(Number(task.etaSeconds)) ? dlFormatDuration(task.etaSeconds) : 'Calculating';
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
        downloadsPendingActions.add(taskId);
        renderDownloads();
        return dlAction('Pause', () => window.electronAPI.downloads.pause(taskId)).finally(() => {
            downloadsPendingActions.delete(taskId);
            renderDownloads();
        });
    };
    window.downloadsResume = taskId => dlAction('Resume', () => window.electronAPI.downloads.resume(taskId));
    window.downloadsRetry = taskId => dlAction('Retry', () => window.electronAPI.downloads.retry(taskId));
    window.downloadsRemove = taskId => dlAction('Remove', () => window.electronAPI.downloads.remove(taskId));
    window.downloadsStartNow = taskId => dlAction('Start', () => window.electronAPI.downloads.startNow(taskId));
    window.downloadsClearCompleted = () => dlAction('Clear', () => window.electronAPI.downloads.clearCompleted());
    window.downloadsOpenFolder = taskId => dlAction('Open folder', () => window.electronAPI.downloads.openInstallDirectory(taskId));
    window.downloadsCancel = taskId => {
        const run = () => dlAction('Cancel', () => window.electronAPI.downloads.cancel({ taskId, deletePartial: false }));
        if (typeof openConfirmModal === 'function') {
            openConfirmModal('Cancel download?', 'This will stop the provider process and keep partial files for resume when available.', 'Cancel Download', run);
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
