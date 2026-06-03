import { DB } from './db';
import { NotionManager, FeishuManager } from './realtimeContext';
import type { RealtimeConfig } from '../types';

// 待写日记队列 (写 Notion / 飞书).
//
// 为什么需要: 写日记是客户端发起的网络 fetch (NotionManager.createDiaryPage /
// FeishuManager.createDiaryRecord). instant push 路径下, 如果用户在角色回复到达时把 app
// 切后台 / 浏览器冻结了, 这个 fetch 会被节流/打断而失败, 而 inbox 是"先 ack 后处理"原子消费,
// 失败的写入就永久丢了 (用户现象: 角色说"写好了"但 Notion 里没有). 文字 chunk 因为先落库所以
// 照常显示, 造成假象.
//
// 解法 (用户提的"回前台再补打"思路 + 预写日志): 在真正发请求**之前**先把内容持久化到本地队列
// (localStorage 同步写, 即使随后被冻结/杀进程也已落盘), 然后尝试写; 成功就删除该条, 失败就留着.
// 回到前台 (visibilitychange→visible) / app 启动时 drainPendingDiaries() 排空重试 —— 那时
// 页面可见, fetch 可靠. 这样文字流照常跑, 唯独脆弱的网络副作用走"保证最终一致"的补偿路径.

const STORAGE_KEY = 'os_pending_diary_writes';

export interface PendingDiary {
    id: string;
    kind: 'notion' | 'feishu';
    charId: string;
    charName: string;
    title: string;
    content: string;
    mood?: string;
    createdAt: number;
}

function read(): PendingDiary[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function write(list: PendingDiary[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn('[pendingDiary] persist failed', e);
    }
}

/** 预写: 真正发请求前先落盘. 返回 id, 写成功后用 removePendingDiary(id) 删掉. */
export function enqueuePendingDiary(entry: Omit<PendingDiary, 'id' | 'createdAt'>): string {
    const id = `${entry.charId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const list = read();
    list.push({ ...entry, id, createdAt: Date.now() });
    write(list);
    return id;
}

export function removePendingDiary(id: string): void {
    write(read().filter((e) => e.id !== id));
}

export function hasPendingDiaries(): boolean {
    return read().length > 0;
}

/**
 * 排空待写日记: 对每条尝试写入对应后端.
 *  - 成功 → 落一条"角色写了日记"系统消息 + 删除该条 + 调 onSaved 刷新 UI.
 *  - API 明确拒绝 (success=false, 多为配置/权限问题, 重试也没用) → 删除该条, 不再重试.
 *  - 抛异常 (网络被冻结/打断等可恢复错误) → 留在队列, 下次回前台再试.
 *  - 对应后端没配置 → 跳过 (留着, 等配置好).
 * 仅在前台 (visibilitychange→visible) / app 启动时调用.
 */
export async function drainPendingDiaries(
    realtimeConfig: RealtimeConfig | undefined,
    onSaved?: (charId: string) => void,
): Promise<void> {
    const list = read();
    if (list.length === 0) return;

    for (const entry of list) {
        try {
            if (entry.kind === 'notion') {
                if (!realtimeConfig?.notionEnabled || !realtimeConfig?.notionApiKey || !realtimeConfig?.notionDatabaseId) {
                    continue; // 没配置, 留着
                }
                const r = await NotionManager.createDiaryPage(
                    realtimeConfig.notionApiKey,
                    realtimeConfig.notionDatabaseId,
                    { title: entry.title, content: entry.content, mood: entry.mood || undefined, characterName: entry.charName },
                );
                if (r.success) {
                    await DB.saveMessage({ charId: entry.charId, role: 'system', type: 'text', content: `📔 ${entry.charName}写了一篇日记「${entry.title}」` } as any);
                    removePendingDiary(entry.id);
                    onSaved?.(entry.charId);
                } else {
                    console.error('[pendingDiary] notion 拒绝, 丢弃:', r.message);
                    removePendingDiary(entry.id);
                }
            } else {
                if (!realtimeConfig?.feishuEnabled || !realtimeConfig?.feishuAppId || !realtimeConfig?.feishuAppSecret || !realtimeConfig?.feishuBaseId || !realtimeConfig?.feishuTableId) {
                    continue;
                }
                const r = await FeishuManager.createDiaryRecord(
                    realtimeConfig.feishuAppId,
                    realtimeConfig.feishuAppSecret,
                    realtimeConfig.feishuBaseId,
                    realtimeConfig.feishuTableId,
                    { title: entry.title, content: entry.content, mood: entry.mood || undefined, characterName: entry.charName },
                );
                if (r.success) {
                    await DB.saveMessage({ charId: entry.charId, role: 'system', type: 'text', content: `📒 ${entry.charName}写了一篇日记「${entry.title}」(飞书)` } as any);
                    removePendingDiary(entry.id);
                    onSaved?.(entry.charId);
                } else {
                    console.error('[pendingDiary] 飞书拒绝, 丢弃:', r.message);
                    removePendingDiary(entry.id);
                }
            }
        } catch (e) {
            // 网络可恢复错误: 留在队列, 回前台再试.
            console.warn('[pendingDiary] 写入异常, 留待重试:', entry.id, e);
        }
    }
}
