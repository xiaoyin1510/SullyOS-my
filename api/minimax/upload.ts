const DOMESTIC_BASE = 'https://api.minimaxi.com';
const OVERSEAS_BASE = 'https://api.minimax.io';
const UPLOAD_PATH = '/v1/files/upload';

const resolveTargetUrl = (req: any): string => {
  const header = typeof req?.headers?.['x-minimax-region'] === 'string'
    ? req.headers['x-minimax-region'].trim().toLowerCase()
    : '';
  const envRegion = typeof process.env.MINIMAX_REGION === 'string'
    ? process.env.MINIMAX_REGION.trim().toLowerCase()
    : '';
  const region = header || envRegion;
  const base = region === 'overseas' ? OVERSEAS_BASE : DOMESTIC_BASE;
  return `${base}${UPLOAD_PATH}`;
};

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-MiniMax-API-Key,X-MiniMax-Region');
}

function normalizeApiKey(raw?: string): string {
  if (!raw) return '';
  return raw.trim().replace(/^Bearer\s+/i, '').trim();
}

export default async function handler(req: any, res: any) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const incomingAuthRaw = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const customApiKeyRaw = typeof req.headers['x-minimax-api-key'] === 'string' ? req.headers['x-minimax-api-key'] : '';
    const envApiKeyRaw = typeof process.env.MINIMAX_API_KEY === 'string' ? process.env.MINIMAX_API_KEY : '';

    const incomingApiKey = normalizeApiKey(incomingAuthRaw);
    const customApiKey = normalizeApiKey(customApiKeyRaw);
    const envApiKey = normalizeApiKey(envApiKeyRaw);
    const finalApiKey = incomingApiKey || customApiKey || envApiKey;

    if (!finalApiKey) {
      res.status(400).json({ error: 'Missing API key.' });
      return;
    }

    // Forward the raw body as multipart/form-data
    const contentType = req.headers['content-type'] || '';
    const upstream = await fetch(resolveTargetUrl(req), {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${finalApiKey}`,
      },
      body: req.body,
    });

    const text = await upstream.text();
    console.log('[minimax:upload] response', { http_status: upstream.status, body_preview: text.slice(0, 200) });
    res.status(upstream.status).send(text);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Proxy request failed' });
  }
}
