'use strict';

/**
 * buildProtected.test.js
 *
 * Static verification that the production hardening infrastructure is correctly
 * set up.  These tests run against source files only — they do not require the
 * protected build to have been executed.
 */

const test    = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const path    = require('path');

const ROOT = path.resolve(__dirname, '..');

const MAIN_JS   = fs.readFileSync(path.join(ROOT, 'main.js'),   'utf8');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const BUILD_SCR = fs.readFileSync(path.join(ROOT, 'scripts', 'build-protected.js'), 'utf8');
const AUDIT_SCR = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-protected-build.js'), 'utf8');
const PROT_CFG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.protected.json'), 'utf8'));

// ── DevTools hardening in main.js ────────────────────────────────────────────

test('main.js: isProductionBuild function is defined', () => {
    assert.ok(MAIN_JS.includes('function isProductionBuild()'), 'isProductionBuild not found');
});

test('main.js: isProductionBuild checks app.isPackaged', () => {
    const idx   = MAIN_JS.indexOf('function isProductionBuild()');
    const block = MAIN_JS.slice(idx, idx + 200);
    assert.ok(block.includes('app.isPackaged'), 'isProductionBuild must check app.isPackaged');
});

test('main.js: isProductionBuild respects BADDEL_ENABLE_DEVTOOLS env override', () => {
    const idx   = MAIN_JS.indexOf('function isProductionBuild()');
    const block = MAIN_JS.slice(idx, idx + 200);
    assert.ok(block.includes('BADDEL_ENABLE_DEVTOOLS'), 'isProductionBuild must check BADDEL_ENABLE_DEVTOOLS');
});

test('main.js: BrowserWindow webPreferences sets devTools based on isProductionBuild', () => {
    assert.ok(
        MAIN_JS.includes('devTools:') && MAIN_JS.includes('isProductionBuild()'),
        'devTools must be gated on isProductionBuild in BrowserWindow'
    );
    const idx   = MAIN_JS.indexOf('devTools:');
    const block = MAIN_JS.slice(idx, idx + 60);
    assert.ok(block.includes('isProductionBuild'), 'devTools option must reference isProductionBuild');
});

test('main.js: Menu.setApplicationMenu(null) is called in production', () => {
    assert.ok(
        MAIN_JS.includes('Menu.setApplicationMenu(null)'),
        'Menu.setApplicationMenu(null) not found'
    );
});

test('main.js: app.on web-contents-created registers production DevTools guard', () => {
    assert.ok(
        MAIN_JS.includes("app.on('web-contents-created'"),
        "app.on('web-contents-created') not found"
    );
});

test('main.js: _blockDevToolsInput helper blocks Ctrl+Shift+I/J/C', () => {
    const idx = MAIN_JS.indexOf('_blockDevToolsInput');
    assert.ok(idx !== -1, '_blockDevToolsInput helper not found in main.js');
    const block = MAIN_JS.slice(idx, idx + 600);
    assert.ok(block.includes("'i'") || block.includes('"i"'), "Ctrl+Shift+I shortcut not blocked");
    assert.ok(block.includes("'j'") || block.includes('"j"'), "Ctrl+Shift+J shortcut not blocked");
    assert.ok(block.includes("'c'") || block.includes('"c"'), "Ctrl+Shift+C shortcut not blocked");
    assert.ok(block.includes('event.preventDefault'), 'event.preventDefault not called');
});

test('main.js: _blockDevToolsInput helper blocks F12', () => {
    const idx   = MAIN_JS.indexOf('_blockDevToolsInput');
    const block = MAIN_JS.slice(idx, idx + 600);
    assert.ok(block.includes('F12'), 'F12 shortcut not blocked');
});

test('main.js: before-input-event uses _blockDevToolsInput', () => {
    assert.ok(MAIN_JS.includes('before-input-event'), 'before-input-event handler not found');
    const idx   = MAIN_JS.indexOf('before-input-event');
    const block = MAIN_JS.slice(idx, idx + 100);
    assert.ok(block.includes('_blockDevToolsInput'), '_blockDevToolsInput not wired to before-input-event');
});

test('main.js: devtools-opened event closes DevTools immediately', () => {
    assert.ok(
        MAIN_JS.includes('devtools-opened'),
        'devtools-opened handler not found'
    );
    const idx   = MAIN_JS.indexOf('devtools-opened');
    const block = MAIN_JS.slice(idx, idx + 100);
    assert.ok(block.includes('closeDevTools'), 'closeDevTools not called on devtools-opened');
});

test('main.js: DevTools lockdown is gated on isProductionBuild inside web-contents-created', () => {
    const idx   = MAIN_JS.indexOf("app.on('web-contents-created'");
    assert.ok(idx !== -1, "app.on('web-contents-created') not found");
    // The guard should appear inside the handler body
    const block = MAIN_JS.slice(idx, idx + 500);
    assert.ok(block.includes('isProductionBuild()'), 'web-contents-created handler must gate DevTools guard on isProductionBuild()');
});

// ── package.json scripts ──────────────────────────────────────────────────────

test('package.json: build:protected script exists', () => {
    assert.ok(
        typeof PKG.scripts?.['build:protected'] === 'string',
        'build:protected script missing from package.json'
    );
});

test('package.json: dist:protected script exists', () => {
    assert.ok(
        typeof PKG.scripts?.['dist:protected'] === 'string',
        'dist:protected script missing from package.json'
    );
});

test('package.json: audit:protected script exists', () => {
    assert.ok(
        typeof PKG.scripts?.['audit:protected'] === 'string',
        'audit:protected script missing from package.json'
    );
});

test('package.json: release:verify script exists', () => {
    assert.ok(
        typeof PKG.scripts?.['release:verify'] === 'string',
        'release:verify script missing from package.json'
    );
});

test('package.json: javascript-obfuscator is a devDependency', () => {
    assert.ok(
        typeof PKG.devDependencies?.['javascript-obfuscator'] === 'string',
        'javascript-obfuscator must be in devDependencies'
    );
});

// ── electron-builder.protected.json ──────────────────────────────────────────

test('electron-builder.protected.json: asar is true', () => {
    assert.strictEqual(PROT_CFG.asar, true, 'asar must be true in protected build config');
});

test('electron-builder.protected.json: compression is maximum', () => {
    assert.strictEqual(PROT_CFG.compression, 'maximum', 'compression should be maximum in protected config');
});

test('electron-builder.protected.json: directories.app points to protected build', () => {
    assert.ok(
        PROT_CFG.directories?.app?.includes('.protected-build'),
        'directories.app must point to .protected-build in protected config'
    );
});

test('electron-builder.protected.json: native modules remain unpacked (ps-list, sharp, keytar)', () => {
    const unpacked = PROT_CFG.asarUnpack || [];
    const hasAll = ['ps-list', 'sharp', 'keytar'].every(
        pkg => unpacked.some(p => p.includes(pkg))
    );
    assert.ok(hasAll, 'asarUnpack must include ps-list, sharp, and keytar');
});

test('electron-builder.protected.json: publish config preserved', () => {
    assert.ok(
        Array.isArray(PROT_CFG.publish) && PROT_CFG.publish.length > 0,
        'publish config must be present in protected builder config'
    );
    const pub = PROT_CFG.publish[0];
    assert.strictEqual(pub.provider, 'github', 'publisher must be github');
});

test('electron-builder.protected.json: steam-runtime included as extraResources', () => {
    const extra = PROT_CFG.extraResources || [];
    const hasSteam = extra.some(e => e.from === 'steam-runtime');
    assert.ok(hasSteam, 'steam-runtime extraResource missing from protected build config');
});

test('electron-builder.protected.json: files array does not exclude node_modules', () => {
    const filesArray = PROT_CFG.files || [];
    const excludesNm = filesArray.some(f => typeof f === 'string' && f.includes('!node_modules'));
    assert.ok(
        !excludesNm,
        'files array must NOT contain "!node_modules/**/*" — it contradicts asarUnpack and causes a crash at launch'
    );
});

// ── build-protected.js script ─────────────────────────────────────────────────

test('scripts/build-protected.js: excludes tests directory', () => {
    assert.ok(BUILD_SCR.includes("'tests'"), "build script must exclude 'tests'");
});

test('scripts/build-protected.js: excludes docs directory', () => {
    assert.ok(BUILD_SCR.includes("'docs'"), "build script must exclude 'docs'");
});

test('scripts/build-protected.js: excludes node_modules from copy', () => {
    assert.ok(BUILD_SCR.includes("'node_modules'"), "build script must exclude 'node_modules' from copy");
});

test('scripts/build-protected.js: excludes scripts directory', () => {
    assert.ok(BUILD_SCR.includes("'scripts'"), "build script must exclude 'scripts' directory");
});

test('scripts/build-protected.js: excludes skills-lock.json', () => {
    assert.ok(BUILD_SCR.includes('skills-lock.json'), 'build script must exclude skills-lock.json');
});

test('scripts/build-protected.js: excludes *.md files by pattern', () => {
    assert.ok(BUILD_SCR.includes(".endsWith('.md')"), "build script must exclude *.md files");
});

test('scripts/build-protected.js: excludes *.test.js files by pattern', () => {
    assert.ok(BUILD_SCR.includes(".endsWith('.test.js')"), "build script must exclude *.test.js files");
});

test('scripts/build-protected.js: excludes electron-builder*.json by pattern', () => {
    assert.ok(BUILD_SCR.includes('electron-builder'), "build script must exclude electron-builder*.json files");
});

test('scripts/build-protected.js: obfuscation failure exits process non-zero (fail-closed)', () => {
    assert.ok(
        BUILD_SCR.includes('[Fatal] Obfuscation failed') && BUILD_SCR.includes('process.exit(1)'),
        'obfuscation failure must abort the build with process.exit(1)'
    );
    assert.ok(
        !BUILD_SCR.includes('[WARN] Obfuscation failed'),
        'obfuscation must not silently fall back (no [WARN] fallback allowed)'
    );
});

test('scripts/build-protected.js: runs audit before electron-builder', () => {
    const auditIdx   = BUILD_SCR.indexOf('audit-protected-build.js');
    const builderIdx = BUILD_SCR.indexOf('electron-builder.protected.json');
    assert.ok(auditIdx !== -1, 'build script must reference audit-protected-build.js');
    assert.ok(builderIdx !== -1, 'build script must reference electron-builder.protected.json');
    assert.ok(auditIdx < builderIdx, 'audit must run before electron-builder in the build script');
});

test('scripts/build-protected.js: obfuscates JS files', () => {
    assert.ok(BUILD_SCR.includes('javascript-obfuscator') || BUILD_SCR.includes('JavaScriptObfuscator'),
        'build script must use javascript-obfuscator');
});

test('scripts/build-protected.js: strips sourceMappingURL', () => {
    assert.ok(BUILD_SCR.includes('sourceMappingURL'), 'build script must strip sourceMappingURL');
});

test('scripts/build-protected.js: removes .map files', () => {
    assert.ok(BUILD_SCR.includes('.map'), 'build script must remove .map files');
});

test('scripts/build-protected.js: links node_modules via junction', () => {
    assert.ok(BUILD_SCR.includes('node_modules'), 'build script must handle node_modules');
    assert.ok(BUILD_SCR.includes('junction') || BUILD_SCR.includes('symlinkSync'),
        'build script must create a node_modules junction/symlink');
});

test('scripts/build-protected.js: uses electron-builder.protected.json config', () => {
    assert.ok(
        BUILD_SCR.includes('electron-builder.protected.json'),
        'build script must use the protected electron-builder config'
    );
});

// ── audit-protected-build.js script ──────────────────────────────────────────

test('scripts/audit-protected-build.js: checks for .map files', () => {
    assert.ok(AUDIT_SCR.includes('.map'), 'audit script must check for .map files');
});

test('scripts/audit-protected-build.js: checks for sourceMappingURL', () => {
    assert.ok(AUDIT_SCR.includes('sourceMappingURL'), 'audit script must check for sourceMappingURL');
});

test('scripts/audit-protected-build.js: checks for tests directory', () => {
    assert.ok(AUDIT_SCR.includes('tests'), 'audit script must check for tests directory');
});

test('scripts/audit-protected-build.js: checks for docs directory', () => {
    assert.ok(AUDIT_SCR.includes('docs'), 'audit script must check for docs directory');
});

test('scripts/audit-protected-build.js: checks for .md files', () => {
    assert.ok(AUDIT_SCR.includes('.md'), 'audit script must check for .md files');
});

test('scripts/audit-protected-build.js: checks for repomix output', () => {
    assert.ok(AUDIT_SCR.includes('repomix'), 'audit script must check for repomix output files');
});

test('scripts/audit-protected-build.js: exits non-zero on violations', () => {
    assert.ok(AUDIT_SCR.includes('process.exit(1)'), 'audit script must exit with code 1 on violations');
});

test('scripts/audit-protected-build.js: spot-checks main.js obfuscation', () => {
    assert.ok(AUDIT_SCR.includes('main.js'), 'audit script must spot-check main.js');
    assert.ok(AUDIT_SCR.includes('_0x'), 'audit script must look for obfuscated identifiers');
});

test('scripts/audit-protected-build.js: checks multiple first-party JS files for obfuscation', () => {
    assert.ok(AUDIT_SCR.includes('preload.js'), 'audit script must check preload.js');
    assert.ok(AUDIT_SCR.includes('accountsHandler.js'), 'audit script must check accountsHandler.js');
    assert.ok(AUDIT_SCR.includes('platformSync.js'), 'audit script must check platformSync.js');
    assert.ok(AUDIT_SCR.includes('steamBridge.js'), 'audit script must check steamBridge.js');
});

test('scripts/audit-protected-build.js: checks for scripts/ directory', () => {
    assert.ok(AUDIT_SCR.includes("'scripts'") || AUDIT_SCR.includes('"scripts"') || AUDIT_SCR.includes("scripts/"),
        'audit script must check for scripts/ directory in the build');
});

test('scripts/audit-protected-build.js: checks for *.test.js files', () => {
    assert.ok(AUDIT_SCR.includes('.test.js'), 'audit script must check for *.test.js files');
});

test('scripts/audit-protected-build.js: checks for electron-builder config files', () => {
    assert.ok(AUDIT_SCR.includes('electron-builder'), 'audit script must check for electron-builder config files');
});

test('scripts/audit-protected-build.js: checks for skills-lock.json', () => {
    assert.ok(AUDIT_SCR.includes('skills-lock.json'), 'audit script must check for skills-lock.json');
});

test('scripts/audit-protected-build.js: checks required runtime modules are present', () => {
    assert.ok(AUDIT_SCR.includes('axios'), 'audit script must check for axios runtime module');
    assert.ok(AUDIT_SCR.includes('electron-updater'), 'audit script must check for electron-updater');
    assert.ok(AUDIT_SCR.includes('electron-store'), 'audit script must check for electron-store');
    assert.ok(AUDIT_SCR.includes('ps-list'), 'audit script must check for ps-list');
    assert.ok(AUDIT_SCR.includes('node_modules'), 'audit script must check inside node_modules for modules');
});

// ── Script files exist ────────────────────────────────────────────────────────

test('scripts/build-protected.js file exists', () => {
    assert.ok(
        fs.existsSync(path.join(ROOT, 'scripts', 'build-protected.js')),
        'scripts/build-protected.js not found'
    );
});

test('scripts/audit-protected-build.js file exists', () => {
    assert.ok(
        fs.existsSync(path.join(ROOT, 'scripts', 'audit-protected-build.js')),
        'scripts/audit-protected-build.js not found'
    );
});

test('electron-builder.protected.json file exists', () => {
    assert.ok(
        fs.existsSync(path.join(ROOT, 'electron-builder.protected.json')),
        'electron-builder.protected.json not found'
    );
});
