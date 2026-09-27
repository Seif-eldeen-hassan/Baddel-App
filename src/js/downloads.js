(function downloadsModule() {
    'use strict';

    let downloadsSnapshot = null;
    let downloadsUnsubscribers = [];
    let downloadsProviderCapabilities = [];
    let downloadsCapabilitiesPromise = null;
    const downloadsCapabilityRetryState = new Map();
    const DOWNLOAD_CAPABILITY_PROVIDERS = ['epic', 'gog'];
    let managedMaintenanceSignature = '';
    const downloadFilterDefaults = { search: '', platform: 'all', size: 'all', date: 'all', sort: 'newest' };
    let downloadFilters = { ...downloadFilterDefaults };
    let downloadVisibleSignature = '';
    let downloadHistoryEntries = [];
    const DOWNLOAD_ACTIVE_STATUSES = new Set(['preparing', 'resuming', 'downloading', 'pausing', 'verifying', 'installing']);
    const DOWNLOAD_MAINTENANCE_BUSY_STATUSES = new Set(['pending', 'preparing', 'resuming', 'downloading', 'pausing', 'paused', 'verifying', 'installing']);

    function dlMaintenancePresentation(state = {}) {
        const safeState = state && typeof state === 'object' ? state : {};
        const operation = safeState.operationKind === 'repair' ? 'repair' : safeState.operationKind === 'update' ? 'update' : null;
        const status = String(safeState.status || '');
        if (!operation || !DOWNLOAD_MAINTENANCE_BUSY_STATUSES.has(status)) return null;
        if (status === 'pending') return { operation, phase: 'queued', label: operation === 'repair' ? 'Repair queued' : 'Update queued' };
        if (status === 'paused') return { operation, phase: 'paused', label: operation === 'repair' ? 'Repair paused' : 'Update paused' };
        if (operation === 'repair') {
            if (status === 'verifying') return { operation, phase: 'running', label: 'Verifying files…' };
            if (status === 'preparing' || status === 'resuming') return { operation, phase: 'running', label: 'Preparing repair…' };
            return { operation, phase: 'running', label: 'Repairing…' };
        }
        if (status === 'verifying' || status === 'installing') return { operation, phase: 'running', label: 'Finalizing update…' };
        if (status === 'preparing' || status === 'resuming') return { operation, phase: 'running', label: 'Preparing update…' };
        return { operation, phase: 'running', label: 'Updating…' };
    }

    function dlManagedIdentityValues(record = {}) {
        return [
            record.providerProductId,
            record.contentSystemProductId,
            record.gogProductId,
            record.gogdlAppName,
            record.providerAppName,
            record.gameId,
            record.canonicalGameId,
            record.allIds?.[record.platform],
            record.allIds?.gog,
            record.allIds?.contentSystemProductId,
        ].map(value => String(value || '').trim()).filter(Boolean);
    }

    function dlManagedStateForGame(game = {}) {
        const managed = Array.isArray(downloadsSnapshot?.managedInstallations) ? downloadsSnapshot.managedInstallations : [];
        const gameId = String(game.id || game.installedGameId || '').trim();
        const platform = String(game.platform || game.scannerPlatform || '').trim().toLowerCase();
        const ids = new Set(dlManagedIdentityValues(game));
        const projected = managed.find(item => gameId && String(item.installedGameId || '') === gameId) ||
            managed.find(item => platform && item.platform === platform && dlManagedIdentityValues(item).some(id => ids.has(id)));
        if (!projected) return null;
        const liveTask = (downloadsSnapshot?.tasks || []).find(task => String(task.id) === String(projected.taskId));
        const state = liveTask ? { ...projected, ...liveTask, taskId: projected.taskId } : projected;
        const capability = downloadsProviderCapabilities.find(entry => entry.platform === state.platform ||
            (state.platform === 'gog' && entry.provider === 'gog')) || {};
        const checkingForUpdate = state.checkingForUpdate === true || downloadsPendingActionKinds.get(String(state.taskId)) === 'check';
        return {
            ...state,
            supportsUpdate: capability.supportsUpdate === true,
            supportsRepair: capability.supportsRepair === true,
            isMaintenanceActive: Boolean(dlMaintenancePresentation(state)),
            maintenancePresentation: dlMaintenancePresentation(state),
            checkingForUpdate,
        };
    }

    function dlPublishManagedMaintenanceState({ force = false } = {}) {
        const records = Array.isArray(downloadsSnapshot?.managedInstallations) ? downloadsSnapshot.managedInstallations : [];
        const live = Array.isArray(downloadsSnapshot?.tasks) ? downloadsSnapshot.tasks : [];
        const signature = JSON.stringify([
            records.map(item => [item.taskId, item.installedGameId, item.updateAvailable, item.updateCheckedAt, item.installedBuildId, item.targetBuildId, item.status, item.operationKind, item.checkingForUpdate, item.updateCheckState, item.maintenanceErrorCode, item.maintenanceFailedAt]),
            live.filter(item => item.operationKind === 'update' || item.operationKind === 'repair')
                .map(item => [item.id, item.status, item.operationKind, item.updateAvailable]),
            downloadsProviderCapabilities.map(item => [item.platform, item.provider, item.supportsUpdate, item.supportsRepair]),
            [...downloadsPendingActionKinds.entries()].sort(([a], [b]) => a.localeCompare(b)),
        ]);
        if (!force && signature === managedMaintenanceSignature) return;
        managedMaintenanceSignature = signature;
        if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new window.CustomEvent('baddel-maintenance-state-changed'));
        }
    }

    function dlCapabilityKey(entry = {}) {
        const platform = String(entry.platform || '').toLowerCase();
        const provider = String(entry.provider || '').toLowerCase();
        if (platform === 'epic' || provider === 'legendary') return 'epic';
        if (platform === 'gog' || provider === 'gog') return 'gog';
        return platform || provider || null;
    }

    function dlCapabilityReady(provider) {
        const entry = downloadsProviderCapabilities.find(item => dlCapabilityKey(item) === provider);
        return Boolean(entry?.available === true);
    }

    function dlScheduleCapabilityRetry(provider) {
        const current = downloadsCapabilityRetryState.get(provider) || { attempts: 0, timer: null, ready: false };
        if (current.ready || current.timer || current.attempts >= 6) return;
        current.attempts += 1;
        current.timer = setTimeout(() => {
            current.timer = null;
            downloadsCapabilityRetryState.set(provider, current);
            refreshDownloadCapabilities({ force: true });
        }, Math.min(5000, 250 * (2 ** (current.attempts - 1))));
        downloadsCapabilityRetryState.set(provider, current);
    }

    function refreshDownloadCapabilities({ force = false, resetUnavailable = false } = {}) {
        const unavailable = DOWNLOAD_CAPABILITY_PROVIDERS.filter(provider => !dlCapabilityReady(provider));
        if (!force && unavailable.length === 0) return Promise.resolve(downloadsProviderCapabilities);
        if (downloadsCapabilitiesPromise) return downloadsCapabilitiesPromise;
        const getCapabilities = window.electronAPI?.downloads?.getCapabilities;
        if (typeof getCapabilities !== 'function') return Promise.resolve([]);
        if (resetUnavailable) {
            for (const provider of unavailable) {
                const state = downloadsCapabilityRetryState.get(provider);
                downloadsCapabilityRetryState.set(provider, { attempts: 0, timer: state?.timer || null, ready: false });
            }
        }
        downloadsCapabilitiesPromise = getCapabilities().then(result => {
            if (result?.status === 'success' && Array.isArray(result.capabilities)) {
                const merged = new Map(downloadsProviderCapabilities.map(entry => [dlCapabilityKey(entry), entry]));
                for (const entry of result.capabilities) {
                    const key = dlCapabilityKey(entry);
                    if (key) merged.set(key, entry);
                }
                downloadsProviderCapabilities = [...merged.values()];
                for (const provider of DOWNLOAD_CAPABILITY_PROVIDERS) {
                    const state = downloadsCapabilityRetryState.get(provider) || { attempts: 0, timer: null, ready: false };
                    state.ready = dlCapabilityReady(provider);
                    if (state.ready) {
                        if (state.timer) clearTimeout(state.timer);
                        state.timer = null;
                        state.attempts = 0;
                    }
                    downloadsCapabilityRetryState.set(provider, state);
                    if (!state.ready) dlScheduleCapabilityRetry(provider);
                }
                renderDownloads(downloadsSnapshot);
                dlPublishManagedMaintenanceState();
            } else {
                for (const provider of unavailable) dlScheduleCapabilityRetry(provider);
            }
            return downloadsProviderCapabilities;
        }).catch(() => {
            for (const provider of DOWNLOAD_CAPABILITY_PROVIDERS.filter(item => !dlCapabilityReady(item))) {
                dlScheduleCapabilityRetry(provider);
            }
            return downloadsProviderCapabilities;
        }).finally(() => {
            downloadsCapabilitiesPromise = null;
        });
        return downloadsCapabilitiesPromise;
    }

    window.__baddelGetManagedMaintenanceState = dlManagedStateForGame;
    window.__baddelGetManagedMaintenanceRecords = () => [...(downloadsSnapshot?.managedInstallations || [])];
    window.__baddelMaintenancePresentation = dlMaintenancePresentation;

    function dlMaintenanceError(result = {}) {
        const error = new Error(result.message || 'Maintenance action failed');
        error.code = result.code || 'DOWNLOAD_ERROR';
        return error;
    }

    function dlMaintenanceErrorMessage(error) {
        const code = String(error?.code || '');
        if (code === 'EPIC_AUTH_REQUIRED') return 'Reconnect Epic account, then try again.';
        if (code === 'EPIC_LIBRARY_IDENTITY_MISSING') return 'Sync this Epic account, then try again.';
        if (code === 'EPIC_INSTALL_PATH_MISMATCH') return 'The installed Epic path no longer matches Baddel\'s managed installation.';
        if (code === 'EPIC_INSTALLATION_NOT_FOUND') return 'The Epic installation folder could not be found.';
        if (code === 'EPIC_INSTALLED_RECORD_MISSING') return 'Legendary is missing this installed game record.';
        if (code === 'EPIC_ACCOUNT_PROVENANCE_MISMATCH') return 'Baddel refused to move this installation to another Epic account.';
        return null;
    }

    function dlOfferEpicMaintenanceRecovery(error, state, game, action, options) {
        if (error?.code === 'EPIC_AUTH_REQUIRED') {
            const openAccounts = () => {
                if (typeof window.showAccountsView === 'function') window.showAccountsView('epic');
            };
            if (typeof openConfirmModal === 'function') {
                openConfirmModal('Reconnect Epic account', 'This exact Epic account session has expired. Reconnect it before retrying maintenance.', 'Open Accounts', openAccounts);
                return true;
            }
        }
        if (error?.code === 'EPIC_LIBRARY_IDENTITY_MISSING' && options.__targetedSyncRetried !== true &&
            typeof window.electronAPI?.platformSyncSync === 'function' && typeof openConfirmModal === 'function') {
            openConfirmModal('Sync this Epic account?', 'Baddel needs the current Epic library identity for this exact account before maintenance can continue.', 'Sync account', async () => {
                const sync = await window.electronAPI.platformSyncSync('epic', state.accountId, {});
                if (sync?.status !== 'success') {
                    if (typeof showToast === 'function') showToast(sync?.message || 'Epic sync failed.', 'error');
                    return;
                }
                await refreshDownloads().catch(() => {});
                dlPublishManagedMaintenanceState();
                await window.__baddelRunMaintenanceAction(game, action, { ...options, __targetedSyncRetried: true });
            });
            return true;
        }
        return false;
    }

    window.__baddelRunMaintenanceAction = async function(game, action, options = {}) {
        const state = dlManagedStateForGame(game);
        if (!state?.taskId || downloadsPendingActions.has(state.taskId)) return null;
        if (action === 'check' && state.checkingForUpdate) return null;
        if (state.isMaintenanceActive) {
            if (typeof showToast === 'function') showToast('This game already has a queued or active maintenance task.', 'info');
            return null;
        }
        downloadsPendingActions.add(state.taskId);
        downloadsPendingActionKinds.set(String(state.taskId), action);
        dlPublishManagedMaintenanceState();
        const checkToastId = `update-check:${state.taskId}`;
        if (action === 'check' && typeof showToast === 'function') {
            showToast({ id: checkToastId, message: 'Checking for updates\u2026', type: 'info', duration: 30000 });
        }
        try {
            let result;
            if (action === 'check') result = await window.electronAPI.downloads.checkUpdate(state.taskId);
            else result = await window.electronAPI.downloads.queueMaintenance(state.taskId, action);
            if (result?.status !== 'success') throw dlMaintenanceError(result);
            if (result.snapshot) renderDownloads(result.snapshot);
            if (action === 'check' && typeof showToast === 'function') {
                showToast({ id: checkToastId, message: result.update?.updateAvailable ? 'Update available.' : 'This game is up to date.', type: result.update?.updateAvailable ? 'success' : 'info' });
            }
            if (action !== 'check' && options.navigateOnSuccess !== false && typeof window.navigateToDownloads === 'function') {
                await window.navigateToDownloads();
            }
            return result;
        } catch (error) {
            const offeredRecovery = state.platform === 'epic' && dlOfferEpicMaintenanceRecovery(error, state, game, action, options);
            const safeMessage = dlMaintenanceErrorMessage(error);
            if (typeof showToast === 'function') {
                if (action === 'check') showToast({ id: checkToastId, message: safeMessage || "Couldn't check for updates.", type: offeredRecovery ? 'warning' : 'error' });
                else showToast(safeMessage || 'Maintenance action failed.', offeredRecovery ? 'warning' : 'error');
            }
            return null;
        } finally {
            downloadsPendingActions.delete(state.taskId);
            downloadsPendingActionKinds.delete(String(state.taskId));
            dlPublishManagedMaintenanceState();
        }
    };

    function dlFilterSize(task) {
        const values = [task.totalBytes, task.installedDiskSizeBytes];
        return values.find(value => value != null && Number.isFinite(Number(value)) && Number(value) > 0) ?? null;
    }
    function dlFilterDate(task) {
        const value = (task.status === 'completed' && task.completedAt) || task.createdAt || task.queuedAt;
        const timestamp = Date.parse(value || '');
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    function dlFilterTasks(tasks, filters = downloadFilters, now = Date.now()) {
        const day = 86400000;
        const today = new Date(now); today.setHours(0, 0, 0, 0);
        const ranges = { under1: [0, 1], '1to5': [1, 5], '5to20': [5, 20], '20to50': [20, 50], '50plus': [50, Infinity] };
        const selected = tasks.filter(task => {
            if (DOWNLOAD_ACTIVE_STATUSES.has(task.status)) return true;
            if (!String(task.title || '').toLowerCase().includes(String(filters.search || '').trim().toLowerCase())) return false;
            if (filters.platform !== 'all' && String(task.platform || '').toLowerCase() !== filters.platform) return false;
            const range = ranges[filters.size];
            const bytes = dlFilterSize(task);
            if (range && (bytes === null || Number(bytes) < range[0] * 1024 ** 3 || Number(bytes) >= range[1] * 1024 ** 3)) return false;
            const time = dlFilterDate(task);
            if (filters.date !== 'all' && (time === null || time > now)) return false;
            if (filters.date === 'today' && time < today.getTime()) return false;
            if (filters.date === '7days' && time < now - 7 * day) return false;
            if (filters.date === '30days' && time < now - 30 * day) return false;
            if (filters.date === 'older' && time >= now - 30 * day) return false;
            return true;
        });
        const numberOrder = (a, b, descending) => a === null ? (b === null ? 0 : 1) : b === null ? -1 : (Number(a) - Number(b)) * (descending ? -1 : 1);
        return selected.sort((a, b) => {
            if (DOWNLOAD_ACTIVE_STATUSES.has(a.status) !== DOWNLOAD_ACTIVE_STATUSES.has(b.status)) return DOWNLOAD_ACTIVE_STATUSES.has(a.status) ? -1 : 1;
            switch (filters.sort) {
            case 'az': return String(a.title || '').localeCompare(String(b.title || ''));
            case 'za': return String(b.title || '').localeCompare(String(a.title || ''));
            case 'smallest': case 'largest': return numberOrder(dlFilterSize(a), dlFilterSize(b), filters.sort === 'largest');
            case 'platform': return String(a.platform || '').localeCompare(String(b.platform || '')) || String(a.title || '').localeCompare(String(b.title || ''));
            default: return numberOrder(dlFilterDate(a), dlFilterDate(b), filters.sort !== 'oldest');
            }
        });
    }
    function dlVisibleSignature(tasks) {
        return JSON.stringify(dlFilterTasks(tasks).map(task => [task.id, task.status]));
    }
    function dlSyncFilterControls(tasks) {
        const platforms = [...new Set(tasks.map(task => String(task.platform || '').toLowerCase()).filter(Boolean))].sort();
        if (!platforms.includes(downloadFilters.platform)) downloadFilters.platform = 'all';
        const choices = {
            platform: [['all', 'All Platforms'], ...platforms.map(value => [value, value === 'epic' ? 'Epic Games' : value.toUpperCase()])],
            size: [['all', 'All Sizes'], ['under1', 'Under 1 GB'], ['1to5', '1-5 GB'], ['5to20', '5-20 GB'], ['20to50', '20-50 GB'], ['50plus', '50+ GB']],
            date: [['all', 'All Time'], ['today', 'Today'], ['7days', 'Last 7 Days'], ['30days', 'Last 30 Days'], ['older', 'Older']],
            sort: [['newest', 'Newest'], ['oldest', 'Oldest'], ['az', 'Name A-Z'], ['za', 'Name Z-A'], ['smallest', 'Size: Smallest'], ['largest', 'Size: Largest'], ['platform', 'Platform']],
        };
        for (const [key, options] of Object.entries(choices)) {
            const control = document.getElementById('downloads' + key[0].toUpperCase() + key.slice(1));
            const menu = control?.querySelector?.('[role="menu"]');
            if (!menu) continue;
            const signature = JSON.stringify([options, downloadFilters[key]]);
            if (control.dataset.options === signature) continue;
            control.dataset.options = signature;
            menu.innerHTML = options.map(([value, label]) => '<button type="button" class="dropdown-item' + (value === downloadFilters[key] ? ' selected' : '') + '" role="menuitemradio" aria-checked="' + (value === downloadFilters[key]) + '" data-filter-value="' + dlEsc(value) + '">' + dlEsc(label) + '</button>').join('');
            menu.onclick = event => {
                const option = event.target.closest('[data-filter-value]');
                if (!option) return;
                window.baddelMenus?.close(true);
                window.downloadsSetFilter(key, option.dataset.filterValue);
            };
            control.querySelector('[data-filter-label]').textContent = options.find(([value]) => value === downloadFilters[key])?.[1] || options[0][1];
        }
    }
    window.downloadsSetFilter = (key, value) => {
        if (!Object.hasOwn(downloadFilterDefaults, key)) return;
        downloadFilters = { ...downloadFilters, [key]: String(value) };
        renderDownloads();
    };
    window.downloadsResetFilters = () => {
        downloadFilters = { ...downloadFilterDefaults };
        for (const [key, value] of Object.entries(downloadFilters)) {
            const control = document.getElementById('downloads' + key[0].toUpperCase() + key.slice(1));
            if (control) control.value = value;
        }
        renderDownloads();
    };
    const downloadsPendingActions = new Set();
    const downloadsPendingActionKinds = new Map();
    const downloadsChartBuffers = new Map();
    const DOWNLOAD_CHART_LIMIT = 90;
    const downloadPresentationStates = new Map();
    let downloadsPresentationTimer = null;
    const downloadsCompletedDiagnostics = new Set();

    const DOWNLOAD_PRESENTATION_TICK_MS = 250;
    const DOWNLOAD_PRESENTATION_FRESH_MS = 1500;
    const DOWNLOAD_PRESENTATION_STOP_MS = 4000;
    const DOWNLOAD_PRESENTATION_ANIMATION_MS = 1000;
    const DOWNLOAD_ETA_FRESH_MS = 5000;

    const DOWNLOAD_PRESENTATION_ACTIVE_STATUSES = new Set([
        'preparing',
        'resuming',
        'downloading',
        'verifying',
        'installing',
    ]);

    function dlRecordDiagnostic(task, section, eventType, payload = {}) {
        const api = window.electronAPI?.downloads;
        const platform = String(task?.platform || '').toLowerCase();
        const enabled = platform === 'gog' ? api?.diagnosticsEnabled : platform === 'epic' && api?.epicTraceEnabled;
        if (!enabled || !api?.recordDiagnostic || !task?.id) return;
        api.recordDiagnostic({ taskId: task.id, section, eventType, payload: { ...payload, taskRevision: payload.taskRevision ?? task.taskRevision, progressSessionId: payload.progressSessionId ?? task.progressSessionId } }).catch(() => {});
    }

    const epicTraceDomTimes = new Map();
    function dlEpicTraceDom(task, eventType, state = null) {
        try {
            if (!window.electronAPI?.downloads?.epicTraceEnabled || task?.platform !== 'epic') return;
            const now = Date.now();
            if (eventType === 'RENDERER_ANIMATION' && now - (epicTraceDomTimes.get(task.id) || 0) < 250) return;
            epicTraceDomTimes.set(task.id, now);
            const card = document.querySelector(`[data-download-task-id="${dlCssEscape(task.id)}"]`);
            const fields = {};
            for (const field of ['status', 'downloaded', 'speed', 'disk', 'eta']) {
                fields[field] = card?.querySelector(`[data-download-field="${field}"]`)?.textContent ?? null;
            }
            dlRecordDiagnostic(task, 'progressPipeline', eventType, {
                cardPresent: Boolean(card), documentHidden: document.hidden, fields,
                visiblePercent: card?.querySelector('.download-progress-percent')?.textContent ?? null,
                progressWidth: card?.querySelector('.download-progress-fill')?.style?.width ?? null,
                status: task.status, stage: task.stage, statusMessage: task.statusMessage,
                downloadedBytes: task.downloadedBytes, totalBytes: task.totalBytes,
                rawDownloadedBytes: task.rawDownloadedBytes, writtenBytes: task.writtenBytes,
                providerReportedPercent: task.providerReportedPercent, progressPercent: task.progressPercent,
                etaSeconds: task.etaSeconds, etaSource: task.etaSource, etaUpdatedAt: task.etaUpdatedAt,
                displayedBytes: state?.displayedBytes, targetBytes: state?.targetBytes,
            });
        } catch {}
    }

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
            if (state === 'stale') return 'Waiting';
            return 'Measuring';
        }
        return `${dlFormatBytes(n)}/s`;
    }

    function dlHasFiniteTelemetryValue(value) {
        return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    }

    function dlFormatTelemetryRate(bytes, task = {}) {
        const state = String(task?.telemetryState || '');
        if (!dlHasFiniteTelemetryValue(bytes)) return state === 'unsupported' ? 'Unsupported' : 'Measuring';
        return Number(bytes) > 0 ? `${dlFormatBytes(bytes)}/s` : '0 B/s';
    }

    function dlFormatDiskUsage(task = {}) {
        const status = String(task.status || '').toLowerCase();
        const telemetryState = String(task.telemetryState || '').toLowerCase();
        if (status === 'paused' || status === 'pausing') return 'Paused';
        if (['completed', 'cancelled', 'failed'].includes(status)) return '0 B/s';
        if (telemetryState === 'unsupported') return 'Unsupported';

        const hasDiskUsage = dlHasFiniteTelemetryValue(task.diskUsageBps);
        const hasRawDiskSample = dlHasFiniteTelemetryValue(task.diskWriteSpeedBps);
        if (!hasDiskUsage && !hasRawDiskSample) {
            return telemetryState === 'idle' || telemetryState === 'stale' ? '0 B/s' : 'Measuring';
        }

        const value = hasDiskUsage ? Number(task.diskUsageBps) : Number(task.diskWriteSpeedBps);
        return value > 0 ? `${dlFormatBytes(value)}/s` : '0 B/s';
    }

    function dlEtaUpdatedAtMs(task = {}) {
        const numeric = Number(task.etaUpdatedAt);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
        const parsed = Date.parse(task.etaUpdatedAt || '');
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function dlHasFreshProviderEta(task = {}, now = Date.now()) {
        const eta = Number(task.etaSeconds);
        const updatedAt = dlEtaUpdatedAtMs(task);
        return task.etaSource === 'provider' && Number.isFinite(eta) && eta > 0 && updatedAt > 0 && now - updatedAt < DOWNLOAD_ETA_FRESH_MS;
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
        const totalBytes = Number(task.totalBytes);
        // A confirmed Epic counter remains displayable before its denominator is known.
        const authoritativeBytes = Number(task.platform === 'epic' && !(totalBytes > 0) && dlHasFiniteTelemetryValue(task.rawDownloadedBytes)
            ? task.rawDownloadedBytes
            : task.downloadedBytes);
        const authoritative = Number.isFinite(authoritativeBytes)
            ? Math.max(0, authoritativeBytes)
            : 0;
        return Number.isFinite(totalBytes) && totalBytes > 0
            ? Math.min(authoritative, totalBytes)
            : authoritative;
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
        const initialEta = dlHasFreshProviderEta(task) ? Number(task.etaSeconds) : null;

        return {
            sessionId: dlPresentationSessionId(task),

            displayedBytes: safeConfirmedBytes,
            targetBytes: safeConfirmedBytes,
            lastConfirmedBytes: safeConfirmedBytes,
            animationStartBytes: safeConfirmedBytes,
            animationStartedAt: now,
            animationDurationMs: DOWNLOAD_PRESENTATION_ANIMATION_MS,
            preserveDisplayAcrossResume: false,
            lastConfirmedAt: now,

            displayedRateBps: initialRate,
            displayedEtaSeconds:
                Number.isFinite(initialEta) && initialEta > 0
                    ? initialEta
                    : null,
            etaSource: initialEta ? 'provider' : null,
            lastEtaUpdatedAtMs: initialEta ? dlEtaUpdatedAtMs(task) : 0,

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
        if (!taskId) return null;

        const now = dlPresentationNow();
        const sessionId = dlPresentationSessionId(task);
        let state = downloadPresentationStates.get(taskId);
        const sessionChanged = Boolean(
            state && sessionId && state.sessionId && sessionId !== state.sessionId
        );
        if (!state) {
            state = dlCreatePresentationState(task, now);
            downloadPresentationStates.set(taskId, state);
        } else if (sessionChanged) {
            const previousDisplayedBytes = Number(state.displayedBytes) || 0;
            state = dlCreatePresentationState(task, now);
            state.displayedBytes = Math.min(previousDisplayedBytes, state.targetBytes);
            state.animationStartBytes = state.displayedBytes;
            state.animationStartedAt = now;
            downloadPresentationStates.set(taskId, state);
        }
        if (sessionId) state.sessionId = sessionId;

        const authoritativeBytes = getDisplayDownloadedBytes(task);
        const previousConfirmed = Number(state.lastConfirmedBytes) || 0;
        if (authoritativeBytes > previousConfirmed) state.lastConfirmedAt = now;
        state.lastConfirmedBytes = authoritativeBytes;

        const previousTargetBytes = Number(state.targetBytes) || 0;
        if (authoritativeBytes > previousTargetBytes) {
            state.animationStartBytes = Math.min(Number(state.displayedBytes) || 0, authoritativeBytes);
            state.animationStartedAt = now;
            state.animationDurationMs = DOWNLOAD_PRESENTATION_ANIMATION_MS;
        }
        state.targetBytes = authoritativeBytes;

        if (
            !Number.isFinite(Number(state.displayedBytes)) ||
            Number(state.displayedBytes) > authoritativeBytes
        ) {
            state.displayedBytes = authoritativeBytes;
            state.animationStartBytes = authoritativeBytes;
            state.animationStartedAt = now;
        }

        const rawDownloadedBytes = Number(task.rawDownloadedBytes);
        const writtenBytes = Number(task.writtenBytes);
        const rawAdvanced = Number.isFinite(rawDownloadedBytes) && (
            state.lastRawDownloadedBytes == null || rawDownloadedBytes > state.lastRawDownloadedBytes
        );
        const writtenAdvanced = Number.isFinite(writtenBytes) && (
            state.lastWrittenBytes == null || writtenBytes > state.lastWrittenBytes
        );
        if (rawAdvanced || writtenAdvanced || authoritativeBytes > previousConfirmed) {
            state.lastActivityAt = now;
        }
        if (Number.isFinite(rawDownloadedBytes)) state.lastRawDownloadedBytes = rawDownloadedBytes;
        if (Number.isFinite(writtenBytes)) state.lastWrittenBytes = writtenBytes;

        let patchRate = incomingPatch ? dlBestPresentationRate(incomingPatch) : 0;
        if (patchRate <= 0 && Array.isArray(incomingPatch?.speedHistory) && incomingPatch.speedHistory.length) {
            const latestSample = incomingPatch.speedHistory[incomingPatch.speedHistory.length - 1];
            patchRate = dlBestPresentationRate({
                downloadSpeedBps: latestSample?.downloadSpeedBps,
                diskWriteSpeedBps: latestSample?.diskUsageBps,
            });
        }

        const stale = String(task.networkState || task.telemetryState || '') === 'stale' ||
            String(task.stage || '').toLowerCase() === 'stalled';
        if (stale) {
            state.displayedRateBps = 0;
            state.displayedEtaSeconds = null;
            state.lastActivityAt = 0;
        } else if (patchRate > 0) {
            state.lastActivityAt = now;
            state.displayedRateBps = state.displayedRateBps > 0
                ? Math.round((state.displayedRateBps * 0.65) + (patchRate * 0.35))
                : Math.round(patchRate);
        }

        if (!stale && incomingPatch && dlHasFreshProviderEta(incomingPatch)) {
            state.displayedEtaSeconds = Number(incomingPatch.etaSeconds);
            state.etaSource = 'provider';
            state.lastEtaUpdatedAtMs = dlEtaUpdatedAtMs(incomingPatch);
        } else if (incomingPatch && Object.prototype.hasOwnProperty.call(incomingPatch, 'etaSeconds') && !dlHasFreshProviderEta(incomingPatch)) {
            state.displayedEtaSeconds = null;
            state.etaSource = null;
            state.lastEtaUpdatedAtMs = 0;
        } else if (state.lastEtaUpdatedAtMs && Date.now() - state.lastEtaUpdatedAtMs >= DOWNLOAD_ETA_FRESH_MS) {
            state.displayedEtaSeconds = null;
            state.etaSource = null;
            state.lastEtaUpdatedAtMs = 0;
        }

        const status = String(task.status || '');
        if (status === 'completed') {
            state.displayedBytes = authoritativeBytes;
            state.targetBytes = authoritativeBytes;
            state.displayedRateBps = 0;
            state.displayedEtaSeconds = null;
            state.etaSource = null;
            state.lastEtaUpdatedAtMs = 0;
            state.lastTickAt = now;
        } else if (['paused', 'failed', 'cancelled'].includes(status)) {
            state.displayedBytes = Math.min(Number(state.displayedBytes) || 0, authoritativeBytes);
            state.displayedRateBps = 0;
            state.displayedEtaSeconds = null;
            state.lastTickAt = now;
            if (status !== 'paused') state.preserveDisplayAcrossResume = false;
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
        if (!task || !state) return false;
        const status = String(task.status || '');
        const authoritativeBytes = getDisplayDownloadedBytes(task);
        const previousBytes = Number(state.displayedBytes) || 0;

        state.lastTickAt = now;
        state.lastConfirmedBytes = authoritativeBytes;
        state.targetBytes = Math.min(Number(state.targetBytes) || 0, authoritativeBytes);

        if (status === 'completed') {
            state.displayedBytes = authoritativeBytes;
            state.targetBytes = authoritativeBytes;
            return Math.abs(authoritativeBytes - previousBytes) >= 1;
        }

        if (!DOWNLOAD_PRESENTATION_ACTIVE_STATUSES.has(status)) {
            if (previousBytes > authoritativeBytes) {
                state.displayedBytes = authoritativeBytes;
                return true;
            }
            return false;
        }

        if (previousBytes > authoritativeBytes) {
            state.displayedBytes = authoritativeBytes;
            return true;
        }

        const targetBytes = Math.min(Number(state.targetBytes) || 0, authoritativeBytes);
        const gap = Math.max(0, targetBytes - previousBytes);
        if (gap < 1) return false;
        const startBytes = Math.min(Number(state.animationStartBytes) || previousBytes, targetBytes);
        const durationMs = Math.max(800, Math.min(1500, Number(state.animationDurationMs) || DOWNLOAD_PRESENTATION_ANIMATION_MS));
        const elapsedMs = Math.max(0, now - (Number(state.animationStartedAt) || now));
        const linearProgress = Math.min(1, elapsedMs / durationMs);
        const easedProgress = 1 - Math.pow(1 - linearProgress, 3);
        const nextBytes = Math.min(targetBytes, startBytes + ((targetBytes - startBytes) * easedProgress));
        state.displayedBytes = nextBytes;
        return nextBytes - previousBytes >= 1;
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

        return dlHasFiniteTelemetryValue(task.progressPercent)
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
        if (
            String(task.networkState || task.telemetryState || '') === 'stale' ||
            String(task.stage || '').toLowerCase() === 'stalled' ||
            !dlHasFreshProviderEta(task)
        ) return null;
        const state = dlSyncPresentationState(task);
        if (
            state &&
            state.etaSource === 'provider' &&
            state.lastEtaUpdatedAtMs > 0 &&
            Date.now() - state.lastEtaUpdatedAtMs < DOWNLOAD_ETA_FRESH_MS &&
            Number.isFinite(Number(state.displayedEtaSeconds))
        ) return Math.max(0, Number(state.displayedEtaSeconds));
        return dlHasFreshProviderEta(task) ? Number(task.etaSeconds) : null;
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
            dlDownloadedText(task)
        );

        const visibleRate = dlFreshPresentationRate(
            state,
            dlPresentationNow()
        );

        setText(
            card,
            'speed',
            dlFormatRate(
                visibleRate,
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
            ? downloadsSnapshot.tasks.find(item => String(item.id) === String(taskId))
            : null;
        if (!task) return;
        const state = dlSyncPresentationState(task);
        if (!state) return;
        const authoritativeBytes = getDisplayDownloadedBytes(task);
        state.displayedBytes = Math.min(Number(state.displayedBytes) || 0, authoritativeBytes);
        state.targetBytes = authoritativeBytes;
        state.preserveDisplayAcrossResume = true;
        state.displayedRateBps = 0;
        state.displayedEtaSeconds = null;
        state.lastTickAt = dlPresentationNow();
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
                dlEpicTraceDom(task, 'RENDERER_ANIMATION', state);
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

    function dlUnknownProgressLabel(task) {
        return task?.platform === 'epic' && (Number(task.downloadSpeedBps) > 0 || Number(task.downloadedBytes) > 0)
            ? 'Calculating'
            : 'Preparing';
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
        return dlHasFiniteTelemetryValue(task?.progressPercent) ? Math.max(0, Math.min(100, n)) : null;
    }

    function dlCleanStatus(task) {
        if (task?.status === 'completed' && task?.platform === 'epic'
            && task?.installProvider === 'legendary' && task?.readyToPlay !== true) return 'Finalization incomplete';
        if (task?.maintenanceErrorCode) return task.operationKind === 'repair' ? 'Verify / Repair failed' : 'Update failed';
        if (task?.status === 'completed' && task.updateAvailable === true) return 'Completed · Update available';
        if (task?.platform === 'gog' || (task?.platform === 'epic' && task?.installProvider === 'legendary')) {
            if (task.operationKind === 'repair') {
                if (task.status === 'pending') return 'Verify / Repair queued';
                if (task.status === 'completed') return 'Verification and repair complete';
            }
            if (task.operationKind === 'update') {
                if (task.status === 'pending') return 'Update queued';
                if (task.status === 'completed') return 'Update complete';
            }
            const labels = { pending: 'Waiting in queue', preparing: 'Preparing download', resuming: 'Resuming...', pausing: 'Pausing...', paused: 'Paused', failed: 'Download failed', completed: 'Ready to play' };
            if (labels[task.status]) return labels[task.status];
            if (task.status === 'verifying' || task.stage === 'verifying') return 'Verifying files';
            if (task.stage === 'finalizing' || task.status === 'installing') return 'Finalizing installation';
            if (task.status === 'downloading') return 'Downloading';
        }
        const stage = String(task?.stage || task?.status || '').toLowerCase();
        const raw = String(task?.statusMessage || '').trim();
        if (task?.status === 'paused') return 'Paused';
        if (task?.status === 'failed') return 'Download failed';
        if (task?.status === 'completed') return 'Ready to play';
        if (stage === 'verifying' || (task?.platform === 'epic' && task?.status === 'verifying')) return 'Verifying files';
        if (stage === 'finalizing') return 'Finalizing installation';
        if (stage === 'installing') return task?.platform === 'epic' ? 'Installing game files' : 'Finalizing installation';
        if (stage === 'preparing' || task?.status === 'preparing' || task?.status === 'resuming') return 'Preparing download';
        if (/^\[?PROGRESS INFO/i.test(raw) || /Progress:\s*\d/i.test(raw)) {
            if (stage === 'verifying') return 'Verifying files';
            if (stage === 'installing') return 'Finalizing installation';
            return 'Downloading compressed data';
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

    function dlTaskReadyToPlay(task = {}) {
        if (task.status !== 'completed') return false;
        if (task.platform === 'epic' && task.installProvider === 'legendary') return task.readyToPlay === true;
        return true;
    }

    function dlDownloadedText(task) {
        const displayedBytes = dlPresentedBytes(task);
        const totalBytes = Number(task.totalBytes);
        if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
            return task.platform === 'epic'
                ? `${dlFormatBytes(displayedBytes)} / Calculating`
                : dlFormatBytes(displayedBytes);
        }
        const remainingBytes = Math.max(0, totalBytes - displayedBytes);
        const nearCompletion = displayedBytes / totalBytes >= 0.95 && remainingBytes > 0;
        if (nearCompletion) {
            const remainingMb = Math.max(0.1, remainingBytes / 1000000);
            return `${(displayedBytes / 1000000000).toFixed(3)} GB / ${(totalBytes / 1000000000).toFixed(3)} GB (${remainingMb.toFixed(1)} MB remaining)`;
        }
        return `${dlFormatBytes(displayedBytes)} / ${dlFormatBytes(totalBytes)}`;
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
                    ${task.platform === 'gog' || (task.platform === 'epic' && task.installProvider === 'legendary') ? dlStatCard('Transfer Activity', dlEsc(task.providerActivity || task.statusMessage || 'Unknown')) : ''}
                    ${dlStatCard('Network Transferred', dlEsc(dlFormatBytes(task.rawDownloadedBytes)))}
                    ${dlStatCard('Game Files Written', dlEsc(dlFormatBytes(task.writtenBytes)))}
                    ${dlStatCard('Network Speed', dlEsc(dlFormatTelemetryRate(task.rawDownloadSpeedBps, { ...task, telemetryState: task.networkState })))}
                    ${dlStatCard('Disk Write Speed', dlEsc(dlFormatTelemetryRate(task.diskWriteSpeedBps, task)))}
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
        formatDiskUsage: dlFormatDiskUsage,
        formatDuration: dlFormatDuration,
        downloadedText: dlDownloadedText,
        percent: getEffectiveTransferPercent,
    };

    function dlButton({ label, action, taskId, tone = 'secondary', disabled = false }) {
        return `<button class="download-btn download-btn-${tone}" ${disabled ? 'disabled' : ''} onclick="${action}('${dlEsc(taskId)}')">${dlEsc(label)}</button>`;
    }

    function dlCompletedMenu(task, disabled) {
        const menuId = 'download-actions-' + task.id;
        const item = (label, action) => '<button type="button" role="menuitem" class="dropdown-item" data-task-action="' + action + '" data-task-id="' + dlEsc(task.id) + '">' + label + '</button>';
        const capabilities = downloadsProviderCapabilities.find(entry => entry.platform === task.platform || (task.platform === 'gog' && entry.provider === 'gog')) || {};
        const maintenanceRecord = (downloadsSnapshot?.managedInstallations || []).find(record => String(record.taskId) === String(task.id));
        const maintainable = Boolean(maintenanceRecord?.maintenanceEligible && task.installPath && task.installedGameId);
        const uninstallable = task.uninstallEligible === true && task.installPath && task.installedGameId;
        const maintenance = maintainable
            ? (capabilities.supportsUpdate ? item('Check for Updates', 'check-update') : '')
                + (capabilities.supportsUpdate && task.updateAvailable === true ? item('Update', 'update') : '')
                + (capabilities.supportsRepair ? item('Verify / Repair', 'repair') : '')
            : '';
        return '<div class="custom-dropdown download-overflow" data-baddel-menu><button type="button" class="download-btn download-overflow-trigger" data-menu-trigger aria-label="More actions for ' + dlEsc(task.title) + '" title="More actions" aria-haspopup="menu" aria-expanded="false" aria-controls="' + dlEsc(menuId) + '"' + (disabled ? ' disabled' : '') + '><span aria-hidden="true">&#8943;</span></button><div class="dropdown-menu" role="menu" id="' + dlEsc(menuId) + '" hidden>' + item('Game Info', 'info') + (task.installPath ? item('Open Folder', 'folder') : '') + maintenance + (uninstallable ? item('Uninstall', 'uninstall') : '') + '</div></div>';
    }
    function dlGameInfoSizes(task) {
        const first = fields => fields.map(field => task[field]).find(value => typeof value === 'number' && Number.isFinite(value) && value > 0) ?? null;
        const transferSource = task.providerCompletionReceipt?.transfer?.source || task.totalBytesSource || null;
        const diskBased = /filesystem|verified-disk|installed/i.test(String(transferSource || ''));
        const networkTransfer = ['gogdl-overall-progress', 'legendary-runtime-transfer', 'legendary-completion-transfer', 'legendary-info-manifest', 'gog-public-windows-manifest', 'gogdl-info'].includes(String(transferSource || ''));
        const declaredDownloadSource = String(task.downloadSizeSource || task.sizeSource || '');
        const gogDeclaredDownload = ['gog-public-windows-manifest', 'gogdl-info', 'gogdl-overall-progress'].includes(declaredDownloadSource);
        const download = task.platform === 'gog'
            ? (gogDeclaredDownload ? first(['downloadSizeBytes', 'expectedDownloadBytes']) : networkTransfer && !diskBased ? first(['transferTotalBytes', 'providerTotalBytes', 'totalBytes']) : null)
            : first(diskBased ? ['downloadSizeBytes', 'expectedDownloadBytes', 'providerTotalBytes'] : ['downloadSizeBytes', 'expectedDownloadBytes', 'transferTotalBytes', 'providerTotalBytes', 'totalBytes']);
        return {
            download,
            installed: first(['verificationActualBytes', 'installedDiskSizeBytes', 'expectedInstalledBytes']),
        };
    }
    function dlGameInfoRows(task) {
        const date = value => { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : null; };
        const bytes = value => dlHasFiniteTelemetryValue(value) ? dlFormatBytes(value) : 'Unavailable';
        const sizes = dlGameInfoSizes(task);
        return [['Game', task.title], ['Platform', task.platform], ['Account', task.accountDisplayName], ['Install path', task.installPath], ['Download size', bytes(sizes.download)], ['Installed size', bytes(sizes.installed)], ['Queued on', date(task.queuedAt || task.createdAt)], ['Downloaded on', date(task.completedAt)], ['Free space at queue', bytes(task.freeSpaceBytesAtQueue)], ['Build/version', task.verifiedBuildId || task.buildVersion]].filter(([, value]) => value != null && value !== '');
    }
    window.downloadsGameInfo = taskId => {
        const task = downloadsSnapshot?.tasks?.find(item => item.id === taskId && item.status === 'completed');
        if (!task) return;
        document.getElementById('downloadGameInfo')?.remove();
        const previousFocus = document.activeElement;
        const dialog = document.createElement('dialog');
        dialog.id = 'downloadGameInfo'; dialog.className = 'download-info-dialog';
        dialog.setAttribute('aria-label', 'Game Info');
        dialog.innerHTML = '<header><h2>Game Info</h2></header><div class="download-info-body"><dl class="install-plan-values">' + dlGameInfoRows(task).map(([label, value]) => '<dt>' + dlEsc(label) + '</dt><dd>' + dlEsc(value) + '</dd>').join('') + '</dl></div><footer class="download-info-footer"><button type="button" class="download-btn">Close</button></footer>';
        dialog.querySelector('button').onclick = () => dialog.close();
        dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
        dialog.addEventListener('close', () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); });
        document.body.appendChild(dialog); dialog.showModal();
    };
    document.addEventListener('click', event => {
        const item = event.target.closest?.('[data-task-action]');
        if (!item) return;
        const task = downloadsSnapshot?.tasks?.find(task => task.id === item.dataset.taskId && task.status === 'completed');
        if (!task) return;
        window.baddelMenus?.close(true);
        const handlers = { info: window.downloadsGameInfo, folder: window.downloadsOpenFolder, uninstall: window.downloadsUninstall, 'check-update': window.downloadsCheckUpdate, update: window.downloadsUpdate, repair: window.downloadsRepair };
        if (item.dataset.taskAction === 'uninstall' && task.uninstallEligible !== true) return;
        handlers[item.dataset.taskAction]?.(task.id);
    });

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

        const presentedEta = dlPresentedEta(task);
        const diskText = dlFormatDiskUsage(task);
        dlRecordDiagnostic(task, 'progressPipeline', 'RENDERER_PRESENTATION_STATE', {
            providerDownloadedBytes: task.providerDownloadedBytes ?? task.downloadedBytes ?? null,
            providerTotalBytes: task.providerTotalBytes ?? task.totalBytes ?? null,
            reconciledDownloadedBytes: task.downloadedBytes ?? null,
            reconciledTotalBytes: task.totalBytes ?? null,
            taskDownloadedBytesAfter: task.downloadedBytes ?? null,
            taskProgressPercentAfter: task.progressPercent ?? null,
            writtenBytes: task.writtenBytes ?? null,
            rawDownloadSpeedBps: task.rawDownloadSpeedBps ?? null,
            decompressionSpeedBps: task.decompressionSpeedBps ?? null,
            diskWriteSpeedBps: task.diskWriteSpeedBps ?? null,
            diskUsageBps: task.diskUsageBps ?? null,
            telemetryState: task.telemetryState || null,
            networkState: task.networkState || null,
            providerReportedPercent: task.providerReportedPercent ?? null,
            rawDownloadedBytes: task.rawDownloadedBytes ?? null,
            statusTextBeforeDebounce: task.statusTextBeforeDebounce || null,
            statusTextAfterDebounce: task.statusTextAfterDebounce || null,
            statusChangeReason: task.statusChangeReason || null,
            etaSource: task.etaSource || null,
            etaUpdatedAt: task.etaUpdatedAt || null,
            lastSpeedHistorySample: Array.isArray(task.speedHistory) ? task.speedHistory.at(-1) || null : null,
            displayedDiskText: diskText,
            confirmedBytes: getDisplayDownloadedBytes(task),
            presentation: {
                displayedBytes: presentationState?.displayedBytes ?? getDisplayDownloadedBytes(task),
                targetBytes: presentationState?.targetBytes ?? getDisplayDownloadedBytes(task),
                displayedRateBps: presentedRate,
                invariantExceeded: Number(presentationState?.displayedBytes || 0) > Number(presentationState?.targetBytes || 0),
            },
        });

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

        const speedText =
            task.status === 'paused'
                ? 'Paused'
                : dlFormatRate(
                    presentedRate,
                    task
                );

        const actionButtons = [
            dlTaskReadyToPlay(task) ? dlButton({ label: 'Play', action: 'downloadsPlay', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.status === 'completed' ? dlCompletedMenu(task, isBusy) : '',
            task.status === 'paused' ? dlButton({ label: 'Resume', action: 'downloadsResume', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.status === 'resuming' ? dlButton({ label: 'Resuming...', action: 'downloadsPause', taskId: task.id, disabled: true }) : '',
            task.status === 'pausing' ? dlButton({ label: 'Pausing...', action: 'downloadsPause', taskId: task.id, disabled: true }) : '',
            isActiveTask && !['resuming', 'pausing'].includes(task.status) ? dlButton({ label: isBusy ? 'Pausing...' : 'Pause', action: 'downloadsPause', taskId: task.id, disabled: isBusy }) : '',
            task.status === 'pending' ? dlButton({ label: 'Start Now', action: 'downloadsStartNow', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.status === 'failed' ? dlButton({ label: 'Retry', action: 'downloadsRetry', taskId: task.id, tone: 'primary', disabled: isBusy }) : '',
            task.status !== 'completed' && task.installPath ? dlButton({ label: 'Open Folder', action: 'downloadsOpenFolder', taskId: task.id }) : '',
            !isTerminalTask ? dlButton({ label: 'Cancel', action: 'downloadsCancel', taskId: task.id, tone: 'danger', disabled: isBusy }) : '',
            isTerminalTask && task.status !== 'completed' ? dlButton({ label: 'Remove', action: 'downloadsRemove', taskId: task.id, disabled: isBusy && task.status !== 'failed' }) : '',
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
                                <span class="download-progress-percent" data-download-field="percent">${pct === null ? dlUnknownProgressLabel(task) : `${pct.toFixed(1)}%`}</span>
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
        window.baddelMenus?.close();
        downloadsSnapshot = snapshot || { tasks: [], badgeCount: 0, activeCount: 0, pendingCount: 0, aggregateSpeedBps: 0 };
        refreshDownloadCapabilities();
        dlPublishManagedMaintenanceState();
        const root = document.getElementById('downloadsRoot');
        const badge = document.getElementById('downloadsBadge');
        const speed = document.getElementById('downloadsSpeed');
        const activeCount = document.getElementById('downloadsActiveCount');
        const pendingCount = document.getElementById('downloadsPendingCount');
        const clearBtn = document.getElementById('downloadsClearCompleted');
        const tasks = Array.isArray(downloadsSnapshot.tasks) ? downloadsSnapshot.tasks : [];
        dlSyncFilterControls(tasks);
        downloadVisibleSignature = dlVisibleSignature(tasks);
        dlCleanupPresentationStates(tasks);
        for (const task of tasks) {
            dlSyncPresentationState(task);
            if (task.status === 'completed' && !downloadsCompletedDiagnostics.has(task.id)) {
                downloadsCompletedDiagnostics.add(task.id);
                dlRecordDiagnostic(task, 'completionTimeline', 'RENDERER_RECEIVED_COMPLETED', {
                    installedGameId: task.installedGameId || null,
                    resolvedExecutablePath: task.resolvedExecutablePath || null,
                });
            }
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
                    <div class="downloads-empty-content">
                        <div class="downloads-empty-icon">
                            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><polyline points="7 10 12 15 17 10"></polyline><path d="M5 21h14"></path></svg>
                        </div>
                        <h3>No downloads yet</h3>
                        <p>Games you install directly from GOG or Epic will appear here.</p>
                        <button class="download-btn download-btn-primary" onclick="navigateToReadyToInstall()">Browse Ready to Install</button>
                    </div>
                </div>`;
            return;
        }

        const visible = dlFilterTasks(tasks);
        const active = visible.filter(t => DOWNLOAD_ACTIVE_STATUSES.has(t.status));
        const pending = visible.filter(t => t.status === 'pending');
        const paused = visible.filter(t => t.status === 'paused');
        const failed = visible.filter(t => t.status === 'failed');
        const completed = visible.filter(t => t.status === 'completed');
        root.innerHTML = [
            active.length ? `<section><h3 class="downloads-section-title">Active Download</h3>${active.map(t => dlTaskCard(t, true)).join('')}</section>` : '',
            pending.length ? `<section><h3 class="downloads-section-title">Up Next</h3>${pending.map((t, i) => dlTaskCard(t, false, i)).join('')}</section>` : '',
            paused.length ? `<section><h3 class="downloads-section-title">Paused</h3>${paused.map((t, i) => dlTaskCard(t, true, i)).join('')}</section>` : '',
            failed.length ? `<section><h3 class="downloads-section-title">Needs Attention</h3>${failed.map((t, i) => dlTaskCard(t, false, i)).join('')}</section>` : '',
            completed.length ? `<section><h3 class="downloads-section-title">Completed</h3>${completed.map((t, i) => dlTaskCard(t, false, i)).join('')}</section>` : '',
        ].filter(Boolean).join('') || '<div class="downloads-empty">No downloads match these filters.</div>';
        for (const task of tasks) dlEpicTraceDom(task, 'RENDERER_SNAPSHOT_DOM');
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
        if (el && el.textContent !== String(value)) el.textContent = value;
    }

    function patchDownloadTaskCard(update = {}) {
        if (window.electronAPI?.downloads?.epicTraceEnabled) {
            const traceTask = downloadsSnapshot?.tasks?.find(task => task.id === (update.taskId || update.id));
            if (traceTask) dlRecordDiagnostic(traceTask, 'progressPipeline', 'RENDERER_RECEIVED_PATCH', { update, taskRevision: update.taskRevision, progressSessionId: update.progressSessionId || update.patch?.progressSessionId });
        }
        const previousTask = downloadsSnapshot?.tasks?.find(item => item.id === (update.taskId || update.id));
        const task = mergeTaskPatch(update);
        if (!task) return;
        dlPublishManagedMaintenanceState();
        const patch = update.patch || update;
        const filterFields = ['title', 'platform', 'totalBytes', 'installedDiskSizeBytes', 'createdAt', 'queuedAt', 'completedAt', 'status'];
        if (filterFields.some(key => Object.hasOwn(patch, key) && patch[key] !== previousTask?.[key]) && dlVisibleSignature(downloadsSnapshot.tasks) !== downloadVisibleSignature) {
            renderDownloads(downloadsSnapshot);
            return;
        }
        const card = document.querySelector(`[data-download-task-id="${dlCssEscape(task.id)}"]`);
        if (!card) return;
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

        const presentedEta = dlPresentedEta(task);
        const diskText = dlFormatDiskUsage(task);
        dlRecordDiagnostic(task, 'progressPipeline', 'RENDERER_PRESENTATION_STATE', {
            providerDownloadedBytes: task.providerDownloadedBytes ?? task.downloadedBytes ?? null,
            providerTotalBytes: task.providerTotalBytes ?? task.totalBytes ?? null,
            reconciledDownloadedBytes: task.downloadedBytes ?? null,
            reconciledTotalBytes: task.totalBytes ?? null,
            taskDownloadedBytesAfter: task.downloadedBytes ?? null,
            taskProgressPercentAfter: task.progressPercent ?? null,
            writtenBytes: task.writtenBytes ?? null,
            rawDownloadSpeedBps: task.rawDownloadSpeedBps ?? null,
            decompressionSpeedBps: task.decompressionSpeedBps ?? null,
            diskWriteSpeedBps: task.diskWriteSpeedBps ?? null,
            diskUsageBps: task.diskUsageBps ?? null,
            telemetryState: task.telemetryState || null,
            networkState: task.networkState || null,
            providerReportedPercent: task.providerReportedPercent ?? null,
            rawDownloadedBytes: task.rawDownloadedBytes ?? null,
            statusTextBeforeDebounce: task.statusTextBeforeDebounce || null,
            statusTextAfterDebounce: task.statusTextAfterDebounce || null,
            statusChangeReason: task.statusChangeReason || null,
            etaSource: task.etaSource || null,
            etaUpdatedAt: task.etaUpdatedAt || null,
            lastSpeedHistorySample: Array.isArray(task.speedHistory) ? task.speedHistory.at(-1) || null : null,
            displayedDiskText: diskText,
            confirmedBytes: getDisplayDownloadedBytes(task),
            presentation: {
                displayedBytes: presentationState?.displayedBytes ?? getDisplayDownloadedBytes(task),
                targetBytes: presentationState?.targetBytes ?? getDisplayDownloadedBytes(task),
                displayedRateBps: presentedRate,
                invariantExceeded: Number(presentationState?.displayedBytes || 0) > Number(presentationState?.targetBytes || 0),
            },
        });
        const fill = card.querySelector('.download-progress-fill');
        const label = card.querySelector('.download-progress-percent');
        if (fill) {
            fill.style.width = pct === null ? '35%' : `${Math.max(0, Math.min(100, pct))}%`;
            fill.style.opacity = pct === null ? '.45' : '';
        }
        if (label) label.textContent = pct === null ? dlUnknownProgressLabel(task) : `${pct.toFixed(1)}%`;
        setText(card, 'status', dlCleanStatus(task));
        setText(card, 'downloaded', dlDownloadedText(task));
        setText(
            card,
            'speed',
            dlFormatRate(
                presentedRate,
                task
            )
        );
        setText(card, 'disk', diskText);
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
        dlEpicTraceDom(task, 'RENDERER_PATCH_DOM', presentationState);
    }

    async function refreshDownloads() {
        const res = await window.electronAPI?.downloads?.getSnapshot?.();
        if (res?.status === 'success') renderDownloads(res.snapshot);
        else if (res?.message && typeof showToast === 'function') showToast(res.message, 'error');
    }

    window.navigateToDownloads = async function navigateToDownloads() {
        window.electronAPI?.trackFeatureEvent?.('feature_viewed', { feature: 'downloads', view: 'downloads' }).catch?.(() => {});
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
                window.electronAPI?.trackFeatureEvent?.('download_action', { feature: 'downloads', action: label, result: 'failed', error_code: res?.code }).catch?.(() => {});
                if (typeof showToast === 'function') showToast(res.message || `${label} failed`, 'error');
                return;
            }
            window.electronAPI?.trackFeatureEvent?.('download_action', { feature: 'downloads', action: label, result: 'success' }).catch?.(() => {});
            if (res?.snapshot) renderDownloads(res.snapshot);
            else await refreshDownloads();
        } catch (err) {
            window.electronAPI?.trackFeatureEvent?.('download_action', { feature: 'downloads', action: label, result: 'failed', error_code: err }).catch?.(() => {});
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
        const visible = downloadsSnapshot?.tasks || [];
        const managed = (downloadsSnapshot?.managedInstallations || []).map(task => ({ ...task, id: task.taskId }));
        const matches = [...visible, ...managed].filter(task => String(task.id) === String(taskId));
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

    function dlCandidateMatchReason(task = {}, game = {}) {
        if (!dlInstalledGameCanLaunch(game)) return 'noMatch';
        if (task.installedGameId && String(game.id) === String(task.installedGameId)) return 'installedGameId';
        const wantedIds = new Set(dlTaskIdentityValues(task));
        if (dlGameIdentityValues(game).some(id => wantedIds.has(id))) return 'providerIdentity';
        const paths = [game.installPath, game.path, game.executablePath, game.command, game.launchCommand].map(dlPathKey).filter(Boolean);
        const wantedExe = dlPathKey(task.resolvedExecutablePath || task.verificationExecutablePath || task.executablePath);
        if (wantedExe && paths.some(value => value === wantedExe || value.includes(wantedExe) || wantedExe.includes(value))) return 'executablePath';
        const wantedInstallPath = dlPathKey(task.installPath);
        if (wantedInstallPath && paths.some(value => value === wantedInstallPath || value.startsWith(`${wantedInstallPath}/`) || wantedInstallPath.startsWith(`${value}/`))) return 'installPath';
        const platform = String(task.platform || '').trim().toLowerCase();
        const title = String(task.title || '').trim().toLowerCase();
        if (platform && String(game.platform || game.scannerPlatform || '').trim().toLowerCase() === platform && title && String(game.name || game.title || '').trim().toLowerCase() === title) return 'platformAndTitle';
        return 'noMatch';
    }

    function dlFindInstalledGameByTask(task = {}, games = window.allGamesData) {
        const list = Array.isArray(games) ? games : [];
        const wantedIds = new Set(dlTaskIdentityValues(task));
        const wantedInstallPath = dlPathKey(task.installPath);
        const wantedExe = dlPathKey(task.resolvedExecutablePath || task.verificationExecutablePath || task.executablePath);
        const platform = String(task.platform || '').trim().toLowerCase();
        const title = String(task.title || '').trim().toLowerCase();
        const selected = list.find(game => task.installedGameId && String(game.id) === String(task.installedGameId) && dlInstalledGameCanLaunch(game)) ||
            list.find(game => dlInstalledGameCanLaunch(game) && dlGameIdentityValues(game).some(id => wantedIds.has(id))) ||
            list.find(game => {
                if (!dlInstalledGameCanLaunch(game)) return false;
                const paths = [game.installPath, game.path, game.executablePath, game.command, game.launchCommand].map(dlPathKey).filter(Boolean);
                return (wantedExe && paths.some(p => p === wantedExe || p.includes(wantedExe) || wantedExe.includes(p))) ||
                    (wantedInstallPath && paths.some(p => p === wantedInstallPath || p.startsWith(`${wantedInstallPath}/`) || wantedInstallPath.startsWith(`${p}/`)));
            }) ||
            list.find(game => dlInstalledGameCanLaunch(game) && platform && String(game.platform || game.scannerPlatform || '').trim().toLowerCase() === platform && title && String(game.name || game.title || '').trim().toLowerCase() === title) ||
            null;
        if (window.electronAPI?.downloads?.diagnosticsEnabled) {
            for (const game of list) {
                dlRecordDiagnostic(task, 'playResolution', 'DOWNLOAD_PLAY_CANDIDATE', {
                    game: {
                        id: game?.id ?? null, name: game?.name ?? game?.title ?? null, platform: game?.platform ?? null, scannerPlatform: game?.scannerPlatform ?? null,
                        providerProductId: game?.providerProductId ?? null, contentSystemProductId: game?.contentSystemProductId ?? null, gogProductId: game?.gogProductId ?? null, gogdlAppName: game?.gogdlAppName ?? null,
                        launcherGameId: game?.launcherGameId ?? null, ['installPath']: game?.installPath ?? null, path: game?.path ?? null, executablePath: game?.executablePath ?? null, command: game?.command ?? null, launchCommand: game?.launchCommand ?? null,
                    },
                    matchReason: dlCandidateMatchReason(task, game),
                    selected: game === selected,
                });
            }
        }
        return selected;
    }

    async function dlResolveInstalledGameForTask(task = {}) {
        if (task.platform === 'epic' && task.installProvider === 'legendary') {
            const result = await window.electronAPI?.downloads?.resolveEpicPlayTarget?.(task.id);
            if (result?.status !== 'success' || !result.game) {
                const error = new Error(result?.message || 'Baddel could not resolve the finalized Epic installation.');
                error.code = result?.code || 'EPIC_MANAGED_INSTALL_RESOLUTION_FAILED';
                error.stage = result?.stage || 'managed-install-resolution';
                throw error;
            }
            return result.game;
        }
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
            installProvider: task.installProvider || null,
            installSource: task.installProvider ? 'download' : null,
            providerAppName: task.providerAppName || task.appName || null,
            appName: task.appName || task.providerAppName || null,
            namespace: task.namespace || null,
            catalogItemId: task.catalogItemId || null,
            managedDownloadTaskId: task.id || null,
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

    async function dlLaunchInstalledGame(game, task) {
        if (!game) return false;
        game = { ...game, managedDownloadTaskId: task?.id || game.managedDownloadTaskId || null };
        if (window.electronAPI?.downloads?.diagnosticsEnabled) game.__downloadDiagnosticTaskId = task?.id || null;
        dlRecordDiagnostic(task, 'playResolution', 'DOWNLOADS_TO_PLAY_LAUNCHER', {
            game: { id: game.id ?? null, name: game.name ?? game.title ?? null, platform: game.platform ?? null, scannerPlatform: game.scannerPlatform ?? null, path: game.path ?? null, executablePath: game.executablePath ?? null, command: game.command ?? null, launchCommand: game.launchCommand ?? null },
        });
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
        if (!task || !dlTaskReadyToPlay(task)) {
            if (typeof showToast === 'function') showToast('This download is not ready to play yet.', 'error');
            return;
        }
        dlRecordDiagnostic(task, 'playResolution', 'DOWNLOAD_PLAY_REQUEST', {
            task: { id: task.id, title: task.title ?? null, platform: task.platform ?? null, installedGameId: task.installedGameId ?? null, providerProductId: task.providerProductId ?? null, contentSystemProductId: task.contentSystemProductId ?? null, gogProductId: task.gogProductId ?? null, gogdlAppName: task.gogdlAppName ?? null, ['installPath']: task.installPath ?? null, resolvedExecutablePath: task.resolvedExecutablePath ?? null, verificationExecutablePath: task.verificationExecutablePath ?? null },
        });
        let game;
        try {
            game = await dlResolveInstalledGameForTask(task) || dlBuildLaunchGameFromTask(task);
        } catch (error) {
            dlRecordDiagnostic(task, 'playResolution', 'DOWNLOAD_PLAY_RESOLUTION_FAILED', {
                code: error?.code || null,
                stage: error?.stage || null,
            });
            if (typeof showToast === 'function') showToast(error?.message || 'Baddel could not resolve this installation.', 'error');
            return;
        }
        if (!game || !dlInstalledGameCanLaunch(game)) {
            if (typeof showToast === 'function') showToast('Baddel could not find the installed launch target.', 'error');
            return;
        }
        dlRecordDiagnostic(task, 'playResolution', 'DOWNLOAD_PLAY_MATCH', {
            taskTitle: task.title ?? null, matchedGameName: game.name ?? game.title ?? null, matchedGameId: game.id ?? null, matchReason: dlCandidateMatchReason(task, game), resolvedCommand: game.command ?? game.launchCommand ?? null, resolvedExecutablePath: game.executablePath ?? null,
        });
        if (!task.installedGameId && game.id) {
            task.installedGameId = game.id;
            renderDownloads(downloadsSnapshot);
        }
        const launched = await dlLaunchInstalledGame(game, task);
        if (!launched && typeof showToast === 'function') showToast('Play launcher is not available right now.', 'error');
    };

    window.downloadsRemove = taskId => dlAction('Remove', () => window.electronAPI.downloads.remove(taskId));
    window.downloadsStartNow = taskId => dlAction('Start', () => window.electronAPI.downloads.startNow(taskId));
    window.downloadsClearCompleted = () => dlAction('Clear', () => window.electronAPI.downloads.clearCompleted());

    function dlHistoryDate(value) {
        const parsed = new Date(value || '');
        return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Unknown time';
    }

    window.downloadsRenderHistory = function downloadsRenderHistory() {
        const root = document.getElementById('downloadHistoryList');
        if (!root) return;
        const platform = document.getElementById('downloadHistoryPlatform')?.value || 'all';
        const status = document.getElementById('downloadHistoryStatus')?.value || 'all';
        const entries = downloadHistoryEntries
            .filter(entry => platform === 'all' || entry.platform === platform)
            .filter(entry => status === 'all' || entry.status === status)
            .sort((a, b) => Date.parse(b.finishedAt || '') - Date.parse(a.finishedAt || ''));
        document.getElementById('downloadHistoryClear')?.toggleAttribute('disabled', downloadHistoryEntries.length === 0);
        if (!entries.length) {
            root.innerHTML = `<div class="download-history-empty">${downloadHistoryEntries.length ? 'No downloads match these filters.' : 'Your completed and unsuccessful downloads will appear here.'}</div>`;
            return;
        }
        root.innerHTML = entries.map(entry => {
            const artwork = entry.artworkUrl
                ? `<img class="download-history-art" src="${dlEsc(entry.artworkUrl)}" alt="">`
                : '<div class="download-history-art" aria-hidden="true"></div>';
            const platformLabel = entry.platform === 'epic' ? 'Epic Games' : String(entry.platform || 'Unknown').toUpperCase();
            const size = Number(entry.sizeBytes) > 0 ? dlFormatBytes(entry.sizeBytes) : 'Size unavailable';
            return `<article class="download-history-row">
                ${artwork}
                <div class="download-history-game"><strong>${dlEsc(entry.title)}</strong><span>${dlEsc(platformLabel)}${entry.provider ? ` · ${dlEsc(entry.provider)}` : ''}</span></div>
                <div class="download-history-meta"><span class="download-history-status ${dlEsc(entry.status)}">${dlEsc(entry.status)}</span><span>${dlEsc(dlHistoryDate(entry.finishedAt))}</span><span>${dlEsc(size)}</span></div>
            </article>`;
        }).join('');
    };

    window.downloadsOpenHistory = async function downloadsOpenHistory() {
        const modal = document.getElementById('downloadHistoryModal');
        const root = document.getElementById('downloadHistoryList');
        if (!modal || !root) return;
        modal.classList.add('active');
        root.innerHTML = '<div class="download-history-empty">Loading history…</div>';
        try {
            const result = await window.electronAPI.downloads.getHistory();
            if (result?.status !== 'success') throw new Error(result?.message || 'Could not load Download History.');
            downloadHistoryEntries = Array.isArray(result.history) ? result.history : [];
            const platformSelect = document.getElementById('downloadHistoryPlatform');
            if (platformSelect) {
                const selected = platformSelect.value;
                const platforms = [...new Set(downloadHistoryEntries.map(entry => entry.platform).filter(Boolean))].sort();
                platformSelect.innerHTML = '<option value="all">All platforms</option>' + platforms.map(value => `<option value="${dlEsc(value)}">${dlEsc(value === 'epic' ? 'Epic Games' : value.toUpperCase())}</option>`).join('');
                platformSelect.value = platforms.includes(selected) ? selected : 'all';
            }
            window.downloadsRenderHistory();
        } catch (error) {
            root.innerHTML = `<div class="download-history-empty">${dlEsc(error.message || 'Could not load Download History.')}</div>`;
        }
    };

    window.downloadsCloseHistory = function downloadsCloseHistory() {
        document.getElementById('downloadHistoryModal')?.classList.remove('active');
    };

    window.downloadsClearHistory = function downloadsClearHistory() {
        const clear = async () => {
            const result = await window.electronAPI.downloads.clearHistory();
            if (result?.status !== 'success') throw new Error(result?.message || 'Could not clear Download History.');
            downloadHistoryEntries = [];
            window.downloadsRenderHistory();
            if (typeof showToast === 'function') showToast('Download History cleared.', 'success');
        };
        if (typeof openConfirmModal === 'function') {
            openConfirmModal('Clear Download History?', 'This clears only the archive. Active downloads and installed games will not be changed.', 'Clear History', () => clear().catch(error => {
                if (typeof showToast === 'function') showToast(error.message, 'error');
            }));
        } else clear().catch(error => { if (typeof showToast === 'function') showToast(error.message, 'error'); });
    };

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('downloadHistoryModal')?.classList.contains('active')) {
            window.downloadsCloseHistory();
        }
    });
    window.downloadsOpenFolder = taskId => dlAction('Open folder', () => window.electronAPI.downloads.openInstallDirectory(taskId));
    window.downloadsCheckUpdate = async taskId => {
        try {
            const res = await window.electronAPI.downloads.checkUpdate(taskId);
            if (res?.status !== 'success') throw new Error(res?.message || 'Update check failed');
            if (res.snapshot) renderDownloads(res.snapshot);
            if (typeof showToast === 'function') showToast(res.update?.updateAvailable ? 'An update is available.' : 'This game is up to date.', res.update?.updateAvailable ? 'success' : 'info');
        } catch (err) {
            if (typeof showToast === 'function') showToast(err?.message || 'Update check failed', 'error');
        }
    };
    window.downloadsUpdate = taskId => dlAction('Update', () => window.electronAPI.downloads.queueMaintenance(taskId, 'update'));
    window.downloadsRepair = taskId => {
        const run = () => dlAction('Verify / Repair', () => window.electronAPI.downloads.queueMaintenance(taskId, 'repair'));
        if (typeof openConfirmModal === 'function') openConfirmModal('Verify / Repair game?', 'The provider will verify this installation and download only missing or damaged content.', 'Verify / Repair', run);
        else run();
    };
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
    window.downloadsUninstall = taskId => {
        const task = dlFindTask(taskId, item => item.status === 'completed');
        if (!task || task.uninstallEligible !== true) {
            if (typeof showToast === 'function') showToast('This installation is not managed by Baddel.', 'error');
            return;
        }
        const run = () => {
            downloadsPendingActions.add(taskId);
            renderDownloads();
            return dlAction('Uninstall', () => window.electronAPI.downloads.uninstall(taskId)).finally(() => {
                downloadsPendingActions.delete(taskId);
            });
        };
        const message = `"${task.title}": This will permanently remove the installed game files from:\n${task.installPath}\n\nSave files or settings stored outside this game folder will not be removed.`;
        if (typeof openConfirmModal === 'function') openConfirmModal(`Uninstall ${task.title}?`, message, 'Uninstall', run);
        else if (typeof showToast === 'function') showToast('Confirmation is unavailable. Reopen Downloads and try again.', 'error');
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
            window.electronAPI.onPlatformLibraryCommitted?.(async (payload = {}) => {
                if (String(payload.platform || '').toLowerCase() !== 'epic') return;
                await refreshDownloads().catch(() => {});
                dlPublishManagedMaintenanceState({ force: true });
            }),
            window.electronAPI.onPlatformSyncAccountsChanged?.(async (payload = {}) => {
                if (payload.platform && String(payload.platform).toLowerCase() !== 'epic') return;
                await refreshDownloads().catch(() => {});
                dlPublishManagedMaintenanceState({ force: true });
            }),
        ].filter(Boolean);
        refreshDownloads().catch(() => {});
        refreshDownloadCapabilities({ resetUnavailable: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDownloads);
    } else {
        initDownloads();
    }
})();
