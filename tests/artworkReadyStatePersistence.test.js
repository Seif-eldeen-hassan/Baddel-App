'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'accounts.js'), 'utf8');

test('verified managed artwork survives virtual-card disposal and remount', () => {
    assert.match(
        source,
        /function _agSetArtworkReady[\s\S]*?record\.localFileVerified\s*=\s*true;/
    );
    assert.match(
        source,
        /function _agApplyReadyArtworkToGame[\s\S]*?record\.localFileVerified === true[\s\S]*?__agVerifiedArtworkUrls\.add\(record\.localUrl\)[\s\S]*?_agIsUsableCardCover\(record\.localUrl, game\)/
    );
});

test('real artwork invalidation clears persistent renderer verification state', () => {
    assert.match(
        source,
        /function _agInvalidateArtworkRecord[\s\S]*?record\.localUrl\s*=\s*null;[\s\S]*?record\.localFileVerified\s*=\s*false;/
    );
});
