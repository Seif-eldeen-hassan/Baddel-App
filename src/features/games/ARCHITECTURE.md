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
- `MetadataCacheStore`: full metadata cache persistence.
- `BackgroundMetadataPipeline`: background metadata resolution and image update flow.
- `BackgroundDownloadService`: background asset download support.
- `RefetchImagesService`: missing-image refetch orchestration.
- `ScanDiagnosticsWriter`: scan diagnostics output.

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
