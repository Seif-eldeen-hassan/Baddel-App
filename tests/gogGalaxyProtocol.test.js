'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildProductViewUrl,
    buildLaunchUrl,
    isProductViewUrl,
    isLaunchUrl,
} = require('../services/gogGalaxyProtocol');

test('numeric GOG product ID builds the exact Galaxy product-view handoff', () => {
    assert.equal(buildProductViewUrl('1207659026'), 'goggalaxy://openGameView/1207659026');
    assert.equal(isProductViewUrl('goggalaxy://openGameView/1207659026'), true);
});

test('GOG Galaxy protocol helper rejects malformed IDs and broadened URLs', () => {
    for (const id of ['', 'abc', '42?x=1', '../42']) assert.throws(() => buildProductViewUrl(id), { code: 'GOG_PRODUCT_ID_INVALID' });
    for (const url of [
        'goggalaxy://openGameView/42?install=true',
        'goggalaxy://launch/42',
        'https://gog.com/42',
        'goggalaxy://openGameView/../42',
    ]) assert.equal(isProductViewUrl(url), false);
});

test('GOG play URL is validated separately from product-view URL', () => {
    assert.equal(buildLaunchUrl(42), 'goggalaxy://launch/42');
    assert.equal(isLaunchUrl('goggalaxy://launch/42'), true);
    assert.equal(isLaunchUrl('goggalaxy://openGameView/42'), false);
    assert.equal(isLaunchUrl('goggalaxy://launch/42?x=1'), false);
});
