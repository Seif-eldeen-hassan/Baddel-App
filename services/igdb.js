// ============================================================
// services/igdb.js  —  IGDB API (Primary metadata source)
// ============================================================
// الـ IGDB هو المصدر الأساسي لكل حاجة:
//   • Cover / Hero / Logo / Screenshots / Artworks
//   • Trailer (YouTube)
//   • Description, Genres, Developer, Publisher, Release Date
//
// استراتيجية البحث (بالترتيب):
//   1. Exact match (اسم تطابق 100%) + فلتر PC platform
//   2. لو مش لاقي → fuzzy search + أكبر total_rating_count (الأشهر)
//   3. لو برضو مش لاقي → أول نتيجة عادي
// ============================================================

const https = require('https');

// ─── Config ───────────────────────────────────────────────
const CLIENT_ID     = process.env.IGDB_CLIENT_ID     || 'kmt4wvwdmv4gxukojtj534ubn89y7k';
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || 'u8hyljnn920ahjtjqsdp6vbhyd075e';

// Cache للـ token عشان ما نطلبش كل شوية
let _tokenCache = { token: null, expiresAt: 0 };

// IGDB Platform IDs للـ PC
const PC_PLATFORM_IDS = [6, 14]; // 6 = PC (Windows), 14 = Mac (اختياري)

// ─── Token ────────────────────────────────────────────────
async function getAccessToken() {
    if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
        return _tokenCache.token;
    }

    const res = await httpPost(
        'https://id.twitch.tv/oauth2/token',
        `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
        { 'Content-Type': 'application/x-www-form-urlencoded' }
    );

    _tokenCache.token     = res.access_token;
    _tokenCache.expiresAt = Date.now() + (res.expires_in - 60) * 1000;
    return _tokenCache.token;
}

// ─── Main export ──────────────────────────────────────────
async function fetchFromIGDB(gameName) {
    try {
        const token = await getAccessToken();
        const headers = {
            'Client-ID':     CLIENT_ID,
            'Authorization': `Bearer ${token}`,
            'Content-Type':  'text/plain',
        };

        // ════════════════════════════════════════════════════
        // STEP 1: Exact match مع فلتر PC
        // ════════════════════════════════════════════════════
        const cleanName = gameName.replace(/['"®™©]/g, '').trim();

        let game = await _searchExact(cleanName, headers);

        // ════════════════════════════════════════════════════
        // STEP 2: لو ما لقيناش → fuzzy مع ترتيب بالـ popularity
        // ════════════════════════════════════════════════════
        if (!game) {
            game = await _searchFuzzy(cleanName, headers);
        }

        if (!game) {
            console.warn(`[IGDB] No results for: ${gameName}`);
            return null;
        }

        console.log(`[IGDB] ✅ Matched: "${game.name}" (id=${game.id})`);

        // 👇 ضيف الكود ده هنا عشان يطبعلك الـ Raw Response 👇
        console.log(`\n==== RAW IGDB DATA FOR: ${gameName} ====`);
        console.log(JSON.stringify(game, null, 2));
        console.log(`=========================================\n`);

        return _formatGame(game);

    } catch (err) {
        console.error('[IGDB] fetchFromIGDB error:', err.message);
        return null;
    }
}

// ─── Search: Exact match ──────────────────────────────────
// ─── Search: Exact match ──────────────────────────────────
async function _searchExact(name, headers) {
    const body = `
        fields name, cover.image_id, artworks.image_id, screenshots.image_id,
               videos.video_id, videos.name,
               summary, genres.name, involved_companies.company.name,
               involved_companies.developer, involved_companies.publisher,
               first_release_date, platforms.id, rating, websites.url, websites.category,
               game_engines.name, game_modes.name, total_rating_count;
        search "${name}";
        limit 50; 
    `.trim(); // ✅ رفعنا الـ limit لـ 50 عشان لو الاسم عام زي Control ما يضيعش في الزحمة

    const results = await igdbRequest('/games', body, headers);
    if (!results || results.length === 0) return null;

    // أولاً: exact match على PC
    const exactPC = results.find(g =>
        g.name && g.name.toLowerCase() === name.toLowerCase() &&
        g.platforms?.some(p => PC_PLATFORM_IDS.includes(p.id))
    );
    if (exactPC) return exactPC;

    // ثانياً: exact match بغض النظر عن الـ platform
    const exactAny = results.find(g =>
        g.name && g.name.toLowerCase() === name.toLowerCase()
    );
    if (exactAny) return exactAny;

    return null;
}

// ─── Search: Fuzzy fallback ───────────────────────────────
// ─── Search: Fuzzy fallback ───────────────────────────────
async function _searchFuzzy(name, headers) {
    // هنستخدم search عشان ذكي في علامات الترقيم (زي النقطتين في Cities: Skylines)
    // وهنجيب 50 نتيجة عشان اللعبة الأساسية متضيعش في الزحمة
    const body = `
        fields name, cover.image_id, artworks.image_id, screenshots.image_id,
               videos.video_id, videos.name,
               summary, genres.name, involved_companies.company.name,
               involved_companies.developer, involved_companies.publisher,
               first_release_date, platforms.id, rating, websites.url, websites.category,
               game_engines.name, game_modes.name, total_rating_count;
        search "${name}";
        limit 50;
    `.trim();

    const results = await igdbRequest('/games', body, headers);
    if (!results || results.length === 0) return null;

    const validResults = results.filter(g => g.name);
    if (validResults.length === 0) return null;

    // ✅ السحر هنا: الجافاسكريبت هو اللي هيرتب الألعاب من الأشهر للأقل شهرة
    // عشان نضمن إن اللعبة الأساسية (زي Control أو Cities) تيجي قبل الـ DLCs
    validResults.sort((a, b) => (b.total_rating_count || 0) - (a.total_rating_count || 0));

    // نحاول نلاقي واحدة على PC بالاسم الأقرب من القائمة المترتبة
    const pcGame = validResults.find(g =>
        g.platforms?.some(p => PC_PLATFORM_IDS.includes(p.id)) &&
        _nameSimilarity(g.name, name) > 0.7
    );

    if (pcGame) return pcGame;

    // لو مش لاقي على PC → أول وأشهر واحدة بالاسم الأقرب
    return validResults.reduce((best, curr) => {
        const currSim = _nameSimilarity(curr.name, name);
        const bestSim = _nameSimilarity(best.name, name);
        return currSim > bestSim ? curr : best;
    }, validResults[0]);
}

// ─── Format response ──────────────────────────────────────
function _formatGame(game) {
    // Cover — هنجيب الجودة الأصلية
    const cover = game.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_original/${game.cover.image_id}.jpg`
        : null;

    // Screenshots — أول لقطة شاشة كبديل
    const screenshots = (game.screenshots || []).map(s =>
        `https://images.igdb.com/igdb/image/upload/t_original/${s.image_id}.jpg`
    );

    // Hero — أول artwork بالجودة الأصلية
    const artworks = (game.artworks || []).map(a =>
        `https://images.igdb.com/igdb/image/upload/t_original/${a.image_id}.jpg`
    );

    const heroImage = artworks[0] || screenshots[0] || null;

    // Trailer — بنفضل الـ "Official Trailer" أو أي video موجود
    // نستخدم youtube-nocookie.com عشان يشتغل في Electron بدون Error 153
    let trailer = null;
    if (game.videos && game.videos.length > 0) {
        // نفضل أول Official Trailer
        const officialTrailer = game.videos.find(v =>
            v.name?.toLowerCase().includes('trailer') ||
            v.name?.toLowerCase().includes('official')
        ) || game.videos[0];

        if (officialTrailer?.video_id) {
            // youtube-nocookie.com بيحل Error 153 في Electron
            trailer = `https://www.youtube-nocookie.com/embed/${officialTrailer.video_id}?autoplay=0&rel=0`;
        }
    }

    // كل الـ videos (للـ game details page تقدر تعرضهم كلهم)
    const allTrailers = (game.videos || []).map(v => ({
        name:   v.name || 'Trailer',
        url:    `https://www.youtube-nocookie.com/embed/${v.video_id}?autoplay=0&rel=0`,
        thumbUrl: `https://img.youtube.com/vi/${v.video_id}/mqdefault.jpg`,
    }));

    // Developer / Publisher
    const devs = (game.involved_companies || [])
        .filter(ic => ic.developer)
        .map(ic => ic.company?.name)
        .filter(Boolean);

    const pubs = (game.involved_companies || [])
        .filter(ic => ic.publisher)
        .map(ic => ic.company?.name)
        .filter(Boolean);

    // Website
    const officialSite = (game.websites || []).find(w => w.category === 1);

    // Release date
    const releaseDate = game.first_release_date
        ? new Date(game.first_release_date * 1000).toISOString().split('T')[0]
        : null;

    // Rating — IGDB rating من 0-100
    const rating = game.rating ? Math.round(game.rating) : null;

    return {
        // ── Images (المهمة للـ app كله) ──────────────────
        cover,          // للـ card في المكتبة
        heroImage,      // للـ background في صفحة التفاصيل
        logo: null,     // IGDB مش بيوفر logo (ممكن تجيبه من SteamGridDB)

        // ── Info ─────────────────────────────────────────
        info: {
            description: game.summary || null,
            genres:      (game.genres || []).map(g => g.name),
            developer:   devs.join(', ')   || null,
            publisher:   pubs.join(', ')   || null,
            releaseDate,
            rating,
            platforms:   (game.platforms || []).map(p => _getPlatformName(p.id)),
            engine:      (game.game_engines || []).map(e => e.name).join(', ') || null,
            gameMode:    (game.game_modes  || []).map(m => m.name).join(', ')  || null,
            website:     officialSite?.url || null,

            // ── Media ─────────────────────────────────────
            trailer,                // أول trailer (للـ player الرئيسي)
            allTrailers,            // كل الـ trailers
            isDirectVideo: false,   // IGDB دايماً YouTube

            // Screenshots = artworks + screenshots مع بعض
            // الـ artworks أحسن جودة وأنضف من الـ screenshots
            artworks,
            screenshots,
        },
    };
}

// ─── HTTP helpers ─────────────────────────────────────────
function igdbRequest(endpoint, body, headers) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.igdb.com',
            port:     443,
            path:     `/v4${endpoint}`,
            method:   'POST',
            headers,
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    // IGDB بيبعت errors كـ array من objects فيهم title
                    if (parsed?.message) {
                        reject(new Error(`IGDB API: ${parsed.message}`));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`IGDB parse error: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function httpPost(url, body, headers) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port:     443,
            path:     urlObj.pathname + urlObj.search,
            method:   'POST',
            headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Parse error: ${data}`)); }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ─── Utils ────────────────────────────────────────────────

// تشابه الأسماء: بنشيل الـ special chars وبنقارن
function _nameSimilarity(a, b) {
    const clean = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const ca = clean(a);
    const cb = clean(b);
    if (ca === cb) return 1;
    if (ca.includes(cb) || cb.includes(ca)) return 0.85;
    // Jaccard similarity على الكلمات
    const setA = new Set(ca.split(/\s+/));
    const setB = new Set(cb.split(/\s+/));
    const intersection = [...setA].filter(w => setB.has(w)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
}

function _getPlatformName(id) {
    const map = {
        6:   'PC',
        14:  'Mac',
        3:   'Linux',
        48:  'PS4',
        167: 'PS5',
        49:  'Xbox One',
        169: 'Xbox Series X',
        130: 'Nintendo Switch',
    };
    return map[id] || `Platform ${id}`;
}

module.exports = { fetchFromIGDB };
