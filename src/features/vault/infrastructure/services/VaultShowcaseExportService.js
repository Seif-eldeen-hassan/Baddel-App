'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const crypto = require('crypto');
const { fileURLToPath } = require('url');

const EXPORT_WIDTH = 1920;
const TILE_HEIGHT = 4096;
const MAX_OUTPUT_HEIGHT = 120000;
const MAX_OUTPUT_PIXELS = 230400000;
const MAX_GAMES = 5000;
const CLIPBOARD_MAX_PIXELS = 36000000;
const CLIPBOARD_MAX_BYTES = 64 * 1024 * 1024;
const COVER_SOURCE_RE = /^(file:|app:|baddel-cache:|data:image\/(?:png|jpe?g|webp);base64,)/i;

class VaultExportError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'VaultExportError';
        this.code = code;
        if (cause) this.cause = cause;
    }
}

function buildTilePlan(width, height, tileHeight = TILE_HEIGHT) {
    const safeWidth = Math.trunc(Number(width));
    const safeHeight = Math.trunc(Number(height));
    const safeTileHeight = Math.max(1, Math.min(TILE_HEIGHT, Math.trunc(Number(tileHeight) || TILE_HEIGHT)));
    if (safeWidth !== EXPORT_WIDTH || safeHeight < 1) throw new VaultExportError('VAULT_EXPORT_RENDER_FAILED', 'The export renderer returned invalid dimensions.');
    if (safeHeight > MAX_OUTPUT_HEIGHT || safeWidth * safeHeight > MAX_OUTPUT_PIXELS) {
        throw new VaultExportError('VAULT_EXPORT_RENDER_FAILED', `The calculated ${safeWidth}x${safeHeight} showcase exceeds the supported PNG limit.`);
    }
    const tiles = [];
    for (let offset = 0; offset < safeHeight; offset += safeTileHeight) {
        tiles.push({ index: tiles.length, offset, height: Math.min(safeTileHeight, safeHeight - offset), width: safeWidth });
    }
    return tiles;
}

function validateViewportMeasurement(value) {
    const viewport = value?.viewport || value;
    const width = Number(viewport?.width);
    const height = Number(viewport?.height);
    const dpr = Number(viewport?.dpr);
    const layoutWidth = Number(value?.width ?? viewport?.layoutWidth);
    if (layoutWidth !== EXPORT_WIDTH || width !== EXPORT_WIDTH || !Number.isFinite(height) || height < 1 || !Number.isFinite(dpr) || dpr <= 0) {
        throw new VaultExportError('VAULT_EXPORT_RENDER_FAILED', 'The export renderer viewport is invalid.');
    }
    return { width, height: Math.trunc(height), dpr, layoutWidth };
}

async function normalizeCapturedTile({ sharp, fsApi = fs, rawPath, tilePath, tile, viewport, rawMetadata, tolerance = 0.01 }) {
    const rawWidth = Math.trunc(Number(rawMetadata?.width));
    const rawHeight = Math.trunc(Number(rawMetadata?.height));
    if (rawWidth < 1 || rawHeight < 1) throw new VaultExportError('VAULT_EXPORT_CAPTURE_FAILED', 'The captured tile has invalid dimensions.');
    const expectedRawWidth = Math.round(viewport.width * viewport.dpr);
    const expectedRawHeight = Math.round(viewport.height * viewport.dpr);
    const roundingTolerance = 2;
    if (rawWidth + roundingTolerance < expectedRawWidth || rawHeight + roundingTolerance < expectedRawHeight) {
        throw new VaultExportError('VAULT_EXPORT_CAPTURE_FAILED', 'Captured tile ' + (tile.index + 1) + ' was shorter than the measured viewport.');
    }
    const scaleX = rawWidth / viewport.width;
    const scaleY = rawHeight / viewport.height;
    if (Math.abs(scaleX - scaleY) > Math.max(tolerance, 2 / Math.max(viewport.width, viewport.height))) {
        throw new VaultExportError('VAULT_EXPORT_CAPTURE_FAILED', 'Captured tile ' + (tile.index + 1) + ' has inconsistent horizontal and vertical scale.');
    }
    const cropHeight = Math.min(rawHeight, Math.round(tile.height * scaleY));
    if (cropHeight < 1) throw new VaultExportError('VAULT_EXPORT_CAPTURE_FAILED', 'Captured tile ' + (tile.index + 1) + ' has an invalid crop height.');
    const normalizedPath = tilePath + '.normalized.png';
    await sharp(rawPath, { limitInputPixels: false })
        .extract({ left: 0, top: 0, width: rawWidth, height: cropHeight })
        .resize({ width: tile.width })
        .png()
        .toFile(normalizedPath);
    const normalized = await sharp(normalizedPath, { limitInputPixels: false }).metadata();
    if (normalized.width !== tile.width || Number(normalized.height) < tile.height) {
        throw new VaultExportError('VAULT_EXPORT_CAPTURE_FAILED', 'Captured tile ' + (tile.index + 1) + ' could not be normalized without stretching.');
    }
    if (normalized.height === tile.height) {
        await fsApi.rename(normalizedPath, tilePath);
    } else {
        await sharp(normalizedPath, { limitInputPixels: false })
            .extract({ left: 0, top: 0, width: tile.width, height: tile.height })
            .png()
            .toFile(tilePath);
        await fsApi.unlink(normalizedPath).catch(() => {});
    }
    return { rawWidth, rawHeight, expectedRawWidth, expectedRawHeight, scaleX, scaleY, cropHeight, outputWidth: tile.width, outputHeight: tile.height };
}
function safeFilenamePart(value) {
    const clean = String(value || '').trim();
    if (!clean || clean.includes('@') || /^[a-f0-9-]{24,}$/i.test(clean)) return 'Account';
    return clean.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').replace(/\s+/g, '-').slice(0, 60) || 'Account';
}

function defaultFilename(snapshot) {
    const date = String(snapshot.generatedAt || new Date().toISOString()).slice(0, 10);
    return `Baddel-Epic-Vault-${safeFilenamePart(snapshot.displayName)}-${date}.png`;
}

function assertMoneyLines(lines, field) {
    if (!Array.isArray(lines) || lines.length > 32) throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', `${field} is invalid.`);
    for (const line of lines) {
        if (!line || !/^[A-Z]{3}$/.test(String(line.currency || '')) || !Number.isSafeInteger(line.minorUnits) || typeof line.text !== 'string' || line.text.length > 80) {
            throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', `${field} contains an invalid currency line.`);
        }
    }
}

function validateSnapshot(input, { isTrustedCoverSource = null } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1 || input.width !== EXPORT_WIDTH) {
        throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'The Vault export request is malformed.');
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(String(input.generatedAt || '')) || Number.isNaN(Date.parse(input.generatedAt))) {
        throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'The Vault export date is invalid.');
    }
    if (input.displayName != null && (typeof input.displayName !== 'string' || input.displayName.length > 80 || input.displayName.includes('@'))) {
        throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'The Vault display name is not safe.');
    }
    if (input.priceDataAt != null && Number.isNaN(Date.parse(String(input.priceDataAt)))) {
        throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'The Vault price timestamp is invalid.');
    }
    const displayOptionKeys = ['currentLibraryValue', 'totalPaid', 'totalRefunded', 'netSpend'];
    const displayOptions = input.displayOptions == null
        ? Object.fromEntries(displayOptionKeys.map((key) => [key, true]))
        : input.displayOptions;
    if (!displayOptions || typeof displayOptions !== 'object' || Array.isArray(displayOptions)
        || displayOptionKeys.some((key) => typeof displayOptions[key] !== 'boolean')) {
        throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'Vault export display options must be strict booleans.');
    }
    const expectedSections = ['priced', 'price_unavailable'];
    if (!Array.isArray(input.sections) || input.sections.length !== 2) throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'The Vault export sections are invalid.');
    let gameCount = 0;
    const sections = input.sections.map((section, sectionIndex) => {
        if (!section || section.key !== expectedSections[sectionIndex] || !Array.isArray(section.games)) {
            throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'The Vault export section order is invalid.');
        }
        gameCount += section.games.length;
        if (gameCount > MAX_GAMES) throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'The Vault export contains too many games.');
        const games = section.games.map((game) => {
            if (!game || typeof game.key !== 'string' || !game.key || game.key.length > 300 || typeof game.title !== 'string' || game.title.length > 160) {
                throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'A Vault export game is malformed.');
            }
            if (game.priceStatus !== section.key) throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'A Vault game has an invalid price status.');
            const coverSource = game.coverSource == null ? null : String(game.coverSource);
            if (coverSource && (!COVER_SOURCE_RE.test(coverSource) || coverSource.length > 2_000_000)) {
                throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'A Vault cover source is not trusted.');
            }
            if (coverSource && typeof isTrustedCoverSource === 'function' && !isTrustedCoverSource(coverSource)) {
                throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'A Vault cover source is outside trusted artwork storage.');
            }
            const clean = { key: game.key, title: game.title, coverSource, priceStatus: game.priceStatus };
            if (section.key === 'priced') {
                if (!Number.isSafeInteger(game.priceMinor) || !/^[A-Z]{3}$/.test(String(game.priceCurrency || ''))) {
                    throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'A priced Vault game is malformed.');
                }
                clean.priceMinor = game.priceMinor;
                clean.priceCurrency = game.priceCurrency;
            }
            return clean;
        });
        return { key: section.key, title: section.key === 'priced' ? 'Priced Games' : 'Price Unavailable', count: games.length, games };
    });
    if (!gameCount) throw new VaultExportError('VAULT_EXPORT_NO_ELIGIBLE_GAMES', 'This Vault has no genuine games to export.');
    const financials = input.financials || {};
    assertMoneyLines(financials.currentLibraryValue, 'Current Epic Library Value');
    assertMoneyLines(financials.totalPaid, 'Total Paid');
    assertMoneyLines(financials.totalRefunded, 'Total Refunded');
    assertMoneyLines(financials.netSpend, 'Net Spend');
    const counts = { ...(input.counts || {}) };
    const accountedCanonical = Number(counts.included || 0) + Number(counts.freeExcluded || 0) + Number(counts.unavailableExcluded || 0) + Number(counts.nonGameExcluded || 0);
    if (counts.canonicalOwned == null) counts.canonicalOwned = accountedCanonical;
    if (counts.duplicatesRemoved == null) counts.duplicatesRemoved = 0;
    if (counts.rawOwned == null) counts.rawOwned = Number(counts.canonicalOwned) + Number(counts.duplicatesRemoved);
    if (counts.priceUnavailable == null) counts.priceUnavailable = sections[1].games.length;
    const countKeys = ['rawOwned', 'canonicalOwned', 'duplicatesRemoved', 'included', 'priced', 'unresolved', 'priceUnavailable', 'freeExcluded', 'unavailableExcluded', 'nonGameExcluded'];
    for (const key of countKeys) if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', `Invalid ${key} count.`);
    if (counts.included !== gameCount || counts.priced !== sections[0].games.length || counts.priceUnavailable !== sections[1].games.length
        || counts.unresolved > counts.priceUnavailable || counts.canonicalOwned !== counts.included + counts.freeExcluded + counts.unavailableExcluded + counts.nonGameExcluded
        || counts.rawOwned !== counts.canonicalOwned + counts.duplicatesRemoved) {
        throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'Vault export counts do not reconcile.');
    }
    return {
        schemaVersion: 1,
        width: EXPORT_WIDTH,
        generatedAt: new Date(input.generatedAt).toISOString(),
        priceDataAt: input.priceDataAt == null ? null : new Date(input.priceDataAt).toISOString(),
        displayName: input.displayName || null,
        displayOptions: Object.fromEntries(displayOptionKeys.map((key) => [key, displayOptions[key]])),
        counts: Object.fromEntries(countKeys.map((key) => [key, counts[key]])),
        financials: {
            currentLibraryValue: financials.currentLibraryValue.map((line) => ({ currency: line.currency, minorUnits: line.minorUnits, text: line.text })),
            currentValueCoverage: Math.max(0, Math.trunc(Number(financials.currentValueCoverage) || 0)),
            historyImported: financials.historyImported === true,
            totalPaid: financials.totalPaid.map((line) => ({ currency: line.currency, minorUnits: line.minorUnits, text: line.text })),
            totalRefunded: financials.totalRefunded.map((line) => ({ currency: line.currency, minorUnits: Math.abs(line.minorUnits), text: line.text })),
            netSpend: financials.netSpend.map((line) => ({ currency: line.currency, minorUnits: line.minorUnits, text: line.text })),
        },
        sections,
    };
}

async function fileSha256(fsApi, filePath) {
    const content = await fsApi.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

function assertContiguousTiles(tiles) {
    for (let index = 1; index < tiles.length; index += 1) {
        if (tiles[index].offset !== tiles[index - 1].offset + tiles[index - 1].height) {
            throw new VaultExportError('VAULT_EXPORT_COMPOSE_FAILED', `Tile ${index} is not contiguous with tile ${index - 1}.`);
        }
    }
}

async function composeTiles({ sharp, tiles, width, height, outputPath }) {
    assertContiguousTiles(tiles);
    if (!sharp) throw new VaultExportError('VAULT_EXPORT_COMPOSE_FAILED', 'Sharp is unavailable.');
    const composite = tiles.map((tile) => ({ input: tile.path, left: 0, top: tile.offset }));
    await sharp({ create: { width, height, channels: 4, background: { r: 8, g: 10, b: 9, alpha: 1 } }, limitInputPixels: false })
        .composite(composite)
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(outputPath);
    const metadata = await sharp(outputPath, { limitInputPixels: false }).metadata();
    if (metadata.width !== width || metadata.height !== height) throw new VaultExportError('VAULT_EXPORT_COMPOSE_FAILED', 'The composed PNG dimensions are incorrect.');
    return metadata;
}

class VaultShowcaseExportService {
    constructor({ BrowserWindow, dialog, clipboard, nativeImage, sharp, exportPagePath, exportPreloadPath, trustedArtworkRoots = [], getParentWindow = () => null, logger = console, fsApi = fs, osApi = os } = {}) {
        this.BrowserWindow = BrowserWindow;
        this.dialog = dialog;
        this.clipboard = clipboard;
        this.nativeImage = nativeImage;
        this.sharp = sharp;
        this.exportPagePath = exportPagePath;
        this.exportPreloadPath = exportPreloadPath;
        this.trustedArtworkRoots = trustedArtworkRoots.map((root) => path.resolve(String(root || ''))).filter(Boolean);
        this.getParentWindow = getParentWindow;
        this.logger = logger;
        this.fs = fsApi;
        this.os = osApi;
        this.sessionsByWebContents = new Map();
        this.savedExports = new Map();
    }

    _isTrustedCoverSource(source) {
        if (/^(?:data:image\/(?:png|jpe?g|webp);base64,|app:|baddel-cache:)/i.test(source)) return true;
        if (!String(source).startsWith('file://')) return false;
        try {
            const candidate = path.resolve(fileURLToPath(source));
            return this.trustedArtworkRoots.some((root) => {
                const relative = path.relative(root, candidate);
                return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
            });
        } catch { return false; }
    }

    _log(stage, fields = {}) {
        this.logger?.info?.('[VaultShowcase]', stage, fields);
    }

    snapshotForSender(sender) {
        const snapshot = this.sessionsByWebContents.get(sender?.id);
        if (!snapshot) throw new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'No export session exists for this renderer.');
        return snapshot;
    }

    _progress(sender, stage, detail = {}) {
        if (!sender?.isDestroyed?.()) sender.send('vault-showcase:progress', { stage, ...detail });
    }

    async export(snapshotInput, sender) {
        let snapshot;
        try { snapshot = validateSnapshot(snapshotInput, { isTrustedCoverSource: (source) => this._isTrustedCoverSource(source) }); }
        catch (error) { throw error instanceof VaultExportError ? error : new VaultExportError('VAULT_EXPORT_SNAPSHOT_FAILED', 'Could not prepare the Vault snapshot.', error); }
        this._log('snapshot_preparation_completed', snapshot.counts);
        this._progress(sender, 'preparing', snapshot.counts);
        const tempDir = await this.fs.mkdtemp(path.join(this.os.tmpdir(), 'baddel-vault-export-'));
        let win = null;
        try {
            win = new this.BrowserWindow({
                show: false,
                frame: false,
                width: EXPORT_WIDTH,
                height: TILE_HEIGHT,
                useContentSize: true,
                backgroundColor: '#080a09',
                webPreferences: {
                    preload: this.exportPreloadPath,
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: true,
                    webSecurity: true,
                    backgroundThrottling: false,
                },
            });
            this.sessionsByWebContents.set(win.webContents.id, snapshot);
            await win.loadFile(this.exportPagePath);
            let renderTimer = null;
            const dimensions = await Promise.race([
                win.webContents.executeJavaScript('window.vaultExportRenderer.whenReady()', true),
                new Promise((_, reject) => {
                    renderTimer = setTimeout(() => reject(new VaultExportError('VAULT_EXPORT_RENDER_FAILED', 'The export renderer timed out.')), 20000);
                    renderTimer.unref?.();
                }),
            ]).finally(() => clearTimeout(renderTimer));
            this._log('viewport_measured', { requestedWindow: { width: EXPORT_WIDTH, height: TILE_HEIGHT }, renderer: dimensions });
            const viewport = validateViewportMeasurement(dimensions);
            const tiles = buildTilePlan(dimensions.width, dimensions.height, viewport.height);
            this._log('dimensions_calculated', {
                requestedWindow: { width: EXPORT_WIDTH, height: TILE_HEIGHT },
                viewport,
                output: { width: dimensions.width, height: dimensions.height },
                tileCount: tiles.length,
            });
            this._progress(sender, 'rendering', { width: dimensions.width, height: dimensions.height, tileCount: tiles.length });
            const captured = [];
            let artworkFailures = 0;
            for (const tile of tiles) {
                const prepared = await win.webContents.executeJavaScript('(async () => { try { return await window.vaultExportRenderer.prepareTile(' + tile.offset + ', ' + tile.height + '); } catch (error) { return { __error: String(error?.message || error), __name: String(error?.name || \'Error\') }; } })()', true);
                if (prepared?.__error) throw new VaultExportError('VAULT_EXPORT_TILE_POSITION_INVALID', 'Tile ' + tile.index + ' preparation failed: ' + prepared.__error);
                const preparedViewport = validateViewportMeasurement({ width: dimensions.width, viewport: prepared?.viewport });
                if (preparedViewport.width !== viewport.width || preparedViewport.height !== viewport.height || Math.abs(preparedViewport.dpr - viewport.dpr) > 0.001) {
                    throw new VaultExportError('VAULT_EXPORT_CAPTURE_FAILED', 'The export viewport changed during capture.');
                }
                if (Math.abs(Number(prepared?.actualShowcaseTop) + tile.offset) > 1 || Number(prepared?.expectedShowcaseTop) !== -tile.offset) {
                    throw new VaultExportError('VAULT_EXPORT_TILE_POSITION_INVALID', `Tile ${tile.index} did not reach its planned document offset.`);
                }
                artworkFailures = Math.max(artworkFailures, Number(prepared?.artworkFailures || 0));
                win.webContents.invalidate?.();
                const confirmed = await win.webContents.executeJavaScript('(async () => { try { return await window.vaultExportRenderer.confirmTile(' + tile.offset + '); } catch (error) { return { __error: String(error?.message || error), __name: String(error?.name || \'Error\') }; } })()', true);
                if (confirmed?.__error) throw new VaultExportError('VAULT_EXPORT_TILE_POSITION_INVALID', 'Tile ' + tile.index + ' repaint confirmation failed: ' + confirmed.__error);
                if (Math.abs(Number(confirmed?.actualShowcaseTop) + tile.offset) > 1) {
                    throw new VaultExportError('VAULT_EXPORT_TILE_POSITION_INVALID', `Tile ${tile.index} moved before capture.`);
                }
                const rawPath = path.join(tempDir, 'tile-' + String(tile.index).padStart(4, '0') + '-raw.png');
                const tilePath = path.join(tempDir, 'tile-' + String(tile.index).padStart(4, '0') + '.png');
                const previous = captured.at(-1);
                let rawHash;
                let normalized;
                let normalizedHash;
                let captureAttempt = 0;
                const maxCaptureAttempts = previous ? 3 : 1;
                while (captureAttempt < maxCaptureAttempts) {
                    captureAttempt += 1;
                    const image = await win.webContents.capturePage({ x: 0, y: 0, width: viewport.width, height: viewport.height });
                    if (image.isEmpty()) throw new VaultExportError('VAULT_EXPORT_CAPTURE_FAILED', 'Capture tile ' + (tile.index + 1) + ' was empty.');
                    await this.fs.writeFile(rawPath, image.toPNG());
                    rawHash = await fileSha256(this.fs, rawPath);
                    const rawMetadata = await this.sharp(rawPath, { limitInputPixels: false }).metadata();
                    normalized = await normalizeCapturedTile({ sharp: this.sharp, fsApi: this.fs, rawPath, tilePath, tile, viewport, rawMetadata });
                    normalizedHash = await fileSha256(this.fs, tilePath);
                    if (!previous || (previous.rawHash !== rawHash && previous.normalizedHash !== normalizedHash)) break;
                    if (captureAttempt >= maxCaptureAttempts) break;
                    this._log('tile_repaint_retry', { tileIndex: tile.index, plannedOffset: tile.offset, captureAttempt, duplicateOfTile: previous.index });
                    win.webContents.invalidate?.();
                    await new Promise((resolve) => setTimeout(resolve, captureAttempt * 50));
                    const retryConfirmation = await win.webContents.executeJavaScript('(async () => { try { return await window.vaultExportRenderer.confirmTile(' + tile.offset + '); } catch (error) { return { __error: String(error?.message || error), __name: String(error?.name || \'Error\') }; } })()', true);
                    if (retryConfirmation?.__error || Math.abs(Number(retryConfirmation?.actualShowcaseTop) + tile.offset) > 1) {
                        throw new VaultExportError('VAULT_EXPORT_TILE_POSITION_INVALID', 'Tile ' + tile.index + ' moved during repaint recovery.');
                    }
                }
                if (previous && (previous.rawHash === rawHash || previous.normalizedHash === normalizedHash)) {
                    throw new VaultExportError('VAULT_EXPORT_DUPLICATE_TILE', `Tiles ${previous.index} and ${tile.index} captured identical content at different offsets.`);
                }
                const diagnostics = {
                    tileIndex: tile.index,
                    plannedOffset: tile.offset,
                    plannedHeight: tile.height,
                    actualShowcaseTop: Number(prepared.actualShowcaseTop),
                    expectedShowcaseTop: -tile.offset,
                    viewport,
                    rawCapture: { width: normalized.rawWidth, height: normalized.rawHeight, sha256: rawHash },
                    expectedRaw: { width: normalized.expectedRawWidth, height: normalized.expectedRawHeight },
                    captureScale: { horizontal: normalized.scaleX, vertical: normalized.scaleY },
                    crop: { width: normalized.rawWidth, height: normalized.cropHeight },
                    normalizedTile: { width: normalized.outputWidth, height: normalized.outputHeight, sha256: normalizedHash },
                    visiblePosters: { firstKey: prepared.firstPosterKey, firstIndex: prepared.firstPosterIndex, lastKey: prepared.lastPosterKey, lastIndex: prepared.lastPosterIndex },
                    compositeDestinationTop: tile.offset,
                    captureAttempt,
                };
                this._log('tile_captured', diagnostics);
                await this.fs.unlink(rawPath).catch(() => {});
                captured.push({ ...tile, path: tilePath, rawHash, normalizedHash, diagnostics });
                this._progress(sender, 'capturing', { current: tile.index + 1, total: tiles.length, artworkFailures });
            }
            this.sessionsByWebContents.delete(win.webContents.id);
            win.destroy();
            win = null;
            const composedPath = path.join(tempDir, 'showcase.png');
            await composeTiles({ sharp: this.sharp, tiles: captured, width: EXPORT_WIDTH, height: dimensions.height, outputPath: composedPath });
            this._log('artwork_preparation_completed', { requested: snapshot.counts.included, failures: artworkFailures });
            this._log('sharp_composition_completed', { width: EXPORT_WIDTH, height: dimensions.height, tiles: captured.length });
            this._progress(sender, 'saving', { width: EXPORT_WIDTH, height: dimensions.height });
            const result = await this.dialog.showSaveDialog(this.getParentWindow() || undefined, {
                title: 'Save Vault Showcase',
                defaultPath: defaultFilename(snapshot),
                filters: [{ name: 'PNG Image', extensions: ['png'] }],
                properties: ['createDirectory', 'showOverwriteConfirmation'],
            });
            if (result.canceled || !result.filePath) {
                this._log('save_cancelled');
                return { status: 'cancelled', code: 'VAULT_EXPORT_SAVE_CANCELLED' };
            }
            await this.fs.copyFile(composedPath, result.filePath);
            const stat = await this.fs.stat(result.filePath);
            const copyAvailable = EXPORT_WIDTH * dimensions.height <= CLIPBOARD_MAX_PIXELS && stat.size <= CLIPBOARD_MAX_BYTES;
            const exportId = crypto.randomUUID();
            this.savedExports.set(exportId, { filePath: result.filePath, width: EXPORT_WIDTH, height: dimensions.height, size: stat.size, expiresAt: Date.now() + 30 * 60 * 1000 });
            this._log('save_completed', { width: EXPORT_WIDTH, height: dimensions.height, bytes: stat.size, copyAvailable });
            this._progress(sender, 'complete', { width: EXPORT_WIDTH, height: dimensions.height, copyAvailable });
            return { status: 'success', exportId, width: EXPORT_WIDTH, height: dimensions.height, bytes: stat.size, copyAvailable };
        } catch (error) {
            const wrapped = error instanceof VaultExportError ? error : new VaultExportError(
                /sharp|vips|png/i.test(String(error?.message || '')) ? 'VAULT_EXPORT_COMPOSE_FAILED' : 'VAULT_EXPORT_CAPTURE_FAILED',
                error?.message || 'The Vault showcase could not be generated.',
                error,
            );
            this._log('export_failed', { code: wrapped.code });
            this._progress(sender, 'failed', { code: wrapped.code, message: wrapped.message });
            throw wrapped;
        } finally {
            if (win) {
                this.sessionsByWebContents.delete(win.webContents.id);
                if (!win.isDestroyed()) win.destroy();
            }
            await this.fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    async copy(exportId) {
        const record = this.savedExports.get(String(exportId || ''));
        if (!record || record.expiresAt < Date.now()) throw new VaultExportError('VAULT_EXPORT_COPY_UNAVAILABLE', 'This export is no longer available to copy.');
        if (record.width * record.height > CLIPBOARD_MAX_PIXELS || record.size > CLIPBOARD_MAX_BYTES) throw new VaultExportError('VAULT_EXPORT_COPY_UNAVAILABLE', 'This image is too large for the Windows clipboard.');
        const image = this.nativeImage.createFromPath(record.filePath);
        if (image.isEmpty()) throw new VaultExportError('VAULT_EXPORT_COPY_UNAVAILABLE', 'The saved image could not be loaded.');
        this.clipboard.writeImage(image);
        this._log('copy_completed', { width: record.width, height: record.height, bytes: record.size });
        return { status: 'success' };
    }
}

module.exports = {
    CLIPBOARD_MAX_BYTES,
    CLIPBOARD_MAX_PIXELS,
    EXPORT_WIDTH,
    MAX_OUTPUT_HEIGHT,
    TILE_HEIGHT,
    VaultExportError,
    VaultShowcaseExportService,
    buildTilePlan,
    composeTiles,
    defaultFilename,
    normalizeCapturedTile,
    safeFilenamePart,
    validateSnapshot,
    validateViewportMeasurement,
};
