/**
 * Memory Dive (记忆潜行) — 类型定义
 *
 * 交互式 RPG 探索模式：用户在像素小屋中与角色一起探索记忆。
 * 退出后角色不记得发生过什么，但用户会获得一个临时 buff。
 */

import type { MemoryRoom } from '../../utils/memoryPalace/types';

// ─── 探索模式 ────────────────────────────────────────────

/** 角色引领 vs 自由探索 */
export type DiveMode = 'guided' | 'free';

/** 潜行阶段 */
export type DivePhase = 'intro' | 'exploring' | 'dialogue' | 'outro';

// ─── 对话系统 ────────────────────────────────────────────

export interface DiveDialogue {
  id: string;
  speaker: 'character' | 'narrator' | 'user_choice';
  text: string;
  /** 用户选项（仅 speaker === 'user_choice' 时有值） */
  choices?: DiveChoice[];
  /** 关联的家具槽位 ID（触发来源） */
  triggeredBy?: string;
  timestamp: number;
}

export interface DiveChoice {
  id: string;
  text: string;
  /** 选择后对 buff 的影响 */
  buffEffect?: Partial<DiveBuffValues>;
  /** 标记特殊行为 */
  action?: 'comfort' | 'question' | 'observe' | 'leave' | 'unlock';
}

// ─── Buff 系统 ───────────────────────────────────────────

export interface DiveBuffValues {
  empathy: number;    // 共情 — 倾听、安慰时累积
  trust: number;      // 信任 — 尊重角色意愿、不强行查看
  insight: number;    // 洞察 — 提问、探索细节
  bond: number;       // 羁绊 — 一起回忆美好时刻
}

export type BuffType = keyof DiveBuffValues;

export interface DiveBuff {
  type: BuffType;
  label: string;
  value: number;
  icon: string;
  description: string;
}

export const BUFF_META: Record<BuffType, { label: string; icon: string; description: string }> = {
  empathy: { label: '共情', icon: '💗', description: '你认真倾听了ta的记忆' },
  trust:   { label: '信任', icon: '🤝', description: '你尊重了ta的边界' },
  insight: { label: '洞察', icon: '🔍', description: '你发现了隐藏的细节' },
  bond:    { label: '羁绊', icon: '✨', description: '你们一起重温了珍贵的回忆' },
};

// ─── 房间探索状态 ────────────────────────────────────────

export interface RoomExploreState {
  roomId: MemoryRoom;
  /** 该房间中已触发对话的家具 */
  visitedSlots: Set<string>;
  /** 是否有"锁住"的内容（阁楼等敏感房间） */
  hasLockedContent: boolean;
  /** 是否已解锁 */
  unlocked: boolean;
}

// ─── 整体潜行会话 ────────────────────────────────────────

export interface DiveSession {
  charId: string;
  charName: string;
  mode: DiveMode;
  phase: DivePhase;
  currentRoom: MemoryRoom;
  /** 玩家在房间中的位置 (%) */
  playerPos: { x: number; y: number };
  /** 角色在房间中的位置 (%) */
  charPos: { x: number; y: number };
  /** 对话历史 */
  dialogues: DiveDialogue[];
  /** 各房间探索状态 */
  roomStates: Map<MemoryRoom, RoomExploreState>;
  /** 累积 buff 值 */
  buffValues: DiveBuffValues;
  /** 已访问的房间列表 */
  visitedRooms: MemoryRoom[];
  /** 是否正在等待 LLM 回复 */
  isLoading: boolean;
  startedAt: number;
}

// ─── LLM 请求/响应 ───────────────────────────────────────

export interface DiveLLMRequest {
  charId: string;
  charName: string;
  room: MemoryRoom;
  slotId?: string;
  slotName?: string;
  slotCategory?: string;
  /** 从记忆宫殿检索到的相关记忆 */
  memories: string[];
  /** 探索模式 */
  mode: DiveMode;
  /** 用户的选择（如果是回复对话） */
  userChoice?: DiveChoice;
  /** 之前的对话上下文（最近5条） */
  recentDialogues: DiveDialogue[];
  /** 当前累积的 buff */
  currentBuffs: DiveBuffValues;
}

export interface DiveLLMResponse {
  /** 角色的对话/旁白 */
  dialogues: Array<{
    speaker: 'character' | 'narrator';
    text: string;
  }>;
  /** 给用户的选项 */
  choices?: Array<{
    text: string;
    action: DiveChoice['action'];
    buffEffect?: Partial<DiveBuffValues>;
  }>;
  /** 角色是否抗拒（阁楼等） */
  isReluctant?: boolean;
  /** 引导模式下，角色建议去的下一个房间 */
  suggestNextRoom?: MemoryRoom;
}

// ─── 房间剧本（一次 LLM 预生成整房间的探访） ──────────

/** 单个 beat 中的用户选项 —— 每个选项都有独立的角色反应 */
export interface DiveScriptChoice {
  id: string;
  /** 用户的选项文本 */
  text: string;
  /** 行为类型：用于 buff 计算 */
  action?: DiveChoice['action'];
  /** 显式 buff 影响 */
  buffEffect?: Partial<DiveBuffValues>;
  /** 选后角色的独立回应（character 台词；可多段用 \n\n 分隔） */
  reaction: string;
  /** 可选：这条反应之后额外的环境旁白（比如"灯光轻轻晃了一下"） */
  reactionNarrator?: string;
}

/** 房间剧本中的一段戏 */
export interface DiveBeat {
  /** 角色此刻说的一段话 */
  charLine: string;
  /** 可选：说话前的环境旁白 */
  narratorLine?: string;
  /** 3 个反应选项，每个都带独立回应 */
  choices: DiveScriptChoice[];
}

/** 一个房间从进场到离场的完整剧本 */
export interface RoomScript {
  /** 进房间的环境旁白（可选） */
  introNarrator?: string;
  /** 房间里的几段戏，默认 3 */
  beats: DiveBeat[];
  /** 离开房间的环境旁白（可选） */
  closingNarrator?: string;
  /** 可选：离开时浮现的一句话，作为记忆的余味 */
  finalMoodHint?: string;
  /** LLM 建议的下一个房间 */
  nextRoom?: MemoryRoom;
}

// ─── 结算 ────────────────────────────────────────────────

export interface DiveResult {
  charId: string;
  mode: DiveMode;
  visitedRooms: MemoryRoom[];
  totalDialogues: number;
  buffs: DiveBuff[];
  /** 主要获得的 buff 类型 */
  primaryBuff: BuffType;
  duration: number; // ms
  completedAt: number;
}
