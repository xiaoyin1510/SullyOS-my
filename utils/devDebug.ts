// ===== 捕获类别（分类日志的"单一真理源"）=====
// 加新类只动这里：
//   1. 在 DevDebugCaptureCategory 加一个字面量
//   2. 在 DEV_DEBUG_CAPTURE_CATEGORIES 加一行（面板会自动多出一个开关）
//   3. 写一个语义化的 appendDevDebugXxxLog 薄封装（见文件末尾 appendDevDebugLlmLog）
// 其余存储 / 脱敏 / 限容 / 导出逻辑全部通用，不用改。
export type DevDebugCaptureCategory = 'llm';

export interface DevDebugCaptureCategoryMeta {
    key: DevDebugCaptureCategory;
    title: string;
    detail: string;
}

export const DEV_DEBUG_CAPTURE_CATEGORIES: DevDebugCaptureCategoryMeta[] = [
    {
        key: 'llm',
        title: '记录 LLM 日志',
        detail: '抓 chat completions 的请求和 raw response，取消勾选后清空该类日志。',
    },
];

const CAPTURE_CATEGORY_KEYS: DevDebugCaptureCategory[] = DEV_DEBUG_CAPTURE_CATEGORIES.map((c) => c.key);

export interface DevDebugFlags {
    skipPromptBuild: boolean;
    skipEmotionEval: boolean;
    /** 勾选了哪些捕获类别，就抓哪几类。取代旧的扁平 captureLlmLog 开关。 */
    captureLogs: DevDebugCaptureCategory[];
    /**
     * 导出（复制 / 下载）时是否输出完整内容。
     * 默认 false：长文本折叠成「前 N 字 + ...」，省隐私 / 省体积。
     * 只影响导出那一层，不改变实际抓取 / 存储的数据。
     */
    exposeLogDetail: boolean;
}

export interface DevDebugLogEntry {
    id: string;
    timestamp: string;
    category: DevDebugCaptureCategory;
    /** 列表 / 导出里用的一行摘要，比如 "POST https://.../chat/completions"。 */
    label?: string;
    /** 抓取时是否折叠了长文本（即抓的那一刻没开 exposeLogDetail）。 */
    collapsed?: boolean;
    /** 该类自定义的 payload，写入前会递归脱敏；默认还会折叠长文本。 */
    data: unknown;
}

export interface DevDebugFloatingPosition {
    x: number;
    y: number;
}

export const DEV_DEBUG_STORAGE_KEY = 'sullyos.devDebug.flags.v1';
export const DEV_DEBUG_EVENT = 'sullyos-dev-debug-change';
export const DEV_DEBUG_LOG_STORAGE_KEY = 'sullyos.devDebug.log.v1';
export const DEV_DEBUG_LOG_EVENT = 'sullyos-dev-debug-log-change';
export const DEV_DEBUG_POSITION_STORAGE_KEY = 'sullyos.devDebug.position.v1';

export const DEFAULT_DEV_DEBUG_FLAGS: DevDebugFlags = {
    skipPromptBuild: false,
    skipEmotionEval: false,
    captureLogs: [],
    exposeLogDetail: false,
};

const MAX_LOG_ENTRIES = 100;
const MAX_LOG_STORAGE_CHARS = 1_000_000;
// 折叠时长字符串只保留前 N 个字符，后面接 "..."。
const LOG_COLLAPSE_HEAD = 10;
const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|token|secret|endpoint|p256dh|auth)$/i;
let memoryLog: DevDebugLogEntry[] | null = null;

function normalizeStorageKeyPart(value: string): string {
    return value.trim().replace(/[^a-z0-9._-]+/gi, '_') || 'unknown';
}

function getBuildBranch(): string {
    return typeof __BUILD_BRANCH__ !== 'undefined' ? __BUILD_BRANCH__ : 'unknown';
}

function getScopedStorageKey(baseKey: string): string {
    return `${baseKey}.${normalizeStorageKeyPart(getBuildBranch())}`;
}

function canUseDevDebugStorage(): boolean {
    return isDevDebugAvailable() && typeof window !== 'undefined';
}

function normalizeCaptureLogs(value: unknown): DevDebugCaptureCategory[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<DevDebugCaptureCategory>();
    for (const item of value) {
        if (CAPTURE_CATEGORY_KEYS.includes(item as DevDebugCaptureCategory)) {
            seen.add(item as DevDebugCaptureCategory);
        }
    }
    return [...seen];
}

function normalizeFlags(value: unknown): DevDebugFlags {
    const source = (value && typeof value === 'object') ? value as Partial<DevDebugFlags> : {};
    return {
        skipPromptBuild: source.skipPromptBuild === true,
        skipEmotionEval: source.skipEmotionEval === true,
        captureLogs: normalizeCaptureLogs(source.captureLogs),
        exposeLogDetail: source.exposeLogDetail === true,
    };
}

function normalizePosition(value: unknown): DevDebugFloatingPosition | null {
    const source = (value && typeof value === 'object') ? value as Partial<DevDebugFloatingPosition> : null;
    if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) return null;
    return {
        x: Math.round(Number(source.x)),
        y: Math.round(Number(source.y)),
    };
}

export function isDevDebugAvailable(): boolean {
    return typeof __BUILD_BADGE_VISIBLE__ !== 'undefined' && __BUILD_BADGE_VISIBLE__;
}

export function readDevDebugFlags(): DevDebugFlags {
    if (!canUseDevDebugStorage()) return DEFAULT_DEV_DEBUG_FLAGS;

    try {
        const raw = window.localStorage.getItem(getScopedStorageKey(DEV_DEBUG_STORAGE_KEY));
        if (!raw) return DEFAULT_DEV_DEBUG_FLAGS;
        return normalizeFlags(JSON.parse(raw));
    } catch {
        return DEFAULT_DEV_DEBUG_FLAGS;
    }
}

export function writeDevDebugFlags(flags: DevDebugFlags): DevDebugFlags {
    const next = normalizeFlags(flags);
    if (!canUseDevDebugStorage()) return next;
    const prev = readDevDebugFlags();

    try {
        window.localStorage.setItem(getScopedStorageKey(DEV_DEBUG_STORAGE_KEY), JSON.stringify(next));
    } catch {
        // localStorage can be blocked in private / embedded contexts; the UI still keeps local state.
    }

    // 被取消勾选的类别：清掉它已经抓到的日志，不动其它类别。
    const removed = prev.captureLogs.filter((category) => !next.captureLogs.includes(category));
    if (removed.length > 0) {
        clearDevDebugLog(removed);
    }

    window.dispatchEvent(new CustomEvent<DevDebugFlags>(DEV_DEBUG_EVENT, { detail: next }));
    return next;
}

export function readDevDebugPosition(): DevDebugFloatingPosition | null {
    if (!canUseDevDebugStorage()) return null;

    try {
        const raw = window.localStorage.getItem(getScopedStorageKey(DEV_DEBUG_POSITION_STORAGE_KEY));
        if (!raw) return null;
        return normalizePosition(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function writeDevDebugPosition(position: DevDebugFloatingPosition): void {
    if (!canUseDevDebugStorage()) return;

    const next = normalizePosition(position);
    if (!next) return;

    try {
        window.localStorage.setItem(getScopedStorageKey(DEV_DEBUG_POSITION_STORAGE_KEY), JSON.stringify(next));
    } catch {
        // localStorage can be blocked in private / embedded contexts; dragging still works in memory.
    }
}

export function updateDevDebugFlags(updater: (flags: DevDebugFlags) => DevDebugFlags): DevDebugFlags {
    return writeDevDebugFlags(updater(readDevDebugFlags()));
}

export function subscribeDevDebugFlags(listener: (flags: DevDebugFlags) => void): () => void {
    if (typeof window === 'undefined') return () => {};

    const storageKey = getScopedStorageKey(DEV_DEBUG_STORAGE_KEY);
    const onChange = (event: Event) => {
        const detail = (event as CustomEvent<DevDebugFlags>).detail;
        listener(detail ? normalizeFlags(detail) : readDevDebugFlags());
    };
    const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) listener(readDevDebugFlags());
    };

    window.addEventListener(DEV_DEBUG_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(DEV_DEBUG_EVENT, onChange);
        window.removeEventListener('storage', onStorage);
    };
}

export function isPromptBuildSkipped(): boolean {
    return readDevDebugFlags().skipPromptBuild;
}

export function isEmotionEvalSkipped(): boolean {
    return readDevDebugFlags().skipEmotionEval;
}

export function isCaptureEnabled(category: DevDebugCaptureCategory): boolean {
    return readDevDebugFlags().captureLogs.includes(category);
}

/** 语义别名：等价于 isCaptureEnabled('llm')，给现有 LLM 消费点用。 */
export function isLlmLogCaptureEnabled(): boolean {
    return isCaptureEnabled('llm');
}

function redactSecrets(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactSecrets);
    if (!value || typeof value !== 'object') return value;

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY_PATTERN.test(key)) {
            out[key] = '<redacted>';
        } else {
            out[key] = redactSecrets(item);
        }
    }
    return out;
}

function safeJsonValue(value: unknown): unknown {
    if (value === undefined) return undefined;
    try {
        return redactSecrets(JSON.parse(JSON.stringify(value)));
    } catch {
        return String(value);
    }
}

function parseRequestBody(body: unknown): unknown {
    if (body === undefined || body === null) return undefined;
    if (typeof body !== 'string') return body;
    try {
        return JSON.parse(body);
    } catch {
        return body;
    }
}

// 递归把长字符串折叠成「前 N 字 + ...」；数字 / 布尔 / 短字符串原样保留，只动 value 不动 key。
function collapseLongStrings(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.length > LOG_COLLAPSE_HEAD ? `${value.slice(0, LOG_COLLAPSE_HEAD)}...` : value;
    }
    if (Array.isArray(value)) return value.map(collapseLongStrings);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            out[key] = collapseLongStrings(item);
        }
        return out;
    }
    return value;
}

function readPersistedLog(): DevDebugLogEntry[] {
    if (memoryLog) return memoryLog;
    if (!canUseDevDebugStorage()) {
        memoryLog = [];
        return memoryLog;
    }
    try {
        const raw = window.localStorage.getItem(getScopedStorageKey(DEV_DEBUG_LOG_STORAGE_KEY));
        const parsed = raw ? JSON.parse(raw) : [];
        memoryLog = Array.isArray(parsed) ? parsed : [];
    } catch {
        memoryLog = [];
    }
    return memoryLog;
}

function emitLogChange(entries: DevDebugLogEntry[]): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<DevDebugLogEntry[]>(DEV_DEBUG_LOG_EVENT, { detail: entries }));
}

function persistLog(entries: DevDebugLogEntry[]): void {
    memoryLog = entries;
    if (canUseDevDebugStorage()) {
        try {
            window.localStorage.setItem(getScopedStorageKey(DEV_DEBUG_LOG_STORAGE_KEY), JSON.stringify(entries));
        } catch {
            // Keep the in-memory log even when localStorage is full or blocked.
        }
    }
    emitLogChange(entries);
}

/** 读取捕获日志；传 category 只取该类，不传取全部。 */
export function readDevDebugLog(category?: DevDebugCaptureCategory): DevDebugLogEntry[] {
    const all = [...readPersistedLog()];
    return category ? all.filter((entry) => entry.category === category) : all;
}

/** 清空日志；传 categories 只清这几类，不传清全部。 */
export function clearDevDebugLog(categories?: DevDebugCaptureCategory[]): void {
    if (!categories || categories.length === 0) {
        memoryLog = [];
        if (canUseDevDebugStorage()) {
            try {
                window.localStorage.removeItem(getScopedStorageKey(DEV_DEBUG_LOG_STORAGE_KEY));
            } catch {
                // ignore
            }
        }
        emitLogChange([]);
        return;
    }

    const remaining = readPersistedLog().filter((entry) => !categories.includes(entry.category));
    persistLog(remaining);
}

/**
 * 通用捕获入口：所有分类日志都走这里。
 * 自带门禁（该类没勾就空操作）、脱敏、折叠、限容、双写（内存 + localStorage）、广播，调用方不用操心。
 * 默认折叠长文本后再落库（省 localStorage 体积 / 隐私），只有开了 exposeLogDetail 才整段存——
 * 所以"要完整内容"得先开 expose 再复现，已抓的折叠版无法事后还原。
 */
export function appendDevDebugLog(category: DevDebugCaptureCategory, input: { label?: string; data: unknown }): void {
    try {
        if (!isCaptureEnabled(category)) return;

        const exposed = readDevDebugFlags().exposeLogDetail;
        const safeData = safeJsonValue(input.data);
        const entry: DevDebugLogEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            category,
            label: input.label,
            collapsed: !exposed,
            data: exposed ? safeData : collapseLongStrings(safeData),
        };

        const next = [...readPersistedLog(), entry].slice(-MAX_LOG_ENTRIES);
        while (next.length > 1 && JSON.stringify(next).length > MAX_LOG_STORAGE_CHARS) {
            next.shift();
        }
        persistLog(next);
    } catch (e) {
        console.error('Failed to append dev debug log', e);
    }
}

/** LLM 类的语义化薄封装，保持现有消费点（safeApi / activeMsgRuntime / instantPushClient）调用不变。 */
export function appendDevDebugLlmLog(input: {
    url: string;
    method?: string;
    status?: number;
    requestBody?: unknown;
    response?: unknown;
    error?: unknown;
}): void {
    appendDevDebugLog('llm', {
        label: `${input.method ?? 'POST'} ${input.url}`,
        data: {
            url: input.url,
            method: input.method,
            status: input.status,
            request: parseRequestBody(input.requestBody),
            response: input.response,
            error: input.error
                ? {
                    name: (input.error as any)?.name,
                    message: (input.error as any)?.message || String(input.error),
                }
                : undefined,
        },
    });
}

/**
 * 把捕获日志格式化成可复制 / 可下载的 JSON 文本；传 category 只导该类，无日志返回空串。
 * 折叠在写入层就做完了，这里直接吐存的内容；带 `collapsed` 的条目即抓取时没开 exposeLogDetail。
 */
export function formatDevDebugLog(category?: DevDebugCaptureCategory): string {
    const entries = readDevDebugLog(category);
    if (entries.length === 0) return '';

    const hasCollapsed = entries.some((entry) => entry.collapsed);
    return JSON.stringify({
        exportedAt: new Date().toISOString(),
        build: {
            branch: typeof __BUILD_BRANCH__ !== 'undefined' ? __BUILD_BRANCH__ : 'unknown',
            commit: typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown',
        },
        ...(hasCollapsed
            ? { note: `部分条目抓取时已折叠长文本（前 ${LOG_COLLAPSE_HEAD} 字 + "..."）；想要完整内容请先在面板开「导出完整内容」再复现。` }
            : {}),
        entries,
    }, null, 2);
}

export function subscribeDevDebugLog(listener: (entries: DevDebugLogEntry[]) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const onChange = (event: Event) => {
        const detail = (event as CustomEvent<DevDebugLogEntry[]>).detail;
        listener(Array.isArray(detail) ? [...detail] : readDevDebugLog());
    };
    window.addEventListener(DEV_DEBUG_LOG_EVENT, onChange);
    return () => window.removeEventListener(DEV_DEBUG_LOG_EVENT, onChange);
}
