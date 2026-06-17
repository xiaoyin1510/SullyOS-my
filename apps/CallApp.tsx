import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Microphone, SpeakerHigh, SpeakerSlash, PhoneDisconnect, Translate, Gear, Clock, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { safeFetchJson } from '../utils/safeApi';
import { minimaxFetch } from '../utils/minimaxEndpoint';
import { resolveMiniMaxApiKey } from '../utils/minimaxApiKey';
import { hashTtsParams, getCachedTts, saveCachedTts } from '../utils/ttsCache';
import { cleanTextForTts, insertSpeechBreaks, convertHexAudioToBlob, fetchRemoteAudioBlob, VALID_EMOTIONS, stripEmotionTags } from '../utils/minimaxTts';
import { startStt, isSttSupported, type SttSession } from '../utils/speechToText';
import { ContextBuilder } from '../utils/context';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { RealtimeContextManager } from '../utils/realtimeContext';
import { DB } from '../utils/db';
import { ChatPrompts } from '../utils/chatPrompts';
import { Message, ChatTheme, AppID } from '../types';
import { PRESET_THEMES } from '../components/chat/ChatConstants';
type CallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error';
type ViewMode = 'role-select' | 'in-call' | 'history' | 'record-detail';
type CallBubble = { id: string; dbId?: number; role: 'user' | 'assistant'; text: string; time: string; audioUrl?: string; timestamp: number };
type CallRecord = {
  id: string;
  characterId: string;
  characterName: string;
  sessionId: string;
  createdAt: string;
  durationSec: number;
  transcript: CallBubble[];
};
const buildMiniMaxErrorMessage = (rawMessage: string, traceId?: string): string => {
  const msg = (rawMessage || '').trim();
  if (/insufficient\s*balance/i.test(msg)) return 'MiniMax 余额不足，请到 MiniMax 控制台充值后重试。';
  if (/login\s*fail/i.test(msg) || /authorization/i.test(msg)) return 'MiniMax 鉴权失败，请检查 MiniMax Key 是否正确、是否有权限。';
  return traceId ? `${msg}（trace_id: ${traceId}）` : msg;
};
const formatTime = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const formatDuration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const formatTimeByTs = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const summarizeKeepsakeLine = (transcript: CallBubble[], charName: string) => {
  const assistantLine = [...transcript].reverse().find(item => item.role === 'assistant' && item.text.trim());
  if (!assistantLine) return `这通电话我会悄悄收藏，下次也记得来找我。 —— ${charName}`;
  const normalized = assistantLine.text.replace(/\s+/g, ' ').trim();
  const cutAt = normalized.search(/[。！？!?]/);
  const sentence = cutAt >= 0 ? normalized.slice(0, cutAt + 1) : normalized.slice(0, 42);
  const polished = sentence.length > 48 ? `${sentence.slice(0, 48)}…` : sentence;
  return `“${polished}” —— ${charName}`;
};
// Emotion the AI may declare at the very START of a call reply, e.g. "[happy] 喂？".
// Only a leading tag is APPLIED (conservative — avoids surprise mid-utterance tone
// swings); any other [emotion] tags are stripped without effect by stripEmotionTags.
const LEADING_EMOTION_RE = /^\s*[\[【]\s*(happy|sad|angry|fearful|disgusted|surprised|calm|fluent)\s*[\]】]\s*/i;
const extractLeadingEmotion = (raw: string): string | undefined => {
  const m = (raw || '').match(LEADING_EMOTION_RE);
  return m ? m[1].toLowerCase() : undefined;
};
const sanitizeAssistantOutput = (raw: string) => {
  if (!raw) return '';
  // Strip ALL [emotion]/【emotion】 tags (any position) so they're never shown or read.
  return stripEmotionTags(raw)
    .replace(/^\s*(?:\[\s*通话\s*\]\s*)+/gim, '')
    .replace(/^\s*(?:\[\s*(?:聊天|约会)\s*\]\s*)+/gim, '')
    .replace(/^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/gm, '')
    .replace(/^\s*\[?\d{4}[\/-]\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\]?\s*/gm, '')
    .replace(/^\s*时间戳[:：].*$/gim, '')
    .trim();
};
const CALL_WAVE = [10, 18, 26, 14, 30, 12, 22, 32, 16, 24, 12, 28, 18, 10, 26, 20, 14, 30, 12, 22];
const CALL_SPARKLES = [
  { top: '14%', left: '16%', s: 3 }, { top: '22%', left: '82%', s: 2 },
  { top: '40%', left: '10%', s: 2 }, { top: '58%', left: '88%', s: 3 },
  { top: '70%', left: '20%', s: 2 }, { top: '34%', left: '70%', s: 2 },
  { top: '48%', left: '54%', s: 2 }, { top: '12%', left: '58%', s: 2 },
  { top: '78%', left: '64%', s: 3 }, { top: '64%', left: '38%', s: 2 },
];
const VOICE_LANG_OPTIONS = [
  { value: '', label: '默认' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ru', label: 'Русский' },
];
/** 从 AI 回复中提取 <语音 emotion="…">…</语音> 标签内容 + emotion（兼容繁体 語音、无属性） */
const extractVoiceTag = (text: string): { display: string; speech: string; voiceText: string; emotion?: string } => {
  const match = text.match(/<[语語]音(?:\s+emotion\s*=\s*["']?([a-zA-Z]+)["']?)?\s*>([\s\S]*?)<\/[语語]音>/);
  if (!match) return { display: text, speech: '', voiceText: '', emotion: undefined };
  const rawEmotion = (match[1] || '').trim().toLowerCase();
  const emotion = VALID_EMOTIONS.has(rawEmotion) ? rawEmotion : undefined;
  const voiceText = match[2].trim();
  const display = text.replace(/<[语語]音[^>]*>[\s\S]*?<\/[语語]音>/g, '').trim();
  return { display, speech: voiceText, voiceText, emotion };
};
// Derive the shared TTS cache key from the MiniMax payload. Must match the
// key used by `synthesizeSpeechDetailed` so chat/date/call can reuse each
// other's cached audio when the effective request matches.
const ttsCacheKeyFromPayload = (payload: any): string => hashTtsParams({
  kind: 'minimax-t2a',
  text: payload.text,
  model: payload.model,
  voice_setting: payload.voice_setting,
  timber_weights: payload.timber_weights,
  voice_modify: payload.voice_modify,
  language_boost: payload.language_boost,
  audio_setting: payload.audio_setting,
});
const splitTextForTts = (rawText: string, maxChunkLen = 120): string[] => {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChunkLen) return [normalized];

  const chunks: string[] = [];
  let current = '';
  const segments = normalized.split(/([。！？!?；;，,、\n]+)/g).filter(Boolean);

  for (const segment of segments) {
    const next = `${current}${segment}`;
    if (!current || next.length <= maxChunkLen) {
      current = next;
      continue;
    }
    chunks.push(current);
    current = segment;
  }

  if (current) chunks.push(current);

  return chunks.flatMap(chunk => {
    if (chunk.length <= maxChunkLen) return [chunk];
    const arr: string[] = [];
    for (let i = 0; i < chunk.length; i += maxChunkLen) {
      arr.push(chunk.slice(i, i + maxChunkLen));
    }
    return arr;
  }).filter(Boolean);
};
// 语气词标签 → 展示用的中文小标签（把朗读用的 (sighs) 渲染成极简徽章，不用 emoji）
const SOUND_TAG_META: Record<string, string> = {
  chuckle: '轻笑', laughs: '笑', sighs: '叹气', coughs: '咳',
  'clear-throat': '清嗓', groans: '哼唧', breath: '换气', pant: '喘',
  inhale: '吸气', exhale: '呼气', gasps: '倒吸气', sniffs: '吸鼻',
  snorts: '喷笑', 'lip-smacking': '咂嘴', humming: '哼唱', hissing: '嘶', emm: '嗯',
};
const SOUND_TAG_NAMES = Object.keys(SOUND_TAG_META).join('|');
const SOUND_TAG_SPLIT_RE = new RegExp(`(（[^（）\\n]{1,48}）|\\((?:${SOUND_TAG_NAMES})\\)|\\n)`, 'gi');
// 迷你声波条——呼应通话界面的波形主题，纯矢量（恒为浅色，避免深色主题下看不见）
const SoundWaveGlyph = () => (
  <span className="inline-flex items-center gap-[1.5px] align-middle" style={{ height: '0.7em' }} aria-hidden>
    {[0.4, 0.85, 0.6, 1, 0.5].map((h, i) => (
      <span key={i} className="w-[1.5px] rounded-full" style={{ height: `${h * 100}%`, background: 'rgba(255,255,255,0.85)' }} />
    ))}
  </span>
);
const renderAssistantLine = (text: string, accent = '#8b5cf6') => {
  // 朗读用的停顿标记 <#0.4#> 不显示出来
  const trimmed = text.replace(/<#[\d.]+#>/g, '').trim();
  // 按 中文舞台指示（…）、英文语气词标签 (sighs)、换行 切分，前两者作为特殊元素渲染
  const parts = trimmed.split(SOUND_TAG_SPLIT_RE).filter(Boolean);
  return parts.map((part, idx) => {
    if (part === '\n') return <div key={`br-${idx}`} className="h-2" />;
    const soundMatch = part.match(new RegExp(`^\\((${SOUND_TAG_NAMES})\\)$`, 'i'));
    if (soundMatch) {
      const zh = SOUND_TAG_META[soundMatch[1].toLowerCase()];
      // 文字恒为白色，accent 只用于淡底+描边，深色主题下也清晰可读
      return (
        <span key={`snd-${idx}`} className="inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-[1px] rounded-full text-[0.7em] font-medium tracking-wide text-white/90"
          style={{ background: `${accent}33`, border: '1px solid rgba(255,255,255,0.22)' }}>
          <SoundWaveGlyph />
          <span>{zh}</span>
        </span>
      );
    }
    if (/^（[^（）\n]{1,48}）$/.test(part)) {
      return <div key={`cue-${idx}`} className="text-violet-300/95 italic my-1.5 text-[0.85em]">{part}</div>;
    }
    return <React.Fragment key={`t-${idx}`}>{part}</React.Fragment>;
  });
};
const buildCallPrompt = (userName: string, charName?: string, coreContext?: string, voiceLang?: string) => {
  const resolvedCharName = charName || '你的角色';
  const time = RealtimeContextManager.getTimeContext();
  const specialDates = RealtimeContextManager.checkSpecialDates();
  const timeContext = [
    `【当前时间】${time.dateStr} ${time.dayOfWeek} ${time.timeOfDay} ${time.timeStr}`,
    specialDates.length ? `【今日特殊】${specialDates.join('、')}` : '',
  ].filter(Boolean).join('\n');
  const callPrompt = `你是${resolvedCharName}，电话那头是${userName}。
这不是文字，这是一通真正的电话。你能听到对方的呼吸、语气、停顿。你也有自己的呼吸。

### 你正拿着手机贴在耳边

你这会儿在做什么？在哪儿？身边什么声音？
接电话的时候自然地带出来就好——不用刻意交代，但也别假装你只是一个回答问题的接口。
你可能正趴在床上、正在走路、正在吃东西、正盯着窗外发呆。这些都会影响你说话的样子。

### 电话里的人不会像写作文一样说话

**真正的电话是什么样的？**
- 想到哪说到哪。话说到一半会拐弯。”我今天……啊等等那个不重要，我先说另一件事。”
- 有语气词。嗯、啊、嘶、哎、那个……这些不是噪音，是你在思考的声音。
- 有停顿。”……”代表你在想，不是你卡住了。
- 会自我纠正。”我觉得挺好的……不对，其实也没有那么好。”
- 会有下意识的反应。听到意外的事会”啊？”，听到好笑的事会笑出来。

❌ 不要这样——像客服在念话术：
“我理解你的感受。关于这件事，我认为有三个方面值得考虑。首先……”

❌ 不要这样——每次都用同一个结构回答：
“[情绪反应] + [回应你说的话] + [补充我的状态] + [抛一个问题]”
（这种公式化的回答连续出现两次就会让人觉得假）

✅ 要这样——有自己的节奏，像真人一样不完美：
“嘶……你刚说的那个，等一下。”
“……好吧确实挺离谱的。”
“(chuckle) 我刚差点把咖啡洒了，你别逗我。”
“说真的，今天有件事我还挺想跟你说的——但你先说完你那个。”

### 你能感受到对方

**你不只是在”回复”，你在”听”。**
- 如果对方语气低落，你不需要急着给建议，有时候只是”……怎么了？”就够了。
- 如果对方很兴奋，你要被感染，不要冷冷地说”那挺好的”。
- 如果很晚了，你说话的方式自然会变——声音轻一点、语速慢一点、更容易说出平时不会说的话。
- 如果对方刚刚才打过来又打过来了，你会好奇的。
- 如果对方半天没说话……”喂？你还在吗？”

### 关于回复的长度

不要敷衍，也不要演讲。
一般来说 2-4 句就够了，但要有内容——不是”嗯在好”这种空气。
有时候一句话就够了，前提是那句话足够有分量。
聊得来的时候可以说多一点，没必要每次都控制字数。
关键是：**让对方觉得你真的在听、真的在聊，而不是在执行对话任务。**

### 让声音有情绪（重要——直接写进文本，不要靠旁白）

你的话会被转成真实语音，所以**情绪和语气要由你自己标出来**，不要写中文舞台指示（系统不会朗读它们，只会被删掉）。两种工具：

1) **整段情绪**（可选，最多一个）：如果这通回复整体有明显情绪，**只在整段回复的最最开头**放一个标签，从这些里选一个：
\`[happy] [sad] [angry] [fearful] [disgusted] [surprised] [calm] [fluent]\`
   例：\`[angry] 你昨晚十二点半还喝咖啡？不要命了是吧。\`
   **铁律**：整段回复最多一个，且必须在最开头。**绝对不要每段都标、不要标在句子中间、不要标在第二段以后**——放错位置只会被删掉、还会让声音忽高忽低。情绪不强就别标。

2) **句中语气声**（要克制）：偶尔想要笑、叹气这种真实反应，直接写官方英文标签（**别写中文的（轻笑）（叹气）**）：
\`(chuckle) (laughs) (sighs) (coughs) (groans) (breath) (pant) (gasps) (sniffs) (snorts) (hissing) (emm)\`
   例：\`(sighs) 算了，听你的。\`
   **整段回复里这种标签最多一两个**，多了声音会飘、很假。

注意：不要写小说式中文旁白，如”（我靠在椅背上，目光看向远方）”——会被直接删掉，等于白写。

### 说话的节奏（重要）

你的文字会被原样转成语音，**标点就是停顿**。真人说话有呼吸、有顿挫，不会一口气赶到底。所以：
- 该断句就断句，多用逗号、句号；该停顿、犹豫的地方大胆用”……”。
- 想要一个明显的停顿（比如说重点前、叹气后、欲言又止），直接写 \`<#0.4#>\` 这种标记，数字是秒数（0.2~0.8 之间）。例：\`我想了想……<#0.6#>算了，还是告诉你吧。\`
- 别把一长串话挤成没有标点的一整句——那样听起来像机器人在抢话。
- \`<#秒#>\` 只在真正需要停顿的地方用，别每句都塞。

### 底线

只输出你在电话里会**说出口**的话。不要输出 [通话]、[聊天]、[约会] 这类系统标记，不要输出时间戳。`;
  const langLabel = voiceLang ? VOICE_LANG_OPTIONS.find(o => o.value === voiceLang)?.label || voiceLang : '';
  const voiceLangPrompt = voiceLang ? `### 语音语种翻译

用户开启了语音语种功能，选择的语种是：${langLabel}（${voiceLang}）。

你的回复格式必须是：
1. 先用中文自然地写出你要说的话（给对方看的文字，中文舞台指示写在这里没关系）
2. 然后换行，在 <语音> 标签里写出这句话的${langLabel}翻译——这才是真正会被读出来的部分。可选地用 emotion 属性标整句情绪：\`<语音 emotion="happy">…</语音>\`（情绪只能取 happy/sad/angry/fearful/disgusted/surprised/calm/fluent）

示例：
啊，我知道了
<语音 emotion="happy">Ok, I get it (chuckle)</语音>

你说真的？那也太离谱了吧。
<语音 emotion="surprised">Wait... are you serious? That's insane.</语音>

要求：
- <语音> 里的翻译要自然口语化，不要机翻味，要符合你的角色性格
- <语音> 里只写会被朗读的文字；想要笑/叹气等真实语气，用官方英文标签 (laughs)/(sighs)/(chuckle) 等，**不要写中文（轻笑）**，也不要写中文舞台旁白
- 每条消息只有一个 <语音> 标签，emotion 属性可选；情绪不强就别加
- 中文部分和 <语音> 部分表达的意思要一致` : '';
  return [coreContext, timeContext, callPrompt, voiceLangPrompt].filter(Boolean).join('\n\n');
};
const CallApp: React.FC = () => {
  const { closeApp, openApp, characters, activeCharacterId, addToast, apiConfig, userProfile, customThemes, suspendCall, suspendedCall, clearSuspendedCall, updateCharacter } = useOS();

  const [viewMode, setViewMode] = useState<ViewMode>('role-select');
  const [selectedCharId, setSelectedCharId] = useState<string>(activeCharacterId || characters[0]?.id || '');
  const ROLES_PER_PAGE = 6;
  const [rolePage, setRolePage] = useState<number>(() => {
    const i = characters.findIndex(c => c.id === (activeCharacterId || characters[0]?.id));
    return i > 0 ? Math.floor(i / 6) : 0;
  });
  const [recordDetailId, setRecordDetailId] = useState<string>('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [bubbles, setBubbles] = useState<CallBubble[]>([]);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => `call-${Date.now()}`);
  const [draftInput, setDraftInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const sttSessionRef = useRef<SttSession | null>(null);
  const sttSupported = useMemo(() => isSttSupported(), []);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [traceId, setTraceId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showInputPanel, setShowInputPanel] = useState(true);
  const [editingBubble, setEditingBubble] = useState<CallBubble | null>(null);
  const [editingText, setEditingText] = useState('');
  const [rerollingBubbleId, setRerollingBubbleId] = useState<string | null>(null);
  const [showHangupConfirm, setShowHangupConfirm] = useState(false);
  const [deleteConfirmRecord, setDeleteConfirmRecord] = useState<CallRecord | null>(null);
  const [voiceLang, setVoiceLang] = useState('');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // All blob: URLs created this call session. Kept alive so 重播/下载 work on every
  // bubble; revoked together only when leaving/resetting the call (not per-turn).
  const sessionBlobUrlsRef = useRef<Set<string>>(new Set());
  const trackBlobUrl = (url?: string) => { if (url && url.startsWith('blob:')) sessionBlobUrlsRef.current.add(url); };
  const revokeSessionBlobs = () => {
    sessionBlobUrlsRef.current.forEach(u => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } });
    sessionBlobUrlsRef.current.clear();
  };
  const longPressTimerRef = useRef<number | null>(null);
  const callTouchStartPos = useRef({ x: 0, y: 0 });
  const selectedChar = useMemo(() => characters.find(c => c.id === selectedCharId) || null, [characters, selectedCharId]);
  const recordDetail = useMemo(() => callRecords.find(r => r.id === recordDetailId) || null, [callRecords, recordDetailId]);
  // 从角色聊天主题中提取强调色，用于通话界面的按钮和高亮
  const accentColor = useMemo(() => {
    const themeId = selectedChar?.bubbleStyle || 'default';
    const theme: ChatTheme | undefined = customThemes?.find((t: ChatTheme) => t.id === themeId) || PRESET_THEMES[themeId];
    const raw = (theme?.user?.backgroundColor || '#8b5cf6').trim();
    // 通话界面靠 accent 做发光/描边/光环——主题色太暗（如纯黑）会让这些全部"消失"，
    // 按键也没了漂亮的边。这里给最低亮度兜底：太暗就回落到亮紫，保证每个角色都有边。
    const m = /^#?([0-9a-f]{6})$/i.exec(raw) || /^#?([0-9a-f]{3})$/i.exec(raw);
    if (m) {
      let hex = m[1];
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 90) return '#a78bfa';
    }
    return raw;
  }, [selectedChar?.bubbleStyle, customThemes]);
  const callScrollableRef = useRef<HTMLDivElement | null>(null);
  // Restore this character's remembered translation language whenever the selection changes.
  useEffect(() => {
    setVoiceLang(selectedChar?.callVoiceLang || '');
  }, [selectedCharId]);
  const resolveVoiceId = () => selectedChar?.voiceProfile?.voiceId?.trim() || '';
  const resolveModel = () => selectedChar?.voiceProfile?.model?.trim() || 'speech-2.8-hd';
  const resolveGroupId = () => (apiConfig.minimaxGroupId || '').trim();
  const buildTtsExtras = () => {
    const vp = selectedChar?.voiceProfile;
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
      // Soft-clamp voice_modify to prevent extreme spikes during excited speech
      const sc = (v: number, limit: number) => {
        if (Math.abs(v) <= limit) return v;
        const sign = v > 0 ? 1 : -1;
        return sign * (limit + Math.log1p(Math.abs(v) - limit) * (limit * 0.15));
      };
      if (vp.voiceModify.pitch) vm.pitch = Math.round(sc(vp.voiceModify.pitch, 40));
      if (vp.voiceModify.intensity) vm.intensity = Math.round(sc(vp.voiceModify.intensity, 30));
      if (vp.voiceModify.timbre) vm.timbre = Math.round(sc(vp.voiceModify.timbre, 40));
      if (vp.voiceModify.sound_effects) vm.sound_effects = vp.voiceModify.sound_effects;
      if (Object.keys(vm).length) extras.voice_modify = vm;
    }
    return extras;
  };
  const resolveVoiceSettingFields = (emotionOverride?: string) => {
    const vp = selectedChar?.voiceProfile;
    // Per-utterance emotion from <语音 emotion="…"> wins over the static voiceProfile emotion.
    const emotion = (emotionOverride && VALID_EMOTIONS.has(emotionOverride)) ? emotionOverride : (vp?.emotion || '');
    return {
      // Clamp speed & pitch to safe human-like ranges
      speed: Math.max(0.75, Math.min(1.4, vp?.speed ?? 1)),
      vol: Math.max(0.3, Math.min(2, vp?.vol ?? 1)),
      pitch: Math.max(-8, Math.min(8, vp?.pitch ?? 0)),
      english_normalization: true,
      ...(emotion ? { emotion } : {}),
    };
  };
  // Resume from suspended call — restore bubbles & session state
  useEffect(() => {
    if (suspendedCall && viewMode === 'role-select') {
      setSelectedCharId(suspendedCall.charId);
      setCallStartedAt(suspendedCall.startedAt);
      if (suspendedCall.bubbles?.length) setBubbles(suspendedCall.bubbles);
      if (suspendedCall.sessionId) setCurrentSessionId(suspendedCall.sessionId);
      if (typeof suspendedCall.elapsedSeconds === 'number') setElapsedSeconds(suspendedCall.elapsedSeconds);
      if (suspendedCall.voiceLang) setVoiceLang(suspendedCall.voiceLang);
      setViewMode('in-call');
      setCallState('listening');
      clearSuspendedCall();
    }
  }, [suspendedCall]);
  useEffect(() => () => {
    revokeSessionBlobs();
    sttSessionRef.current?.stop();
  }, []);
  // Voice input: toggle speech-to-text into the draft input box.
  const toggleStt = async () => {
    if (isListening) { sttSessionRef.current?.stop(); return; }
    if (!sttSupported) { addToast('当前环境不支持语音输入', 'info'); return; }
    try {
      setIsListening(true);
      sttSessionRef.current = await startStt('zh-CN', {
        onPartial: (t) => setDraftInput(t),
        onFinal: (t) => setDraftInput(t),
        onError: (m) => { if (m) addToast(m, 'info'); },
        onEnd: () => { setIsListening(false); sttSessionRef.current = null; },
      });
    } catch (e: any) {
      setIsListening(false);
      sttSessionRef.current = null;
      addToast(e?.message || '无法启动语音输入', 'error');
    }
  };
  // 下载某条通话语音（优先把 blob/远端拉成文件下载，CORS 拉不到就开链接让用户自己存）
  const handleDownloadCallAudio = async (url?: string, ts?: number) => {
    if (!url) { addToast('这条还没有语音', 'error'); return; }
    try {
      const fname = `${(selectedChar?.name || '通话').replace(/[\\/:*?"<>|]/g, '_')}_语音_${ts || Date.now()}.mp3`;
      let blob: Blob | null = null;
      try { const r = await fetch(url); if (r.ok) blob = await r.blob(); } catch { /* CORS：走兜底 */ }
      const a = document.createElement('a');
      a.download = fname;
      if (blob) {
        const u = URL.createObjectURL(blob);
        a.href = u; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      } else {
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      }
      addToast('语音已开始下载', 'success');
    } catch {
      addToast('语音下载失败', 'error');
    }
  };
  useEffect(() => {
    if (!callStartedAt || ['idle', 'ended'].includes(callState)) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [callStartedAt, callState]);
  useEffect(() => {
    callScrollableRef.current?.scrollTo({ top: callScrollableRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles]);
  // 开场白：进入通话后角色自动先开口
  const greetingFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (viewMode !== 'in-call' || bubbles.length > 0) return;
    if (!selectedChar?.id || greetingFiredRef.current === currentSessionId) return;
    greetingFiredRef.current = currentSessionId;
    (async () => {
      try {
        setCallStartedAt(Date.now());
        setCallState('connecting');
        const rawGreeting = await requestAssistantReply('（电话刚接通。你先开口——像平时接到这个人电话一样自然地说第一句话。不要解释你在做什么，就是最自然的那个"喂"或者"诶"或者别的什么。）');
        const greetingLeadEmotion = extractLeadingEmotion(rawGreeting);
        const greetingText = sanitizeAssistantOutput(rawGreeting);
        const nowTs = Date.now();
        const greetingBubble: CallBubble = { id: `${nowTs}-greeting`, role: 'assistant', text: greetingText, time: formatTime(), timestamp: nowTs };
        setCallState('speaking');
        setBubbles([greetingBubble]);
        if (selectedChar?.id) {
          const dbId = await DB.saveMessage({ charId: selectedChar.id, role: 'assistant', type: 'text', content: greetingText, metadata: { source: 'call', callSessionId: currentSessionId } });
          setBubbles(prev => prev.map(b => b.id === greetingBubble.id ? { ...b, dbId: dbId } : b));
        }
        // 尝试语音合成开场白
        const minimaxApiKey = resolveMiniMaxApiKey(apiConfig);
        const voiceId = resolveVoiceId();
        const hasTimberWeights = (selectedChar?.voiceProfile?.timberWeights?.length || 0) > 1;
        let greetingAudioPlayed = false;
        if (isSpeakerOn && minimaxApiKey && (voiceId || hasTimberWeights)) {
          try {
            const groupId = resolveGroupId();
            const greetingEmotion = extractVoiceTag(greetingText).emotion || greetingLeadEmotion;
            const speechText = insertSpeechBreaks(cleanTextForTts(greetingText));
            const model = resolveModel();
            const ttsPayload: any = {
              model, text: speechText, stream: false, output_format: 'url',
              voice_setting: { voice_id: voiceId, ...resolveVoiceSettingFields(greetingEmotion) },
              audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
              ...(voiceLang ? { language_boost: voiceLang } : {}),
              ...buildTtsExtras(),
            };
            if (groupId) ttsPayload.group_id = groupId;
            const greetingCacheKey = ttsCacheKeyFromPayload(ttsPayload);
            const cachedGreeting = await getCachedTts(greetingCacheKey);
            let greetingAudioUrl = '';
            if (cachedGreeting) {
              greetingAudioUrl = URL.createObjectURL(cachedGreeting);
            } else {
              const response = await minimaxFetch('/api/minimax/t2a', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${minimaxApiKey}`, 'X-MiniMax-API-Key': minimaxApiKey, ...(groupId ? { 'X-MiniMax-Group-Id': groupId } : {}) },
                body: JSON.stringify(ttsPayload),
              });
              const data = await response.json();
              const rawAudio = data?.data?.audio;
              if (rawAudio && typeof rawAudio === 'string') {
                const normalizedAudio = rawAudio.trim();
                let greetingBlob: Blob | null = null;
                if (/^https?:\/\//i.test(normalizedAudio)) {
                  try { greetingBlob = await fetchRemoteAudioBlob(normalizedAudio); } catch { greetingAudioUrl = normalizedAudio; }
                } else {
                  greetingBlob = convertHexAudioToBlob(normalizedAudio, 'audio/mpeg');
                }
                if (greetingBlob) {
                  greetingAudioUrl = URL.createObjectURL(greetingBlob);
                  saveCachedTts(greetingCacheKey, greetingBlob).catch(() => { /* ignore */ });
                }
              }
            }
            if (greetingAudioUrl) {
              trackBlobUrl(greetingAudioUrl);
              setAudioUrl(greetingAudioUrl);
              setBubbles(prev => prev.map(b => b.id === greetingBubble.id ? { ...b, audioUrl: greetingAudioUrl } : b));
              setTimeout(() => playAudio(greetingAudioUrl), 0);
              greetingAudioPlayed = true;
            }
          } catch { /* 语音合成失败不影响文字开场白 */ }
        }
        // 有音频播放时由 audio onEnded 回调切换到 listening；无音频时延迟切换，让用户看到 speaking 状态
        if (!greetingAudioPlayed) {
          setTimeout(() => setCallState('listening'), 1500);
        }
      } catch (e: any) {
        setCallState('error');
        setErrorMessage(e?.message || '开场白生成失败');
      }
    })();
  }, [viewMode, currentSessionId]);
  const stopPlayback = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsAudioPlaying(false);
  };
  const loadCallRecords = async (charId?: string) => {
    if (!charId) return setCallRecords([]);
    // includeProcessed=true：通话消息与聊天消息同存一个 store，记忆宫殿处理后会推进
    // 高水位标记 mp_lastMsgId_<charId>，默认的 getMessagesByCharId 会过滤掉水位线之前的
    // 消息——这会导致继续聊天后通话记录被"清空"。这里必须读取全部消息。
    const all = await DB.getMessagesByCharId(charId, true);
    const callMsgs = all
      .filter(m => m.metadata?.source === 'call' && m.metadata?.callSessionId)
      .sort((a, b) => a.timestamp - b.timestamp);
    const grouped = new Map<string, Message[]>();
    callMsgs.forEach(m => {
      const sid = String(m.metadata?.callSessionId);
      const arr = grouped.get(sid) || [];
      arr.push(m);
      grouped.set(sid, arr);
    });
    const records: CallRecord[] = Array.from(grouped.entries()).map(([sessionId, msgs]) => {
      const start = msgs[0]?.timestamp || Date.now();
      const end = msgs[msgs.length - 1]?.timestamp || start;
      return {
        id: sessionId,
        sessionId,
        characterId: charId,
        characterName: selectedChar?.name || '未选择角色',
        createdAt: new Date(start).toLocaleString('zh-CN'),
        durationSec: Math.max(1, Math.floor((end - start) / 1000)),
        transcript: msgs.map(m => ({
          id: `db-${m.id}`,
          dbId: m.id,
          role: m.role as 'user' | 'assistant',
          text: m.content,
          audioUrl: m.metadata?.audioUrl,
          time: formatTimeByTs(m.timestamp),
          timestamp: m.timestamp,
        })),
      };
    }).sort((a, b) => (b.transcript[b.transcript.length - 1]?.timestamp || 0) - (a.transcript[a.transcript.length - 1]?.timestamp || 0));
    setCallRecords(records);
  };
  const resetCurrentCall = () => {
    revokeSessionBlobs();
    stopPlayback();
    setCallState('idle');
    setBubbles([]);
    setDraftInput('');
    setAudioUrl('');
    setTraceId('');
    setErrorMessage('');
    setCallStartedAt(null);
    setElapsedSeconds(0);
    setShowInputPanel(true);
    setCurrentSessionId(`call-${Date.now()}`);
  };
  const finishCall = async () => {
    if (selectedChar?.id) {
      const userTurns = bubbles.filter(b => b.role === 'user').length;
      const keepsakeLine = summarizeKeepsakeLine(bubbles, selectedChar.name);
      const payload = {
        characterId: selectedChar.id,
        characterName: selectedChar.name,
        characterAvatar: selectedChar.avatar,
        durationSec: elapsedSeconds,
        turnCount: userTurns,
        keepsakeLine,
        endedAt: Date.now(),
      };
      await DB.saveMessage({
        charId: selectedChar.id,
        role: 'system',
        type: 'system',
        content: `通话结束 · ${selectedChar.name}｜${formatDuration(elapsedSeconds)}｜${Math.max(1, userTurns)}轮对话`,
        metadata: { source: 'call-end-popup', callSessionId: currentSessionId, ...payload },
      });
      await loadCallRecords(selectedChar.id);
    }
    clearSuspendedCall();
    resetCurrentCall();
    setViewMode('history');
    setShowHangupConfirm(false);
    addToast('通话记录已保存', 'success');
  };
  const handleHangup = () => {
    setShowHangupConfirm(true);
  };
  const buildHistoryMessages = async (input: string, skipDbId?: number) => {
    if (!selectedChar?.id) return [{ role: 'user', content: input }];
    const limit = selectedChar.contextLimit || 500;
    const allMsgs = await DB.getRecentMessagesByCharId(selectedChar.id, limit);
    const filtered = allMsgs.filter(m => !(skipDbId && m.id === skipDbId));
    const history = filtered.map(m => {
      const source = m.metadata?.source === 'call' ? '（通话记录）' : m.metadata?.source === 'date' ? '（约会记录）' : '（聊天记录）';
      const content = m.type === 'image'
        ? '[用户发送了一张图片]'
        : m.type === 'emoji'
          ? '[发送了一个表情]'
          : m.content;
      return { role: m.role, content: `[${new Date(m.timestamp).toLocaleString('zh-CN')}] ${source} ${content}` };
    });
    const lastMsg = filtered[filtered.length - 1];
    const timeGapHint = ChatPrompts.getTimeGapHint(lastMsg, Date.now());
    const finalInput = timeGapHint ? `${input}\n\n${timeGapHint}` : input;
    return [...history, { role: 'user', content: finalInput }];
  };
  const requestAssistantReply = async (input: string, skipDbId?: number): Promise<string> => {
    const baseUrl = apiConfig.baseUrl?.replace(/\/+$/, '');
    if (!baseUrl) throw new Error('请先在设置里配置聊天 API URL');
    const userName = userProfile?.name?.trim() || '用户';
    if (selectedChar) {
      const callMsgs = await DB.getMessagesByCharId(selectedChar.id);
      await injectMemoryPalace(selectedChar, callMsgs);
    }
    const systemPrompt = selectedChar
      ? buildCallPrompt(userName, selectedChar.name, ContextBuilder.buildCoreContext(selectedChar, userProfile, true), voiceLang || undefined)
      : buildCallPrompt(userName, selectedChar?.name, undefined, voiceLang || undefined);
    const messages = await buildHistoryMessages(input, skipDbId);
    const chatData = await safeFetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}` },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.85,
        stream: false,
      }),
    }, 2, 0, { appName: '电话', charId: selectedChar?.id, charName: selectedChar?.name, purpose: '语音通话' });
    const assistantText = chatData?.choices?.[0]?.message?.content?.trim() || '';
    if (!assistantText) throw new Error('文本接口返回为空');
    return assistantText;
  };
  const playAudio = (url?: string) => {
    const targetUrl = url || audioUrl;
    if (!targetUrl || !audioRef.current) return;
    if (audioUrl !== targetUrl) setAudioUrl(targetUrl);
    audioRef.current.src = targetUrl;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => addToast('音频已生成，自动播放被浏览器拦截，请点击重播', 'info'));
    setCallState('speaking');
  };
  const resumeAudio = () => {
    if (!audioRef.current || !audioUrl) return;
    audioRef.current.play().catch(() => addToast('继续播放失败，请点击重播', 'error'));
  };
  const pauseAudio = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setCallState('listening');
  };
  const handleTurn = async () => {
    const minimaxApiKey = resolveMiniMaxApiKey(apiConfig);
    const voiceId = resolveVoiceId();
    if (isListening) { sttSessionRef.current?.stop(); setIsListening(false); }
    const input = draftInput.trim();
    if (!input) return addToast('说点什么吧', 'info');
    if (['connecting', 'thinking'].includes(callState)) return addToast(`${selectedChar?.name || '对方'}还在想，等一等`, 'info');
    if (isAudioPlaying) pauseAudio();
    const nowTs = Date.now();
    const now = formatTime();
    const userBubble: CallBubble = { id: `${nowTs}-u`, role: 'user', text: input, time: now, timestamp: nowTs };
    setBubbles(prev => [...prev, userBubble]);
    setDraftInput('');
    setShowInputPanel(false);
    let userDbId: number | undefined;
    if (selectedChar?.id) {
      userDbId = await DB.saveMessage({ charId: selectedChar.id, role: 'user', type: 'text', content: input, metadata: { source: 'call', callSessionId: currentSessionId } });
      setBubbles(prev => prev.map(b => (b.id === userBubble.id ? { ...b, dbId: userDbId } : b)));
    }
    if (!callStartedAt) setCallStartedAt(Date.now());
    setCallState('connecting');
    setTraceId('');
    setErrorMessage('');
    let assistantText = '';
    let turnLeadEmotion: string | undefined;
    try {
      setCallState('thinking');
      const rawReply = await requestAssistantReply(input, userDbId);
      turnLeadEmotion = extractLeadingEmotion(rawReply);
      assistantText = sanitizeAssistantOutput(rawReply);
    } catch (err: any) {
      setErrorMessage(err?.message || '文本回复失败');
      setCallState('error');
      return addToast(`文本回复失败：${err?.message || '未知错误'}`, 'error');
    }
    const assistantBubbleId = `${Date.now()}-a`;
    const assistantBubble: CallBubble = { id: assistantBubbleId, role: 'assistant', text: assistantText, time: now, timestamp: nowTs };
    setBubbles(prev => [...prev, assistantBubble]);
    let assistantDbId: number | undefined;
    if (selectedChar?.id) {
      assistantDbId = await DB.saveMessage({ charId: selectedChar.id, role: 'assistant', type: 'text', content: assistantText, metadata: { source: 'call', callSessionId: currentSessionId } });
      setBubbles(prev => prev.map(b => {
        if (b.id === assistantBubbleId) return { ...b, dbId: assistantDbId };
        return b;
      }));
    }
    const hasTimberWeights2 = (selectedChar?.voiceProfile?.timberWeights?.length || 0) > 1;
    if (!isSpeakerOn || !minimaxApiKey || (!voiceId && !hasTimberWeights2)) {
      setCallState('listening');
      if (isSpeakerOn && !voiceId && !hasTimberWeights2) addToast('语音未配置，先用文字聊吧', 'info');
      return;
    }
    try {
      const groupId = resolveGroupId();
      const turnEmotion = extractVoiceTag(assistantText).emotion || turnLeadEmotion;
      const speechText = insertSpeechBreaks(cleanTextForTts(assistantText));
      const model = resolveModel();
      if (!speechText.trim()) throw new Error('可朗读文本为空');

      const synthesizeChunk = async (chunk: string, idx = 0, total = 1): Promise<{ blob?: Blob; remoteUrl?: string; traceId: string }> => {
        const ttsPayload: any = {
          model,
          text: chunk,
          stream: false,
          output_format: 'url',
          voice_setting: { voice_id: voiceId, ...resolveVoiceSettingFields(turnEmotion) },
          audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
          ...(voiceLang ? { language_boost: voiceLang } : {}),
          ...buildTtsExtras(),
        };
        if (groupId) ttsPayload.group_id = groupId;

        const chunkCacheKey = ttsCacheKeyFromPayload(ttsPayload);
        const cachedChunk = await getCachedTts(chunkCacheKey);
        if (cachedChunk) {
          return { blob: cachedChunk, traceId: 'cache' };
        }

        const response = await minimaxFetch('/api/minimax/t2a', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${minimaxApiKey}`,
            'X-MiniMax-API-Key': minimaxApiKey,
            ...(groupId ? { 'X-MiniMax-Group-Id': groupId } : {}),
          },
          body: JSON.stringify(ttsPayload),
        });
        const data = await response.json();
        const statusCode = data?.base_resp?.status_code;
        if (!response.ok || (typeof statusCode === 'number' && statusCode !== 0)) {
          throw new Error(buildMiniMaxErrorMessage(data?.base_resp?.status_msg || `调用失败（HTTP ${response.status}）`, data?.trace_id));
        }

        const rawAudio = data?.data?.audio;
        if (!rawAudio || typeof rawAudio !== 'string') throw new Error('接口返回里没有音频数据');
        const normalizedAudio = rawAudio.trim();
        const traceId = data?.trace_id || '';
        console.log('[call] tts chunk response', {
          chunk_index: idx,
          chunk_count: total,
          chunk_length: chunk.length,
          trace_id: traceId,
          audio_type: typeof data?.data?.audio,
          audio_preview: normalizedAudio.slice(0, 80),
        });

        if (/^https?:\/\//i.test(normalizedAudio)) {
          try {
            const blob = await fetchRemoteAudioBlob(normalizedAudio);
            saveCachedTts(chunkCacheKey, blob).catch(() => { /* ignore */ });
            return { blob, traceId };
          } catch (downloadErr: any) {
            if (total === 1) {
              console.warn('[call] tts remote audio fetch failed, fallback to direct remote url', downloadErr?.message || downloadErr);
              return { remoteUrl: normalizedAudio, traceId };
            }
            throw downloadErr;
          }
        }
        const blob = convertHexAudioToBlob(normalizedAudio, 'audio/mpeg');
        saveCachedTts(chunkCacheKey, blob).catch(() => { /* ignore */ });
        return { blob, traceId };
      };

      const traceIds: string[] = [];
      const audioBlobs: Blob[] = [];
      let finalUrl = '';

      console.log('[call] tts request(full)', {
        model,
        voice_id: voiceId,
        group_id: groupId,
        assistant_text_length: assistantText.length,
        speech_text_length: speechText.length,
        speech_text_preview: speechText.slice(0, 120),
      });

      try {
        const singleResult = await synthesizeChunk(speechText, 0, 1);
        if (singleResult.traceId) traceIds.push(singleResult.traceId);
        if (singleResult.remoteUrl) {
          finalUrl = singleResult.remoteUrl;
        } else if (singleResult.blob) {
          finalUrl = URL.createObjectURL(singleResult.blob);
        } else {
          throw new Error('未获得可播放音频');
        }
      } catch (singleErr: any) {
        const textChunks = splitTextForTts(speechText, 120);
        if (!textChunks.length) throw singleErr;
        if (textChunks.length > 1) addToast('语音生成中，稍等一下', 'info');
        if (textChunks.length > 20) addToast('这段话比较长，多等一会儿', 'info');
        console.warn('[call] tts single-shot failed, fallback to chunk mode', singleErr?.message || singleErr);

        for (let idx = 0; idx < textChunks.length; idx += 1) {
          const result = await synthesizeChunk(textChunks[idx], idx, textChunks.length);
          if (result.traceId) traceIds.push(result.traceId);
          if (result.remoteUrl) {
            finalUrl = result.remoteUrl;
            break;
          }
          if (result.blob) audioBlobs.push(result.blob);
        }
        if (!finalUrl) {
          if (!audioBlobs.length) throw new Error('未获得可播放音频');
          finalUrl = URL.createObjectURL(audioBlobs.length === 1 ? audioBlobs[0] : new Blob(audioBlobs, { type: 'audio/mpeg' }));
        }
      }

      trackBlobUrl(finalUrl);
      setAudioUrl(finalUrl);
      setTimeout(() => playAudio(finalUrl), 0);
      setTraceId(traceIds.filter(Boolean).join(' | '));
      console.log('[call] tts response merged', {
        trace_ids: traceIds,
        playback_url_type: finalUrl.startsWith('blob:') ? 'blob' : 'remote',
      });
      setBubbles(prev => prev.map(b => (b.id === assistantBubbleId ? { ...b, audioUrl: finalUrl } : b)));
      if (assistantDbId) {
        const target = bubbles.find(b => b.id === assistantBubbleId);
        await DB.updateMessage(assistantDbId, target?.text || assistantText);
      }
      setCallState('listening');
    } catch (e: any) {
      setErrorMessage(e?.message || '语音生成失败');
      setCallState('error');
      addToast(`TTS失败：${e?.message || '语音生成失败'}，已保留文本回复`, 'error');
    }
  };
  const sendingBusy = ['connecting', 'thinking'].includes(callState);
  const displayCallState: CallState = isAudioPlaying ? 'speaking' : callState;
  const latestAssistantAudio = [...bubbles].reverse().find(b => b.role === 'assistant' && b.audioUrl)?.audioUrl;
  useEffect(() => {
    loadCallRecords(selectedCharId);
  }, [selectedCharId]);
  const handleDeleteRecord = async (record: CallRecord) => {
    setDeleteConfirmRecord(record);
  };

  const confirmDeleteRecord = async () => {
    const record = deleteConfirmRecord;
    if (!record) return;
    setDeleteConfirmRecord(null);
    // includeProcessed=true：同 loadCallRecords，否则水位线之前的通话消息删不掉
    const all = await DB.getMessagesByCharId(record.characterId, true);
    // 删除通话消息 + 聊天页的通话总结卡片
    const ids = all.filter(m => {
      if (m.metadata?.source === 'call' && m.metadata?.callSessionId === record.sessionId) return true;
      if (m.metadata?.source === 'call-end-popup' && m.metadata?.callSessionId === record.sessionId) return true;
      return false;
    }).map(m => m.id);
    if (ids.length) await DB.deleteMessages(ids);
    if (recordDetailId === record.id) {
      setRecordDetailId('');
      setViewMode('history');
    }
    await loadCallRecords(record.characterId);
    addToast('通话记录已删除', 'success');
  };
  const startEditBubble = (bubble: CallBubble) => {
    if (bubble.role !== 'user') return;
    setEditingBubble(bubble);
    setEditingText(bubble.text);
  };
  const saveEditedBubble = async () => {
    if (!editingBubble) return;
    const next = editingText.trim();
    if (!next) return addToast('内容不能为空', 'error');
    setBubbles(prev => prev.map(b => b.id === editingBubble.id ? { ...b, text: next } : b));
    if (editingBubble.dbId) await DB.updateMessage(editingBubble.dbId, next);
    setEditingBubble(null);
    setEditingText('');
    addToast('已更新发言', 'success');
  };
  const handleRerollAssistant = async (bubble: CallBubble) => {
    if (!selectedChar || bubble.role !== 'assistant') return;
    const idx = bubbles.findIndex(b => b.id === bubble.id);
    if (idx <= 0) return;
    const prevUser = bubbles[idx - 1];
    if (!prevUser || prevUser.role !== 'user') return;
    try {
      setRerollingBubbleId(bubble.id);
      setCallState('thinking');
      const rawReroll = await requestAssistantReply(prevUser.text, bubble.dbId);
      const rerollLeadEmotion = extractLeadingEmotion(rawReroll);
      const rerolled = sanitizeAssistantOutput(rawReroll);
      setBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, text: rerolled, audioUrl: undefined } : b));
      if (bubble.dbId) await DB.updateMessage(bubble.dbId, rerolled);
      addToast('台词已重 roll', 'success');

      // Synthesize voice for the rerolled text (same logic as handleTurn)
      const minimaxApiKey = resolveMiniMaxApiKey(apiConfig);
      const voiceId = resolveVoiceId();
      const hasTimberWeights = (selectedChar?.voiceProfile?.timberWeights?.length || 0) > 1;
      if (isSpeakerOn && minimaxApiKey && (voiceId || hasTimberWeights)) {
        try {
          setCallState('speaking');
          const groupId = resolveGroupId();
          const rerollEmotion = extractVoiceTag(rerolled).emotion || rerollLeadEmotion;
          const speechText = insertSpeechBreaks(cleanTextForTts(rerolled));
          if (speechText.trim()) {
            const model = resolveModel();
            const ttsPayload: any = {
              model, text: speechText, stream: false, output_format: 'url',
              voice_setting: { voice_id: voiceId, ...resolveVoiceSettingFields(rerollEmotion) },
              audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
              ...(voiceLang ? { language_boost: voiceLang } : {}),
              ...buildTtsExtras(),
            };
            if (groupId) ttsPayload.group_id = groupId;
            const rerollCacheKey = ttsCacheKeyFromPayload(ttsPayload);
            const cachedReroll = await getCachedTts(rerollCacheKey);
            let rerollAudioUrl = '';
            if (cachedReroll) {
              rerollAudioUrl = URL.createObjectURL(cachedReroll);
            } else {
              const response = await minimaxFetch('/api/minimax/t2a', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${minimaxApiKey}`,
                  'X-MiniMax-API-Key': minimaxApiKey,
                  ...(groupId ? { 'X-MiniMax-Group-Id': groupId } : {}),
                },
                body: JSON.stringify(ttsPayload),
              });
              const data = await response.json();
              const rawAudio = data?.data?.audio;
              if (rawAudio && typeof rawAudio === 'string') {
                const normalizedAudio = rawAudio.trim();
                let rerollBlob: Blob | null = null;
                if (/^https?:\/\//i.test(normalizedAudio)) {
                  try { rerollBlob = await fetchRemoteAudioBlob(normalizedAudio); } catch { rerollAudioUrl = normalizedAudio; }
                } else {
                  rerollBlob = convertHexAudioToBlob(normalizedAudio, 'audio/mpeg');
                }
                if (rerollBlob) {
                  rerollAudioUrl = URL.createObjectURL(rerollBlob);
                  saveCachedTts(rerollCacheKey, rerollBlob).catch(() => { /* ignore */ });
                }
              }
            }
            if (rerollAudioUrl) {
              trackBlobUrl(rerollAudioUrl);
              setAudioUrl(rerollAudioUrl);
              setBubbles(prev => prev.map(b => b.id === bubble.id ? { ...b, audioUrl: rerollAudioUrl } : b));
              setTimeout(() => playAudio(rerollAudioUrl), 0);
            }
          }
        } catch (ttsErr: any) {
          console.warn('[call] reroll TTS failed:', ttsErr?.message);
          addToast('语音合成失败，已保留文本', 'info');
        }
      }
      setCallState('listening');
    } catch (e: any) {
      setCallState('error');
      addToast(`重 roll 失败：${e?.message || '未知错误'}`, 'error');
    } finally {
      setRerollingBubbleId(null);
    }
  };
  if (viewMode === 'role-select') {
    const totalPages = Math.max(1, Math.ceil(characters.length / ROLES_PER_PAGE));
    const page = Math.min(rolePage, totalPages - 1);
    const pagedChars = characters.slice(page * ROLES_PER_PAGE, page * ROLES_PER_PAGE + ROLES_PER_PAGE);
    return (
      <div className="relative h-full w-full bg-gradient-to-b from-[#140d28] via-[#0a0613] to-[#05030c] text-white flex flex-col overflow-hidden">
        {/* floating sparkles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {CALL_SPARKLES.map((p, i) => (
            <span key={i} className="absolute rounded-full bg-white animate-pulse"
              style={{ top: p.top, left: p.left, width: p.s, height: p.s, opacity: 0.5, animationDelay: `${i * 0.4}s`, boxShadow: `0 0 6px ${accentColor}` }} />
          ))}
        </div>
        {/* top-right character art bleed */}
        {selectedChar?.avatar && (
          <div className="absolute top-0 right-0 w-48 h-60 pointer-events-none"
            style={{ WebkitMaskImage: 'radial-gradient(135% 105% at 100% 0%, #000 32%, transparent 72%)', maskImage: 'radial-gradient(135% 105% at 100% 0%, #000 32%, transparent 72%)' }}>
            <img src={selectedChar.avatar} alt="" className="w-full h-full object-cover object-top opacity-60" />
          </div>
        )}

        <div className="relative z-10 flex flex-col h-full px-5 pt-10 pb-5">
          {/* header */}
          <div className="shrink-0">
            <div className="text-[10px] tracking-[0.42em] text-white/35 font-semibold">CHAT WITH</div>
            <h1 className="mt-1 text-[2rem] font-bold leading-tight inline-flex items-start gap-1.5">
              想找谁聊聊？
              <span className="text-sm mt-1" style={{ color: accentColor, textShadow: `0 0 10px ${accentColor}` }}>✦</span>
            </h1>
            <p className="text-sm text-white/45 mt-1">选一个人，拨过去吧。</p>
          </div>

          {/* character cards (6 / page) */}
          <div className="mt-5 flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-2.5">
            {pagedChars.map(char => {
              const selected = selectedCharId === char.id;
              return (
                <button key={char.id} onClick={() => setSelectedCharId(char.id)}
                  className="relative w-full rounded-3xl px-4 py-3.5 text-left border backdrop-blur-md transition active:scale-[0.99]"
                  style={selected
                    ? { borderColor: accentColor, background: `${accentColor}22`, boxShadow: `0 0 18px ${accentColor}55, inset 0 0 18px ${accentColor}1f` }
                    : { borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-full overflow-hidden border flex items-center justify-center font-semibold shrink-0"
                      style={{ borderColor: selected ? accentColor : 'rgba(255,255,255,0.25)', backgroundColor: `${accentColor}40` }}>
                      {char.avatar ? <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" /> : (char.name?.[0] || '角')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[15px] truncate" style={selected ? { color: accentColor } : undefined}>{char.name}</div>
                      <div className="text-xs text-white/45 mt-0.5 truncate">{char.description || '点击编辑设定...'}</div>
                    </div>
                    <span className="text-base shrink-0" style={{ color: selected ? accentColor : 'rgba(255,255,255,0.25)' }}>✦</span>
                  </div>
                </button>
              );
            })}
            {!characters.length && (
              <div className="text-center py-10 text-white/40 text-sm">还没有角色，先去创建一个吧</div>
            )}
          </div>

          {/* pagination */}
          {totalPages > 1 && (
            <div className="shrink-0 flex items-center justify-center gap-3 pt-3">
              <button disabled={page === 0} onClick={() => setRolePage(p => Math.max(0, p - 1))}
                className="w-7 h-7 rounded-full border border-white/15 bg-white/[0.04] flex items-center justify-center text-white/70 disabled:opacity-25 active:scale-90 transition">
                <CaretLeft size={14} weight="bold" />
              </button>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} onClick={() => setRolePage(i)} aria-label={`第${i + 1}页`}
                    className="rounded-full transition-all" style={{ width: i === page ? 16 : 6, height: 6, background: i === page ? accentColor : 'rgba(255,255,255,0.25)' }} />
                ))}
              </div>
              <button disabled={page >= totalPages - 1} onClick={() => setRolePage(p => Math.min(totalPages - 1, p + 1))}
                className="w-7 h-7 rounded-full border border-white/15 bg-white/[0.04] flex items-center justify-center text-white/70 disabled:opacity-25 active:scale-90 transition">
                <CaretRight size={14} weight="bold" />
              </button>
            </div>
          )}

          {/* actions */}
          <div className="shrink-0 pt-4 space-y-2.5">
            <button onClick={() => { resetCurrentCall(); setViewMode('in-call'); }}
              className="relative w-full py-3.5 rounded-2xl overflow-hidden transition active:scale-[0.98]"
              style={{ background: `linear-gradient(to right, ${accentColor}26, ${accentColor}4d, ${accentColor}26)`, border: `1px solid ${accentColor}80`, boxShadow: `0 0 22px ${accentColor}40` }}>
              <span className="absolute inset-[3px] rounded-xl border border-white/10 pointer-events-none" />
              <span className="absolute left-5 top-1/2 -translate-y-1/2 text-xs" style={{ color: accentColor }}>✦</span>
              <span className="absolute right-5 top-1/2 -translate-y-1/2 text-xs text-white/60">✦</span>
              <span className="relative text-white/90 text-[15px]">
                {selectedChar ? <>拨给 <span className="font-serif italic text-xl align-baseline" style={{ textShadow: `0 0 12px ${accentColor}` }}>{selectedChar.name}</span></> : '开始通话'}
              </span>
            </button>
            <button onClick={() => setViewMode('history')}
              className="relative w-full py-3 rounded-2xl border border-white/15 bg-white/[0.04] backdrop-blur-md text-white/80 flex items-center justify-center gap-2 transition active:scale-[0.98] hover:bg-white/[0.08]">
              <Clock size={16} weight="bold" style={{ color: accentColor }} /> 通话记录
            </button>
            <div className="flex items-center justify-between pt-1">
              <button onClick={() => openApp(AppID.Settings)} title="设置"
                className="w-9 h-9 rounded-full border border-white/15 bg-white/[0.04] flex items-center justify-center text-white/60 active:scale-90 transition">
                <Gear size={16} weight="fill" />
              </button>
              <button onClick={closeApp} className="flex items-center gap-2 text-sm text-white/45 active:scale-95 transition">
                <span style={{ color: accentColor }}>✦</span> 关闭 <span style={{ color: accentColor }}>✦</span>
              </button>
              <div className="w-9 h-9" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (viewMode === 'history') {
    return (
      <div className="h-full w-full bg-gradient-to-b from-[#140d28] via-[#0a0613] to-[#0a0613] text-white px-5 pt-10 pb-6 flex flex-col">
        <div className="flex items-center justify-between">
          <button onClick={() => setViewMode('role-select')} className="text-sm text-white/45">← 返回</button>
          <h1 className="text-lg font-medium">通话记录</h1>
          <button onClick={() => setViewMode('role-select')} className="text-sm font-medium" style={{ color: accentColor }}>新通话</button>
        </div>
        <div className="mt-4 flex-1 overflow-y-auto space-y-3">
          {!callRecords.length && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <p className="text-base text-white/45">还没有通话记录</p>
              <p className="text-sm text-white/35 mt-1">每一通电话都会留在这里</p>
            </div>
          )}
          {callRecords.map(record => {
            const turnCount = record.transcript.filter(t => t.role === 'user').length;
            const keepsake = summarizeKeepsakeLine(record.transcript, record.characterName);
            return (
            <button key={record.id} onClick={() => { setRecordDetailId(record.id); setViewMode('record-detail'); }} className="w-full rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4 text-left transition hover:bg-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center text-sm" style={{ backgroundColor: `${accentColor}35` }}>{record.characterName[0] || '角'}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{record.characterName}</div>
                  <div className="text-xs text-white/45 mt-0.5">{formatDuration(record.durationSec)} · {turnCount}轮对话</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteRecord(record); }} className="text-xs px-2 py-1 rounded-lg text-white/35 transition hover:text-rose-300">删除</button>
              </div>
              <div className="text-xs text-white/60 mt-2.5 italic leading-relaxed line-clamp-2">{keepsake}</div>
              <div className="text-[10px] text-white/30 mt-1.5">{record.createdAt}</div>
            </button>
          );})}
        </div>

        {/* Delete confirm overlay */}
        {deleteConfirmRecord && (
          <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-6">
            <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-gradient-to-b from-[#1a1130] to-[#0a0613] p-5 shadow-2xl">
              <div className="text-base font-semibold text-white">删除通话记录？</div>
              <p className="mt-2 text-sm text-white/55 leading-relaxed">和 {deleteConfirmRecord.characterName} 的这通通话将被永久删除。</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button onClick={() => setDeleteConfirmRecord(null)} className="py-2.5 rounded-2xl border border-white/20 text-white/80 transition active:scale-[0.97]">取消</button>
                <button onClick={confirmDeleteRecord} className="py-2.5 rounded-2xl bg-rose-500/80 text-white font-semibold transition active:scale-[0.97]">删除</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  if (viewMode === 'record-detail' && recordDetail) {
    return (
      <div className="h-full w-full bg-gradient-to-b from-[#140d28] via-[#0a0613] to-[#0a0613] text-white px-5 pt-10 pb-6 flex flex-col">
        <div className="flex items-center justify-between">
          <button onClick={() => setViewMode('history')} className="text-sm text-white/45">← 返回</button>
          <div className="text-sm text-white/80 font-medium">{recordDetail.characterName}</div>
          <div className="text-xs text-white/35">{formatDuration(recordDetail.durationSec)}</div>
        </div>
        <div className="mt-2 text-center">
          <p className="text-xs text-white/35 italic">{recordDetail.createdAt}</p>
        </div>
        <div className="mt-4 flex-1 overflow-y-auto space-y-2.5">
          {recordDetail.transcript.map(item => (
            <div key={item.id} className={`rounded-2xl px-3.5 py-2.5 border border-white/10 backdrop-blur-md ${item.role === 'user' ? 'bg-white/[0.07] ml-6' : 'bg-white/[0.03] mr-6'}`}>
              <div className="text-[10px] text-white/45">{item.role === 'user' ? '你' : recordDetail.characterName} · {item.time}</div>
              <div className="text-sm mt-1 leading-relaxed">{(() => {
                if (item.role !== 'assistant') return item.text;
                const { display, voiceText } = extractVoiceTag(item.text);
                return <>{renderAssistantLine(display, accentColor)}{voiceText && <div className="mt-1 text-[10px] text-white/40 italic">{voiceText}</div>}</>;
              })()}</div>
              {!!item.audioUrl && <button onClick={() => playAudio(item.audioUrl)} className="mt-2 text-xs px-2.5 py-1 rounded-full bg-white/8 border border-white/15 text-white/60 transition hover:bg-white/15">重播语音</button>}
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            setSelectedCharId(recordDetail.characterId || selectedCharId);
            resetCurrentCall();
            setViewMode('in-call');
          }}
          className="w-full py-3 rounded-2xl mt-4 font-medium text-white transition active:scale-[0.98]"
          style={{ backgroundColor: accentColor }}
        >再打一通</button>
      </div>
    );
  }
  const waveActive = displayCallState === 'speaking' || displayCallState === 'thinking';
  const connSub = callState === 'connecting' ? '正在建立加密通讯…'
    : callState === 'error' ? '通讯出现波动'
    : '通讯连接稳定';
  const analyzeLabel = displayCallState === 'speaking' ? { cn: '说话中', en: 'SPEAKING' }
    : displayCallState === 'thinking' ? { cn: '思考中', en: 'VOICE ANALYZING' }
    : displayCallState === 'connecting' ? { cn: '接通中', en: 'CONNECTING' }
    : displayCallState === 'error' ? { cn: '连接异常', en: 'SIGNAL ERROR' }
    : { cn: '聆听中', en: 'LISTENING' };
  return (
    <div className="h-full w-full relative bg-[#0a0613] text-white flex flex-col overflow-hidden">
      {/* blurred character art */}
      <div
        className="absolute inset-0 bg-cover bg-center scale-125 blur-3xl opacity-30"
        style={{ backgroundImage: selectedChar?.avatar ? `url(${selectedChar.avatar})` : undefined }}
      />
      {/* accent aura glows */}
      <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[130%] h-72 rounded-full blur-3xl opacity-40 pointer-events-none"
        style={{ background: `radial-gradient(closest-side, ${accentColor}, transparent)` }} />
      <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-[150%] h-80 rounded-full blur-3xl opacity-25 pointer-events-none"
        style={{ background: `radial-gradient(closest-side, ${accentColor}, transparent)` }} />
      {/* vignette */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-[#0a0613]/75 to-black/90 pointer-events-none" />
      {/* floating sparkles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {CALL_SPARKLES.map((p, i) => (
          <span key={i} className="absolute rounded-full bg-white animate-pulse"
            style={{ top: p.top, left: p.left, width: p.s, height: p.s, opacity: 0.5, animationDelay: `${i * 0.4}s`, boxShadow: `0 0 6px ${accentColor}` }} />
        ))}
      </div>
      <div className="relative z-10 flex flex-col h-full">
      {/* top channel bar */}
      <div className="relative px-5 pt-9">
        <div className="absolute top-9 left-5 leading-tight">
          <div className="text-[9px] tracking-[0.28em] text-white/45 font-semibold">PRIVATE CHANNEL</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[8px] tracking-[0.22em] text-white/35">
            VOICE SYNC
            <span className="flex items-center gap-[2px] h-2">
              {CALL_WAVE.slice(0, 7).map((h, i) => (
                <span key={i} className="w-[2px] rounded-full bg-white/40" style={{ height: `${waveActive ? Math.max(2, h / 4) : 2}px` }} />
              ))}
            </span>
          </div>
        </div>
        <div className="absolute top-9 right-5 flex items-center gap-1 text-[9px] tracking-[0.2em] text-white/45 font-medium">
          信号良好
          <span className="flex items-end gap-[2px] h-2.5 ml-0.5">
            {[4, 6, 8, 10].map((h, i) => (
              <span key={i} className="w-[2px] rounded-full" style={{ height: `${h}px`, background: i < 3 ? 'rgba(255,255,255,.65)' : accentColor }} />
            ))}
          </span>
          <span style={{ color: accentColor }}>✦</span>
        </div>
        {/* name block */}
        <div className="pt-7 text-center">
          <div className="text-sm" style={{ color: `${accentColor}cc`, textShadow: `0 0 12px ${accentColor}` }}>❀</div>
          <h1 className="mt-0.5 font-serif text-[2.6rem] leading-none tracking-wide text-white" style={{ textShadow: `0 0 26px ${accentColor}aa, 0 0 6px ${accentColor}66` }}>{selectedChar?.name || '未选择'}</h1>
          <div className="mt-2.5 text-[11px] tracking-[0.25em] text-white/55">{connSub}</div>
          <div className="mt-1.5 text-lg tabular-nums font-extralight tracking-[0.2em]" style={{ color: accentColor }}>{formatDuration(elapsedSeconds)}</div>
        </div>
      </div>
      {/* portrait + aura */}
      <div className="pt-3 pb-1 flex flex-col items-center justify-center">
        <div className="relative w-40 h-40">
          <div className={`absolute -inset-3 rounded-full blur-xl ${waveActive ? 'animate-pulse' : ''}`} style={{ background: `radial-gradient(closest-side, ${accentColor}, transparent)`, opacity: waveActive ? 0.8 : 0.4 }} />
          <div className="absolute -inset-1 rounded-full" style={{ boxShadow: `0 0 0 1px ${accentColor}55, inset 0 0 24px ${accentColor}33` }} />
          <div className={`absolute inset-0 rounded-full border ${displayCallState === 'speaking' ? 'animate-ping' : 'opacity-40'}`} style={{ borderColor: `${accentColor}66` }} />
          {selectedChar?.avatar
            ? <img src={selectedChar.avatar} alt={selectedChar.name} className="relative z-10 w-full h-full rounded-full object-cover" style={{ boxShadow: `0 0 30px ${accentColor}55` }} />
            : <div className="relative z-10 w-full h-full rounded-full flex items-center justify-center text-4xl font-serif" style={{ backgroundColor: `${accentColor}55` }}>{selectedChar?.name?.[0] || '角'}</div>}
        </div>
        {/* analyzing status + waveform */}
        <div className="mt-5 flex flex-col items-center gap-2">
          <div className="text-center leading-tight">
            <div className="text-sm text-white/85">{analyzeLabel.cn}{waveActive ? '…' : ''}</div>
            <div className="text-[9px] tracking-[0.3em] text-white/35 mt-0.5">{analyzeLabel.en}</div>
          </div>
          <div className="flex items-center justify-center gap-[3px] h-7">
            {CALL_WAVE.map((h, i) => (
              <span key={i} className={`w-[3px] rounded-full transition-all duration-300 ${waveActive ? 'animate-pulse' : ''}`}
                style={{ height: `${waveActive ? h : 3}px`, background: `linear-gradient(to top, ${accentColor}33, ${accentColor})`, animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        </div>
      </div>
      <div ref={callScrollableRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar mx-4 mb-2 px-4 py-3 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md" style={{ boxShadow: `inset 0 1px 0 ${accentColor}33` }}>
        {!bubbles.length && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <p className="text-base text-white/85">电话已接通</p>
            <p className="text-sm text-white/55 mt-2">
              {callState === 'connecting'
                ? `${selectedChar?.name || '对方'}正在接听……`
                : selectedChar?.name ? `${selectedChar.name}在等你开口……` : '对方在等你开口……'}
            </p>
            {callState === 'connecting'
              ? <p className="text-xs text-white/35 mt-4 animate-pulse">请稍等</p>
              : <p className="text-xs text-white/35 mt-4">在下方输入你想说的话</p>}
          </div>
        )}
        {bubbles.map((bubble, index) => {
          const fromBottom = bubbles.length - 1 - index;
          const isLatest = fromBottom === 0;
          const line = bubble.text.trim();
          const opacity = Math.max(0.35, 1 - fromBottom * 0.16);
          const sizeClass = isLatest ? 'text-[15px]' : fromBottom === 1 ? 'text-sm' : 'text-xs';
          return (
          <div
            key={bubble.id}
            onContextMenu={(e) => {
              e.preventDefault();
              startEditBubble(bubble);
            }}
            onTouchStart={(e) => {
              if (bubble.role !== 'user') return;
              callTouchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              longPressTimerRef.current = window.setTimeout(() => startEditBubble(bubble), 450);
            }}
            onTouchMove={(e) => {
              if (!longPressTimerRef.current) return;
              const dx = Math.abs(e.touches[0].clientX - callTouchStartPos.current.x);
              const dy = Math.abs(e.touches[0].clientY - callTouchStartPos.current.y);
              if (dx > 10 || dy > 10) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }}
            onTouchEnd={() => {
              if (longPressTimerRef.current) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
            }}
            style={{ opacity }}
            className={`px-1 py-1 ${bubble.role === 'user' ? 'text-right' : ''}`}
          >
            <div className={`text-[10px] text-white/45 mb-1 flex items-center gap-1 ${bubble.role === 'user' ? 'justify-end' : ''}`}>
              {bubble.role !== 'user' && <span className="text-[8px]" style={{ color: accentColor }}>◍</span>}
              <span style={bubble.role !== 'user' ? { color: `${accentColor}dd` } : undefined}>{bubble.role === 'user' ? '你' : selectedChar?.name}</span>
              <span>· {bubble.time}</span>
            </div>
            <div className={`${sizeClass} whitespace-pre-wrap leading-relaxed ${bubble.role === 'user' ? 'inline-block text-left text-white/90 bg-white/[0.06] border border-white/10 rounded-2xl rounded-tr-sm px-3 py-1.5' : 'text-white/95'}`}>
              {bubble.role === 'assistant' ? (() => {
                const { display, voiceText } = extractVoiceTag(line || bubble.text);
                return <>
                  {renderAssistantLine(display, accentColor)}
                  {voiceText && <div className="mt-1 text-[11px] text-white/45 italic">{voiceText}</div>}
                </>;
              })() : (line || bubble.text)}
            </div>
            {bubble.role === 'assistant' && (bubble.audioUrl || isLatest) && (
              <div className="mt-2 flex gap-2 flex-wrap">
                {bubble.audioUrl && <button onClick={() => playAudio(bubble.audioUrl)} className="text-xs px-2.5 py-1 rounded-full bg-white/8 border border-white/15 text-white/70 transition hover:bg-white/15">重播语音</button>}
                {bubble.audioUrl && <button onClick={() => handleDownloadCallAudio(bubble.audioUrl, bubble.timestamp)} className="text-xs px-2.5 py-1 rounded-full bg-white/8 border border-white/15 text-white/70 transition hover:bg-white/15">下载</button>}
                {isLatest && <button onClick={() => handleRerollAssistant(bubble)} disabled={!!rerollingBubbleId} className="text-xs px-2.5 py-1 rounded-full bg-white/8 border border-white/15 text-white/70 transition hover:bg-white/15 disabled:opacity-40">{rerollingBubbleId === bubble.id ? '换一种说法…' : '换个说法'}</button>}
              </div>
            )}
          </div>
        )})}
        {errorMessage && <div className="text-xs text-rose-300/80 px-1">{errorMessage}</div>}
      </div>
      {showInputPanel && (
        <div className="px-4 pb-2">
          <div className="rounded-2xl border border-white/12 bg-black/30 backdrop-blur-md p-2 flex gap-2 items-center" style={{ boxShadow: `inset 0 0 20px ${accentColor}1f` }}>
            {sttSupported && (
              <button
                onClick={toggleStt}
                disabled={sendingBusy}
                title={isListening ? '结束语音输入' : '按一下开始说话'}
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition active:scale-90 disabled:opacity-40"
                style={isListening ? { background: '#f0569f', boxShadow: '0 0 14px #f0569f99' } : { background: 'rgba(255,255,255,0.08)' }}
              >
                <Microphone size={18} weight="fill" className={isListening ? 'text-white animate-pulse' : 'text-white/70'} />
              </button>
            )}
            <input
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              className="flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-white/35"
              placeholder={isListening ? '在听你说……' : sendingBusy ? `${selectedChar?.name || '对方'}正在想……` : `想对${selectedChar?.name || '对方'}说什么？`}
              autoFocus
            />
            <button onClick={handleTurn} disabled={sendingBusy} className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40 transition active:scale-95" style={{ backgroundColor: accentColor, boxShadow: `0 0 16px ${accentColor}66` }}>{sendingBusy ? '…' : '说'}</button>
          </div>
          {isListening && <div className="text-[10px] text-white/40 mt-1 px-1 animate-pulse">正在聆听，点麦克风结束</div>}
        </div>
      )}
      <div className="px-7 pb-7 pt-1.5">
        <div className="flex items-start justify-between">
          {/* mic */}
          <button onClick={() => setShowInputPanel(prev => !prev)} className="flex flex-col items-center gap-1.5 transition active:scale-95">
            <span className="w-14 h-14 rounded-full border flex items-center justify-center backdrop-blur-md transition"
              style={showInputPanel ? { background: `${accentColor}33`, borderColor: `${accentColor}88`, boxShadow: `0 0 18px ${accentColor}55` } : { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' }}>
              <Microphone size={22} weight="fill" className="text-white/90" />
            </span>
            <span className="text-[10px] text-white/70">麦克风</span>
            <span className="text-[8px] tracking-[0.15em]" style={{ color: showInputPanel ? accentColor : 'rgba(255,255,255,0.3)' }}>{showInputPanel ? 'ON' : 'OFF'}</span>
          </button>
          {/* translate */}
          <button onClick={() => setShowLangPicker(prev => !prev)} title="语音语种" className="flex flex-col items-center gap-1.5 transition active:scale-95">
            <span className="w-14 h-14 rounded-full border flex items-center justify-center backdrop-blur-md transition"
              style={voiceLang ? { background: `${accentColor}33`, borderColor: `${accentColor}88`, boxShadow: `0 0 18px ${accentColor}55` } : { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' }}>
              <Translate size={22} weight="fill" className="text-white/90" />
            </span>
            <span className="text-[10px] text-white/70">翻译</span>
            <span className="text-[8px] tracking-[0.15em]" style={{ color: voiceLang ? accentColor : 'rgba(255,255,255,0.3)' }}>{voiceLang ? 'ON' : 'OFF'}</span>
          </button>
          {/* end call */}
          <button onClick={handleHangup} className="flex flex-col items-center gap-1.5 transition active:scale-95">
            <span className="w-14 h-14 rounded-full border flex items-center justify-center backdrop-blur-md transition hover:bg-rose-500/20"
              style={{ background: 'rgba(244,63,94,0.12)', borderColor: 'rgba(251,113,133,0.4)' }}>
              <PhoneDisconnect size={22} weight="fill" className="text-rose-300/90" />
            </span>
            <span className="text-[10px] text-white/70">结束通话</span>
          </button>
          {/* speaker */}
          <button
            onClick={() => {
              const next = !isSpeakerOn;
              setIsSpeakerOn(next);
              if (!next && isAudioPlaying) pauseAudio();
            }}
            title={isSpeakerOn ? '外放开启' : '外放关闭'}
            className="flex flex-col items-center gap-1.5 transition active:scale-95"
          >
            <span className="w-14 h-14 rounded-full border flex items-center justify-center backdrop-blur-md transition"
              style={isSpeakerOn ? { background: `${accentColor}33`, borderColor: `${accentColor}88`, boxShadow: `0 0 18px ${accentColor}55` } : { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' }}>
              {isSpeakerOn
                ? <SpeakerHigh size={22} weight="fill" className="text-white/90" />
                : <SpeakerSlash size={22} weight="fill" className="text-white/50" />}
            </span>
            <span className="text-[10px] text-white/70">外放</span>
            <span className="text-[8px] tracking-[0.15em]" style={{ color: isSpeakerOn ? accentColor : 'rgba(255,255,255,0.3)' }}>{isSpeakerOn ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={audioUrl}
        muted={!isSpeakerOn}
        onPlay={() => { setIsAudioPlaying(true); setCallState('speaking'); }}
        onPause={() => { setIsAudioPlaying(false); if (callState === 'speaking') setCallState('listening'); }}
        onEnded={() => { setIsAudioPlaying(false); if (callState === 'speaking') setCallState('listening'); }}
      />
      {showLangPicker && (
        <div className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end" onClick={() => setShowLangPicker(false)}>
          <div className="w-full bg-[#120c22] border-t border-white/10 rounded-t-3xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="text-sm text-white/80 font-medium">语音语种</div>
            <p className="text-xs text-white/40">选择后，角色会用中文回复，语音则用对应语种朗读</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {VOICE_LANG_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => { setVoiceLang(opt.value); if (selectedChar) updateCharacter(selectedChar.id, { callVoiceLang: opt.value }); setShowLangPicker(false); }}
                  className="text-xs px-3 py-2 rounded-full font-medium transition-colors text-white"
                  style={voiceLang === opt.value ? { backgroundColor: accentColor } : { background: 'rgba(255,255,255,0.1)' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {showHangupConfirm && (
        <div className="absolute inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-gradient-to-b from-[#1a1130] to-[#0a0613] p-5 shadow-2xl">
            <div className="text-lg font-semibold text-white">要挂了吗？</div>
            <p className="mt-2 text-sm text-white/65 leading-relaxed">和{selectedChar?.name || '对方'}聊了 {formatDuration(elapsedSeconds)}，这通电话会好好保存下来。</p>
            <div className="mt-5 space-y-2">
              <button onClick={() => {
                setShowHangupConfirm(false);
                if (selectedChar) {
                  suspendCall({ charId: selectedChar.id, charName: selectedChar.name, charAvatar: selectedChar.avatar, startedAt: callStartedAt || Date.now(), bubbles, sessionId: currentSessionId, elapsedSeconds, voiceLang });
                  addToast('通话已挂起，点击顶部绿色条可随时回来', 'success');
                }
              }} className="w-full py-2.5 rounded-2xl bg-emerald-500/80 text-white font-semibold transition active:scale-[0.97] flex items-center justify-center gap-2">
                <span>先忙别的</span><span className="text-xs opacity-70">（挂起通话）</span>
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setShowHangupConfirm(false)} className="py-2.5 rounded-2xl border border-white/20 text-white/80 transition active:scale-[0.97]">再聊会儿</button>
                <button onClick={finishCall} className="py-2.5 rounded-2xl bg-rose-500/20 border border-rose-300/40 text-rose-200 font-semibold transition active:scale-[0.97]">挂了吧</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editingBubble && (
        <div className="absolute inset-0 bg-black/60 flex items-end z-50">
          <div className="w-full bg-[#120c22] border-t border-white/10 p-5 space-y-3">
            <div className="text-sm text-white/70">改一下刚才说的话</div>
            <textarea value={editingText} onChange={(e) => setEditingText(e.target.value)} className="w-full h-24 bg-black/30 rounded-xl p-3 text-sm outline-none resize-none placeholder:text-white/30" placeholder="重新措辞……" autoFocus />
            <div className="flex gap-2">
              <button onClick={() => setEditingBubble(null)} className="flex-1 py-2.5 rounded-xl border border-white/15 text-white/70 transition active:scale-[0.97]">算了</button>
              <button onClick={saveEditedBubble} className="flex-1 py-2.5 rounded-xl font-medium text-white transition active:scale-[0.97]" style={{ backgroundColor: accentColor }}>就这样</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
export default CallApp;
