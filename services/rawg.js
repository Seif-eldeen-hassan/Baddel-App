// services/rawg.js
'use strict';

// حط الـ API Key بتاعك هنا مكان الكلمة دي
const RAWG_API_KEY = '42dfbdda2d434c95a6070adb4efb389d'; 

async function fetchGameInfo(gameName) {
    if (!gameName) return null;

    try {
        // 1. نعمل بحث باسم اللعبة
        const searchRes = await fetch(`https://api.rawg.io/api/games?search=${encodeURIComponent(gameName)}&key=${RAWG_API_KEY}&page_size=1`);
        const searchData = await searchRes.json();
        
        if (!searchData.results || searchData.results.length === 0) return null;
        
        const gameId = searchData.results[0].id;
        
        // 2. نجيب التفاصيل الكاملة (القصة، المطورين، التقييم)
        const detailsRes = await fetch(`https://api.rawg.io/api/games/${gameId}?key=${RAWG_API_KEY}`);
        const details = await detailsRes.json();

        // 3. نجيب سكرين شوتس للعبة
        const screensRes = await fetch(`https://api.rawg.io/api/games/${gameId}/screenshots?key=${RAWG_API_KEY}`);
        const screens = await screensRes.json();

        // 4. استخراج مواصفات التشغيل للـ PC
        // 4. استخراج مواصفات التشغيل للـ PC
        let pcReqs = null;
        const pcPlatform = details.platforms?.find(p => p.platform.id === 4 || p.platform.name.toLowerCase() === 'pc');
        if (pcPlatform) {
            // هنا بنقوله لو ملقيتش requirements العادية، دور في requirements_en 
            pcReqs = pcPlatform.requirements_en || pcPlatform.requirements || pcPlatform.requirements_ru;
        }

        // 5. نجيب التريلر لو متاح
        const moviesRes = await fetch(`https://api.rawg.io/api/games/${gameId}/movies?key=${RAWG_API_KEY}`);
        const movies = await moviesRes.json();
        const trailerUrl = movies.results?.length > 0 ? movies.results[0].data.max : null;

        // تجميع الداتا بشكل نظيف نبعته للـ Frontend
        return {
            description: details.description_raw || details.description,
            genres: details.genres?.map(g => g.name) || [],
            developers: details.developers?.map(d => d.name).join(', ') || 'Unknown',
            publishers: details.publishers?.map(p => p.name).join(', ') || 'Unknown',
            releaseDate: details.released,
            metacritic: details.metacritic,
            screenshots: screens.results?.map(s => s.image) || [],
            trailer: trailerUrl,
            requirements: pcReqs
        };
    } catch (error) {
        console.error("[RAWG API] Error fetching game info:", error);
        return null;
    }
}

module.exports = { fetchGameInfo };