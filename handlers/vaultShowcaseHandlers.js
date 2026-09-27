'use strict';

function registerVaultShowcaseHandlers(ipcMain, { service, analytics = null }) {
    if (!service) throw new Error('Vault showcase export service is required');
    ipcMain.handle('vault-showcase:renderer-snapshot', (event) => service.snapshotForSender(event.sender));
    ipcMain.handle('vault-showcase:export', async (event, snapshot) => {
        try {
            const result = await service.export(snapshot, event.sender);
            analytics?.track?.('vault_action', { feature: 'vault', action: 'export', result: result?.status || 'unknown' }).catch?.(() => {});
            return result;
        } catch (error) {
            analytics?.track?.('vault_action', { feature: 'vault', action: 'export', result: 'failed', error_code: error }).catch?.(() => {});
            return { status: 'error', code: error?.code || 'VAULT_EXPORT_RENDER_FAILED', message: error?.message || 'Vault export failed.' };
        }
    });
    ipcMain.handle('vault-showcase:copy', async (_event, exportId) => {
        if (typeof exportId !== 'string' || !/^[a-f0-9-]{20,}$/i.test(exportId)) return { status: 'error', code: 'VAULT_EXPORT_COPY_UNAVAILABLE', message: 'Invalid export reference.' };
        try { return await service.copy(exportId); }
        catch (error) { return { status: 'error', code: error?.code || 'VAULT_EXPORT_COPY_UNAVAILABLE', message: error?.message || 'Could not copy the image.' }; }
    });
}

module.exports = { registerVaultShowcaseHandlers };
