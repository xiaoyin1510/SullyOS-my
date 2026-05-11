/**
 * GitHub proxy route handler for Cloudflare Worker
 *
 * Add this to your existing sully-n Worker.
 * Route: /github?url=<encoded target URL>
 *
 * Example integration in your Worker's fetch handler:
 *
 *   if (pathname === '/github') {
 *       return handleGithub(request);
 *   }
 *
 * Why this exists: most users hit api.github.com directly from the browser
 * (GitHub does set CORS for any origin), but some networks (notably the GFW)
 * can't reach github.com at all. Routing through Cloudflare gives those users
 * a working path. Heads-up — Workers free tier caps the request body at
 * ~100 MB, so very large 'full' backups still need a direct upload.
 */

const ALLOWED_HOSTS = new Set(['api.github.com', 'uploads.github.com']);

export async function handleGithub(req: Request): Promise<Response> {
    const CORS: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
            'Authorization, Content-Type, Accept, X-GitHub-Method, X-GitHub-Api-Version',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }

    const url = new URL(req.url);
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }

    let parsed: URL;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }

    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
        return new Response(JSON.stringify({ error: 'Host not allowed' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }

    const ghMethod = (req.headers.get('X-GitHub-Method') || 'GET').toUpperCase();
    const allowed = ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'];
    if (!allowed.includes(ghMethod)) {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }

    const fwd: Record<string, string> = {};
    const auth = req.headers.get('Authorization');
    if (auth) fwd['Authorization'] = auth;
    const ct = req.headers.get('Content-Type');
    if (ct) fwd['Content-Type'] = ct;
    const accept = req.headers.get('Accept');
    if (accept) fwd['Accept'] = accept;
    const apiVer = req.headers.get('X-GitHub-Api-Version');
    if (apiVer) fwd['X-GitHub-Api-Version'] = apiVer;
    // GitHub rejects requests without a UA.
    fwd['User-Agent'] = 'sully-backup-proxy';

    try {
        let body: ArrayBuffer | null = null;
        if (ghMethod !== 'GET' && ghMethod !== 'DELETE') {
            body = await req.arrayBuffer();
            if (body.byteLength === 0) body = null;
        }

        const resp = await fetch(targetUrl, {
            method: ghMethod,
            headers: fwd,
            body,
            redirect: 'follow',
        });

        const resHeaders = new Headers(CORS);
        const rct = resp.headers.get('Content-Type');
        if (rct) resHeaders.set('Content-Type', rct);
        if (resp.status === 206) {
            const rcl = resp.headers.get('Content-Length');
            if (rcl) resHeaders.set('Content-Length', rcl);
        }
        const rcr = resp.headers.get('Content-Range');
        if (rcr) resHeaders.set('Content-Range', rcr);
        resHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

        return new Response(resp.body, {
            status: resp.status,
            headers: resHeaders,
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: `Proxy error: ${e.message}` }), {
            status: 502,
            headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }
}
