/**
 * 归档提示词模板工具（共享）
 *
 * 用户在 Character.tsx / Chat.tsx 的"记忆归档设置"里选中的提示词模板 id
 * 存在 localStorage 里，内容也部分存在 localStorage（用户自定义的）。
 * 默认模板（preset_*）来自 ChatConstants.DEFAULT_ARCHIVE_PROMPTS。
 *
 * 这里把"取当前选中模板 content"集中成一个函数，供：
 * - 手动归档路径
 * - palace 自动归档路径（pipeline.ts 调用）
 * 共用。
 */

import { DEFAULT_ARCHIVE_PROMPTS } from '../components/chat/ChatConstants';

const LS_KEY_CUSTOM_PROMPTS = 'chat_archive_prompts';
const LS_KEY_SELECTED_ID = 'chat_active_archive_prompt_id';
const DEFAULT_ID = 'preset_rational';

/**
 * 取当前选中的归档提示词模板内容（已做过字段替换）。
 *
 * 返回 null 表示取不到，调用方应 fallback 到 palace 裸拼 YAML bullets。
 */
export function getActiveArchiveTemplate(opts: {
    dateStr: string;
    charName: string;
    userName: string;
    rawLog: string;
}): string | null {
    try {
        const selectedId = localStorage.getItem(LS_KEY_SELECTED_ID) || DEFAULT_ID;

        // 合并默认模板 + 用户自定义
        let all: { id: string; name: string; content: string }[] = [...DEFAULT_ARCHIVE_PROMPTS];
        try {
            const raw = localStorage.getItem(LS_KEY_CUSTOM_PROMPTS);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    // 只合并非 preset 的自定义条目
                    all = [...all, ...parsed.filter((p: any) => p?.id && !p.id.startsWith('preset_'))];
                }
            }
        } catch { /* 自定义解析失败也不影响取默认 */ }

        const found = all.find(p => p.id === selectedId) || all[0];
        if (!found) return null;

        // 字段替换
        return found.content
            .replace(/\$\{dateStr\}/g, opts.dateStr)
            .replace(/\$\{char\.name\}/g, opts.charName)
            .replace(/\$\{userProfile\.name\}/g, opts.userName)
            .replace(/\$\{rawLog.*?\}/g, opts.rawLog);
    } catch {
        return null;
    }
}
