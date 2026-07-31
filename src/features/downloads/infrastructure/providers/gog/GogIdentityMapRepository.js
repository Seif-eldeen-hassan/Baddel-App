'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const GOG_IDENTITY_MAP_SCHEMA_VERSION = 1;

class GogIdentityMapRepository {
    constructor({ userDataDir, fileName = 'gog_product_identity_map.json' } = {}) {
        if (!userDataDir) throw new Error('GogIdentityMapRepository requires userDataDir');
        this.filePath = path.join(userDataDir, 'platform-sync', fileName);
    }

    empty() {
        return { schemaVersion: GOG_IDENTITY_MAP_SCHEMA_VERSION, mappings: {} };
    }

    async read() {
        try {
            const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
            if (parsed?.schemaVersion !== GOG_IDENTITY_MAP_SCHEMA_VERSION || !parsed.mappings || typeof parsed.mappings !== 'object') {
                return this.empty();
            }
            return { schemaVersion: GOG_IDENTITY_MAP_SCHEMA_VERSION, mappings: { ...parsed.mappings } };
        } catch {
            return this.empty();
        }
    }

    readSync() {
        try {
            if (!fsSync.existsSync(this.filePath)) return this.empty();
            const parsed = JSON.parse(fsSync.readFileSync(this.filePath, 'utf8'));
            if (parsed?.schemaVersion !== GOG_IDENTITY_MAP_SCHEMA_VERSION || !parsed.mappings || typeof parsed.mappings !== 'object') {
                return this.empty();
            }
            return { schemaVersion: GOG_IDENTITY_MAP_SCHEMA_VERSION, mappings: { ...parsed.mappings } };
        } catch {
            return this.empty();
        }
    }

    async write(state) {
        const safe = sanitizeIdentityMap(state);
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(safe, null, 2), 'utf8');
        await fs.rename(tmp, this.filePath);
        return safe;
    }

    async get(key) {
        const state = await this.read();
        return state.mappings[String(key || '')] || null;
    }

    async set(key, mapping) {
        const state = await this.read();
        state.mappings[String(key)] = sanitizeMapping(mapping);
        await this.write(state);
        return state.mappings[String(key)];
    }

    async remove(key) {
        const state = await this.read();
        delete state.mappings[String(key || '')];
        await this.write(state);
    }
}

function sanitizeIdentityMap(state = {}) {
    const out = { schemaVersion: GOG_IDENTITY_MAP_SCHEMA_VERSION, mappings: {} };
    for (const [key, mapping] of Object.entries(state.mappings || {})) {
        out.mappings[key] = sanitizeMapping(mapping);
    }
    return out;
}

function sanitizeMapping(mapping = {}) {
    return {
        accountId: stringOrNull(mapping.accountId),
        galaxyLibraryEntryId: stringOrNull(mapping.galaxyLibraryEntryId),
        galaxyExternalId: stringOrNull(mapping.galaxyExternalId),
        gogProductId: stringOrNull(mapping.gogProductId),
        contentSystemProductId: stringOrNull(mapping.contentSystemProductId),
        gogdlAppName: stringOrNull(mapping.gogdlAppName),
        title: stringOrNull(mapping.title),
        slug: stringOrNull(mapping.slug),
        source: stringOrNull(mapping.source),
        confidence: stringOrNull(mapping.confidence),
        verifiedBuildId: stringOrNull(mapping.verifiedBuildId),
        verifiedBuildGeneration: Number.isFinite(Number(mapping.verifiedBuildGeneration)) ? Number(mapping.verifiedBuildGeneration) : null,
        verifiedBuildCount: Number.isFinite(Number(mapping.verifiedBuildCount)) ? Number(mapping.verifiedBuildCount) : 0,
        ownershipVerified: mapping.ownershipVerified === true,
        secureLinkVerified: mapping.secureLinkVerified === true,
        resolvedAt: stringOrNull(mapping.resolvedAt),
    };
}

function stringOrNull(value) {
    const s = String(value || '').trim();
    return s || null;
}

module.exports = {
    GogIdentityMapRepository,
    GOG_IDENTITY_MAP_SCHEMA_VERSION,
    sanitizeIdentityMap,
    sanitizeMapping,
};
