#!/usr/bin/env node
/**
 * audit-protected-build.js
 *
 * Verifies that .protected-build/app/ looks like a bundled production app
 * (not a source repository) and exits non-zero if any violation is found.
 *
 * Run: node scripts/audit-protected-build.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { REQUIRED_PROTECTED_FILES } = require('./protected-runtime-contract');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, '.protected-build', 'app');

let violations = 0;
function fail(msg) { console.error('  [FAIL]', msg); violations++; }
function pass(msg) { console.log('  [OK]  ', msg); }

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkDir(full, callback);
        else callback(full, e.name);
    }
}

console.log('\n=== Baddel Protected Build Audit ===\n');
console.log('Target:', DEST, '\n');

if (!fs.existsSync(DEST)) {
    console.error('[FAIL] Protected build directory not found. Run: npm run build:protected first.');
    process.exit(1);
}

// ── Source folders must NOT be present ───────────────────────────────────────

const FORBIDDEN_DIRS = ['src', 'handlers', 'services', 'scripts', 'tests', 'docs', 'build', '.claude'];
for (const d of FORBIDDEN_DIRS) {
    const p = path.join(DEST, d);
    if (fs.existsSync(p)) {
        fail(`Forbidden directory present: ${d}/`);
    } else {
        pass(`${d}/ not present.`);
    }
}

// Any other hidden dot-directories
const topEntries = fs.readdirSync(DEST, { withFileTypes: true });
const hiddenDirs = topEntries.filter(e => e.isDirectory() && e.name.startsWith('.') && e.name !== 'node_modules');
if (hiddenDirs.length > 0) {
    fail(`Hidden directories present: ${hiddenDirs.map(e => e.name).join(', ')}`);
} else {
    pass('No hidden directories present.');
}

// ── Dev-only files must NOT be present ───────────────────────────────────────

let mapFiles = [];
walkDir(DEST, (p, name) => { if (name.endsWith('.map')) mapFiles.push(path.relative(DEST, p)); });
if (mapFiles.length > 0) fail(`.map files found:\n    ${mapFiles.join('\n    ')}`);
else pass('No .map files present.');

let mapUrlFiles = [];
walkDir(DEST, (p, name) => {
    if (!['.js', '.css', '.html'].includes(path.extname(name))) return;
    try { if (fs.readFileSync(p, 'utf8').includes('sourceMappingURL=')) mapUrlFiles.push(path.relative(DEST, p)); } catch {}
});
if (mapUrlFiles.length > 0) fail(`sourceMappingURL found in:\n    ${mapUrlFiles.join('\n    ')}`);
else pass('No sourceMappingURL references found.');

let mdFiles = [];
walkDir(DEST, (p, name) => { if (name.endsWith('.md')) mdFiles.push(path.relative(DEST, p)); });
if (mdFiles.length > 0) fail(`.md files found:\n    ${mdFiles.join('\n    ')}`);
else pass('No .md files present.');

let testFiles = [];
walkDir(DEST, (p, name) => { if (name.endsWith('.test.js')) testFiles.push(path.relative(DEST, p)); });
if (testFiles.length > 0) fail(`*.test.js files found:\n    ${testFiles.join('\n    ')}`);
else pass('No *.test.js files present.');

let specFiles = [];
walkDir(DEST, (p, name) => { if (name.endsWith('.spec') || name.endsWith('.spec.js')) specFiles.push(path.relative(DEST, p)); });
if (specFiles.length > 0) fail(`*.spec files found:\n    ${specFiles.join('\n    ')}`);
else pass('No *.spec files present.');

let repomixFiles = [];
walkDir(DEST, (p, name) => { if (name.startsWith('repomix-output')) repomixFiles.push(path.relative(DEST, p)); });
if (repomixFiles.length > 0) fail(`repomix files found:\n    ${repomixFiles.join('\n    ')}`);
else pass('No repomix output files present.');

let ebCfgFiles = [];
walkDir(DEST, (p, name) => { if (/^electron-builder.*\.json$/.test(name)) ebCfgFiles.push(path.relative(DEST, p)); });
if (ebCfgFiles.length > 0) fail(`electron-builder config files found:\n    ${ebCfgFiles.join('\n    ')}`);
else pass('No electron-builder config files present.');

if (fs.existsSync(path.join(DEST, 'skills-lock.json'))) fail('skills-lock.json present.');
else pass('skills-lock.json not present.');

let logFiles = [];
walkDir(DEST, (p, name) => { if (name.endsWith('.log')) logFiles.push(path.relative(DEST, p)); });
if (logFiles.length > 0) fail(`.log files found:\n    ${logFiles.join('\n    ')}`);
else pass('No .log files present.');

const DEV_ONLY = new Set(['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.prettierrc',
    '.editorconfig', 'jest.config.js', 'webpack.config.js',
    '.env', '.env.local', '.env.development', 'tsconfig.json', 'babel.config.js']);
let devFiles = [];
walkDir(DEST, (p, name) => { if (DEV_ONLY.has(name)) devFiles.push(path.relative(DEST, p)); });
if (devFiles.length > 0) fail(`Dev-only config files found:\n    ${devFiles.join('\n    ')}`);
else pass('No dev-only config files present.');

// ── Required bundle outputs must be present ───────────────────────────────────

const REQUIRED_FILES = REQUIRED_PROTECTED_FILES;
for (const f of REQUIRED_FILES) {
    if (fs.existsSync(path.join(DEST, f))) pass(`Required file present: ${f}`);
    else fail(`Required file missing: ${f}`);
}

// package.json must point to main.bundle.cjs
const pkgPath = path.join(DEST, 'package.json');
if (fs.existsSync(pkgPath)) {
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.main === 'main.bundle.cjs') pass('package.json main → main.bundle.cjs');
        else fail(`package.json main is "${pkg.main}", expected "main.bundle.cjs"`);
    } catch { fail('package.json is not valid JSON.'); }
}

// ── Obfuscation checks ────────────────────────────────────────────────────────

const OBF_CHECK = ['main.bundle.cjs', 'preload.bundle.cjs', 'renderer.bundle.js', 'vault-export-preload.bundle.cjs', 'vault-export.bundle.js'];
for (const fname of OBF_CHECK) {
    const fpath = path.join(DEST, fname);
    if (fs.existsSync(fpath)) {
        const ok = /\b_0x[0-9a-f]{4,}\b/.test(fs.readFileSync(fpath, 'utf8'));
        if (ok) pass(`${fname} appears obfuscated.`);
        else fail(`${fname} does not appear obfuscated (no _0x identifiers found).`);
    } else {
        fail(`${fname} not found — cannot check obfuscation.`);
    }
}

// ── Runtime modules check ─────────────────────────────────────────────────────

const REQUIRED_MODULES = [
    'axios', 'electron-updater', 'electron-store', 'sharp',
    'keytar', 'ps-list', 'systeminformation', 'hls.js', 'dashjs',
];
const nmDir = path.join(DEST, 'node_modules');
if (!fs.existsSync(nmDir)) {
    fail('node_modules directory/junction not found.');
} else {
    for (const mod of REQUIRED_MODULES) {
        if (fs.existsSync(path.join(nmDir, mod))) pass(`Runtime module present: ${mod}`);
        else fail(`Required runtime module missing: ${mod}`);
    }
}

// ── HTML bundle reference checks ──────────────────────────────────────────────

const HTML_REFS = [
    { file: 'index.html',          refs: ['renderer.bundle.css', 'renderer.bundle.js'] },
    { file: 'quick-switcher.html', refs: ['qs.bundle.css', 'qs.bundle.js'] },
    { file: 'vault-export.html',    refs: ['vault-export.bundle.css', 'vault-export.bundle.js'] },
];
for (const { file, refs } of HTML_REFS) {
    const fpath = path.join(DEST, file);
    if (!fs.existsSync(fpath)) {
        fail(`${file} not found — cannot check bundle references.`);
        continue;
    }
    const content = fs.readFileSync(fpath, 'utf8');
    for (const ref of refs) {
        if (content.includes(ref)) pass(`${file} references ${ref}`);
        else fail(`${file} does not reference ${ref} — CSS/JS may not be loaded.`);
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
