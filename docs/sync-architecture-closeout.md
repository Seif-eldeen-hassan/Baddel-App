# Sync Architecture Closeout

## Status

- Sync/platformSync migration is functionally complete.
- Phase 24.7 and Phase 24.8 are closed.
- `main.js` now enters sync through `getSyncFeature`.
- `platformSync.js` remains the compatibility facade and orchestration layer for existing callers.

## Final Dependency Direction

Current dependency direction:

```text
main.js -> SyncContainer -> platformSync.js -> createSyncConnectors.js
```

Important boundary decisions:

- `platformSync.js` does not import `SyncContainer`.
- `createSyncConnectors.js` does not import `platformSync.js`.
- `createSyncConnectors.js` does not import `SyncContainer`.
- This keeps composition acyclic and avoids a circular dependency between the facade and container.

## Extracted Runtime Modules

- `SyncLogQueue`: owns queued sync log delivery behavior.
- `LinkStateEmitter`: owns link-state event emission payloads.
- `LibraryUpdateEmitter`: owns library update event payloads.
- `SyncTerminalEventEmitter`: owns terminal sync event payloads for completed/failed outcomes.
- `StateChangedEmitter`: owns state-changed event payloads.

## Extracted Services, Repositories, Adapters, and Composition

- `createSyncConnectors`: owns pure Steam/Epic connector object assembly and connector method shape validation.
- `GamesSyncAdapter`: owns sync-facing access to Games feature operations.
- `ConnectorRepositoryBundle`: owns grouped repository dependencies used by connector flows.
- `PlatformSyncAssetWriteBackService`: owns cover-first asset cache/write-back behavior.
- `PlatformSyncServerImportService`: owns Baddel server import, retry, poll, and enrichment write-back flow.
- `PlatformSyncCacheRepository`: owns platform sync cache file persistence.
- `EpicSwitcherRepository`: owns Epic account/profile switcher persistence access.
- `createPlatformSyncFeature`: owns public platform sync feature facade shaping.
- `SyncFeatureApiContract`: owns the stable sync feature API key list and validation.
- `SyncContainer`: owns compatibility composition for `getSyncFeature` and `createSyncFeature`.

## platformSync.js Final Role

`platformSync.js` intentionally remains the compatibility facade/orchestrator. It still owns:

- Steam/Epic connector method bodies.
- `registerPlatformSyncHandlers` implementation.
- Runtime state helpers.
- Steam bridge/runtime helpers.
- Epic Legendary/runtime helpers.
- `autoSyncOnStartup`.
- `enrichProfilesWithSyncData`.
- `registerPlatformSyncAssetDownloader`.
- `cacheLibraryCoversFirst` wrapper.
- Server import/write-back wrappers.
- Cover cache notifications.

This is acceptable for now because the highest-value seams have been extracted, while the remaining behavior is broad, side-effectful, and already covered by characterization tests.

## main.js Sync Wiring

- `main.js` imports `getSyncFeature` from `SyncContainer`.
- `main.js` destructures `registerPlatformSyncHandlers`, `steamConnector`, `epicConnector`, `registerPlatformSyncAssetDownloader`, and `autoSyncOnStartup`.
- Handler registration remains inside `app.whenReady`.
- Asset downloader registration remains inside `app.whenReady`.
- `autoSyncOnStartup` remains scheduled through `runAfterStartupGrace(..., 45000)`.
- `steamConnector.getAccounts` remains used for achievements/account resolution.

## Deferred Work

- `SyncRuntimeState` extraction: deferred because mutation is broad and stable inside the facade.
- `SyncEventEmitter` extraction: deferred because smaller event emitters already cover useful event seams.
- `MainSyncRegistrationAdapter`: optional, medium risk, useful only if main-process sync wiring grows.
- `SyncStartupCoordinator`: optional and startup timing sensitive.
- `SyncAchievementAccountProvider`: optional and achievements/account sensitive.
- Moving Steam/Epic internals: high risk and should happen only if a future feature requires it.
- Moving connector factory ownership into `SyncContainer`: deferred because it adds limited value while `SyncContainer` still default-loads `platformSync.js`.

## Protected Build Policy

Protected build and protected audit are required after:

- `main.js` runtime wiring changes.
- Connector construction ownership changes.
- IPC registration changes.
- Startup sync scheduling changes.
- Steam/Epic runtime changes.
- Packaging-sensitive changes.

Protected build and protected audit are not required for:

- Docs-only changes.
- Audit-only phases.
- Test-only characterization phases.

## Validation Checkpoint

Latest known checkpoint after Phase 24.8I:

- `node --test tests/*.test.js` = 5896/5896.
- `npm.cmd run smoke` = 35/35.
- `npm.cmd run lint` = passed with existing boundaries warnings only.
- Source/test scoped `git diff --check` = clean.
- Last protected checkpoint passed in Phase 24.8G.

## Rollback Notes

Key rollback commands:

```bash
git revert 7bf46dc38418d9624f872c38b8ec83ee7bc7e51e
git revert 27de35e2c830d22741247d0ffc884f1710f62dc7
```

Notes:

- `7bf46dc38418d9624f872c38b8ec83ee7bc7e51e` is the Phase 24.8G `main.js` migration to `getSyncFeature`.
- `27de35e2c830d22741247d0ffc884f1710f62dc7` is the Phase 24.8C connector factory extraction.
- Generated/protected artifacts must not be staged.
