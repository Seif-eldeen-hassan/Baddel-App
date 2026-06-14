#!/usr/bin/env node
/**
 * build-protected.js
 *
 * Builds a hardened production release:
 *   1. Copies runtime source files to .protected-build/app/  (excludes tests, docs, dev files)
 *   2. Obfuscates all JavaScript files using javascript-obfuscator
 *   3. Strips sourceMappingURL comments from JS, HTML, and CSS
 *   4. Writes a minimal package.json (runtime deps only, no scripts)
 *   5. Creates a directory junction from .protected-build/app/node_modules -> project node_modules
 *   6. Runs electron-builder against the protected directory
 *
 * Usage:
 *   node scripts/build-protected.js
 *   or via: npm run dist:protected
 */

'use strict';

const path  = require('path');
const fs    = require('fs');
const cp    = require('child_process');

// ── Paths ──────────────────────────────────────────────────────────────────────
const ROOT    = path.resolve(__dirname, '..');
const DEST    = path.join(ROOT, '.protected-build', 'app');
const NM_LINK = path.join(DEST, 'node_modules');
const NM_SRC  = path.join(ROOT, 'node_modules');

// ── Directories/files excluded from the protected build ────────────────────────
// Checked by exact name against each entry in the tree.
const EXCLUDE_NAMES = new Set([
    'tests', '.git', '.github', '.vscode', 'dist', '.protected-build',
    'docs', 'scripts', 'build-tmp', 'build-venv', 'baddel-steam-integration',
    'python_env', 'steam-runtime', 'node_modules',
    'repomix-output.xml', 'skills-lock.json',
]);

// Returns true if the entry should be excluded based on name patterns.
function shouldExclude(name) {
    if (EXCLUDE_NAMES.has(name)) return true;
    if (name.endsWith('.md')) return true;
    if (name.endsWith('.test.js')) return true;
    if (/^electron-builder.*\.json$/.test(name)) return true;
    if (name === '.env' || name.startsWith('.env.')) return true;
    return false;
}

// File extensions to obfuscate
const OBFUSCATE_EXTS = new Set(['.js']);

// File extensions to scan for sourceMappingURL (strip it)
const STRIP_MAP_EXTS = new Set(['.js', '.css', '.html']);

// ── javascript-obfuscator options ─────────────────────────────────────────────
// Tuned for Electron / Node.js compatibility:
//   - renameGlobals: false   → keeps require/module/exports intact
//   - renameProperties: false → keeps IPC channel names and API keys intact
//   - transformObjectKeys: false → keeps object key literals intact
//   - selfDefending: false   → can hang Node.js environments; skip
//   - debugProtection: false → not needed; devtools are blocked at the Electron level
const OBFUSCATOR_OPTIONS = {
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function rimraf(dir) {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * Recursively copy src → dest, skipping entries in EXCLUDE_NAMES.
 * Returns an array of all copied file paths (absolute, under dest).
 */
function copyTree(src, dest) {
    const copied = [];
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (shouldExclude(entry.name)) continue;
        const srcPath  = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copied.push(...copyTree(srcPath, destPath));
        } else {
            fs.copyFileSync(srcPath, destPath);
            copied.push(destPath);
        }
    }
    return copied;
}

/**
 * Strip //# sourceMappingURL=... and /*# sourceMappingURL=... from file content.
 */
function stripSourceMappingURL(content) {
    return content
        .replace(/\/\/# sourceMappingURL=\S+/g, '')
        .replace(/\/\*# sourceMappingURL=\S+\s*\*\//g, '');
}

/**
 * Obfuscate a JS file in-place using javascript-obfuscator.
 * Throws on any failure — callers must treat this as a hard build error.
 */
function obfuscateFile(filePath, JavaScriptObfuscator) {
    const src = fs.readFileSync(filePath, 'utf8');
    const stripped = stripSourceMappingURL(src);
    const result = JavaScriptObfuscator.obfuscate(stripped, OBFUSCATOR_OPTIONS);
    fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
}

/**
 * Strip sourceMappingURL from a non-JS file (HTML/CSS) in-place.
 */
function stripMapFile(filePath) {
    const src = fs.readFileSync(filePath, 'utf8');
    const stripped = stripSourceMappingURL(src);
    if (stripped !== src) fs.writeFileSync(filePath, stripped, 'utf8');
}

/**
 * Write a minimal package.json to the protected app directory.
 * Only includes fields electron-builder and the Electron runtime need.
 */
function writeProtectedPackageJson() {
    const original = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const minimal  = {
        name:         original.name,
        version:      original.version,
        description:  original.description,
        main:         original.main,
        author:       original.author,
        dependencies: original.dependencies || {},
    };
    fs.writeFileSync(
        path.join(DEST, 'package.json'),
        JSON.stringify(minimal, null, 2),
        'utf8'
    );
}

/**
 * Create a directory junction (Windows) or symlink (Unix) so the protected
 * build can resolve node_modules without duplicating ~300 MB of packages.
 */
function linkNodeModules() {
    if (fs.existsSync(NM_LINK)) return;
    if (process.platform === 'win32') {
        // Directory junctions do not require administrator privileges.
        fs.symlinkSync(NM_SRC, NM_LINK, 'junction');
    } else {
        fs.symlinkSync(NM_SRC, NM_LINK, 'dir');
    }
    console.log('  Linked node_modules via junction.');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
    // Require obfuscator here so a missing devDependency gives a clear message.
    let JavaScriptObfuscator;
    try {
        JavaScriptObfuscator = require('javascript-obfuscator');
    } catch {
        console.error('\n[Error] javascript-obfuscator is not installed.');
        console.error('Run: npm install --save-dev javascript-obfuscator\n');
        process.exit(1);
    }

    console.log('\n=== Baddel Protected Build ===\n');

    // Step 1 – Clean and copy source tree
    console.log('1. Cleaning .protected-build/app/ ...');
    rimraf(DEST);
    ensureDir(DEST);

    console.log('2. Copying source tree (excluding dev-only paths) ...');
    const allFiles = copyTree(ROOT, DEST);
    console.log(`   Copied ${allFiles.length} files.`);

    // Step 2 – Write minimal package.json (overwrites any copied version)
    console.log('3. Writing minimal package.json ...');
    writeProtectedPackageJson();

    // Step 3 – Link node_modules
    console.log('4. Linking node_modules ...');
    linkNodeModules();

    // Step 4 – Obfuscate JS files and strip sourceMappingURL
    const jsFiles   = allFiles.filter(f => OBFUSCATE_EXTS.has(path.extname(f)));
    const nonJsFiles = allFiles.filter(f => {
        const ext = path.extname(f);
        return STRIP_MAP_EXTS.has(ext) && !OBFUSCATE_EXTS.has(ext);
    });

    console.log(`5. Obfuscating ${jsFiles.length} JavaScript files ...`);
    let obfOk = 0;
    for (const f of jsFiles) {
        try {
            obfuscateFile(f, JavaScriptObfuscator);
            obfOk++;
        } catch (err) {
            console.error(`\n[Fatal] Obfuscation failed for ${path.relative(DEST, f)}: ${err.message}`);
            process.exit(1);
        }
    }
    console.log(`   Obfuscated: ${obfOk} OK.`);

    console.log(`6. Stripping sourceMappingURL from ${nonJsFiles.length} HTML/CSS files ...`);
    for (const f of nonJsFiles) {
        try { stripMapFile(f); } catch {}
    }

    // Step 5 – Delete any .map files that might have been copied
    console.log('7. Removing any .map files ...');
    let mapCount = 0;
    const removeMapFiles = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) { removeMapFiles(p); continue; }
            if (entry.name.endsWith('.map')) { fs.unlinkSync(p); mapCount++; }
        }
    };
    removeMapFiles(DEST);
    console.log(`   Removed ${mapCount} .map file(s).`);

    // Step 6 – Run pre-package audit (fail-fast before invoking electron-builder)
    console.log('\n8. Running pre-package audit ...\n');
    const auditScript = path.join(ROOT, 'scripts', 'audit-protected-build.js');
    const auditResult = cp.spawnSync('node', [auditScript], { cwd: ROOT, stdio: 'inherit' });
    if (auditResult.status !== 0) {
        console.error('\n[Fatal] Pre-package audit failed — protected build aborted.');
        process.exit(auditResult.status ?? 1);
    }

    // Step 7 – Run electron-builder against the protected config
    console.log('\n9. Running electron-builder (protected config) ...\n');
    const builderConfig = path.join(ROOT, 'electron-builder.protected.json');
    const result = cp.spawnSync(
        'npx',
        ['electron-builder', '--config', builderConfig],
        {
            cwd:   ROOT,
            stdio: 'inherit',
            shell: true,
        }
    );
    if (result.status !== 0) {
        console.error('\n[Error] electron-builder failed.');
        process.exit(result.status ?? 1);
    }

    console.log('\n=== Protected build complete ===\n');
}

main().catch(err => {
    console.error('[Fatal]', err);
    process.exit(1);
});
