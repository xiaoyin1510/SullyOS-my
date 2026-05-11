const DOMESTIC_BASE = 'https://api.minimaxi.com';
const OVERSEAS_BASE = 'https://api.minimax.io';
const T2A_PATH = '/v1/t2a_v2';

const resolveTargetUrl = (req: any): string => {
  const header = typeof req?.headers?.['x-minimax-region'] === 'string'
    ? req.headers['x-minimax-region'].trim().toLowerCase()
    : '';
  const envRegion = typeof process.env.MINIMAX_REGION === 'string'
    ? process.env.MINIMAX_REGION.trim().toLowerCase()
    : '';
  const region = header || envRegion;
  const base = region === 'overseas' ? OVERSEAS_BASE : DOMESTIC_BASE;
  return `${base}${T2A_PATH}`;
};

const resolveGroupId = (req: any): string => {
  const bodyGroupId = typeof req?.body?.group_id === 'string' ? req.body.group_id : '';
  const headerGroupId = typeof req?.headers?.['x-minimax-group-id'] === 'string' ? req.headers['x-minimax-group-id'] : '';
  const envGroupId = typeof process.env.MINIMAX_GROUP_ID === 'string' ? process.env.MINIMAX_GROUP_ID : '';
  return [bodyGroupId, headerGroupId, envGroupId].map(v => String(v || '').trim()).find(Boolean) || '';
};

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-MiniMax-API-Key,X-MiniMax-Group-Id,X-MiniMax-Region');
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
      res.status(400).json({ error: 'Missing API key. Provide Authorization, x-minimax-api-key, or MINIMAX_API_KEY.' });
      return;
    }

    const groupId = resolveGroupId(req);
    const requestBody = { ...(req.body || {}) };
    if (groupId && !requestBody.group_id) requestBody.group_id = groupId;
    const targetUrl = resolveTargetUrl(req);
    const requestStartedAt = Date.now();
    const reqPreview = typeof requestBody.text === 'string' ? requestBody.text.slice(0, 80) : '';

    console.log('[minimax:t2a] request', {
      model: requestBody.model,
      stream: requestBody.stream,
      output_format: requestBody.output_format,
      voice_id: requestBody?.voice_setting?.voice_id,
      group_id: requestBody.group_id || '',
      target: targetUrl,
      text_length: typeof requestBody.text === 'string' ? requestBody.text.length : 0,
      text_preview: reqPreview,
    });

    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finalApiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const text = await upstream.text();
    const elapsedMs = Date.now() - requestStartedAt;

    try {
      const parsed = JSON.parse(text);
      console.log('[minimax:t2a] response', {
        http_status: upstream.status,
        biz_status: parsed?.base_resp?.status_code,
        status_msg: parsed?.base_resp?.status_msg,
        trace_id: parsed?.trace_id,
        audio_type: typeof parsed?.data?.audio,
        audio_length: typeof parsed?.data?.audio === 'string' ? parsed.data.audio.length : 0,
        extra_audio_length: parsed?.extra_info?.audio_length,
        extra_audio_sample_rate: parsed?.extra_info?.audio_sample_rate,
        duration_ms: elapsedMs,
      });
    } catch {
      console.log('[minimax:t2a] response_non_json', {
        http_status: upstream.status,
        duration_ms: elapsedMs,
        body_preview: text.slice(0, 120),
      });
    }

    res.status(upstream.status).send(text);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Proxy request failed' });
  }
}
