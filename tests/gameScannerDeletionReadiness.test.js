'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GENERATED_DIRS = new Set([
    'node_modules',
    'dist',
    'dist-protected',
    '.protected-build',
    '.protected-asar-extracted',
    'build-tmp',
    '.claude',
]);

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function walkJs(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (GENERATED_DIRS.has(entry.name) || entry.name === '.git') continue;
            walkJs(path.join(dir, entry.name), files);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(path.join(dir, entry.name));
        }
    }
    return files;
}

function rel(filePath) {
    return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

const CREATE_GAMES_FEATURE_RE = /\bcreateGamesFeature\s*\(/;
const GET_GAMES_FEATURE_RE = /\bgetGamesFeature\b/;

function hasRuntimeGameScannerRequire(source) {
    return source.split(/\r?\n/).some((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
        return /(?:^|[=({[,]\s*|return\s+)require\s*\(\s*['"][^'"]*gameScanner['"]\s*\)/.test(trimmed);
    });
}

test('gameScanner.js has been deleted', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'gameScanner.js')), false);
});

test('main.js does not require the gameScanner shim', () => {
    assert.doesNotMatch(read('main.js'), /require\s*\(\s*['"]\.\/gameScanner['"]\s*\)/);
});

test('platformSync.js does not require the gameScanner shim', () => {
    assert.doesNotMatch(read('platformSync.js'), /require\s*\(\s*['"]\.\/gameScanner['"]\s*\)/);
});

test('non-test production JS files do not require gameScanner.js', () => {
    const offenders = walkJs(ROOT)
        .filter(file => !rel(file).startsWith('tests/'))
        .filter(file => rel(file) !== 'gameScanner.js')
        .filter(file => hasRuntimeGameScannerRequire(read(rel(file))));

    assert.deepEqual(offenders.map(rel), []);
});

test('production code does not call createGamesFeature outside GamesContainer.js', () => {
    const offenders = walkJs(ROOT)
        .filter(file => !rel(file).startsWith('tests/'))
        .filter(file => rel(file) !== 'src/features/games/infrastructure/composition/GamesContainer.js')
        .filter(file => CREATE_GAMES_FEATURE_RE.test(read(rel(file))));

    assert.deepEqual(offenders.map(rel), []);
});

test('tests no longer require gameScanner.js', () => {
    const offenders = walkJs(path.join(ROOT, 'tests'))
        .filter(file => rel(file) !== 'tests/gameScannerDeletionReadiness.test.js')
        .filter(file => hasRuntimeGameScannerRequire(read(rel(file))));

    assert.deepEqual(offenders.map(rel), []);
});

test('production Games singleton wiring uses getGamesFeature in the expected roots', () => {
    assert.match(read('main.js'), GET_GAMES_FEATURE_RE);
    assert.match(read('platformSync.js'), GET_GAMES_FEATURE_RE);
    assert.match(
        read('src/features/games/infrastructure/composition/GamesContainer.js'),
        /function\s+getGamesFeature\s*\(/,
    );
});

test('GamesContainer exports getGamesFeature', () => {
    const container = read('src/features/games/infrastructure/composition/GamesContainer.js');

    assert.match(container, /module\.exports\s*=\s*\{/);
    assert.match(container, /\bgetGamesFeature\b/);
});

test('BaddelEngine and GameScannerCore source files exist', () => {
    assert.equal(
        fs.existsSync(path.join(ROOT, 'src', 'features', 'games', 'infrastructure', 'legacy', 'BaddelEngine.js')),
        true,
    );
    assert.equal(
        fs.existsSync(path.join(ROOT, 'src', 'features', 'games', 'infrastructure', 'scanner', 'GameScannerCore.js')),
        true,
    );
});
