'use strict';

const defaultFs = require('fs');
const defaultPath = require('path');

function defaultProjectRoot(pathImpl = defaultPath) {
    return pathImpl.resolve(__dirname, '../../../../../..');
}

function getGogRuntimePaths({
    projectRoot = defaultProjectRoot(defaultPath),
    resourcesPath = process.resourcesPath,
    isPackaged = false,
    path = defaultPath,
} = {}) {
    const runtimeDir = isPackaged
        ? path.join(resourcesPath || '', 'gog-runtime')
        : path.join(projectRoot || '', 'gog-runtime');
    return {
        runtimeDir,
        exePath: path.join(runtimeDir, 'gogdl.exe'),
        versionPath: path.join(runtimeDir, 'version.json'),
        licensePath: path.join(runtimeDir, 'LICENSE-GPL-3.0.txt'),
    };
}

function loadGogRuntimeVersionInfo({
    projectRoot = defaultProjectRoot(defaultPath),
    resourcesPath = process.resourcesPath,
    isPackaged = false,
    fs = defaultFs,
    path = defaultPath,
    throwOnError = false,
} = {}) {
    const paths = getGogRuntimePaths({ projectRoot, resourcesPath, isPackaged, path });
    try {
        const raw = fs.readFileSync(paths.versionPath, 'utf8');
        const versionInfo = JSON.parse(raw);
        return { versionInfo, versionPath: paths.versionPath, runtimeDir: paths.runtimeDir, error: null };
    } catch (err) {
        const error = new Error(`Could not load GOG runtime metadata from ${paths.versionPath}: ${err.message}`);
        error.code = 'GOG_RUNTIME_METADATA_INVALID';
        error.cause = err;
        error.details = { versionPath: paths.versionPath, runtimeDir: paths.runtimeDir };
        if (throwOnError) throw error;
        return { versionInfo: null, versionPath: paths.versionPath, runtimeDir: paths.runtimeDir, error };
    }
}

module.exports = {
    getGogRuntimePaths,
    loadGogRuntimeVersionInfo,
};
