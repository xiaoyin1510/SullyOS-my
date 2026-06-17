/**
 * 「家园」离线 tick 调度器。
 *
 * 与 VRScheduler 的"固定间隔"不同，家园按**每日时段**触发：
 * 早（09:00 后）/ 午（14:00 后）/ 晚（21:00 后），每个时段当天最多一轮。
 * 错过时段后回到前台会补火（和 VRScheduler 一样的 visibilitychange / focus /
 * 主线程轮询三重兜底），所以"早上没开 App，中午打开"会把早上那轮补上——
 * 这正是"我不看的时候世界慢慢走，我一看就加速"的体验。
 *
 * 存储（localStorage，独立键，不与 vr_schedules / proactive 挤占）：
 *   - world_tick_slots: { [worldId]: ('morning'|'noon'|'evening')[] }
 *   - world_tick_fired: { [worldId]: { date: 'YYYY-MM-DD', fired: slot[] } }
 */

export type WorldTickSlot = 'morning' | 'noon' | 'evening';

const SLOTS_KEY = 'world_tick_slots';
const FIRED_KEY = 'world_tick_fired';
const MAIN_THREAD_CHECK_INTERVAL = 60_000;

/** 各时段的起火时刻（小时，本地时间）。 */
const SLOT_HOUR: Record<WorldTickSlot, number> = { morning: 9, noon: 14, evening: 21 };

type SlotsMap = Record<string, WorldTickSlot[]>;
type FiredMap = Record<string, { date: string; fired: WorldTickSlot[] }>;

function load<T>(key: string): T {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' ? parsed : {}) as T;
    } catch {
        return {} as T;
    }
}

function save(key: string, value: object) {
    if (Object.keys(value).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
}

const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let triggerCallback: ((worldId: string, trigger: 'observe' | 'tick') => void | Promise<void>) | null = null;
let visibilityListener: (() => void) | null = null;
let focusListener: (() => void) | null = null;
let mainThreadTimer: ReturnType<typeof setInterval> | null = null;

function checkDue() {
    if (!triggerCallback) return;
    const slotsMap = load<SlotsMap>(SLOTS_KEY);
    const firedMap = load<FiredMap>(FIRED_KEY);
    const date = todayKey();
    const hour = new Date().getHours();
    let changed = false;

    for (const [worldId, slots] of Object.entries(slotsMap)) {
        if (!Array.isArray(slots) || slots.length === 0) continue;
        let rec = firedMap[worldId];
        if (!rec || rec.date !== date) {
            rec = { date, fired: [] };
            firedMap[worldId] = rec;
            changed = true;
        }
        for (const slot of slots) {
            if (rec.fired.includes(slot)) continue;
            if (hour < SLOT_HOUR[slot]) continue;
            rec.fired.push(slot);
            changed = true;
            void triggerCallback(worldId, 'tick');
            // 一次 check 每个世界最多补一轮：链式 N 角色调用很贵，
            // 错过的多个时段隔分钟级轮询逐个补，不在同一瞬间叠加触发。
            break;
        }
    }
    if (changed) save(FIRED_KEY, firedMap);
}

function handleVisibility() {
    if (document.visibilityState !== 'visible') return;
    checkDue();
}

function attachListeners() {
    detachListeners();
    visibilityListener = handleVisibility;
    document.addEventListener('visibilitychange', visibilityListener);
    focusListener = checkDue;
    window.addEventListener('focus', focusListener);
    if (!mainThreadTimer) mainThreadTimer = setInterval(checkDue, MAIN_THREAD_CHECK_INTERVAL);
}

function detachListeners() {
    if (visibilityListener) {
        document.removeEventListener('visibilitychange', visibilityListener);
        visibilityListener = null;
    }
    if (focusListener) {
        window.removeEventListener('focus', focusListener);
        focusListener = null;
    }
    if (mainThreadTimer) {
        clearInterval(mainThreadTimer);
        mainThreadTimer = null;
    }
}

export const WorldScheduler = {
    /** 注册触发回调（应用启动时调一次）。 */
    onTrigger(callback: (worldId: string, trigger: 'observe' | 'tick') => void | Promise<void>) {
        triggerCallback = callback;
        if (Object.keys(load<SlotsMap>(SLOTS_KEY)).length > 0) {
            attachListeners();
            checkDue();
        }
    },

    /**
     * 以世界配置为准重建调度表。
     * 调度表存 localStorage 不随备份迁移，世界配置（offlineTickSlots）存 IndexedDB
     * 随备份走——和 VRScheduler.reconcile 同样的对账逻辑。
     * 注意：新加入调度的世界，"今天已经过去的时段"视为已耗尽，不补火——
     * 避免用户刚配置完就瞬间连烧几轮 LLM 调用。
     */
    reconcile(active: { worldId: string; slots: WorldTickSlot[] }[]) {
        const slotsMap: SlotsMap = {};
        const firedMap = load<FiredMap>(FIRED_KEY);
        const date = todayKey();
        const hour = new Date().getHours();
        let firedChanged = false;

        for (const a of active) {
            if (a.slots.length === 0) continue;
            slotsMap[a.worldId] = a.slots;
            if (!firedMap[a.worldId] || firedMap[a.worldId].date !== date) {
                firedMap[a.worldId] = { date, fired: a.slots.filter(s => hour >= SLOT_HOUR[s]) };
                firedChanged = true;
            }
        }
        for (const id of Object.keys(firedMap)) {
            if (!slotsMap[id]) {
                delete firedMap[id];
                firedChanged = true;
            }
        }

        save(SLOTS_KEY, slotsMap);
        if (firedChanged) save(FIRED_KEY, firedMap);
        if (Object.keys(slotsMap).length > 0) attachListeners();
        else detachListeners();
    },

    /** 立刻触发一轮"观测"（UI 推进按钮用），不占用当日 tick 配额。 */
    triggerNow(worldId: string) {
        if (triggerCallback) void triggerCallback(worldId, 'observe');
    },
};
