'use strict';

const MB = 1024 * 1024;

const DEFAULT_AUTOMATIC_BUDGET_BYTES = 64 * MB;
const DEFAULT_DATA_SAVER_AUTOMATIC_BUDGET_BYTES = 16 * MB;

const INTERACTIVE_PRIORITIES = new Set(['game-details', 'visible', 'library-cover-hydration']);
const AUTOMATIC_PRIORITIES = new Set(['prewarm', 'background']);

class ArtworkBandwidthPolicy {
    constructor({
        dataSaver = false,
        maxAutomaticBytes = DEFAULT_AUTOMATIC_BUDGET_BYTES,
        dataSaverMaxAutomaticBytes = DEFAULT_DATA_SAVER_AUTOMATIC_BUDGET_BYTES,
    } = {}) {
        this._dataSaver = dataSaver === true;
        this._maxAutomaticBytes = this._normalizeLimit(maxAutomaticBytes, DEFAULT_AUTOMATIC_BUDGET_BYTES);
        this._dataSaverMaxAutomaticBytes = this._normalizeLimit(
            dataSaverMaxAutomaticBytes,
            DEFAULT_DATA_SAVER_AUTOMATIC_BUDGET_BYTES
        );
        this._automaticBytes = 0;
        this._skipped = 0;
    }

    evaluate({ priority = 'background', type = '', estimatedBytes = 0 } = {}) {
        const normalizedPriority = String(priority || 'background');
        if (INTERACTIVE_PRIORITIES.has(normalizedPriority)) {
            return { allowed: true, reason: 'interactive' };
        }
        if (!AUTOMATIC_PRIORITIES.has(normalizedPriority)) {
            return { allowed: true, reason: 'unclassified-priority' };
        }

        const assetType = String(type || '').toLowerCase();
        if (this._dataSaver && assetType && assetType !== 'cover') {
            this._skipped += 1;
            return { allowed: false, reason: 'data-saver-non-cover-automatic-artwork' };
        }

        const limit = this._dataSaver ? this._dataSaverMaxAutomaticBytes : this._maxAutomaticBytes;
        if (Number.isFinite(limit) && this._automaticBytes >= limit) {
            this._skipped += 1;
            return { allowed: false, reason: 'automatic-artwork-bandwidth-budget-exhausted' };
        }
        const projectedBytes = this._automaticBytes + Math.max(0, Number(estimatedBytes) || 0);
        if (Number.isFinite(limit) && projectedBytes > limit) {
            this._skipped += 1;
            return { allowed: false, reason: 'automatic-artwork-bandwidth-budget-exhausted' };
        }

        return { allowed: true, reason: this._dataSaver ? 'data-saver-cover-automatic-artwork' : 'automatic-budget-available' };
    }

    recordDownload({ priority = 'background', bytes = 0 } = {}) {
        const normalizedPriority = String(priority || 'background');
        if (!AUTOMATIC_PRIORITIES.has(normalizedPriority)) return;
        this._automaticBytes += Math.max(0, Number(bytes) || 0);
    }

    getStats() {
        return {
            dataSaver: this._dataSaver,
            automaticBytes: this._automaticBytes,
            skipped: this._skipped,
            maxAutomaticBytes: this._maxAutomaticBytes,
            dataSaverMaxAutomaticBytes: this._dataSaverMaxAutomaticBytes,
        };
    }

    _normalizeLimit(value, fallback) {
        if (value === Infinity || value === 'Infinity') return Infinity;
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return fallback;
        return n;
    }
}

module.exports = {
    ArtworkBandwidthPolicy,
    DEFAULT_AUTOMATIC_BUDGET_BYTES,
    DEFAULT_DATA_SAVER_AUTOMATIC_BUDGET_BYTES,
};
