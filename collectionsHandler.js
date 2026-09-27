'use strict';

const fs     = require('fs').promises;
const fsSync = require('fs');
const path   = require('path');
const { app } = require('electron');

const DATA_DIR  = path.join(app.getPath('userData'), 'BaddelLauncher');
const DATA_FILE = path.join(DATA_DIR, 'collections.json');
const FAV_ID    = 'fav_system_default';

// Ensure storage directory and seed file exist at module load time.
if (!fsSync.existsSync(DATA_DIR))  fsSync.mkdirSync(DATA_DIR, { recursive: true });
if (!fsSync.existsSync(DATA_FILE)) fsSync.writeFileSync(DATA_FILE, '[]');

async function getCollections() {
    try {
        let raw;
        try { raw = await fs.readFile(DATA_FILE, 'utf8'); }
        catch { raw = '[]'; }

        const data = JSON.parse(raw);

        if (!data.find(c => c.id === FAV_ID)) {
            data.unshift({ id: FAV_ID, name: 'Favorites', image: null, gameIds: [], isSystem: true });
            await saveCollections(data);
        }
        return data;
    } catch (err) {
        console.error('[Collections] Read error:', err);
        return [];
    }
}

async function saveCollections(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('[Collections] Save failed:', err);
    }
}

async function remapGameIds(idRemap = {}) {
    const entries = Object.entries(idRemap || {}).filter(([from, to]) => from && to && from !== to);
    if (!entries.length) return { status: "success", changed: false };
    const replacements = new Map(entries.map(([from, to]) => [String(from), String(to)]));
    const collections = await getCollections();
    let changed = false;
    for (const collection of collections) {
        const before = Array.isArray(collection.gameIds) ? collection.gameIds : [];
        const after = [...new Set(before.map(id => replacements.get(String(id)) || id))];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
            collection.gameIds = after;
            changed = true;
        }
    }
    if (!changed) return { status: "success", changed: false };
    const temporary = DATA_FILE + "." + process.pid + ".remap.tmp";
    await fs.writeFile(temporary, JSON.stringify(collections, null, 2), "utf8");
    await fs.rename(temporary, DATA_FILE);
    return { status: "success", changed: true };
}

async function createCollection(name, imagePath) {
    const collections = await getCollections();
    const newColl = { id: `col_${Date.now()}`, name, image: imagePath || null, gameIds: [] };
    collections.push(newColl);
    await saveCollections(collections);
    return { status: 'success', collection: newColl };
}

async function addGameToCollection(collectionId, gameId) {
    const collections = await getCollections();
    const index = collections.findIndex(c => c.id === collectionId);
    if (index === -1) return { status: 'error', message: 'Collection not found' };
    if (collections[index].gameIds.includes(gameId)) return { status: 'exists', message: 'Game already in collection' };
    collections[index].gameIds.push(gameId);
    await saveCollections(collections);
    return { status: 'success' };
}

async function removeGameFromCollection(collectionId, gameId) {
    const collections = await getCollections();
    const index = collections.findIndex(c => c.id === collectionId);
    if (index === -1) return { status: 'error', message: 'Collection not found' };

    const before = collections[index].gameIds.length;
    collections[index].gameIds = collections[index].gameIds.filter(id => id !== gameId);
    if (collections[index].gameIds.length === before) return { status: 'error', message: 'Game not found in collection' };

    await saveCollections(collections);
    return { status: 'success' };
}

async function deleteCollection(collectionId) {
    let collections = await getCollections();
    const before = collections.length;
    collections = collections.filter(c => c.id !== collectionId);
    if (collections.length === before) return { status: 'error' };
    await saveCollections(collections);
    return { status: 'success' };
}

async function reorderCollection(collectionId, newGameIds) {
    const collections = await getCollections();
    const index = collections.findIndex(c => c.id === collectionId);
    if (index === -1) return { status: 'error', message: 'Collection not found' };
    collections[index].gameIds = newGameIds;
    await saveCollections(collections);
    return { status: 'success' };
}

async function updateCollectionDetails(collectionId, newName, newImage) {
    const collections = await getCollections();
    const index = collections.findIndex(c => c.id === collectionId);
    if (index === -1) return { status: 'error', message: 'Collection not found' };
    if (newName    != null)  collections[index].name  = newName;
    if (newImage !== undefined) collections[index].image = newImage;
    await saveCollections(collections);
    return { status: 'success' };
}

module.exports = {
    getCollections,
    createCollection,
    addGameToCollection,
    removeGameFromCollection,
    deleteCollection,
    reorderCollection,
    updateCollectionDetails,
    remapGameIds,
};
