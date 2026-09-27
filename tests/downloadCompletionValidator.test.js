'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    makeCompletionPatch,
    validateDownloadCompletion,
} = require('../src/features/downloads/domain/services/DownloadCompletionValidator');

function receipt(overrides = {}) {
    return {
        provider: 'gog',
        processExitCode: 0,
        completionConfirmed: true,
        transfer: {
            downloadedBytes: 1024,
            totalBytes: 1024,
            source: 'provider-receipt',
        },
        verification: {
            status: 'passed',
            method: 'install-scan',
            expectedFileCount: null,
            verifiedFileCount: 2,
            expectedBytes: 1024,
            actualBytes: 1024,
            executableFound: true,
            executablePath: 'E:/Games/Test/Game.exe',
            manifestFound: null,
        },
        diagnosticCode: null,
        ...overrides,
    };
}

test('completion validator requires provider-confirmed full transfer and verified installed bytes', () => {
    assert.throws(
        () => validateDownloadCompletion({}, receipt({ completionConfirmed: false })),
        err => err.code === 'DOWNLOAD_COMPLETION_UNCONFIRMED'
    );
    assert.throws(
        () => validateDownloadCompletion({}, receipt({ transfer: { downloadedBytes: 900, totalBytes: 1024 } })),
        err => err.code === 'DOWNLOAD_INCOMPLETE_TRANSFER'
    );
    assert.throws(
        () => validateDownloadCompletion({}, receipt({ transfer: { downloadedBytes: 1200, totalBytes: 1024 } })),
        err => err.code === 'DOWNLOAD_EXPECTED_SIZE_MISMATCH'
    );
    assert.throws(
        () => validateDownloadCompletion({}, receipt({ verification: { status: 'failed', actualBytes: 1024 } })),
        err => err.code === 'DOWNLOAD_VERIFICATION_FAILED'
    );
    assert.throws(
        () => validateDownloadCompletion({}, receipt({ verification: { status: 'passed', actualBytes: 0 } })),
        err => err.code === 'DOWNLOAD_INSTALLATION_EMPTY'
    );
});

test('completion validator returns an authoritative byte-based completion patch', () => {
    const validated = validateDownloadCompletion({}, receipt());
    const patch = makeCompletionPatch(validated);

    assert.equal(validated.provider, 'gog');
    assert.equal(validated.transfer.downloadedBytes, 1024);
    assert.equal(validated.transfer.totalBytes, 1024);
    assert.equal(validated.verification.actualBytes, 1024);
    assert.equal(validated.verification.executablePath, 'E:/Games/Test/Game.exe');
    assert.equal(patch.progressPercent, 100);
    assert.equal(patch.downloadedBytes, 1024);
    assert.equal(patch.totalBytes, 1024);
    assert.equal(patch.verificationStatus, 'passed');
    assert.equal(patch.verificationExecutablePath, 'E:/Games/Test/Game.exe');
    assert.equal(patch.resolvedExecutablePath, 'E:/Games/Test/Game.exe');
});

test('completion patch preserves global checkpoint when resumed provider receipt is session-relative', () => {
    const validated = validateDownloadCompletion({}, receipt({
        transfer: { downloadedBytes: 29_162_311, totalBytes: 29_162_311, source: 'gogdl-overall-progress' },
    }));
    const patch = makeCompletionPatch(validated, {
        resumeBaseDownloadedBytes: 1_659_344,
        sessionDownloadedBytes: 29_162_311,
        downloadedBytes: 30_821_655,
        totalBytes: 30_821_655,
        checkpointDownloadedBytes: 30_821_655,
        checkpointTotalBytes: 30_821_655,
        downloadedBytesSource: 'resume-base-plus-session',
        progressMode: 'session-relative',
    });

    assert.equal(patch.downloadedBytes, 30_821_655);
    assert.equal(patch.totalBytes, 30_821_655);
    assert.equal(patch.transferDownloadedBytes, 30_821_655);
    assert.equal(patch.providerCompletionReceipt.transfer.downloadedBytes, 29_162_311);
});
