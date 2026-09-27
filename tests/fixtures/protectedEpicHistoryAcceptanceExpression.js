(async () => {
    const waitFor = async (predicate, timeoutMs) => {
        const startedAt = Date.now();
        while (!predicate()) {
            if (Date.now() - startedAt > timeoutMs) throw new Error('Acceptance wait timed out');
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    };
    currentView = 'vault';
    __vaultState = 'account';
    __vaultSelectedPlatform = 'epic';
    __vaultEpicSection = 'history';
    const initialSnapshot = await window.electronAPI.platformSyncGetEpicVault();
    __vaultEpicDataCache = initialSnapshot.vault;
    const account = (__vaultEpicDataCache?.accounts || []).find((item) => item.purchaseHistoryItems?.length === 100)
        || (__vaultEpicDataCache?.accounts || []).find((item) => item.purchaseHistoryFetchedAt)
        || __vaultEpicDataCache?.accounts?.[0];
    if (!account) throw new Error('No linked Epic account was available');
    __vaultSelectedEpicAccountId = account.accountId;
    _renderVaultEpicAccountDetail(account);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const button = document.querySelector('.vault-history-refresh');
    if (!button) throw new Error('Purchase History Refresh button was not rendered');
    const before = {
        fetchedAt: account.purchaseHistoryFetchedAt || null,
        revision: Number(account.phaseRevisions?.purchaseHistory || 0),
        items: Number(account.purchaseHistoryItems?.length || 0),
    };
    button.click();
    await waitFor(() => __vaultEpicHistoryRefreshing === true, 5000);
    const whileRunning = {
        buttonBusy: document.querySelector('.vault-history-refresh')?.getAttribute('aria-busy') === 'true',
        buttonText: document.querySelector('.vault-history-refresh')?.textContent?.trim() || '',
    };
    await waitFor(() => __vaultEpicHistoryRefreshing === false, 330000);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterAccount = (__vaultEpicDataCache?.accounts || []).find((item) => String(item.accountId) === String(account.accountId));
    const root = document.getElementById('vaultView') || document.body;
    const text = root.innerText || '';
    return {
        accountId: account.accountId,
        before,
        whileRunning,
        after: {
            fetchedAt: afterAccount?.purchaseHistoryFetchedAt || null,
            revision: Number(afterAccount?.phaseRevisions?.purchaseHistory || 0),
            items: Number(afterAccount?.purchaseHistoryItems?.length || 0),
            historyError: afterAccount?.historyError || null,
            renderedRows: document.querySelectorAll('.vault-history-row').length,
            buttonDisabled: Boolean(document.querySelector('.vault-history-refresh')?.disabled),
            buttonText: document.querySelector('.vault-history-refresh')?.textContent?.trim() || '',
            needsAttention: text.includes('Some Epic details need attention') || text.includes('Purchase History needs attention'),
            alreadyRunning: text.includes('EPIC_HISTORY_REFRESH_ALREADY_RUNNING'),
            errorEmptyStates: document.querySelectorAll('.vault-empty-state.is-error').length,
        },
    };
})()
