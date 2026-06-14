#!/usr/bin/env node
/**
 * audit-protected-build.js
 *
 * Scans the .protected-build/app/ directory for signs of incomplete protection
 * and exits with a non-zero status if any violations are found.
 *
 * Run: node scripts/audit-protected-build.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, '.protected-build', 'app');

let violations = 0;

function fail(msg) {
    console.error('  [FAIL]', msg);
    violations++;
}

function pass(msg) {
    console.log('  [OK]  ', msg);
}

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        // Skip node_modules and junctions to avoid infinite loops
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(full, callback);
        } else {
            callback(full, entry.name);
        }
    }
}

console.log('\n=== Baddel Protected Build Audit ===\n');
console.log('Target:', DEST, '\n');

if (!fs.existsSync(DEST)) {
    console.error('[FAIL] Protected build directory not found. Run: npm run build:protected first.');
    process.exit(1);
}

// ── Check: no .map files ──────────────────────────────────────────────────────
let mapFiles = [];
walkDir(DEST, (filePath, name) => {
    if (name.endsWith('.map')) mapFiles.push(path.relative(DEST, filePath));
});
if (mapFiles.length > 0) {
    fail(`.map files found:\n    ${mapFiles.join('\n    ')}`);
} else {
    pass('No .map files present.');
}

// ── Check: no sourceMappingURL comments ───────────────────────────────────────
let mapUrlFiles = [];
walkDir(DEST, (filePath, name) => {
    const ext = path.extname(name);
    if (!['.js', '.css', '.html'].includes(ext)) return;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('sourceMappingURL=')) {
            mapUrlFiles.push(path.relative(DEST, filePath));
        }
    } catch {}
});
if (mapUrlFiles.length > 0) {
    fail(`sourceMappingURL found in:\n    ${mapUrlFiles.join('\n    ')}`);
} else {
    pass('No sourceMappingURL references found.');
}

// ── Check: no tests/ directory ────────────────────────────────────────────────
const testsDir = path.join(DEST, 'tests');
if (fs.existsSync(testsDir)) {
    fail('tests/ directory is present in the protected build.');
} else {
    pass('tests/ directory not present.');
}

// ── Check: no docs/ directory ─────────────────────────────────────────────────
const docsDir = path.join(DEST, 'docs');
if (fs.existsSync(docsDir)) {
    fail('docs/ directory is present in the protected build.');
} else {
    pass('docs/ directory not present.');
}

// ── Check: no .md files ───────────────────────────────────────────────────────
let mdFiles = [];
walkDir(DEST, (filePath, name) => {
    if (name.endsWith('.md')) mdFiles.push(path.relative(DEST, filePath));
});
if (mdFiles.length > 0) {
    fail(`.md files found:\n    ${mdFiles.join('\n    ')}`);
} else {
    pass('No .md files present.');
}

// ── Check: no repomix output files ────────────────────────────────────────────
let repomixFiles = [];
walkDir(DEST, (filePath, name) => {
    if (name === 'repomix-output.xml' || name.startsWith('repomix-output')) {
        repomixFiles.push(path.relative(DEST, filePath));
    }
});
if (repomixFiles.length > 0) {
    fail(`repomix output files found:\n    ${repomixFiles.join('\n    ')}`);
} else {
    pass('No repomix output files present.');
}

// ── Check: no .log files ──────────────────────────────────────────────────────
let logFiles = [];
walkDir(DEST, (filePath, name) => {
    if (name.endsWith('.log')) logFiles.push(path.relative(DEST, filePath));
});
if (logFiles.length > 0) {
    fail(`.log files found:\n    ${logFiles.join('\n    ')}`);
} else {
    pass('No .log files present.');
}

// ── Check: no scripts/ directory ─────────────────────────────────────────────
const scriptsDir = path.join(DEST, 'scripts');
if (fs.existsSync(scriptsDir)) {
    fail('scripts/ directory is present in the protected build.');
} else {
    pass('scripts/ directory not present.');
}

// ── Check: no *.test.js files ─────────────────────────────────────────────────
let testJsFiles = [];
walkDir(DEST, (filePath, name) => {
    if (name.endsWith('.test.js')) testJsFiles.push(path.relative(DEST, filePath));
});
if (testJsFiles.length > 0) {
    fail(`*.test.js files found:\n    ${testJsFiles.join('\n    ')}`);
} else {
    pass('No *.test.js files present.');
}

// ── Check: no electron-builder config files ───────────────────────────────────
let ebConfigFiles = [];
walkDir(DEST, (filePath, name) => {
    if (/^electron-builder.*\.json$/.test(name)) ebConfigFiles.push(path.relative(DEST, filePath));
});
if (ebConfigFiles.length > 0) {
    fail(`electron-builder config files found:\n    ${ebConfigFiles.join('\n    ')}`);
} else {
    pass('No electron-builder config files present.');
}

// ── Check: skills-lock.json not present ──────────────────────────────────────
const skillsLockPath = path.join(DEST, 'skills-lock.json');
if (fs.existsSync(skillsLockPath)) {
    fail('skills-lock.json is present in the protected build.');
} else {
    pass('skills-lock.json not present.');
}

// ── Check: no dev-only file patterns ─────────────────────────────────────────
const DEV_ONLY_NAMES = new Set([
    '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.prettierrc',
    '.editorconfig', 'jest.config.js', 'webpack.config.js',
    '.env', '.env.local', '.env.development',
    'tsconfig.json', 'babel.config.js',
]);
let devFiles = [];
walkDir(DEST, (filePath, name) => {
    if (DEV_ONLY_NAMES.has(name)) devFiles.push(path.relative(DEST, filePath));
});
if (devFiles.length > 0) {
    fail(`Dev-only files found:\n    ${devFiles.join('\n    ')}`);
} else {
    pass('No dev-only config files present.');
}

// ── Check: first-party JS files appear obfuscated ───────────────────────────
// Obfuscated JS always contains _0x-prefixed hex identifiers from the string array.
const OBFUSCATION_CHECK_FILES = [
    'main.js',
    'preload.js',
    'accountsHandler.js',
    'platformSync.js',
    'steamBridge.js',
];
for (const fname of OBFUSCATION_CHECK_FILES) {
    const fpath = path.join(DEST, fname);
    if (fs.existsSync(fpath)) {
        const content = fs.readFileSync(fpath, 'utf8');
        const looksObfuscated = /\b_0x[0-9a-f]{4,}\b/.test(content);
        if (!looksObfuscated) {
            fail(`${fname} does not appear to be obfuscated (no _0x identifiers found).`);
        } else {
            pass(`${fname} appears obfuscated (_0x identifiers present).`);
        }
    } else {
        fail(`${fname} not found in protected build.`);
    }
}

// ── Check: required runtime modules present ───────────────────────────────────
const REQUIRED_MODULES = [
    'axios', 'electron-updater', 'electron-store', 'sharp',
    'keytar', 'ps-list', 'systeminformation', 'hls.js', 'dashjs',
];
const nmDir = path.join(DEST, 'node_modules');
if (!fs.existsSync(nmDir)) {
    fail('node_modules directory/junction not found in protected build.');
} else {
    for (const mod of REQUIRED_MODULES) {
        const modPath = path.join(nmDir, mod);
        if (!fs.existsSync(modPath)) {
            fail(`Required runtime module missing: node_modules/${mod}`);
        } else {
            pass(`Runtime module present: ${mod}`);
        }
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
if (violations > 0) {
    console.error(`=== Audit FAILED: ${violations} violation(s) found. ===\n`);
    process.exit(1);
} else {
    console.log('=== Audit PASSED: Protected build is clean. ===\n');
}
