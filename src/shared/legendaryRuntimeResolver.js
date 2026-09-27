'use strict';

const fs = require('fs');
const path = require('path');

function getDefaultProjectRoot() {
    return path.resolve(__dirname, '../..');
}

function getLegendaryRuntimePath({
    projectRoot = getDefaultProjectRoot(),
    resourcesPath = process.resourcesPath,
    isPackaged = false,
} = {}) {
    const baseDir = isPackaged
        ? path.resolve(resourcesPath || projectRoot)
        : path.resolve(projectRoot);
    return path.join(baseDir, 'bin', 'legendary.exe');
}

function inspectLegendaryRuntime(options = {}) {
    const legendaryPath = getLegendaryRuntimePath(options);
    return {
        legendaryPath,
        exists: fs.existsSync(legendaryPath),
        isPackaged: Boolean(options.isPackaged),
        resourcesPath: options.resourcesPath || process.resourcesPath || null,
    };
}

function createLegendaryRuntimeMissingError(legendaryPath) {
    const err = new Error(`Epic Legendary runtime is missing at ${legendaryPath}`);
    err.code = 'EPIC_LEGENDARY_RUNTIME_MISSING';
    err.legendaryPath = legendaryPath;
    return err;
}

module.exports = {
    getLegendaryRuntimePath,
    inspectLegendaryRuntime,
    createLegendaryRuntimeMissingError,
};
