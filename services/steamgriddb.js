const axios = require('axios');
const API_KEY = "43c5350d31570ffca183a6a1d649eeab";

async function searchGame(gameName) {
    try {
        const cleanName = gameName.replace(/[^a-zA-Z0-9\s]/g, '').trim();
        
        // 1. هات الـ ID
        const searchRes = await axios.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(cleanName)}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}` }
        });

        if (searchRes.data.data && searchRes.data.data.length > 0) {
            const gameId = searchRes.data.data[0].id;

            // 2. طلب الصور بالتوازي (Cover + Hero + Logo)
            const [gridRes, heroRes, logoRes] = await Promise.all([
                // Cover (600x900)
                axios.get(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900`, {
                    headers: { 'Authorization': `Bearer ${API_KEY}` }
                }).catch(() => ({ data: { data: [] } })),

                // Hero (Background)
                axios.get(`https://www.steamgriddb.com/api/v2/heroes/game/${gameId}`, {
                    headers: { 'Authorization': `Bearer ${API_KEY}` }
                }).catch(() => ({ data: { data: [] } })),

                // 🔥 Logo (PNG Transparent) - ده الجديد
                axios.get(`https://www.steamgriddb.com/api/v2/logos/game/${gameId}`, {
                    headers: { 'Authorization': `Bearer ${API_KEY}` }
                }).catch(() => ({ data: { data: [] } }))
            ]);

            // 3. استخراج الروابط
            const cover = (gridRes.data.data && gridRes.data.data.length > 0) ? gridRes.data.data[0].url : null;
            const hero = (heroRes.data.data && heroRes.data.data.length > 0) ? heroRes.data.data[0].url : null;
            // 🔥 استخراج اللوجو
            const logo = (logoRes.data.data && logoRes.data.data.length > 0) ? logoRes.data.data[0].url : null;

            console.log(`✅ Found for ${cleanName}: Cover: ${!!cover}, Hero: ${!!hero}, Logo: ${!!logo}`);

            return { cover, hero, logo };
        }
        return null;
    } catch (e) {
        console.log("SteamGridDB Error:", e.message);
        return null;
    }
}

module.exports = { searchGame };