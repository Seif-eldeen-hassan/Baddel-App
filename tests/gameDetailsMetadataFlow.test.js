'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DETAILS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
const HANDLER = fs.readFileSync(path.join(ROOT, 'handlers', 'gameMetadataHandlers.js'), 'utf8');

test('missing canonical metadata reaches persisted cache then requests backfill', () => {
    const persisted = DETAILS.indexOf("GD_METADATA_PERSISTED_IPC_REQUEST");
    const backfill = DETAILS.indexOf("GD_METADATA_BACKFILL_IPC_REQUEST");
    assert.ok(persisted > 0 && backfill > persisted);
    assert.match(DETAILS.slice(backfill, backfill + 1800), /electronAPI\.getMetadata/);
    assert.match(HANDLER, /requestGameEnrich\(platform, canonicalId, originalGameName\)/);
    assert.match(HANDLER, /source:\s*['"]server-pending['"]/);
});

test('successful backfill updates current metadata and renders Game Details', () => {
    const hit = DETAILS.indexOf('fallbackMeta && _gdHasUsefulMetadataValue(fallbackMeta)');
    const block = DETAILS.slice(hit, hit + 1800);
    assert.match(block, /_gdCurrentMeta = merged/);
    assert.match(block, /_gdPopulateMeta\(game, merged\)/);
    assert.match(block, /GD_METADATA_RENDERED/);
});

test('failed metadata IPC renders retryable error or pending state, never false No Meta', () => {
    const request = DETAILS.indexOf("GD_METADATA_BACKFILL_IPC_REQUEST");
    const flow = DETAILS.slice(request, request + 6500);
    assert.match(flow, /fallbackError = error/);
    assert.match(DETAILS, /_gdRenderMetadataErrorState\(game, fallbackError\)/);
    assert.match(DETAILS, /_gdShowMetadataPendingAndRetry/);
    const errorFn = DETAILS.slice(DETAILS.indexOf('function _gdRenderMetadataErrorState'), DETAILS.indexOf('function _gdShowMetadataPendingAndRetry'));
    assert.match(errorFn, /Could not load metadata/);
    assert.match(errorFn, />Retry</);
    assert.doesNotMatch(errorFn, /No metadata available/);
});
