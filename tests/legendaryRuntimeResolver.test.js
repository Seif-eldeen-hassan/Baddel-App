'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    getLegendaryRuntimePath,
    inspectLegendaryRuntime,
    createLegendaryRuntimeMissingError,
} = require('../src/features/sync/infrastructure/integrations/epic/LegendaryRuntimeResolver');

const ROOT = path.resolve(__dirname, '..');

function readText(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('Legendary runtime resolver loads development executable from project root', () => {
    const projectRoot = path.join('E:', 'Baddel', 'Baddel-App');
    assert.equal(
        getLegendaryRuntimePath({ projectRoot, resourcesPath: 'C:\\ignored\\resources', isPackaged: false }),
        path.join(projectRoot, 'bin', 'legendary.exe'),
    );
});

test('Legendary runtime resolver loads packaged executable from process resources path', () => {
    const projectRoot = path.join('E:', 'Baddel', 'Baddel-App');
    const resourcesPath = path.join('C:', 'Users', 'TestUser', 'AppData', 'Local', 'Programs', 'baddel-launcher-beta', 'resources');
    const resolved = getLegendaryRuntimePath({ projectRoot, resourcesPath, isPackaged: true });
    assert.equal(resolved, path.join(resourcesPath, 'bin', 'legendary.exe'));
    assert.doesNotMatch(resolved, /app\.asar/i);
});

test('Legendary runtime inspection reports exists without exposing secrets', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-legendary-runtime-'));
    fs.mkdirSync(path.join(tmp, 'bin'));
    fs.writeFileSync(path.join(tmp, 'bin', 'legendary.exe'), 'fake');
    const inspected = inspectLegendaryRuntime({ projectRoot: tmp, resourcesPath: 'ignored', isPackaged: false });
    assert.equal(inspected.exists, true);
    assert.equal(inspected.legendaryPath, path.join(tmp, 'bin', 'legendary.exe'));
    assert.deepEqual(Object.keys(inspected).sort(), ['exists', 'isPackaged', 'legendaryPath', 'resourcesPath'].sort());
});

test('missing Legendary uses a controlled runtime error code', () => {
    const err = createLegendaryRuntimeMissingError('C:\\missing\\bin\\legendary.exe');
    assert.equal(err.code, 'EPIC_LEGENDARY_RUNTIME_MISSING');
    assert.match(err.message, /Epic Legendary runtime is missing/);
});

test('platformSync does not use a production-unsafe static Legendary path', () => {
    const source = readText('platformSync.js');
    assert.doesNotMatch(source, /const\s+LEGENDARY_BIN\s*=\s*path\.join\(__dirname,\s*['"]bin['"],\s*['"]legendary\.exe['"]\)/);
    assert.match(source, /inspectLegendaryRuntime\(\{/);
    assert.match(source, /spawn\(runtime\.legendaryPath,\s*args,\s*\{\s*env,\s*shell:\s*false,\s*windowsHide:\s*true\s*\}\)/);
    assert.match(source, /LEGENDARY_CONFIG_PATH:\s*configPath/);
    assert.match(source, /EPIC_LEGENDARY_RUNTIME_MISSING|createLegendaryRuntimeMissingError/);
});

test('normal and protected Electron packaging externalize legendary.exe', () => {
    const pkg = JSON.parse(readText('package.json'));
    const protectedConfig = JSON.parse(readText('electron-builder.protected.json'));

    for (const config of [pkg.build, protectedConfig]) {
        assert.ok(config.files.includes('!bin/legendary.exe'), 'legendary.exe must not be relied upon inside app.asar');
        assert.ok(
            config.extraResources.some((item) => item.from === 'bin/legendary.exe' && item.to === 'bin/legendary.exe'),
            'legendary.exe must be copied to resources/bin/legendary.exe',
        );
    }
});

test('packaged runtime resource audit requires Legendary external resource', () => {
    const source = readText('scripts/audit-packaged-runtime-resources.js');
    assert.match(source, /'bin\/legendary\.exe'/);
});

test('protected build guard rejects ASAR-relative Legendary runtime paths', () => {
    const source = readText('scripts/build-protected.js');
    assert.match(source, /ASAR-relative Legendary runtime path/);
    assert.match(source, /LegendaryRuntimeResolver/);
    assert.match(source, /app\.asar\[\\\\\\\\\/\]bin\[\\\\\\\\\/\]legendary\.exe|legendary\.exe/);
});
