'use strict';

function text(value) {
    return value == null ? '' : String(value).trim();
}

function platformOf(value = {}) {
    const platform = text(value.scannerPlatform || value.platform || value.source).toLowerCase();
    return platform.includes('epic') ? 'epic' : platform;
}

function normalizedPath(value) {
    return text(value).replace(/^"+|"+$/g, '').replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function pathBelongsToInstall(candidate, installPath) {
    const value = normalizedPath(candidate);
    const root = normalizedPath(installPath);
    return Boolean(value && root && (value === root || value.startsWith(`${root}/`)));
}

function epicMetadata(record = {}) {
    return {
        appName: text(record.appName || record.providerAppName || record.allIds?.epic),
        namespace: text(record.namespace || record.catalogNamespace),
        catalogItemId: text(record.catalogItemId || record.catalogItemID || record.catalogId),
    };
}

function inspectEpicManagedInstall(record, task = null) {
    const metadata = epicMetadata(record || {});
    const taskMetadata = epicMetadata(task || {});
    const expectedInstallPath = text(task?.installPath);
    const recordInstallPath = text(record?.installPath || record?.path);
    const launchTarget = text(record?.executablePath || record?.command || record?.launchCommand);
    const fields = {
        recordFound: Boolean(record),
        platform: platformOf(record || {}),
        installSource: text(record?.installSource).toLowerCase(),
        installProvider: text(record?.installProvider || record?.installProvenance).toLowerCase(),
        idPresent: Boolean(text(record?.id)),
        installPathPresent: Boolean(recordInstallPath),
        launchTargetPresent: Boolean(launchTarget),
        appNamePresent: Boolean(metadata.appName),
        namespacePresent: Boolean(metadata.namespace),
        catalogItemIdPresent: Boolean(metadata.catalogItemId),
        taskIdMatches: !task || !text(task.installedGameId) || text(task.installedGameId) === text(record?.id)
            || (Array.isArray(record?.recordAliases) && record.recordAliases.map(text).includes(text(task.installedGameId))),
        taskPathMatches: !expectedInstallPath || pathBelongsToInstall(recordInstallPath, expectedInstallPath)
            || pathBelongsToInstall(launchTarget, expectedInstallPath),
        taskAppNameMatches: !taskMetadata.appName || !metadata.appName
            || taskMetadata.appName.toLowerCase() === metadata.appName.toLowerCase(),
        taskNamespaceMatches: !taskMetadata.namespace
            || (Boolean(metadata.namespace) && taskMetadata.namespace.toLowerCase() === metadata.namespace.toLowerCase()),
        taskCatalogItemMatches: !taskMetadata.catalogItemId
            || (Boolean(metadata.catalogItemId) && taskMetadata.catalogItemId.toLowerCase() === metadata.catalogItemId.toLowerCase()),
    };
    const requiredBooleanFields = [
        'recordFound', 'idPresent', 'installPathPresent', 'launchTargetPresent', 'appNamePresent',
        'taskIdMatches', 'taskPathMatches', 'taskAppNameMatches', 'taskNamespaceMatches', 'taskCatalogItemMatches',
    ];
    const failedFields = requiredBooleanFields.filter(key => fields[key] === false);
    if (fields.platform !== 'epic') failedFields.push('platform');
    if (fields.installSource !== 'download') failedFields.push('installSource');
    if (fields.installProvider !== 'legendary') failedFields.push('installProvider');
    return {
        ok: failedFields.length === 0,
        code: failedFields.length ? 'EPIC_MANAGED_INSTALL_INVALID' : null,
        failedFields,
        fields,
        metadata,
    };
}

function findEpicManagedInstall(games = [], task = {}) {
    const list = Array.isArray(games) ? games : [];
    const installedId = text(task.installedGameId);
    const exact = list.find(game => text(game?.id) === installedId)
        || list.find(game => Array.isArray(game?.recordAliases) && game.recordAliases.map(text).includes(installedId));
    if (exact) return exact;
    const metadata = epicMetadata(task);
    return list.find(game => {
        if (platformOf(game) !== 'epic') return false;
        const candidate = epicMetadata(game);
        const identityMatches = metadata.appName && candidate.appName
            && metadata.appName.toLowerCase() === candidate.appName.toLowerCase();
        return identityMatches && (pathBelongsToInstall(game.installPath || game.path, task.installPath)
            || pathBelongsToInstall(game.executablePath || game.command, task.installPath));
    }) || null;
}

module.exports = {
    epicMetadata,
    findEpicManagedInstall,
    inspectEpicManagedInstall,
    pathBelongsToInstall,
};
