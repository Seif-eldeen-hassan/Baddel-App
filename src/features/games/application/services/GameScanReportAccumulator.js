'use strict';

// ─── GameScanReportAccumulator ────────────────────────────────────────────────
//
// Owns per-platform scan report state: raw/valid/skipped/error counters.
// Extracted from BaddelEngine (gameScanner.js). BaddelEngine keeps thin
// delegate methods that forward here, so all external call sites are unchanged.
//
// normalizePlatform is injected so this class has no infrastructure dependency
// (application layer cannot import from infrastructure per boundary rules).

class GameScanReportAccumulator {
    /**
     * @param {{
     *   normalizePlatform?: (platform: string) => string
     * }} opts
     */
    constructor({ normalizePlatform } = {}) {
        this.normalizePlatform = normalizePlatform || (p => String(p || '').toLowerCase().trim());
        this.reports = {};
    }

    reset() {
        this.reports = {};
        return this.reports;
    }

    getReports() {
        return this.reports;
    }

    platformReport(platform) {
        const key = this.normalizePlatform(platform);
        if (!this.reports[key]) {
            this.reports[key] = {
                platform: key,
                raw: 0,
                valid: 0,
                kept: 0,
                skipped: 0,
                skippedStale: 0,
                skippedMissingPath: 0,
                skippedMissingExe: 0,
                staleRemoved: 0,
                durationMs: 0,
                errors: [],
            };
        }
        return this.reports[key];
    }

    recordRaw(platform, count = 1) {
        this.platformReport(platform).raw += count;
    }

    recordValid(platform, count = 1) {
        const report = this.platformReport(platform);
        report.valid += count;
        report.kept += count;
    }

    recordSkip(platform, reason, candidate = {}) {
        const report = this.platformReport(platform);
        report.skipped++;
        if (reason === 'install_path_missing')                                  report.skippedMissingPath++;
        else if (reason === 'exe_missing')                                      report.skippedMissingExe++;
        else if (reason === 'stale_registry_entry' || reason === 'install_path_empty') report.skippedStale++;
        if (platform === 'ubisoft') {
            console.log(`[Ubisoft Scan] SKIP stale registry entry "${candidate.name || candidate.Name || candidate.DisplayName || 'Unknown'}" ${reason} path=${candidate.path || candidate.Path || candidate.InstallDir || candidate.InstallLocation || ''}`);
        }
    }

    recordError(platform, err) {
        this.platformReport(platform).errors.push(err?.message || String(err));
    }
}

module.exports = { GameScanReportAccumulator };
