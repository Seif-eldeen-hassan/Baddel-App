'use strict';

// ─── IPC Shadow Router — Phase 3.2 migration utility ─────────────────────────
//
// Allows two IPC handler implementations (legacy + new adapter) to run in
// parallel on the same channel during the Strangler Fig migration.
//
// HOW IT WORKS
//   1. legacyFn executes synchronously/normally — its result is returned to the
//      renderer unchanged.
//   2. shadowFn fires in a fire-and-forget microtask AFTER the legacy result is
//      produced — the renderer never waits for it.
//   3. Results are compared with deepEqual; mismatches are logged to console.
//   4. All shadow errors are caught — they can never crash the main process.
//
// SAFETY GUARANTEES
//   - Shadow execution NEVER changes the value returned to the renderer.
//   - Shadow errors are swallowed and logged (never re-thrown).
//   - Designed for read-only or idempotent channels only.
//     Channels with write/side-effect behaviour must not be shadowed until
//     the adapter has its own implementation that is side-effect-free.
//
// USAGE
//
//   const { createShadowCapture, wrapWithShadow } = require('@shared/ipc/shadowRouter');
//
//   // 1. Capture adapter handlers without actually registering with Electron.
//   const capture = createShadowCapture();
//   gamesAdapter.register(capture, deps);          // no real ipcMain.handle() called
//
//   // 2. Re-register the legacy handler through a shadow wrapper.
//   //    Shadow fn is the function captured above for the same channel.
//   const shadowedHandler = wrapWithShadow(
//     'get-game-by-id',
//     legacyHandlerFn,                             // authoritative — result goes to renderer
//     capture.getHandler('get-game-by-id').fn,     // shadow — result is compared only
//   );
//   ipcMain.handle('get-game-by-id', shadowedHandler);
//
// CHANNELS SUITABLE FOR PHASE 3.2 SHADOW (read-only, no side effects):
//   get-game-by-id    — in-memory DB read
//   get-hidden-games  — in-memory DB read
//
// CHANNELS EXCLUDED FROM SHADOW (side effects on execution):
//   get-installed-games — triggers scanAllGames + background metadata pipeline
//   All write channels  — deferred to Phase 4 when adapter has own implementations

// ─── Shadow Capture ───────────────────────────────────────────────────────────

/**
 * Returns a fake ipcMain that records handler registrations without actually
 * passing them to Electron. Adapter code calls `capture.handle(channel, fn)`
 * and `capture.on(channel, fn)` — the handlers are stored in an internal Map.
 *
 * @returns {{
 *   handle(channel: string, fn: Function): void,
 *   on(channel: string, fn: Function): void,
 *   getHandler(channel: string): {type: 'handle'|'on', fn: Function}|null,
 *   getChannels(): string[],
 * }}
 */
function createShadowCapture() {
    const _handlers = new Map();

    return {
        handle(channel, fn) {
            if (_handlers.has(channel)) {
                console.warn(`[ShadowCapture] Duplicate capture for channel "${channel}" — overwriting`);
            }
            _handlers.set(channel, { type: 'handle', fn });
        },

        on(channel, fn) {
            if (_handlers.has(channel)) {
                console.warn(`[ShadowCapture] Duplicate capture for channel "${channel}" (on) — overwriting`);
            }
            _handlers.set(channel, { type: 'on', fn });
        },

        getHandler(channel) {
            return _handlers.get(channel) || null;
        },

        getChannels() {
            return [..._handlers.keys()];
        },
    };
}

// ─── Deep Equality ────────────────────────────────────────────────────────────

/**
 * Structural deep equality for IPC-serializable values.
 * IPC payloads are always JSON-compatible, so this handles: null, boolean,
 * number, string, Array, plain Object. Does not handle Date/Map/Set/undefined
 * intentionally — those cannot cross the IPC boundary.
 *
 * Returns true if a and b are structurally equal.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
    if (a === b) return true;

    // Strict-mode NaN check (NaN !== NaN)
    if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) return true;

    if (a === null || b === null) return false;
    if (typeof a !== typeof b)   return false;

    if (typeof a !== 'object')   return false; // primitives already handled above

    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray) return false;

    if (aIsArray) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }

    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    if (keysA.some((k, i) => k !== keysB[i])) return false;

    return keysA.every(k => deepEqual(a[k], b[k]));
}

// ─── Mismatch Summariser ──────────────────────────────────────────────────────

/**
 * Produces a short human-readable diff summary for the mismatch log.
 * Truncates large values to avoid flooding the log.
 *
 * @param {*} legacy
 * @param {*} shadow
 * @returns {string}
 */
function _summariseMismatch(legacy, shadow) {
    const truncate = (v) => {
        const s = JSON.stringify(v);
        if (!s) return String(v);
        return s.length > 300 ? s.slice(0, 300) + '…' : s;
    };

    const legacyIsArray = Array.isArray(legacy);
    const shadowIsArray = Array.isArray(shadow);

    if (legacyIsArray && shadowIsArray) {
        return `array length legacy=${legacy.length} shadow=${shadow.length}`;
    }

    if (legacy === null || shadow === null) {
        return `null difference: legacy=${legacy} shadow=${shadow}`;
    }

    if (typeof legacy !== typeof shadow) {
        return `type mismatch: legacy=${typeof legacy} shadow=${typeof shadow}`;
    }

    return `legacy=${truncate(legacy)} vs shadow=${truncate(shadow)}`;
}

// ─── Shadow Wrapper ───────────────────────────────────────────────────────────

/**
 * Wraps a legacy IPC handler function with a parallel shadow comparator.
 *
 * The returned function:
 *   1. Awaits legacyFn — the result is returned to the renderer (unchanged).
 *   2. Fires shadowFn in a detached microtask — its result is NEVER returned.
 *   3. Deeply compares the two results; logs a warning on any mismatch.
 *   4. All shadow errors are caught and logged — they never propagate.
 *
 * @param {string}   channel       IPC channel name (for log messages only)
 * @param {Function} legacyFn      The existing handler — must remain authoritative
 * @param {Function} shadowFn      The new adapter's handler — result discarded
 * @param {object}   [opts]
 * @param {Function} [opts.onMismatch]  Optional callback(channel, legacyResult, shadowResult)
 * @returns {Function}  Electron-compatible ipcMain handler (event, ...args) => Promise
 */
function wrapWithShadow(channel, legacyFn, shadowFn, opts = {}) {
    const { onMismatch } = opts;

    return async function shadowedIpcHandler(event, ...args) {
        // ── Step 1: run legacy handler — this result goes to the renderer ──────
        const legacyResult = await legacyFn(event, ...args);

        // ── Step 2: shadow execution — fire-and-forget, never blocks response ──
        // The `.catch` at the end ensures even an unexpected sync throw is swallowed.
        Promise.resolve()
            .then(async () => {
                const shadowResult = await shadowFn(event, ...args);

                if (!deepEqual(legacyResult, shadowResult)) {
                    console.warn(
                        `[ShadowRouter] MISMATCH on "${channel}"`,
                        _summariseMismatch(legacyResult, shadowResult)
                    );
                    if (typeof onMismatch === 'function') {
                        try { onMismatch(channel, legacyResult, shadowResult); } catch (_) {}
                    }
                }
                // No mismatch — shadow executed cleanly, results agree.
            })
            .catch((err) => {
                console.warn(
                    `[ShadowRouter] Shadow error on "${channel}":`,
                    err?.message || String(err)
                );
            });

        // ── Step 3: return legacy result ── renderer never sees shadow output ──
        return legacyResult;
    };
}

// ─── Convenience: register a channel in shadow mode directly on ipcMain ───────

/**
 * Re-registers `channel` on `ipcMain` with a shadow wrapper.
 *
 * IMPORTANT: The channel must already be removed from ipcMain before calling
 * this (Electron does not allow double-handle on the same channel).
 * In Phase 3.2 this is called INSTEAD of the legacy handler registration —
 * the legacy handler fn is passed in as `legacyFn` explicitly.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {string}           channel
 * @param {Function}         legacyFn      Legacy handler fn (will be called first)
 * @param {ShadowCapture}    capture       Capture object from createShadowCapture()
 * @param {object}           [opts]        Forwarded to wrapWithShadow
 */
function shadowHandle(ipcMain, channel, legacyFn, capture, opts) {
    const entry = capture.getHandler(channel);
    if (!entry) {
        console.warn(`[ShadowRouter] No captured handler for "${channel}" — falling back to legacy`);
        ipcMain.handle(channel, legacyFn);
        return;
    }
    if (entry.type !== 'handle') {
        console.warn(`[ShadowRouter] Channel "${channel}" was captured as type "${entry.type}", not "handle" — falling back to legacy`);
        ipcMain.handle(channel, legacyFn);
        return;
    }
    ipcMain.handle(channel, wrapWithShadow(channel, legacyFn, entry.fn, opts));
}

module.exports = {
    createShadowCapture,
    deepEqual,
    wrapWithShadow,
    shadowHandle,
};
