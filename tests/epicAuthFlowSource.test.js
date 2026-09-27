'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

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

test('Epic normal sync does not open a second login or run Legendary auth code', () => {
    const source = read('platformSync.js');
    const syncSingle = extractFunction(source, 'syncSingleEpicAccount');

    assert.doesNotMatch(syncSingle, /openEpicLoginWindow\(/);
    assert.doesNotMatch(syncSingle, /runLegendary\(\['auth', '--code'/);
    assert.doesNotMatch(syncSingle, /initialEpicAuthResult|fetchEpicOrderHistoryWithSession\(/);
    assert.match(syncSingle, /runtime\.libraryOnly/);
});

test('Epic link owns one browser auth and bootstraps the persistent History session before initial sync', () => {
    const source = read('platformSync.js');
    const linkStart = source.indexOf('async link(parentWindow');
    const syncLibraryStart = source.indexOf('async syncLibrary(targetAccountId = null, opts = {}, parentWindow = null, runtime = {})', linkStart);
    assert.notStrictEqual(linkStart, -1);
    assert.notStrictEqual(syncLibraryStart, -1);
    const linkBlock = source.slice(linkStart, syncLibraryStart);

    assert.match(linkBlock, /openEpicLoginWindow\(parentWindow, syncOptions\)/);
    assert.match(linkBlock, /runLegendary\(\['auth', '--code', authCode\]/);
    assert.match(linkBlock, /bootstrap: bootstrapEpicHistorySessionFromLogin/);
    assert.match(linkBlock, /await saveEpicAccountsList\(accounts\)[\s\S]+attemptOptionalEpicHistorySessionBootstrap[\s\S]+this\.syncLibrary\(accountId/);
    assert.doesNotMatch(linkBlock, /initialEpicAuthResult/);
    assert.match(linkBlock, /initialSyncComplete: true/);
    assert.doesNotMatch(linkBlock, /Reading Epic purchase history\.\.\./);
});

test('Epic link UI does not trigger a second sync after the main-process initial sync', () => {
    const accounts = read('src/js/accounts.js');
    const panels = read('src/js/accounts/platform-panels.js');
    const linkEpicStart = accounts.indexOf('window.linkEpicLibrary = async function()');
    const syncEpicStart = accounts.indexOf('window.syncEpicLibrary = async function()', linkEpicStart);
    const linkEpicBlock = accounts.slice(linkEpicStart, syncEpicStart);

    assert.doesNotMatch(linkEpicBlock, /_syncEpicAndRefresh\(syncOpts\)/);
    assert.match(panels, /res\.initialSyncComplete/);
});

test('Epic price references avoid treating catalogItemId as the library offer id', () => {
    const source = read('platformSync.js');
    const refHelper = extractFunction(source, 'getEpicOfferRefFromEntry');

    const offerLine = refHelper.split('\n').find(line => line.includes('offerId:')) || '';
    assert.doesNotMatch(offerLine, /catalogItemId|catalog_item_id|metadata\.id/);
    assert.match(refHelper, /catalogItemId:/);
    assert.match(source, /function buildEpicPriceCandidates/);
    assert.match(source, /purchase_history/);
});