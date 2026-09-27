'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('grid thumbnail IPC is exposed and wired through the games image handler', () => {
    const preload = read('preload.js');
    const main = read('main.js');
    const handlers = read('handlers/imageHandlers.js');
    assert.match(preload, /getGridArtworkThumbnails:[\s\S]*get-grid-artwork-thumbnails/);
    assert.match(main, /new GridArtworkThumbnailCache\([\s\S]*artwork-grid-cache-v1[\s\S]*gridArtworkThumbnailCache,/);
    assert.match(handlers, /gridArtworkThumbnailCache[\s\S]*ipcMain\.handle\('get-grid-artwork-thumbnails'/);
    assert.match(handlers, /const limit = createMissing \? 32 : 1200/);
});

test('renderer uses thumbnails only for grid presentation and keeps memory bounded', () => {
    const source = read('src/js/accounts.js');
    assert.match(source, /retainedCardLimit:\s*512/);
    assert.match(source, /_vs\.retainedCards\.size > _vs\.retainedCardLimit/);
    assert.match(source, /if \(_agIsGridThumbnailUrl\(source\)\) return 160 \* 240 \* 4/);
    assert.match(source, /gridThumbnail:\s*cover !== originalCover/);
    assert.match(source, /if \(!payload\?\.gridThumbnail\) _agSetArtworkReady/);
});

test('thumbnail generation is deferred while scrolling and limited to small batches', () => {
    const source = read('src/js/accounts.js');
    assert.match(source, /_vs\?\._isScrolling \|\| window\._vs\?\._isFastScrolling/);
    assert.match(source, /_agGridThumbnailPrepareQueue\.splice\(0, 8\)/);
    assert.match(source, /setTimeout\(_agPumpGridThumbnailPreparation, 150\)/);
    assert.doesNotMatch(source, /setTimeout\(_agPumpGridThumbnailPreparation, 5000\)/);
    assert.match(source, /setGridArtworkScrollActive/);
    assert.match(source, /_agFlushPendingGridThumbnailMappings/);
});
