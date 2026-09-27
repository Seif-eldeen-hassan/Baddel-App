(function () {
    'use strict';
    let generation = 0;
    let selection = null;
    let debounce = null;
    const BLOCKING_SIZE_REASONS = new Set([
        'SIZE_PROVIDER_UNSUPPORTED', 'EPIC_SIZE_PROVIDER_UNSUPPORTED', 'EPIC_AUTH_REQUIRED',
        'EPIC_GAME_NOT_OWNED', 'EPIC_ACCOUNT_NOT_LINKED', 'EPIC_ACCOUNT_NOT_READY',
        'EPIC_ACCOUNT_ID_INVALID', 'EPIC_APP_NAME_UNRESOLVED', 'GOG_AUTH_REQUIRED',
        'GOG_GAME_NOT_OWNED', 'GOG_ACCOUNT_NOT_FOUND', 'GOG_OWNED_IDENTITY_UNRESOLVED',
    ]);
    const UNKNOWN_SIZE_WARNING = 'The exact download and installed size could not be determined. Make sure this drive has enough free space. Baddel will check again when the provider prepares the download.';
    function unknownSizeAllowed(plan) {
        return plan?.sizeStatus === 'unknown' && !BLOCKING_SIZE_REASONS.has(String(plan.sizeReason || ''));
    }
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function size(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Unavailable';
        const n = Number(value);
        return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
    }
    function notify() { window.gdInstallUpdateConfirm?.(); }
    function reset() {
        generation++;
        clearTimeout(debounce);
        selection = null;
        const section = document.getElementById('gdInstallStorageSection');
        if (section) { section.hidden = true; section.innerHTML = ''; }
        notify();
    }
    function valid() {
        if (!selection?.plan || selection.pending || selection.error) return false;
        const plan = selection.plan;
        const exact = plan.sizeStatus === 'resolved' && plan.enoughSpace === true
            && plan.downloadSizeBytes > 0 && plan.installedDiskSizeBytes > 0;
        return exact || (unknownSizeAllowed(plan) && plan.enoughSpace !== false);
    }
    function paint() {
        const result = document.getElementById('gdInstallPlanSummary');
        if (!result || !selection) return;
        if (selection.pending) {
            const free = selection.drive?.freeSpaceBytes;
            result.innerHTML = `<dl class="install-plan-values"><dt>Download size</dt><dd>Resolving...</dd><dt>Installed size</dt><dd>Resolving...</dd><dt>Free space</dt><dd>${esc(size(free))}</dd></dl><p class="install-space-state">Reading exact size from ${esc(selection.payload.platform === 'gog' ? 'GOG' : 'Epic')}...</p>`;
        }
        else if (selection.error) result.textContent = selection.error;
        else if (selection.plan) {
            const plan = selection.plan;
            const rows = [['Download size', plan.downloadSizeBytes], ['Installed size', plan.installedDiskSizeBytes], ['Safety reserve', plan.diskSafetyMarginBytes], ['Required free space', plan.totalRequiredBytes], ['Free space', plan.freeSpaceBytes], ['After install (approximately)', plan.afterInstallBytes]];
            const state = plan.enoughSpace === false
                ? `Not enough space. Missing: ${esc(size(plan.missingSpaceBytes))}`
                : plan.enoughSpace === true
                    ? 'Enough space'
                    : unknownSizeAllowed(plan)
                        ? 'Exact size unavailable. You can continue after confirming the disk-space warning.'
                        : `Installation unavailable: ${esc(plan.sizeReason || 'UNKNOWN_SIZE_REASON')}`;
            result.innerHTML = `<dl class="install-plan-values">${rows.map(([label, value]) => `<dt>${label}</dt><dd>${esc(size(value))}</dd>`).join('')}</dl><p class="install-space-state ${plan.enoughSpace === false || !unknownSizeAllowed(plan) && plan.enoughSpace !== true ? 'insufficient' : ''}">${state}</p>`;
        }
        notify();
    }
    async function check() {
        const current = selection;
        if (!current) return;
        const revision = ++current.revision;
        current.pending = true; current.plan = null; current.error = null; current.requestStartedAt = performance.now(); paint();
        try {
            const response = await window.electronAPI.downloads.resolveInstallPlan({
                ...current.payload,
                installPath: current.path,
                installPlanRendererStartedAt: Date.now(),
            });
            if (selection !== current || revision !== current.revision || !document.getElementById('gdInstallerModal')) return;
            if (response?.status !== 'success') throw new Error(response?.message || 'Storage preview is unavailable.');
            current.plan = response.plan;
            current.lastResolveDurationMs = Math.round(performance.now() - current.requestStartedAt);
        } catch (error) { if (selection === current && revision === current.revision) current.error = error.message; }
        finally { if (selection === current && revision === current.revision) { current.pending = false; paint(); } }
    }
    function choose(location, drive = null) {
        if (!selection) return;
        clearTimeout(debounce);
        selection.path = location;
        selection.drive = drive;
        const input = document.getElementById('gdInstallFolder');
        if (input) input.value = location;
        document.querySelectorAll('#gdInstallDrives button').forEach(button => button.setAttribute('aria-pressed', String(location.startsWith(button.dataset.root))));
        return check();
    }
    async function mount(payload) {
        reset();
        const token = generation;
        const section = document.getElementById('gdInstallStorageSection');
        if (!section) return;
        section.hidden = false;
        selection = { payload, path: '', drive: null, revision: 0, pending: true, plan: null, error: null, requestStartedAt: 0, lastResolveDurationMs: null, unknownSizeConfirmed: false };
        section.setAttribute('tabindex', '-1');
        section.innerHTML = '<div class="pl-section-header"><span class="pl-section-title">CHOOSE INSTALL LOCATION</span></div><div id="gdInstallDrives" class="install-drives">Loading drives...</div><label class="install-folder-label" for="gdInstallFolder">Game folder</label><div class="install-folder-row"><input id="gdInstallFolder" spellcheck="false" autocomplete="off"><button type="button" class="pl-btn-cancel" id="gdInstallBrowse">Browse...</button></div><div id="gdInstallPlanSummary" role="status" aria-live="polite"></div>';
        const folderName = String(payload.title || 'Game').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'Game';
        section.querySelector('#gdInstallFolder').addEventListener('input', event => {
            selection.path = event.target.value.trim(); selection.revision++; selection.plan = null; selection.pending = true; paint();
            clearTimeout(debounce); debounce = setTimeout(check, 400);
        });
        section.querySelector('#gdInstallBrowse').addEventListener('click', async () => {
            const response = await window.electronAPI.downloads.selectInstallDirectory();
            if (token !== generation) return;
            if (response?.status === 'error') { selection.error = response.message; paint(); }
            else if (!response?.canceled && response?.path) await choose(response.path);
        });
        try {
            const response = await window.electronAPI.downloads.getStorageOptions();
            if (token !== generation || !section.isConnected) return;
            if (response?.status !== 'success') throw new Error(response?.message || 'Drive list unavailable. Choose a folder with Browse.');
            const drives = response.drives || [];
            const list = section.querySelector('#gdInstallDrives');
            list.innerHTML = drives.map(drive => `<button type="button" class="install-drive" data-root="${esc(drive.root)}" aria-pressed="false"><strong>${esc(drive.root)} ${esc(drive.label)}</strong><span>Free: ${esc(size(drive.freeSpaceBytes))} of ${esc(size(drive.totalCapacityBytes))}</span></button>`).join('');
            list.addEventListener('click', event => {
                const button = event.target.closest('[data-root]');
                if (button) choose(`${button.dataset.root}Baddel Games\\${folderName}`, drives.find(drive => drive.root === button.dataset.root) || null);
            });
            selection.pending = false;
            selection.error = drives.length ? 'Choose a drive or game folder.' : 'No fixed drives found. Choose a folder with Browse.';
            paint();
        } catch (error) { if (token === generation) { selection.pending = false; selection.error = error.message; paint(); } }
    }
    async function confirmed() {
        if (!valid()) return null;
        const current = selection;
        if (Date.now() >= selection.plan.expiresAt) await check();
        return selection === current && valid() ? {
            ...selection.plan,
            installPlanId: selection.plan.planId,
            unknownSizeConfirmed: selection.unknownSizeConfirmed === true,
        } : null;
    }
    function confirmUnknown() {
        if (!selection?.plan || !unknownSizeAllowed(selection.plan)) return false;
        selection.unknownSizeConfirmed = true;
        return true;
    }
    window.baddelInstallStorage = { mount, reset, valid, confirmed, confirmUnknown, UNKNOWN_SIZE_WARNING };
})();
