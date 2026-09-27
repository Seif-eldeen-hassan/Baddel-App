'use strict';

(() => {
    const api = window.electronAPI;
    let activeProvider = 'steam';
    let activeGeneration = 0;
    let navigationState = null;
    let boundsFrame = 0;
    let routeActive = false;
    let copyFeedbackTimer = 0;

    const el = id => document.getElementById(id);

    function resetCopyFeedback() {
        clearTimeout(copyFeedbackTimer);
        copyFeedbackTimer = 0;
        const button = el('storeCopy');
        const status = el('storeCopyStatus');
        if (!button || !status) return;
        button.classList.remove('is-copied', 'is-error');
        button.querySelector('[data-copy-icon]').toggleAttribute('hidden', false);
        button.querySelector('[data-copy-check]').toggleAttribute('hidden', true);
        button.title = 'Copy URL';
        button.setAttribute('aria-label', 'Copy URL');
        status.hidden = true;
    }

    function showCopyFeedback(ok) {
        resetCopyFeedback();
        const button = el('storeCopy');
        const status = el('storeCopyStatus');
        if (!button || !status) return;
        button.classList.add(ok ? 'is-copied' : 'is-error');
        button.querySelector('[data-copy-icon]').toggleAttribute('hidden', ok);
        button.querySelector('[data-copy-check]').toggleAttribute('hidden', !ok);
        status.textContent = ok ? 'URL copied' : 'Could not copy URL';
        status.hidden = false;
        button.title = status.textContent;
        button.setAttribute('aria-label', status.textContent);
        copyFeedbackTimer = setTimeout(resetCopyFeedback, 1500);
    }
    const hasOpenModal = () => Boolean(document.querySelector('.modal-overlay.active, [role="dialog"].active'));

    function setNativeVisible() {
        const visible = routeActive && !hasOpenModal() && !navigationState?.error;
        api?.setStoreViewVisible?.(visible).catch(() => {});
        if (visible) queueBounds();
    }

    function applyState(state) {
        if (!routeActive || !state || state.provider !== activeProvider) return;
        if (state.generation < activeGeneration) return;
        activeGeneration = state.generation;
        navigationState = state;
        el('storeBack').disabled = !state.canGoBack;
        el('storeForward').disabled = !state.canGoForward;
        const refresh = el('storeRefresh');
        refresh.dataset.mode = state.isLoading ? 'stop' : 'reload';
        refresh.title = state.isLoading ? 'Stop loading' : 'Refresh';
        refresh.setAttribute('aria-label', refresh.title);
        refresh.querySelector('[data-refresh-icon]').toggleAttribute('hidden', state.isLoading);
        refresh.querySelector('[data-stop-icon]').toggleAttribute('hidden', !state.isLoading);
        el('storeUrl').value = state.url || '';
        el('storeOrigin').textContent = state.origin || '';
        el('storeLoading').hidden = !state.isLoading;
        const error = el('storeError');
        error.hidden = !state.error;
        if (state.error) {
            el('storeErrorText').textContent = state.error === 'offline'
                ? 'You appear to be offline. Check your connection and try again.'
                : 'This storefront could not be loaded securely.';
        }
        document.querySelectorAll('[data-store-provider]').forEach(button => {
            button.classList.toggle('active', button.dataset.storeProvider === activeProvider);
            button.setAttribute('aria-pressed', String(button.dataset.storeProvider === activeProvider));
        });
        setNativeVisible();
    }

    async function selectProvider(provider) {
        if (!['steam', 'epic', 'gog'].includes(provider)) return;
        activeProvider = provider;
        navigationState = null;
        resetCopyFeedback();
        el('storeError').hidden = true;
        el('storeLoading').hidden = false;
        document.querySelectorAll('[data-store-provider]').forEach(button => {
            button.classList.toggle('active', button.dataset.storeProvider === provider);
            button.setAttribute('aria-pressed', String(button.dataset.storeProvider === provider));
        });
        try {
            const result = await api.openStore(provider);
            api?.trackFeatureEvent?.('store_provider_selected', { feature: 'stores', provider, result: 'success' }).catch?.(() => {});
            if (!routeActive || result.provider !== activeProvider) return;
            activeGeneration = result.generation;
            queueBounds();
        } catch {
            api?.trackFeatureEvent?.('store_provider_selected', { feature: 'stores', provider, result: 'failed' }).catch?.(() => {});
            applyState({ provider, generation: activeGeneration, url: '', origin: '', error: 'load_failed' });
        }
    }

    function queueBounds() {
        cancelAnimationFrame(boundsFrame);
        boundsFrame = requestAnimationFrame(() => {
            if (!routeActive) return;
            const rect = el('storeContentHost')?.getBoundingClientRect();
            if (!rect || rect.width < 1 || rect.height < 1) return;
            api.setStoreViewBounds({
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            }).catch(() => {});
        });
    }

    window.navigateToStores = async function navigateToStores() {
        api?.trackFeatureEvent?.('feature_viewed', { feature: 'stores', view: 'stores' }).catch?.(() => {});
        currentView = 'stores';
        _hideAllViews();
        routeActive = true;
        el('storesView').style.display = 'flex';
        updateSidebarActiveState();
        const result = await api.openStore(null).catch(() => null);
        if (!routeActive) return;
        if (!result) return applyState({ provider: activeProvider, generation: activeGeneration, error: 'load_failed' });
        activeProvider = result.provider;
        activeGeneration = result.generation;
        queueBounds();
        setNativeVisible();
    };

    window.hideStoresView = function hideStoresView() {
        routeActive = false;
        api?.setStoreViewVisible?.(false).catch(() => {});
    };

    window.storeSelectProvider = selectProvider;
    window.storeCommand = command => api?.[command]?.().catch(() => {});
    window.storeRefreshOrStop = () => {
        const method = el('storeRefresh')?.dataset.mode === 'stop' ? 'storeStop' : 'storeReload';
        api?.[method]?.().catch(() => {});
    };
    window.storeCopyUrl = async () => {
        const snapshot = {
            provider: activeProvider,
            generation: activeGeneration,
            url: navigationState?.url || '',
        };
        if (!snapshot.url) return showCopyFeedback(false);
        try {
            const result = await api.copyStoreUrl(snapshot);
            const stillCurrent = routeActive
                && activeProvider === snapshot.provider
                && activeGeneration === snapshot.generation
                && navigationState?.url === snapshot.url;
            if (!stillCurrent) return resetCopyFeedback();
            showCopyFeedback(result?.ok === true && result.url === snapshot.url);
        } catch {
            showCopyFeedback(false);
        }
    };
    window.storeRetry = () => {
        if (navigationState) navigationState = { ...navigationState, error: null };
        el('storeError').hidden = true;
        api.setStoreViewVisible(true).then(() => api.storeReload()).catch(() => {});
    };

    api?.onStoreNavigationState?.(applyState);
    api?.onPlatformSyncAccountsChanged?.(payload => {
        if (!routeActive) return;
        const platform = String(payload?.platform || '').toLowerCase();
        if (platform && platform !== activeProvider) return;
        selectProvider(activeProvider);
    });
    window.addEventListener('DOMContentLoaded', () => {
        const host = el('storeContentHost');
        if (host && window.ResizeObserver) new ResizeObserver(queueBounds).observe(host);
        document.querySelectorAll('[data-store-provider]').forEach(button => {
            button.addEventListener('click', () => selectProvider(button.dataset.storeProvider));
        });
        const modalObserver = new MutationObserver(setNativeVisible);
        modalObserver.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden'],
        });
    });
    window.addEventListener('resize', queueBounds);
    document.addEventListener('keydown', event => {
        if (!routeActive) return;
        if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); api.storeBack(); }
        else if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); api.storeForward(); }
        else if ((event.ctrlKey && event.key.toLowerCase() === 'r') || event.key === 'F5') { event.preventDefault(); api.storeReload(); }
        else if (event.key === 'Escape' && navigationState?.isLoading) { event.preventDefault(); api.storeStop(); }
    });
})();
