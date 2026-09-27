'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sync = fs.readFileSync(path.join(root, 'platformSync.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/features/sync/infrastructure/integrations/gog/GogApiClient.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const details = fs.readFileSync(path.join(root, 'src/js/game-details.js'), 'utf8');
const downloads = fs.readFileSync(path.join(root, 'src/features/downloads/infrastructure/composition/DownloadsContainer.js'), 'utf8');

test('GOG transport fix is scoped to the GOG HTTPS agent and keeps TLS validation', () => {
    assert.match(api, /new https\.Agent\(\{ keepAlive: true, family: 4 \}\)/);
    assert.doesNotMatch(api, /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/);
    assert.match(downloads, /fetchImpl:\s*defaultGogFetch/);
});

test('unchanged GOG games with good basic metadata skip enrichment', () => {
    assert.match(sync, /syncClass === 'unchanged'[\s\S]{0,300}unchangedSkipped/);
});

test('fallback titles and missing covers remain lightweight repair candidates', () => {
    assert.match(sync, /titleRepairs/);
    assert.match(sync, /coverRepairs/);
    assert.match(sync, /preserveGogLastKnownGood/);
});

test('normal GOG sync never fetches Store Page solely for rich fields', () => {
    assert.match(sync, /allowStorePage: false/);
    assert.match(sync, /allowStorePage && pageUrl && shouldFetchGogStorePage/);
});

test('GOG Game Details rich metadata is lazy, persisted, TTL-backed, and deduplicated', () => {
    assert.match(sync, /GOG_RICH_METADATA_TTL_MS/);
    assert.match(sync, /gogRichMetadataInflight\.has\(id\)/);
    assert.match(sync, /writeGogMergedLibrary\(nextLibrary\)/);
    assert.match(preload, /platformSyncEnrichGogDetails/);
    assert.match(details, /_gdRequestLazyGogRichMetadata/);
});
