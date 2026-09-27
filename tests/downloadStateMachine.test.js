'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DOWNLOAD_STATUSES, normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');
const { canTransition, applyTransition } = require('../src/features/downloads/domain/services/DownloadStateMachine');
const { buildDownloadIdentity } = require('../src/features/downloads/domain/services/DownloadIdentity');

test('download state machine allows the expected active lifecycle', () => {
    assert.equal(canTransition('pending', 'preparing'), true);
    assert.equal(canTransition('preparing', 'downloading'), true);
    assert.equal(canTransition('downloading', 'verifying'), true);
    assert.equal(canTransition('verifying', 'installing'), true);
    assert.equal(canTransition('installing', 'completed'), true);
});

test('a resumed provider job may proceed directly to verification without transfer progress', () => {
    assert.equal(canTransition('resuming', 'verifying'), true);
    const task = normalizeTask({ id: 'dl_1234567890abcdef', status: DOWNLOAD_STATUSES.RESUMING });
    const verified = applyTransition(task, DOWNLOAD_STATUSES.VERIFYING, { statusMessage: 'Verifying files' });
    assert.equal(verified.status, DOWNLOAD_STATUSES.VERIFYING);
});

test('download state machine rejects completed to downloading', () => {
    const task = normalizeTask({ id: 'dl_1234567890abcdef', status: DOWNLOAD_STATUSES.COMPLETED });
    assert.throws(
        () => applyTransition(task, DOWNLOAD_STATUSES.DOWNLOADING),
        /Invalid download transition/
    );
});

test('download identity includes provider account and install path', () => {
    const one = buildDownloadIdentity({
        platform: 'gog',
        accountId: 'account-a',
        providerProductId: '123',
        installPath: 'D:\\Games\\The Whisperer',
    });
    const two = buildDownloadIdentity({
        platform: 'gog',
        accountId: 'account-b',
        providerProductId: '123',
        installPath: 'D:\\Games\\The Whisperer',
    });
    assert.notEqual(one, two);
    assert.match(one, /^gog:account-a:123:/);
});
