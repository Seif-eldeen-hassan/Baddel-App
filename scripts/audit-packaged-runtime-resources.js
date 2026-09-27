#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const baseDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(ROOT, 'dist', 'win-unpacked', 'resources');

const required = [
    'app.asar',
    'steam-runtime/baddel_bridge.exe',
    'bin/legendary.exe',
    'gog-runtime/gogdl.exe',
    'gog-runtime/version.json',
    'gog-runtime/LICENSE-GPL-3.0.txt',
];

let failures = 0;
for (const rel of required) {
    const target = path.join(baseDir, rel);
    if (fs.existsSync(target)) {
        console.log(`[PASS] resources/${rel}`);
    } else {
        failures += 1;
        console.error(`[FAIL] Missing resources/${rel}`);
    }
}

if (failures) {
    console.error(`Packaged runtime resource audit failed for ${baseDir}`);
    process.exit(1);
}
console.log(`Packaged runtime resource audit passed for ${baseDir}`);
