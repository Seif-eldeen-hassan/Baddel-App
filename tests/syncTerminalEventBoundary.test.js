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
const SYNC_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncEventEmitter.js');
const SYNC_TERMINAL_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncTerminalEventEmitter.js');
const SYNC_RUNTIME_STATE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncRuntimeState.js');
const LINK_STATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LinkStateEmitter.js');
const LIBRARY_UPDATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LibraryUpdateEmitter.js');
const SYNC_LOG_QUEUE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncLogQueue.js');
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');

const CONNECTOR_METHODS = ['isLinked', 'getAccounts', 'link', 'syncLibrary', 'getCachedLibrary', 'unlink'];
const PLATFORM_SYNC_IPC_CHANNELS = [
    'platform-sync:status',
    'platform-sync:get-accounts',
    'platform-sync:link',
    'platform-sync:sync',
    'platform-sync:get-state',
    'platform-sync:get-cached',
    'platform-sync:unlink',
];

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
        if (source[index] === '(') parenDepth++;
        if (source[index] === ')') {
            parenDepth--;
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
        if (source[index] === '{') depth++;
        if (source[index] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${functionName}`);
}

function extractObjectLiteral(source, declarationName) {
    const start = source.indexOf(`const ${declarationName} = {`);
    assert.notEqual(start, -1, `${declarationName} declaration should exist`);

    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth++;
        if (source[index] === '}') {
            depth--;
            if (depth === 0) return source.slice(braceStart, index + 1);
        }
    }
    throw new Error(`Could not extract ${declarationName}`);
}

test('terminal emitter exists and broad extraction targets do not exist yet', () => {
    assert.equal(fs.existsSync(SYNC_TERMINAL_EVENT_EMITTER_PATH), true);
    assert.equal(fs.existsSync(SYNC_EVENT_EMITTER_PATH), false);
    assert.equal(fs.existsSync(SYNC_RUNTIME_STATE_PATH), false);
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), true);

    assert.equal(fs.existsSync(SYNC_LOG_QUEUE_PATH), true);
    assert.equal(fs.existsSync(LINK_STATE_EMITTER_PATH), true);
    assert.equal(fs.existsSync(LIBRARY_UPDATE_EMITTER_PATH), true);
});

test('platformSync still owns terminal event emission and adjacent runtime seams', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);

    assert.match(source, /function\s+_finishPlatformSync\s*\(/);
    assert.match(source, /function\s+_emitPlatformSyncState\s*\(/);
    assert.match(source, /function\s+_emitLinkState\s*\(/);
    assert.match(source, /function\s+_emitLibraryUpdated\s*\(/);
    assert.match(source, /_cfWin\.webContents\.send\(['"]all-games-cover-cached['"],\s*payload\)/);

    assert.match(source, /SyncLogQueue/);
    assert.match(source, /LinkStateEmitter/);
    assert.match(source, /LibraryUpdateEmitter/);
    assert.match(source, /SyncTerminalEventEmitter/);
    assert.match(source, /const\s+syncTerminalEventEmitter\s*=\s*new\s+SyncTerminalEventEmitter\(\{/);
    assert.doesNotMatch(source, /SyncContainer/);

    assert.match(source, /const\s+steamConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+epicConnectorMethods\s*=\s*\{/);
    assert.match(source, /createSyncConnectors/);
    assert.match(source, /ALL_CONNECTORS/);
    assert.match(mainSource, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/SyncContainer['"]\)/);
    assert.match(mainSource, /getSyncFeature\(\)/);
});

test('terminal event channel selection and send behavior remain source-visible', () => {
    const finishSource = extractFunctionSource(readSource(PLATFORM_SYNC_PATH), '_finishPlatformSync');
    const terminalEmitterSource = readSource(SYNC_TERMINAL_EVENT_EMITTER_PATH);

    assert.match(finishSource, /const\s+isFailed\s*=\s*patch\.phase\s*===\s*['"]error['"]\s*\|\|\s*!!patch\.lastError/);
    assert.match(finishSource, /const\s+finalState\s*=\s*_clonePlain\(_getPlatformSyncState\(platform\)\)/);
    assert.match(finishSource, /syncTerminalEventEmitter\.emitFailed\(finalState\)/);
    assert.match(finishSource, /syncTerminalEventEmitter\.emitCompleted\(finalState,\s*\{/);
    assert.match(terminalEmitterSource, /this\._send\(['"]platform-sync:completed['"],\s*payload\)/);
    assert.match(terminalEmitterSource, /this\._send\(['"]platform-sync:failed['"],\s*payload\)/);
    assert.match(terminalEmitterSource, /const\s+win\s*=\s*this\.getWindow\?\.\(\)/);
    assert.match(terminalEmitterSource, /win\.webContents\.send\(channel,\s*payload\)/);
});

test('terminal events happen after runtime state mutation and use cloned final state payloads', () => {
    const finishSource = extractFunctionSource(readSource(PLATFORM_SYNC_PATH), '_finishPlatformSync');
    const setStateIndex = finishSource.indexOf('_setPlatformSyncState(platform');
    const cloneIndex = finishSource.indexOf('const finalState = _clonePlain(_getPlatformSyncState(platform))');
    const sendIndex = finishSource.indexOf('syncTerminalEventEmitter.emit');

    assert.ok(setStateIndex !== -1, 'terminal finish should mutate runtime state');
    assert.ok(cloneIndex > setStateIndex, 'final terminal payload should be cloned after state mutation');
    assert.ok(sendIndex > cloneIndex, 'terminal event should send the cloned final state');

    assert.match(finishSource, /state\.isSyncing\s*=\s*false/);
    assert.match(finishSource, /state\.phase\s*=\s*patch\.phase\s*\|\|\s*['"]done['"]/);
    assert.match(finishSource, /state\.statusText\s*=\s*patch\.statusText\s*\|\|\s*state\.statusText/);
    assert.match(finishSource, /state\.finishedAt\s*=\s*new\s+Date\(\)\.toISOString\(\)/);
    assert.match(finishSource, /state\.lastError\s*=\s*patch\.lastError\s*\|\|\s*null/);
    assert.match(finishSource, /if\s*\(patch\.validation\)\s*state\.validation\s*=\s*patch\.validation/);
    assert.match(finishSource, /if\s*\(patch\.summary\)\s*state\.summary\s*=\s*patch\.summary/);
    assert.match(finishSource, /if\s*\(patch\.progress\)\s*state\.progress\s*=\s*\{\s*\.\.\.state\.progress,\s*\.\.\.patch\.progress\s*\}/);
    assert.match(finishSource, /state\.progress\.percent\s*=/);
});

test('terminal notifications stay coupled only to successful completed events', () => {
    const finishSource = extractFunctionSource(readSource(PLATFORM_SYNC_PATH), '_finishPlatformSync');
    const terminalEmitterSource = readSource(SYNC_TERMINAL_EVENT_EMITTER_PATH);

    assert.match(finishSource, /title:\s*['"]Baddel Launcher['"]/);
    assert.match(finishSource, /body:\s*notifyGames\s*>\s*0/);
    assert.match(finishSource, /icon:\s*path\.join\(__dirname,\s*['"]Logo\.ico['"]\)/);
    assert.match(finishSource, /syncTerminalEventEmitter\.emitCompleted\(finalState,\s*\{/);
    assert.match(terminalEmitterSource, /this\.Notification\.isSupported\(\)/);
    assert.match(terminalEmitterSource, /\(!win\s*\|\|\s*win\.isDestroyed\(\)\s*\|\|\s*!win\.isFocused\(\)\)/);
    assert.match(terminalEmitterSource, /new\s+this\.Notification\(notificationOptions\)\.show\(\)/);
});

test('terminal events are not responsible for logs, library updates, or cover notifications', () => {
    const finishSource = extractFunctionSource(readSource(PLATFORM_SYNC_PATH), '_finishPlatformSync');

    assert.doesNotMatch(finishSource, /_pushPlatformSyncLog\(/);
    assert.doesNotMatch(finishSource, /libraryUpdateEmitter|_emitLibraryUpdated|library-updated/);
    assert.doesNotMatch(finishSource, /all-games-cover-cached/);
});

test('public API, IPC channels, and connector method shapes remain stable', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    for (const key of SYNC_FEATURE_API_KEYS) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(key)}\\b`), `${key} should remain exported`);
    }

    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(source, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} IPC channel should remain unchanged`);
    }

    for (const connectorName of ['steamConnectorMethods', 'epicConnectorMethods']) {
        const connectorSource = extractObjectLiteral(source, connectorName);
        for (const method of CONNECTOR_METHODS) {
            assert.match(connectorSource, new RegExp(`\\b${escapeRegExp(method)}\\s*\\(`), `${connectorName}.${method} should remain defined`);
        }
    }
});
