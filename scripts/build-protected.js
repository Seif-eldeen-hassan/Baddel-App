#!/usr/bin/env node
/**
 * build-protected.js
 *
 * Builds a hardened production release using esbuild bundling followed by
 * javascript-obfuscator obfuscation.  The output directory contains only
 * a handful of bundled runtime files — no source folder structure is exposed.
 *
 * Output layout (.protected-build/app/):
 *   main.bundle.cjs      Electron main-process bundle (obfuscated)
 *   preload.bundle.cjs   Electron preload bundle (obfuscated)
 *   index.html           Production HTML for the main window
 *   renderer.bundle.js   All main-window renderer JS (obfuscated)
 *   renderer.bundle.css  All main-window CSS (font paths fixed)
 *   quick-switcher.html  Production HTML for the quick-switcher overlay
 *   qs.bundle.js         Quick-switcher renderer JS (obfuscated)
 *   qs.bundle.css        Quick-switcher CSS
 *   Logo.ico             App icon
 *   assets/              Runtime images and fonts
 *   bin/                 legendary.exe (Epic Games support)
 *   package.json         Minimal runtime package.json (main → main.bundle.cjs)
 *   node_modules/        Junction to project node_modules
 *
 * Usage:
 *   node scripts/build-protected.js
 *   npm run dist:protected
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT    = path.resolve(__dirname, '..');
const DEST    = path.join(ROOT, '.protected-build', 'app');
const NM_LINK = path.join(DEST, 'node_modules');
const NM_SRC  = path.join(ROOT, 'node_modules');

// ── Obfuscator options ────────────────────────────────────────────────────────

const OBFUSCATOR_NODE = {
    compact:                          true,
    simplify:                         true,
    stringArray:                      true,
    stringArrayRotate:                true,
    stringArrayShuffle:               true,
    stringArrayEncoding:              ['base64'],
    stringArrayThreshold:             0.75,
    controlFlowFlattening:            true,
    controlFlowFlatteningThreshold:   0.4,
    deadCodeInjection:                true,
    deadCodeInjectionThreshold:       0.2,
    renameGlobals:                    false,
    renameProperties:                 false,
    transformObjectKeys:              false,
    disableConsoleOutput:             false,
    sourceMap:                        false,
    debugProtection:                  false,
    selfDefending:                    false,
    target:                           'node',
};

// Lighter settings for renderer — controlFlowFlattening is disabled to keep the
// bundle manageable, and renameGlobals stays false so top-level function names
// referenced by onclick handlers in the HTML are preserved.
const OBFUSCATOR_BROWSER = {
    compact:                          true,
    simplify:                         true,
    stringArray:                      true,
    stringArrayRotate:                true,
    stringArrayShuffle:               true,
    stringArrayEncoding:              ['base64'],
    stringArrayThreshold:             0.75,
    controlFlowFlattening:            false,
    deadCodeInjection:                false,
    renameGlobals:                    false,
    renameProperties:                 false,
    transformObjectKeys:              false,
    disableConsoleOutput:             false,
    sourceMap:                        false,
    debugProtection:                  false,
    selfDefending:                    false,
    target:                           'browser',
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function rimraf(dir) {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
    ensureDir(dest);
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name);
        const d = path.join(dest, e.name);
        if (e.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function readText(p)       { return fs.readFileSync(p, 'utf8'); }
function writeText(p, txt) { ensureDir(path.dirname(p)); fs.writeFileSync(p, txt, 'utf8'); }

// ── package.json ──────────────────────────────────────────────────────────────

function writeProtectedPackageJson() {
    const src = JSON.parse(readText(path.join(ROOT, 'package.json')));
    writeText(path.join(DEST, 'package.json'), JSON.stringify({
        name:         src.name,
        version:      src.version,
        description:  src.description,
        main:         'main.bundle.cjs',
        author:       src.author,
        dependencies: src.dependencies || {},
    }, null, 2));
}

// ── node_modules junction ─────────────────────────────────────────────────────

function linkNodeModules() {
    if (fs.existsSync(NM_LINK)) return;
    fs.symlinkSync(NM_SRC, NM_LINK, process.platform === 'win32' ? 'junction' : 'dir');
    console.log('  Linked node_modules via junction.');
}

// ── Main-process bundle path patching ─────────────────────────────────────────
//
// After esbuild bundles all first-party modules into a single CJS file,
// __dirname refers to the bundle's location (the app root).  Any code that
// originally used __dirname relative to a subdirectory (e.g. services/) must
// be updated.  esbuild normalises string literals to double quotes.

function patchMainBundle(content) {
    // dashboard.html moved to index.html at app root
    content = content.replace(
        /path\.join\(__dirname,\s*"src",\s*"dashboard\.html"\)/g,
        'path.join(__dirname, "index.html")'
    );
    // Main window preload (main.js line)
    content = content.replace(
        /path\.join\(__dirname,\s*"preload\.js"\)/g,
        'path.join(__dirname, "preload.bundle.cjs")'
    );
    // Quick-switcher preload (services/quickSwitcher.js — used ..)
    content = content.replace(
        /path\.join\(__dirname,\s*"\.\.",\s*"preload\.js"\)/g,
        'path.join(__dirname, "preload.bundle.cjs")'
    );
    // Quick-switcher HTML (services/quickSwitcher.js — used ../ + src/)
    content = content.replace(
        /path\.join\(__dirname,\s*"\.\.",\s*"src",\s*"quick-switcher\.html"\)/g,
        'path.join(__dirname, "quick-switcher.html")'
    );
    return content;
}

function _normalizeMetafilePath(inputPath) {
    return String(inputPath || '').replace(/\\/g, '/');
}

function _metafileHasInput(metafile, suffix) {
    const normalizedSuffix = suffix.replace(/\\/g, '/');
    return Object.keys(metafile?.inputs || {}).some((inputPath) =>
        _normalizeMetafilePath(inputPath).endsWith(normalizedSuffix)
    );
}

function assertMainBundlePlatformSyncResolution(buildResult, bundleContent) {
    const requiredInputs = [
        'src/features/sync/infrastructure/composition/SyncContainer.js',
        'platformSync.js',
    ];

    for (const input of requiredInputs) {
        if (!_metafileHasInput(buildResult?.metafile, input)) {
            console.error(`\n[Fatal] Protected main bundle is missing ${input} from the esbuild dependency graph.`);
            console.error('        SyncContainer must use a static literal require so platformSync.js is bundled.');
            process.exit(1);
        }
    }

    if (/require\(["'][^"']*platformSync(?:\.js)?["']\)/.test(bundleContent)) {
        console.error('\n[Fatal] Protected main bundle still contains an unresolved platformSync require.');
        console.error('        SyncContainer must use require("../../../../../platformSync") inside loadDefaultPlatformSyncApi().');
        process.exit(1);
    }
}

// ── CSS bundling ──────────────────────────────────────────────────────────────
//
// fonts.css uses url('../../assets/fonts/...') relative to src/css/.
// At the bundle root, the correct path is url('assets/fonts/...').

function patchedFontsCSS() {
    const raw = readText(path.join(ROOT, 'src', 'css', 'fonts.css'));
    return raw.replace(/url\((['"]?)\.\.\/\.\.\/assets\//g, 'url($1assets/');
}

function stripFontsImport(css) {
    return css.replace(/@import\s+url\(['"]?\.\/fonts\.css['"]?\)\s*;?/g, '');
}

function buildCSSBundle(cssFiles, dest) {
    const parts = [patchedFontsCSS()];
    for (const f of cssFiles) {
        let css = readText(f);
        css = stripFontsImport(css);
        parts.push(css);
    }
    writeText(dest, parts.join('\n'));
}

// ── Renderer JS concatenation ─────────────────────────────────────────────────
//
// Renderer scripts are non-modular browser globals — they define functions at
// the top level that are called from onclick handlers baked into the HTML.
// We concatenate them in load order.  After concatenation we fix relative paths
// that assumed the HTML was in src/ rather than at the app root.

function patchRendererPaths(content) {
    // image paths: ../assets/ → assets/
    content = content.replace(/'\.\.\/assets\//g, "'assets/");
    content = content.replace(/"\.\.\/assets\//g, '"assets/');
    // Dynamic library loader paths: ../node_modules/ → node_modules/
    content = content.replace(/'\.\.\/node_modules\//g, "'node_modules/");
    content = content.replace(/"\.\.\/node_modules\//g, '"node_modules/');
    return content;
}

function buildRendererBundle(scriptFiles, dest) {
    const parts = [];
    for (const f of scriptFiles) {
        if (!fs.existsSync(f)) {
            console.log(`  [skip] ${path.relative(ROOT, f)}`);
            continue;
        }
        parts.push(readText(f));
    }
    const raw = parts.join('\n;\n');
    writeText(dest, patchRendererPaths(raw));
}

// ── HTML production patching ──────────────────────────────────────────────────

function buildProductionHTML(srcHtml, cssBundleFile, jsBundleFile, dest) {
    let html = readText(srcHtml);
    // Fix image paths that went up from src/ to the root assets/
    html = html.replace(/\.\.\/assets\//g, 'assets/');
    // Remove all existing stylesheet links and external script tags
    html = html.replace(/<link\s[^>]*rel=["']stylesheet["'][^>]*>\s*/gi, '');
    html = html.replace(/<script\s+src=["'][^"']*["'][^>]*><\/script>\s*/gi, '');

    // Inject CSS bundle — prefer </head>, fall back to before <body>, hard-fail if neither.
    const cssTag = `    <link rel="stylesheet" href="${cssBundleFile}">\n`;
    if (html.includes('</head>')) {
        html = html.replace('</head>', `${cssTag}</head>`);
    } else if (/<body[\s>]/i.test(html)) {
        html = html.replace(/<body([\s>])/i, `${cssTag}<body$1`);
    } else {
        console.error(`\n[Fatal] buildProductionHTML: no </head> or <body> found in ${srcHtml}`);
        process.exit(1);
    }

    // Inject JS bundle — prefer </body>, fall back to appending at end of file.
    const jsTag = `    <script src="${jsBundleFile}"></script>\n`;
    if (html.includes('</body>')) {
        html = html.replace('</body>', `${jsTag}</body>`);
    } else {
        html = html.trimEnd() + `\n${jsTag}`;
    }

    writeText(dest, html);

    // Assert both bundle references landed in the output.
    const written = readText(dest);
    if (!written.includes(`href="${cssBundleFile}"`)) {
        console.error(`\n[Fatal] buildProductionHTML: CSS bundle reference missing from ${dest}`);
        process.exit(1);
    }
    if (!written.includes(`src="${jsBundleFile}"`)) {
        console.error(`\n[Fatal] buildProductionHTML: JS bundle reference missing from ${dest}`);
        process.exit(1);
    }
}

// ── Obfuscation ───────────────────────────────────────────────────────────────

function obfuscateFile(filePath, options, JavaScriptObfuscator) {
    const src    = readText(filePath);
    const result = JavaScriptObfuscator.obfuscate(src, options);
    writeText(filePath, result.getObfuscatedCode());
}

// ── .map file removal ─────────────────────────────────────────────────────────

function removeMapFiles(dir) {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { n += removeMapFiles(p); continue; }
        if (e.name.endsWith('.map')) { fs.unlinkSync(p); n++; }
    }
    return n;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    let JavaScriptObfuscator;
    try {
        JavaScriptObfuscator = require('javascript-obfuscator');
    } catch {
        console.error('\n[Error] javascript-obfuscator is not installed. Run: npm install --save-dev javascript-obfuscator\n');
        process.exit(1);
    }

    let esbuild;
    try {
        esbuild = require('esbuild');
    } catch {
        console.error('\n[Error] esbuild is not installed. Run: npm install --save-dev esbuild\n');
        process.exit(1);
    }

    console.log('\n=== Baddel Protected Build ===\n');

    // 1 – Clean
    console.log('1. Cleaning .protected-build/app/ ...');
    rimraf(DEST);
    ensureDir(DEST);

    // 2 – Static runtime assets
    console.log('2. Copying runtime assets ...');
    copyDir(path.join(ROOT, 'assets'), path.join(DEST, 'assets'));
    copyDir(path.join(ROOT, 'bin'),    path.join(DEST, 'bin'));
    fs.copyFileSync(path.join(ROOT, 'Logo.ico'), path.join(DEST, 'Logo.ico'));

    // 3 – Main-process bundle
    console.log('3. Bundling main process (esbuild) ...');
    const mainBuildResult = await esbuild.build({
        entryPoints: [path.join(ROOT, 'main.js')],
        bundle:      true,
        platform:    'node',
        format:      'cjs',
        packages:    'external',      // keep everything in node_modules as require()
        sourcemap:   false,
        metafile:    true,
        supported:   { 'dynamic-import': true },  // preserve await import('ps-list') in CJS
        outfile:     path.join(DEST, 'main.bundle.cjs'),
        logLevel:    'warning',
    });

    // 4 – Patch __dirname path strings
    console.log('4. Patching path references in main.bundle.cjs ...');
    const mainRaw     = readText(path.join(DEST, 'main.bundle.cjs'));
    const mainPatched = patchMainBundle(mainRaw);
    if (mainRaw === mainPatched) {
        console.warn('  [WARN] patchMainBundle made no replacements — bundle may not load correctly.');
    }
    writeText(path.join(DEST, 'main.bundle.cjs'), mainPatched);
    assertMainBundlePlatformSyncResolution(mainBuildResult, mainPatched);

    // 5 – Preload bundle
    console.log('5. Bundling preload (esbuild) ...');
    await esbuild.build({
        entryPoints: [path.join(ROOT, 'preload.js')],
        bundle:      true,
        platform:    'node',
        format:      'cjs',
        packages:    'external',
        sourcemap:   false,
        outfile:     path.join(DEST, 'preload.bundle.cjs'),
        logLevel:    'warning',
    });

    // 6 – Renderer JS bundle (main window)
    console.log('6. Bundling renderer JS ...');
    const S  = (rel) => path.join(ROOT, rel);
    const NM = (rel) => path.join(ROOT, 'node_modules', rel);
    buildRendererBundle([
        NM('sortablejs/Sortable.min.js'),
        S('src/js/domUtils.js'),
        S('src/js/analyticsConsent.js'),
        NM('driver.js/dist/driver.js.iife.js'),
        // tour.js does not exist — omitted
        S('src/js/platformResolver.js'),
        S('src/js/platformOwnership.js'),
        S('src/js/app/playtime.js'),
        S('src/js/app/help-feedback.js'),
        S('src/js/app/account-shortcuts.js'),
        S('src/features/games/domain/services/ArtworkOwnershipPolicy.js'),
        S('src/features/games/application/services/GameArtworkResolver.js'),
        S('src/features/games/application/services/AllGamesArtworkAdapter.js'),
        S('src/features/games/application/services/GameDetailsArtworkAdapter.js'),
        S('src/features/games/application/services/PlayLauncherArtworkAdapter.js'),
        S('src/features/games/application/services/GameSurfaceArtworkAdapter.js'),
        S('src/js/app/artwork-sync.js'),
        S('src/js/app/toast-confirm.js'),
        S('src/js/app/launcher-actions.js'),
        S('src/js/app/hero.js'),
        S('src/js/app/system-stats.js'),
        S('src/js/app/settings-quick-switcher.js'),
        S('src/js/app/sidebar.js'),
        S('src/js/app/collections.js'),
        S('src/js/app/game-context-actions.js'),
        S('src/js/app/suggestions.js'),
        S('src/js/app/roulette.js'),
        S('src/js/app/game-card.js'),
        S('src/js/app.js'),
        S('src/js/accounts/display-prefs.js'),
        S('src/js/accounts/platform-panels.js'),
        S('src/js/accounts.js'),
        S('src/js/addAccountModal.js'),
        S('src/js/addGameModal.js'),
        S('src/js/game-details.js'),
        S('src/js/play-launcher.js'),
    ], path.join(DEST, 'renderer.bundle.js'));

    // 7 – Renderer CSS bundle
    console.log('7. Bundling renderer CSS ...');
    buildCSSBundle([
        S('src/css/dashboard.css'),
        S('src/css/accounts.css'),
        S('src/css/addAccountModal.css'),
        S('src/css/addGameModal.css'),
        S('src/css/game-details.css'),
        S('src/css/play-launcher.css'),
        NM('driver.js/dist/driver.css'),
    ], path.join(DEST, 'renderer.bundle.css'));

    // 8 – Quick-switcher JS bundle
    console.log('8. Bundling quick-switcher JS ...');
    buildRendererBundle(
        [S('src/js/quick-switcher.js')],
        path.join(DEST, 'qs.bundle.js')
    );

    // 9 – Quick-switcher CSS bundle
    console.log('9. Bundling quick-switcher CSS ...');
    buildCSSBundle(
        [S('src/css/quick-switcher.css')],
        path.join(DEST, 'qs.bundle.css')
    );

    // 10 – Production HTML
    console.log('10. Building production HTML ...');
    buildProductionHTML(
        S('src/dashboard.html'),
        'renderer.bundle.css',
        'renderer.bundle.js',
        path.join(DEST, 'index.html')
    );
    buildProductionHTML(
        S('src/quick-switcher.html'),
        'qs.bundle.css',
        'qs.bundle.js',
        path.join(DEST, 'quick-switcher.html')
    );

    // 11 – package.json + node_modules
    console.log('11. Writing package.json and linking node_modules ...');
    writeProtectedPackageJson();
    linkNodeModules();

    // 12 – Obfuscate
    console.log('12. Obfuscating JS bundles ...');
    const nodeTargets = [
        path.join(DEST, 'main.bundle.cjs'),
        path.join(DEST, 'preload.bundle.cjs'),
    ];
    const browserTargets = [
        path.join(DEST, 'renderer.bundle.js'),
        path.join(DEST, 'qs.bundle.js'),
    ];
    for (const f of nodeTargets) {
        try {
            obfuscateFile(f, OBFUSCATOR_NODE, JavaScriptObfuscator);
            console.log(`  OK: ${path.basename(f)}`);
        } catch (err) {
            console.error(`\n[Fatal] Obfuscation failed for ${path.basename(f)}: ${err.message}`);
            process.exit(1);
        }
    }
    for (const f of browserTargets) {
        try {
            obfuscateFile(f, OBFUSCATOR_BROWSER, JavaScriptObfuscator);
            console.log(`  OK: ${path.basename(f)}`);
        } catch (err) {
            console.error(`\n[Fatal] Obfuscation failed for ${path.basename(f)}: ${err.message}`);
            process.exit(1);
        }
    }

    // 13 – Remove any stray .map files
    const mapCount = removeMapFiles(DEST);
    if (mapCount > 0) console.log(`\n  Removed ${mapCount} stray .map file(s).`);

    // 14 – Pre-package audit
    console.log('\n13. Running pre-package audit ...\n');
    const auditResult = cp.spawnSync('node', [path.join(ROOT, 'scripts', 'audit-protected-build.js')], {
        cwd: ROOT, stdio: 'inherit',
    });
    if (auditResult.status !== 0) {
        console.error('\n[Fatal] Pre-package audit failed — protected build aborted.');
        process.exit(auditResult.status ?? 1);
    }

    // 15 – electron-builder
    console.log('\n14. Running electron-builder (protected config) ...\n');
    const builderResult = cp.spawnSync(
        'npx', ['electron-builder', '--config', path.join(ROOT, 'electron-builder.protected.json')],
        { cwd: ROOT, stdio: 'inherit', shell: true }
    );
    if (builderResult.status !== 0) {
        console.error('\n[Error] electron-builder failed.');
        process.exit(builderResult.status ?? 1);
    }

    console.log('\n=== Protected build complete ===\n');
}

main().catch(err => {
    console.error('[Fatal]', err);
    process.exit(1);
});
