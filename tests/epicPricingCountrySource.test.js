'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const platformSync = fs.readFileSync(path.join(root, 'platformSync.js'), 'utf8');

function extractFunction(source, name) {
    const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
    assert.ok(match, `${name} should exist`);
    const start = match.index;
    const paramsEnd = source.indexOf(') {', start);
    assert.notStrictEqual(paramsEnd, -1, `${name} should have a function body`);
    const bodyStart = source.indexOf('{', paramsEnd);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

function loadPureFunction(name) {
    const fnSource = extractFunction(platformSync, name);
    const sandbox = {};
    vm.runInNewContext(`${fnSource}; this.${name} = ${name};`, sandbox);
    return sandbox[name];
}

test('Epic country normalization accepts only ISO-like two-letter countries', () => {
    const normalizeEpicCountry = loadPureFunction('normalizeEpicCountry');
    assert.equal(normalizeEpicCountry('eg'), 'EG');
    assert.equal(normalizeEpicCountry('EG'), 'EG');
    assert.equal(normalizeEpicCountry(' usa '), null);
    assert.equal(normalizeEpicCountry(''), null);
    assert.equal(normalizeEpicCountry(null), null);
});

test('Epic pricing no longer infers country from currency or silently falls back to US', () => {
    assert.doesNotMatch(platformSync, /EPIC_CURRENCY_COUNTRY/);
    assert.doesNotMatch(platformSync, /getEpicCountryFromCurrency/);
    assert.doesNotMatch(platformSync, /currency\s*!==\s*['"]USD['"]/);
    assert.doesNotMatch(platformSync, /fetchEpicCatalogOffer\([^\n]*['"]USD['"]/);
    assert.doesNotMatch(platformSync, /country:\s*['"]US['"]/);
});

test('Epic GraphQL pricing receives explicit pricingCountry', () => {
    const catalog = extractFunction(platformSync, 'fetchEpicCatalogOffer');
    const catalogItem = extractFunction(platformSync, 'resolveEpicOfferFromCatalogItem');
    const fallback = extractFunction(platformSync, 'resolveEpicOfferFromVerifiedFallback');
    const liveOne = extractFunction(platformSync, 'fetchEpicLivePriceForEntry');
    const liveMany = extractFunction(platformSync, 'fetchEpicLivePricesForEntries');

    assert.match(catalog, /function fetchEpicCatalogOffer\(ref, pricingCountry/);
    assert.match(catalog, /country:\s*getEpicPricingCountryForRequest\(pricingCountry\)/);
    assert.match(catalogItem, /function resolveEpicOfferFromCatalogItem\(ref, pricingCountry/);
    assert.match(catalogItem, /country:\s*getEpicPricingCountryForRequest\(pricingCountry\)/);
    assert.match(fallback, /function resolveEpicOfferFromVerifiedFallback\(ref, pricingCountry/);
    assert.match(fallback, /country:\s*getEpicPricingCountryForRequest\(pricingCountry\)/);
    assert.match(liveOne, /fetchEpicCatalogOffer\(ref, pricingCountry/);
    assert.match(liveMany, /fetchEpicLivePriceForEntry\(entry, pricingCountry\)/);
});

test('Existing Epic accounts recover pricingCountry from their own Legendary config', () => {
    const syncSingle = extractFunction(platformSync, 'syncSingleEpicAccount');
    assert.match(syncSingle, /const confPath = getLegendaryConfPath\(acc\.id\)/);
    assert.match(syncSingle, /readEpicPricingCountryFromLegendary\(confPath\)/);
    assert.match(syncSingle, /normalizeEpicCountry\(acc\.pricingCountry\)/);
    assert.match(syncSingle, /Pricing country unavailable for account; preserving cached prices/);
    assert.match(syncSingle, /fetchEpicLivePricesForEntries\(priceCandidates, pricingCountry\)/);
});

test('Epic link persists pricingCountry from Legendary user.json without logging secrets', () => {
    const epicStart = platformSync.indexOf('const epicConnectorMethods');
    const linkStart = platformSync.indexOf('async link(parentWindow', epicStart);
    const syncStart = platformSync.indexOf('async syncLibrary(targetAccountId', linkStart);
    const linkBlock = platformSync.slice(linkStart, syncStart);
    assert.match(linkBlock, /pricingCountry = normalizeEpicCountry\(legendaryUser\?\.country\)/);
    assert.match(linkBlock, /accounts\.push\(\{ id: accountId, displayName: finalDisplayName, pricingCountry \}\)/);
    assert.doesNotMatch(linkBlock, /EpicRegionTest|user\.json keys|status keys|region fields|access_token|refresh_token/);
});

test('Epic purchase history logging helper exists and cannot throw undefined syncInfo', () => {
    const processor = extractFunction(platformSync, 'processEpicOrdersForVault');
    assert.match(platformSync, /function syncInfo\(\.\.\.args\) \{ try \{ verboseLog\(\.\.\.args\); \} catch \{\} \}/);
    assert.match(processor, /syncInfo\('\[Epic Vault\] Spend reconciliation', summary\)/);
});

test('Epic login logs do not dump credential headers', () => {
    const headerPicker = extractFunction(platformSync, 'pickSafeEpicResponseHeaders');
    const sandbox = {};
    vm.runInNewContext(`${headerPicker}; this.pickSafeEpicResponseHeaders = pickSafeEpicResponseHeaders;`, sandbox);
    const picked = sandbox.pickSafeEpicResponseHeaders({
        'content-type': ['application/json'],
        'set-cookie': ['EPIC_SESSION_AP=secret'],
        Cookie: ['x=y'],
        Authorization: ['Bearer secret'],
        'XSRF-TOKEN': ['secret'],
        server: ['edge'],
    });
    assert.deepEqual(picked, { 'content-type': ['application/json'], server: ['edge'] });
    assert.doesNotMatch(platformSync, /FAILED headers/);
    assert.doesNotMatch(platformSync, /JSON\.stringify\(details\.responseHeaders\)/);
});