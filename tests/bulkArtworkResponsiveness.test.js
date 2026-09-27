'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const handlers = fs.readFileSync('handlers/imageHandlers.js', 'utf8');
const accounts = fs.readFileSync('src/js/accounts.js', 'utf8');

test('bulk local artwork lookup yields to the main event loop in bounded batches', () => {
    const start = handlers.indexOf("ipcMain.handle('get-cached-images-bulk'");
    const end = handlers.indexOf("ipcMain.handle('get-artwork-persistence-audit'", start);
    const body = handlers.slice(start, end);
    assert.match(body, /processed\s*%\s*24\s*===\s*0/);
    assert.match(body, /await new Promise\(resolve => setImmediate\(resolve\)\)/);
});

test('full local hydration is application-scoped and does not abort on route changes', () => {
    const start = accounts.indexOf('function _agStartCompleteLibraryCoverHydration');
    const end = accounts.indexOf('function _agWarmFirstPaintCoversAfterRender', start);
    const body = accounts.slice(start, end);
    assert.match(body, /__agApplicationArtworkHydration/);
    assert.match(body, /state\.status = 'complete'/);
    assert.doesNotMatch(body, /_agRouteVersion/);
});
