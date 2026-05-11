/**
 * Pixel Home — 7个房间的固定槽位定义
 *
 * 每个房间5个家具槽位，映射到记忆宫殿的认知功能。
 * 槽位数量和分类固定，但位置可由用户/角色调整。
 */

import type { RoomSlotDef } from './types';
import type { MemoryRoom } from '../../utils/memoryPalace/types';

export const ROOM_SLOTS: Record<MemoryRoom, RoomSlotDef[]> = {
  // ─── 客厅 → hippocampus，日常闲聊 ─────────────────
  living_room: [
    { id: 'sofa',         name: '沙发',   category: '近期话题',   required: true,  defaultX: 25, defaultY: 60, defaultScale: 1.4 },
    { id: 'tv',           name: '电视',   category: '共享体验',   required: false, defaultX: 75, defaultY: 35, defaultScale: 1.2 },
    { id: 'coffee_table', name: '茶几',   category: '碎片记忆',   required: false, defaultX: 40, defaultY: 65, defaultScale: 1.0 },
    { id: 'rug',          name: '地毯',   category: '氛围基调',   required: false, defaultX: 50, defaultY: 75, defaultScale: 1.6 },
    { id: 'clock',        name: '挂钟',   category: '时间感知',   required: false, defaultX: 85, defaultY: 25, defaultScale: 0.8 },
  ],

  // ─── 卧室 → neocortex，亲密情感 ───────────────────
  bedroom: [
    { id: 'bed',        name: '床',     category: '核心记忆容器', required: true,  defaultX: 60, defaultY: 55, defaultScale: 1.8 },
    { id: 'nightstand', name: '床头柜', category: '重要事件',     required: false, defaultX: 85, defaultY: 55, defaultScale: 0.9 },
    { id: 'lamp',       name: '台灯',   category: '情绪强度',     required: false, defaultX: 88, defaultY: 45, defaultScale: 0.7 },
    { id: 'curtain',    name: '窗帘',   category: '隐私层',       required: false, defaultX: 15, defaultY: 25, defaultScale: 1.5 },
    { id: 'frame',      name: '相框',   category: '关键关系片段', required: false, defaultX: 35, defaultY: 25, defaultScale: 0.8 },
  ],

  // ─── 书房 → prefrontal cortex，工作/技能 ──────────
  study: [
    { id: 'desk',       name: '书桌',   category: '当前任务',   required: true,  defaultX: 50, defaultY: 55, defaultScale: 1.4 },
    { id: 'bookshelf',  name: '书架',   category: '知识积累',   required: false, defaultX: 15, defaultY: 35, defaultScale: 1.6 },
    { id: 'whiteboard', name: '白板',   category: '计划推理',   required: false, defaultX: 80, defaultY: 30, defaultScale: 1.3 },
    { id: 'pen_holder', name: '笔筒',   category: '工具技能',   required: false, defaultX: 55, defaultY: 48, defaultScale: 0.6 },
    { id: 'globe',      name: '地球仪', category: '兴趣探索',   required: false, defaultX: 85, defaultY: 60, defaultScale: 0.9 },
  ],

  // ─── 阁楼 → amygdala，未消化创伤 ─────────────────
  attic: [
    { id: 'chest',     name: '旧箱子',   category: '封存记忆',   required: true,  defaultX: 30, defaultY: 60, defaultScale: 1.3 },
    { id: 'cobweb',    name: '蛛网',     category: '遗忘程度',   required: false, defaultX: 15, defaultY: 20, defaultScale: 1.0 },
    { id: 'mirror',    name: '落灰镜子', category: '自我审视',   required: false, defaultX: 75, defaultY: 35, defaultScale: 1.2 },
    { id: 'window',    name: '天窗',     category: '希望缝隙',   required: false, defaultX: 50, defaultY: 15, defaultScale: 1.4 },
    { id: 'music_box', name: '八音盒',   category: '触发片段',   required: false, defaultX: 65, defaultY: 65, defaultScale: 0.7 },
  ],

  // ─── 个人房间 → default mode network，身份 ────────
  self_room: [
    { id: 'vanity',   name: '梳妆台', category: '自我形象',   required: true,  defaultX: 25, defaultY: 50, defaultScale: 1.3 },
    { id: 'diary',    name: '日记本', category: '内心独白',   required: false, defaultX: 50, defaultY: 60, defaultScale: 0.8 },
    { id: 'trophy',   name: '奖杯架', category: '成就感',     required: false, defaultX: 80, defaultY: 40, defaultScale: 1.1 },
    { id: 'poster',   name: '海报',   category: '价值观',     required: false, defaultX: 15, defaultY: 25, defaultScale: 1.4 },
    { id: 'pet_bed',  name: '宠物窝', category: '情感寄托',   required: false, defaultX: 70, defaultY: 70, defaultScale: 0.9 },
  ],

  // ─── 用户房 → TPJ，用户信息 ───────────────────────
  user_room: [
    { id: 'guest_bed',  name: '客床',   category: '用户印象',   required: true,  defaultX: 55, defaultY: 55, defaultScale: 1.6 },
    { id: 'photo_wall', name: '照片墙', category: '共同回忆',   required: false, defaultX: 20, defaultY: 25, defaultScale: 1.5 },
    { id: 'gift_shelf', name: '礼物架', category: '互赠物品',   required: false, defaultX: 80, defaultY: 35, defaultScale: 1.2 },
    { id: 'letter_box', name: '信箱',   category: '重要对话',   required: false, defaultX: 85, defaultY: 60, defaultScale: 0.8 },
    { id: 'welcome_mat',name: '门垫',   category: '关系温度',   required: false, defaultX: 50, defaultY: 85, defaultScale: 1.0 },
  ],

  // ─── 窗台/露台 → dopamine，期盼 ──────────────────
  windowsill: [
    { id: 'flower_pot', name: '花盆',   category: '成长中的期盼', required: true,  defaultX: 30, defaultY: 55, defaultScale: 0.9 },
    { id: 'wind_chime', name: '风铃',   category: '实现的愿望',   required: false, defaultX: 50, defaultY: 20, defaultScale: 0.8 },
    { id: 'telescope',  name: '望远镜', category: '远期目标',     required: false, defaultX: 75, defaultY: 45, defaultScale: 1.2 },
    { id: 'seed_box',   name: '种子盒', category: '新萌芽',       required: false, defaultX: 20, defaultY: 65, defaultScale: 0.7 },
    { id: 'lantern',    name: '灯笼',   category: '锚定心愿',     required: false, defaultX: 85, defaultY: 30, defaultScale: 0.9 },
  ],
};

// ─── 房间元信息 ─────────────────────────────────────

export const ROOM_META: Record<MemoryRoom, { name: string; emoji: string; color: string; description: string }> = {
  living_room: { name: '客厅',     emoji: '🛋️', color: '#f59e0b', description: '日常闲聊与近期记忆' },
  bedroom:     { name: '卧室',     emoji: '🛏️', color: '#8b5cf6', description: '亲密情感与核心记忆' },
  study:       { name: '书房',     emoji: '📚', color: '#3b82f6', description: '知识积累与技能成长' },
  attic:       { name: '阁楼',     emoji: '🕸️', color: '#6b7280', description: '未消化的困惑与创伤' },
  self_room:   { name: '个人房间', emoji: '🪞', color: '#ec4899', description: '自我认同与身份探索' },
  user_room:   { name: '用户房',   emoji: '🎁', color: '#10b981', description: '关于你的一切记忆' },
  windowsill:  { name: '露台',     emoji: '🌱', color: '#06b6d4', description: '期盼、愿望与未来' },
};

// ─── 默认墙壁/地板颜色 ─────────────────────────────

export const DEFAULT_ROOM_COLORS: Record<MemoryRoom, { wall: string; floor: string }> = {
  living_room: { wall: '#fef3c7', floor: '#d6b88a' },
  bedroom:     { wall: '#ede9fe', floor: '#c4b5a0' },
  study:       { wall: '#dbeafe', floor: '#8b7355' },
  attic:       { wall: '#4b5563', floor: '#374151' },
  self_room:   { wall: '#fce7f3', floor: '#d4a8c0' },
  user_room:   { wall: '#d1fae5', floor: '#a8c4b0' },
  windowsill:  { wall: '#cffafe', floor: '#92a89c' },
};

// ─── 所有房间 ID 列表（保持渲染顺序）─────────────

export const ALL_ROOMS: MemoryRoom[] = [
  'living_room', 'bedroom', 'study', 'attic', 'self_room', 'user_room', 'windowsill',
];

// ─── 房间尺寸（格子数，俯瞰图+编辑器共用）─────────

export const ROOM_SIZES: Record<MemoryRoom, { w: number; h: number }> = {
  attic:       { w: 4, h: 4 },
  bedroom:     { w: 5, h: 5 },
  study:       { w: 5, h: 5 },
  living_room: { w: 10, h: 6 },
  self_room:   { w: 5, h: 4 },
  user_room:   { w: 5, h: 4 },
  windowsill:  { w: 10, h: 3 },
};
