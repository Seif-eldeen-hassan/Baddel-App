# Baddel App — Architecture Execution Roadmap

**Version:** 1.0  
**Status:** Active — Single Source of Truth  
**Last updated:** 2026-06-17  
**Applies to:** All refactoring work on the `main` branch from this point forward

> This document is the canonical reference for the entire architecture migration. Every PR, every code review, and every architecture decision during this project must be reconcilable with this roadmap. If reality diverges from this document, update the document first and get consensus before proceeding.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Final Target Architecture](#2-final-target-architecture)
3. [Migration Philosophy](#3-migration-philosophy)
4. [Full Step-by-Step Execution Plan](#4-full-step-by-step-execution-plan)
   - [Phase 0: Safety Foundation](#phase-0-safety-foundation)
   - [Phase 1: Architecture Setup](#phase-1-architecture-setup-no-logic-changes)
   - [Phase 2: Pure Module Migration](#phase-2-pure-module-migration)
   - [Phase 3: IPC Refactor](#phase-3-ipc-refactor)
   - [Phase 4: Service Layer Migration](#phase-4-service-layer-migration)
   - [Phase 5: God File Decomposition](#phase-5-god-file-decomposition)
   - [Phase 6: Renderer Refactor](#phase-6-renderer-refactor)
   - [Phase 7: Cleanup Phase](#phase-7-cleanup-phase)
5. [Verification Strategy](#5-verification-strategy)
6. [Risk Register](#6-risk-register)
7. [Team Execution Rules](#7-team-execution-rules)
8. [Final Outcome Definition](#8-final-outcome-definition)

---

## 1. Executive Summary

### What We Are Transforming

Baddel is a production Electron desktop gaming launcher that aggregates Steam, Epic, EA, Ubisoft, Xbox, Riot, Discord, and Rockstar libraries into a single UI. The application works correctly. The problem is not what it does — it is how it is organized.

The current codebase contains several files in the 2,000–10,000 line range where multiple concerns are collapsed into a single module. Business logic lives inside IPC handlers. Rendering code makes direct decisions about platform behavior. Infrastructure details (filesystem paths, subprocess management, API calls) are scattered with no consistent home. There is no enforced boundary between what a layer is allowed to know about.

The consequence is not a broken app — it is an app that becomes increasingly expensive to extend, debug, and reason about as it grows. Adding a new platform integration, for example, currently requires understanding the internals of `platformSync.js` (3,561 lines) before writing a single new line.

### What We Are Building

A **Feature-Based Clean Architecture** where the codebase is organized around business capabilities (accounts, games, launcher, sync, playtime, metadata, collections, quick-switcher) rather than around technical roles (handlers, services, utils). Inside each feature, a four-layer structure enforces that business rules never depend on infrastructure details, and that UI never contains business logic.

### Why This Architecture

- A developer working on Epic account linking reads only `src/features/accounts/` — nothing else.
- A bug in metadata resolution is always in `src/features/metadata/` — never scattered.
- Adding a new platform adds one directory — it does not require editing any existing files.
- The test suite can grow feature by feature because each feature's domain and application layers have no Electron dependencies.

### Expected End State

```
src/
  main/         ~150 lines — Electron orchestration only
  preload/      ~315 lines — IPC bridge only (minimal change from today)
  shared/       Cross-cutting pure utilities
  features/     8 self-contained feature modules
    accounts/
    games/
    launcher/
    playtime/
    metadata/
    sync/
    collections/
    quick-switcher/
```

Every feature follows an identical internal four-layer template. No file in the project exceeds 600 lines. Every layer boundary is enforced by an automated lint rule — not by code review convention.

---

## 2. Final Target Architecture

### 2.1 Global Directory Structure

```
E:\Baddel\Baddel-App\
├── src/
│   ├── main/
│   │   ├── index.js                   # Entry point — app.whenReady + handler registration
│   │   ├── app-lifecycle.js           # app.on('ready/quit/before-quit') logic
│   │   ├── window-manager.js          # BrowserWindow creation and management
│   │   ├── tray.js                    # Tray icon + context menu
│   │   └── ipc/
│   │       ├── systemIpcAdapter.js    # OS-level IPC (screen, power, paths)
│   │       ├── windowIpcAdapter.js    # Window control IPC
│   │       ├── updateIpcAdapter.js    # Auto-update IPC
│   │       └── externalLinkAdapter.js # shell.openExternal IPC
│   │
│   ├── preload/
│   │   └── index.js                   # contextBridge surface — no logic
│   │
│   ├── shared/
│   │   ├── analytics/
│   │   │   └── analytics.js           # Consent-gated PostHog + GA4 batching
│   │   ├── crypto/
│   │   │   └── credentialEncryption.js # AES-256-GCM key management
│   │   ├── ipc/
│   │   │   └── ipcValidation.js       # Input validation primitives
│   │   └── utils/
│   │       └── domUtils.js            # Renderer DOM helpers
│   │
│   ├── features/
│   │   ├── accounts/
│   │   ├── games/
│   │   ├── launcher/
│   │   ├── playtime/
│   │   ├── metadata/
│   │   ├── sync/
│   │   ├── collections/
│   │   └── quick-switcher/
│   │
│   └── renderer/
│       ├── dashboard.html
│       ├── quick-switcher.html
│       └── play-launcher.html
│
├── bin/                               # Unchanged — legendary.exe, etc.
├── baddel-steam-integration/          # Unchanged — Python venv
├── tests/                             # Migrates with each feature
├── docs/
│   └── ipc-contracts.md               # Created in Phase 0
├── CLAUDE.md
└── package.json
```

### 2.2 Feature Internal Structure (Four-Layer Template)

Every feature in `src/features/` follows this exact internal structure. Names adapt; layers do not.

```
src/features/{feature-name}/
├── domain/
│   ├── entities/
│   │   └── {Entity}.js               # Plain data class + validation. No I/O. No Electron.
│   ├── repositories/
│   │   └── I{Entity}Repository.js    # Interface (JSDoc @interface). Defines persistence contract.
│   └── services/
│       └── {Feature}DomainService.js # Pure business rules. No I/O. Testable without mocks.
│
├── application/
│   └── useCases/
│       ├── {Action}{Entity}UseCase.js # One class per user-triggered operation.
│       └── ...                        # Calls repository interfaces + domain services only.
│
├── infrastructure/
│   ├── repositories/
│   │   └── Json{Entity}Repository.js # Implements domain interface. Reads/writes filesystem.
│   ├── ipc/
│   │   └── {feature}IpcAdapter.js    # Validates IPC args → calls use case → returns result.
│   └── integrations/                  # Only present for features that call external systems.
│       └── {Platform}/
│           └── {Platform}Integration.js
│
└── presentation/
    └── {Feature}UiController.js      # Renderer-side only. Calls window.electronAPI. No logic.
```

### 2.3 Data Flow (Immutable Rule)

```
Renderer (presentation/)
    │  window.electronAPI.someAction(args)
    ▼
preload/index.js
    │  ipcRenderer.invoke('channel-name', validatedArgs)
    ▼
infrastructure/ipc/{feature}IpcAdapter.js
    │  validates args → instantiates or calls use case
    ▼
application/useCases/{Action}UseCase.js
    │  calls IRepository interface + domain services
    ▼
domain/  ←──────────────────── business rules live here; nothing from outside enters here
    │
infrastructure/repositories/Json{Entity}Repository.js
    │  implements IRepository with real filesystem/API calls
    ▼
infrastructure/integrations/  ←── Steam, Epic, Riot, etc. only ever touched here
```

**The single enforced rule:** Dependency arrows point inward toward `domain/`. Domain never imports from infrastructure. Infrastructure never imports from presentation.

### 2.4 Layer Responsibilities

| Layer | What it contains | What it may import |
|---|---|---|
| `domain/` | Entities, pure business rules, repository interfaces | Nothing external |
| `application/` | Use cases, workflow orchestration | `domain/` only |
| `infrastructure/` | IPC adapters, JSON repos, API clients, OS helpers | `application/`, `domain/`, `src/shared/` |
| `presentation/` | UI controllers, view-binding, event wiring | `src/shared/utils/` only (no use cases directly) |
| `src/shared/` | Zero-dependency cross-cutting utilities | Nothing |
| `src/main/` | Electron app lifecycle, handler registration | Feature IPC adapters only |
| `src/preload/` | `contextBridge` surface | Nothing (security boundary) |

---

## 3. Migration Philosophy

### 3.1 The Strangler Fig Pattern

The migration strategy is modeled on the Strangler Fig pattern from Martin Fowler: new architecture grows alongside the old system, gradually taking over more surface area, until the old system is fully replaced and removed.

**Concretely:** At no point during this migration does the application stop working. Old files are kept in place and remain functional. New files are added in the new structure. A shim (a one-line re-export) at the old path redirects existing callers to the new file. Only after all callers have been updated to import from the new path is the shim deleted.

```js
// Example shim — left at old path during migration
// platformSyncShared.js (root level)
// MIGRATION SHIM — delete once all imports updated to @features/sync/domain/services/MergeService
module.exports = require('./src/features/sync/domain/services/MergeService');
```

### 3.2 The No-Big-Bang Rule

No single PR may move more than one logical unit of work. A "logical unit" is:
- One file being moved to a new location, OR
- One function being extracted from a god file into a new module, OR
- One IPC channel's handler being redirected through the new adapter path

A PR that moves three handler files in one commit is acceptable. A PR that restructures `platformSync.js` in its entirety is not. The constraint is not about line count — it is about cognitive and rollback scope.

### 3.3 Old and New Systems Coexist

During the migration (Phases 1–6), the following directories will exist simultaneously:
- `handlers/` (being emptied) alongside `src/features/*/infrastructure/ipc/` (being filled)
- `services/` (being emptied) alongside `src/features/*/infrastructure/` and `src/shared/`
- `gameScanner.js` at root (façade) alongside `src/features/games/` (the real implementation)

This is intentional. The coexistence period is what makes the migration safe. Never delete old code until the new replacement is proven to work in production.

### 3.4 Incremental Verification Gate

Every step in this roadmap ends with a verification gate. No step may be marked complete until its gate passes. The gate is defined in [Section 5](#5-verification-strategy) for each phase.

---

## 4. Full Step-by-Step Execution Plan

---

### Phase 0: Safety Foundation

**Goal:** Make the codebase safe to migrate. Nothing moves yet. We build the safety net that makes all subsequent phases low-risk.

**Duration:** 1 week  
**Risk:** None — only additions, no deletions, no moves

---

#### Step 0.1 — Document All IPC Contracts

Create `docs/ipc-contracts.md`. For every IPC channel in the application, record:
- Channel name (exact string)
- Direction (invoke/handle or send/on)
- Input parameters and their types
- Return value and its type
- Which handler file currently owns it
- Which renderer file currently calls it

To find all channels, run:
```
grep -r "ipcMain.handle\|ipcMain.on" handlers/ main.js --include="*.js" -h | sort
grep -r "ipcRenderer.invoke\|ipcRenderer.send\|electronAPI\." src/js/ preload.js --include="*.js" -h | sort
```

The resulting document has approximately 50–60 entries. This document is the regression specification for the entire migration. If any IPC channel changes its name, changes its return shape, or disappears, it is a breaking change.

**Expected output:** `docs/ipc-contracts.md` with one entry per channel.

---

#### Step 0.2 — Add Smoke Tests for Critical Paths

The existing test suite (`tests/*.test.js`) covers pure logic well but does not cover IPC. Add smoke-level integration tests for the four highest-risk operations. These do not need to be comprehensive — they need to be fast enough to run on every PR and catch catastrophic regressions.

Create `tests/smoke/`:

**`tests/smoke/gameLibrary.smoke.test.js`**
- Start the main process with a test `userData` directory
- Invoke `get-game-library` via IPC
- Assert the return value is an array (not undefined, not null, not an error)

**`tests/smoke/platformSync.smoke.test.js`**
- Invoke `get-platform-sync-status` 
- Assert it returns an object with at least a `steam` key

**`tests/smoke/launcher.smoke.test.js`**
- Invoke `get-launcher-paths` or equivalent
- Assert it returns without throwing

**`tests/smoke/accounts.smoke.test.js`**
- Invoke `get-linked-accounts`
- Assert it returns an array or empty object (not an error)

Add `npm run smoke` to `package.json`:
```json
"smoke": "node --test tests/smoke/*.smoke.test.js"
```

**Expected output:** 4 smoke tests that pass on the current codebase and will catch any catastrophic IPC regression.

---

#### Step 0.3 — Configure Path Aliases

In `package.json` (or the `scripts/build-protected.js` esbuild config that already exists), register the following path aliases so new code can use clean import paths:

```js
// In esbuild config or jest config:
alias: {
  '@features': path.resolve(__dirname, 'src/features'),
  '@shared':   path.resolve(__dirname, 'src/shared'),
  '@main':     path.resolve(__dirname, 'src/main'),
}
```

For Node-native `require()` in the main process, add to `package.json`:
```json
"_moduleAliases": {
  "@features": "src/features",
  "@shared":   "src/shared",
  "@main":     "src/main"
}
```
And `require('module-alias/register')` at the very top of `main.js`.

Test by creating a temporary file that uses `require('@shared/utils/domUtils')` and verifying it resolves.

**Expected output:** Path aliases work. All existing tests still pass.

---

#### Step 0.4 — Install and Configure ESLint Boundary Rules

Install `eslint-plugin-import` (likely already installed) and `eslint-plugin-boundaries`:
```
npm install --save-dev eslint-plugin-boundaries
```

Add to `.eslintrc.js` (create if it does not exist):
```js
module.exports = {
  plugins: ['boundaries'],
  settings: {
    'boundaries/elements': [
      { type: 'domain',         pattern: 'src/features/*/domain/**' },
      { type: 'application',    pattern: 'src/features/*/application/**' },
      { type: 'infrastructure', pattern: 'src/features/*/infrastructure/**' },
      { type: 'presentation',   pattern: 'src/features/*/presentation/**' },
      { type: 'shared',         pattern: 'src/shared/**' },
      { type: 'main',           pattern: 'src/main/**' },
    ]
  },
  rules: {
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        { from: 'domain',         allow: [] },
        { from: 'application',    allow: ['domain'] },
        { from: 'infrastructure', allow: ['application', 'domain', 'shared'] },
        { from: 'presentation',   allow: ['shared'] },
        { from: 'shared',         allow: [] },
        { from: 'main',           allow: ['infrastructure', 'shared'] },
      ]
    }]
  }
};
```

Add `"lint": "eslint src/"` to `package.json` scripts.

Run `npm run lint` and fix any pre-existing violations before Phase 1 begins.

**Expected output:** ESLint is active. Any future boundary violation is a lint error that blocks CI.

---

#### Step 0.5 — Scaffold the Directory Tree

Create the full target directory skeleton. All directories are empty at this point — no code moves yet. The skeleton confirms the structure is agreed upon and lets developers start placing new files in the right location immediately.

```
mkdir -p src/main/ipc
mkdir -p src/preload
mkdir -p src/shared/analytics
mkdir -p src/shared/crypto
mkdir -p src/shared/ipc
mkdir -p src/shared/utils
mkdir -p src/renderer
mkdir -p src/features/accounts/domain/entities
mkdir -p src/features/accounts/domain/repositories
mkdir -p src/features/accounts/domain/services
mkdir -p src/features/accounts/application/useCases
mkdir -p src/features/accounts/infrastructure/repositories
mkdir -p src/features/accounts/infrastructure/ipc
mkdir -p src/features/accounts/infrastructure/integrations
mkdir -p src/features/accounts/presentation
# Repeat for: games, launcher, playtime, metadata, sync, collections, quick-switcher
mkdir -p src/features/games/domain/entities
mkdir -p src/features/games/domain/repositories
mkdir -p src/features/games/domain/services
mkdir -p src/features/games/application/useCases
mkdir -p src/features/games/infrastructure/repositories
mkdir -p src/features/games/infrastructure/ipc
mkdir -p src/features/games/presentation
mkdir -p src/features/launcher/domain/entities
mkdir -p src/features/launcher/domain/services
mkdir -p src/features/launcher/application/useCases
mkdir -p src/features/launcher/infrastructure/ipc
mkdir -p src/features/launcher/infrastructure/strategies
mkdir -p src/features/launcher/presentation
mkdir -p src/features/playtime/domain/entities
mkdir -p src/features/playtime/domain/repositories
mkdir -p src/features/playtime/domain/services
mkdir -p src/features/playtime/application/useCases
mkdir -p src/features/playtime/infrastructure/repositories
mkdir -p src/features/playtime/infrastructure/ipc
mkdir -p src/features/playtime/infrastructure/osHelper
mkdir -p src/features/playtime/presentation
mkdir -p src/features/metadata/domain/entities
mkdir -p src/features/metadata/domain/repositories
mkdir -p src/features/metadata/application/useCases
mkdir -p src/features/metadata/infrastructure/apis
mkdir -p src/features/metadata/infrastructure/cache
mkdir -p src/features/metadata/infrastructure/ipc
mkdir -p src/features/metadata/presentation
mkdir -p src/features/sync/domain/entities
mkdir -p src/features/sync/domain/repositories
mkdir -p src/features/sync/domain/services
mkdir -p src/features/sync/application/useCases
mkdir -p src/features/sync/infrastructure/repositories
mkdir -p src/features/sync/infrastructure/ipc
mkdir -p src/features/sync/infrastructure/integrations/steam
mkdir -p src/features/sync/infrastructure/integrations/epic
mkdir -p src/features/sync/infrastructure/integrations/riot
mkdir -p src/features/sync/infrastructure/integrations/xbox
mkdir -p src/features/sync/infrastructure/integrations/ea
mkdir -p src/features/sync/infrastructure/integrations/ubisoft
mkdir -p src/features/sync/infrastructure/integrations/rockstar
mkdir -p src/features/sync/infrastructure/integrations/discord
mkdir -p src/features/collections/domain/entities
mkdir -p src/features/collections/domain/repositories
mkdir -p src/features/collections/application/useCases
mkdir -p src/features/collections/infrastructure/repositories
mkdir -p src/features/collections/infrastructure/ipc
mkdir -p src/features/collections/presentation
mkdir -p src/features/quick-switcher/domain/entities
mkdir -p src/features/quick-switcher/application/useCases
mkdir -p src/features/quick-switcher/infrastructure/ipc
mkdir -p src/features/quick-switcher/infrastructure/settings
mkdir -p src/features/quick-switcher/infrastructure/candidate
mkdir -p src/features/quick-switcher/presentation
```

Place a `.gitkeep` in each empty leaf directory so git tracks the structure.

**Expected output:** Full directory skeleton exists. All tests still pass. App still runs.

---

#### Phase 0 Verification Gate

```bash
npm test           # All 60 existing tests pass
npm run smoke      # All 4 smoke tests pass
npm run lint       # Zero errors in src/ (which has only .gitkeep files)
# Start the app manually and verify:
# - Game library loads
# - At least one account panel opens
# - Quick switcher opens
```

---

### Phase 1: Architecture Setup (No Logic Changes)

**Goal:** Move HTML files, CSS files, and the renderer entry points to their new locations. Verify the app still builds and renders. No JavaScript logic changes at all.

**Duration:** 3–4 days  
**Risk:** Low — build path changes only

---

#### Step 1.1 — Move HTML Entry Points

Move:
```
src/dashboard.html      → src/renderer/dashboard.html
src/quick-switcher.html → src/renderer/quick-switcher.html
```

Update `main.js` `BrowserWindow.loadFile()` calls and electron-builder config to reference new paths.

Update any `<link>` and `<script>` tags inside the HTML files to point to the correct relative CSS and JS paths (they will have changed by one directory level).

Verify: `npm run dist` still builds. App opens correctly.

#### Step 1.2 — Move CSS Files

Move:
```
src/css/ → src/renderer/css/
```

Update all `<link rel="stylesheet">` references in the moved HTML files.

#### Step 1.3 — Create Shared Placeholder Exports

Create stub files in `src/shared/` so the path aliases resolve immediately:

```js
// src/shared/analytics/analytics.js
// MIGRATION PLACEHOLDER — populated in Phase 2
module.exports = require('../../analytics');
```

```js
// src/shared/crypto/credentialEncryption.js
// MIGRATION PLACEHOLDER — populated in Phase 2
module.exports = require('../../services/credentialEncryption');
```

```js
// src/shared/ipc/ipcValidation.js
// MIGRATION PLACEHOLDER — populated in Phase 2
module.exports = require('../../services/ipcValidation');
```

```js
// src/shared/utils/domUtils.js
// MIGRATION PLACEHOLDER — populated in Phase 2
module.exports = require('../../src/js/domUtils');
```

These stubs mean `@shared/crypto/credentialEncryption` works immediately, even though the actual file hasn't moved yet.

#### Step 1.4 — Audit electron-store Key Names

Before any code moves, run this audit once and document all `electron-store` key reads and writes across the codebase:

```
grep -r "store\.get\|store\.set\|store\.delete" . --include="*.js" --exclude-dir=node_modules
```

Record every key name in `docs/ipc-contracts.md` under a "Persisted Configuration Keys" section. No key name may change during the migration. This catches a class of bugs where two files think they own different key names for the same config value.

---

#### Phase 1 Verification Gate

```bash
npm start             # App starts with no white screen
npm test              # All tests pass
npm run lint          # No new errors
# Manually verify: dashboard renders, quick-switcher opens, game cards show
```

---

### Phase 2: Pure Module Migration

**Goal:** Move files that are already pure (no side effects at module load, no Electron dependencies) into their final locations. These are the lowest-risk moves in the entire project.

**Duration:** 1 week  
**Risk:** Very low — these modules have no startup side effects

For each move in this phase, the process is identical:
1. Copy the file to its new location
2. Update its internal imports to use `@shared` paths where applicable
3. Replace the old file with a one-line re-export shim pointing to the new location
4. Update one import in the codebase to use the new path (to validate the alias works)
5. Run tests
6. In a separate follow-up PR, update all remaining imports to the new path
7. Delete the shim

---

#### Step 2.1 — Move `platformSyncShared.js`

This is the safest move in the project. The file is already pure and already has test coverage.

```
platformSyncShared.js  →  src/features/sync/domain/services/MergeService.js
```

Action:
```bash
cp platformSyncShared.js src/features/sync/domain/services/MergeService.js
```

Replace `platformSyncShared.js` with:
```js
// MIGRATION SHIM — Remove after all imports updated to @features/sync/domain/services/MergeService
module.exports = require('./src/features/sync/domain/services/MergeService');
```

Update `tests/platformSyncShared.test.js` to import from the new path. Rename the test file to `tests/features/sync/MergeService.test.js` in a second commit.

Verify: `npm test` passes. The test suite now imports from `src/features/sync/domain/services/MergeService.js`.

---

#### Step 2.2 — Move `services/playtimeShared.js`

```
services/playtimeShared.js  →  src/features/playtime/domain/services/PlaytimeCalculationService.js
```

Replace `services/playtimeShared.js` with a shim.

Update imports in `playtimeOsHelper.js` and any handler that requires it.

---

#### Step 2.3 — Move `services/credentialEncryption.js`

```
services/credentialEncryption.js  →  src/shared/crypto/credentialEncryption.js
```

Remove the placeholder shim created in Step 1.3 and replace it with the actual file content.

Replace `services/credentialEncryption.js` with:
```js
// MIGRATION SHIM
module.exports = require('../src/shared/crypto/credentialEncryption');
```

Update imports in `accountsHandler.js` to use `@shared/crypto/credentialEncryption`.

**Security note:** Do not change the encryption algorithm, IV generation, or key derivation in this step. Pure file move only.

---

#### Step 2.4 — Move `services/ipcValidation.js`

```
services/ipcValidation.js  →  src/shared/ipc/ipcValidation.js
```

Replace with shim. Update imports in all handler files that reference it.

---

#### Step 2.5 — Move `analytics.js`

```
analytics.js  →  src/shared/analytics/analytics.js
```

Analytics is nearly pure — the consent gate check and event batching have no Electron startup side effect. The only Electron dependency is `app.getPath('userData')` called inside functions, not at module load.

Replace root `analytics.js` with shim. Update imports in `main.js` and any handler that fires analytics events.

---

#### Step 2.6 — Move `src/js/domUtils.js`

```
src/js/domUtils.js  →  src/shared/utils/domUtils.js
```

Replace with shim. Update renderer file imports.

---

#### Phase 2 Verification Gate

```bash
npm test              # All 60+ tests pass
npm run smoke         # All 4 smoke tests pass
npm run lint          # No boundary violations
npm start             # App starts; manual check: game library, accounts, quick-switcher
# Verify: no shim is importing from another shim (shim chains cause subtle bugs)
grep -r "MIGRATION SHIM" . --include="*.js" | wc -l  # Should be exactly 6
```

---

### Phase 3: IPC Refactor

**Goal:** Move all 20 handler files from `handlers/` into their respective feature's `infrastructure/ipc/` directory. No IPC channel names change. No business logic changes. The only change is the file location and import paths.

**Duration:** 2 weeks  
**Risk:** Low — handlers already use DI pattern. Moving them is mechanical.

**Why this is low risk:** Every handler in `handlers/` already uses the pattern `module.exports.register = function(ipcMain, deps)`. There is no module-level state in any handler. Moving a handler file is equivalent to renaming it — `main.js` just requires it from a new path.

**Process for each handler:**
1. Copy handler file to `src/features/{feature}/infrastructure/ipc/{feature}IpcAdapter.js`
2. Update internal `require()` paths to use `@shared` or `@features` aliases
3. Update the `require()` in `main.js` to point to the new location
4. Delete the old file from `handlers/`
5. Run `npm run smoke` and manual spot-check of that feature

**Do not batch multiple handlers into one PR.** One handler per PR keeps rollback surface small.

---

#### Step 3.1 — Migrate Zero-Dependency Handlers (Days 1–3)

These handlers have the fewest external dependencies. Migrate them first to validate the process.

**`handlers/windowHandlers.js`** → `src/main/ipc/windowIpcAdapter.js`

This handler calls `BrowserWindow` APIs only. It belongs in `src/main/ipc/` not in a feature. No business logic.

**`handlers/updateNotesHandlers.js`** → `src/main/ipc/updateNotesIpcAdapter.js`

Reads a JSON file and returns it. No business logic.

**`handlers/externalLinkHandlers.js`** → `src/main/ipc/externalLinkAdapter.js`

Calls `shell.openExternal`. No business logic. Belongs in main.

**`handlers/autoUpdateHandlers.js`** → `src/main/ipc/updateIpcAdapter.js`

Electron auto-updater. Belongs in main process infrastructure, not in a feature.

**Verification after each:** App starts. The specific UI functionality (window minimize, update notes display, external links) works.

---

#### Step 3.2 — Migrate Analytics Handler (Day 4)

**`handlers/analyticsHandlers.js`** → `src/shared/analytics/analyticsIpcAdapter.js`

Analytics is cross-cutting (not a feature). The adapter lives in `src/shared/analytics/`.

Update `analytics.js` (now at `src/shared/analytics/analytics.js`) import.

---

#### Step 3.3 — Migrate Small Feature Handlers (Days 5–7)

**`handlers/collectionHandlers.js`** → `src/features/collections/infrastructure/ipc/collectionsIpcAdapter.js`

**`handlers/playtimeHandlers.js`** → `src/features/playtime/infrastructure/ipc/playtimeIpcAdapter.js`

**`handlers/accountShortcutHandlers.js`** → `src/features/accounts/infrastructure/ipc/accountShortcutIpcAdapter.js`

**`handlers/launcherPathHandlers.js`** → `src/features/launcher/infrastructure/ipc/launcherPathIpcAdapter.js`

**`handlers/quickSwitcherHandlers.js`** → `src/features/quick-switcher/infrastructure/ipc/quickSwitcherIpcAdapter.js`

**`handlers/baddelApiHandlers.js`** → `src/features/metadata/infrastructure/ipc/baddelApiIpcAdapter.js`

**`handlers/achievementHandlers.js`** → `src/features/sync/infrastructure/ipc/achievementIpcAdapter.js`

Note on `achievementHandlers.js`: This handler calls the Steam bridge. The achievement IPC serialization chain (`_achievementIpcChain` promise chain in `main.js`) must be preserved. When moving this adapter, copy the serialization logic into the adapter file itself — do not leave it in `main.js` dangling.

---

#### Step 3.4 — Migrate Image and Metadata Handlers (Days 8–9)

**`handlers/imageHandlers.js`** → `src/features/metadata/infrastructure/ipc/imageIpcAdapter.js`

**`handlers/localMetadataHandlers.js`** + **`handlers/gameMetadataHandlers.js`** → merge into `src/features/metadata/infrastructure/ipc/metadataIpcAdapter.js`

These two handlers operate on the same domain (game metadata) and can be merged into a single adapter file. This merge should be its own PR after both files are individually moved.

**`handlers/creatorPageHandlers.js`** → `src/features/metadata/infrastructure/ipc/creatorPageIpcAdapter.js`

---

#### Step 3.5 — Migrate Game Library Handlers (Days 10–11)

**`handlers/gameLibraryHandlers.js`** + **`handlers/installedGamesHandlers.js`** → `src/features/games/infrastructure/ipc/gameLibraryIpcAdapter.js`

These two handlers both operate on the game library. Merge them in the same way as Step 3.4.

**After this step, run the full smoke test suite.** The `get-game-library` smoke test is specifically designed to catch regressions here.

---

#### Step 3.6 — Migrate System Handlers (Day 12)

**`handlers/systemHandlers.js`** → `src/main/ipc/systemIpcAdapter.js`

This is the largest of the "main process" handlers (405 lines). It handles OS-level queries (screen size, power status, app paths). It belongs in `src/main/ipc/` not in a feature.

Split into logical groups within the same file if desired, but keep them all in `systemIpcAdapter.js` for now.

---

#### Step 3.7 — Migrate Launch Handler (Days 13–14)

**`handlers/launchHandlers.js`** (1,008 lines) → `src/features/launcher/infrastructure/ipc/launchIpcAdapter.js`

This is the most complex handler and requires preparation before moving:

**Pre-migration (same PR, before moving the file):**
1. Identify all business logic inside `launchHandlers.js` that is not IPC routing. This includes: launch strategy selection logic, process monitoring logic, retry logic, playtime session start/stop coordination.
2. Extract each business logic piece into a named function at the top of the file (still within `launchHandlers.js`). Give each function a name that describes what it does as a use case (`selectLaunchStrategy`, `monitorGameProcess`, etc.).
3. The `register()` function should now only call these extracted functions.

**Migration PR:**
1. Move the file to `src/features/launcher/infrastructure/ipc/launchIpcAdapter.js`
2. The extracted business logic functions remain inside the adapter for now (Phase 5 will move them into proper use cases)

**Verification:** Run the `tests/smoke/launcher.smoke.test.js` test. Manually launch one game.

---

#### Step 3.8 — Delete `handlers/` Directory

After all 20 handlers are moved, the `handlers/` directory is empty. Delete it. Update `main.js` to remove any references to `handlers/`.

Verify `handlers/` does not appear in any `require()` call:
```
grep -r "require.*handlers/" . --include="*.js" --exclude-dir=node_modules
# Must return zero results
```

---

#### Phase 3 Verification Gate

```bash
npm test              # All tests pass
npm run smoke         # All 4 smoke tests pass
npm run lint          # No boundary violations
grep -r "require.*handlers/" . --include="*.js" --exclude-dir=node_modules
# Zero results required
npm start
# Manual: launch a game, sync a platform, open accounts, use quick-switcher
```

---

### Phase 4: Service Layer Migration

**Goal:** Move all 15 service files from `services/` into their correct feature infrastructure layers. Some services need structural changes (splitting into application + infrastructure). Most are simple moves.

**Duration:** 2 weeks  
**Risk:** Medium — some services are called from many places

**For each service, before moving:**
```
grep -r "require.*services/{filename}" . --include="*.js" --exclude-dir=node_modules
```
This gives the complete list of callers that need their import updated.

---

#### Step 4.1 — Simple Moves (Week 1)

These services have a single clear responsibility and a single target location. No structural changes needed.

**`services/imageWebpCache.js`** → `src/features/metadata/infrastructure/cache/ImageWebpCacheService.js`

One of the most self-contained services. Handles WebP conversion and caching. No changes to logic.

**`services/steamLibraryAssets.js`** → `src/features/sync/infrastructure/integrations/steam/SteamLibraryAssetsService.js`

Small, focused. Used by sync infrastructure only.

**`services/safeLauncher.js`** → `src/features/launcher/infrastructure/SafeLauncherService.js`

Launch safety guardrails. Belongs in launcher infrastructure.

**`services/quickSwitcherSettings.js`** → `src/features/quick-switcher/infrastructure/settings/QuickSwitcherSettingsRepository.js`

Rename on move: it is a settings repository, not a generic "service."

**`services/accountShortcuts.js`** → `src/features/accounts/infrastructure/AccountShortcutsService.js`

---

#### Step 4.2 — API Client Move (Day 6)

**`services/baddelApi.js`** → `src/features/metadata/infrastructure/apis/BaddelApiService.js`

This is a 1,107-line file but it has a single clear responsibility: HTTP communication with the Baddel Metadata Server. The `ApiError` class inside it stays in the same file for now (it can be extracted to `domain/` later).

After moving, update imports in:
- The metadata IPC adapter (moved in Phase 3)
- Any handler that directly called `baddelApi`

---

#### Step 4.3 — Launcher Path Resolvers (Days 7–8)

**`services/launcherPathResolver.js`** (779 lines) → `src/features/launcher/infrastructure/launcherPathResolver.js`

**`services/riotPathResolver.js`** (534 lines) → `src/features/launcher/infrastructure/strategies/RiotPathResolver.js`

`riotPathResolver.js` is a specialization of the launcher path resolution strategy for the Riot platform. Moving it into `launcher/infrastructure/strategies/` communicates this relationship through file location.

These two files have many conditional branches for different installation paths. Do not change any logic during the move.

---

#### Step 4.4 — Account Service Migration (Days 9–10)

**`services/credentialValidator.js`** → `src/features/accounts/application/useCases/ValidateCredentialsUseCase.js`

This service already does one thing: validate credentials. Rename it to a use case on the move — the logic stays identical, only the file name and location change. This is the first real use case file in the system.

**`services/accountShortcuts.js`** → (already moved in Step 4.1 if done, otherwise move now)

---

#### Step 4.5 — Quick Switcher Service Migration (Days 11–12)

**`services/quickSwitcher.js`** (399 lines) → split:
- Core suggestion ranking logic → `src/features/quick-switcher/application/useCases/GetSuggestionsUseCase.js`
- The `QuickSwitcher` class initialization and wiring → stays as a thin coordinator in `infrastructure/`

**`services/candidateGenerator.js`** (273 lines) → `src/features/quick-switcher/infrastructure/candidate/CandidateGeneratorService.js`

This is the first extraction (as opposed to a simple move). The process:
1. Identify the pure ranking/scoring logic in `quickSwitcher.js` — functions that take inputs and return ranked candidates with no I/O
2. Copy those functions into `GetSuggestionsUseCase.js`
3. Have the `quickSwitcher.js` call the new use case for the pure logic
4. Replace `services/quickSwitcher.js` with a shim
5. Run tests

---

#### Step 4.6 — Metadata Resolution Manager Migration (Day 13)

**`services/metadataResolutionManager.js`** (431 lines) → split:
- Orchestration logic (which source to try first, retry policy, caching decisions) → `src/features/metadata/application/MetadataResolutionManager.js`
- API-calling implementation details (actual HTTP calls) → remains in infrastructure, calling `BaddelApiService.js`

The orchestration logic moves up one layer (from infrastructure to application). The HTTP calls stay in infrastructure. This is the first true layer boundary enforcement — the application layer now orchestrates without knowing HTTP details.

---

#### Step 4.7 — Delete `services/` Directory

After all 15 service files are moved (or have shims), verify:
```
grep -r "require.*services/" . --include="*.js" --exclude-dir=node_modules
# Must return only shim files
```

Update all remaining callers to use the new paths. Delete all shims. Delete `services/`.

---

#### Phase 4 Verification Gate

```bash
npm test
npm run smoke
npm run lint
grep -r "require.*services/" . --include="*.js" --exclude-dir=node_modules
# Zero non-shim results required
npm start
# Manual: verify quick-switcher search works, metadata loads for a game, images cache correctly
```

---

### Phase 5: God File Decomposition

**Goal:** Break apart the four remaining large files at the project root. Each file is decomposed by extracting one responsibility at a time. The original file becomes a thin façade that delegates to the new modules, and is deleted only after all callers have been updated.

**Duration:** 6–8 weeks  
**Risk:** High — these files are deeply coupled and touched by many parts of the app

**The golden rule for this phase:** Extract one responsibility per PR. Every PR leaves the app working. Never extract two responsibilities in the same PR.

---

#### Step 5.1 — Decompose `collectionsHandler.js` (110 lines)

This is the simplest god-file decomposition and serves as a warm-up.

**Extract 1 — Collection entity:**
```js
// src/features/collections/domain/entities/Collection.js
class Collection {
  constructor({ id, name, gameIds, createdAt }) {
    this.id = id;
    this.name = name;
    this.gameIds = gameIds || [];
    this.createdAt = createdAt;
  }
  addGame(gameId) { ... }
  removeGame(gameId) { ... }
}
module.exports = { Collection };
```

**Extract 2 — Repository:**
```js
// src/features/collections/infrastructure/repositories/JsonCollectionRepository.js
// Move all filesystem read/write logic from collectionsHandler.js here
// Implements ICollectionRepository interface
```

**Extract 3 — Use cases:**
```js
// src/features/collections/application/useCases/CreateCollectionUseCase.js
// src/features/collections/application/useCases/AddGameToCollectionUseCase.js
// etc.
```

After all three extractions, `collectionsHandler.js` should be ~10 lines of delegation. Replace with a shim pointing to the collection repository. The IPC adapter (moved in Phase 3) calls use cases directly.

---

#### Step 5.2 — Decompose `playtimeOsHelper.js` (246 lines)

Single responsibility: query process list and calculate process runtime. One move:

```
playtimeOsHelper.js  →  src/features/playtime/infrastructure/osHelper/PlaytimeOsHelper.js
```

No structural changes. Replace root file with shim.

---

#### Step 5.3 — Decompose `steamBridge.js` (1,103 lines)

**What it does:** Manages a long-running Python subprocess (`baddel_bridge.py`), communicating via JSON over stdin/stdout. Handles startup, authentication, request queuing, and response routing.

**Critical invariant to preserve:** There must be exactly one Python subprocess running at all times. The bridge is a singleton. If instantiated twice, you get two competing Python processes.

**Extract 1 — Subprocess management:**
```js
// src/features/sync/infrastructure/integrations/steam/SteamBridgeProcess.js
// Owns: spawn, kill, stdin/stdout line protocol, process exit handling
// Singleton enforced via module-level instance (Node require cache guarantees singleton)
```

**Extract 2 — Request queue and serialization:**
```js
// src/features/sync/infrastructure/integrations/steam/SteamBridgeQueue.js
// Owns: the promise-queue that serializes overlapping IPC calls
// THIS is where _achievementIpcChain logic (currently in main.js) moves to
```

**Extract 3 — Bridge service (coordinator):**
```js
// src/features/sync/infrastructure/integrations/steam/SteamBridgeService.js
// Owns: public API (authenticate, fetchAchievements, getOwnedGames, etc.)
// Delegates to SteamBridgeProcess and SteamBridgeQueue
// This is what callers import — they never import Process or Queue directly
```

Replace `steamBridge.js` with a shim to `SteamBridgeService.js`.

**Important:** The `_achievementIpcChain` in `main.js` must be moved into `SteamBridgeQueue.js` in the same PR that creates `SteamBridgeQueue`. After that PR, remove `_achievementIpcChain` from `main.js`.

**Verification after this step:** Fetch achievements for a linked Steam account. Verify the Python process appears in Task Manager exactly once.

---

#### Step 5.4 — Decompose `gameScanner.js` (3,650 lines)

`gameScanner.js` contains the `BaddelEngine` class which owns: game ID generation, games-db.json persistence, library scanning orchestration, metadata update operations, and the `MetadataResolutionManager` instance. These are four separate responsibilities.

**Do not rename `BaddelEngine` or change its public API during any extraction.** The class remains as a façade that delegates to the extracted modules. Callers see no change.

**Extract 1 — Game ID service (Week 1 of this step):**
```js
// src/features/games/domain/services/GameIdService.js
// Extract: the MD5 hash function and the game ID generation logic
// No I/O, no Electron. This is pure domain logic.
// BaddelEngine calls GameIdService.generate() instead of doing it inline
```

**Extract 2 — Game repository (Week 1 of this step):**
```js
// src/features/games/infrastructure/repositories/JsonGameRepository.js
// Extract: all games-db.json read/write operations
// Methods: load(), save(), findById(), findAll(), upsert(), remove()
// BaddelEngine holds a JsonGameRepository instance and delegates persistence to it
```

**Extract 3 — Game entity (Week 2 of this step):**
```js
// src/features/games/domain/entities/Game.js
// Extract: the game data structure, field validation, default values
// BaddelEngine constructs Game instances rather than plain objects
```

**Extract 4 — Scan use case (Week 2 of this step):**
```js
// src/features/games/application/useCases/ScanGamesUseCase.js
// Extract: the platform scanning orchestration logic
// Calls: JsonGameRepository, platform scanners (Steam, Epic, etc.)
// BaddelEngine.scanLibrary() becomes a one-line call to ScanGamesUseCase.execute()
```

**Extract 5 — Metadata update use case (Week 3 of this step):**
```js
// src/features/metadata/application/useCases/UpdateGameMetadataUseCase.js
// Extract: the updateMetadata / updateArtwork operations
// These belong in the metadata feature, not the games feature
// BaddelEngine.updateMetadata() becomes a call to this use case
```

**Extract 6 — MetadataResolutionManager:**
The `mrm` instance inside `gameScanner.js` should be instantiated by the metadata feature and passed into `BaddelEngine` as a dependency, not created inside it. After Step 4.6 (Phase 4), `MetadataResolutionManager` already lives in `src/features/metadata/`. Update `BaddelEngine` to accept it as a constructor parameter.

**After all 6 extractions:** `BaddelEngine` is a ~100-line façade. Replace `gameScanner.js` root file with a shim. Schedule deletion for Phase 7.

---

#### Step 5.5 — Decompose `accountsHandler.js` (2,009 lines)

**Security constraint:** Never change encryption logic and structural logic in the same PR. Encryption changes require an independent review.

**What it contains:** Per-platform OAuth/credential flows (Steam, Epic, EA, Ubisoft, Riot, Discord, Rockstar), Discord RPC management, credential persistence via keytar, account data encryption, and IPC handler registration. The IPC handler registration was moved in Phase 3 — the remaining code is the business logic those handlers call.

**Extract 1 — Per-platform integrations (one PR per platform):**

```js
// src/features/accounts/infrastructure/integrations/steam/SteamAccountIntegration.js
// Extract: Steam credential flow, Steam login logic
// One file per platform. One PR per platform.
```

Work through platforms in this order (simplest to most complex):
1. Rockstar (simplest OAuth flow)
2. Discord (unusual — RPC, not OAuth)
3. Riot
4. Ubisoft
5. EA
6. Epic
7. Steam (most complex — has fallback to Python bridge)

**For each platform extraction:**
1. Copy the platform-specific functions out of `accountsHandler.js` into the new integration file
2. In `accountsHandler.js`, replace those functions with calls to the new integration file
3. Run the accounts smoke test
4. Verify: link/unlink that specific platform in the running app

**Extract 2 — Discord RPC service (separate PR after Discord account integration):**
```js
// src/features/accounts/infrastructure/DiscordRpcService.js
// Discord Rich Presence is a separate concern from account linking
// Extract: the discord-rpc library management, activity updates
```

**Extract 3 — Account repository:**
```js
// src/features/accounts/infrastructure/repositories/KeytarAccountRepository.js
// Extract: all keytar read/write operations
// Methods: saveCredentials(), loadCredentials(), deleteCredentials()
// accountsHandler.js delegates all keytar calls here
```

**Extract 4 — Account use cases:**
```js
// src/features/accounts/application/useCases/LinkAccountUseCase.js
// src/features/accounts/application/useCases/UnlinkAccountUseCase.js
// src/features/accounts/application/useCases/RefreshAccountTokenUseCase.js
// Each orchestrates: validate → call platform integration → persist via repository
```

After all extractions, `accountsHandler.js` is a thin entry point. Replace with shim. Delete in Phase 7.

---

#### Step 5.6 — Decompose `platformSync.js` (3,561 lines)

This is the most complex decomposition in the project. `platformSync.js` contains module-level mutable state: `_libraryWriteQueue`, `_enrichRequestQueue`, `_libraryUpdateDebounceTimer`, `_platformSyncState`, `_platformSyncWindowGetter`, `_bridgeStarted`, `_steamBridgeListenersBound`, and per-platform log write queues.

**If this state is mishandled, sync will fail silently.** Treat this decomposition with the most care of anything in the project.

**Step 5.6.1 — Encapsulate mutable state first (Week 1, single PR):**

Before extracting anything, wrap all module-level variables into a class:

```js
// Still in platformSync.js — no file move, pure refactor
class PlatformSyncOrchestrator {
  constructor() {
    this._libraryWriteQueue = new Map();
    this._enrichRequestQueue = [];
    this._libraryUpdateDebounceTimer = null;
    this._platformSyncState = { steam: 'idle', epic: 'idle', ... };
    this._platformSyncWindowGetter = null;
    this._bridgeStarted = false;
    this._steamBridgeListenersBound = false;
    // per-platform log queues
  }
  
  // All existing functions become methods
  async syncSteamLibrary() { ... }
  async syncEpicLibrary() { ... }
  // etc.
}

const orchestrator = new PlatformSyncOrchestrator();
module.exports = orchestrator; // export the singleton instance
```

This PR has zero behavior change. It only restructures the code into a class. All callers see the same singleton object with the same methods.

**After this PR:** Run the full test suite AND manually trigger a Steam sync and Epic sync. Verify the debounce timers and write queues still work (library-updated events fire correctly to the renderer).

**Step 5.6.2 — Extract platform sync integrations (one per PR):**

For each platform, extract the sync-specific logic into an integration file:

```js
// src/features/sync/infrastructure/integrations/steam/SteamSyncIntegration.js
class SteamSyncIntegration {
  constructor({ steamBridgeService, steamLibraryAssetsService }) { ... }
  async fetchLibrary(accountId) { ... }        // Returns raw game list
  async enrichGame(game) { ... }               // Fetches playtime, artwork, etc.
}
module.exports = { SteamSyncIntegration };
```

The `PlatformSyncOrchestrator` holds an instance of each integration:
```js
this._steam = new SteamSyncIntegration({ ... });
this._epic = new EpicSyncIntegration({ ... });
```

Extract platforms in this order:
1. Xbox (fewest dependencies, most self-contained)
2. Rockstar
3. EA
4. Ubisoft
5. Riot
6. Discord
7. Epic
8. Steam (most complex — depends on SteamBridgeService)

One platform per PR. Verify each platform's sync works after its extraction.

**Step 5.6.3 — Extract merge logic (already done in Phase 2):**

`MergeService.js` (was `platformSyncShared.js`) is already in `src/features/sync/domain/services/`. The orchestrator should now call `MergeService` explicitly:

```js
const { mergeLibraries } = require('@features/sync/domain/services/MergeService');
// orchestrator calls mergeLibraries() instead of inline merge logic
```

**Step 5.6.4 — Extract sync use cases:**

```js
// src/features/sync/application/useCases/SyncPlatformUseCase.js
// Orchestrates: fetchLibrary → merge → persist → notify renderer
// PlatformSyncOrchestrator.syncSteamLibrary() becomes: new SyncPlatformUseCase('steam').execute()
```

**Step 5.6.5 — Extract sync repository:**

```js
// src/features/sync/infrastructure/repositories/JsonSyncRepository.js
// Owns: read/write of platform-sync/*.json files
// Methods: loadMergedLibrary(platform), saveMergedLibrary(platform, data)
```

**Step 5.6.6 — Move the orchestrator:**

After all extractions, `PlatformSyncOrchestrator` is thin coordination logic. Move it:
```
platformSync.js (root) → src/features/sync/infrastructure/PlatformSyncOrchestrator.js
```

Replace root `platformSync.js` with a shim. Delete shim in Phase 7.

---

#### Phase 5 Verification Gate

```bash
npm test
npm run smoke
npm run lint
# Manual deep-test (spend 30 minutes on this):
# - Link a Steam account; trigger sync; verify games appear
# - Link an Epic account; trigger sync; verify games appear  
# - Launch a game; verify playtime increments
# - Create a collection; add and remove games
# - Use quick-switcher; verify results are ranked correctly
# - Open game details; verify metadata and achievements load
# Check Task Manager: exactly one Python process while Steam bridge is active
```

---

### Phase 6: Renderer Refactor

**Goal:** Decompose the large renderer files into feature-aligned UI controllers. Each controller owns one concern. No file exceeds 600 lines.

**Duration:** 4–6 weeks  
**Risk:** Highest user-facing risk in the project. Renderer bugs are immediately visible.

**Strategy:** Do not attempt to restructure an entire renderer file at once. Extract one UI section at a time.

**Critical rule for renderer work:** The refactored UI controllers still call `window.electronAPI.*` through the same IPC channels. Do not change IPC contracts during renderer refactor. The IPC boundary is a stable interface.

---

#### Step 6.1 — Establish Renderer Controller Pattern

Before extracting any section from a large file, establish the controller pattern with the smallest possible file.

**`src/js/app/playtime.js`** (102 lines) → `src/features/playtime/presentation/playtimeUiController.js`

This file is already small. Move it, update its imports, verify the playtime display still works in the app. This proves the pattern works end-to-end before tackling the large files.

---

#### Step 6.2 — Extract `src/js/app/collections.js` (462 lines)

```
src/js/app/collections.js → src/features/collections/presentation/collectionsUiController.js
```

Straightforward move. Collections UI is reasonably self-contained.

---

#### Step 6.3 — Extract `src/js/quick-switcher.js` (564 lines)

```
src/js/quick-switcher.js → src/features/quick-switcher/presentation/quickSwitcherUiController.js
```

This file renders in a separate window (`quick-switcher.html`). The isolation makes it lower risk.

---

#### Step 6.4 — Extract `src/js/app/game-card.js` (708 lines)

```
src/js/app/game-card.js → src/features/games/presentation/gameCardController.js
```

Game cards are rendered in `app.js`. Verify the main library grid still renders after extraction.

---

#### Step 6.5 — Decompose `src/js/accounts.js` (4,241 lines)

Split into:
- `src/features/accounts/presentation/accountsUiController.js` — top-level account page controller
- `src/features/accounts/presentation/addAccountModalController.js` — modal logic (was also `addAccountModal.js`)

And move `src/js/accounts/`:
- `platform-panels.js` (2,186) → `src/features/accounts/presentation/platformPanelsController.js`
- `display-prefs.js` (343) → `src/features/accounts/presentation/displayPrefsController.js`

Extract one platform's panel per PR. Start with the simplest (Rockstar), end with Steam.

---

#### Step 6.6 — Decompose `src/js/game-details.js` (10,639 lines)

This is the highest-risk file in the project. It is the primary game detail page and touches nearly every feature.

Identify sections by scrolling through the file and marking section boundaries with comments first (a zero-risk PR):
```js
// === SECTION: Achievement Display ===
// === SECTION: Artwork Management ===
// === SECTION: Launch Button Logic ===
// === SECTION: Playtime Display ===
// === SECTION: Metadata Editor ===
// === SECTION: Screenshot Gallery ===
// === SECTION: Platform Ownership ===
```

Then extract one section per PR:

1. `src/features/playtime/presentation/GamePlaytimeController.js` — playtime display section
2. `src/features/launcher/presentation/GameLaunchController.js` — launch button section
3. `src/features/sync/presentation/GameAchievementsController.js` — achievement display section
4. `src/features/metadata/presentation/GameArtworkController.js` — artwork management section
5. `src/features/metadata/presentation/GameMetadataEditorController.js` — metadata editor section
6. `src/features/games/presentation/GamePlatformOwnershipController.js` — platform ownership section
7. What remains in `game-details.js` (< 600 lines) becomes a routing/layout controller

**Verification after each section extraction:** Open the game detail page for a game. Verify the extracted section works. Verify the remaining sections are unaffected.

---

#### Step 6.7 — Convert `src/js/app.js` to Orchestrator

After all sub-modules are extracted, `app.js` (currently 1,793 lines) should be reducible to an orchestrator that:
1. Imports all feature UI controllers
2. Initializes them in the correct order
3. Wires inter-controller events (e.g., "game selected in sidebar → open game details")

Target: `src/renderer/app.js` at ~200 lines.

---

#### Phase 6 Verification Gate

```bash
npm test
npm run smoke
npm run lint
# Comprehensive manual test (60 minutes):
# - Navigate to every page of the app
# - Open game details for 3 different games (different platforms)
# - Check achievements load
# - Verify artwork is displayed
# - Launch a game; verify launch animation plays
# - Link and unlink an account
# - Create, modify, and delete a collection
# - Sync a platform library from scratch
# - Use quick-switcher to find and launch a game
# - Check playtime displays correctly
# - Verify tray menu works
# - Verify auto-update notification (if testable)
# Run this checklist twice: once mid-phase, once after completion
```

---

### Phase 7: Cleanup Phase

**Goal:** Remove all migration shims, legacy directories, and re-export wrappers. Finalize architecture enforcement. The system after this phase must contain no references to old file paths.

**Duration:** 1 week  
**Risk:** Low — all logic is already in new locations

---

#### Step 7.1 — Audit All Shims

Find every migration shim in the codebase:
```
grep -r "MIGRATION SHIM\|MIGRATION PLACEHOLDER" . --include="*.js" --exclude-dir=node_modules -l
```

For each file found, verify:
1. The shim points to a file that exists at the new path
2. There are no callers that still import from the old (shim) path

To find callers of a shim:
```
grep -r "require.*{old-file-name}" . --include="*.js" --exclude-dir=node_modules
```

---

#### Step 7.2 — Update Remaining Old Imports

For any caller still using an old import path, update it to the new `@features` or `@shared` path. One PR per module.

---

#### Step 7.3 — Delete All Shims and Empty Old Files

Delete in this order:
1. Shims in `services/` → delete `services/` directory
2. Shims at root level (`platformSync.js`, `gameScanner.js`, `accountsHandler.js`, `analytics.js`, `steamBridge.js`, `collectionsHandler.js`, `playtimeOsHelper.js`, `platformSyncShared.js`)
3. Shims in `src/js/` for moved renderer files

Verify after each deletion: `npm test` and `npm run smoke` pass.

---

#### Step 7.4 — Final Lint Pass

```bash
npm run lint
```

Zero errors required. Every import in the codebase now uses `@features`, `@shared`, `@main`, or relative paths within a single feature.

---

#### Step 7.5 — Remove Shim Infrastructure

Remove the `module-alias` package if it was used only for the migration. Update the esbuild config to use native alias support going forward.

Remove the `MIGRATION PLACEHOLDER` stubs from `package.json` scripts if any were added.

---

#### Step 7.6 — Final Verification

Run the full verification described in [Section 5](#5-verification-strategy) Phase 7 gate.

After this phase, the `handlers/`, `services/`, and root-level god files no longer exist. The project structure matches Section 2.1 exactly.

---

## 5. Verification Strategy

### How to Run Tests

```bash
npm test              # Full test suite (node --test tests/*.test.js)
npm run smoke         # Smoke tests for IPC critical paths
npm run lint          # ESLint boundary rule enforcement
npm start             # Manual verification
```

To run a single test file during development:
```bash
node --test tests/features/sync/MergeService.test.js
```

### Phase-by-Phase Verification Gates

| Phase | Automated | Manual | Failure Signal | Rollback |
|---|---|---|---|---|
| Phase 0 | `npm test` passes; `npm run smoke` passes | App starts | Any test failure | Delete added files; no code moved |
| Phase 1 | `npm test`; `npm run lint` | App renders correctly | White screen on start | Revert HTML file path changes |
| Phase 2 | `npm test`; `grep` for shim chains | Library loads | Test failure for moved module | Revert shim to full file content |
| Phase 3 | `npm test`; `npm run smoke`; grep for `handlers/` imports | Feature-by-feature spot check | Smoke test failure | Revert single handler PR |
| Phase 4 | `npm test`; `npm run smoke`; grep for `services/` imports | Quick-switcher, metadata, accounts | Service returns undefined | Revert single service PR |
| Phase 5 | `npm test`; `npm run smoke` | Deep 30-min manual test | Sync fails; achievements missing | Revert single extraction PR |
| Phase 6 | `npm test`; `npm run smoke` | 60-min comprehensive manual test | UI section missing or blank | Revert single section extraction PR |
| Phase 7 | `npm test`; `npm run smoke`; `npm run lint`; grep for old paths | Full app walkthrough | Any old import remains | Re-add deleted file as shim |

### Failure Signals to Watch For

**IPC regression:** Renderer calls `window.electronAPI.someMethod()` and receives `undefined` or a rejected promise. Symptom: feature silently stops working, no error shown. Detection: browser console in DevTools shows IPC error. Fix: check that the handler is still registered in `main.js` after a move.

**Shim chain:** A shim requires another shim, creating a circular or deep chain. Symptom: `Maximum call stack size exceeded` on startup, or very slow module load. Detection: `grep -r "MIGRATION SHIM" . | head -20` and trace the chain manually.

**Singleton broken:** Steam bridge subprocess is spawned twice. Symptom: Two `baddel_bridge.py` processes visible in Task Manager. Achievements return duplicate data. Fix: ensure `SteamBridgeService.js` uses module-level singleton (Node require cache enforces this if the module is required from a single canonical path).

**Boundary violation:** Domain file imports from infrastructure. Symptom: `npm run lint` fails with a boundaries error. Fix: move the logic to the correct layer; never suppress the lint rule.

**Electron Store key mismatch:** A setting stops persisting across app restarts. Symptom: user preference resets on every launch. Detection: compare `electron-store` key names against `docs/ipc-contracts.md` persisted key list. Fix: correct the key name; never change a key name during migration.

### Rollback Strategy

Every step in this migration is a separate git commit (or PR). Rollback is always `git revert {commit-hash}`. Because each step is atomic and old code is kept as shims, reverting one step does not require reverting subsequent steps. The shim at the old path means callers continue to work even if the new file is temporarily removed.

---

## 6. Risk Register

### R1 — IPC Channel Name Typo

**Severity:** High  
**Probability:** Medium (50+ channels, multiple moves)  
**Symptom:** A feature stops working silently in production. No error — the IPC call returns undefined.  
**Mitigation:** `docs/ipc-contracts.md` as ground truth. ESLint rule that enforces channel name strings come from a constants file (add `src/shared/ipc/channels.js` with all channel names as exported constants). Smoke tests catch the most critical channels.  
**Detection time:** Immediate — smoke tests run on every PR.

---

### R2 — Steam Bridge Singleton Broken

**Severity:** Critical  
**Probability:** Low (if Phase 5.3 instructions are followed precisely)  
**Symptom:** Two `baddel_bridge.py` processes in Task Manager. Achievement calls fail or return wrong data. Steam credentials get corrupted.  
**Mitigation:** `SteamBridgeService.js` must be required from exactly one canonical path. Use `require('@features/sync/infrastructure/integrations/steam/SteamBridgeService')` everywhere — never use a relative path that could resolve differently from different directories. The Node module cache ensures singleton behavior only when the resolved path is identical.  
**Detection:** Task Manager during Phase 5.3 verification. Add a `getSteamBridgeInstanceCount()` debug IPC channel during migration that returns `1` always.

---

### R3 — PlatformSync Mutable State Lost

**Severity:** Critical  
**Probability:** Medium (if Phase 5.6 is not done step-by-step)  
**Symptom:** Library sync appears to succeed (no errors) but library-updated events stop firing to the renderer. Game library freezes at last sync state.  
**Mitigation:** Phase 5.6.1 (class encapsulation) must be a separate PR with zero logic changes. Run the sync debounce test specifically: trigger sync, immediately trigger it again, verify only one sync runs (debounce working). Do not proceed to Step 5.6.2 until 5.6.1 is verified.  
**Detection:** `_libraryUpdateDebounceTimer` should fire exactly once when sync is triggered rapidly. Add a debug log temporarily.

---

### R4 — Credential Encryption Key Change

**Severity:** Critical  
**Probability:** Low (if the rule is followed)  
**Symptom:** Users cannot decrypt their saved passwords after update. Accounts appear unlinked.  
**Rule:** Never change the AES key name in Windows Credential Manager, the salt, the IV size, or the scrypt parameters in the same PR as any structural change to `credentialEncryption.js`.  
**Mitigation:** `credentialEncryption.js` has its own test. Any PR that touches it must run `node --test tests/credentialEncryption.test.js` and demonstrate round-trip encryption succeeds.  
**Detection:** Accounts smoke test — if `get-linked-accounts` returns empty after a credential change, the key derivation changed.

---

### R5 — Circular Dependency Between Features

**Severity:** High  
**Probability:** Medium (natural tendency when features share concepts)  
**Example:** `games/` imports `metadata/` which imports `games/` for game entity types.  
**Symptom:** `Error: Cannot find module` at startup, or `require()` returns `{}` (empty object) due to circular resolution.  
**Mitigation:** ESLint boundaries rule prevents feature-to-feature imports entirely. If two features genuinely share a type (e.g., a `GameId` type), it goes in `src/shared/` not in either feature. If two features must communicate at runtime, they do so through IPC (even on the main process side) not through direct import.  
**Detection:** `npm run lint` catches this before runtime. Also: `node -e "require('./src/features/games')"` should never hang.

---

### R6 — `electron-store` Key Collision or Rename

**Severity:** Medium  
**Probability:** Low (if `docs/ipc-contracts.md` persisted key list is maintained)  
**Symptom:** A user setting (e.g., analytics consent, quick-switcher bindings) resets to default after update.  
**Mitigation:** All `electron-store` key names are documented in `docs/ipc-contracts.md` before Phase 1. No key name changes during migration. If a key must be renamed for clarity, it requires a migration script in the app's `app-lifecycle.js` that reads the old key and writes the new key on first launch.  
**Detection:** After any Phase 5 PR, launch the app, set a preference, restart the app, verify the preference persisted.

---

### R7 — Renderer Event Listener Leak

**Severity:** Medium  
**Probability:** Medium (common during renderer refactor)  
**Symptom:** Memory usage climbs over time; duplicate event handler calls; UI actions trigger twice.  
**Cause:** When a renderer file is split, if the old file and new file both `addEventListener` to the same DOM event or `window.electronAPI.onLibraryUpdated`, events fire twice.  
**Mitigation:** When extracting a section from a large renderer file, verify the old file removes its listener before the new file adds its own. Use AbortController or explicit `removeEventListener` in the extraction.  
**Detection:** Open browser DevTools during Phase 6; check the Event Listeners panel on critical elements. Monitor memory usage over 5 minutes of use.

---

### R8 — Main Process Startup Order Broken

**Severity:** High  
**Probability:** Low  
**Context:** `main.js` registers some handlers before `app.whenReady()` (early handlers: `imageHandlers`, `autoUpdateHandlers`, `windowHandlers`, `systemHandlers`, `externalLinkHandlers`, `updateNotesHandlers`, `launchHandlers`, `analyticsHandlers`) and others inside `app.whenReady()`. This two-phase registration is intentional — handlers registered before `whenReady` can respond to renderer events that fire during app initialization.  
**Risk:** If a handler that must be registered early is accidentally moved to the late registration block, it will miss IPC calls that fire before `whenReady`.  
**Mitigation:** When migrating handlers in Phase 3, copy the registration timing from `main.js` into the new `src/main/index.js`. Explicitly document which adapters are early vs. late in a comment in `src/main/index.js`.  
**Detection:** App fails to load game library on first launch (before `whenReady` completes).

---

## 7. Team Execution Rules

These rules are permanent. They apply during the migration and after it is complete. Any PR that violates a rule must be rejected at code review.

### R1 — One Responsibility Per PR

A PR may contain: one file moved to a new location, OR one function extracted from a god file, OR one handler migrated to a new path. A PR that does two of these things at once is too large. Exception: trivially related moves (e.g., merging two handlers that cover the same feature) may be combined if the total line count is under 200.

### R2 — No Logic Changes During Moves

A PR that moves a file must not change any logic in that file. A PR that changes logic must not move the file. These are separate commits. This rule makes code review tractable: reviewers of a move PR only need to verify the import paths are correct, not re-read the logic.

### R3 — No Feature Crosses Boundaries

`src/features/accounts/` may not directly import from `src/features/games/`. If accounts needs a game's ID, it receives it as a parameter (not by importing `GameIdService`). If two features genuinely need to share a type, that type goes in `src/shared/`. If two features need to coordinate at runtime, they do so through events or IPC — not through a shared mutable object.

### R4 — No Direct Infrastructure Access From Presentation

UI controllers (files in `presentation/`) call only `window.electronAPI.*`. They never import from `infrastructure/` directly. They never read files, never call APIs. The only way a UI controller gets data is through the IPC bridge.

### R5 — No Global Shared Services

There is no `AppServices` singleton that every feature imports. Dependencies are passed explicitly through constructor injection into use cases and repositories. If a service is needed in multiple features (e.g., `BaddelApiService`), each feature that needs it receives it as a dependency — it does not import a global instance.

Exceptions: `src/shared/analytics/analytics.js` and `src/shared/crypto/credentialEncryption.js` are deliberately cross-cutting and may be imported directly. These are the only explicitly allowed shared globals.

### R6 — Every Change Is Incremental and Reversible

Every commit must leave the application in a working state. "I'm halfway through extracting this module" is not a valid commit message for a PR to main. If a multi-step extraction is in progress, the work-in-progress stays on a feature branch until the extraction is complete and the app starts.

### R7 — Tests Move With Their Modules

When a module moves to a new location, its test file moves with it (into `tests/features/{feature}/` or `tests/shared/`). The test file is updated in the same PR as the module move. Tests are never left behind in `tests/` pointing to the old path.

### R8 — Verify the Gate Before Marking Done

No phase is complete until its verification gate (Section 5) passes in full, including the manual checks. A phase is not complete because the code compiles — it is complete because the app behaves correctly.

### R9 — Document Surprises in This Roadmap

If any step in this roadmap turns out to be wrong, more complex, or requires a different order than specified, update this document before proceeding. The roadmap is a living document. Diverging from it silently creates confusion for the rest of the team.

---

## 8. Final Outcome Definition

The migration is complete when all of the following are true.

### 8.1 Structural Completeness

- [ ] `handlers/` directory does not exist
- [ ] `services/` directory does not exist
- [ ] No JavaScript file at the project root except `main.js` redirector (if kept for electron-builder compatibility) and config files (`package.json`, etc.)
- [ ] All feature logic lives in `src/features/`
- [ ] All shared utilities live in `src/shared/`
- [ ] `src/main/index.js` is under 200 lines
- [ ] No file in the project exceeds 600 lines

### 8.2 Boundary Enforcement

- [ ] `npm run lint` passes with zero errors
- [ ] No file in `domain/` imports from `infrastructure/`, `application/`, or any feature directory
- [ ] No file in `presentation/` imports from `infrastructure/` or `application/`
- [ ] No feature imports directly from another feature
- [ ] No module-level mutable state exists outside of explicitly designed singleton services

### 8.3 Test Coverage

- [ ] All 60+ existing tests pass
- [ ] All 4 smoke tests pass
- [ ] Every use case in `application/useCases/` has at least one unit test
- [ ] Every domain service in `domain/services/` has at least one unit test
- [ ] Tests import from `@features` and `@shared` paths (no old paths remain in test files)

### 8.4 Functionality Preservation

- [ ] Game library loads and displays correctly
- [ ] All 8 platform accounts can be linked and unlinked
- [ ] Platform sync completes without error for Steam and Epic
- [ ] Games can be launched and playtime is tracked
- [ ] Collections can be created, modified, and deleted
- [ ] Quick-switcher returns correct results and launches games
- [ ] Metadata and artwork load for all games
- [ ] Achievements display for linked Steam accounts
- [ ] Auto-update flow works end-to-end
- [ ] Analytics consent gate works
- [ ] App starts in under the same time as before migration (no startup regression)

### 8.5 Developer Experience

A new developer joining the project should be able to:
- Understand what the `accounts` feature does by reading only `src/features/accounts/` — nothing else
- Add a new IPC channel for an existing feature by touching only that feature's `infrastructure/ipc/` and `application/useCases/` files
- Write a unit test for a use case without needing Electron or a running app
- Add a new platform integration by creating one new file in the relevant `infrastructure/integrations/` directory
- Find any bug by layer: "if it's a UI bug, check presentation/; if it's a wrong calculation, check domain/; if it's a persistence bug, check repositories/"

When a new developer can do all five of these without reading this document, the architecture is self-evident. That is the final goal.

---

*End of Architecture Execution Roadmap v1.0*  
*Next review: after Phase 3 completion*  
*Owner: Technical Lead*
