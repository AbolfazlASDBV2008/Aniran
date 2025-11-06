// netlify/functions/image-proxy.js
// این فایل تصاویر را از cdn.myanimelist.net و img.youtube.com پراکسی می‌کند

export default async (req, context) => {
    try {
        const url = new URL(req.url);
        const imageUrl = url.searchParams.get('url');

        if (!imageUrl) {
            return new Response(JSON.stringify({ error: "No image URL provided" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // --- *** این بخش مهم‌ترین قسمت است *** ---
        // ما اکنون به لیستی از هاست‌های مجاز اجازه عبور می‌دهیم
        const allowedHosts = [
            'cdn.myanimelist.net', 
            'img.youtube.com' // این خط اجازه دسترسی به تامب‌نیل‌های یوتیوب را می‌دهد
        ];
        
        const externalUrl = new URL(imageUrl);
        
        if (!allowedHosts.includes(externalUrl.hostname)) {
             return new Response(JSON.stringify({ error: "Forbidden host" }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        // --- *** پایان بخش مهم *** ---


        // درخواست تصویر از سرور خارجی (MAL یا YouTube)
        const response = await fetch(imageUrl);

        if (!response.ok) {
            return new Response(response.body, {
                status: response.status,
            });
        }

        // دریافت تصویر به صورت باینری
        const imageBuffer = await response.arrayBuffer();
        
        // دریافت نوع محتوا (Content-Type) اصلی تصویر (مثلاً image/jpeg)
        const contentType = response.headers.get('content-type');

        // ارسال تصویر به مرورگر کاربر همراه با هدرهای صحیح
        return new Response(imageBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                // به مرورگر و CDN می‌گوییم که این تصویر را برای ۱ روز کش کند
                'Cache-Control': 'public, max-age=86400' 
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};