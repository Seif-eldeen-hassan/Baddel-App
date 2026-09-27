'use strict';

function createKeyedSingleFlight({ conflictResult } = {}) {
    const active = new Map();
    return {
        run(scopeKey, actionKey, operation) {
            const scope = String(scopeKey || '');
            const action = String(actionKey || '');
            const current = active.get(scope);
            if (current) {
                if (current.action === action) return current.promise;
                return Promise.resolve(typeof conflictResult === 'function'
                    ? conflictResult(scope, action, current.action)
                    : conflictResult);
            }
            const promise = Promise.resolve().then(operation).finally(() => {
                if (active.get(scope)?.promise === promise) active.delete(scope);
            });
            active.set(scope, { action, promise });
            return promise;
        },
        size() { return active.size; },
        clear() { active.clear(); },
    };
}

module.exports = { createKeyedSingleFlight };
