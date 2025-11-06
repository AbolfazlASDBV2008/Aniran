// netlify/functions/gemini-proxy.js
// --- نسخه نهایی با مدل صحیح ---

export default async (req, context) => {
    try {
        const geminiApiKey = process.env.GEMINI_API_KEY;

        if (!geminiApiKey) {
            return new Response(JSON.stringify({ error: "Server is not configured with API Key." }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const body = await req.json();

        // *** استفاده از مدل جدید و استاندارد ***
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${geminiApiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body) 
        });

        if (!response.ok) {
            const errorData = await response.json();
            return new Response(JSON.stringify(errorData), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

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

