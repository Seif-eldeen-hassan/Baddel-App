'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_PROTECTED_FILES = Object.freeze([
    'main.bundle.cjs',
    'preload.bundle.cjs',
    'vault-export-preload.bundle.cjs',
    'renderer.bundle.js',
    'renderer.bundle.css',
    'vault-export.bundle.js',
    'vault-export.bundle.css',
    'build-fingerprint.json',
    'index.html',
    'quick-switcher.html',
    'gog-auth-shell.html',
    'vault-export.html',
    'package.json',
    'Logo.ico',
    'gog-runtime/gogdl.exe',
    'gog-runtime/version.json',
    'gog-runtime/LICENSE-GPL-3.0.txt',
]);

function findMissingProtectedFiles(root, required = REQUIRED_PROTECTED_FILES) {
    return required.filter((file) => !fs.existsSync(path.join(root, file)));
}

module.exports = { REQUIRED_PROTECTED_FILES, findMissingProtectedFiles };
