'use strict';

const CONNECTOR_METHODS = Object.freeze([
    'isLinked',
    'getAccounts',
    'link',
    'syncLibrary',
    'getCachedLibrary',
    'unlink',
]);

function assertConnector(name, connector) {
    if (!connector || typeof connector !== 'object') {
        throw new TypeError(`${name} connector must be an object`);
    }

    for (const method of CONNECTOR_METHODS) {
        if (typeof connector[method] !== 'function') {
            throw new TypeError(`${name} connector missing ${method}`);
        }
    }
}

function createConnector(methods) {
    return {
        isLinked: methods.isLinked,
        getAccounts: methods.getAccounts,
        link: methods.link,
        syncLibrary: methods.syncLibrary,
        getCachedLibrary: methods.getCachedLibrary,
        unlink: methods.unlink,
    };
}

function createSyncConnectors({ steam, epic, gog } = {}) {
    assertConnector('steam', steam);
    assertConnector('epic', epic);
    assertConnector('gog', gog);

    const steamConnector = createConnector(steam);
    const epicConnector = createConnector(epic);
    const gogConnector = createConnector(gog);
    const ALL_CONNECTORS = {
        epic: epicConnector,
        steam: steamConnector,
        gog: gogConnector,
    };

    return {
        steamConnector,
        epicConnector,
        gogConnector,
        ALL_CONNECTORS,
    };
}

module.exports = {
    CONNECTOR_METHODS,
    createSyncConnectors,
};
