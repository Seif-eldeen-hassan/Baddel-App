# Baddel API Image Fetching Diagnostics

## Issues Found & Fixed

### 1. ✅ Module Resolution Error
**Problem**: `services/gameMetadataResolver.js` was in a subfolder (`services/New folder/`) but being referenced with wrong path
**Fix**: Updated `main.js` line 13 to: `const resolver = require('./services/New folder/gameMetadataResolver');`

### 2. ✅ Broken Imports in gameMetadataResolver
**Problem**: Relative paths from nested folder were incorrect (e.g., `require('./igdb')` instead of `require('../igdb')`)
**Fix**: Updated all require paths in `services/New folder/gameMetadataResolver.js` to use `../` prefix

### 3. ✅ Added Comprehensive Logging
Added detailed logging to track image fetching flow:

**In `main.js` (IPC handler)**:
- Logs the exact query being sent
- Logs server game lookup results
- Logs normalized image count (cover/hero/logo)

**In `baddelApi.js`**:
- `lookupGame()`: Logs full URL, input query, response status, game found status, image count
- `normalizeServerData()`: Logs server response structure, image array details, per-image-type extraction

## Diagnosis Flow to Debug Images Not Loading

When you run the app and open a game's details page, check the console for:

1. **`[BaddelAPI IPC] Lookup query:`** - Should show `{ platform: 'steam'/'epic', id: '...' }`
2. **`[BaddelAPI] lookupGame - Full URL:`** - Verify the server URL is correct
3. **`[BaddelAPI ] lookupGame - Response status:`** - Should be `'success'`
4. **`[BaddelAPI] lookupGame - Game found:`** - Should show:
   - `imageCount: number` (not 0)
   - `hasImages: true`
5. **`[BaddelAPI] normalizeServerData - full server response:`** - Shows:
   - `imageCount: number` 
   - `imageSample: [...]` (first 2 images)
6. **`[BaddelAPI] pick('cover|hero|logo'): found=true, url=...`** - Should find each image type

## Possible Root Causes

If images aren't loading, the logs will reveal one of these issues:

### Issue: Game Not Found in Database (404)
- **Indicator**: `lookupGame 404 - game not found for query`
- **Cause**: Game either never imported or import failed
- **Solution**: Check if games were successfully imported via `baddelApi.importGames()` in platformSync.js

### Issue: Images Array Empty
- **Indicator**: `imageCount: 0` or `imageSample: []`
- **Cause**: Game exists but hasn't been enriched (images not fetched from IGDB/etc)
- **Solution**: Check if `baddelApi.enrichGame()` was called and completed

### Issue: Query Parameters Wrong
- **Indicator**: `lookupGame - Full URL` shows malformed query string
- **Cause**: Platform or ID not being extracted correctly from game object
- **Solution**: Check game object structure in game-details.js (lines 207-211)

### Issue: Mismatch in Image Response Structure
- **Indicator**: `imageSample: [...]` shows unexpected fields
- **Cause**: Server API changed format
- **Solution**: Check server API documentation and update `image_type`, `cdn_url` field mappings in normalizeServerData()

##Next Steps

1. **Run the app**: `npm start`
2. **Open a game's details** page
3. **Check browser console** for the logs listed above
4. **Share the logs** with the diagnostic info

The logs will pinpoint exactly where the image fetching breaks.

## Related Files
- `services/baddelApi.js` - Main API client
- `main.js` - IPC handler that receives game lookup requests
- `src/js/game-details.js` - Frontend that requests metadata
- `platformSync.js` - Imports games and triggers enrichment
