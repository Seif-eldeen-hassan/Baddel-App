(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async (predicate, timeout = 30000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            const value = predicate();
            if (value) return value;
            await wait(200);
        }
        return null;
    };
    const hash = value => window.BaddelArtworkDiagnostics?.shortHash?.(value) || null;
    const decode = value => new Promise(resolve => {
        if (!value) return resolve(null);
        const image = new Image();
        const timer = setTimeout(() => resolve(false), 5000);
        image.onload = () => { clearTimeout(timer); resolve(image.naturalWidth > 0 && image.naturalHeight > 0); };
        image.onerror = () => { clearTimeout(timer); resolve(false); };
        image.src = value;
    });

    window.__BADDEL_ARTWORK_DIAGNOSTICS__ = true;
    await until(() => Array.isArray(window.allGamesData) && window.allGamesData.length > 0, 45000);
    const wanted = new Map([
        ['sanitarium', 'Sanitarium'],
        ['valorant', 'VALORANT'],
        ['detroit become human', 'Detroit: Become Human'],
        ['detroit: become human', 'Detroit: Become Human'],
    ]);
    const games = window.allGamesData.filter(game => wanted.has(String(game.name || game.title || '').toLowerCase()));
    await window.__baddelResolveArtworkCacheBulk?.(games, { types: ['cover', 'hero', 'logo'], surface: 'acceptance-restart' });
    const results = [];
    for (const game of games) {
        const model = window.BaddelGameArtworkReadModel.buildGameArtworkReadModel({ displayGame: game, canonicalGame: game });
        const cardDecision = window.BaddelHomeArtworkPresentation.selectCardArtwork(model);
        const homeDecision = window.BaddelHomeArtworkPresentation.selectHomeHeroArtwork(model);
        const detailsDecision = window.BaddelGameDetailsArtworkAdapter.resolveGameDetailsArtwork({ game });
        // Exercise the real Game Settings preview helpers without triggering a
        // second live metadata request for a confirmed no-Logo record.
        window._gsSetArtworkPreview?.(document.getElementById('previewCover'), [model.cover.effectiveValue], 'assets/No_Image_Available.jpg');
        window._gsSetArtworkPreview?.(document.getElementById('previewHero'), [model.hero.effectiveValue], 'assets/No_Image_Available.jpg');
        window._gsUpdateLogoPreview?.([model.logo.effectiveValue]);
        await wait(100);
        const settings = {
            cover: document.getElementById('previewCover')?.getAttribute('src') || null,
            hero: document.getElementById('previewHero')?.getAttribute('src') || null,
            logo: document.getElementById('previewLogo')?.getAttribute('src') || null,
        };
        results.push({
            game: wanted.get(String(game.name || game.title || '').toLowerCase()),
            identityHash: hash(model.cover.identity?.canonicalGameId),
            provider: model.cover.identity?.platform,
            values: {
                card: hash(cardDecision.value), homeHero: hash(homeDecision.background), homeLogo: hash(homeDecision.logo),
                detailsCover: hash(detailsDecision.cover.value), detailsHero: hash(detailsDecision.hero.value), detailsLogo: hash(detailsDecision.logo.value),
                settingsCover: hash(settings.cover), settingsHero: hash(settings.hero), settingsLogo: hash(settings.logo),
            },
            availability: { cover: model.cover.availability, hero: model.hero.availability, logo: model.logo.availability },
            source: { cover: model.cover.source, hero: model.hero.source, logo: model.logo.source },
            cacheStatus: { cover: Boolean(model.cover.cacheRepresentation), hero: Boolean(model.hero.cacheRepresentation), logo: Boolean(model.logo.cacheRepresentation) },
            typedAgreement: cardDecision.value === detailsDecision.cover.value && homeDecision.background === detailsDecision.hero.value && homeDecision.logo === detailsDecision.logo.value,
            distinctCoverHero: Boolean(cardDecision.value && homeDecision.background && cardDecision.value !== homeDecision.background),
            decoded: { cover: await decode(cardDecision.value), hero: await decode(homeDecision.background), logo: await decode(homeDecision.logo) },
        });
    }
    return { games: results, diagnostics: (window.__baddelArtworkDiagnosticsEvents || []).length };
})()
