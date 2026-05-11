import { CharacterProfile, UserImpression } from '../types';

const toStringValue = (value: unknown, fallback = ''): string =>
    typeof value === 'string' ? value : fallback;

const toNumberValue = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const toStringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object' && 'description' in item) {
                const description = toStringValue((item as { description?: unknown }).description).trim();
                const period = toStringValue((item as { period?: unknown }).period).trim();
                return description ? `${period ? `[${period}] ` : ''}${description}` : '';
            }
            return '';
        })
        .filter(Boolean);
};

export const normalizeUserImpression = (raw: unknown): UserImpression | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;

    const source = raw as Partial<UserImpression> & Record<string, unknown>;
    const hasMeaningfulContent = [
        source.value_map,
        source.behavior_profile,
        source.emotion_schema,
        source.personality_core,
        source.mbti_analysis,
        source.observed_changes,
    ].some((value) => value !== undefined && value !== null);

    if (!hasMeaningfulContent) return undefined;

    const mbtiSource = source.mbti_analysis && typeof source.mbti_analysis === 'object'
        ? source.mbti_analysis as NonNullable<UserImpression['mbti_analysis']>
        : undefined;

    return {
        version: toNumberValue(source.version, 3),
        lastUpdated: toNumberValue(source.lastUpdated, Date.now()),
        value_map: {
            likes: toStringList(source.value_map && typeof source.value_map === 'object' ? (source.value_map as { likes?: unknown }).likes : undefined),
            dislikes: toStringList(source.value_map && typeof source.value_map === 'object' ? (source.value_map as { dislikes?: unknown }).dislikes : undefined),
            core_values: toStringValue(source.value_map && typeof source.value_map === 'object' ? (source.value_map as { core_values?: unknown }).core_values : undefined),
        },
        behavior_profile: {
            tone_style: toStringValue(source.behavior_profile && typeof source.behavior_profile === 'object' ? (source.behavior_profile as { tone_style?: unknown }).tone_style : undefined),
            emotion_summary: toStringValue(source.behavior_profile && typeof source.behavior_profile === 'object' ? (source.behavior_profile as { emotion_summary?: unknown }).emotion_summary : undefined),
            response_patterns: toStringValue(source.behavior_profile && typeof source.behavior_profile === 'object' ? (source.behavior_profile as { response_patterns?: unknown }).response_patterns : undefined),
        },
        emotion_schema: {
            triggers: {
                positive: toStringList(source.emotion_schema && typeof source.emotion_schema === 'object'
                    ? ((source.emotion_schema as { triggers?: { positive?: unknown } }).triggers?.positive)
                    : undefined),
                negative: toStringList(source.emotion_schema && typeof source.emotion_schema === 'object'
                    ? ((source.emotion_schema as { triggers?: { negative?: unknown } }).triggers?.negative)
                    : undefined),
            },
            comfort_zone: toStringValue(source.emotion_schema && typeof source.emotion_schema === 'object' ? (source.emotion_schema as { comfort_zone?: unknown }).comfort_zone : undefined),
            stress_signals: toStringList(source.emotion_schema && typeof source.emotion_schema === 'object' ? (source.emotion_schema as { stress_signals?: unknown }).stress_signals : undefined),
        },
        personality_core: {
            observed_traits: toStringList(source.personality_core && typeof source.personality_core === 'object' ? (source.personality_core as { observed_traits?: unknown }).observed_traits : undefined),
            interaction_style: toStringValue(source.personality_core && typeof source.personality_core === 'object' ? (source.personality_core as { interaction_style?: unknown }).interaction_style : undefined),
            summary: toStringValue(source.personality_core && typeof source.personality_core === 'object' ? (source.personality_core as { summary?: unknown }).summary : undefined),
        },
        mbti_analysis: mbtiSource ? {
            type: toStringValue(mbtiSource.type),
            reasoning: toStringValue(mbtiSource.reasoning),
            dimensions: {
                e_i: toNumberValue(mbtiSource.dimensions?.e_i, 50),
                s_n: toNumberValue(mbtiSource.dimensions?.s_n, 50),
                t_f: toNumberValue(mbtiSource.dimensions?.t_f, 50),
                j_p: toNumberValue(mbtiSource.dimensions?.j_p, 50),
            },
        } : undefined,
        observed_changes: toStringList(source.observed_changes),
    };
};

export const normalizeCharacterImpression = (char: CharacterProfile): CharacterProfile => {
    const normalizedImpression = normalizeUserImpression(char.impression);
    if (!normalizedImpression && !char.impression) return char;

    const prevSerialized = char.impression ? JSON.stringify(char.impression) : '';
    const nextSerialized = normalizedImpression ? JSON.stringify(normalizedImpression) : '';
    if (prevSerialized === nextSerialized) return char;

    return {
        ...char,
        impression: normalizedImpression,
    };
};

/**
 * 历史脏数据兜底：早期 addCharacter 没初始化 emotionConfig，导致一批"新角色"该字段
 * 为 undefined，情绪闸门 (useChatAI:761) 永远过不去。
 * 此处只把 undefined 补成默认 enabled，用户显式关掉 (false) 的不动。
 * memoryPalaceEnabled 是用户显式 opt-in 的功能，不在这里替用户开。
 */
export const normalizeCharacterDefaults = (char: CharacterProfile): CharacterProfile => {
    if (char.emotionConfig !== undefined) return char;
    return { ...char, emotionConfig: { enabled: true } };
};
