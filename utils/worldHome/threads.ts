/**
 * 世界内消息线程（私聊 + 世界群聊）的维护逻辑。
 *
 * 这是"手机是真手机"的核心：消息持久在 world.threads 里、跨角色跨轮传递——
 * A 先演绎时发出的私聊/群聊**立刻**落线程，同一轮里后演绎的 B 构建上下文时
 * 就能收到并回应；下一轮 A 又能看到 B 的回复。NPC 也能在群里冒泡。
 */
import type { WorldProfile, WorldThread, WorldChatMessage, WorldCharBeat } from '../../types';

export const GROUP_THREAD_ID = 'group_main';
/** 每条线程截留的消息数（手机 UI 可完整翻阅；prompt 只取尾部一小段） */
export const THREAD_CAP = 120;

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function dmThreadId(a: string, b: string): string {
    const [x, y] = [a, b].sort();
    return `dm_${x}_${y}`;
}

/** 确保 threads 数组存在且包含世界群聊（成员名单跟随最新配置）。原地修改并返回。 */
export function ensureThreads(world: WorldProfile): WorldThread[] {
    if (!world.threads) world.threads = [];
    let group = world.threads.find(t => t.id === GROUP_THREAD_ID);
    if (!group) {
        group = { id: GROUP_THREAD_ID, kind: 'group', name: `${world.name}·大家的群`, memberIds: [...world.memberIds], messages: [] };
        world.threads.push(group);
    } else {
        group.memberIds = [...world.memberIds];
        group.name = group.name || `${world.name}·大家的群`;
    }
    return world.threads;
}

function pushMsg(thread: WorldThread, msg: WorldChatMessage) {
    thread.messages.push(msg);
    if (thread.messages.length > THREAD_CAP) thread.messages = thread.messages.slice(-THREAD_CAP);
}

/**
 * 把一个角色 beat 里的手机消息落进线程（dm → 私聊线程；group → 世界群聊）。
 * 在每个角色演绎完后立刻调用——链式后续角色才能在同一轮里收到。
 */
export function applyBeatToThreads(
    world: WorldProfile,
    beat: WorldCharBeat,
    members: { id: string; name: string }[],
    round: number,
    storyTime: string,
): void {
    const threads = ensureThreads(world);
    // dm 对象可以是成员，也可以是 NPC（角色给镇上的人发私信）
    const idOf = (name: string) => members.find(m => m.name === name)?.id || world.npcs.find(n => n.name === name)?.id;
    const now = Date.now();

    for (const dm of beat.phone?.dms || []) {
        const otherId = idOf(dm.to);
        if (!otherId || otherId === beat.charId) continue;
        const tid = dmThreadId(beat.charId, otherId);
        let thread = threads.find(t => t.id === tid);
        if (!thread) {
            thread = { id: tid, kind: 'dm', memberIds: [beat.charId, otherId], messages: [] };
            threads.push(thread);
        }
        for (const line of dm.lines) {
            pushMsg(thread, { id: genId('wm'), fromId: beat.charId, fromName: beat.charName, text: line, round, storyTime, timestamp: now });
        }
    }

    const groupLines = beat.phone?.group || [];
    if (groupLines.length > 0) {
        const group = threads.find(t => t.id === GROUP_THREAD_ID)!;
        for (const line of groupLines) {
            pushMsg(group, { id: genId('wm'), fromId: beat.charId, fromName: beat.charName, text: line, round, storyTime, timestamp: now });
        }
    }
}

/** NPC 在世界群聊里冒泡（世界引擎一次调用产出，无记忆，纯烟火气）。 */
export function applyNpcGroupLines(
    world: WorldProfile,
    lines: { name: string; line: string }[],
    round: number,
    storyTime: string,
): void {
    if (lines.length === 0) return;
    const threads = ensureThreads(world);
    const group = threads.find(t => t.id === GROUP_THREAD_ID)!;
    const now = Date.now();
    for (const l of lines) {
        const npc = world.npcs.find(n => n.name === l.name);
        if (!npc) continue; // 只收真实存在的 NPC 的发言
        pushMsg(group, { id: genId('wm'), fromId: npc.id, fromName: npc.name, text: l.line, round, storyTime, timestamp: now });
    }
}

/** NPC 回复成员的私信（世界引擎一次调用统一产出）。from=NPC 名，to=成员名。 */
export function applyNpcDms(
    world: WorldProfile,
    dms: { from: string; to: string; lines: string[] }[],
    members: { id: string; name: string }[],
    round: number,
    storyTime: string,
): void {
    if (!dms || dms.length === 0) return;
    const threads = ensureThreads(world);
    const now = Date.now();
    for (const dm of dms) {
        const npc = world.npcs.find(n => n.name === dm.from);
        const member = members.find(m => m.name === dm.to);
        if (!npc || !member || !Array.isArray(dm.lines)) continue;
        const tid = dmThreadId(npc.id, member.id);
        let thread = threads.find(t => t.id === tid);
        if (!thread) {
            thread = { id: tid, kind: 'dm', memberIds: [npc.id, member.id], messages: [] };
            threads.push(thread);
        }
        for (const line of dm.lines) {
            if (!line) continue;
            pushMsg(thread, { id: genId('wm'), fromId: npc.id, fromName: npc.name, text: line, round, storyTime, timestamp: now });
        }
    }
}

/**
 * NPC 的私信收件箱：成员发给各 NPC、但 NPC 还没回（最后一条不是该 NPC 发的）的私聊线程。
 * 供世界引擎参考，让 NPC 这一轮回复。
 */
export function npcInboxes(world: WorldProfile): { npcName: string; memberName: string; recent: string }[] {
    const out: { npcName: string; memberName: string; recent: string }[] = [];
    const npcIds = new Map(world.npcs.map(n => [n.id, n.name]));
    for (const t of world.threads || []) {
        if (t.kind !== 'dm' || t.messages.length === 0) continue;
        const npcId = t.memberIds.find(id => npcIds.has(id));
        const memberId = t.memberIds.find(id => !npcIds.has(id));
        if (!npcId || !memberId) continue;
        const last = t.messages[t.messages.length - 1];
        if (last.fromId === npcId) continue; // NPC 已回过，跳过
        const recent = t.messages.slice(-6).map(m => `${m.fromName}：${m.text}`).join('\n');
        out.push({ npcName: npcIds.get(npcId)!, memberName: t.messages.find(m => m.fromId === memberId)?.fromName || '', recent });
    }
    return out;
}

/** 取与某成员相关的 dm 线程（手机 UI / prompt 共用）。 */
export function dmThreadsOf(world: WorldProfile, charId: string): WorldThread[] {
    return (world.threads || []).filter(t => t.kind === 'dm' && t.memberIds.includes(charId) && t.messages.length > 0);
}

export function groupThreadOf(world: WorldProfile): WorldThread | null {
    return (world.threads || []).find(t => t.id === GROUP_THREAD_ID) || null;
}

/**
 * 把线程格式化进 prompt（尾部 limit 条）。
 * currentRound 的消息标【刚刚】——通常是同一轮里先演绎的人刚发来的，提醒模型这是新消息。
 */
export function formatThreadForPrompt(thread: WorldThread, selfId: string, limit: number, currentRound: number): string {
    const msgs = thread.messages.slice(-limit);
    if (msgs.length === 0) return '（还没有消息）';
    return msgs.map(m => {
        const who = m.fromId === selfId ? '你' : m.fromName;
        const tag = m.round === currentRound ? '【刚刚】' : `[${m.storyTime}]`;
        return `${tag} ${who}：${m.text}`;
    }).join('\n');
}
