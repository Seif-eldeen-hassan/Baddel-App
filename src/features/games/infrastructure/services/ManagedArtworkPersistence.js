"use strict";

const defaultPath = require("path");
const { fileURLToPath: defaultFileURLToPath, pathToFileURL } = require("url");

const PERSISTED_ARTWORK_FIELDS = Object.freeze([
    "coverUrl", "image", "defaultImage", "cover", "posterUrl", "posterImage",
    "verticalCover", "verticalCoverUrl", "boxArt", "boxArtUrl",
    "heroUrl", "heroImage", "logoUrl", "logo",
]);

const COVER_FIELDS = Object.freeze([
    "coverUrl", "image", "defaultImage", "cover", "posterUrl", "posterImage",
    "verticalCover", "verticalCoverUrl", "boxArt", "boxArtUrl",
]);

function managedArtworkCacheDir(userDataDir, pathModule = defaultPath) {
    return pathModule.join(userDataDir, "artwork-cache-v2");
}

function isRemoteArtworkUrl(value) {
    return /^https?:\/\//i.test(String(value || "").trim());
}

function isFileUrl(value) {
    return String(value || "").startsWith("file://");
}

function fileUrlToPathSafe(value, fileURLToPath = defaultFileURLToPath) {
    if (!isFileUrl(value)) return null;
    try { return fileURLToPath(String(value)); }
    catch { return null; }
}

function isPathInside(childPath, parentPath, pathModule = defaultPath) {
    if (!childPath || !parentPath) return false;
    const child = pathModule.resolve(childPath);
    const parent = pathModule.resolve(parentPath);
    const relative = pathModule.relative(parent, child);
    return relative === "" || (!!relative && !relative.startsWith("..") && !pathModule.isAbsolute(relative));
}

function isManagedArtworkCacheFileUrl(value, { userDataDir, path = defaultPath, fileURLToPath = defaultFileURLToPath } = {}) {
    if (!userDataDir || !isFileUrl(value)) return false;
    const filePath = fileUrlToPathSafe(value, fileURLToPath);
    if (!filePath) return false;
    return isPathInside(filePath, managedArtworkCacheDir(userDataDir, path), path);
}

function isUserArtworkFileUrl(value, { userDataDir, path = defaultPath, fileURLToPath = defaultFileURLToPath } = {}) {
    if (!userDataDir || !isFileUrl(value)) return false;
    const filePath = fileUrlToPathSafe(value, fileURLToPath);
    if (!filePath) return false;
    return isPathInside(filePath, path.join(userDataDir, "user_artwork"), path);
}

function extractRemoteCandidates(record = {}) {
    const urls = [];
    const add = (value) => {
        const url = typeof value === "string" ? value.trim() : String(value?.url || value?.href || value?.src || "").trim();
        if (!isRemoteArtworkUrl(url)) return;
        if (!urls.includes(url)) urls.push(url);
    };
    for (const field of PERSISTED_ARTWORK_FIELDS) add(record[field]);
    for (const field of ["coverSourceUrl", "sourceCoverUrl", "remoteCoverUrl"]) add(record[field]);
    for (const field of ["coverCandidates", "remoteCandidates", "artworkCandidates", "candidateUrls"]) {
        if (Array.isArray(record[field])) record[field].forEach(add);
    }
    if (Array.isArray(record.keyImages)) record.keyImages.forEach((img) => add(img));
    return urls;
}

function isDurableFileArtworkUrl(value, opts = {}) {
    if (!isFileUrl(value)) return false;
    if (isManagedArtworkCacheFileUrl(value, opts)) return false;
    return true;
}

function sanitizeArtworkPersistenceRecord(record = {}, opts = {}) {
    if (!record || typeof record !== "object") return { record, changed: false, removedFields: [], preservedCandidates: [] };
    const next = { ...record };
    let changed = false;
    const removedFields = [];
    const candidates = extractRemoteCandidates(record);
    const preserveCustom = record.customArtworkLocked === true || record.artworkSource === "creator";

    for (const field of PERSISTED_ARTWORK_FIELDS) {
        const value = next[field];
        if (!value || !isFileUrl(value)) continue;
        if (preserveCustom && !isManagedArtworkCacheFileUrl(value, opts)) continue;
        if (isManagedArtworkCacheFileUrl(value, opts)) {
            delete next[field];
            removedFields.push(field);
            changed = true;
        }
    }

    if (removedFields.some((field) => COVER_FIELDS.includes(field))) {
        const existingCandidates = Array.isArray(next.coverCandidates) ? next.coverCandidates.filter(isRemoteArtworkUrl) : [];
        const merged = Array.from(new Set([...existingCandidates, ...candidates]));
        if (merged.length) {
            if (JSON.stringify(next.coverCandidates || []) !== JSON.stringify(merged)) {
                next.coverCandidates = merged;
                changed = true;
            }
            if (!isRemoteArtworkUrl(next.coverSourceUrl)) {
                next.coverSourceUrl = merged[0];
                changed = true;
            }
            if (!isRemoteArtworkUrl(next.coverUrl)) { next.coverUrl = merged[0]; changed = true; }
            if (!isRemoteArtworkUrl(next.image)) { next.image = merged[0]; changed = true; }
            if (!isRemoteArtworkUrl(next.defaultImage)) { next.defaultImage = merged[0]; changed = true; }
        }
        if (next._agCoverPipelineDone !== undefined) { delete next._agCoverPipelineDone; changed = true; }
        if (next._agResolvedCoverUrl !== undefined) { delete next._agResolvedCoverUrl; changed = true; }
    }

    return { record: next, changed, removedFields, preservedCandidates: candidates };
}

function sanitizeMergedLibraryArtwork(library, opts = {}) {
    const input = Array.isArray(library) ? library : [];
    const summary = { scanned: input.length, changedRecords: 0, removedManagedUrls: 0, removedFieldsByName: {} };
    const games = input.map((game) => {
        const result = sanitizeArtworkPersistenceRecord(game, opts);
        if (result.changed) {
            summary.changedRecords += 1;
            summary.removedManagedUrls += result.removedFields.length;
            for (const field of result.removedFields) summary.removedFieldsByName[field] = (summary.removedFieldsByName[field] || 0) + 1;
        }
        return result.record;
    });
    return { games, changed: summary.changedRecords > 0, summary };
}

function toFileUrl(filePath) {
    return pathToFileURL(filePath).href;
}

module.exports = {
    PERSISTED_ARTWORK_FIELDS,
    managedArtworkCacheDir,
    isRemoteArtworkUrl,
    isFileUrl,
    fileUrlToPathSafe,
    isPathInside,
    isManagedArtworkCacheFileUrl,
    isUserArtworkFileUrl,
    isDurableFileArtworkUrl,
    extractRemoteCandidates,
    sanitizeArtworkPersistenceRecord,
    sanitizeMergedLibraryArtwork,
    toFileUrl,
};
