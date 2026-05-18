# Baddel Launcher — Release Checklist

Run through this list before creating a GitHub release tag.

## 1. Pre-build verification

- [ ] `npm run release:verify` — runs `npm run check` + `npm test`; both must exit 0
  - `npm run check` covers: main.js, preload.js, accountsHandler.js, analytics.js, gameScanner.js, platformSync.js, steamBridge.js, all services, and all renderer files under src/js/
  - `npm test` runs 812 tests across all `tests/*.test.js` files
- [ ] `git status` is clean; no uncommitted changes

## 2. Code signing (Windows)

Set these environment variables before running `npm run dist`:

| Variable | Description |
|---|---|
| `WIN_CSC_FILE` | Path to the `.pfx` code-signing certificate |
| `WIN_CSC_KEY_PASSWORD` | Password for the `.pfx` file |
| `WIN_CSC_SUBJECT` | Certificate subject name (used by electron-builder) |

DigiCert or Sectigo EV certificates produce the best SmartScreen reputation.
Without a valid certificate the installer will show "Unknown Publisher" and may
be blocked by SmartScreen on first run.

## 3. Build

```powershell
$env:WIN_CSC_FILE     = "path\to\cert.pfx"
$env:WIN_CSC_KEY_PASSWORD = "your-password"
npm run dist
```

Output: `dist/baddel-launcher-beta-Setup-<version>.exe`

## 4. Installer smoke test

See `docs/PRODUCTION_SMOKE_TEST.md` for the full test script.

Quick checklist:
- [ ] Installer runs without SmartScreen warning (or shows publisher name, not Unknown)
- [ ] App launches and shows library within 10 s
- [ ] Steam account switch works
- [ ] Riot "Add Account" flow shows correct dialog when client not found
- [ ] No DevTools / console errors on startup

## 5. GitHub release

- [ ] Tag is `v<version>` (matches `package.json` version)
- [ ] Release notes describe what changed since last release
- [ ] Attach installer `.exe` to the release assets
- [ ] `electron-updater` auto-update tested: existing install → detects new release → downloads → installs

## 6. Post-release monitoring

- Check PostHog dashboard for `launcher_ping` events after release goes public
- Watch GitHub issues for crash reports in the first 48 hours
