/**
 * 聊天请求载荷统一构造器
 *
 * 设计目标：让"正常聊天"、"主动消息"、"emotion 副 API 评估"三条路径吃到的
 * 上下文材料完全一致——区别只在末尾各自追加的"现在你要做什么"指令。
 *
 * 三条路径过去各拼一遍 system prompt + 消息历史，导致主动消息缺音乐共听 /
 * HTML 模式 / 双语模式 / 麦当劳小程序等块；emotion eval 也容易跟主路径分叉。
 * 现在统一从这里走，避免再分叉。
 *
 * 顺序严格对齐 useChatAI.ts 的现有实现（line 629–793），保证现有行为字节级
 * 等价。新增 caller（runProactive）只是补齐了过去缺的字段。
 */

import type { CharacterProfile, UserProfile, GroupProfile, Emoji, EmojiCategory, Message, RealtimeConfig, TranslationConfig } from '../types';
import { ChatPrompts } from './chatPrompts';
import { injectMemoryPalace } from './memoryPalace/pipeline';
import { buildHtmlPrompt } from './htmlPrompt';
import { buildThinkingChainPrompt } from './thinkingChainPrompt';
import { buildMcdMiniAppContextBlock } from './mcdToolBridge';
import type { McdMiniAppSnapshot } from './mcdToolBridge';
import type { MusicCfg, Song, LyricLine, MusicPlaybackSnapshot } from '../context/MusicContext';

export interface UserListeningContext {
    songName: string;
    artists: string;
    lyricWindow: string[];
    activeIdx: number;
}

export interface BuildChatPayloadInput {
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    emojis: Emoji[];
    categories: EmojiCategory[];
    /** 给 buildMessageHistory 用的完整历史（≤ contextLimit） */
    historyMsgs: Message[];
    /**
     * 给 buildSystemPrompt + memoryPalace 召回用的"较短近窗"。不传则等于 historyMsgs。
     * useChatAI 主路径里 React state 上限 200 条，DB 历史可能更长——保留这个区分。
     */
    recentMsgsHint?: Message[];
    contextLimit: number;

    // 实时世界 / 角色情绪
    realtimeConfig?: RealtimeConfig;
    /** 上一轮 emotion eval 产出的内心独白 */
    innerState?: string;

    // user 共听上下文（非 React 调用方可传 musicSnapshot 让 helper 自动算）
    userListeningContext?: UserListeningContext | null;
    isListeningTogether?: boolean;
    musicCfg?: MusicCfg;
    /** 备选：传一份原始播放快照，helper 内部按主路径同样的逻辑算 listening 三件套 */
    musicSnapshot?: MusicPlaybackSnapshot | null;

    // 模式开关
    translationConfig?: TranslationConfig | { enabled: boolean; sourceLang: string; targetLang: string };
    htmlMode?: { enabled: boolean; customPrompt?: string };
    thinkingChain?: { enabled: boolean; customPrompt?: string };
    mcdMiniSnap?: McdMiniAppSnapshot;
}

export interface BuildChatPayloadResult {
    /** 完整 system prompt（含所有可选块） */
    systemPrompt: string;
    /** 已剥离双语标签的历史消息（emotion eval 也吃这份） */
    cleanedApiMessages: Array<{ role: string; content: any }>;
    /** [system, ...cleanedApiMessages, 末尾 bilingual reminder?] —— 主 API 直接发这个 */
    fullMessages: Array<{ role: string; content: any }>;
    /** 调试用：bilingual / mcd 是否实际注入 */
    flags: { bilingualActive: boolean; mcdActive: boolean; htmlActive: boolean; thinkingActive: boolean };
}

/**
 * 用 MusicPlaybackSnapshot 算 user 共听上下文 —— 与 useChatAI.ts:636–666 行为一致。
 */
function deriveListeningFromSnapshot(
    snap: MusicPlaybackSnapshot | null | undefined,
    charId: string,
): { userListeningContext: UserListeningContext | null; isListeningTogether: boolean; musicCfg?: MusicCfg } {
    if (!snap) return { userListeningContext: null, isListeningTogether: false };
    const { current, playing, lyric, activeLyricIdx, listeningTogetherWith, cfg } = snap;
    let userListeningContext: UserListeningContext | null = null;
    if (current && playing && lyric.length > 0) {
        const idx = activeLyricIdx;
        if (idx >= 0) {
            const from = Math.max(0, idx - 2);
            const to = Math.min(lyric.length, idx + 2 + 1);
            const window = lyric.slice(from, to).map((l: LyricLine) => l.text);
            const activeIdx = idx - from;
            userListeningContext = {
                songName: current.name,
                artists: current.artists,
                lyricWindow: window,
                activeIdx,
            };
        }
    } else if (current && playing) {
        userListeningContext = {
            songName: current.name,
            artists: current.artists,
            lyricWindow: [],
            activeIdx: -1,
        };
    }
    const isListeningTogether = !!(userListeningContext && listeningTogetherWith.includes(charId));
    return { userListeningContext, isListeningTogether, musicCfg: cfg };
}

/**
 * 构造完整 chat 请求载荷。顺序严格对齐 useChatAI.ts 现有实现：
 *
 *   1. injectMemoryPalace（向量召回挂到 char.memoryPalaceInjection）
 *   2. ChatPrompts.buildSystemPrompt（核心人设 + 实时 + 记忆 + 音乐 + 日程内心独白）
 *   3. += 双语指令
 *   4. += HTML 模式提示词
 *   5. += 思考链提示词（+ 用户额外要求）
 *   6. ChatPrompts.buildMessageHistory → apiMessages
 *   7. 剥离 apiMessages 里旧的双语标签 → cleanedApiMessages
 *   8. += 麦当劳小程序上下文（注意：在 6/7 之后追加到 systemPrompt）
 *   9. fullMessages = [system, ...cleanedApiMessages]
 *  10. fullMessages.push（末尾双语 reminder，不进 systemPrompt）
 *
 * emotion eval 应当吃 (systemPrompt, cleanedApiMessages) —— 与主 API 看到的完全一致。
 */
export async function buildChatRequestPayload(input: BuildChatPayloadInput): Promise<BuildChatPayloadResult> {
    const {
        char, userProfile, groups, emojis, categories, historyMsgs, contextLimit,
        realtimeConfig, innerState,
        translationConfig, htmlMode, thinkingChain, mcdMiniSnap,
    } = input;
    const recentMsgsHint = input.recentMsgsHint ?? historyMsgs;

    // ── 1. Memory Palace 向量召回 ─────────────────────────
    await injectMemoryPalace(char, recentMsgsHint, undefined, userProfile?.name);

    // ── 2. 解析音乐共听（如果 caller 没显式给，就从 snapshot 推） ──
    let userListeningContext = input.userListeningContext;
    let isListeningTogether = input.isListeningTogether;
    let musicCfg = input.musicCfg;
    if (userListeningContext === undefined && input.musicSnapshot !== undefined) {
        const derived = deriveListeningFromSnapshot(input.musicSnapshot, char.id);
        userListeningContext = derived.userListeningContext;
        isListeningTogether = derived.isListeningTogether;
        musicCfg = derived.musicCfg ?? musicCfg;
    }

    // ── 3. buildSystemPrompt 核心 ─────────────────────────
    let systemPrompt = await ChatPrompts.buildSystemPrompt(
        char, userProfile, groups, emojis, categories, recentMsgsHint,
        realtimeConfig, innerState || undefined,
        userListeningContext ?? null,
        !!isListeningTogether,
        musicCfg,
    );

    // ── 4. 双语指令注入 ───────────────────────────────────
    const bilingualActive = !!(translationConfig?.enabled && translationConfig.sourceLang && translationConfig.targetLang);
    if (bilingualActive && translationConfig) {
        systemPrompt += `\n\n[CRITICAL: 双语输出模式 - 必须严格遵守]
你的每句话都必须用以下XML标签格式输出双语内容：
<翻译>
<原文>${translationConfig.sourceLang}内容</原文>
<译文>${translationConfig.targetLang}内容</译文>
</翻译>

规则：
- 每句话单独包裹一个<翻译>标签
- 多句话就输出多个<翻译>标签，一句一个
- <翻译>标签外不要写任何文字
- 表情包命令 [[SEND_EMOJI: ...]] 放在所有<翻译>标签外面

示例（${translationConfig.sourceLang}→${translationConfig.targetLang}）：
<翻译>
<原文>こんにちは！</原文>
<译文>你好！</译文>
</翻译>
<翻译>
<原文>今日は何する？</原文>
<译文>今天做什么？</译文>
</翻译>`;
    }

    // ── 5. HTML 卡片模式 ─────────────────────────────────
    const htmlActive = !!htmlMode?.enabled;
    if (htmlActive) {
        systemPrompt += `\n\n${buildHtmlPrompt(htmlMode?.customPrompt)}`;
    }

    // ── 6. 思考链提示词 ───────────────────────────────────
    const thinkingActive = !!thinkingChain?.enabled;
    if (thinkingActive) {
        const userName = (userProfile?.name && userProfile.name.trim()) || '用户';
        systemPrompt += `\n\n${buildThinkingChainPrompt(char.name, userName)}`;
        const extra = (thinkingChain?.customPrompt || '').trim();
        if (extra) {
            systemPrompt += `\n\n## 用户对内心独白的额外要求\n${extra}`;
        }
    }



    // ── 6.5 购物中心 / 外卖自主卡片能力 ─────────────────────
    // 参考 330 小手机：不是临时塞一条“主动购买提示”，而是把可用动作长期写入主 system prompt。
    // 模型只有在符合人设、关系和上下文时才使用；不用时正常聊天即可。
    const commerceUserName = (userProfile?.name && userProfile.name.trim()) || '用户';
    systemPrompt += `

## 购物中心 / 外卖卡片能力（可选，不要强行使用）
你可以像真实生活中的人一样，在合适的时机主动给 ${commerceUserName} 买东西或点外卖；也可以拒绝消费、开玩笑、转移话题或只用文字回应。不要为了使用功能而使用功能。

当你确实决定“主动给用户买东西/点外卖”时，在自然回复中附加一条内部动作标签，系统会把它渲染成聊天卡片。格式必须严格如下（二选一）：
[[NUOMI_COMMERCE: {"kind":"char_purchase_to_user","name":"暖手宝","amount":39,"note":"怕你手冷"}]]
[[NUOMI_COMMERCE: {"kind":"char_delivery_to_user","name":"热奶茶","amount":18,"note":"陪你加班"}]]

规则：
- 这个标签只在你真的想主动购买/点外卖时使用；平时不要输出。
- 价格要符合你的人设、经济状况和关系，不要总是示例价。
- name 必须是具体商品/外卖名，amount 必须是数字。
- 标签外可以正常说话；不要向用户解释标签格式。
- 如果聊天里出现购物/外卖卡片，你要根据卡片信息、详情页、数量、价格和备注自然回应，不要机械复述。`;

    // ── 7. 历史消息构造 ───────────────────────────────────
    const { apiMessages } = ChatPrompts.buildMessageHistory(historyMsgs, contextLimit, char, userProfile, emojis);

    // ── 8. 剥离历史里旧的双语标签 ─────────────────────────
    const cleanedApiMessages = apiMessages.map((msg: any) => {
        if (typeof msg.content !== 'string') return msg;
        let c: string = msg.content;
        if (c.toLowerCase().includes('%%bilingual%%')) {
            const idx = c.toLowerCase().indexOf('%%bilingual%%');
            c = c.substring(0, idx).trim();
        }
        if (c.includes('<翻译>')) {
            c = c.replace(/<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g, '$1').trim();
        }
        return { ...msg, content: c };
    });

    // ── 9. 麦当劳小程序上下文（在 cleanedApiMessages 之后追加到 systemPrompt） ──
    const mcdActive = !!mcdMiniSnap?.open;
    if (mcdActive) {
        const block = buildMcdMiniAppContextBlock(mcdMiniSnap, userProfile?.name || '用户');
        if (block) {
            systemPrompt += block;
        }
    }

    // ── 10. 组装 fullMessages + 末尾双语 reminder ─────────
    const fullMessages: Array<{ role: string; content: any }> = [
        { role: 'system', content: systemPrompt },
        ...cleanedApiMessages,
    ];
    if (bilingualActive) {
        fullMessages.push({
            role: 'system',
            content: `[Reminder: 每句话必须用 <翻译><原文>...</原文><译文>...</译文></翻译> 标签包裹。一句一个标签。绝对不能省略。]`,
        });
    }

    return {
        systemPrompt,
        cleanedApiMessages,
        fullMessages,
        flags: { bilingualActive, mcdActive, htmlActive, thinkingActive },
    };
}
