// netlify/functions/get-anime-details.js
// --- نسخه نهایی با فیلد خطای ترجمه برای فرانت‌اند ---

const JIKAN_API_BASE = "https://api.jikan.moe/v4";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${process.env.GEMINI_API_KEY}`;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// --- توابع کش ---
async function getFromCache(key) {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
        console.warn("Upstash env vars not set. Skipping cache read.");
        return null;
    }
    try {
        const response = await fetch(`${UPSTASH_URL}/get/${key}`, {
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch from cache: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.result) {
            console.log(`Cache HIT for key: ${key}`);
            return JSON.parse(data.result);
        }
        console.log(`Cache MISS for key: ${key}`);
        return null;
    } catch (error) {
        console.error("Upstash getFromCache Error:", error.message);
        return null;
    }
}

async function saveToCache(key, value) {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
        console.warn("Upstash env vars not set. Skipping cache write.");
        return;
    }
    try {
        console.log(`Cache WRITE for key: ${key} (Permanent)`);
        await fetch(`${UPSTASH_URL}/set/${key}`, { // ذخیره‌سازی دائمی
            method: 'POST',
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
            body: JSON.stringify(value)
        });
    } catch (error) {
        console.error("Upstash saveToCache Error:", error.message);
    }
}

// --- توابع API ---
async function fetchFromJikan(animeId) {
    console.log(`Fetching from Jikan for ID: ${animeId}`);
    const response = await fetch(`${JIKAN_API_BASE}/anime/${animeId}/full`);
    if (!response.ok) {
        throw new Error(`Jikan API error: ${response.statusText}`);
    }
    const result = await response.json();
    return result.data;
}

async function fetchTranslations(title, synopsis, includeSynopsis = true) {
    console.log(`Fetching from Gemini. Title: ${title}, IncludeSynopsis: ${includeSynopsis}`);
    
    const requestObject = { title: title || '' };
    if (includeSynopsis) {
        requestObject.synopsis = synopsis || 'No synopsis available.';
    }

    const returnKeys = includeSynopsis ? `"persian_title" and "persian_synopsis"` : `"persian_title"`;
    const prompt = `Translate the following anime details to Persian. Return ONLY a JSON object with keys ${returnKeys}.
${JSON.stringify(requestObject, null, 2)}`;
    
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
    };
    
    const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Gemini API Error Response (non-OK):", errorData);
        
        // --- *** اصلاح: پرتاب کردن خطای 429 *** ---
        if (response.status === 429 || errorData?.error?.message.includes("Resource Exhausted")) {
            throw new Error("Gemini API error (429): Resource Exhausted", { cause: "RATE_LIMIT" });
        }
        
        const blockReason = errorData?.promptFeedback?.blockReason;
        if (blockReason) {
            throw new Error(`Gemini API error (${response.status}): ${blockReason}`, { cause: blockReason });
        }
        throw new Error(`Gemini API error (${response.status}): ${errorData?.error?.message || response.statusText}`);
    }
    
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (text) {
        console.log("Gemini translation successful.");
        return JSON.parse(text);
    }

    const blockReason = result.promptFeedback?.blockReason;
    if (blockReason) {
        console.error(`Gemini Error (200 OK): Blocked for ${blockReason}`, result);
        throw new Error(`Gemini API error (200 OK): ${blockReason}`, { cause: blockReason });
    }

    console.error("Invalid response structure from Gemini:", result);
    throw new Error("Invalid response structure from Gemini.");
}

function isTranslationValid(data) {
    if (!data || !data.persian_title) {
        return false;
    }
    const isDifferentFromJapanese = data.persian_title !== data.title;
    const isDifferentFromEnglish = !data.title_english || (data.persian_title !== data.title_english);
    
    return isDifferentFromJapanese && isDifferentFromEnglish;
}


// --- فانکشن اصلی ---
export default async (req, context) => {
    
    // --- *** اصلاح: متغیرهای وضعیت ترجمه *** ---
    let translationWasSuccessful = false;
    let translationErrorType = null; // 'rate_limit' یا 'general_failure'
    // --- *** پایان اصلاح *** ---

    try {
        const url = new URL(req.url);
        const animeId = url.searchParams.get('id');
        const forceRefresh = url.searchParams.get('refresh') === 'true'; 
        
        console.log(`Function 'get-anime-details' (v-err-handling) started for ID: ${animeId}. ForceRefresh: ${forceRefresh}`);
        
        if (!animeId) {
            console.error("No anime ID provided.");
            return new Response(JSON.stringify({ error: "No anime ID provided" }), {
                status: 400, headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const currentCacheKey = `anime:v4:${animeId}`;
        
        if (!forceRefresh) {
            const oldCacheKeys = [`anime:v3:${animeId}`, `anime:v2:${animeId}`, `anime:${animeId}`];
            
            let cachedData = await getFromCache(currentCacheKey);
            if (cachedData) {
                console.log("Cache HIT (v4): Returning data.");
                return new Response(JSON.stringify({ data: cachedData, source: 'cache' }), {
                    status: 200, headers: { 'Content-Type': 'application/json' }
                });
            }
            
            console.log("Cache (v4) MISS. Checking for old cache keys...");

            for (const oldKey of oldCacheKeys) {
                const oldData = await getFromCache(oldKey);
                if (oldData) {
                    console.log(`Cache HIT (old key: ${oldKey}). Checking validity...`);
                    if (isTranslationValid(oldData)) {
                        console.log(`Migrating VALID translated data from ${oldKey} to ${currentCacheKey}.`);
                        await saveToCache(currentCacheKey, oldData);
                        return new Response(JSON.stringify({ data: oldData, source: 'cache-migrated' }), {
                            status: 200, headers: { 'Content-Type': 'application/json' }
                        });
                    } else {
                        console.log(`Found INVALID (untranslated) data in ${oldKey}. Checking next old key...`);
                    }
                }
            }
        } else {
            console.log(`FORCE REFRESH requested for ID: ${animeId}. Skipping all cache checks.`);
        }

        console.log("No valid cache found or refresh forced. Proceeding to fetch from APIs...");
        
        const animeData = await fetchFromJikan(animeId);
        
        const originalTitle = animeData.title_english || animeData.title;
        const originalSynopsis = animeData.synopsis || "No synopsis available.";
        
        let translations = { persian_title: null, persian_synopsis: null };
        
        try {
            console.log(`Attempt 1: Translating Title + Synopsis for ID ${animeId}`);
            const geminiTranslations = await fetchTranslations(originalTitle, originalSynopsis, true);
            
            const newPersianTitle = geminiTranslations.persian_title;
            const tempCheckData = { ...animeData, persian_title: newPersianTitle };

            if (isTranslationValid(tempCheckData)) {
                translations.persian_title = newPersianTitle;
                translations.persian_synopsis = geminiTranslations.persian_synopsis;
                translationWasSuccessful = true;
                console.log(`Attempt 1 Succeeded for ID ${animeId}.`);
            } else {
                 console.log(`Attempt 1 returned empty/identical translation for ID ${animeId}.`);
                 translationErrorType = 'general_failure'; // ترجمه بود اما معتبر نبود
            }

        } catch (geminiError) {
            console.error(`Attempt 1 FAILED for ID ${animeId}:`, geminiError.message);
            
            // --- *** اصلاح: تنظیم نوع خطا *** ---
            if (geminiError.cause === "RATE_LIMIT") {
                translationErrorType = 'rate_limit';
            } else {
                translationErrorType = 'general_failure';
            }
            // --- *** پایان اصلاح *** ---

            if (geminiError.cause === "PROHIBITED_CONTENT") {
                console.warn(`Synopsis for ID ${animeId} was blocked. Attempt 2: Translating Title ONLY.`);
                try {
                    const titleOnlyTranslations = await fetchTranslations(originalTitle, null, false);
                    
                    const newPersianTitle = titleOnlyTranslations.persian_title;
                    const tempCheckData = { ...animeData, persian_title: newPersianTitle };
                    
                    if (isTranslationValid(tempCheckData)) {
                        translations.persian_title = newPersianTitle;
                        translations.persian_synopsis = originalSynopsis;
                        translationWasSuccessful = true; 
                        translationErrorType = null; // تلاش دوم موفق بود، پس خطا را پاک کن
                        console.log(`Attempt 2 Succeeded for ID ${animeId} (Title Only).`);
                    } else {
                        console.log(`Attempt 2 returned empty/identical title for ID ${animeId}.`);
                        translationErrorType = 'general_failure'; // تلاش دوم هم ناموفق بود
                    }

                } catch (retryError) {
                    console.error(`Attempt 2 (Title Only) also FAILED for ID ${animeId}:`, retryError.message);
                    if (retryError.cause === "RATE_LIMIT") {
                        translationErrorType = 'rate_limit';
                    } else {
                        translationErrorType = 'general_failure';
                    }
                }
            }
        }
        
        const finalData = {
            ...animeData,
            persian_title: translations.persian_title || originalTitle,
            persian_synopsis: translations.persian_synopsis || originalSynopsis
        };
        
        if (translationWasSuccessful) {
            await saveToCache(currentCacheKey, finalData);
        } else {
            console.log(`Translation failed completely for ID: ${animeId}. NOT CACHING.`);
        }
        
        // --- *** اصلاح: ساخت آبجکت پاسخ نهایی *** ---
        console.log(`Returning data for ID: ${animeId}.`);
        const responsePayload = {
            data: finalData,
            source: translationWasSuccessful ? 'api-fresh' : 'api-untranslated'
        };
        
        // اگر ترجمه ناموفق بود، دلیل آن را به فرانت‌اند بگو
        if (!translationWasSuccessful && translationErrorType) {
            responsePayload.translationError = translationErrorType;
        }
        
        return new Response(JSON.stringify(responsePayload), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });
        // --- *** پایان اصلاح *** ---

    } catch (error) {
        // این catch خطاهای Jikan (مثل 404) را مدیریت می‌کند
        console.error("Unhandled error in get-anime-details:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }
};