# Phase 25.2A Artwork Delivery Closeout

## Status

Phase 25.2A is complete through the final protected-build checkpoint.

The migration keeps Artwork State V2 and `user_artwork` as the explicit-user artwork authority, while automatic artwork delivery now routes through a content-addressed cache, a prioritized download manager, bandwidth policy, and telemetry counters.

## Checkpoint Commits

- `01064d7` Instrument artwork network usage
- `cc134de` Add content addressed artwork cache
- `00c904e` Migrate legacy artwork cache without downloads
- `813ec85` Add prioritized artwork download scheduler
- `ff47fb2` Add artwork HTTP revalidation policy
- `0a28a54` Route artwork downloads through manager
- `c055a77` Make startup artwork cache first
- `f849e1d` Separate sync completion from artwork fetching
- `28f2054` Prioritize Game Details artwork downloads
- `e0c17b4` Prewarm visible artwork efficiently
- `3a4065b` Add artwork bandwidth policy
- `e4843ca` Bound automatic artwork cache size
- `f6fe0cf` Request efficient artwork source sizes
- `da9b540` Prevent renderer artwork network bypass
- `3e81662` Add artwork delivery acceptance tests
- `c446d34` Document artwork delivery architecture

## Final Validation

- Focused artwork delivery suite: `node --test tests\artworkDeliveryAcceptance.test.js tests\artworkDownloadManager.test.js tests\artworkNetworkTelemetry.test.js tests\artworkDownloadScheduler.test.js tests\contentAddressedArtworkCache.test.js` passed, 51/51.
- Full test suite: `node --test --test-reporter=dot tests/*.test.js` passed.
- Smoke: `npm.cmd run smoke` passed, 35/35.
- Lint: `npm.cmd run lint` passed with existing boundaries deprecation/legacy selector warnings only.
- Diff check: `git diff --check` passed with line-ending warnings only.
- Protected build: `npm.cmd run build:protected` passed after rerun outside the sandbox because the first attempt hit `EPERM` on the user npm cache while rebuilding `keytar`.
- Protected audit: `npm.cmd run audit:protected` passed.

Known validation note:

- One full-suite run hit the known Epic classification-report read race once in `tests/platformSyncSyncLibrary.test.js`; the specific file passed on the allowed rerun.

## Measurement Snapshot

Measured with the production `ContentAddressedArtworkCache`, `ArtworkDownloadManager`, `ArtworkDownloadScheduler`, and `ArtworkNetworkTelemetry` against a local fake image HTTP client. No external network was used.

| Metric | Before | After |
| --- | ---: | ---: |
| Planned response-body downloads | 8 | 3 |
| Estimated response-body bytes | 560 | 210 |
| Total downloaded bytes | 560 | 210 |
| Cache hits | 0 | 4 |
| Cache misses | 8 | 4 |
| HTTP 304 count | 0 | 0 |
| In-flight deduplicated requests | 0 | 1 |
| Duplicate content files avoided | 0 | 5 |
| Avoided HTTP calls | 0 | 5 |
| Avoided response-body bytes | 0 | 350 |
| Time until first cached Installed cover | n/a | 4 ms |
| Time until first visible synced-library covers | n/a | 12 ms |
| Cached Game Details artwork latency | n/a | 4 ms |
| Interactive Game Details queue latency | n/a | 0 ms |
| Remaining renderer bypass count | not measured | 0 |

Priority order observed:

```text
active-background -> game-details -> background-0 -> background-1 -> background-2
```

## Behavior Confirmation

- Warm startup can render cached Installed covers without waiting for sync or downloading cached response bodies.
- First account sync remains metadata-first; artwork fetches are not on the sync critical path.
- Visible covers are prioritized ahead of prewarm/background work.
- Game Details artwork uses the highest priority and runs before queued background work.
- Repeat startup/sync cache hits do not redownload image bodies.
- Same URL in-flight requests join one physical download and do not double-spend bandwidth budget.
- Identical image bytes from different URLs share one physical asset.
- Renderer normal artwork setters reject direct remote URLs.
- Last Played/JBI initial, refreshed, and fallback image candidates are cache-backed before assignment.
- `user_artwork` and Artwork State V2 remain separate from automatic cache storage and eviction.
- Protected build/audit includes the bundled protected app without source, tests, docs, maps, or dev-only files.

## Rollback

Rollback the phase in reverse checkpoint order, for example:

```bash
git revert c446d34 3e81662 da9b540 f6fe0cf e4843ca 3a4065b e0c17b4 28f2054 f849e1d c055a77 0a28a54 ff47fb2 813ec85 00c904e cc134de
```

Do not include generated/protected artifacts in rollback commits.

## Recommended Next Phase

Phase 25.2B should be a field-observation phase:

- Capture real user telemetry from warm startup, first sync, repeat sync, and Game Details.
- Compare real downloaded bytes and cache hit rates against the local measurement snapshot.
- Watch for remaining renderer direct-remote counts, blank-card waves, and sync/UI refresh loops.
- Only tune budgets, queue sizes, or prewarm window sizes after real telemetry confirms the bottleneck.
