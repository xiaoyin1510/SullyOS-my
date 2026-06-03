import { minimaxFetch } from './minimaxEndpoint';

export type MiniMaxVoiceType = 'all' | 'system' | 'voice_cloning' | 'voice_generation';

export interface MiniMaxVoiceItem {
  voice_id: string;
  voice_name?: string;
  [key: string]: any;
}

export interface MiniMaxVoiceListResult {
  system_voice: MiniMaxVoiceItem[];
  voice_cloning: MiniMaxVoiceItem[];
  voice_generation: MiniMaxVoiceItem[];
  trace_id?: string;
}

const MINIMAX_VOICE_ENDPOINT = '/api/minimax/get-voice';
const normalizeApiKey = (raw: string): string => raw.trim().replace(/^Bearer\s+/i, '').trim();

export async function fetchMiniMaxVoices(apiKey: string, voiceType: MiniMaxVoiceType = 'all'): Promise<MiniMaxVoiceListResult> {
  const key = normalizeApiKey(apiKey || '');
  if (!key) {
    throw new Error('缺少 MiniMax API Key');
  }

  const response = await minimaxFetch(MINIMAX_VOICE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'X-MiniMax-API-Key': key,
    },
    body: JSON.stringify({
      voice_type: voiceType,
    }),
  });

  const data = await response.json();

  const statusCode = data?.base_resp?.status_code;
  if (!response.ok || (typeof statusCode === 'number' && statusCode !== 0)) {
    const statusMsg = data?.base_resp?.status_msg || `HTTP ${response.status}`;
    throw new Error(`MiniMax 音色查询失败: ${statusMsg}`);
  }

  return {
    system_voice: Array.isArray(data?.system_voice) ? data.system_voice : [],
    voice_cloning: Array.isArray(data?.voice_cloning) ? data.voice_cloning : [],
    voice_generation: Array.isArray(data?.voice_generation) ? data.voice_generation : [],
    trace_id: data?.trace_id,
  };
}
