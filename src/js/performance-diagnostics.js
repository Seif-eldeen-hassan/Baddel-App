'use strict';

(function installPerformanceDiagnostics() {
    if (window.electronAPI?.performanceDiagnostics?.enabled !== true) return;

    const state = {
        installedAt: performance.now(),
        interactions: [],
        longTasks: [],
        listenerAdds: Object.create(null),
        listenerRemoves: Object.create(null),
        activeIntervals: new Set(),
        activeTimeouts: new Set(),
        objectUrlsCreated: 0,
        objectUrlsRevoked: 0,
        pendingInteraction: null,
    };
    const boundedPush = (list, value, limit = 1000) => {
        list.push(value);
        if (list.length > limit) list.splice(0, list.length - limit);
    };
    const targetKey = target => {
        if (!(target instanceof Element)) return 'unknown';
        const actionable = target.closest('button,[role="button"],a,.nav-item,.game-card') || target;
        return [actionable.tagName?.toLowerCase(), actionable.id && `#${actionable.id}`, actionable.dataset?.action && `[action=${actionable.dataset.action}]`]
            .filter(Boolean).join('');
    };

    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        state.listenerAdds[type] = (state.listenerAdds[type] || 0) + 1;
        return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
        state.listenerRemoves[type] = (state.listenerRemoves[type] || 0) + 1;
        return originalRemove.call(this, type, listener, options);
    };

    const originalSetInterval = window.setInterval.bind(window);
    const originalClearInterval = window.clearInterval.bind(window);
    window.setInterval = (fn, delay, ...args) => {
        const id = originalSetInterval(fn, delay, ...args);
        state.activeIntervals.add(id);
        return id;
    };
    window.clearInterval = id => {
        state.activeIntervals.delete(id);
        return originalClearInterval(id);
    };
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = (fn, delay, ...args) => {
        let id;
        const wrapped = (...callbackArgs) => {
            state.activeTimeouts.delete(id);
            return typeof fn === 'function' ? fn(...callbackArgs) : undefined;
        };
        id = originalSetTimeout(wrapped, delay, ...args);
        state.activeTimeouts.add(id);
        return id;
    };
    window.clearTimeout = id => {
        state.activeTimeouts.delete(id);
        return originalClearTimeout(id);
    };

    if (URL.createObjectURL && URL.revokeObjectURL) {
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = value => { state.objectUrlsCreated++; return create(value); };
        URL.revokeObjectURL = value => { state.objectUrlsRevoked++; return revoke(value); };
    }

    try {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) boundedPush(state.longTasks, {
                startMs: entry.startTime,
                durationMs: entry.duration,
            });
        });
        observer.observe({ type: 'longtask', buffered: true });
        state.longTaskObserver = observer;
    } catch {}

    document.addEventListener('pointerdown', event => {
        state.pendingInteraction = {
            target: targetKey(event.target),
            pointerReceivedAt: performance.now(),
            clickReceivedAt: null,
            firstMutationAt: null,
            paintedAt: null,
        };
    }, true);
    document.addEventListener('click', event => {
        const now = performance.now();
        const interaction = state.pendingInteraction || {
            target: targetKey(event.target),
            pointerReceivedAt: now,
            firstMutationAt: null,
            paintedAt: null,
        };
        interaction.clickReceivedAt = now;
        state.pendingInteraction = interaction;
        boundedPush(state.interactions, interaction);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            interaction.paintedAt = performance.now();
        }));
    }, true);
    const mutationObserver = new MutationObserver(() => {
        const interaction = state.pendingInteraction;
        if (interaction && interaction.clickReceivedAt && interaction.firstMutationAt == null) {
            interaction.firstMutationAt = performance.now();
        }
    });
    mutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    state.mutationObserver = mutationObserver;

    window.__baddelPerfDiagnostics = {
        snapshot() {
            return {
                interactions: state.interactions.slice(),
                longTasks: state.longTasks.slice(),
                lifecycle: {
                    listenerAdds: { ...state.listenerAdds },
                    listenerRemoves: { ...state.listenerRemoves },
                    activeIntervals: state.activeIntervals.size,
                    activeTimeouts: state.activeTimeouts.size,
                    objectUrlsCreated: state.objectUrlsCreated,
                    objectUrlsRevoked: state.objectUrlsRevoked,
                    domNodes: document.getElementsByTagName('*').length,
                    heapBytes: performance.memory?.usedJSHeapSize || null,
                },
            };
        },
        async report() {
            return window.electronAPI.performanceDiagnostics.report(this.snapshot());
        },
    };
})();
