'use strict';

function asString(value) {
    return value == null ? '' : String(value).trim();
}

function firstString(...values) {
    for (const value of values) {
        const s = asString(value);
        if (s) return s;
    }
    return null;
}

function localizedString(value) {
    if (!value) return null;
    if (typeof value === 'string') return firstString(value);
    if (typeof value !== 'object') return null;
    return firstString(
        value['*'],
        value.en,
        value['en-US'],
        value['en-us'],
        value.default,
        value.value,
        value.text,
        value.title,
        value.name
    );
}

function firstLocalizedString(...values) {
    for (const value of values) {
        const s = localizedString(value);
        if (s) return s;
    }
    return null;
}

function stripHtml(value) {
    const s = firstString(value);
    if (!s) return null;
    return s
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function firstDescription(...values) {
    for (const value of values) {
        const s = stripHtml(localizedString(value));
        if (s) return s;
    }
    return null;
}

function parseMaybeJson(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

function walkObjects(root, visit, seen = new Set()) {
    if (!root || typeof root !== 'object' || seen.has(root)) return null;
    seen.add(root);
    const direct = visit(root);
    if (direct) return direct;
    if (Array.isArray(root)) {
        for (const item of root) {
            const found = walkObjects(item, visit, seen);
            if (found) return found;
        }
        return null;
    }
    for (const value of Object.values(root)) {
        const found = walkObjects(value, visit, seen);
        if (found) return found;
    }
    return null;
}

function extractJsonBlobsFromHtml(html) {
    const s = firstString(html);
    if (!s) return [];
    const blobs = [];
    const scriptRe = /<script[^>]*(?:type=["']application\/ld\+json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRe.exec(s))) {
        const parsed = parseMaybeJson(match[1].trim());
        if (parsed) blobs.push(parsed);
    }
    return blobs;
}

function parseBalancedJsonObject(text, objectStart) {
    if (!text || objectStart < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = objectStart; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return parseMaybeJson(text.slice(objectStart, i + 1));
        }
    }
    return null;
}

function extractWindowProductCardFromHtml(html) {
    const s = firstString(html);
    if (!s) return null;
    const marker = 'cardProduct:';
    const markerIndex = s.indexOf(marker);
    if (markerIndex < 0) return null;
    const objectStart = s.indexOf('{', markerIndex);
    return parseBalancedJsonObject(s, objectStart);
}

function normalizeDateString(value) {
    const s = firstString(value);
    if (!s) return null;
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const named = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (named) {
        const months = {
            january: '01',
            february: '02',
            march: '03',
            april: '04',
            may: '05',
            june: '06',
            july: '07',
            august: '08',
            september: '09',
            october: '10',
            november: '11',
            december: '12',
        };
        const month = months[named[1].toLowerCase()];
        if (month) return `${named[3]}-${month}-${String(Number(named[2])).padStart(2, '0')}`;
    }
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
    return s;
}

function extractStoreVisibleReleaseDate(html) {
    const text = stripHtml(html);
    if (!text) return null;
    const match = text.match(/\bRelease\s*:?\s*([A-Za-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i);
    return normalizeDateString(match?.[1]);
}

function pickReleaseDateFromObject(root) {
    return walkObjects(root, (obj) => {
        for (const key of [
            'storeReleaseDate',
            'originalReleaseDate',
            'original_release_date',
            'releaseDate',
            'release_date',
            'globalReleaseDate',
        ]) {
            const date = normalizeDateString(obj?.[key]);
            if (date) return date;
        }
        return null;
    });
}

function pickArtwork(entry, key) {
    const formatImage = (value, ext = 'jpg') => {
        const s = firstString(value);
        if (!s) return null;
        return s.replace('{formatter}', '').replace('{ext}', ext);
    };
    if (key === 'cover') {
        const vertical = formatImage(entry?.game?.vertical_cover?.url_format);
        if (vertical) return vertical;
    }
    if (key === 'hero') {
        const background = formatImage(entry?.game?.background?.url_format, 'webp') ||
            formatImage(entry?.game?.horizontal_artwork?.url_format);
        if (background) return background;
    }
    if (key === 'logo') {
        const logo = firstString(entry?.images?.logo, entry?.image?.logo, entry?.logoUrl);
        if (logo) return logo;
        return null;
    }
    return firstString(
        entry?.images?.[key],
        entry?.image?.[key],
        entry?._embedded?.product?.images?.[key],
        entry?.product?.images?.[key],
        key === 'cover' ? entry?.coverUrl : null,
        key === 'hero' ? entry?.heroUrl : null,
        key === 'logo' ? entry?.logoUrl : null
    );
}

function formatGogImage(value, ext = 'jpg') {
    const raw = firstString(
        typeof value === 'string' ? value : null,
        value?.url,
        value?.url_format,
        value?.image,
        value?.src
    );
    if (!raw) return null;
    return raw.replace('{formatter}', '').replace('{ext}', ext);
}

function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const value of values || []) {
        const s = firstLocalizedString(value?.name, value?.title, value?.label, value) || firstString(value);
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

function pickFirstName(values) {
    return uniqueStrings(values)[0] || null;
}

function pickDescription(entry, title) {
    const store = entry?._storeProduct || {};
    const description = firstDescription(
        store?.description?.full,
        store?.description?.lead,
        store?.description,
        store?.summary,
        store?.about,
        entry?.game?.description,
        entry?.game?.summary,
        entry?.game?.short_description,
        entry?.description,
        entry?.summary,
        entry?.short_description,
        entry?._embedded?.product?.description,
        entry?._embedded?.product?.summary,
        entry?.product?.description,
        entry?.product?.summary
    );
    if (description) return description;
    return `${title} is synced from your GOG library. More details will appear when Baddel metadata is available.`;
}

function pickDeveloper(entry) {
    const store = entry?._storeProduct || {};
    return pickFirstName([
        ...(Array.isArray(store?.developers) ? store.developers : []),
        ...(Array.isArray(store?.developer) ? store.developer : []),
        store?.developer,
        ...(Array.isArray(store?._catalogProduct?.developers) ? store._catalogProduct.developers : []),
        ...(Array.isArray(entry?.game?.developers) ? entry.game.developers : []),
        ...(Array.isArray(entry?.developers) ? entry.developers : []),
        entry?.developer,
        entry?._embedded?.product?.developer,
        entry?.product?.developer,
    ]);
}

function pickPublisher(entry) {
    const store = entry?._storeProduct || {};
    return pickFirstName([
        ...(Array.isArray(store?.publishers) ? store.publishers : []),
        ...(Array.isArray(store?.publisher) ? store.publisher : []),
        store?.publisher,
        ...(Array.isArray(store?._catalogProduct?.publishers) ? store._catalogProduct.publishers : []),
        ...(Array.isArray(entry?.game?.publishers) ? entry.game.publishers : []),
        ...(Array.isArray(entry?.publishers) ? entry.publishers : []),
        entry?.publisher,
        entry?._embedded?.product?.publisher,
        entry?.product?.publisher,
    ]);
}

function pickReleaseDate(entry) {
    const store = entry?._storeProduct || {};
    const pageHtml = entry?._storePage?.html;
    const productCard = extractWindowProductCardFromHtml(pageHtml);
    return firstString(
        extractStoreVisibleReleaseDate(pageHtml),
        pickReleaseDateFromObject(productCard),
        store?.release_date,
        store?.releaseDate,
        store?.storeReleaseDate,
        store?.originalReleaseDate,
        store?.globalReleaseDate,
        store?._catalogProduct?.release_date,
        store?._catalogProduct?.releaseDate,
        entry?.game?.release_date,
        entry?.game?.releaseDate,
        entry?.release_date,
        entry?.releaseDate,
        entry?._embedded?.product?.release_date,
        entry?.product?.release_date
    );
}

function normalizeRequirementBucket(bucket) {
    if (!bucket) return null;
    if (typeof bucket === 'string') {
        const text = stripHtml(bucket);
        return text && text.replace(/[:\s-]/g, '').length > 0 ? text : null;
    }
    if (typeof bucket !== 'object') return null;
    const text = firstDescription(bucket.text, bucket.description, bucket.html, bucket.value);
    if (text) return text;
    const out = {};
    const map = {
        os: ['os', 'OS', 'system', 'operating_system'],
        cpu: ['cpu', 'CPU', 'processor', 'Processor'],
        ram: ['ram', 'RAM', 'memory', 'Memory'],
        gpu: ['gpu', 'GPU', 'graphics', 'Graphics', 'video_card'],
        storage: ['storage', 'Storage', 'hard_drive', 'disk'],
        directx: ['directx', 'DirectX'],
    };
    for (const [key, aliases] of Object.entries(map)) {
        const value = aliases.map(alias => bucket[alias]).find(Boolean);
        if (value) out[key] = stripHtml(value) || firstString(value);
    }
    return Object.keys(out).length > 0 ? out : null;
}

function normalizeGogRequirementRows(rows) {
    if (!Array.isArray(rows)) return null;
    const out = {};
    const keyMap = {
        system: 'os',
        os: 'os',
        processor: 'cpu',
        cpu: 'cpu',
        memory: 'ram',
        ram: 'ram',
        graphics: 'gpu',
        gpu: 'gpu',
        storage: 'storage',
        harddisk: 'storage',
        hard_drive: 'storage',
        directx: 'directx',
    };
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const rawKey = String(row.id || row.name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '');
        const key = keyMap[rawKey] || keyMap[rawKey.replace(/:$/, '')];
        const value = stripHtml(row.description || row.value || row.minimum || row.text);
        if (key && value) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
}

function normalizeSupportedOperatingSystems(value) {
    if (!Array.isArray(value)) return null;
    if (value.some((item) => Array.isArray(item?.requirements))) {
        const win = {};
        for (const bucket of value) {
            const type = String(bucket?.type || bucket?.name || '').toLowerCase();
            const normalized = normalizeGogRequirementRows(bucket?.requirements);
            if (!normalized) continue;
            if (type.includes('recommended')) win.recommended = normalized;
            else win.minimum = normalized;
        }
        return win.minimum || win.recommended ? { win: { minimum: win.minimum || {}, recommended: win.recommended || {} } } : null;
    }
    const windows = value.find((os) => {
        const name = String(os?.operatingSystem?.name || os?.name || os?.platform || '').toLowerCase();
        return name.includes('windows') || name === 'win';
    }) || value[0];
    const requirements = Array.isArray(windows?.systemRequirements) ? windows.systemRequirements : [];
    const win = {};
    for (const bucket of requirements) {
        const type = String(bucket?.type || bucket?.name || '').toLowerCase();
        const normalized = normalizeGogRequirementRows(bucket?.requirements);
        if (!normalized) continue;
        if (type.includes('recommended')) win.recommended = normalized;
        else win.minimum = normalized;
    }
    return win.minimum || win.recommended ? { win: { minimum: win.minimum || {}, recommended: win.recommended || {} } } : null;
}

function normalizeRequirementsShape(req) {
    if (!req) return null;
    const supported = normalizeSupportedOperatingSystems(req.supportedOperatingSystems || req.supported_operating_systems || req);
    if (supported) return supported;
    if (typeof req === 'string') {
        const minimum = normalizeRequirementBucket(req);
        return minimum ? { win: { minimum } } : null;
    }
    if (typeof req !== 'object') return null;
    const win = req.win || req.windows || req.Windows || req.PC || req.pc || req;
    const minimum = normalizeRequirementBucket(win.minimum || win.min || win.minimum_system_requirements || win.minimumRequirements || win.minimumSystemRequirements);
    const recommended = normalizeRequirementBucket(win.recommended || win.rec || win.recommended_system_requirements || win.recommendedRequirements || win.recommendedSystemRequirements);
    if (minimum || recommended) return { win: { minimum: minimum || {}, recommended: recommended || {} } };
    return null;
}

function pickRequirementsFromStorePage(page) {
    const html = firstString(page?.html);
    if (!html) return null;

    const productCard = extractWindowProductCardFromHtml(html);
    const productCardRequirements = walkObjects(productCard, (obj) => {
        for (const [key, value] of Object.entries(obj)) {
            if (/requirements|systemRequirements|system_requirements/i.test(key)) {
                const normalized = normalizeRequirementsShape(value);
                if (normalized) return normalized;
            }
        }
        return null;
    });
    if (productCardRequirements) return productCardRequirements;

    for (const blob of extractJsonBlobsFromHtml(html)) {
        const found = walkObjects(blob, (obj) => {
            for (const [key, value] of Object.entries(obj)) {
                if (/requirements|systemRequirements|system_requirements/i.test(key)) {
                    const normalized = normalizeRequirementsShape(value);
                    if (normalized) return normalized;
                }
            }
            return null;
        });
        if (found) return found;
    }

    const minimumMatch = html.match(/minimum(?:\s+system)?\s+requirements?([\s\S]{0,4000}?)(?:recommended(?:\s+system)?\s+requirements?|<\/section>|<\/div>\s*<\/div>)/i);
    const recommendedMatch = html.match(/recommended(?:\s+system)?\s+requirements?([\s\S]{0,4000}?)(?:<\/section>|<\/div>\s*<\/div>)/i);
    const minimum = minimumMatch ? normalizeRequirementBucket(minimumMatch[1]) : null;
    const recommended = recommendedMatch ? normalizeRequirementBucket(recommendedMatch[1]) : null;
    return minimum || recommended ? { win: { minimum: minimum || {}, recommended: recommended || {} } } : null;
}

function pickRequirements(entry) {
    const store = entry?._storeProduct || {};
    const page = entry?._storePage || {};
    const candidates = [
        store?.requirements,
        store?.system_requirements,
        store?.systemRequirements,
        store?.content_system_compatibility?.requirements,
        entry?.game?.requirements,
        entry?.requirements,
        entry?._embedded?.product?.requirements,
        entry?.product?.requirements,
    ].filter(Boolean);

    for (const req of candidates) {
        const normalized = normalizeRequirementsShape(req);
        if (normalized) return normalized;
    }

    return pickRequirementsFromStorePage(page);
}

function pickShortDescription(entry, description) {
    const store = entry?._storeProduct || {};
    const shortDescription = firstDescription(
        store?.description?.lead,
        store?.summary,
        entry?.game?.short_description,
        entry?.short_description,
        entry?.game?.summary,
        entry?.summary,
        entry?._embedded?.product?.summary,
        entry?.product?.summary
    );
    if (shortDescription) return shortDescription;
    return description && description.length > 260 ? `${description.slice(0, 257).trim()}...` : description;
}

function pickGenres(entry) {
    const store = entry?._storeProduct || {};
    return uniqueStrings([
        ...(Array.isArray(store?.genres) ? store.genres : []),
        ...(Array.isArray(store?.tags) ? store.tags : []),
        ...(Array.isArray(store?._catalogProduct?.genres) ? store._catalogProduct.genres : []),
        ...(Array.isArray(entry?.game?.genres) ? entry.game.genres : []),
        ...(Array.isArray(entry?.genres) ? entry.genres : []),
        ...(Array.isArray(entry?._embedded?.product?.genres) ? entry._embedded.product.genres : []),
        ...(Array.isArray(entry?.product?.genres) ? entry.product.genres : []),
    ]);
}

function pickScreenshots(entry) {
    const store = entry?._storeProduct || {};
    return [
        ...(Array.isArray(store?.screenshots) ? store.screenshots : []),
        ...(Array.isArray(store?._catalogProduct?.screenshots) ? store._catalogProduct.screenshots : []),
        ...(Array.isArray(entry?.game?.screenshots) ? entry.game.screenshots : []),
        ...(Array.isArray(entry?.screenshots) ? entry.screenshots : []),
        ...(Array.isArray(entry?.images?.screenshots) ? entry.images.screenshots : []),
        ...(Array.isArray(entry?._embedded?.product?.screenshots) ? entry._embedded.product.screenshots : []),
    ].map((item) => formatGogImage(item, 'jpg')).filter(Boolean);
}

function pickTrailers(entry) {
    const store = entry?._storeProduct || {};
    return [
        ...(Array.isArray(store?.videos) ? store.videos : []),
        ...(Array.isArray(entry?.game?.videos) ? entry.game.videos : []),
        ...(Array.isArray(entry?.game?.trailers) ? entry.game.trailers : []),
        ...(Array.isArray(entry?.videos) ? entry.videos : []),
        ...(Array.isArray(entry?.trailers) ? entry.trailers : []),
    ].map((item) => {
        const title = firstLocalizedString(item?.title, item?.name) || 'Trailer';
        return {
            source: 'gog',
            title,
            name: title,
            url: firstString(item?.url, item?.video_url, item?.videoUrl, item?.external_url, item?.externalUrl) ||
                (item?.provider === 'youtube' && item?.provider_video_id ? `https://www.youtube.com/watch?v=${item.provider_video_id}` : null),
            thumbnail: formatGogImage(item?.thumbnail || item?.image, 'jpg'),
            thumbUrl: formatGogImage(item?.thumbnail || item?.image, 'jpg'),
        };
    }).filter((item) => item.url);
}

function pickRatings(entry) {
    const store = entry?._storeProduct || {};
    const page = entry?._storePage || {};
    const candidates = [
        store?.rating,
        store?.ratings,
        store?.aggregateRating,
        store?.aggregated_rating,
        store?.reviews_rating,
        store?.review_rating,
        store?.reviews?.rating,
    ].filter(Boolean);

    const normalizeRating = (raw) => {
        if (raw == null) return null;
        if (typeof raw === 'number') return { source: 'gog', score: raw, max_score: raw <= 5 ? 5 : 100 };
        if (typeof raw !== 'object') return null;
        const score = Number(raw.ratingValue || raw.rating_value || raw.value || raw.score || raw.average || raw.averageRating);
        if (!Number.isFinite(score) || score <= 0) return null;
        const maxScore = Number(raw.bestRating || raw.best_rating || raw.max || raw.max_score) || (score <= 5 ? 5 : 100);
        const total = Number(raw.ratingCount || raw.rating_count || raw.reviewCount || raw.review_count || raw.count || raw.total);
        return {
            source: 'gog',
            score,
            max_score: maxScore,
            total_reviews: Number.isFinite(total) && total > 0 ? total : null,
        };
    };

    for (const raw of candidates) {
        if (Array.isArray(raw)) {
            for (const item of raw) {
                const normalized = normalizeRating(item);
                if (normalized) return [normalized];
            }
            continue;
        }
        const normalized = normalizeRating(raw);
        if (normalized) return [normalized];
    }

    for (const blob of extractJsonBlobsFromHtml(page?.html)) {
        const found = walkObjects(blob, (obj) => {
            if (obj.aggregateRating) return normalizeRating(obj.aggregateRating);
            if (String(obj['@type'] || '').toLowerCase().includes('aggregaterating')) return normalizeRating(obj);
            return null;
        });
        if (found) return [found];
    }

    const productCard = extractWindowProductCardFromHtml(page?.html);
    const productCardRating = walkObjects(productCard, (obj) => {
        if (obj.aggregateRating) return normalizeRating(obj.aggregateRating);
        const direct = normalizeRating(obj.rating || obj.reviewsRating || obj.reviewRating);
        if (direct) return direct;
        return null;
    });
    if (productCardRating) return [productCardRating];

    return [];
}

function getRawLibraryEntry(entry) {
    return entry?._libraryEntry && typeof entry._libraryEntry === 'object' ? entry._libraryEntry : {};
}

function getGogIdentity(entry) {
    const raw = getRawLibraryEntry(entry);
    const galaxyExternalId = firstString(raw.external_id, raw.product_id, raw.productId);
    const gamesDbExternalId = firstString(entry?.external_id);
    const releasePerPlatformId = firstString(
        entry?.release_per_platform_id,
        entry?.releasePerPlatformId,
        raw.release_per_platform_id,
        raw.releasePerPlatformId
    );
    return {
        localGameId: firstString(entry?.localGameId),
        canonicalGameId: firstString(entry?.canonicalGameId),
        galaxyLibraryEntryId: firstString(raw.id),
        galaxyExternalId,
        galaxyCertificatePresent: Boolean(raw.certificate),
        gamesDbReleaseId: firstString(entry?.id),
        gamesDbGameId: firstString(entry?.game_id, entry?.gameId),
        gamesDbExternalId,
        releasePerPlatformId,
        gogProductId: firstString(entry?.gogProductId),
        contentSystemProductId: firstString(entry?.contentSystemProductId),
        gogdlAppName: firstString(entry?.gogdlAppName),
        storeSlug: firstString(
            entry?._storeProduct?.slug,
            entry?._storeProduct?._catalogProduct?.slug,
            raw.slug,
            entry?.slug,
            entry?.product_slug
        ),
        identitySource: raw.external_id ? 'gog-library-external-id' : (gamesDbExternalId ? 'gamesdb-external-id' : 'unknown'),
    };
}

function getProductId(entry) {
    const identity = getGogIdentity(entry);
    return firstString(
        identity.galaxyExternalId,
        identity.gamesDbExternalId,
        entry?.product_id,
        entry?.productId,
        entry?.game_id,
        entry?._embedded?.product?.id,
        entry?.product?.id
    );
}

function isConfidentNonGame(entry) {
    const type = asString(
        entry?.product_type ||
        entry?.productType ||
        entry?._embedded?.product?.product_type ||
        entry?.product?.product_type ||
        entry?.type
    ).toLowerCase();
    if (['dlc', 'extra', 'bonus', 'soundtrack', 'tool', 'demo', 'movie'].includes(type)) return true;

    const tags = [
        ...(Array.isArray(entry?.tags) ? entry.tags : []),
        ...(Array.isArray(entry?.categories) ? entry.categories : []),
    ].map((tag) => asString(tag?.name || tag).toLowerCase());
    return tags.some((tag) => ['dlc', 'soundtrack', 'bonus content', 'tool'].includes(tag));
}

function isAmazonPrimeEntitlement(entry, title = '') {
    const values = [
        title,
        entry?.title?.['*'],
        entry?.game?.title?.['*'],
        entry?.title,
        entry?.name,
        entry?._embedded?.product?.title,
        entry?.product?.title,
        entry?._libraryEntry?.title?.['*'],
        entry?._libraryEntry?.title,
        entry?._libraryEntry?.name,
    ];

    return values.some((value) => /\bamazon\s+prime\b/i.test(asString(value)));
}

function normalizeGogRelease(entry, account, { now = () => new Date().toISOString() } = {}) {
    if (!entry || typeof entry !== 'object') return null;
    if (isConfidentNonGame(entry)) return null;

    const identity = getGogIdentity(entry);
    const productId = getProductId(entry);
    if (!productId) return null;

    const title = firstString(
        entry?.title?.['*'],
        entry?.game?.title?.['*'],
        entry?.title,
        entry?.name,
        entry?._embedded?.product?.title,
        entry?.product?.title,
        `GOG ${productId}`
    );
    if (isAmazonPrimeEntitlement(entry, title)) return null;

    const accountId = asString(account?.id);
    const displayName = firstString(account?.displayName, `GOG ${accountId.slice(-6)}`);
    const description = pickDescription(entry, title);
    const shortDescription = pickShortDescription(entry, description);
    const genres = pickGenres(entry);
    const screenshots = pickScreenshots(entry);
    const allTrailers = pickTrailers(entry);
    const developer = pickDeveloper(entry);
    const publisher = pickPublisher(entry);
    const releaseDate = pickReleaseDate(entry);
    const requirements = pickRequirements(entry);
    const ratings = pickRatings(entry);

    return {
        id: `gog_${productId}`,
        title,
        platform: 'gog',
        source: 'gog',
        appName: String(productId),
        productId: String(productId),
        gogProductId: identity.gogProductId || null,
        contentSystemProductId: identity.contentSystemProductId || null,
        gogdlAppName: identity.gogdlAppName || null,
        gogIdentity: identity,
        allIds: { gog: String(productId) },
        coverUrl: pickArtwork(entry, 'cover'),
        heroUrl: pickArtwork(entry, 'hero'),
        logoUrl: pickArtwork(entry, 'logo'),
        short_description: shortDescription,
        description,
        genres,
        developer,
        publisher,
        releaseDate,
        info: {
            short_description: shortDescription,
            description,
            genres,
            developer,
            publisher,
            releaseDate,
            screenshots,
            allTrailers,
            requirements,
            ratings,
        },
        ratings,
        lastSynced: now(),
        ownedBy: displayName ? [displayName] : [],
        ownedByAccountIds: accountId ? [accountId] : [],
        installOnly: false,
    };
}

function mergeGogGames(mergedLibrary, games, account) {
    const aid = asString(account?.id);
    const displayName = firstString(account?.displayName, `GOG ${aid.slice(-6)}`);
    for (const game of games || []) {
        const existing = mergedLibrary.get(game.id);
        if (!existing) {
            mergedLibrary.set(game.id, JSON.parse(JSON.stringify(game)));
            continue;
        }
        if (!Array.isArray(existing.ownedBy)) existing.ownedBy = [];
        if (!Array.isArray(existing.ownedByAccountIds)) existing.ownedByAccountIds = [];
        if (displayName && !existing.ownedBy.includes(displayName)) existing.ownedBy.push(displayName);
        if (aid && !existing.ownedByAccountIds.map(String).includes(aid)) existing.ownedByAccountIds.push(aid);
        for (const key of ['coverUrl', 'heroUrl', 'logoUrl']) {
            if (!existing[key] && game[key]) existing[key] = game[key];
        }
        for (const key of ['short_description', 'description', 'developer', 'publisher', 'releaseDate']) {
            if (!existing[key] && game[key]) existing[key] = game[key];
        }
        if (!Array.isArray(existing.genres) || existing.genres.length === 0) existing.genres = game.genres || [];
        existing.info = {
            ...(game.info || {}),
            ...(existing.info || {}),
        };
        for (const key of ['short_description', 'description', 'developer', 'publisher', 'releaseDate']) {
            if (!existing.info[key] && game.info?.[key]) existing.info[key] = game.info[key];
        }
        for (const key of ['genres', 'screenshots', 'allTrailers']) {
            if ((!Array.isArray(existing.info[key]) || existing.info[key].length === 0) && Array.isArray(game.info?.[key])) {
                existing.info[key] = game.info[key];
            }
        }
        if (!existing.info.requirements && game.info?.requirements) existing.info.requirements = game.info.requirements;
        if ((!Array.isArray(existing.info.ratings) || existing.info.ratings.length === 0) && Array.isArray(game.info?.ratings)) {
            existing.info.ratings = game.info.ratings;
        }
        if ((!Array.isArray(existing.ratings) || existing.ratings.length === 0) && Array.isArray(game.ratings)) {
            existing.ratings = game.ratings;
        }
        if (!game.logoUrl) {
            existing.logoUrl = null;
            existing.logo = null;
        }
    }
}

module.exports = {
    normalizeGogRelease,
    mergeGogGames,
    isConfidentNonGame,
};
