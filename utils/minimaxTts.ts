/**
 * Shared MiniMax TTS utility — used by ChatApp, DateApp, and CallApp
 */
import { CharacterProfile, APIConfig } from '../types';
import { resolveMiniMaxApiKey } from './minimaxApiKey';
import { minimaxFetch } from './minimaxEndpoint';
import { hashTtsParams, getCachedTts, saveCachedTts } from './ttsCache';

const DEFAULT_MODEL = 'speech-2.8-hd';

// MiniMax 支持的语气标签 — 这些在 TTS 中会被正确演绎，必须保留
const VALID_INTERJECTION_TAGS = new Set([
  'chuckle', 'laughs', 'sighs', 'coughs', 'clear-throat', 'groans',
  'breath', 'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'snorts',
  'lip-smacking', 'humming', 'hissing', 'emm',
]);

// 中文舞台指示 → MiniMax 语气标签映射（与 CallApp 一致的子集，用于 Chat/Date）
const CN_CUE_MAP: Record<string, string> = {
  '轻笑': '(chuckle)', '笑': '(laughs)', '大笑': '(laughs)',
  '叹气': '(sighs)', '叹息': '(sighs)',
  '咳嗽': '(coughs)', '咳': '(coughs)',
  '呻吟': '(groans)', '哼': '(groans)',
  '换气': '(breath)', '呼吸': '(breath)',
  '喘气': '(pant)', '喘': '(pant)',
  '吸气': '(inhale)', '呼气': '(exhale)',
  '倒吸气': '(gasps)', '嘶': '(hissing)',
  '嗯': '(emm)', '唔': '(emm)',
  '咂嘴': '(lip-smacking)', '哼唱': '(humming)',
  '喷鼻息': '(snorts)', '吸鼻子': '(sniffs)',
};

/** Strip parenthetical content intelligently: map known cues → interjection tags, delete unknown */
const stripParensPreservingTags = (text: string): string => {
  return text
    // 中文括号：映射 or 删除
    .replace(/（([^）]{1,48})）/g, (_m, cue: string) => {
      const t = cue.trim();
      if (CN_CUE_MAP[t]) return CN_CUE_MAP[t];
      for (const [key, tag] of Object.entries(CN_CUE_MAP)) {
        if (t.includes(key)) return tag;
      }
      return '';
    })
    // 西文括号：保留合法语气标签，删除其他
    .replace(/\(([^)]{1,80})\)/g, (_m, inner: string) => {
      const tag = inner.trim().toLowerCase();
      if (VALID_INTERJECTION_TAGS.has(tag)) return `(${tag})`;
      return '';
    });
};

/**
 * Clean text for TTS — strip stage directions, system tags, and voice markup.
 * If <语音>...</语音> tag exists, use its content (already translated for TTS).
 * Otherwise, strip（parenthetical cues）so they aren't read aloud.
 * Known interjection tags like (chuckle) / (sighs) are preserved.
 */
export const cleanTextForTts = (raw: string): string => {
  // 1. If <语音> tag exists, extract and use that content only
  const voiceTagMatch = raw.match(/<[语語]音>([\s\S]*?)<\/[语語]音>/);
  if (voiceTagMatch) {
    return stripParensPreservingTags(voiceTagMatch[1]).replace(/\s+/g, ' ').trim();
  }

  let text = raw;
  // 2. Strip [[...]] system markers
  text = text.replace(/\[\[.*?\]\]/g, '');
  // 3. Strip %%BILINGUAL%% and everything after
  text = text.replace(/%%BILINGUAL%%[\s\S]*/i, '');
  // 4. Map/strip parenthetical cues (preserving valid interjection tags)
  text = stripParensPreservingTags(text);
  // 5. Strip <语音>...</语音> tags if they somehow remain
  text = text.replace(/<[语語]音>[\s\S]*?<\/[语語]音>/g, '');
  // 6. Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
};

/** 为 TTS 文本插入 MiniMax 原生停顿标签 <#秒数#>，让语音有自然停顿
 * 停顿层次（从短到长）:
 *   ，、；  →  0.06s  微停（换气级）
 *   。！？  →  0.12s  句末停顿
 *   ——     →  0.18s  话题转折 / 拖长
 *   ……     →  0.35s  欲言又止 / 沉默感
 *   \n     →  0.25s  段落换气
 */
export const insertSpeechBreaks = (text: string): string => {
  if (!text) return '';
  return text
    // 最长停顿优先——省略号：欲言又止、沉默、犹豫
    .replace(/[…]{2,}/g, '……<#0.45#>')          // 多个省略号连用，更长
    .replace(/[…]/g, '…<#0.35#>')               // 单个省略号
    .replace(/\.{3,}/g, '...<#0.35#>')           // 英文省略号
    // 破折号：话题转折、语气拉长
    .replace(/——/g, '——<#0.18#>')
    .replace(/--/g, '--<#0.18#>')
    // 句末标点：正常句子结束
    .replace(/([。])/g, '$1<#0.12#>')
    .replace(/([！？!?])/g, '$1<#0.14#>')        // 感叹/疑问稍长一点点
    // 句中标点：轻微换气
    .replace(/([，,])/g, '$1<#0.06#>')
    .replace(/([、；;：:])/g, '$1<#0.05#>')
    // 换行：段落间停顿
    .replace(/\n/g, '\n<#0.25#>')
    // 去重：相邻多个停顿标签只保留最长的那个
    .replace(/(<#[\d.]+#>[\s]*){2,}/g, (match) => {
      const times = [...match.matchAll(/<#([\d.]+)#>/g)].map(m => parseFloat(m[1]));
      const maxTime = Math.min(Math.max(...times), 0.5);
      return `<#${maxTime.toFixed(2)}#>`;
    })
    .trim();
};

/**
 * Soft-clamp a numeric value to keep it within a safe range.
 * Preserves direction and feel but prevents extreme spikes that sound unnatural.
 */
const softClamp = (value: number, limit: number): number => {
  if (Math.abs(value) <= limit) return value;
  // Beyond the limit, compress logarithmically — still moves in the same direction but tapers off
  const sign = value > 0 ? 1 : -1;
  const excess = Math.abs(value) - limit;
  return sign * (limit + Math.log1p(excess) * (limit * 0.15));
};

/** Build timber_weights & voice_modify extras from a voiceProfile */
export const buildTtsExtras = (vp: CharacterProfile['voiceProfile']) => {
  if (!vp) return {};
  const extras: any = {};
  const tw = vp.timberWeights;
  if (tw && tw.length > 1) {
    extras.timber_weights = (() => {
      const totalWeight = tw.reduce((sum: number, t: any) => sum + (t.weight || 0), 0);
      if (totalWeight === 0) return tw.map((t: any) => ({ voice_id: t.voice_id, weight: Math.round(100 / tw.length) }));
      const raw = tw.map((t: any) => ({ voice_id: t.voice_id, weight: Math.round((t.weight / totalWeight) * 100) }));
      const diff = 100 - raw.reduce((s: number, r: any) => s + r.weight, 0);
      if (diff !== 0) raw[0].weight += diff;
      return raw;
    })();
  }
  if (vp.voiceModify) {
    const vm: any = {};
    // Clamp voice_modify params to prevent extreme spikes (e.g. sudden shrill voice)
    // pitch: safe range ±40 (full API range is ±100)
    // intensity: safe range ±30 — this is the biggest culprit for sudden shrill spikes
    // timbre: safe range ±40
    if (vp.voiceModify.pitch) vm.pitch = Math.round(softClamp(vp.voiceModify.pitch, 40));
    if (vp.voiceModify.intensity) vm.intensity = Math.round(softClamp(vp.voiceModify.intensity, 30));
    if (vp.voiceModify.timbre) vm.timbre = Math.round(softClamp(vp.voiceModify.timbre, 40));
    if (vp.voiceModify.sound_effects) vm.sound_effects = vp.voiceModify.sound_effects;
    if (Object.keys(vm).length) extras.voice_modify = vm;
  }
  return extras;
};

/** Build voice_setting fields (speed, vol, pitch, emotion) with safe ranges */
export const buildVoiceSettings = (vp: CharacterProfile['voiceProfile']) => ({
  // Clamp speed to 0.75–1.4 for natural human feel (API allows 0.5–2)
  speed: Math.max(0.75, Math.min(1.4, vp?.speed ?? 1)),
  vol: Math.max(0.3, Math.min(2, vp?.vol ?? 1)),
  // Clamp base pitch to ±8 semitones (API allows ±12) to avoid alien sound
  pitch: Math.max(-8, Math.min(8, vp?.pitch ?? 0)),
  ...(vp?.emotion ? { emotion: vp.emotion } : {}),
});

/** Convert hex audio from MiniMax to a playable Blob */
export const convertHexAudioToBlob = (hexAudio: string, mimeType = 'audio/mpeg'): Blob => {
  const cleanHex = hexAudio.trim().replace(/^0x/i, '');
  if (!cleanHex || cleanHex.length % 2 !== 0 || /[^\da-f]/i.test(cleanHex)) {
    throw new Error('MiniMax 返回的 HEX 音频数据格式异常');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return new Blob([bytes], { type: mimeType });
};

/** Fetch remote audio URL and return as Blob */
export const fetchRemoteAudioBlob = async (sourceUrl: string): Promise<Blob> => {
  const cacheBustedUrl = sourceUrl.includes('?')
    ? `${sourceUrl}&_ts=${Date.now()}`
    : `${sourceUrl}?_ts=${Date.now()}`;
  const response = await fetch(cacheBustedUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`音频下载失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('音频下载为空文件');
  return blob;
};

export interface TtsResult {
  /** Playable URL for <audio> — a blob: URL when `blob` is present, otherwise a remote MiniMax CDN URL */
  url: string;
  /** Raw audio blob when available. Null when we fell back to the remote URL (CORS / network). */
  blob: Blob | null;
}

/**
 * Call MiniMax TTS and return both the raw blob (if available) and a playable URL.
 * Prefer this variant when you need to persist audio to storage — the blob can be
 * written to IndexedDB so the audio survives page/component reloads.
 */
export async function synthesizeSpeechDetailed(
  text: string,
  char: CharacterProfile,
  apiConfig: APIConfig,
  options?: { languageBoost?: string; groupId?: string }
): Promise<TtsResult> {
  const apiKey = resolveMiniMaxApiKey(apiConfig);
  if (!apiKey) throw new Error('缺少 MiniMax API Key');
  const vp = char.voiceProfile;
  if (!vp?.voiceId && (!vp?.timberWeights || vp.timberWeights.length === 0)) {
    throw new Error('角色未配置语音');
  }

  // Insert natural pauses at punctuation marks
  const processedText = insertSpeechBreaks(text);

  const payload: any = {
    model: vp?.model || DEFAULT_MODEL,
    text: processedText,
    voice_setting: {
      voice_id: vp?.voiceId || '',
      ...buildVoiceSettings(vp),
    },
    audio_setting: { format: 'mp3' },
    ...buildTtsExtras(vp),
  };
  if (options?.languageBoost) {
    payload.language_boost = options.languageBoost;
  }

  // Check the shared cache before hitting the network. Two call sites that
  // build the same payload get the same hash and reuse whichever one synthesized
  // the audio first — across sessions, across apps.
  const cacheKey = hashTtsParams({
    kind: 'minimax-t2a',
    text: payload.text,
    model: payload.model,
    voice_setting: payload.voice_setting,
    timber_weights: payload.timber_weights,
    voice_modify: payload.voice_modify,
    language_boost: payload.language_boost,
    audio_setting: payload.audio_setting,
  });
  const cached = await getCachedTts(cacheKey);
  if (cached) {
    return { url: URL.createObjectURL(cached), blob: cached };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-MiniMax-API-Key': apiKey,
  };
  if (options?.groupId) headers['X-MiniMax-Group-Id'] = options.groupId;

  const res = await minimaxFetch('/api/minimax/t2a', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `TTS 失败 (HTTP ${res.status})`);

  // Check MiniMax business-level error (can return HTTP 200 with status_code != 0)
  const baseResp = data?.base_resp;
  if (baseResp && baseResp.status_code !== 0 && baseResp.status_code !== undefined) {
    throw new Error(`TTS 业务错误: ${baseResp.status_msg || `status_code=${baseResp.status_code}`}`);
  }

  const audio = data?.data?.audio;
  if (!audio) {
    // Log full response for debugging
    console.error('[TTS] No audio in response:', JSON.stringify(data).slice(0, 500));
    throw new Error('TTS 返回无音频数据');
  }

  let blob: Blob;
  if (/^https?:\/\//i.test(audio.trim())) {
    try {
      blob = await fetchRemoteAudioBlob(audio.trim());
    } catch (e) {
      // fetch() may fail due to CORS when hitting MiniMax CDN directly;
      // return the raw URL so <audio src=...> can load it without CORS.
      console.warn('[TTS] fetchRemoteAudioBlob failed, returning remote URL directly', (e as any)?.message || e);
      return { url: audio.trim(), blob: null };
    }
  } else {
    blob = convertHexAudioToBlob(audio);
  }
  // Persist to the shared cache in the background — the next identical request
  // (same text + voice settings) will be served locally.
  saveCachedTts(cacheKey, blob).catch(() => { /* ignore */ });
  return { url: URL.createObjectURL(blob), blob };
}

/**
 * Call MiniMax TTS and return a playable URL. Thin wrapper around
 * `synthesizeSpeechDetailed` — use that variant when you also need the raw blob.
 */
export async function synthesizeSpeech(
  text: string,
  char: CharacterProfile,
  apiConfig: APIConfig,
  options?: { languageBoost?: string; groupId?: string }
): Promise<string> {
  const { url } = await synthesizeSpeechDetailed(text, char, apiConfig, options);
  return url;
}
