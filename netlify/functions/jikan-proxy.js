// این فایل درخواست‌ها را به JIKAN API هدایت می‌کند
// آدرس در فرانت‌اند: /.netlify/functions/jikan-proxy?endpoint=anime/5114/full

const JIKAN_API_BASE = "https://api.jikan.moe/v4";

export default async (req, context) => {
    try {
        // دریافت پارامتر endpoint از URL
        const url = new URL(req.url);
        const endpoint = url.searchParams.get('endpoint');

        if (!endpoint) {
            return new Response(JSON.stringify({ error: "No endpoint provided" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ساخت URL کامل Jikan
        const jikanUrl = `${JIKAN_API_BASE}/${endpoint}`;
        
        // ارسال درخواست به Jikan
        const response = await fetch(jikanUrl, {
            headers: { 'User-Agent': 'Aniran-App-Serverless-Proxy' }
        });

        if (!response.ok) {
            const errorData = await response.json();
            return new Response(JSON.stringify(errorData), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // برگرداندن پاسخ Jikan مستقیماً به فرانت‌اند
        const data = await response.json();
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};