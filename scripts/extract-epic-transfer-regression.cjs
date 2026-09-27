'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Extract only numeric telemetry and the confirmed startup trigger, never account/path/debug data.
const filename = process.argv[2];
if (!filename) throw new Error('Pass the original diagnostic NDJSON path.');
const source = fs.readFileSync(filename);
const rows = source.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const selected = new Set(rows.filter(row => row.event === 'RAW_LINE' && (
    /^\[cli\] INFO: (?:Download size|Install size): [\d.]+ MiB/.test(row.payload.rawSanitizedLine) ||
    /^\[DLManager\] INFO: (?:Starting file writing worker\.\.\.|= Progress: | - Downloaded: | \+ Download\t-| \+ Disk\t-)/.test(row.payload.rawSanitizedLine)
)).map(row => row.correlation.lineId));
for (const id of [...selected]) {
    const [stream, index] = id.split(':');
    const next = `${stream}:${Number(index) + 1}`;
    if (rows.some(row => row.event === 'RAW_LINE' && row.correlation.lineId === next && row.payload.rawSanitizedLine === '\n')) selected.add(next);
}
const chunks = new Map();
for (const row of rows) {
    if (row.event !== 'RAW_CHUNK_SEGMENT' || !selected.has(row.correlation.lineId)) continue;
    const key = row.payload.chunkId;
    const entry = chunks.get(key) || { sourceChunkId: key, timestamp: row.payload.timestamp, stream: row.correlation.stream, segments: [] };
    entry.segments.push({ sourceOffset: row.payload.offset, text: row.payload.rawSanitizedChunk });
    chunks.set(key, entry);
}
const fixture = { provenance: 'Selected verbatim segments of the real Legendary 0.20.34 reproduction; unrelated lines removed, no synthetic provider lines.',
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    chunks: [...chunks.values()].sort((a, b) => a.sourceChunkId - b.sourceChunkId) };
const target = path.resolve(__dirname, '../tests/fixtures/legendary/live-transfer-0.20.34.json');
fs.writeFileSync(target, JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ path: target, selectedLines: selected.size, chunks: fixture.chunks.length, sourceSha256: fixture.sourceSha256 }));
