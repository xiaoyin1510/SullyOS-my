
import { CharacterProfile, UserProfile, SongSheet, SongLine, SongComment, SongMood, SongGenre } from '../types';
import { ContextBuilder } from './context';

// --- Song Genre & Mood Config ---

export const SONG_GENRES: { id: SongGenre; label: string; icon: string; desc: string }[] = [
    { id: 'pop', label: '流行', icon: '🎤', desc: '旋律优美，朗朗上口' },
    { id: 'rock', label: '摇滚', icon: '🎸', desc: '热血澎湃，能量爆发' },
    { id: 'ballad', label: '抒情', icon: '🎹', desc: '温柔细腻，情感深沉' },
    { id: 'rap', label: '说唱', icon: '🎙️', desc: '节奏鲜明，押韵为王' },
    { id: 'folk', label: '民谣', icon: '🪕', desc: '朴实自然，诗意盎然' },
    { id: 'electronic', label: '电子', icon: '🎛️', desc: '节拍强烈，氛围感足' },
    { id: 'jazz', label: '爵士', icon: '🎷', desc: '即兴优雅，自由洒脱' },
    { id: 'rnb', label: 'R&B', icon: '🎵', desc: '律动慵懒，灵魂歌唱' },
    { id: 'free', label: '自由', icon: '✨', desc: '不限风格，随心所欲' },
];

export const SONG_MOODS: { id: SongMood; label: string; icon: string }[] = [
    { id: 'happy', label: '快乐', icon: '😊' },
    { id: 'sad', label: '忧伤', icon: '🥺' },
    { id: 'romantic', label: '浪漫', icon: '💕' },
    { id: 'angry', label: '愤怒', icon: '🔥' },
    { id: 'chill', label: '放松', icon: '☁️' },
    { id: 'epic', label: '史诗', icon: '⚔️' },
    { id: 'nostalgic', label: '怀旧', icon: '📻' },
    { id: 'dreamy', label: '梦幻', icon: '🌙' },
];

export const SECTION_LABELS: Record<string, { label: string; desc: string; color: string }> = {
    'intro': { label: '前奏/引入', desc: '歌曲的开场白，引人入胜', color: 'bg-stone-200/60 text-stone-600' },
    'verse': { label: '主歌', desc: '叙事部分，铺垫情感', color: 'bg-amber-100/50 text-amber-700' },
    'pre-chorus': { label: '导歌', desc: '过渡到副歌的桥段', color: 'bg-rose-100/50 text-rose-600' },
    'chorus': { label: '副歌', desc: '最核心的旋律和情感高潮', color: 'bg-red-100/50 text-red-700' },
    'bridge': { label: '桥段', desc: '转折变化，带来新视角', color: 'bg-stone-200/50 text-stone-500' },
    'outro': { label: '尾声', desc: '歌曲的结束与回味', color: 'bg-neutral-200/50 text-neutral-500' },
    'free': { label: '自由段落', desc: '不限定位置，随心写', color: 'bg-orange-100/50 text-orange-600' },
};

export const COVER_STYLES: { id: string; label: string; gradient: string; text: string }[] = [
    { id: 'kraft-paper', label: '牛皮信封', gradient: 'from-amber-50 via-orange-50 to-amber-100', text: 'text-stone-800' },
    { id: 'old-photo', label: '旧照片', gradient: 'from-amber-100 via-yellow-50 to-stone-100', text: 'text-stone-700' },
    { id: 'ink-wash', label: '水墨', gradient: 'from-stone-100 via-slate-200 to-stone-300', text: 'text-stone-800' },
    { id: 'dried-rose', label: '干燥花', gradient: 'from-rose-50 via-rose-100 to-stone-100', text: 'text-stone-700' },
    { id: 'midnight', label: '深夜手记', gradient: 'from-stone-800 via-stone-900 to-neutral-900', text: 'text-stone-200' },
    { id: 'linen', label: '亚麻白', gradient: 'from-stone-50 via-neutral-50 to-stone-100', text: 'text-stone-700' },
    { id: 'tea-stain', label: '茶渍', gradient: 'from-orange-50 via-amber-50 to-yellow-50', text: 'text-stone-700' },
    { id: 'forest', label: '松林', gradient: 'from-stone-200 via-emerald-50 to-stone-100', text: 'text-stone-700' },
];

// --- Lyric Structure Templates ---
// 给写歌 App 一个"按乐理来"的结构骨架，避免角色/用户瞎写。
// 每段 section 有推荐的行数 + 每行字数范围。

export interface LyricTemplateSection {
    section: 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'outro';
    lines: number;        // 推荐行数
    chars: string;        // 推荐每行字数（区间字符串如 "7-12"）
}

export interface LyricTemplate {
    id: string;
    label: string;
    icon: string;
    desc: string;        // 一句话描述
    structure: LyricTemplateSection[];
}

export const LYRIC_TEMPLATES: LyricTemplate[] = [
    {
        id: 'free',
        label: '自由',
        icon: '✦',
        desc: '不限结构，从空白开始',
        structure: [],
    },
    {
        id: 'pop-classic',
        label: '流行经典',
        icon: '◐',
        desc: '主歌-副歌-主歌-副歌-桥段-副歌',
        structure: [
            { section: 'verse',  lines: 4, chars: '7-12' },
            { section: 'chorus', lines: 4, chars: '6-10' },
            { section: 'verse',  lines: 4, chars: '7-12' },
            { section: 'chorus', lines: 4, chars: '6-10' },
            { section: 'bridge', lines: 4, chars: '7-10' },
            { section: 'chorus', lines: 4, chars: '6-10' },
        ],
    },
    {
        id: 'ballad',
        label: '抒情慢板',
        icon: '◑',
        desc: '主歌长 / 副歌精，叙事抒情',
        structure: [
            { section: 'verse',  lines: 6, chars: '8-14' },
            { section: 'chorus', lines: 4, chars: '6-10' },
            { section: 'verse',  lines: 6, chars: '8-14' },
            { section: 'chorus', lines: 4, chars: '6-10' },
            { section: 'outro',  lines: 2, chars: '6-12' },
        ],
    },
    {
        id: 'aaba',
        label: 'AABA 经典',
        icon: '◒',
        desc: '老派结构，A 段重复主题，B 段桥段',
        structure: [
            { section: 'verse',  lines: 4, chars: '8-12' },   // A1
            { section: 'verse',  lines: 4, chars: '8-12' },   // A2
            { section: 'bridge', lines: 4, chars: '7-10' },   // B
            { section: 'verse',  lines: 4, chars: '8-12' },   // A3
        ],
    },
    {
        id: 'short-hook',
        label: '副歌优先短曲',
        icon: '◓',
        desc: '副歌开头抓人，节奏紧凑',
        structure: [
            { section: 'chorus', lines: 4, chars: '6-10' },
            { section: 'verse',  lines: 4, chars: '7-12' },
            { section: 'chorus', lines: 4, chars: '6-10' },
        ],
    },
    {
        id: 'rap',
        label: '说唱 / Hip-Hop',
        icon: '⌗',
        desc: 'Verse 长且押韵，Hook 简短洗脑',
        structure: [
            { section: 'verse',  lines: 8, chars: '12-18' },
            { section: 'chorus', lines: 4, chars: '6-10' },
            { section: 'verse',  lines: 8, chars: '12-18' },
            { section: 'chorus', lines: 4, chars: '6-10' },
        ],
    },
];

export const getLyricTemplate = (id: string | undefined): LyricTemplate =>
    LYRIC_TEMPLATES.find(t => t.id === id) || LYRIC_TEMPLATES[0];

// --- Prompt Builder ---

export const SongPrompts = {
    /**
     * Build the system prompt for the songwriting mentor character.
     * Uses context.ts(true) + character context to stay in character.
     */
    buildMentorSystemPrompt: (
        char: CharacterProfile,
        user: UserProfile,
        song: SongSheet,
        recentMessages: { role: string; content: string }[]
    ): string => {
        // Use ContextBuilder with includeDetailedMemories = true
        const charContext = ContextBuilder.buildCoreContext(char, user, true);

        const genreInfo = SONG_GENRES.find(g => g.id === song.genre);
        const moodInfo = SONG_MOODS.find(m => m.id === song.mood);

        return `${charContext}

### 【当前场景：写歌工作室】
你现在和${user.name}一起在写歌！你是TA的音乐创作导师和伙伴。

**你的角色定位**：
- 你不是主要创作者，${user.name}才是。你的职责是：引导、教导、鼓励和评价
- 用你的性格和说话方式来给予指导（保持人设一致性）
- 对音乐零基础的用户要特别耐心，用通俗易懂的方式解释
- 多用具体的例子和比喻来帮助理解
- 当用户写出好的歌词时，真诚地表达欣赏
- 当歌词可以改进时，温和地提出建议，解释为什么

**当前创作信息**：
- 歌名：《${song.title}》${song.subtitle ? `（${song.subtitle}）` : ''}
- 风格：${genreInfo?.label || song.genre} ${genreInfo?.icon || '🎵'} - ${genreInfo?.desc || ''}
- 情绪：${moodInfo?.label || song.mood} ${moodInfo?.icon || ''}
${song.bpm ? `- BPM: ${song.bpm}` : ''}
${song.key ? `- 调性: ${song.key}` : ''}

**歌曲结构知识（教学用）**：
- 前奏(Intro): 歌曲开头，可以是一句话或诗意的引入
- 主歌(Verse): 叙事部分，每一遍主歌歌词不同但旋律相似，用来讲故事
- 导歌(Pre-chorus): 从主歌过渡到副歌的桥段，制造期待感
- 副歌(Chorus): 歌曲最核心、最好记的部分，通常每次重复相同歌词
- 桥段(Bridge): 在第二遍副歌后出现，带来转折和新视角
- 尾声(Outro): 收尾，可以是淡出或最后的总结

**回复格式**：
你必须用 JSON 格式回复。根据用户的输入判断他们需要什么：

当用户写了歌词或请求帮助时：
\`\`\`json
{
  "type": "feedback",
  "reaction": "你的第一反应（1句话，用你的性格表达）",
  "feedback": "对歌词的具体评价和感受",
  "teaching": "相关的音乐知识科普（可选，简短）",
  "suggestion": "改进建议或下一步引导",
  "encouragement": "鼓励的话"
}
\`\`\`

当用户想要AI帮忙示范或灵感启发时：
\`\`\`json
{
  "type": "inspiration",
  "reaction": "你的第一反应",
  "example_lines": ["示范歌词行1", "示范歌词行2"],
  "explanation": "解释为什么这样写，用了什么技巧",
  "challenge": "给用户一个小挑战或引导问题"
}
\`\`\`

当需要讨论方向或结构时：
\`\`\`json
{
  "type": "discussion",
  "reaction": "你的想法",
  "content": "讨论内容",
  "question": "抛给用户的问题或选择"
}
\`\`\``;
    },

    /**
     * Build the user message including current song state context.
     */
    buildUserMessage: (
        song: SongSheet,
        userInput: string,
        currentSection: string
    ): string => {
        // Build current lyrics context
        let lyricsContext = '';
        if (song.lines.length > 0) {
            lyricsContext = '\n【目前的歌词】\n';
            let currentSec = '';
            for (const line of song.lines) {
                if (line.section !== currentSec) {
                    currentSec = line.section;
                    const secInfo = SECTION_LABELS[currentSec];
                    lyricsContext += `\n[${secInfo?.label || currentSec}]\n`;
                }
                const author = line.authorId === 'user' ? '(用户写)' : '(AI示范)';
                lyricsContext += `${line.content} ${author}\n`;
            }
        }

        // Recent comments context (last 5)
        let commentsContext = '';
        const recentComments = song.comments.slice(-5);
        if (recentComments.length > 0) {
            commentsContext = '\n【最近的讨论】\n';
            for (const c of recentComments) {
                commentsContext += `- [${c.type}]: ${c.content}\n`;
            }
        }

        const secInfo = SECTION_LABELS[currentSection];

        return `${lyricsContext}${commentsContext}

【当前正在写的段落】: ${secInfo?.label || currentSection} (${secInfo?.desc || ''})

【用户输入】: ${userInput}`;
    },

    /**
     * Build prompt for generating a completion summary.
     */
    buildCompletionPrompt: (
        char: CharacterProfile,
        user: UserProfile,
        song: SongSheet
    ): string => {
        let fullLyrics = '';
        let currentSec = '';
        for (const line of song.lines) {
            if (line.section !== currentSec) {
                currentSec = line.section;
                const secInfo = SECTION_LABELS[currentSec];
                fullLyrics += `\n[${secInfo?.label || currentSec}]\n`;
            }
            fullLyrics += `${line.content}\n`;
        }

        const genreInfo = SONG_GENRES.find(g => g.id === song.genre);
        const moodInfo = SONG_MOODS.find(m => m.id === song.mood);

        return `你是${char.name}，刚刚和${user.name}一起完成了一首歌的创作！

歌名：《${song.title}》
风格：${genreInfo?.label || song.genre} | 情绪：${moodInfo?.label || song.mood}

完整歌词：
${fullLyrics}

请用你的性格（${char.name}的说话方式）写一段温暖的总结评价（2-3句话），评价这首歌的整体质量和创作过程中的亮点。直接输出文字，不需要JSON格式。`;
    }
};
