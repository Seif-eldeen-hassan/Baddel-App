'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const BUILD_PROTECTED_PATH = path.join(ROOT, 'scripts', 'build-protected.js');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function normalizeMetafilePath(inputPath) {
    return String(inputPath || '').replace(/\\/g, '/');
}

function metafileHasInput(metafile, suffix) {
    const normalizedSuffix = suffix.replace(/\\/g, '/');
    return Object.keys(metafile?.inputs || {}).some((inputPath) =>
        normalizeMetafilePath(inputPath).endsWith(normalizedSuffix)
    );
}

test('SyncContainer uses a literal static lazy require for platformSync', () => {
    const source = read(SYNC_CONTAINER_PATH);

    assert.match(source, /function\s+loadDefaultPlatformSyncApi\s*\(\)\s*\{/);
    assert.match(source, /return\s+require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/platformSync['"]\)/);
    assert.doesNotMatch(source, /platformSyncPath/);
    assert.doesNotMatch(source, /\.join\(['"]\/['"]\)/);
    assert.doesNotMatch(source, /path\.resolve|path\.join|`[^`]*platformSync/);
});

test('main.js still routes platform sync through SyncContainer only', () => {
    const source = read(MAIN_JS_PATH);

    assert.match(source, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/SyncContainer['"]\)/);
    assert.match(source, /getSyncFeature\(\)/);
    assert.doesNotMatch(source, /require\(['"]\.\/platformSync['"]\)/);
});

test('protected build script guards the main esbuild dependency graph', () => {
    const source = read(BUILD_PROTECTED_PATH);

    assert.match(source, /entryPoints:\s*\[path\.join\(ROOT,\s*['"]main\.js['"]\)\]/);
    assert.match(source, /bundle:\s*true/);
    assert.match(source, /platform:\s*['"]node['"]/);
    assert.match(source, /format:\s*['"]cjs['"]/);
    assert.match(source, /packages:\s*['"]external['"]/);
    assert.match(source, /metafile:\s*true/);
    assert.match(source, /assertMainBundlePlatformSyncResolution\(mainBuildResult,\s*mainPatched\)/);
});

test('main esbuild bundle includes SyncContainer and platformSync without unresolved relative require', async () => {
    const result = await esbuild.build({
        entryPoints: [MAIN_JS_PATH],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        packages: 'external',
        sourcemap: false,
        metafile: true,
        write: false,
        outfile: 'main.bundle.cjs',
        supported: { 'dynamic-import': true },
        logLevel: 'silent',
    });

    assert.ok(
        metafileHasInput(result.metafile, 'src/features/sync/infrastructure/composition/SyncContainer.js'),
        'SyncContainer.js must be in the protected main esbuild graph',
    );
    assert.ok(
        metafileHasInput(result.metafile, 'platformSync.js'),
        'platformSync.js must be in the protected main esbuild graph',
    );

    const output = result.outputFiles.map((file) => file.text).join('\n');
    assert.doesNotMatch(output, /require\(["'][^"']*platformSync(?:\.js)?["']\)/);
});
