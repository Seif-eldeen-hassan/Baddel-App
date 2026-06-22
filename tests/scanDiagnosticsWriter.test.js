const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fsPromises = require('node:fs').promises;

const { ScanDiagnosticsWriter } = require('../src/features/games/infrastructure/services/ScanDiagnosticsWriter');

function makeTempDir(prefix = 'baddel-diagnostics-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const SAMPLE_REPORT = {
    scanStartedAt:       '2024-01-01T00:00:00.000Z',
    scanFinishedAt:      '2024-01-01T00:00:01.000Z',
    durationMs:          1000,
    rawDetected:         5,
    uniqueDetected:      4,
    staleRemoved:        1,
    scannedPlatforms:    ['steam', 'epic'],
    platforms:           { steam: { raw: 3, valid: 3 }, epic: { raw: 2, valid: 1 } },
    visibleGamesAfterScan: 4,
};

// ─── write() — file creation ──────────────────────────────────────────────────

test('ScanDiagnosticsWriter: writes latest-scan.json inside scan-diagnostics subdirectory', async () => {
    const baseDir = makeTempDir();
    const writer = new ScanDiagnosticsWriter({ baseDir });

    await writer.write(SAMPLE_REPORT);

    const expectedPath = path.join(baseDir, 'scan-diagnostics', 'latest-scan.json');
    assert.ok(fs.existsSync(expectedPath), 'latest-scan.json must exist after write');
});

test('ScanDiagnosticsWriter: written file contains the exact report data', async () => {
    const baseDir = makeTempDir();
    const writer = new ScanDiagnosticsWriter({ baseDir });

    await writer.write(SAMPLE_REPORT);

    const filePath = path.join(baseDir, 'scan-diagnostics', 'latest-scan.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    assert.deepEqual(parsed, SAMPLE_REPORT, 'parsed JSON must equal the original report');
});

test('ScanDiagnosticsWriter: output is pretty-printed JSON (indent = 2)', async () => {
    const baseDir = makeTempDir();
    const writer = new ScanDiagnosticsWriter({ baseDir });

    await writer.write(SAMPLE_REPORT);

    const raw = fs.readFileSync(path.join(baseDir, 'scan-diagnostics', 'latest-scan.json'), 'utf8');
    assert.equal(raw, JSON.stringify(SAMPLE_REPORT, null, 2), 'file must match JSON.stringify(report, null, 2)');
});

// ─── write() — directory creation ────────────────────────────────────────────

test('ScanDiagnosticsWriter: creates scan-diagnostics directory when it does not exist', async () => {
    const baseDir = makeTempDir();
    const diagDir = path.join(baseDir, 'scan-diagnostics');
    // Confirm directory does not pre-exist
    assert.ok(!fs.existsSync(diagDir), 'scan-diagnostics must not exist before write');

    const writer = new ScanDiagnosticsWriter({ baseDir });
    await writer.write(SAMPLE_REPORT);

    assert.ok(fs.existsSync(diagDir), 'scan-diagnostics directory must be created');
});

test('ScanDiagnosticsWriter: write succeeds when scan-diagnostics directory already exists', async () => {
    const baseDir = makeTempDir();
    const diagDir = path.join(baseDir, 'scan-diagnostics');
    fs.mkdirSync(diagDir); // pre-create the directory

    const writer = new ScanDiagnosticsWriter({ baseDir });
    await assert.doesNotReject(() => writer.write(SAMPLE_REPORT));

    assert.ok(fs.existsSync(path.join(diagDir, 'latest-scan.json')), 'file must be written even if dir already exists');
});

// ─── write() — error handling (swallowed to match original _writeScanDiagnostics) ─

test('ScanDiagnosticsWriter: swallows errors and does not throw when write fails', async () => {
    const baseDir = makeTempDir();

    const badFs = {
        mkdir:     async () => { throw new Error('disk full'); },
        writeFile: async () => { throw new Error('disk full'); },
    };

    const writer = new ScanDiagnosticsWriter({ baseDir, fsPromises: badFs });

    await assert.doesNotReject(
        () => writer.write(SAMPLE_REPORT),
        'write errors must be swallowed — diagnostics failure must not abort the caller'
    );
});

test('ScanDiagnosticsWriter: logs a console.warn when write fails', async () => {
    const baseDir = makeTempDir();

    const badFs = {
        mkdir:     async () => { throw new Error('permission denied'); },
        writeFile: async () => {},
    };

    const writer = new ScanDiagnosticsWriter({ baseDir, fsPromises: badFs });

    const warned = [];
    const origWarn = console.warn;
    console.warn = (...args) => warned.push(args.join(' '));
    try {
        await writer.write(SAMPLE_REPORT);
    } finally {
        console.warn = origWarn;
    }

    assert.ok(warned.some(w => w.includes('permission denied')), 'console.warn must include the error message');
});

// ─── overwrite behavior ───────────────────────────────────────────────────────

test('ScanDiagnosticsWriter: second write overwrites the first (latest-scan semantics)', async () => {
    const baseDir = makeTempDir();
    const writer = new ScanDiagnosticsWriter({ baseDir });

    await writer.write({ scanStartedAt: 'first' });
    await writer.write({ scanStartedAt: 'second' });

    const raw = fs.readFileSync(path.join(baseDir, 'scan-diagnostics', 'latest-scan.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.scanStartedAt, 'second', 'second write must overwrite first');
});
