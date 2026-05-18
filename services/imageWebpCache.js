/**
 * services/imageWebpCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Downloads remote image URLs to a local cache directory and converts them to
 * WebP format when possible.  Used by main.js IPC handlers and the background
 * metadata pipeline to persist art assets locally so the app works offline and
 * avoids re-fetching the same images on every launch.
 *
 * Exports:
 *   downloadToCacheAsWebp(cacheDir, baseName, url)  → Promise<string|null>
 *   filePathToFileUrl(absPath)                       → string
 *
 * Sharp is an optional peer dependency.  If it is not installed the module
 * degrades gracefully: the raw downloaded bytes are saved as-is and the caller
 * receives the local path without WebP conversion.
 */

'use strict';

const fs       = require('fs');
const fsP      = require('fs').promises;
const path     = require('path');
const https    = require('https');
const dns      = require('dns').promises;
const { URL }  = require('url');

// ── Optional sharp dependency ────────────────────────────────────────────────
let sharp = null;
try {
    sharp = require('sharp');
} catch {
    // sharp not installed — images are saved as-is (jpg/png)
    console.log('[imageWebpCache] sharp not available — images will be cached in original format (no WebP conversion)');
}

// ── Constants ────────────────────────────────────────────────────────────────
const DOWNLOAD_TIMEOUT_MS  = 15_000;
const MAX_REDIRECT_DEPTH   = 5;
const MIN_VALID_SIZE_BYTES = 512;    // anything smaller is probably an error page
const MAX_RESPONSE_BYTES   = 10 * 1024 * 1024;  // 10 MB hard limit

// IPv4 private / loopback / link-local ranges for SSRF protection
const PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,
    /^::1$/,
    /^fc/i,
    /^fd/i,
];

async function _isPrivateHost(hostname) {
    // Numeric IPv4 / IPv6 literals — check directly
    if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
        return PRIVATE_IP_PATTERNS.some(r => r.test(hostname));
    }
    try {
        const { address } = await dns.lookup(hostname, { family: 4 });
        return PRIVATE_IP_PATTERNS.some(r => r.test(address));
    } catch {
        return false; // if DNS fails let the request fail naturally
    }
}

// ── Format detection ─────────────────────────────────────────────────────────
function _detectFormat(buf) {
    if (!buf || buf.length < 4) return 'jpg';
    if (buf[0] === 0xFF && buf[1] === 0xD8)                                         return 'jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)  return 'png';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)                     return 'gif';
    return 'jpg';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a local absolute path to a file:// URL, normalising Windows
 * backslashes and ensuring proper forward-slash encoding.
 * @param {string} absPath
 * @returns {string}
 */
function filePathToFileUrl(absPath) {
    if (!absPath) return '';
    // Already a file URL — return unchanged
    if (absPath.startsWith('file://')) return absPath;
    const normalised = absPath.replace(/\\/g, '/');
    return `file://${normalised.startsWith('/') ? normalised : '/' + normalised}`;
}

/**
 * Perform a single HTTPS GET with a timeout, private-IP guard, content-type
 * validation, size cap, and limited redirect following.
 * @returns {Promise<Buffer>}
 */
async function _fetchBuffer(rawUrl, redirectDepth = 0) {
    if (redirectDepth > MAX_REDIRECT_DEPTH) {
        throw new Error(`Too many redirects for ${rawUrl}`);
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid URL: ${rawUrl}`);
    }

    if (parsed.protocol !== 'https:') {
        throw new Error(`Only HTTPS URLs are allowed (got ${parsed.protocol})`);
    }

    if (await _isPrivateHost(parsed.hostname)) {
        throw new Error(`Blocked request to private/internal host: ${parsed.hostname}`);
    }

    return new Promise((resolve, reject) => {
        const req = https.get(rawUrl, { timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
            // Follow redirects (301/302/303/307/308)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const next = new URL(res.headers.location, rawUrl).href;
                return resolve(_fetchBuffer(next, redirectDepth + 1));
            }

            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${rawUrl}`));
            }

            const ct = (res.headers['content-type'] || '').toLowerCase();
            if (!ct.startsWith('image/') && !ct.startsWith('application/octet-stream')) {
                res.resume();
                return reject(new Error(`Unexpected content-type "${ct}" for ${rawUrl}`));
            }

            let received = 0;
            const chunks = [];
            res.on('data', (c) => {
                received += c.length;
                if (received > MAX_RESPONSE_BYTES) {
                    req.destroy();
                    return reject(new Error(`Response too large (>${MAX_RESPONSE_BYTES / 1e6} MB) for ${rawUrl}`));
                }
                chunks.push(c);
            });
            res.on('end',   ()  => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });

        req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout: ${rawUrl}`)); });
        req.on('error',   reject);
    });
}

/**
 * Derive a safe local file name from baseName + format extension.
 * baseName is expected to be `${type}_${gameId}` (e.g. "cover_abc123def456").
 */
function _localFileName(baseName, useWebp) {
    // Sanitise baseName to avoid path traversal
    const safe = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    return `${safe}.${useWebp ? 'webp' : 'jpg'}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Download `url` and save it into `cacheDir` as `baseName.webp` (or baseName.jpg
 * if sharp is unavailable).  Returns the absolute local path on success or null
 * on any failure.  Never throws — all errors are caught and logged internally.
 *
 * @param {string} cacheDir   - Absolute path to the cache directory (must exist or be creatable).
 * @param {string} baseName   - File name stem, e.g. "cover_abc123" (no extension).
 * @param {string} url        - Remote image URL to download.
 * @returns {Promise<string|null>}
 */
async function downloadToCacheAsWebp(cacheDir, baseName, url) {
    if (!url || !baseName || !cacheDir) return null;
    // Skip local / data URIs — nothing to download
    if (url.startsWith('file://') || url.startsWith('data:')) return null;

    // Ensure cache directory exists
    try {
        await fsP.mkdir(cacheDir, { recursive: true });
    } catch (err) {
        console.warn(`[imageWebpCache] mkdir failed for "${cacheDir}":`, err.message);
        return null;
    }

    const useWebp   = !!sharp;
    const fileName  = _localFileName(baseName, useWebp);
    const localPath = path.join(cacheDir, fileName);
    const safeName  = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_');

    // Return early if already cached (webp or original-format fallback)
    try {
        const stat = fs.statSync(localPath);
        if (stat.size >= MIN_VALID_SIZE_BYTES) return localPath;
    } catch { /* not cached yet */ }
    for (const ext of ['jpg', 'png', 'gif']) {
        if (ext === (useWebp ? 'webp' : 'jpg')) continue; // already checked above
        const fallbackPath = path.join(cacheDir, `${safeName}.${ext}`);
        try {
            const stat = fs.statSync(fallbackPath);
            if (stat.size >= MIN_VALID_SIZE_BYTES) return fallbackPath;
        } catch { /* not there */ }
    }

    try {
        const buf = await _fetchBuffer(url);

        if (!buf || buf.length < MIN_VALID_SIZE_BYTES) {
            console.warn(`[imageWebpCache] Downloaded file too small (${buf?.length ?? 0}B) — skipping "${baseName}"`);
            return null;
        }

        if (sharp) {
            try {
                await sharp(buf).webp({ quality: 85 }).toFile(localPath);
                console.log(`[imageWebpCache] ✓ Cached "${fileName}" (${(buf.length / 1024).toFixed(1)} KB → ${localPath})`);
                return localPath;
            } catch (sharpErr) {
                // WebP conversion failed (mux error, unsupported format, etc.) — save original
                try { fs.unlinkSync(localPath); } catch { /* partial write */ }
                const origExt  = _detectFormat(buf);
                const origName = `${safeName}.${origExt}`;
                const origPath = path.join(cacheDir, origName);
                await fsP.writeFile(origPath, buf);
                console.warn(`[ImageCacheFallback] webp failed (${sharpErr.message.slice(0, 80)}) -> saved original as ${origName}`);
                return origPath;
            }
        } else {
            await fsP.writeFile(localPath, buf);
            console.log(`[imageWebpCache] ✓ Cached "${fileName}" (${(buf.length / 1024).toFixed(1)} KB → ${localPath})`);
            return localPath;
        }

    } catch (err) {
        console.warn(`[imageWebpCache] ✗ Failed to cache "${baseName}" from "${url}":`, err.message);
        try { fs.unlinkSync(localPath); } catch { /* ignore */ }
        return null;
    }
}

// ── Shared cache-key helper ──────────────────────────────────────────────────

/**
 * Return the base file name (no extension) for a cached asset.
 * Used by every writer and reader so the format never diverges.
 *
 * @param {'cover'|'hero'|'logo'} type
 * @param {string} gameId
 * @returns {string}  e.g. "cover_abc123def456"
 */
function cacheBaseName(type, gameId) {
    return `${type}_${String(gameId)}`;
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = { downloadToCacheAsWebp, filePathToFileUrl, cacheBaseName };
