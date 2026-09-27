'use strict';

function graphQLErrors(response) {
    return Array.isArray(response?.data?.errors) ? response.data.errors : [];
}

function classifyEpicPriceResponse(response = {}) {
    const status = Number(response.status || 0);
    if (response.networkFailure) return { code: 'EPIC_PRICE_NETWORK_FAILURE', failedStage: 'http_request', reason: 'network_failure', retryable: true };
    if (response.timedOut || status === 408) return { code: 'EPIC_PRICE_REQUEST_TIMEOUT', failedStage: 'http_request', reason: 'timeout', retryable: true };
    if (status === 401) return { code: 'EPIC_PRICE_HTTP_401', failedStage: 'http_response', reason: 'api_failure', retryable: false };
    if (status === 403) return { code: 'EPIC_PRICE_HTTP_403', failedStage: 'http_response', reason: 'api_failure', retryable: false };
    if (status === 429) return { code: 'EPIC_PRICE_RATE_LIMITED', failedStage: 'http_response', reason: 'rate_limited', retryable: true, retryAfterMs: Number(response.retryAfterMs || 0) };
    if (status >= 500) return { code: 'EPIC_PRICE_HTTP_5XX', failedStage: 'http_response', reason: 'api_failure', retryable: true };
    if (status >= 400) return { code: `EPIC_PRICE_HTTP_${status}`, failedStage: 'http_response', reason: 'api_failure', retryable: false };
    const errors = graphQLErrors(response);
    if (errors.some((item) => /persistedquerynotfound/i.test(`${item?.extensions?.code || ''} ${item?.message || ''}`))) {
        return { code: 'EPIC_PRICE_PERSISTED_QUERY_INVALID', failedStage: 'graphql_response', reason: 'persisted_query_invalid', retryable: false };
    }
    if (errors.length) return { code: 'EPIC_PRICE_GRAPHQL_ERROR', failedStage: 'graphql_response', reason: 'graphql_error', retryable: false };
    if (response.error) return { code: 'EPIC_PRICE_NETWORK_FAILURE', failedStage: 'http_request', reason: 'network_failure', retryable: true };
    return null;
}

module.exports = { classifyEpicPriceResponse, graphQLErrors };
