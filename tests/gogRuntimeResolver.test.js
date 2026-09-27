'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const {
    getGogRuntimePaths,
    loadGogRuntimeVersionInfo,
} = require('../src/features/sync/infrastructure/integrations/gog/GogRuntimeResolver');
const { GogRuntime } = require('../src/features/sync/infrastructure/integrations/gog/GogRuntime');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-gog-runtime-'));
}

function writeRuntime(root, version) {
    const dir = path.join(root, 'gog-runtime');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'gogdl.exe'), 'runtime');
    fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(version));
    fs.writeFileSync(path.join(dir, 'LICENSE-GPL-3.0.txt'), 'license');
}

test('GOG runtime resolver loads development metadata from project root', () => {
    const projectRoot = tempDir();
    const resourcesPath = tempDir();
    try {
        writeRuntime(projectRoot, { version: 'dev-version', sha256: 'DEVHASH' });
        writeRuntime(resourcesPath, { version: 'packaged-version', sha256: 'PACKAGEDHASH' });
        const paths = getGogRuntimePaths({ projectRoot, resourcesPath, isPackaged: false });
        assert.equal(paths.runtimeDir, path.join(projectRoot, 'gog-runtime'));
        assert.equal(paths.versionPath, path.join(projectRoot, 'gog-runtime', 'version.json'));
        const loaded = loadGogRuntimeVersionInfo({ projectRoot, resourcesPath, isPackaged: false });
        assert.equal(loaded.versionInfo.version, 'dev-version');
        assert.equal(loaded.versionInfo.sha256, 'DEVHASH');
    } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(resourcesPath, { recursive: true, force: true });
    }
});

test('GOG runtime resolver loads packaged metadata from process resources path', () => {
    const projectRoot = tempDir();
    const resourcesPath = tempDir();
    try {
        writeRuntime(projectRoot, { version: 'wrong-dev-version', sha256: 'DEVHASH' });
        writeRuntime(resourcesPath, { version: 'packaged-version', sha256: 'PACKAGEDHASH' });
        const paths = getGogRuntimePaths({ projectRoot, resourcesPath, isPackaged: true });
        assert.equal(paths.runtimeDir, path.join(resourcesPath, 'gog-runtime'));
        assert.equal(paths.versionPath, path.join(resourcesPath, 'gog-runtime', 'version.json'));
        const loaded = loadGogRuntimeVersionInfo({ projectRoot, resourcesPath, isPackaged: true });
        assert.equal(loaded.versionInfo.version, 'packaged-version');
        assert.equal(loaded.versionInfo.sha256, 'PACKAGEDHASH');
    } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(resourcesPath, { recursive: true, force: true });
    }
});

test('GogRuntime reports a controlled metadata error instead of disabling checksum verification', async () => {
    const projectRoot = tempDir();
    try {
        fs.mkdirSync(path.join(projectRoot, 'gog-runtime'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'gog-runtime', 'gogdl.exe'), 'runtime');
        const runtime = new GogRuntime({ projectRoot });
        await assert.rejects(() => runtime.verifyChecksum(), (err) => {
            assert.equal(err.code, 'GOG_RUNTIME_METADATA_INVALID');
            assert.match(err.message, /version\.json|sha256|metadata/i);
            return true;
        });
    } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('GOG runtime metadata has no packaging-unsafe static requires', () => {
    const platformSync = fs.readFileSync(path.join(ROOT, 'platformSync.js'), 'utf8');
    const downloads = fs.readFileSync(path.join(ROOT, 'src/features/downloads/infrastructure/composition/DownloadsContainer.js'), 'utf8');
    assert.doesNotMatch(platformSync, /require\(['"]\.\/gog-runtime\/version\.json['"]\)/);
    assert.doesNotMatch(downloads, /require\(['"][^'"]*gog-runtime\/version\.json['"]\)/);
    assert.match(platformSync, /loadGogRuntimeVersionInfo/);
    assert.match(downloads, /loadGogRuntimeVersionInfo/);
});

test('normal and protected Electron packaging keep GOG runtime as external resources', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const protectedCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.protected.json'), 'utf8'));
    for (const cfg of [pkg.build, protectedCfg]) {
        const gog = (cfg.extraResources || []).find((entry) => entry.from === 'gog-runtime' && entry.to === 'gog-runtime');
        assert.ok(gog, 'gog-runtime must remain an extraResources entry');
        assert.deepEqual(gog.filter, ['gogdl.exe', 'version.json', 'LICENSE-GPL-3.0.txt']);
    }
    assert.ok((pkg.build.files || []).includes('!gog-runtime/**/*'), 'normal build must keep gog-runtime out of app.asar files');
});


test('packaged runtime resource audit checks GOG external resources', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const audit = fs.readFileSync(path.join(ROOT, 'scripts/audit-packaged-runtime-resources.js'), 'utf8');
    assert.equal(pkg.scripts['audit:dist'], 'node scripts/audit-packaged-runtime-resources.js');
    assert.match(pkg.scripts.dist, /npm run audit:dist/);
    for (const rel of [
        'app.asar',
        'steam-runtime/baddel_bridge.exe',
        'gog-runtime/gogdl.exe',
        'gog-runtime/version.json',
        'gog-runtime/LICENSE-GPL-3.0.txt',
    ]) {
        assert.match(audit, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});
