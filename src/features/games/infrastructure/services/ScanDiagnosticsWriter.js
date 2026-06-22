'use strict';

const fs = require('fs').promises;
const path = require('path');

// ─── ScanDiagnosticsWriter ────────────────────────────────────────────────────
//
// Owns writing the latest-scan.json diagnostics file to disk after each global
// scan. Extracted from BaddelEngine._writeScanDiagnostics (gameScanner.js).
// BaddelEngine keeps a thin delegate method so all call sites are unchanged.
//
// Errors are swallowed (console.warn only) to match the original behavior —
// diagnostics write failures must never abort a scan.

class ScanDiagnosticsWriter {
    /**
     * @param {{
     *   baseDir:     string,                          // userData directory (dbFolder)
     *   fsPromises?: typeof import('fs').promises,    // injectable for tests
     *   pathImpl?:   typeof import('path'),           // injectable for tests
     * }} opts
     */
    constructor({ baseDir, fsPromises = fs, pathImpl = path } = {}) {
        this._baseDir = baseDir;
        this._fs      = fsPromises;
        this._path    = pathImpl;
    }

    async write(report) {
        try {
            const dir = this._path.join(this._baseDir, 'scan-diagnostics');
            await this._fs.mkdir(dir, { recursive: true });
            await this._fs.writeFile(
                this._path.join(dir, 'latest-scan.json'),
                JSON.stringify(report, null, 2),
                'utf8'
            );
        } catch (err) {
            console.warn('[GameScanner] Failed to write scan diagnostics:', err.message);
        }
    }
}

module.exports = { ScanDiagnosticsWriter };
