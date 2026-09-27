'use strict';

const fs = require('fs');
const readline = require('readline');

async function summarize(filename) {
    const counts = {};
    const checkpoints = [];
    const latest = {};
    let runtime = null;
    let incomplete = false;
    for await (const line of readline.createInterface({ input: fs.createReadStream(filename), crlfDelay: Infinity })) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { incomplete = true; continue; }
        counts[row.event] = (counts[row.event] || 0) + 1;
        if (row.event === 'TRACE_TRUNCATED' || row.event === 'RAW_LINE_SUPPRESSED') incomplete = true;
        if (row.event === 'RUNTIME_PROBE') runtime = row;
        if (row.event === 'SESSION_START') latest.session = row;
        if (row.event === 'QUEUE_AFTER' || row.event === 'RENDERER_PATCH_DOM' || row.event === 'RENDERER_SNAPSHOT_DOM') {
            const state = row.payload.queueTaskAfter || row.payload;
            const percent = Number(state.progressPercent);
            const checkpoint = row.event + ':' + state.status + ':' + state.stage + ':' +
                (percent >= 99 ? 'near100' : percent >= 50 ? '50' : percent >= 10 ? '10' : percent >= 1 ? '1' : 'first');
            if (!latest[checkpoint]) { checkpoints.push(row); latest[checkpoint] = true; }
        }
        if (row.event === 'PROVIDER_CLOSE' || row.event === 'POST_INSTALL_VERIFICATION_PASSED' || row.event === 'ADAPTER_REJECT') checkpoints.push(row);
    }
    return { evidence: 'Observed diagnostic file, not an automatic success verdict. Inspect matching sessionId/correlation.lineId rows in the original NDJSON.',
        incomplete, counts, session: latest.session, runtime, checkpoints };
}

if (require.main === module) {
    if (!process.argv[2]) { console.error('Usage: node scripts/summarize-epic-download-trace.cjs <session.ndjson>'); process.exitCode = 1; }
    else summarize(process.argv[2]).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { summarize };
