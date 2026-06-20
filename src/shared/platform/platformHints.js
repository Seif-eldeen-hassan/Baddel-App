'use strict';

/**
 * Map raw platform labels to metadata resolver platform hints.
 *
 * Returns the canonical server-accepted platformHint string, or null if the
 * platform takes another resolution path (steam, epic) or is unrecognised.
 *
 * Shared by: GameScannerCore, backgroundMetadataPipeline, gameMetadataHandlers.
 */
function mapPlatformHint(raw) {
    if (!raw) return null;
    const p = raw.toLowerCase().trim();
    if (p === 'xbox' || p === 'xbox game pass' || p === 'microsoft store' || p === 'store') return 'xbox';
    if (p === 'ea app' || p === 'ea' || p === 'origin')                                     return 'ea';
    if (p === 'ubisoft connect' || p === 'ubisoft')                                          return 'ubisoft';
    if (p === 'riot games' || p === 'riot')                                                  return 'riot';
    if (p === 'rockstar' || p === 'rockstar games')                                          return 'rockstar';
    if (p === 'gog')                                                                         return 'gog';
    if (p === 'battlenet' || p === 'battle.net')                                             return 'battlenet';
    return null;
}

module.exports = { mapPlatformHint };
