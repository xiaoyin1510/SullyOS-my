/**
 * Memory Palace (记忆宫殿) — 类型定义
 *
 * 模拟人脑七个脑区的记忆系统。
 * 所有类型定义集中在此文件，供其他模块导入。
 */

// ─── 七个房间 ─────────────────────────────────────────

export type MemoryRoom =
    | 'living_room'   // 客厅 — 日常闲聊、近期互动（海马体）
    | 'bedroom'       // 卧室 — 亲密情感、深层羁绊（新皮层）
    | 'study'         // 书房 — 工作学习、技能成长（前额叶）
    | 'user_room'     // 用户房间 — 用户个人信息、习惯（颞顶联合区）
    | 'self_room'     // 自我房间 — 角色自我认同、演变（默认模式网络）
    | 'attic'         // 阁楼 — 未消化的困惑、潜意识（杏仁核–海马体）
    | 'windowsill';   // 窗台 — 期盼、目标、憧憬（多巴胺奖赏系统）

export interface RoomConfig {
    capacity: number | null;    // null = 无限
    decayRate: number | null;   // null = 永不遗忘，数值为每小时衰减基数
    description: string;
}

export const ROOM_CONFIGS: Record<MemoryRoom, RoomConfig> = {
    living_room: { capacity: 200,  decayRate: 0.9972, description: '日常闲聊、近期互动' },
    bedroom:     { capacity: null, decayRate: 0.9995, description: '亲密情感、深层羁绊' },
    study:       { capacity: null, decayRate: 0.9995, description: '工作学习、技能成长' },
    user_room:   { capacity: null, decayRate: 0.9995, description: '用户个人信息、习惯' },
    self_room:   { capacity: null, decayRate: null,   description: '角色自我认同、演变' },
    attic:       { capacity: null, decayRate: null,   description: '未消化的困惑、潜意识' },
    windowsill:  { capacity: null, decayRate: null,   description: '期盼、目标、憧憬' },
};

export const ROOM_LABELS: Record<MemoryRoom, string> = {
    living_room: '客厅',
    bedroom:     '卧室',
    study:       '书房',
    user_room:   '用户房间',
    self_room:   '自我房间',
    attic:       '阁楼',
    windowsill:  '窗台',
};

/**
 * 获取房间的动态显示标签。
 * user_room 在有用户名时显示为"【用户名】的房间"，其余房间返回静态标签。
 */
export function getRoomLabel(room: MemoryRoom, userName?: string): string {
    if (room === 'user_room' && userName) {
        return `${userName}的房间`;
    }
    return ROOM_LABELS[room];
}

// ─── 记忆节点 ─────────────────────────────────────────

export interface MemoryNode {
    id: string;
    charId: string;
    content: string;            // 记忆内容（提取记忆为第三人称叙事，消化衍生记忆为第一人称内心独白）
    room: MemoryRoom;
    tags: string[];
    importance: number;         // 1–10
    mood: string;               // 情绪标签，如 'happy', 'sad', 'angry'
    /** Russell 环形情感模型 · 效价：-1 极痛苦 → +1 极愉悦。未填则由 emotionSpace.getEmotionVA() 查表兜底 */
    valence?: number;
    /** Russell 环形情感模型 · 唤醒度：-1 极平静 → +1 极激烈 */
    arousal?: number;
    embedded: boolean;          // 是否已向量化
    createdAt: number;          // timestamp ms
    lastAccessedAt: number;     // timestamp ms
    accessCount: number;
    pinnedUntil?: number | null; // 便利贴置顶截止时间（timestamp ms），null/undefined = 不置顶
    sourceId?: string | null;   // 消化衍生记忆的源记忆 ID，null = 非衍生记忆
    origin?: 'extraction' | 'digestion' | 'system'; // 记忆来源：extraction=聊天提取, digestion=认知消化衍生, system=系统生成

    // ─── EventBox 绑定（新） ─────────────────
    eventBoxId?: string | null;  // 所属事件盒 ID，null/undefined = 独立记忆（"地上的球"）
    archived?: boolean;          // true = 已被压入 box summary，不再参与召回（可复活）
    isBoxSummary?: boolean;      // true = 此节点是某 EventBox 的压缩总结

    // ─── 群聊记忆来源（独立管线，私聊代码不感知这两个字段） ─────────────
    /** 这条记忆来自哪个群（groupPipeline 提取时打上）；undefined = 来自私聊 */
    groupId?: string;
    /** 群名快照（用于群被删除后仍能在 UI 里识别这条记忆来自哪个群） */
    groupName?: string;

    // ─── 已弃用字段（保留以兼容历史数据读取，新代码不应写入） ───
    /** @deprecated 旧话题盒 ID，已由 eventBoxId 替代 */
    boxId?: string;
    /** @deprecated 旧话题摘要，已废弃 */
    boxTopic?: string;
}

// ─── 向量存储 ─────────────────────────────────────────

export interface MemoryVector {
    memoryId: string;           // 关联 MemoryNode.id
    charId: string;             // 冗余角色 ID，用于 IndexedDB 索引直查，避免全表扫描
    // 1024 维向量。三种形态：
    //   - 在内存里检索时是 Float32Array（4 bytes / dim）
    //   - 写入 IndexedDB 时是 Uint8Array（Float32 的原始字节，4 bytes / dim）
    //   - 旧数据是 number[]（每个 number ~50 字节，惊人浪费），读取时会被透明
    //     地转换并在下次写入时持久化为 Uint8Array。
    // 出 DB 层之后调用方拿到的永远是 Float32Array。
    vector: number[] | Float32Array | Uint8Array;
    dimensions: number;
    model?: string;             // 生成此向量的 embedding 模型名（用于换模型检测）
}

// ─── 关联网络 ─────────────────────────────────────────

export type LinkType =
    | 'temporal'    // 时间关联 — 24h 内创建的记忆
    | 'emotional'   // 情感关联 — 相同情绪标签
    | 'causal'      // 因果关联
    | 'person'      // 人物关联 — 提到同一人
    | 'metaphor';   // 隐喻关联

export interface MemoryLink {
    id: string;
    sourceId: string;           // MemoryNode.id
    targetId: string;           // MemoryNode.id
    type: LinkType;
    strength: number;           // 0–1，共同激活时 +0.05
}

// ─── 事件盒 (EventBox) ─────────────────────────────────

/**
 * EventBox —— 把同一件事的多条记忆绑在一起。
 *
 * 创建方式：
 * - LLM 在提取新记忆时，通过 relatedTo 指向旧记忆 → 自动建盒/加盒/合并
 * - 用户在 UI 里手动"+ 添加关联"
 *
 * 召回方式：命中盒内任一"活"节点 → 整盒（summary + 所有活节点）一起出，算 1 个名额
 *
 * 压缩：活节点达到 COMPRESSION_THRESHOLD (4) 条 →
 * LLM 把"旧 summary? + 新活节点"整合成一个新 summary MemoryNode，
 * 原活节点全部 archived=true 不再参与召回，box.compressionCount++
 */
export interface EventBox {
    id: string;                     // eb_xxx
    charId: string;
    name: string;                   // 盒名（LLM 生成，首次创建时给）
    tags: string[];                 // 详细 tag，便于搜索（LLM 生成）
    summaryNodeId: string | null;   // 压缩总结节点的 MemoryNode.id；null = 未压缩过
    liveMemoryIds: string[];        // 活节点：参与召回的原始记忆
    archivedMemoryIds: string[];    // 灰节点：已被压入 summary，不参与召回（可复活）
    compressionCount: number;       // 压缩过几次
    createdAt: number;
    updatedAt: number;
    lastCompressedAt: number | null;
    /** 是否已封盒。封盒后不再接收新成员，新相关记忆会另建一个盒。召回仍正常。 */
    sealed?: boolean;
    /** 封盒后若有新相关记忆，新建盒会把旧盒 id 记在这里供追溯（非召回路径使用）。 */
    predecessorBoxId?: string | null;
}

/** 活节点达到此条数时触发压缩 */
export const EVENT_BOX_COMPRESSION_THRESHOLD = 4;

/** 活节点数硬上限：binding 时如果当前开盒已达此数，视作满员，另开新盒
 *  （带 predecessorBoxId）。防御屏障：LLM 压缩连续失败不会让单盒无限膨胀
 *  到 40+ 条活节点，后果是整盒再也压不动（token 爆、UI 卡）。
 *  比 COMPRESSION_THRESHOLD 大很多是为了给正常的"多批次待压缩"留出缓冲。 */
export const EVENT_BOX_LIVE_HARD_CAP = 15;

/** 盒内事件总数（archived + live）达到此值后封盒，之后的相关记忆另开新盒 */
export const EVENT_BOX_SEAL_THRESHOLD = 12;

/** summary 目标字数（prompt 引导）+ 硬上限（超过强制截断） */
export const EVENT_BOX_SUMMARY_TARGET_CHARS = 500;
export const EVENT_BOX_SUMMARY_HARD_MAX_CHARS = 800;

// ─── 旧话题盒（已废弃，代码路径已摘除，类型保留以兼容残留数据读取） ──

/** @deprecated */
export type BoxStatus = 'open' | 'sealed';

/** @deprecated 旧 TopicLoom 话题盒，已由 EventBox 替代 */
export interface TopicBox {
    id: string;
    charId: string;
    messageIds: number[];
    status: BoxStatus;
    topic: string;
    events: string[];
    keywords: string[];
    createdAt: number;
    sealedAt: number | null;
}

/** @deprecated */
export type TopicContinuity = 'continuous' | 'partial_shift' | 'discontinuous';

// ─── 期盼（窗台） ─────────────────────────────────────

export type AnticipationStatus = 'active' | 'anchor' | 'fulfilled' | 'disappointed';

export interface Anticipation {
    id: string;
    charId: string;
    content: string;
    status: AnticipationStatus;
    createdAt: number;
    anchoredAt: number | null;  // active → anchor 的时间
    resolvedAt: number | null;  // fulfilled / disappointed 的时间
}

// ─── 处理批次日志 ─────────────────────────────────────

export interface MemoryBatch {
    id: string;
    charId: string;
    boxId: string;
    status: 'pending' | 'processing' | 'done' | 'error';
    nodesCreated: number;
    error: string | null;
    createdAt: number;
    completedAt: number | null;
}

// ─── 人格风格（影响扩散激活权重） ─────────────────────

export type PersonalityStyle = 'emotional' | 'narrative' | 'imagery' | 'analytical';

/** 每种人格风格对五种关联类型的权重 */
export const PERSONALITY_WEIGHTS: Record<PersonalityStyle, Record<LinkType, number>> = {
    emotional:  { emotional: 1.0, person: 0.6, metaphor: 0.5, temporal: 0.3, causal: 0.2 },
    narrative:  { temporal: 1.0, person: 0.8, causal: 0.4, emotional: 0.3, metaphor: 0.2 },
    imagery:    { metaphor: 1.0, emotional: 0.5, temporal: 0.3, person: 0.3, causal: 0.2 },
    analytical: { causal: 1.0, temporal: 0.4, person: 0.3, emotional: 0.2, metaphor: 0.2 },
};

// ─── Embedding 配置（独立于聊天 API） ─────────────────

export interface EmbeddingConfig {
    baseUrl: string;            // OpenAI 兼容端点，如 https://api.siliconflow.cn/v1
    apiKey: string;
    model: string;              // 默认 text-embedding-3-small
    dimensions: number;         // 默认 1024
}

// ─── 远程向量存储配置 (Supabase pgvector) ────────────

export interface RemoteVectorConfig {
    enabled: boolean;
    supabaseUrl: string;        // e.g. https://xxxxx.supabase.co
    supabaseAnonKey: string;    // anon / public key
    initialized: boolean;       // 是否已建表
}

// ─── 检索结果 ─────────────────────────────────────────

export interface ScoredMemory {
    node: MemoryNode;
    finalScore: number;
    similarity: number;         // 向量余弦相似度
    bm25Score: number;          // BM25 分数
    roomScore: number;          // 房间评分后的最终分
}
