const DOMESTIC_BASE = 'https://api.minimaxi.com';
const OVERSEAS_BASE = 'https://api.minimax.io';

type MinimaxUrls = { t2a: string; upload: string; clone: string };

const resolveMinimaxUrls = (req: any, bodyRegion: unknown): MinimaxUrls => {
  const bodyR = typeof bodyRegion === 'string' ? bodyRegion.trim().toLowerCase() : '';
  const headerR = typeof req?.headers?.['x-minimax-region'] === 'string'
    ? req.headers['x-minimax-region'].trim().toLowerCase()
    : '';
  const envR = typeof process.env.MINIMAX_REGION === 'string'
    ? process.env.MINIMAX_REGION.trim().toLowerCase()
    : '';
  const region = bodyR || headerR || envR;
  const base = region === 'overseas' ? OVERSEAS_BASE : DOMESTIC_BASE;
  return {
    t2a: `${base}/v1/t2a_v2`,
    upload: `${base}/v1/files/upload`,
    clone: `${base}/v1/voice_clone`,
  };
};

// Long text (~15s of speech) to ensure enough audio for voice cloning
const CLONE_SOURCE_TEXT = '在一个阳光明媚的早晨，小鸟在枝头欢快地歌唱，微风轻轻拂过脸庞，带来了花朵的芬芳。远处的山峦在薄雾中若隐若现，宛如一幅水墨画。人们漫步在林荫小道上，享受着这难得的宁静时光。孩子们在草地上奔跑嬉戏，笑声回荡在空气中，让人感到无比温暖和幸福。';

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-MiniMax-Region');
}

/**
 * Vercel serverless function: POST /api/minimax/bake-voice
 *
 * Accepts JSON body:
 * {
 *   apiKey: string,
 *   voiceId: string,       // desired custom voice_id
 *   model: string,
 *   ttsPayload: object,    // the T2A payload (voice_setting, timber_weights, etc.)
 *   groupId?: string,
 * }
 *
 * 1. Synthesizes a long audio sample using T2A with the user's timber_weights
 * 2. Downloads the audio and uploads to MiniMax /v1/files/upload
 * 3. Calls /v1/voice_clone to create a permanent voice_id
 * 4. Returns combined result
 */
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
    const { apiKey, voiceId, model, ttsPayload, groupId, region } = req.body || {};

    if (!apiKey) throw new Error('Missing apiKey');
    if (!voiceId) throw new Error('Missing voiceId');
    if (!ttsPayload) throw new Error('Missing ttsPayload');

    const urls = resolveMinimaxUrls(req, region);

    // Step 1: Synthesize a long audio sample using T2A with timber_weights
    const t2aBody = {
      ...ttsPayload,
      text: CLONE_SOURCE_TEXT,
      stream: false,
      output_format: 'url',
      audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
    };
    if (groupId) t2aBody.group_id = groupId;

    console.log('[bake-voice] step 1: synthesizing long audio sample...', { target: urls.t2a });
    const t2aRes = await fetch(urls.t2a, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(t2aBody),
    });
    const t2aData = await t2aRes.json() as any;
    const t2aStatus = t2aData?.base_resp?.status_code;
    if (typeof t2aStatus === 'number' && t2aStatus !== 0) {
      throw new Error(`T2A failed: ${t2aData?.base_resp?.status_msg || 'unknown'}`);
    }
    const audioRaw = t2aData?.data?.audio;
    if (!audioRaw || typeof audioRaw !== 'string') {
      throw new Error('T2A returned no audio');
    }

    // Get audio as Buffer
    let audioBuffer: Buffer;
    if (/^https?:\/\//i.test(audioRaw.trim())) {
      const audioRes = await fetch(audioRaw.trim());
      if (!audioRes.ok) throw new Error(`Audio download failed: HTTP ${audioRes.status}`);
      audioBuffer = Buffer.from(await audioRes.arrayBuffer());
    } else {
      // HEX format
      const cleanHex = audioRaw.trim().replace(/^0x/i, '');
      audioBuffer = Buffer.from(cleanHex, 'hex');
    }
    console.log(`[bake-voice] step 1 done: ${audioBuffer.length} bytes`);

    // Step 2: Upload audio to MiniMax for cloning
    const boundary = `----BakeVoice${Date.now()}`;
    const parts: Buffer[] = [];
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice_sample.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nvoice_clone\r\n`
    ));
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const multipartBody = Buffer.concat(parts);

    console.log('[bake-voice] step 2: uploading audio for cloning...');
    const uploadRes = await fetch(urls.upload, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    const uploadData = await uploadRes.json() as any;
    const fileId = uploadData?.file?.file_id;
    if (!fileId) {
      const msg = uploadData?.base_resp?.status_msg || JSON.stringify(uploadData);
      throw new Error(`Upload failed: ${msg}`);
    }
    console.log(`[bake-voice] step 2 done: file_id=${fileId}`);

    // Step 3: Call voice_clone
    console.log('[bake-voice] step 3: cloning voice...');
    const cloneRes = await fetch(urls.clone, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        file_id: fileId,
        voice_id: voiceId,
        model: model || 'speech-2.8-hd',
        text: '你好，这是固定后的声音，听听看效果怎么样？',
        need_noise_reduction: false,
        need_volumn_normalization: true,
      }),
    });
    const cloneData = await cloneRes.json() as any;
    const cloneStatus = cloneData?.base_resp?.status_code;
    if (typeof cloneStatus === 'number' && cloneStatus !== 0) {
      throw new Error(`Clone failed: ${cloneData?.base_resp?.status_msg || JSON.stringify(cloneData)}`);
    }
    console.log(`[bake-voice] step 3 done: voice_id=${voiceId}`);

    res.status(200).json({
      success: true,
      file_id: fileId,
      voice_id: voiceId,
      clone_data: cloneData,
    });
  } catch (error: any) {
    console.error('[bake-voice] error:', error?.message);
    res.status(500).json({ error: error?.message || 'bake-voice failed' });
  }
}
