'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    optimizeArtworkSourceUrl,
    IGDB_SIZE_BY_TYPE,
} = require('../src/features/games/infrastructure/services/ArtworkSourceUrlPolicy');

const ROOT = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(
    ROOT,
    'src',
    'features',
    'games',
    'infrastructure',
    'services',
    'ArtworkSourceUrlPolicy.js'
);

test('ArtworkSourceUrlPolicy maps IGDB cover URLs to the supported cover size', () => {
    const input = 'https://images.igdb.com/igdb/image/upload/t_original/co1abc.jpg';
    const out = optimizeArtworkSourceUrl(input, { type: 'cover' });

    assert.equal(out, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg');
    assert.equal(IGDB_SIZE_BY_TYPE.cover, 't_cover_big');
});

test('ArtworkSourceUrlPolicy maps IGDB hero and logo URLs to supported display sizes', () => {
    assert.equal(
        optimizeArtworkSourceUrl('https://images.igdb.com/igdb/image/upload/t_1080p/ar1abc.jpg', { type: 'hero' }),
        'https://images.igdb.com/igdb/image/upload/t_screenshot_big/ar1abc.jpg'
    );
    assert.equal(
        optimizeArtworkSourceUrl('https://images.igdb.com/igdb/image/upload/t_original/lg1abc.png', { type: 'logo' }),
        'https://images.igdb.com/igdb/image/upload/t_logo_med/lg1abc.png'
    );
});

test('ArtworkSourceUrlPolicy leaves unknown providers and local URLs unchanged', () => {
    const remote = 'https://cdn.example/full-size.jpg';
    const local = 'file:///C:/Baddel/user_artwork/cover.png';

    assert.equal(optimizeArtworkSourceUrl(remote, { type: 'cover' }), remote);
    assert.equal(optimizeArtworkSourceUrl(local, { type: 'cover' }), local);
});

test('ArtworkSourceUrlPolicy stays infrastructure-only and does not import Electron or renderer modules', () => {
    const source = fs.readFileSync(POLICY_PATH, 'utf8');

    assert.doesNotMatch(source, /electron|ipcMain|BrowserWindow|window\.|document\./);
});
