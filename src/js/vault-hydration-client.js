(function attachVaultHydrationClient(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.VaultHydrationClient = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createVaultHydrationClient() {
    'use strict';

    const DEFAULT_SNAPSHOT_TIMEOUT_MS = 10000;
    const DEFAULT_PROGRESS_TIMEOUT_MS = 2500;

    class VaultHydrationClientError extends Error {
        constructor(code, message, cause = null) {
            super(message);
            this.name = 'VaultHydrationClientError';
            this.code = code;
            if (cause) this.cause = cause;
        }
    }

    function withTimeout(task, timeoutMs, code, message) {
        const limit = Math.max(50, Number(timeoutMs) || DEFAULT_SNAPSHOT_TIMEOUT_MS);
        let timer = null;
        return Promise.race([
            Promise.resolve().then(task),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new VaultHydrationClientError(code, message)), limit);
            }),
        ]).finally(() => clearTimeout(timer));
    }

    async function requestSnapshot(electronAPI, options = {}) {
        const invoke = electronAPI?.platformSyncGetEpicVault;
        if (typeof invoke !== 'function') {
            throw new VaultHydrationClientError('VAULT_PRELOAD_API_MISSING', 'The Vault IPC API is unavailable in this renderer.');
        }
        let response;
        try {
            response = await withTimeout(
                () => invoke(),
                options.timeoutMs || DEFAULT_SNAPSHOT_TIMEOUT_MS,
                'VAULT_RENDERER_TIMEOUT',
                'Vault IPC did not respond before the safety deadline.',
            );
        } catch (error) {
            if (error instanceof VaultHydrationClientError) throw error;
            throw new VaultHydrationClientError('VAULT_IPC_REJECTED', error?.message || 'Vault IPC request failed.', error);
        }
        if (!response || response.status === 'error') {
            throw new VaultHydrationClientError(response?.code || 'VAULT_IPC_ERROR', response?.message || 'Vault IPC returned an error.');
        }
        if (!response.vault || !Array.isArray(response.vault.accounts)) {
            throw new VaultHydrationClientError('VAULT_INVALID_IPC_PAYLOAD', 'Vault IPC returned an invalid snapshot payload.');
        }
        const actualPath = String(response.diagnostics?.userDataPath || '');
        const expectedPath = String(options.expectedUserDataPath || '');
        if (expectedPath && actualPath && expectedPath.toLowerCase() !== actualPath.toLowerCase()) {
            throw new VaultHydrationClientError('VAULT_USER_DATA_MISMATCH', 'Vault IPC responded from a different userData directory.');
        }
        return response;
    }

    async function requestProgress(electronAPI, options = {}) {
        const invoke = electronAPI?.platformSyncGetEpicProgressState;
        if (typeof invoke !== 'function') return { status: 'unavailable', state: {} };
        try {
            const response = await withTimeout(
                () => invoke(),
                options.timeoutMs || DEFAULT_PROGRESS_TIMEOUT_MS,
                'VAULT_PROGRESS_TIMEOUT',
                'Vault progress IPC did not respond before the safety deadline.',
            );
            return response?.status === 'error' ? { status: 'unavailable', state: {}, code: response.code } : (response || { status: 'unavailable', state: {} });
        } catch (error) {
            return { status: 'unavailable', state: {}, code: error?.code || 'VAULT_PROGRESS_IPC_FAILED' };
        }
    }

    return {
        DEFAULT_PROGRESS_TIMEOUT_MS,
        DEFAULT_SNAPSHOT_TIMEOUT_MS,
        VaultHydrationClientError,
        requestProgress,
        requestSnapshot,
        withTimeout,
    };
}));
