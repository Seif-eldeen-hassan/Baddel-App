'use strict';

const DEFAULT_TIMEOUT_MS = 8000;

class EpicVaultHydrationError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'EpicVaultHydrationError';
        this.code = code;
        if (cause) this.cause = cause;
    }
}

function withDeadline(task, timeoutMs, code, message) {
    const limit = Math.max(50, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    let timer = null;
    return Promise.race([
        Promise.resolve().then(task),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new EpicVaultHydrationError(code, message)), limit);
            timer.unref?.();
        }),
    ]).finally(() => clearTimeout(timer));
}

class EpicVaultHydrationService {
    constructor({ readSnapshot, userDataPath, snapshotPath, isPackaged = false, timeoutMs = DEFAULT_TIMEOUT_MS, now = () => Date.now(), log = null } = {}) {
        if (typeof readSnapshot !== 'function') throw new Error('EpicVaultHydrationService requires readSnapshot');
        this.readSnapshot = readSnapshot;
        this.userDataPath = String(userDataPath || '');
        this.snapshotPath = String(snapshotPath || '');
        this.isPackaged = Boolean(isPackaged);
        this.timeoutMs = timeoutMs;
        this.now = now;
        this.log = typeof log === 'function' ? log : null;
        this.requestSequence = 0;
    }

    async handle() {
        const requestId = `vault-${this.now()}-${++this.requestSequence}`;
        const startedAt = this.now();
        const baseDiagnostics = {
            requestId,
            userDataPath: this.userDataPath,
            snapshotPath: this.snapshotPath,
            isPackaged: this.isPackaged,
        };
        try {
            const result = await withDeadline(
                () => this.readSnapshot({ requestId }),
                this.timeoutMs,
                'VAULT_MAIN_TIMEOUT',
                `Vault repository read did not settle within ${this.timeoutMs}ms.`,
            );
            const vault = result?.vault || result;
            if (!vault || !Array.isArray(vault.accounts)) {
                throw new EpicVaultHydrationError('VAULT_INVALID_SNAPSHOT', 'Vault repository returned an invalid snapshot.');
            }
            const diagnostics = {
                ...baseDiagnostics,
                durationMs: Math.max(0, this.now() - startedAt),
                outcome: vault.accounts.length ? 'success' : 'empty',
                stages: result?.stages || [],
            };
            this.log?.(diagnostics);
            return { status: 'success', vault, diagnostics };
        } catch (error) {
            const diagnostics = {
                ...baseDiagnostics,
                durationMs: Math.max(0, this.now() - startedAt),
                outcome: 'error',
                errorCode: error?.code || 'VAULT_REPOSITORY_READ_FAILED',
                stages: error?.stages || [],
            };
            this.log?.(diagnostics);
            return {
                status: 'error',
                code: diagnostics.errorCode,
                message: error?.message || 'Could not read the saved Epic Vault snapshot.',
                diagnostics,
            };
        }
    }
}

module.exports = {
    DEFAULT_TIMEOUT_MS,
    EpicVaultHydrationError,
    EpicVaultHydrationService,
    withDeadline,
};
