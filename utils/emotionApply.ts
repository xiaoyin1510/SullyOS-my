import { DB } from './db';
import type { CharacterProfile, CharacterBuff } from '../types';

// 情绪评估结果「解析 + 落 buff」的共用实现.
//
// 原本内联在 hooks/useChatAI.ts 的 evaluateEmotionBackground 里. 提取出来是为了让两条路径共用:
//   1. 本地模式: 客户端跑 eval LLM 拿到 raw, 调本函数落地.
//   2. instant 模式: worker 跑 eval LLM, 把 raw 作为 emotion_update push 推回, 客户端 flush 时调本函数落地.
//
// 入参 rawText = LLM 返回的原始文本 (可能含 ```json 包裹). 返回 innerState (意识流) 字符串或 null,
// 调用方负责把它喂回下一轮 prompt (evolvedNarrative). buff 的应用 (写 DB + 广播 emotion-updated)
// 在本函数内完成.

const sanitizeBuffs = (buffs?: CharacterBuff[]): CharacterBuff[] => {
    if (!Array.isArray(buffs)) return [];
    return buffs
        .map((buff, index) => {
            const label = typeof buff?.label === 'string' ? buff.label.trim() : '';
            const name = typeof buff?.name === 'string' ? buff.name.trim() : '';
            if (!label || !name) return null;

            const rawIntensity = Number((buff as any)?.intensity);
            const intensity: 1 | 2 | 3 = !Number.isFinite(rawIntensity)
                ? 2
                : rawIntensity <= 1
                    ? 1
                    : rawIntensity >= 3
                        ? 3
                        : 2;

            const out: CharacterBuff = {
                id: typeof buff?.id === 'string' && buff.id.trim() ? buff.id.trim() : `buff_${Date.now()}_${index}`,
                name,
                label,
                intensity,
            };
            if (typeof buff?.emoji === 'string') out.emoji = buff.emoji;
            if (typeof buff?.color === 'string') out.color = buff.color;
            if (typeof buff?.description === 'string') out.description = buff.description;
            return out;
        })
        .filter((buff): buff is CharacterBuff => !!buff);
};

// 修复: 把 JSON 字符串值里的裸换行/制表符转义, 兼容 LLM 偶尔吐未转义控制字符的情况.
const repairJson = (s: string): string => {
    let inStr = false, esc = false, out = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (esc) { out += ch; esc = false; continue; }
        if (ch === '\\') { out += ch; esc = true; continue; }
        if (ch === '"') { inStr = !inStr; out += ch; continue; }
        if (inStr && ch === '\n') { out += '\\n'; continue; }
        if (inStr && ch === '\r') { out += '\\r'; continue; }
        if (inStr && ch === '\t') { out += '\\t'; continue; }
        out += ch;
    }
    return out;
};

/**
 * 解析情绪评估 raw 文本并落地 buff. 返回 innerState (意识流) 或 null.
 * - 解析失败 → 返回 null, 不动 buff.
 * - changed=false → 不动 buff, 返回 innerState (若有).
 * - changed=true → sanitize buffs → DB.saveCharacter → 广播 'emotion-updated' → 返回 innerState.
 */
export async function applyEmotionEvalRaw(
    rawText: string,
    charData: CharacterProfile,
): Promise<string | null> {
    try {
        const raw = rawText || '';
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
        if (!jsonMatch) {
            console.warn('🎭 [Emotion] Could not parse JSON from response:', raw.slice(0, 200));
            return null;
        }

        const jsonStr = jsonMatch[1].trim();
        let result: { changed: boolean; buffs?: CharacterBuff[]; injection?: string; innerState?: string };
        try {
            result = JSON.parse(jsonStr);
        } catch {
            try {
                result = JSON.parse(repairJson(jsonStr));
            } catch (e2: any) {
                console.warn('🎭 [Emotion] JSON parse failed even after repair:', e2?.message, jsonStr.slice(0, 300));
                return null;
            }
        }

        const innerStateOut = (typeof result.innerState === 'string' && result.innerState.trim())
            ? result.innerState.trim()
            : null;

        if (!result.changed) {
            console.log('🎭 [Emotion] No change detected, skipping buff update');
            if (innerStateOut) console.log(`🌊 [InnerState] ${charData.name}: ${innerStateOut}`);
            return innerStateOut;
        }

        const sanitizedBuffs = sanitizeBuffs(result.buffs);
        const updated: CharacterProfile = {
            ...charData,
            activeBuffs: sanitizedBuffs,
            buffInjection: result.injection || '',
        };
        await DB.saveCharacter(updated);

        // detail 直接带上 buffs + buffInjection: 监听方 (Chat) 可直接落 OSContext, 不必重读 DB
        // —— 避开 saveCharacter 未等事务提交 / instant flush 下 DB 重读偶发拿旧值的竞态.
        window.dispatchEvent(new CustomEvent('emotion-updated', {
            detail: { charId: charData.id, buffs: sanitizedBuffs, buffInjection: result.injection || '' },
        }));
        console.log('🎭 [Emotion] Updated buffs:', sanitizedBuffs.map((b) => b.label).join(', ') || 'none');
        if (innerStateOut) console.log(`🌊 [InnerState] ${charData.name}: ${innerStateOut}`);
        return innerStateOut;
    } catch (e: any) {
        console.warn('🎭 [Emotion] applyEmotionEvalRaw failed:', e?.message);
        return null;
    }
}
