'use strict';

/**
 * Escape a value for safe insertion into HTML text / attribute context.
 * Always returns a string.
 */
function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#x27;');
}

/**
 * Set element.textContent safely, coercing to string.
 * Preferred over innerHTML for plain text.
 */
function safeText(el, value) {
    if (el) el.textContent = value != null ? String(value) : '';
}

// ── Trusted file:// prefixes ──────────────────────────────────────────────────
// Set is populated at script load from the preload-injected global, then optionally
// extended via setSafeImageCacheDir() / addTrustedFileDir().
const _trustedFilePrefixes = new Set();

/**
 * Normalize a file:// URL for case-insensitive Windows path comparison.
 * Decodes percent-encoding, lowercases, normalises slashes and the
 * "file://" vs "file:///" difference on Windows.
 */
function _normalizeFileUrlForCompare(url) {
    try {
        // Decode percent-encoded chars (e.g. %20 → space), then lowercase
        return decodeURIComponent(url).replace(/\\/g, '/').toLowerCase();
    } catch {
        return url.replace(/\\/g, '/').toLowerCase();
    }
}

function _normalizeTrustedFileUrlForCompare(url) {
    try {
        const parsed = new URL(String(url));
        if (parsed.protocol !== 'file:') return '';
        const decodedPath = decodeURIComponent(parsed.pathname || '').replace(/\\/g, '/');
        if (/(^|\/)\.\.(\/|$)/.test(decodedPath)) return '';
        const segments = decodedPath.split('/').filter(Boolean);
        const normalizedPath = '/' + segments.join('/');
        const host = parsed.hostname ? `${parsed.hostname}` : '';
        return `file://${host}${normalizedPath}${String(url).endsWith('/') ? '/' : ''}`.toLowerCase();
    } catch {
        return '';
    }
}

/**
 * Register a directory as a trusted source for file:// image/media URLs.
 * Call once at startup with the app's image-cache directory URL.
 * Accepts either file:// URL strings or plain absolute path strings.
 */
function setSafeImageCacheDir(dirFileUrl) {
    if (!dirFileUrl) return;
    let s = String(dirFileUrl).trim();
    // Accept plain paths too — convert to file:// first
    if (!s.startsWith('file://')) {
        s = 'file://' + (s.startsWith('/') ? '' : '/') + s.replace(/\\/g, '/');
    }
    // Ensure trailing slash so prefix matching is directory-scoped
    if (!s.endsWith('/')) s += '/';
    const normalized = _normalizeTrustedFileUrlForCompare(s);
    if (normalized) _trustedFilePrefixes.add(normalized.endsWith('/') ? normalized : `${normalized}/`);
}

/** Alias — add an additional trusted directory (e.g. a second cache location). */
const addTrustedFileDir = setSafeImageCacheDir;

/** Returns true if a file:// URL lives inside one of the registered trusted dirs. */
function _isTrustedFileUrl(url) {
    if (_trustedFilePrefixes.size === 0) return false;
    const norm = _normalizeTrustedFileUrlForCompare(url);
    if (!norm) return false;
    for (const prefix of _trustedFilePrefixes) {
        if (norm.startsWith(prefix)) return true;
    }
    return false;
}

// ── Protocol blocklist helper ────────────────────────────────────────────────
function _isDangerousUrl(s) {
    const lower = s.toLowerCase();
    return (
        lower.startsWith('javascript:') ||
        lower.startsWith('vbscript:')   ||
        lower.startsWith('data:text/')  ||
        lower.startsWith('data:application/') ||
        lower.startsWith('//')           // protocol-relative (//evil.com)
    );
}

// ── safeImageUrl ─────────────────────────────────────────────────────────────

/**
 * Validate and return a URL safe for use in img src / background-image.
 *
 * Allowed:
 *   https://, http://, blob:, data:image/*
 *   Relative app-asset paths: ./assets/, ../assets/, assets/, or no-protocol paths
 *   file:// only when inside a registered trusted directory
 *
 * Blocked:
 *   javascript:, vbscript:, data:text/html, //evil.com, arbitrary file:// paths
 */
function safeImageUrl(value) {
    if (!value) return '';
    const s = String(value).trim();
    if (_isDangerousUrl(s)) return '';

    if (
        s.startsWith('https://') ||
        s.startsWith('http://')  ||
        s.startsWith('blob:')    ||
        s.startsWith('data:image/')
    ) {
        return s;
    }

    if (s.startsWith('file://')) {
        return _isTrustedFileUrl(s) ? s : '';
    }

    // Relative paths for bundled app assets
    if (
        s.startsWith('../') ||
        s.startsWith('./') ||
        s.startsWith('assets/') ||
        (!s.includes(':') && !s.startsWith('//'))
    ) {
        return s;
    }

    return '';
}

// ── safeMediaUrl ─────────────────────────────────────────────────────────────

/**
 * Validate a URL for use as a video/media source (video.src, HLS, DASH).
 *
 * Allowed:
 *   https:// (YouTube watch/embed, direct mp4/webm/m3u8/mpd, CDN streams)
 *   blob:, data:video/*
 *   file:// inside a trusted directory
 *
 * Blocked: same protocol blocklist as safeImageUrl.
 */
function safeMediaUrl(value) {
    if (!value) return '';
    const s = String(value).trim();
    if (_isDangerousUrl(s)) return '';

    if (
        s.startsWith('https://') ||
        s.startsWith('http://')  ||
        s.startsWith('blob:')    ||
        s.startsWith('data:video/')
    ) {
        return s;
    }

    if (s.startsWith('file://')) {
        return _isTrustedFileUrl(s) ? s : '';
    }

    return '';
}

// ── safeEmbedUrl ─────────────────────────────────────────────────────────────

/**
 * Validate a URL for use in an iframe embed.
 * ONLY allows YouTube embed URLs — no other origins.
 */
function safeEmbedUrl(value) {
    if (!value) return '';
    const s = String(value).trim();
    if (/^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\/[a-zA-Z0-9_\-]{11}(\?|$)/.test(s)) {
        return s;
    }
    return '';
}

/**
 * Validate and return a URL safe for href/openExternal use.
 * Only allows https:// and known game store protocols.
 */
function safeExternalUrl(value) {
    if (!value) return '';
    const s = String(value).trim();
    const ALLOWED = ['https://', 'steam://', 'com.epicgames.launcher://', 'origin://', 'uplay://', 'rockstar://'];
    if (ALLOWED.some(p => s.startsWith(p))) return s;
    return '';
}

// ── Bootstrap trust from preload-injected synchronous global ─────────────────
// preload.js exposes window.__BADDEL_CACHE_URL__ before any JS runs, so by the
// time domUtils.js executes this block the value is already available.
if (typeof window !== 'undefined' && typeof window.__BADDEL_CACHE_URL__ === 'string') {
    setSafeImageCacheDir(window.__BADDEL_CACHE_URL__);
}
if (typeof window !== 'undefined' && typeof window.__BADDEL_ARTWORK_CACHE_URL__ === 'string') {
    setSafeImageCacheDir(window.__BADDEL_ARTWORK_CACHE_URL__);
}
if (typeof window !== 'undefined' && typeof window.__BADDEL_USER_ARTWORK_URL__ === 'string') {
    setSafeImageCacheDir(window.__BADDEL_USER_ARTWORK_URL__);
}

// ── Exports ──────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        safeText,
        safeImageUrl,
        safeMediaUrl,
        safeEmbedUrl,
        safeExternalUrl,
        setSafeImageCacheDir,
        addTrustedFileDir,
    };
} else if (typeof window !== 'undefined') {
    window.escapeHtml          = escapeHtml;
    window.safeText            = safeText;
    window.safeImageUrl        = safeImageUrl;
    window.safeMediaUrl        = safeMediaUrl;
    window.safeEmbedUrl        = safeEmbedUrl;
    window.safeExternalUrl     = safeExternalUrl;
    window.setSafeImageCacheDir = setSafeImageCacheDir;
    window.addTrustedFileDir   = addTrustedFileDir;
}
