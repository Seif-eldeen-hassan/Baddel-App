# Baddel Launcher — Production Smoke Test

Manual test script to run before every public release.
Each step must pass before shipping.

---

## Setup

1. Install the built `.exe` from `dist/` on a clean machine (or a Windows VM).
2. Open the app.
3. Open DevTools (`Ctrl+Shift+I`) — keep it open throughout.

---

## A. Startup

| # | Action | Expected |
|---|---|---|
| A1 | App launches | No crash; library loads within 10 s |
| A2 | DevTools Console | No `ERROR` or uncaught exception at startup |
| A3 | Analytics consent overlay | Appears on first launch; does NOT appear on second launch |

---

## B. Security config

| # | Check | Expected |
|---|---|---|
| B1 | DevTools → Application → Security | Origin is `file://`; no mixed-content warnings |
| B2 | Paste `javascript:alert(1)` in any input, submit | Alert does NOT fire |
| B3 | DevTools Network tab | No requests to `fonts.googleapis.com`, `cdn.jsdelivr.net`, or `cdnjs.cloudflare.com` |
| B4 | DevTools Console — CSP violations | None logged |

---

## C. Game library

| # | Action | Expected |
|---|---|---|
| C1 | Click "Scan" | At least one game appears (if installed) |
| C2 | Add manual game — pick any `.exe` | Game appears in library |
| C3 | Add manual game — pick a `.bat` file (if available) | Should NOT work (extension filtered) |
| C4 | Rename a game | Name updates immediately |
| C5 | Reorder library via drag-and-drop | Order persists after app restart |
| C6 | Hide a game → Settings → Restore | Game re-appears |

---

## D. Game Details

| # | Action | Expected |
|---|---|---|
| D1 | Open any game | Metadata loads; cover/hero/logo displayed |
| D2 | Open 5+ different games in a row | Each loads cleanly; no "Could not load metadata" error stuck |
| D3 | Open a Steam game with achievements | Achievements load |
| D4 | Open a game trailer (if available) | Video plays; no CDN script load errors in console |

---

## E. Account management

| # | Action | Expected |
|---|---|---|
| E1 | Steam — switch account | Steam relaunches logged in as selected account |
| E2 | Riot — Add Account (client installed) | Dialog opens; account saved |
| E3 | Riot — Add Account (client NOT found) | "Riot Client not found" dialog appears with "Locate" button |
| E4 | Epic — Add Account | Epic launcher opens |

---

## F. External URL safety

| # | Action | Expected |
|---|---|---|
| F1 | Click any "View on Steam" / store link | Opens in system browser (https://) |
| F2 | DevTools → Console: `electronAPI.openExternal('file:///C:/Windows/System32')` | Error logged; nothing opens |
| F3 | DevTools → Console: `electronAPI.openExternal('javascript:alert(1)')` | Error logged; alert does NOT fire |

---

## G. Auto-update

| # | Action | Expected |
|---|---|---|
| G1 | Settings → Check for updates | Either "Up to date" or update download begins |
| G2 | If update available: Download → "Restart & Install" | App restarts to new version |

---

## Pass criteria

All steps marked "Expected" must be observed. Any deviation blocks the release.
Log failures as GitHub issues tagged `release-blocker`.
