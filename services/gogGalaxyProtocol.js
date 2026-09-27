'use strict';

const PRODUCT_ID_RE = /^[0-9]+$/;

function normalizeProductId(value) {
    const id = String(value ?? '').trim();
    if (!PRODUCT_ID_RE.test(id)) {
        const error = new Error('A valid numeric GOG product ID is required.');
        error.code = 'GOG_PRODUCT_ID_INVALID';
        throw error;
    }
    return id;
}

function buildProductViewUrl(productId) {
    return `goggalaxy://openGameView/${normalizeProductId(productId)}`;
}

function buildLaunchUrl(productId) {
    return `goggalaxy://launch/${normalizeProductId(productId)}`;
}

function isProductViewUrl(value) {
    return /^goggalaxy:\/\/openGameView\/[0-9]+$/.test(String(value || ''));
}

function isLaunchUrl(value) {
    return /^goggalaxy:\/\/launch\/[0-9]+$/.test(String(value || ''));
}

module.exports = { normalizeProductId, buildProductViewUrl, buildLaunchUrl, isProductViewUrl, isLaunchUrl };
