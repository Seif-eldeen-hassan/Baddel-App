'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const fsSync = require('fs');
const vm = require('vm');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
    VaultShowcaseExportService,
    buildTilePlan,
    composeTiles,
    normalizeCapturedTile,
    validateViewportMeasurement,
    validateSnapshot,
} = require('../src/features/vault/infrastructure/services/VaultShowcaseExportService');
const { registerVaultShowcaseHandlers } = require('../handlers/vaultShowcaseHandlers');
const { REQUIRED_PROTECTED_FILES, findMissingProtectedFiles } = require('../scripts/protected-runtime-contract');

function snapshot() {
    return {
        schemaVersion: 1,
        width: 1920,
        generatedAt: '2026-09-11T10:00:00.000Z',
        displayName: 'Player',
        counts: { included: 2, priced: 1, unresolved: 1, priceUnavailable: 1, freeExcluded: 1, unavailableExcluded: 0, nonGameExcluded: 0 },
        financials: {
            currentLibraryValue: [{ currency: 'USD', minorUnits: 1000, text: 'USD 10.00' }],
            currentValueCoverage: 1,
            historyImported: true,
            totalPaid: [{ currency: 'USD', minorUnits: 900, text: 'USD 9.00' }],
            totalRefunded: [{ currency: 'USD', minorUnits: 100, text: 'USD 1.00' }],
            netSpend: [{ currency: 'USD', minorUnits: 800, text: 'USD 8.00' }],
        },
        sections: [
            { key: 'priced', title: 'ignored', count: 1, games: [{ key: 'epic:catalog:a', title: 'A', coverSource: null, priceStatus: 'priced', priceMinor: 1000, priceCurrency: 'USD' }] },
            { key: 'price_unavailable', title: 'ignored', count: 1, games: [{ key: 'epic:catalog:b', title: 'B', coverSource: null, priceStatus: 'price_unavailable' }] },
        ],
    };
}

test('tall showcases are divided into exact contiguous capture tiles', () => {
    const tiles = buildTilePlan(1920, 20001, 4096);
    assert.equal(tiles.length, 5);
    assert.equal(tiles[0].offset, 0);
    assert.equal(tiles.at(-1).offset + tiles.at(-1).height, 20001);
    for (let index = 1; index < tiles.length; index += 1) assert.equal(tiles[index].offset, tiles[index - 1].offset + tiles[index - 1].height);
});

test('Sharp tile composition preserves exact calculated dimensions', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-compose-test-'));
    try {
        const first = path.join(dir, 'a.png');
        const second = path.join(dir, 'b.png');
        const output = path.join(dir, 'out.png');
        await sharp({ create: { width: 1920, height: 40, channels: 4, background: '#111111' } }).png().toFile(first);
        await sharp({ create: { width: 1920, height: 30, channels: 4, background: '#43f178' } }).png().toFile(second);
        await composeTiles({ sharp, tiles: [{ path: first, offset: 0, height: 40 }, { path: second, offset: 40, height: 30 }], width: 1920, height: 70, outputPath: output });
        const metadata = await sharp(output).metadata();
        assert.deepEqual([metadata.width, metadata.height], [1920, 70]);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('snapshot validation rejects malformed and untrusted IPC payloads', () => {
    assert.throws(() => validateSnapshot({}), /malformed/i);
    const bad = snapshot();
    bad.sections[0].games[0].coverSource = 'https://attacker.invalid/image.png';
    assert.throws(() => validateSnapshot(bad), /not trusted/i);
    const email = snapshot();
    email.displayName = 'private@example.com';
    assert.throws(() => validateSnapshot(email), /not safe/i);
    const local = snapshot();
    local.sections[0].games[0].coverSource = 'file:///C:/Users/example/private.png';
    assert.throws(() => validateSnapshot(local, { isTrustedCoverSource: () => false }), /outside trusted artwork storage/i);
});

test('IPC handlers convert malformed export input into a stable safe error', async () => {
    const handlers = new Map();
    registerVaultShowcaseHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, {
        service: {
            snapshotForSender: () => null,
            export: async () => { const error = new Error('bad request'); error.code = 'VAULT_EXPORT_SNAPSHOT_FAILED'; throw error; },
            copy: async () => ({ status: 'success' }),
        },
    });
    const result = await handlers.get('vault-showcase:export')({ sender: {} }, { bad: true });
    assert.deepEqual(result, { status: 'error', code: 'VAULT_EXPORT_SNAPSHOT_FAILED', message: 'bad request' });
    const badCopy = await handlers.get('vault-showcase:copy')({}, '../unsafe');
    assert.equal(badCopy.code, 'VAULT_EXPORT_COPY_UNAVAILABLE');
});

test('export service cleans temporary resources on success and capture failure', async () => {
    const removed = [];
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-service-test-'));
    let nextId = 1;
    class FakeWindow {
        constructor() {
            this.destroyed = false;
            this.webContents = {
                id: nextId++,
                executeJavaScript: async (code) => code.includes('whenReady')
                    ? { width: 1920, height: 8, viewport: { width: 1920, height: 8, dpr: 1 } }
                    : { artworkFailures: 0, actualShowcaseTop: 0, expectedShowcaseTop: 0, viewport: { width: 1920, height: 8, dpr: 1 } },
                invalidate: () => {},
                capturePage: async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('not-a-real-png') }),
            };
        }
        async loadFile() {}
        destroy() { this.destroyed = true; }
        isDestroyed() { return this.destroyed; }
    }
    function fakeSharp(input) {
        const target = { width: input?.create?.width || 1920, height: input?.create?.height || 8 };
        return {
            resize: () => this,
            extract: (area) => { target.width = area.width; target.height = area.height; return this; },
            composite: () => this,
            png: () => this,
            toFile: async (file) => { await fs.writeFile(file, 'png'); return {}; },
            metadata: async () => target,
        };
    }
    // Arrow-free chain object so `this` is stable.
    const chainSharp = (input) => {
        const target = { width: input?.create?.width || 1920, height: input?.create?.height || 8 };
        const chain = {
            resize() { return chain; }, extract(area) { target.width = area.width; target.height = area.height; return chain; },
            composite() { return chain; }, png() { return chain; },
            async toFile(file) { await fs.writeFile(file, 'png'); }, async metadata() { return target; },
        };
        return chain;
    };
    const fsApi = {
        ...fs,
        mkdtemp: async () => fs.mkdtemp(path.join(tempRoot, 'run-')),
        rm: async (target, options) => { removed.push(target); return fs.rm(target, options); },
    };
    const sender = { isDestroyed: () => false, send: () => {} };
    const savedPath = path.join(tempRoot, 'saved.png');
    const service = new VaultShowcaseExportService({
        BrowserWindow: FakeWindow, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: savedPath }) },
        clipboard: {}, nativeImage: {}, sharp: chainSharp, exportPagePath: 'page', exportPreloadPath: 'preload', trustedArtworkRoots: [tempRoot], fsApi,
    });
    const result = await service.export(snapshot(), sender);
    assert.equal(result.status, 'success');
    assert.equal(await fs.readFile(savedPath, 'utf8'), 'png');
    assert.equal(removed.length, 1);
    assert.equal(await fs.stat(removed[0]).then(() => true, () => false), false);

    class FailingWindow extends FakeWindow {
        constructor() { super(); this.webContents.capturePage = async () => ({ isEmpty: () => true }); }
    }
    const failing = new VaultShowcaseExportService({
        BrowserWindow: FailingWindow, dialog: {}, clipboard: {}, nativeImage: {}, sharp: chainSharp,
        exportPagePath: 'page', exportPreloadPath: 'preload', trustedArtworkRoots: [tempRoot], fsApi,
    });
    const error = await failing.export(snapshot(), sender).then(() => null, (value) => value);
    assert.equal(error.code, 'VAULT_EXPORT_CAPTURE_FAILED');
    assert.equal(removed.length, 2);
    await fs.rm(tempRoot, { recursive: true, force: true });
});

test('duplicate compositor frame is repainted with bounded recovery before composition', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-repaint-test-'));
    const first = await sharp({ create: { width: 1920, height: 8, channels: 4, background: '#111111' } }).png().toBuffer();
    const second = await sharp({ create: { width: 1920, height: 8, channels: 4, background: '#43f178' } }).png().toBuffer();
    const captures = [first, first, second];
    const logs = [];
    let captureCalls = 0;
    class RepaintingWindow {
        constructor() {
            this.destroyed = false;
            this.webContents = {
                id: 9001,
                executeJavaScript: async (code) => {
                    if (code.includes('whenReady')) return { width: 1920, height: 16, viewport: { width: 1920, height: 8, dpr: 1 } };
                    const offset = Number(code.match(/(?:prepareTile|confirmTile)\((\d+)/)?.[1] || 0);
                    return { artworkFailures: 0, actualShowcaseTop: -offset, expectedShowcaseTop: -offset, viewport: { width: 1920, height: 8, dpr: 1 } };
                },
                invalidate: () => {},
                capturePage: async () => {
                    const png = captures[Math.min(captureCalls, captures.length - 1)];
                    captureCalls += 1;
                    return { isEmpty: () => false, toPNG: () => png };
                },
            };
        }
        async loadFile() {}
        destroy() { this.destroyed = true; }
        isDestroyed() { return this.destroyed; }
    }
    try {
        const outputPath = path.join(dir, 'repainted.png');
        const service = new VaultShowcaseExportService({
            BrowserWindow: RepaintingWindow,
            dialog: { showSaveDialog: async () => ({ canceled: false, filePath: outputPath }) },
            clipboard: {}, nativeImage: {}, sharp,
            exportPagePath: 'page', exportPreloadPath: 'preload', trustedArtworkRoots: [dir],
            logger: { info: (...args) => logs.push({ stage: args[1], detail: args[2] }) },
        });
        const result = await service.export(snapshot(), { isDestroyed: () => false, send: () => {} });
        assert.equal(result.status, 'success');
        assert.equal(captureCalls, 3);
        assert.equal(logs.filter((item) => item.stage === 'tile_repaint_retry').length, 1);
        assert.equal(logs.filter((item) => item.stage === 'tile_captured').at(-1).detail.captureAttempt, 2);
        assert.deepEqual([...(await sharp(outputPath).raw().toBuffer())].slice(0, 3), [17, 17, 17]);
        const bottomPixel = await sharp(outputPath).extract({ left: 0, top: 15, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
        assert.deepEqual([...bottomPixel], [67, 241, 120]);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
test('actual 1032px viewport drives contiguous tiles instead of requested 4096px height', () => {
    const viewport = validateViewportMeasurement({ width: 1920, height: 9000, viewport: { width: 1920, height: 1032, dpr: 1 } });
    const tiles = buildTilePlan(1920, 9000, viewport.height);
    assert.equal(tiles[0].height, 1032);
    assert.equal(tiles.length, 9);
    assert.equal(tiles.at(-1).height, 744);
    for (let index = 1; index < tiles.length; index += 1) assert.equal(tiles[index].offset, tiles[index - 1].offset + tiles[index - 1].height);
});

test('DPR 1 and DPR 1.25 captures normalize uniformly and final tiles crop without stretching', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-normalize-test-'));
    try {
        for (const fixture of [
            { name: 'dpr-1', dpr: 1, rawWidth: 1920, rawHeight: 1032, tileHeight: 1032 },
            { name: 'dpr-125', dpr: 1.25, rawWidth: 2400, rawHeight: 1290, tileHeight: 1032 },
            { name: 'final', dpr: 1.25, rawWidth: 2400, rawHeight: 1290, tileHeight: 207 },
        ]) {
            const rawPath = path.join(dir, fixture.name + '-raw.png');
            const tilePath = path.join(dir, fixture.name + '-tile.png');
            await sharp({ create: { width: fixture.rawWidth, height: fixture.rawHeight, channels: 4, background: '#080a09' } }).png().toFile(rawPath);
            const result = await normalizeCapturedTile({
                sharp, rawPath, tilePath,
                tile: { index: 0, width: 1920, height: fixture.tileHeight },
                viewport: { width: 1920, height: 1032, dpr: fixture.dpr },
                rawMetadata: await sharp(rawPath).metadata(),
            });
            const metadata = await sharp(tilePath).metadata();
            assert.deepEqual([metadata.width, metadata.height], [1920, fixture.tileHeight]);
            assert.ok(Math.abs(result.scaleX - result.scaleY) < 0.001);
        }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('known capture rectangle retains its geometry at Windows DPR 1.25', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-geometry-test-'));
    try {
        const rawPath = path.join(dir, 'raw.png');
        const tilePath = path.join(dir, 'tile.png');
        const rectangle = await sharp({ create: { width: 250, height: 500, channels: 4, background: '#43f178' } }).png().toBuffer();
        await sharp({ create: { width: 2400, height: 1290, channels: 4, background: '#080a09' } })
            .composite([{ input: rectangle, left: 125, top: 125 }]).png().toFile(rawPath);
        await normalizeCapturedTile({
            sharp, rawPath, tilePath, tile: { index: 0, width: 1920, height: 1032 },
            viewport: { width: 1920, height: 1032, dpr: 1.25 }, rawMetadata: await sharp(rawPath).metadata(),
        });
        const { data, info } = await sharp(tilePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let minX = info.width; let maxX = -1; let minY = info.height; let maxY = -1;
        for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
            const offset = (y * info.width + x) * 4;
            if (data[offset + 1] > 180 && data[offset] < 120 && data[offset + 2] < 180) {
                minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            }
        }
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        assert.ok(Math.abs(width - 200) <= 2, `rectangle width was ${width}`);
        assert.ok(Math.abs(height - 400) <= 2, `rectangle height was ${height}`);
        assert.ok(Math.abs(width / height - 0.5) < 0.01);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('unexpectedly short raw capture is rejected instead of stretched', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-short-capture-test-'));
    try {
        const rawPath = path.join(dir, 'raw.png');
        const tilePath = path.join(dir, 'tile.png');
        await sharp({ create: { width: 1920, height: 1020, channels: 4, background: '#080a09' } }).png().toFile(rawPath);
        await assert.rejects(normalizeCapturedTile({
            sharp, rawPath, tilePath, tile: { index: 0, width: 1920, height: 1032 },
            viewport: { width: 1920, height: 1032, dpr: 1 }, rawMetadata: await sharp(rawPath).metadata(),
        }), /shorter than the measured viewport/i);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('renderer selects exactly the requested finance cards for all 16 combinations', () => {
    const source = fsSync.readFileSync(path.join(__dirname, '../src/js/vault-export-renderer.js'), 'utf8');
    const start = source.indexOf('    function financeCardDefinitions(data)');
    const end = source.indexOf('    function renderSnapshot(data)', start);
    assert.ok(start >= 0 && end > start);
    const financials = { currentLibraryValue: [], totalPaid: [], totalRefunded: [], netSpend: [], currentValueCoverage: 1, historyImported: true };
    const keys = ['currentLibraryValue', 'totalPaid', 'totalRefunded', 'netSpend'];
    for (let mask = 0; mask < 16; mask += 1) {
        const displayOptions = Object.fromEntries(keys.map((key, index) => [key, Boolean(mask & (1 << index))]));
        const context = { data: { displayOptions, financials } };
        vm.runInNewContext(source.slice(start, end) + '; this.result = financeCardDefinitions(data);', context);
        assert.deepEqual(Array.from(context.result, (item) => item.key), keys.filter((key) => displayOptions[key]));
    }
});

test('deterministic color-band fixture composes every vertical range exactly once across seams', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-seam-test-'));
    try {
        const width = 1920; const height = 2605; const tileHeight = 1032;
        const raw = Buffer.alloc(width * height * 3);
        for (let y = 0; y < height; y += 1) {
            const band = Math.floor(y / 37);
            const color = [(band * 53) % 251, (band * 97) % 251, (band * 149) % 251];
            for (let x = 0; x < width; x += 1) { const o = (y * width + x) * 3; raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2]; }
        }
        const reference = path.join(dir, 'reference.png');
        await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(reference);
        const plan = buildTilePlan(width, height, tileHeight);
        const tiles = []; const hashes = [];
        for (const tile of plan) {
            const file = path.join(dir, `tile-${tile.index}.png`);
            await sharp(reference).extract({ left: 0, top: tile.offset, width, height: tile.height }).png().toFile(file);
            hashes.push(require('crypto').createHash('sha256').update(await fs.readFile(file)).digest('hex'));
            tiles.push({ ...tile, path: file });
        }
        assert.equal(new Set(hashes).size, hashes.length);
        const output = path.join(dir, 'composed.png');
        await composeTiles({ sharp, tiles, width, height, outputPath: output });
        const referencePixels = await sharp(reference).removeAlpha().raw().toBuffer();
        const outputPixels = await sharp(output).removeAlpha().raw().toBuffer();
        assert.equal(require('crypto').createHash('sha256').update(outputPixels).digest('hex'), require('crypto').createHash('sha256').update(referencePixels).digest('hex'));
        for (const seam of plan.slice(1).map((tile) => tile.offset)) {
            const before = (seam - 1) * width * 3;
            const after = seam * width * 3;
            assert.deepEqual([...outputPixels.subarray(before, before + 3)], [...referencePixels.subarray(before, before + 3)]);
            assert.deepEqual([...outputPixels.subarray(after, after + 3)], [...referencePixels.subarray(after, after + 3)]);
        }
        assert.equal(plan.at(-1).height, 541);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('snapshot validation defaults legacy display options and rejects non-booleans', () => {
    assert.deepEqual(validateSnapshot(snapshot()).displayOptions, { currentLibraryValue: true, totalPaid: true, totalRefunded: true, netSpend: true });
    const bad = snapshot();
    bad.displayOptions = { currentLibraryValue: true, totalPaid: 1, totalRefunded: false, netSpend: false };
    assert.throws(() => validateSnapshot(bad), /strict booleans/i);
});
test('Share Vault config opens without artwork or IPC work and games-only rendering removes the finance block', () => {
    const sidebar = fsSync.readFileSync(path.join(__dirname, '../src/js/app/sidebar.js'), 'utf8');
    const openStart = sidebar.indexOf('function exportVaultShowcase()');
    const generateStart = sidebar.indexOf('async function generateVaultShowcase()', openStart);
    const copyStart = sidebar.indexOf('async function copyVaultShowcaseImage()', generateStart);
    const openBlock = sidebar.slice(openStart, generateStart);
    const generateBlock = sidebar.slice(generateStart, copyStart);
    assert.equal(openBlock.includes('_vaultPrimeLocalCovers('), false);
    assert.equal(openBlock.includes('electronAPI?.exportVaultShowcase'), false);
    assert.equal(generateBlock.includes('_vaultPrimeLocalCovers('), true);
    assert.equal(generateBlock.includes('electronAPI?.exportVaultShowcase'), true);
    assert.match(sidebar, /__vaultEpicPriceRefreshingAccounts\.has/);
    const renderer = fsSync.readFileSync(path.join(__dirname, '../src/js/vault-export-renderer.js'), 'utf8');
    assert.match(renderer, /finance\.hidden = cards\.length === 0/);
    assert.match(renderer, /classList\.toggle\('games-only', cards\.length === 0\)/);
});
test('export header renders exactly four factual count boxes', () => {
    const renderer = fsSync.readFileSync(path.join(__dirname, '../src/js/vault-export-renderer.js'), 'utf8');
    const css = fsSync.readFileSync(path.join(__dirname, '../src/css/vault-export.css'), 'utf8');
    for (const label of ['Total Library', 'Priced', 'Free', 'Price Unavailable']) assert.equal((renderer.match(new RegExp(`'${label}'`, 'g')) || []).length >= 1, true);
    for (const removed of ['Games included', 'Free excluded', 'Other excluded']) assert.equal(renderer.includes(`'${removed}'`), false);
    assert.match(css, /\.count-summary\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
});
test('export wordmarks are white and promotional footer is a single in-flow marker', () => {
    const css = fsSync.readFileSync(path.join(__dirname, '../src/css/vault-export.css'), 'utf8');
    const html = fsSync.readFileSync(path.join(__dirname, '../src/vault-export.html'), 'utf8');
    assert.match(css, /\.brand-name\s*\{[^}]*color:\s*#fff/);
    assert.match(css, /\.showcase-footer strong\s*\{[^}]*color:\s*#fff/);
    assert.equal((html.match(/data-export-marker="footer"/g) || []).length, 1);
    assert.equal((html.match(/baddel\.live/g) || []).length, 1);
    assert.equal(/position:\s*(?:fixed|sticky)/.test(css.slice(css.indexOf('.showcase-footer'))), false);
});
test('protected runtime contract reports omitted export HTML, JS, CSS and preload files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-protected-contract-'));
    try {
        const missing = findMissingProtectedFiles(dir);
        for (const file of ['vault-export.html', 'vault-export.bundle.js', 'vault-export.bundle.css', 'vault-export-preload.bundle.cjs']) assert.ok(missing.includes(file));
        assert.ok(REQUIRED_PROTECTED_FILES.includes('vault-export.html'));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
