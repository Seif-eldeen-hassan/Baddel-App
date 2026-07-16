# Games Architecture

## Overview

The Games feature is now organized around Clean Architecture layers:

- `domain`: stable feature contracts.
- `application`: use cases and application services.
- `infrastructure`: filesystem, metadata, scanner, IPC, repository, and background-service adapters.
- `composition`: object wiring and production singleton ownership.
- `legacy`: the temporary bridge class that still hosts older orchestration while logic is extracted.

The old root-level `gameScanner.js` compatibility entry point has been removed. Production code should use the Games feature API exposed by the composition root.

## Current Directory Map

```text
src/features/games/
  domain/
    repositories/
  application/
    useCases/
    services/
  infrastructure/
    composition/
    ipc/
    legacy/
    repositories/
    scanner/
    services/
  presentation/
```

- `domain/`: feature-level contracts that application code can depend on.
- `domain/repositories/`: repository interfaces for Games persistence.
- `application/`: side-effect-light application logic.
- `application/useCases/`: focused commands and queries for Games behavior.
- `application/services/`: application-level helpers such as scan report accumulation.
- `infrastructure/`: concrete adapters for Electron, filesystem, metadata, scanners, IPC, and persistence.
- `infrastructure/composition/`: container wiring and singleton creation.
- `infrastructure/ipc/`: Games IPC adapter code.
- `infrastructure/legacy/`: temporary legacy engine class location.
- `infrastructure/repositories/`: concrete repository implementations.
- `infrastructure/scanner/`: scanner and platform helper infrastructure.
- `infrastructure/services/`: image, metadata, diagnostics, and background services.
- `presentation/`: reserved for Games presentation-facing code if needed later.

## Composition Root

`src/features/games/infrastructure/composition/GamesContainer.js` is the Games composition root.

Responsibilities:

- Exposes `createGamesFeature(options)` for fresh, testable containers.
- Exposes `getGamesFeature()` as the production lazy singleton.
- Owns `BaddelEngine` creation.
- Owns `MetadataCacheStore` creation.
- Owns `MetadataResolutionManager` creation.
- Owns the background metadata and refetch callback closure.
- Returns the public Games API consumed by `main.js` and `platformSync.js`.

Rules:

- Production code must use `getGamesFeature()`.
- Production code must not call `createGamesFeature()`.
- Tests may use `createGamesFeature(options)` for isolated fakes.

## BaddelEngine Legacy Class

`src/features/games/infrastructure/legacy/BaddelEngine.js` is a temporary legacy orchestration class.

Responsibilities:

- Delegates to use cases and services where logic has already been extracted.
- Still contains scan stage methods and some repository/platform orchestration.
- Receives `mrm` and `metadataCacheStore` by injection.
- Should shrink over time as logic moves into application use cases and infrastructure services.

`BaddelEngine` is legacy infrastructure. It is not the final domain or application boundary.

## Application Use Cases

Current use cases:

- `StartGlobalScanUseCase`: orchestrates the extracted global scan flow.
- `AddManualGameUseCase`: adds a user-selected game to the library.
- `UpsertGameUseCase`: inserts or updates a normalized game record.
- `RemoveGameUseCase`: hides or removes a game from the active library.
- `DeleteGamePermanentlyUseCase`: permanently deletes a game entry.
- `ResetGameImageUseCase`: resets one image type back to managed metadata.
- `RenameGameUseCase`: updates a game's display name.
- `ReorderLibraryUseCase`: persists library ordering.
- `RestoreSpecificGamesUseCase`: restores selected hidden games.
- `UnhideAllGamesUseCase`: restores all hidden games.
- `GetGameByIdUseCase`: reads a single game by id.
- `GetHiddenGamesUseCase`: reads hidden game entries.
- `RemoveEpicNonGameEntriesUseCase`: filters known non-game Epic entries.

Use cases should not import infrastructure directly. Infrastructure dependencies should be injected through constructors or execution options.

## Infrastructure Services

- `GameScannerCore`: scanner and platform helper functions used by legacy and tests.
- `JsonGameRepository`: JSON-backed low-level game storage.
- `GamesRepositoryImpl`: concrete Games repository adapter.
- `ImageCacheService`: image cache and local artwork handling.
- `ContentAddressedArtworkCache`: automatic managed artwork cache under `artwork-cache-v2`.
- `ArtworkDownloadManager`: the single production entry point for automatic artwork downloads.
- `ArtworkDownloadScheduler`: priority queue and in-flight URL deduplication for artwork downloads.
- `ArtworkHttpClient`: HTTP fetch, revalidation, retry, MIME, and size handling for managed artwork.
- `ArtworkBandwidthPolicy`: automatic artwork budget and Data Saver policy.
- `ArtworkNetworkTelemetry`: sanitized artwork network diagnostics and measurement counters.
- `MetadataCacheStore`: full metadata cache persistence.
- `BackgroundMetadataPipeline`: background metadata resolution and image update flow.
- `BackgroundDownloadService`: background asset download support.
- `RefetchImagesService`: missing-image refetch orchestration.
- `ScanDiagnosticsWriter`: scan diagnostics output.

## Artwork Delivery Architecture

Managed artwork delivery is cache-first and content-addressed. The automatic cache lives under:

```text
<userData>/artwork-cache-v2/
  assets/
    <contentHash>.<ext>
  manifest.json
  manifest.backup.json
  temp/
```

The cache records two kinds of references:

- URL aliases: original remote URL hash to a physical content hash.
- Game aliases: `canonicalGameId + artwork type` to the same physical content hash.

Physical files are deduplicated by image bytes, so repeated URLs and different URLs that return identical content share one asset. Different local, Steam, Epic, installed, and display identities may point at the same cached file through aliases without copying the file.

`ContentAddressedArtworkCache` owns only automatic managed artwork. It must not use, write, migrate into, or delete `user_artwork`; explicit Settings and Creator artwork remains owned by Artwork State V2 and `ArtworkAssetStore`. Legacy `image_cache` remains compatible and can be migrated into `artwork-cache-v2` without network access or deleting legacy files.

### Request Flow

All normal automatic artwork downloads must route through `ArtworkDownloadManager`.

```text
renderer / sync / metadata
  -> IPC or registered asset downloader
  -> ArtworkDownloadManager
  -> ContentAddressedArtworkCache lookup
  -> ArtworkBandwidthPolicy decision
  -> ArtworkDownloadScheduler
  -> ArtworkHttpClient
  -> ContentAddressedArtworkCache commit
```

Rules:

- Cache hits return trusted `file://` URLs without HTTP body downloads.
- The same in-flight URL is downloaded once; joined callers are recorded as deduplicated and spend no extra bandwidth budget.
- Game Details requests use `game-details` priority and outrank visible, prewarm, and background work.
- Visible covers use `visible` priority.
- Ready-to-install prewarm uses `prewarm` priority and must not mass-download hero/logo for the full library.
- Background artwork uses `background` priority and is subject to automatic bandwidth limits.
- Data Saver allows automatic cover prewarm but skips automatic hero/logo; interactive Game Details requests still proceed.
- IGDB source URLs are reduced to officially supported display sizes where possible while preserving the original URL alias.

### Startup, Sync, And Offline Behavior

Startup is cache-first:

- Installed and visible synced covers are read from `artwork-cache-v2` or legacy `image_cache` before network hydration.
- Cached cover display must not wait for account sync.
- Cached artwork response bodies must not be downloaded again.

Account sync is metadata-first:

- Library metadata and merged cache writes complete before background artwork fetches finish.
- Cover-first write-back can emit visible cover updates independently.
- Full-library hero/logo downloads are not part of the sync critical path.

Offline behavior:

- Cache-only lookup paths must not call HTTP.
- Missing cached artwork returns `null` or the original remote URL depending on the caller contract, without crashing.
- Corrupt, non-image, oversized, or interrupted downloads are rejected and temp files are cleaned.

### Renderer Boundary

Renderer surfaces must not assign direct remote URLs to normal cover, hero, logo, Home, Installed, or Last Played artwork elements. They should request cached assets through preload/IPC and render only cache-backed or embedded/local values for normal artwork paths.

Current renderer guards:

- `isCacheBackedArtworkUrl` rejects `http://` and `https://` values for stable card and hero setters.
- Jump Back In uses `_jbiCacheBackedArtworkValue` before assigning initial, refreshed, or fallback image candidates.
- `cache-image` and `cache-all-assets` IPC delegate to `ArtworkDownloadManager`.

### Diagnostics And Measurements

`ArtworkNetworkTelemetry` is the measurement layer for Phase 25.2A and later artwork delivery work. It stores sanitized counters only; raw URLs and secrets must not be persisted.

Required counters include:

- total downloaded bytes
- response-body bytes
- cache hits
- cache misses
- HTTP 304 count
- failed requests
- in-flight deduplicated requests
- renderer direct remote request count
- per-subsystem and per-asset-type buckets
- repeated URL hashes

`ArtworkDownloadManager.getStats()` exposes cache, scheduler, and bandwidth policy stats, including duplicate content files avoided and scheduler deduplication counts.

### Preservation Rules

Do:

- Keep Artwork State V2 as the explicit artwork authority.
- Keep `user_artwork` separate from automatic cache eviction.
- Preserve cache aliases across canonical identities.
- Preserve preload, IPC, and public sync API compatibility.
- Add executable tests before changing delivery policy.

Do not:

- Introduce Artwork State V3 for automatic cache work.
- Use game title as a cache identity.
- Delete user-selected artwork during automatic cache pruning.
- Let renderer cover/hero/logo paths bypass the manager with direct remote URLs.
- Make account sync wait for all artwork.
- Mass-download hero/logo for every synced game.

## IPC Boundary

`src/features/games/infrastructure/ipc/games.ipc.js` is the Games IPC adapter.

- It should preserve all IPC channel names and payload shapes.
- Renderer and preload contracts should not change during internal refactors.
- Legacy handlers may still exist outside the Games feature.
- New Games work should prefer `games.ipc.js` and application use cases.

## Production Entry Points

- `main.js` gets the Games API through `getGamesFeature()`.
- `platformSync.js` gets the Games API through `getGamesFeature()`.
- No production code should require `gameScanner.js`.
- `gameScanner.js` no longer exists.

## Testing Rules

- Use `createGamesFeature(options)` for isolated container tests.
- Use `getGamesFeature()` only when testing singleton behavior.
- Use `BaddelEngine.js` for legacy engine tests.
- Use `GameScannerCore.js` for platform scanner and helper tests.
- Avoid source-text tests against removed files.

## Rules for Future Work

Do:

- Add new behavior as use cases first when possible.
- Inject infrastructure dependencies into use cases.
- Preserve IPC contracts.
- Add focused tests before moving risky legacy logic.
- Run full tests and smoke after architecture changes.

Do not:

- Recreate root-level `gameScanner.js`.
- Import `createGamesFeature()` from production code.
- Create multiple Games containers in production.
- Add new Games logic directly to `main.js`.
- Add new scanner logic to `BaddelEngine` unless it is temporary and documented.
- Change renderer/preload contracts casually.

## Migration Status

Completed:

- `gameScanner.js` removed.
- Protected build passed after deletion.
- `main.js` migrated to the Games singleton.
- `platformSync.js` migrated to the Games singleton.

Remaining future work:

- Shrink `BaddelEngine` further.
- Migrate more IPC channels natively into `games.ipc.js`.
- Eventually remove or rename legacy `BaddelEngine` once all logic is extracted.
