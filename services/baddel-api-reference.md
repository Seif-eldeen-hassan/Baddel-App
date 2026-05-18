# Baddel Metadata Server — API Reference

## Overview

A Node.js/Express REST server that manages game metadata for the Baddel launcher.  
All requests and responses use JSON. All responses include a top-level `"status"` field.

**Base URL:** `https://your-server.railway.app`

---

## Endpoints

### 1. Health Check

```
GET /health
```

Returns server and database status.

**Response 200:**
```json
{
  "status": "success",
  "message": "Baddel Metadata Server is running smoothly!",
  "database_time": "2025-01-15T12:00:00.000Z"
}
```

**Response 500:** Server running but DB connection failed.

---

### 2. Game Lookup

```
GET /games/lookup
```

Fetches a full game record with all related data. Provide **one** of the following query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `uuid` | string | Internal game UUID (`games.id`) |
| `platform` + `namespace` + `id` | string | Platform triple — see examples below |
| `slug` | string | URL-safe slug, e.g. `the-witcher-3` |
| `title` | string | Game title — case-insensitive exact match |

**Platform triple examples:**
- Steam: `?platform=steam&namespace=app_id&id=292030`
- Epic: `?platform=epic&namespace=catalog_namespace&id=<namespace_uuid>`

**Response 200:**
```json
{
  "status": "success",
  "data": {
    "id": "<uuid>",
    "title": "The Witcher 3",
    "slug": "the-witcher-3",
    "entry_type": "game",
    "release_year": 2015,
    "platform_ids": [ ... ],
    "images": [ ... ],
    "media": [ ... ],
    "ratings": [ ... ],
    "metadata": [ ... ],
    "system_requirements": [ ... ]
  }
}
```

**Response 400:** No valid identifier provided.  
**Response 404:** Game not found.

---

### 3. Import Games

```
POST /games/import
```

Batch-import games from Steam or Epic. Already-known games are returned immediately; new games are processed in the background (cover fetch + R2 upload).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `"steam"` \| `"epic"` | ✅ | Source platform |
| `games` | array | ✅ | Non-empty array of game objects (see below) |

**Steam game object:**
```json
{
  "id": "292030",           // Steam App ID — required
  "title": "The Witcher 3", // optional — auto-fetched from Steam API if omitted
  "slug": "the-witcher-3"   // optional — auto-generated from title if omitted
}
```

**Epic game object:**
```json
{
  "id": "27834480410d4000a987b32801e9abba",   // catalog namespace — required
  "title": "First Class Trouble",
  "slug": "first-class-trouble",
  "cover_url": "https://cdn1.epicgames.com/...", // DieselGameBoxTall (1200x1600)
  "hero_url":  "https://cdn1.epicgames.com/...", // DieselGameBox (2560x1440)
  "entry_type": "game"
}
```

**Full request example:**
```json
{
  "platform": "steam",
  "games": [
    { "id": "292030", "title": "The Witcher 3" },
    { "id": "570" }
  ]
}
```

**Response 200** (immediate — new games are still processing in background):
```json
{
  "status": "success",
  "found": [ ... ],
  "pending": [ ... ],
  "summary": { "total": 2, "found": 1, "pending": 1 }
}
```

**Response 400:** Missing `platform` or empty `games` array.

> **Note:** `found` = games already in the DB, returned with full data. `pending` = new games being saved in the background; they will appear in the DB once the background job finishes.

---

### 4. Enrich Single Game

```
POST /games/enrich/:gameId
```

Enriches one existing game with images, metadata, ratings, and videos from IGDB and SteamGridDB. The server looks up the game's `platform_ids` automatically.

**Path parameter:** `gameId` — internal UUID of a game already in the DB.

**Request Body (all optional):**

| Field | Type | Description |
|-------|------|-------------|
| `background` | boolean | If `true`, responds immediately with 202 and runs async |
| `steamRating` | object | Steam review data from client: `{ score, positive, negative, total }` |
| `sysreq` | array | System requirements from client: `[{ platform, tier, os_versions, cpu, gpu, ram, storage, directx }]` |

> **Why client-provided data?** Steam's store API is blocked on Railway. The Baddel desktop client fetches sysreq and review data directly and forwards it here.

**Enrichment pipeline (runs automatically):**
1. IGDB lookup — by external uid, then by title, then fuzzy search
2. SteamGridDB images — cover (600×900), hero, logo
3. R2 upload — all resolved images uploaded to Cloudflare R2
4. DB writes — metadata, IGDB rating, videos, screenshots
5. DB writes — client-provided Steam rating and system requirements

**Response 200 (sync):**
```json
{
  "status": "success",
  "data": {
    "gameId": "<uuid>",
    "igdbId": 1942,
    "cover": "https://pub-xxx.r2.dev/covers/steam_292030.jpg",
    "hero":  "https://pub-xxx.r2.dev/covers/steam_hero_292030.jpg",
    "logo":  "https://pub-xxx.r2.dev/covers/steam_logo_292030.png",
    "hasMetadata": true
  }
}
```

**Response 202:** Accepted for background processing (when `background: true`).  
**Response 404:** Game not found or has no `platform_ids`.  
**Response 500:** Enrichment failed.

---

### 5. Enrich Games (Batch)

```
POST /games/enrich
```

Enrich multiple games at once. Always runs in the background — responds immediately with 202.

**Mode A — specific games:**
```json
{
  "gameIds": ["<uuid-1>", "<uuid-2>", "<uuid-3>"]
}
```

**Mode B — enrich all unenriched games:**
```json
{
  "enrichAll": true,
  "limit": 50
}
```

> `enrichAll` targets games that have a Steam or Epic `platform_id` but no IGDB metadata row yet, ordered by newest first. Default `limit` is 100.

**Response 202:**
```json
{
  "status": "accepted",
  "message": "Enriching 12 games in background",
  "count": 12
}
```

**Response 400:** Neither `gameIds` nor `enrichAll: true` provided.  
**Response 500:** DB query failed before job could start.

---

## Data Structures

### `game_images` row
| Field | Description |
|-------|-------------|
| `source` | `"steam"`, `"epic"`, `"igdb"`, `"steamgriddb"` |
| `image_type` | `"cover"`, `"hero"`, `"logo"`, `"screenshot"` |
| `url` | Original source URL |
| `cdn_url` | Cloudflare R2 CDN URL (use this in the client) |
| `width`, `height` | Dimensions in px (may be null) |
| `sort_order` | Lower = higher priority; always pick `sort_order ASC LIMIT 1` |

### `entry_type` values
`"game"` | `"demo"` | `"dlc"` | `"mod"` | `"tool"` | `"other"`

### `platform_ids` namespaces
| Platform | Namespace |
|----------|-----------|
| Steam | `app_id` |
| Epic | `catalog_namespace` |

---

## Error Response Shape

All errors follow this structure:
```json
{
  "status": "error",
  "message": "Human-readable description",
  "error": "Raw error message (only on 500s)"
}
```

---

## Background Job Behavior

| Endpoint | Sync / Async |
|----------|-------------|
| `POST /games/import` | Returns immediately; cover fetch runs async |
| `POST /games/enrich/:gameId` | Sync by default; async if `background: true` |
| `POST /games/enrich` (batch) | Always async |

Games being processed in the background will appear in the DB within seconds to a few minutes depending on image availability and IGDB lookup time.
