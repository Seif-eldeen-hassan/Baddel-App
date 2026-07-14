'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    SYNC_FEATURE_API_KEYS,
} = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const SYNC_RUNTIME_STATE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncRuntimeState.js');
const SYNC_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncEventEmitter.js');
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');
const STATE_CHANGED_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'StateChangedEmitter.js');
const SYNC_LOG_QUEUE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncLogQueue.js');
const LINK_STATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LinkStateEmitter.js');
const LIBRARY_UPDATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LibraryUpdateEmitter.js');
const SYNC_TERMINAL_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncTerminalEventEmitter.js');

const PLATFORM_SYNC_IPC_CHANNELS = [
    'platform-sync:status',
    'platform-sync:get-accounts',
    'platform-sync:link',
    'platform-sync:sync',
    'platform-sync:get-state',
    'platform-sync:get-cached',
    'platform-sync:unlink',
];

const CONNECTOR_METHODS = ['isLinked', 'getAccounts', 'link', 'syncLibrary', 'getCachedLibrary', 'unlink'];

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFunctionSource(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notEqual(start, -1, `${functionName} should exist`);

    const parenStart = source.indexOf('(', start);
    let parenDepth = 0;
    let signatureEnd = -1;
    for (let index = parenStart; index < source.length; index += 1) {
        if (source[index] === '(') parenDepth += 1;
        if (source[index] === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) {
                signatureEnd = index;
                break;
            }
        }
    }
    assert.notEqual(signatureEnd, -1, `${functionName} signature should close`);

    const braceStart = source.indexOf('{', signatureEnd);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${functionName}`);
}

test('future runtime extraction targets do not exist while event emitters remain extracted', () => {
    assert.equal(fs.existsSync(SYNC_RUNTIME_STATE_PATH), false);
    assert.equal(fs.existsSync(SYNC_EVENT_EMITTER_PATH), false);
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), true);

    assert.equal(fs.existsSync(STATE_CHANGED_EMITTER_PATH), true);
    assert.equal(fs.existsSync(SYNC_LOG_QUEUE_PATH), true);
    assert.equal(fs.existsSync(LINK_STATE_EMITTER_PATH), true);
    assert.equal(fs.existsSync(LIBRARY_UPDATE_EMITTER_PATH), true);
    assert.equal(fs.existsSync(SYNC_TERMINAL_EVENT_EMITTER_PATH), true);
});

test('platformSync still owns runtime state and mutation helper definitions', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);

    for (const symbol of [
        'const _platformSyncState',
        'function _createPlatformSyncState',
        'function _getPlatformSyncState',
        'function _setPlatformSyncState',
        'function _startPlatformSync',
        'function _updatePlatformSyncAccount',
        'function _updatePlatformSyncProgress',
        'function _finishPlatformSync',
        'function _emitPlatformSyncState',
    ]) {
        assert.match(source, new RegExp(escapeRegExp(symbol)));
    }

    assert.match(source, /StateChangedEmitter/);
    assert.match(source, /SyncLogQueue/);
    assert.match(source, /LinkStateEmitter/);
    assert.match(source, /LibraryUpdateEmitter/);
    assert.match(source, /SyncTerminalEventEmitter/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.match(mainSource, /require\(['"]\.\/platformSync['"]\)/);
    assert.doesNotMatch(mainSource, /SyncContainer/);
});

test('default runtime state shape remains source-visible', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const createSource = extractFunctionSource(source, '_createPlatformSyncState');

    assert.match(source, /const\s+_platformSyncState\s*=\s*\{\s*steam:\s*null,\s*epic:\s*null,\s*\}/s);
    assert.match(createSource, /platform,\s*isSyncing:\s*false,\s*phase:\s*['"]idle['"]/s);
    assert.match(createSource, /statusText:\s*['"]/);
    assert.match(createSource, /startedAt:\s*null/);
    assert.match(createSource, /finishedAt:\s*null/);
    assert.match(createSource, /completedAccounts:\s*0/);
    assert.match(createSource, /totalAccounts:\s*0/);
    assert.match(createSource, /percent:\s*0/);
    assert.match(createSource, /currentAccountId:\s*null/);
    assert.match(createSource, /currentAccountName:\s*null/);
    assert.match(createSource, /accounts:\s*\{\}/);
    assert.match(createSource, /logs:\s*\[\]/);
    assert.match(createSource, /lastError:\s*null/);
    assert.match(createSource, /validation:\s*\{\s*ok:\s*true,\s*issues:\s*\[\],\s*countsByAccount:\s*\{\},\s*totalGames:\s*0\s*\}/);
    assert.match(createSource, /summary:\s*\{\s*totalGames:\s*0,\s*installOnlyGames:\s*0,\s*sampleTitles:\s*\[\]\s*\}/);
});

test('_setPlatformSyncState clone, merge, emit, and return behavior remains source-visible', () => {
    const setSource = extractFunctionSource(readSource(PLATFORM_SYNC_PATH), '_setPlatformSyncState');

    assert.match(setSource, /const\s+baseState\s*=\s*_clonePlain\(_getPlatformSyncState\(platform\)\)/);
    assert.match(setSource, /typeof\s+updater\s*===\s*['"]function['"]/);
    assert.match(setSource, /updater\(baseState\)\s*\|\|\s*baseState/);
    assert.match(setSource, /\{\s*\.\.\.baseState,\s*\.\.\.updater\s*\}/);
    assert.match(setSource, /_platformSyncState\[platform\]\s*=\s*nextState/);
    assert.match(setSource, /_emitPlatformSyncState\(platform\)/);
    assert.match(setSource, /return\s+nextState/);
});

test('_startPlatformSync mutation order remains source-visible', () => {
    const startSource = extractFunctionSource(readSource(PLATFORM_SYNC_PATH), '_startPlatformSync');

    assert.match(startSource, /const\s+state\s*=\s*_createPlatformSyncState\(platform\)/);
    assert.match(startSource, /state\.isSyncing\s*=\s*true/);
    assert.match(startSource, /state\.phase\s*=\s*['"]starting['"]/);
    assert.match(startSource, /state\.statusText\s*=\s*statusText/);
    assert.match(startSource, /state\.startedAt\s*=\s*now/);
    assert.match(startSource, /state\.finishedAt\s*=\s*null/);
    assert.match(startSource, /state\.progress\.totalAccounts\s*=\s*accounts\.length/);
    assert.match(startSource, /state\.accounts\s*=\s*Object\.fromEntries\(accounts\.map/);
    assert.match(startSource, /status:\s*['"]pending['"]/);
    assert.match(startSource, /message:\s*['"]Waiting to sync['"]/);
    assert.ok(startSource.indexOf('_platformSyncState[platform] = state') < startSource.indexOf('_emitPlatformSyncState(platform)'));
    assert.ok(startSource.indexOf('_emitPlatformSyncState(platform)') < startSource.indexOf('_pushPlatformSyncLog(platform'));
});

test('account and progress mutation helpers remain source-visible', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const accountSource = extractFunctionSource(source, '_updatePlatformSyncAccount');
    const progressSource = extractFunctionSource(source, '_updatePlatformSyncProgress');

    assert.match(accountSource, /_setPlatformSyncState\(platform,\s*\(state\)\s*=>/);
    assert.match(accountSource, /const\s+aid\s*=\s*String\(accountId\)/);
    assert.match(accountSource, /state\.accounts\?\.\[aid\]\s*\|\|\s*\{\s*id:\s*aid,\s*displayName:\s*aid,\s*status:\s*['"]pending['"],\s*gamesCount:\s*0\s*\}/);
    assert.match(accountSource, /state\.accounts\s*=\s*\{\s*\.\.\.state\.accounts,/);
    assert.match(accountSource, /\[aid\]:\s*\{\s*\.\.\.existing,\s*\.\.\.patch,/);
    assert.match(accountSource, /return\s+state/);

    assert.match(progressSource, /_setPlatformSyncState\(platform,\s*\(state\)\s*=>/);
    assert.match(progressSource, /state\.progress\s*=\s*\{\s*\.\.\.state\.progress,\s*\.\.\.patch\s*\}/);
    assert.match(progressSource, /const\s+total\s*=\s*Math\.max\(0,\s*Number\(state\.progress\.totalAccounts\)\s*\|\|\s*0\)/);
    assert.match(progressSource, /const\s+completed\s*=\s*Math\.max\(0,\s*Number\(state\.progress\.completedAccounts\)\s*\|\|\s*0\)/);
    assert.match(progressSource, /state\.progress\.percent\s*=\s*total\s*>\s*0\s*\?\s*Math\.min\(100,\s*Math\.round\(\(completed\s*\/\s*total\)\s*\*\s*100\)\)\s*:\s*0/);
    assert.match(progressSource, /return\s+state/);
});

test('_finishPlatformSync completed and failed mutation behavior remains source-visible', () => {
    const finishSource = extractFunctionSource(readSource(PLATFORM_SYNC_PATH), '_finishPlatformSync');

    assert.match(finishSource, /_setPlatformSyncState\(platform,\s*\(state\)\s*=>/);
    assert.match(finishSource, /state\.isSyncing\s*=\s*false/);
    assert.match(finishSource, /state\.phase\s*=\s*patch\.phase\s*\|\|\s*['"]done['"]/);
    assert.match(finishSource, /state\.statusText\s*=\s*patch\.statusText\s*\|\|\s*state\.statusText/);
    assert.match(finishSource, /state\.finishedAt\s*=\s*new\s+Date\(\)\.toISOString\(\)/);
    assert.match(finishSource, /state\.lastError\s*=\s*patch\.lastError\s*\|\|\s*null/);
    assert.match(finishSource, /if\s*\(patch\.validation\)\s*state\.validation\s*=\s*patch\.validation/);
    assert.match(finishSource, /if\s*\(patch\.summary\)\s*state\.summary\s*=\s*patch\.summary/);
    assert.match(finishSource, /if\s*\(patch\.progress\)\s*state\.progress\s*=\s*\{\s*\.\.\.state\.progress,\s*\.\.\.patch\.progress\s*\}/);
    assert.match(finishSource, /state\.progress\.percent\s*=/);
    assert.match(finishSource, /const\s+finalState\s*=\s*_clonePlain\(_getPlatformSyncState\(platform\)\)/);
    assert.match(finishSource, /const\s+isFailed\s*=\s*patch\.phase\s*===\s*['"]error['"]\s*\|\|\s*!!patch\.lastError/);
    assert.match(finishSource, /syncTerminalEventEmitter\.emitFailed\(finalState\)/);
    assert.match(finishSource, /syncTerminalEventEmitter\.emitCompleted\(finalState,\s*\{/);
});

test('mutation, state event, and terminal event order remains source-visible', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const setSource = extractFunctionSource(source, '_setPlatformSyncState');
    const emitSource = extractFunctionSource(source, '_emitPlatformSyncState');
    const finishSource = extractFunctionSource(source, '_finishPlatformSync');

    assert.ok(setSource.indexOf('_platformSyncState[platform] = nextState') < setSource.indexOf('_emitPlatformSyncState(platform)'));
    assert.match(emitSource, /stateChangedEmitter\.emit\(_clonePlain\(_getPlatformSyncState\(platform\)\)\)/);
    assert.ok(finishSource.indexOf('_setPlatformSyncState(platform') < finishSource.indexOf('const finalState = _clonePlain(_getPlatformSyncState(platform))'));
    assert.ok(finishSource.indexOf('const finalState = _clonePlain(_getPlatformSyncState(platform))') < finishSource.indexOf('syncTerminalEventEmitter.emit'));
});

test('get-state IPC, connectors, and public API remain stable', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);

    assert.match(source, /ipcMainRef\.handle\(['"]platform-sync:get-state['"]/);
    assert.match(source, /return\s+\{\s*status:\s*['"]success['"],\s*state:\s*_clonePlain\(_platformSyncState\)\s*\}/);
    assert.match(source, /return\s+\{\s*status:\s*['"]success['"],\s*state:\s*_clonePlain\(_getPlatformSyncState\(platform\)\)\s*\}/);
    assert.match(source, /_cfWin\.webContents\.send\(['"]all-games-cover-cached['"],\s*payload\)/);
    assert.match(source, /const\s+steamConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+epicConnectorMethods\s*=\s*\{/);
    assert.match(source, /createSyncConnectors/);
    assert.match(source, /ALL_CONNECTORS/);
    assert.match(mainSource, /require\(['"]\.\/platformSync['"]\)/);

    for (const method of CONNECTOR_METHODS) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(method)}\\s*\\(`), `${method} should remain source-visible`);
    }
    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(source, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} IPC channel should remain unchanged`);
    }
    for (const key of SYNC_FEATURE_API_KEYS) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(key)}\\b`), `${key} should remain exported through platformSync`);
    }
});
