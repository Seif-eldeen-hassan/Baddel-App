'use strict';

/**
 * buildProtected.test.js
 *
 * Static verification that the production hardening infrastructure is correctly
 * set up.  These tests run against source files only — they do not require the
 * protected build to have been executed.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

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
    assert.ok(MAIN_JS.includes('Menu.setApplicationMenu(null)'), 'Menu.setApplicationMenu(null) not found');
});

test('main.js: app.on web-contents-created registers production DevTools guard', () => {
    assert.ok(MAIN_JS.includes("app.on('web-contents-created'"), "app.on('web-contents-created') not found");
});

test('main.js: _blockDevToolsInput helper blocks Ctrl+Shift+I/J/C', () => {
    const idx   = MAIN_JS.indexOf('_blockDevToolsInput');
    assert.ok(idx !== -1, '_blockDevToolsInput helper not found in main.js');
    const block = MAIN_JS.slice(idx, idx + 600);
    assert.ok(block.includes("'i'") || block.includes('"i"'), 'Ctrl+Shift+I shortcut not blocked');
    assert.ok(block.includes("'j'") || block.includes('"j"'), 'Ctrl+Shift+J shortcut not blocked');
    assert.ok(block.includes("'c'") || block.includes('"c"'), 'Ctrl+Shift+C shortcut not blocked');
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
    assert.ok(MAIN_JS.includes('devtools-opened'), 'devtools-opened handler not found');
    const idx   = MAIN_JS.indexOf('devtools-opened');
    const block = MAIN_JS.slice(idx, idx + 100);
    assert.ok(block.includes('closeDevTools'), 'closeDevTools not called on devtools-opened');
});

test('main.js: DevTools lockdown is gated on isProductionBuild inside web-contents-created', () => {
    const idx   = MAIN_JS.indexOf("app.on('web-contents-created'");
    assert.ok(idx !== -1, "app.on('web-contents-created') not found");
    const block = MAIN_JS.slice(idx, idx + 500);
    assert.ok(block.includes('isProductionBuild()'), 'web-contents-created handler must gate DevTools guard on isProductionBuild()');
});

// ── package.json scripts ──────────────────────────────────────────────────────

test('package.json: build:protected script exists', () => {
    assert.ok(typeof PKG.scripts?.['build:protected'] === 'string', 'build:protected script missing');
});

test('package.json: dist:protected script exists', () => {
    assert.ok(typeof PKG.scripts?.['dist:protected'] === 'string', 'dist:protected script missing');
});

test('package.json: audit:protected script exists', () => {
    assert.ok(typeof PKG.scripts?.['audit:protected'] === 'string', 'audit:protected script missing');
});

test('package.json: release:verify script exists', () => {
    assert.ok(typeof PKG.scripts?.['release:verify'] === 'string', 'release:verify script missing');
});

test('package.json: javascript-obfuscator is a devDependency', () => {
    assert.ok(typeof PKG.devDependencies?.['javascript-obfuscator'] === 'string', 'javascript-obfuscator must be in devDependencies');
});

test('package.json: esbuild is a devDependency', () => {
    assert.ok(typeof PKG.devDependencies?.['esbuild'] === 'string', 'esbuild must be in devDependencies');
});

// ── electron-builder.protected.json ──────────────────────────────────────────

test('electron-builder.protected.json: asar is true', () => {
    assert.strictEqual(PROT_CFG.asar, true, 'asar must be true in protected build config');
});

test('electron-builder.protected.json: compression is maximum', () => {
    assert.strictEqual(PROT_CFG.compression, 'maximum', 'compression should be maximum in protected config');
});

test('electron-builder.protected.json: directories.app points to protected build', () => {
    assert.ok(PROT_CFG.directories?.app?.includes('.protected-build'), 'directories.app must point to .protected-build');
});

test('electron-builder.protected.json: native modules remain unpacked (ps-list, sharp, keytar)', () => {
    const unpacked = PROT_CFG.asarUnpack || [];
    const hasAll = ['ps-list', 'sharp', 'keytar'].every(p => unpacked.some(u => u.includes(p)));
    assert.ok(hasAll, 'asarUnpack must include ps-list, sharp, and keytar');
});

test('electron-builder.protected.json: publish config preserved', () => {
    assert.ok(Array.isArray(PROT_CFG.publish) && PROT_CFG.publish.length > 0, 'publish config must be present');
    assert.strictEqual(PROT_CFG.publish[0].provider, 'github', 'publisher must be github');
});

test('electron-builder.protected.json: steam-runtime included as extraResources', () => {
    const extra = PROT_CFG.extraResources || [];
    assert.ok(extra.some(e => e.from === 'steam-runtime'), 'steam-runtime extraResource missing');
});

test('electron-builder.protected.json: files array does not exclude node_modules', () => {
    const files = PROT_CFG.files || [];
    const excludesNm = files.some(f => typeof f === 'string' && f.includes('!node_modules'));
    assert.ok(!excludesNm, 'files array must NOT contain "!node_modules/**/*"');
});

// ── build-protected.js: bundling pipeline ────────────────────────────────────

test('scripts/build-protected.js file exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'build-protected.js')), 'build-protected.js not found');
});

test('scripts/build-protected.js: uses esbuild for bundling', () => {
    assert.ok(BUILD_SCR.includes('esbuild'), 'build script must use esbuild');
});

test('scripts/build-protected.js: protected renderer includes current download and maintenance UI assets', () => {
    for (const required of [
        "src/features/games/domain/services/CanonicalProductIdentity.js",
        "src/js/baddel-menus.js",
        "src/js/downloads.js",
        "src/js/install-storage.js",
        "src/css/downloads.css",
        "src/css/install-flow.css",
    ]) {
        assert.match(BUILD_SCR, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('scripts/build-protected.js: creates main.bundle.cjs', () => {
    assert.ok(BUILD_SCR.includes('main.bundle.cjs'), 'build script must output main.bundle.cjs');
});

test('scripts/build-protected.js: creates preload.bundle.cjs', () => {
    assert.ok(BUILD_SCR.includes('preload.bundle.cjs'), 'build script must output preload.bundle.cjs');
});

test('scripts/build-protected.js: creates renderer.bundle.js', () => {
    assert.ok(BUILD_SCR.includes('renderer.bundle.js'), 'build script must output renderer.bundle.js');
});

test('scripts/build-protected.js: creates index.html', () => {
    assert.ok(BUILD_SCR.includes('index.html'), 'build script must output index.html');
});

test('scripts/build-protected.js: patches __dirname path references after bundling', () => {
    assert.ok(BUILD_SCR.includes('patchMainBundle'), 'build script must patch path references after bundling');
    assert.ok(BUILD_SCR.includes('dashboard.html'), 'build script must patch dashboard.html reference');
    assert.ok(BUILD_SCR.includes('preload.bundle.cjs'), 'build script must patch preload reference');
});

test('scripts/build-protected.js: patches renderer ../assets/ paths', () => {
    assert.ok(BUILD_SCR.includes('../assets/'), 'build script must patch ../assets/ renderer paths');
});

test('scripts/build-protected.js: patches renderer ../node_modules/ paths', () => {
    assert.ok(BUILD_SCR.includes('../node_modules/'), 'build script must patch ../node_modules/ renderer paths');
});

test('scripts/build-protected.js: protected package.json uses main.bundle.cjs', () => {
    assert.ok(BUILD_SCR.includes("'main.bundle.cjs'") || BUILD_SCR.includes('"main.bundle.cjs"'),
        'writeProtectedPackageJson must set main to main.bundle.cjs');
});

test('scripts/build-protected.js: copies assets/ and bin/ runtime files', () => {
    assert.ok(BUILD_SCR.includes("'assets'") || BUILD_SCR.includes('"assets"'), 'build script must copy assets/');
    assert.ok(BUILD_SCR.includes("'bin'") || BUILD_SCR.includes('"bin"'), 'build script must copy bin/');
});

test('scripts/build-protected.js: obfuscates JS bundles', () => {
    assert.ok(BUILD_SCR.includes('javascript-obfuscator') || BUILD_SCR.includes('JavaScriptObfuscator'),
        'build script must use javascript-obfuscator');
});

test('scripts/build-protected.js: obfuscation failure exits process non-zero (fail-closed)', () => {
    assert.ok(BUILD_SCR.includes('[Fatal] Obfuscation failed') && BUILD_SCR.includes('process.exit(1)'),
        'obfuscation failure must abort the build');
});

test('scripts/build-protected.js: removes .map files', () => {
    assert.ok(BUILD_SCR.includes('.map'), 'build script must remove .map files');
});

test('scripts/build-protected.js: links node_modules via junction', () => {
    assert.ok(BUILD_SCR.includes('junction') || BUILD_SCR.includes('symlinkSync'),
        'build script must create a node_modules junction');
});

test('scripts/build-protected.js: uses electron-builder.protected.json config', () => {
    assert.ok(BUILD_SCR.includes('electron-builder.protected.json'), 'build script must use the protected electron-builder config');
});

test('scripts/build-protected.js: runs audit before electron-builder', () => {
    const auditIdx   = BUILD_SCR.indexOf('audit-protected-build.js');
    const builderIdx = BUILD_SCR.indexOf('electron-builder.protected.json');
    assert.ok(auditIdx !== -1, 'build script must reference audit-protected-build.js');
    assert.ok(builderIdx !== -1, 'build script must reference electron-builder.protected.json');
    assert.ok(auditIdx < builderIdx, 'audit must run before electron-builder');
});


test('scripts/build-protected.js: rejects ASAR-relative GOG runtime metadata imports', () => {
    assert.match(BUILD_SCR, /gog-runtime/);
    assert.ok(BUILD_SCR.includes('version\\.json'), 'build guard must inspect GOG version.json imports');
    assert.match(BUILD_SCR, /GogRuntimeResolver|process\.resourcesPath|ASAR-relative GOG runtime metadata/);
});

// ── audit-protected-build.js ──────────────────────────────────────────────────

test('scripts/audit-protected-build.js file exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'audit-protected-build.js')), 'audit-protected-build.js not found');
});

test('scripts/audit-protected-build.js: exits non-zero on violations', () => {
    assert.ok(AUDIT_SCR.includes('process.exit(1)'), 'audit script must exit with code 1 on violations');
});

test('scripts/audit-protected-build.js: checks forbidden source dirs (src, handlers, services)', () => {
    assert.ok(AUDIT_SCR.includes("'src'"), "audit must check for src/");
    assert.ok(AUDIT_SCR.includes("'handlers'"), "audit must check for handlers/");
    assert.ok(AUDIT_SCR.includes("'services'"), "audit must check for services/");
});

test('scripts/audit-protected-build.js: checks for .claude directory', () => {
    assert.ok(AUDIT_SCR.includes('.claude'), 'audit script must check for .claude/');
});

test('scripts/audit-protected-build.js: checks for build/ directory', () => {
    assert.ok(AUDIT_SCR.includes("'build'"), "audit script must check for build/ directory");
});

test('scripts/audit-protected-build.js: checks for scripts/ and tests/ directories', () => {
    assert.ok(AUDIT_SCR.includes("'scripts'"), "audit script must check for scripts/");
    assert.ok(AUDIT_SCR.includes("'tests'"), "audit script must check for tests/");
});

test('scripts/audit-protected-build.js: checks for *.spec files', () => {
    assert.ok(AUDIT_SCR.includes('.spec'), 'audit script must check for *.spec files');
});

test('scripts/audit-protected-build.js: checks for .map files', () => {
    assert.ok(AUDIT_SCR.includes('.map'), 'audit script must check for .map files');
});

test('scripts/audit-protected-build.js: checks for sourceMappingURL', () => {
    assert.ok(AUDIT_SCR.includes('sourceMappingURL'), 'audit script must check for sourceMappingURL');
});

test('scripts/audit-protected-build.js: checks for .md files', () => {
    assert.ok(AUDIT_SCR.includes('.md'), 'audit script must check for .md files');
});

test('scripts/audit-protected-build.js: checks for *.test.js files', () => {
    assert.ok(AUDIT_SCR.includes('.test.js'), 'audit script must check for *.test.js files');
});

test('scripts/audit-protected-build.js: checks for repomix output', () => {
    assert.ok(AUDIT_SCR.includes('repomix'), 'audit script must check for repomix files');
});

test('scripts/audit-protected-build.js: checks for electron-builder config files', () => {
    assert.ok(AUDIT_SCR.includes('electron-builder'), 'audit script must check for electron-builder config files');
});

test('scripts/audit-protected-build.js: checks for skills-lock.json', () => {
    assert.ok(AUDIT_SCR.includes('skills-lock.json'), 'audit script must check for skills-lock.json');
});

test('scripts/audit-protected-build.js: requires main.bundle.cjs to be present', () => {
    assert.ok(AUDIT_SCR.includes('main.bundle.cjs'), 'audit must require main.bundle.cjs');
});

test('scripts/audit-protected-build.js: requires quick-switcher.html to be present', () => {
    assert.ok(AUDIT_SCR.includes('quick-switcher.html'), 'audit must require quick-switcher.html');
});

test('scripts/audit-protected-build.js: requires preload.bundle.cjs to be present', () => {
    assert.ok(AUDIT_SCR.includes('preload.bundle.cjs'), 'audit must require preload.bundle.cjs');
});

test('scripts/audit-protected-build.js: requires renderer.bundle.js to be present', () => {
    assert.ok(AUDIT_SCR.includes('renderer.bundle.js'), 'audit must require renderer.bundle.js');
});

test('scripts/audit-protected-build.js: requires index.html to be present', () => {
    assert.ok(AUDIT_SCR.includes('index.html'), 'audit must require index.html');
});

test('scripts/audit-protected-build.js: checks bundle files are obfuscated', () => {
    assert.ok(AUDIT_SCR.includes('_0x'), 'audit must check for obfuscated _0x identifiers');
    assert.ok(AUDIT_SCR.includes('main.bundle.cjs'), 'audit must check main.bundle.cjs obfuscation');
});

test('scripts/audit-protected-build.js: checks package.json main field', () => {
    assert.ok(AUDIT_SCR.includes('main.bundle.cjs'), 'audit must verify package.json main → main.bundle.cjs');
});

test('scripts/audit-protected-build.js: checks required runtime modules are present', () => {
    assert.ok(AUDIT_SCR.includes('axios'), 'audit must check for axios');
    assert.ok(AUDIT_SCR.includes('electron-updater'), 'audit must check for electron-updater');
    assert.ok(AUDIT_SCR.includes('ps-list'), 'audit must check for ps-list');
    assert.ok(AUDIT_SCR.includes('node_modules'), 'audit must check inside node_modules');
});

test('electron-builder.protected.json file exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'electron-builder.protected.json')), 'electron-builder.protected.json not found');
});

// ── src/dashboard.html structural integrity ───────────────────────────────────

const DASHBOARD_HTML = fs.readFileSync(path.join(ROOT, 'src', 'dashboard.html'), 'utf8');

test('src/dashboard.html: contains a closing </head> tag', () => {
    assert.ok(DASHBOARD_HTML.includes('</head>'), 'dashboard.html must have a closing </head> tag');
});

test('src/dashboard.html: </head> appears before <body>', () => {
    const headCloseIdx = DASHBOARD_HTML.indexOf('</head>');
    const bodyIdx      = DASHBOARD_HTML.search(/<body[\s>]/i);
    assert.ok(headCloseIdx !== -1, 'dashboard.html must have </head>');
    assert.ok(bodyIdx      !== -1, 'dashboard.html must have <body>');
    assert.ok(headCloseIdx < bodyIdx, '</head> must appear before <body> in dashboard.html');
});

test('src/dashboard.html: does not jump from <title> directly to <body> without </head>', () => {
    const titleEnd = DASHBOARD_HTML.indexOf('</title>');
    const bodyIdx  = DASHBOARD_HTML.search(/<body[\s>]/i);
    assert.ok(titleEnd !== -1, 'dashboard.html must have </title>');
    assert.ok(bodyIdx  !== -1, 'dashboard.html must have <body>');
    const between = DASHBOARD_HTML.slice(titleEnd, bodyIdx);
    assert.ok(between.includes('</head>'), '</head> must appear between </title> and <body>');
});

// ── build-protected.js: defensive HTML injection ──────────────────────────────

test('scripts/build-protected.js: buildProductionHTML falls back to <body> if </head> is missing', () => {
    assert.ok(BUILD_SCR.includes('<body'), 'buildProductionHTML must have a <body> fallback for CSS injection');
});

test('scripts/build-protected.js: buildProductionHTML hard-fails if neither </head> nor <body> is found', () => {
    assert.ok(BUILD_SCR.includes('no </head> or <body>'), 'buildProductionHTML must fail clearly when HTML structure is missing');
});

test('scripts/build-protected.js: buildProductionHTML asserts CSS bundle reference in output', () => {
    assert.ok(BUILD_SCR.includes('href="${cssBundleFile}"') || BUILD_SCR.includes("CSS bundle reference missing"),
        'buildProductionHTML must verify the CSS bundle link landed in the output');
});

test('scripts/build-protected.js: buildProductionHTML asserts JS bundle reference in output', () => {
    assert.ok(BUILD_SCR.includes('src="${jsBundleFile}"') || BUILD_SCR.includes("JS bundle reference missing"),
        'buildProductionHTML must verify the JS bundle script tag landed in the output');
});

// ── Protected index.html references runtime bundles (requires prior build) ────

const PROTECTED_INDEX = path.join(ROOT, '.protected-build', 'app', 'index.html');
const PROTECTED_QS    = path.join(ROOT, '.protected-build', 'app', 'quick-switcher.html');

test('protected index.html: references renderer.bundle.css (requires prior build:protected)', {
    skip: !fs.existsSync(PROTECTED_INDEX),
}, () => {
    const html = fs.readFileSync(PROTECTED_INDEX, 'utf8');
    assert.ok(html.includes('renderer.bundle.css'), 'index.html must reference renderer.bundle.css');
});

test('protected index.html: references renderer.bundle.js (requires prior build:protected)', {
    skip: !fs.existsSync(PROTECTED_INDEX),
}, () => {
    const html = fs.readFileSync(PROTECTED_INDEX, 'utf8');
    assert.ok(html.includes('renderer.bundle.js'), 'index.html must reference renderer.bundle.js');
});

test('protected index.html: does not contain raw stylesheet links (requires prior build:protected)', {
    skip: !fs.existsSync(PROTECTED_INDEX),
}, () => {
    const html = fs.readFileSync(PROTECTED_INDEX, 'utf8');
    assert.ok(!/<link\s[^>]*rel=["']stylesheet["'][^>]*href=["']css\//i.test(html),
        'index.html must not contain original src/css/ stylesheet links');
});

test('protected quick-switcher.html: references qs.bundle.css (requires prior build:protected)', {
    skip: !fs.existsSync(PROTECTED_QS),
}, () => {
    const html = fs.readFileSync(PROTECTED_QS, 'utf8');
    assert.ok(html.includes('qs.bundle.css'), 'quick-switcher.html must reference qs.bundle.css');
});

test('protected quick-switcher.html: references qs.bundle.js (requires prior build:protected)', {
    skip: !fs.existsSync(PROTECTED_QS),
}, () => {
    const html = fs.readFileSync(PROTECTED_QS, 'utf8');
    assert.ok(html.includes('qs.bundle.js'), 'quick-switcher.html must reference qs.bundle.js');
});

// ── audit-protected-build.js: HTML bundle reference checks ───────────────────

test('scripts/audit-protected-build.js: checks index.html references renderer.bundle.css', () => {
    assert.ok(AUDIT_SCR.includes('renderer.bundle.css'), 'audit must check index.html references renderer.bundle.css');
});

test('scripts/audit-protected-build.js: checks index.html references renderer.bundle.js', () => {
    assert.ok(AUDIT_SCR.includes('renderer.bundle.js'), 'audit must check index.html references renderer.bundle.js');
});

test('scripts/audit-protected-build.js: checks quick-switcher.html references qs.bundle.css', () => {
    assert.ok(AUDIT_SCR.includes('qs.bundle.css'), 'audit must check quick-switcher.html references qs.bundle.css');
});

test('scripts/audit-protected-build.js: checks quick-switcher.html references qs.bundle.js', () => {
    assert.ok(AUDIT_SCR.includes('qs.bundle.js'), 'audit must check quick-switcher.html references qs.bundle.js');
});
