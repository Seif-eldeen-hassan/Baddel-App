# Baddel Launcher

One library for your PC games. Baddel brings installed and owned titles from
Steam, Epic Games, EA, Ubisoft, Xbox, Riot, Discord, Rockstar, and GOG into a
single Windows desktop experience.

## Highlights

- Unified game library with search, collections, sorting, and custom metadata
- Account linking and library synchronization across supported launchers
- Native launching, playtime tracking, achievements, and update handling
- Artwork caching and background metadata enrichment
- Managed downloads for supported stores
- Local credential protection through Windows Credential Manager

## Requirements

- Windows 10 or newer
- Node.js 20 or newer
- npm
- Python 3.11 only when rebuilding the Steam integration bridge

## Development

```powershell
npm install
npm start
```

Run the validation suite before submitting changes:

```powershell
npm run check
npm test
```

Create the Windows installer with:

```powershell
npm run dist
```

## Project structure

| Path | Purpose |
| --- | --- |
| `main.js` | Electron main process and application lifecycle |
| `preload.js` | Context bridge exposed to renderer windows |
| `src/` | Renderer UI and feature modules |
| `handlers/` | Main-process IPC handlers |
| `services/` | Shared platform and infrastructure services |
| `tests/` | Node test suite and Electron fixtures |
| `baddel-steam-integration/` | Steam integration bridge source |

## Security and privacy

The renderer does not access the operating system directly; privileged work is
performed in the Electron main process through a restricted context bridge.
Credentials are encrypted at rest and backed by Windows Credential Manager.
Analytics are disabled until the user provides consent.

Do not commit local environments, generated builds, diagnostic captures,
credentials, signing material, or user library data. The repository ignore
rules cover the standard locations used by this project.

## Releases

Installable builds are distributed separately through the Baddel releases
repository. Generated installers and unpacked application bundles are not kept
in source control.

## License

Copyright (c) Baddel Team. All rights reserved.
