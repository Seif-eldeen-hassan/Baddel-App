'use strict';

const path = require('path');
const text = value => value == null ? '' : String(value).trim();
function platformOf(value = {}) {
    const raw = text(value.scannerPlatform || value.platform || value.source).toLowerCase();
    if (raw.includes('epic')) return 'epic';
    if (raw.includes('gog')) return 'gog';
    return raw;
}
function normalizePath(value) {
    const raw = text(value).replace(/^"+|"+$/g, '');
    if (!raw) return '';
    try { return path.resolve(raw).replace(/[\\/]+$/g, '').toLowerCase(); } catch { return ''; }
}
function within(candidate, root) {
    const left = normalizePath(candidate), right = normalizePath(root);
    return Boolean(left && right && (left === right || left.startsWith(right + path.sep)));
}
function physicalPaths(game = {}) {
    return [...new Set([game.installPath, game.path, game.executablePath,
        game.executablePath ? path.dirname(game.executablePath) : null]
        .map(normalizePath).filter(Boolean))];
}
function strongIdentity(value = {}, platform = platformOf(value)) {
    if (platform === 'gog') {
        const id = text(value.gogProductId || value.providerProductId || value.contentSystemProductId
            || value.gogdlAppName || value.allIds?.gog).replace(/^gog[-_]/i, '');
        return /^\d+$/.test(id) ? 'gog:' + id : '';
    }
    if (platform !== 'epic') return '';
    const appName = text(value.providerAppName || value.appName).toLowerCase();
    if (appName) return 'app:' + appName;
    const namespace = text(value.namespace || value.catalogNamespace).toLowerCase();
    const catalog = text(value.catalogItemId || value.catalogItemID || value.catalogId).toLowerCase();
    return namespace && catalog ? 'catalog:' + namespace + ':' + catalog : '';
}
function managedTask(task = {}) {
    const platform = platformOf(task);
    return task.status === 'completed' && task.completionConfirmed !== false
        && ((platform === 'gog' && task.installProvider === 'gogdl')
            || (platform === 'epic' && task.installProvider === 'legendary'))
        && Boolean(text(task.installedGameId) && normalizePath(task.installPath));
}
function recordBelongsToTask(game, task) {
    const platform = platformOf(task);
    return platformOf(game) === platform
        && Boolean(strongIdentity(task, platform))
        && strongIdentity(task, platform) === strongIdentity(game, platform)
        && physicalPaths(game).some(candidate => within(candidate, task.installPath));
}
function unique(values) {
    return [...new Set(values.flatMap(value => Array.isArray(value) ? value : [value])
        .map(text).filter(Boolean))];
}
function dateValue(values, latest = false) {
    const valid = values.filter(Boolean).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    return (latest ? valid.at(-1) : valid[0]) || null;
}
function chooseLaunchRecord(records, root) {
    const rank = record => (within(record.executablePath, root) ? 8 : 0)
        + (text(record.command || record.launchCommand) ? 4 : 0)
        + (record.installSource === 'scanner' ? 2 : 0)
        + (record.installVerified === true ? 1 : 0);
    return records.slice().sort((a, b) => rank(b) - rank(a)
        || text(a.id).localeCompare(text(b.id)))[0];
}
function mergeSessions(records) {
    const sessions = new Map();
    for (const session of records.flatMap(record => Array.isArray(record.playSessions) ? record.playSessions : [])) {
        const key = text(session?.id) || JSON.stringify([session?.startedAt || session?.startTime,
            session?.endedAt || session?.endTime, session?.countedMinutes || session?.minutes]);
        if (!sessions.has(key)) sessions.set(key, session);
    }
    return [...sessions.values()];
}
function mergeManagedRecords(survivor, records, task) {
    const launch = chooseLaunchRecord(records, task.installPath);
    const custom = records.find(record => record.customTitleLocked === true || record.titleLocked === true);
    const merged = { ...survivor };
    const fill = ['gogManifestPath','galaxyLaunchCommand','providerAppName','appName','namespace',
        'catalogNamespace','catalogItemId','providerProductId','contentSystemProductId','gogProductId',
        'gogdlAppName','launcherGameId','cover','coverUrl','image','hero','heroImage','heroUrl',
        'logo','logoUrl','background','backgroundUrl','defaultImage','defaultHero','defaultLogo',
        'artworkState','artworkSource','artworkUpdatedAt','buildId','buildVersion'];
    for (const field of fill) {
        const source = records.find(record => record[field] != null && record[field] !== '');
        if ((merged[field] == null || merged[field] === '') && source) merged[field] = source[field];
    }
    for (const field of ['executablePath','command','launchCommand','launchArgs','launchCwd','gogManifestPath','galaxyLaunchCommand']) {
        if (launch?.[field] != null && launch[field] !== '') merged[field] = launch[field];
    }
    if (custom) {
        for (const field of ['name','title','customTitle','customTitleLocked','titleLocked','titleSource','titleUpdatedAt','originalName']) {
            if (custom[field] != null) merged[field] = custom[field];
        }
    }
    merged.id = survivor.id;
    merged.path = task.installPath;
    merged.installPath = task.installPath;
    merged.installSource = 'download';
    merged.installProvider = task.installProvider || survivor.installProvider;
    merged.installProvenance = task.installProvider || survivor.installProvenance || survivor.installProvider;
    merged.installedGameKey = survivor.installedGameKey;
    merged.isInstalled = true;
    merged.installVerified = true;
    merged.ownedByAccountIds = unique(records.flatMap(record => record.ownedByAccountIds || [])
        .concat(task.ownedByAccountIds || []));
    merged.allIds = Object.assign({}, ...records.map(record => record.allIds || {}), survivor.allIds || {});
    merged.discoverySources = unique(records.flatMap(record => record.discoverySources || []));
    merged.validationWarnings = unique(records.flatMap(record => record.validationWarnings || []));
    merged.recordAliases = unique(records.flatMap(record => [record.id, record.recordAliases || []]))
        .filter(id => id !== text(survivor.id));
    merged.firstSeenAt = dateValue(records.map(record => record.firstSeenAt || record.addedAt));
    merged.addedAt = dateValue(records.map(record => record.addedAt)) || survivor.addedAt;
    merged.lastSeenAt = dateValue(records.map(record => record.lastSeenAt), true) || survivor.lastSeenAt;
    merged.installedAt = dateValue(records.map(record => record.installedAt)) || survivor.installedAt;
    merged.downloadedAt = dateValue(records.map(record => record.downloadedAt)) || survivor.downloadedAt;
    merged.totalPlaytime = Math.max(...records.map(record => Number(record.totalPlaytime || record.playtime || 0)), 0);
    merged.lastPlayed = Math.max(...records.map(record => Number(record.lastPlayed || 0)), 0) || null;
    merged.lastQualifiedPlayed = Math.max(...records.map(record => Number(record.lastQualifiedPlayed || 0)), 0) || null;
    merged.playSessions = mergeSessions(records);
    merged.timeTrackingEnabled = records.every(record => record.timeTrackingEnabled !== false);
    return merged;
}
function reconcileManagedInstalledGames(games = [], tasks = []) {
    const next = games.map(game => ({ ...game })), removed = new Set(), idRemap = {}, merges = [];
    for (const game of next) for (const alias of Array.isArray(game.recordAliases) ? game.recordAliases : []) {
        if (text(alias) && text(alias) !== text(game.id)) idRemap[text(alias)] = text(game.id);
    }
    for (const task of tasks.filter(managedTask).sort((a, b) => text(a.id).localeCompare(text(b.id)))) {
        const anchorId = idRemap[text(task.installedGameId)] || text(task.installedGameId);
        const candidates = next.filter(game => !removed.has(text(game.id)) && recordBelongsToTask(game, task));
        const managedCandidates = candidates.filter(game => game.installSource === 'download'
            && String(game.installProvider || game.installProvenance || '') === String(task.installProvider || ''));
        const survivor = managedCandidates.find(game => text(game.id) === anchorId)
            || (managedCandidates.length === 1 ? managedCandidates[0] : null);
        if (!survivor || candidates.length < 2) continue;
        const redundant = candidates.filter(game => text(game.id) !== text(survivor.id));
        next[next.findIndex(game => text(game.id) === text(survivor.id))] =
            mergeManagedRecords(survivor, candidates, task);
        for (const record of redundant) {
            removed.add(text(record.id));
            idRemap[text(record.id)] = text(survivor.id);
        }
        merges.push({platform: platformOf(task), identity: strongIdentity(task),
            survivorId: text(survivor.id), removedIds: redundant.map(record => text(record.id)),
            taskId: text(task.id), rule: 'same-platform+strong-provider-identity+same-managed-completion-root'});
    }
    return {changed: removed.size > 0, games: next.filter(game => !removed.has(text(game.id))),
        idRemap, merges, removedCount: removed.size};
}
module.exports = { reconcileManagedInstalledGames, recordBelongsToTask, strongIdentity, normalizePath, within };
