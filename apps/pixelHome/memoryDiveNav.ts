/**
 * Memory Dive — 房间导航顺序
 *
 * 新版剧本流程：角色不再走向家具，只在房间里说话。
 * 这里只保留「下一个该去哪个房间」的逻辑。
 */

import type { MemoryRoom } from '../../utils/memoryPalace/types';

/** 引导顺序——从客厅日常逐步进入内心深处，阁楼最后 */
export const GUIDED_ROOM_ORDER: MemoryRoom[] = [
  'living_room', 'bedroom', 'study', 'self_room', 'user_room', 'windowsill', 'attic',
];

/**
 * 角色站位点（每个房间一个脚底点）
 *
 * 这些坐标是按各房间 roomTemplates 里家具的 default 位置挑出来的空地——
 * 避开了沙发、床、桌子这些大件，让角色落脚的时候不会踩在家具上。
 * 后续用户改过家具布局之后也不一定完美避开，但至少默认布局下是干净的。
 * 用户小人 = 角色位置左偏 10%、下偏 4%（见 userPos），所以这里的 x 不能太靠左边。
 */
const ROOM_CHAR_POS: Record<MemoryRoom, { x: number; y: number }> = {
  living_room: { x: 62, y: 82 }, // 沙发(25,60) 茶几(40,65) 地毯(50,75) 右下空地
  bedroom:     { x: 32, y: 80 }, // 床(60,55) 床头柜(85,55) 左下空地
  study:       { x: 35, y: 82 }, // 书桌(50,55) 书架(15,35) 左下空地
  attic:       { x: 48, y: 82 }, // 箱子(30,60) 八音盒(65,65) 中下空地
  self_room:   { x: 45, y: 82 }, // 梳妆台(25,50) 宠物窝(70,70) 中下空地
  user_room:   { x: 35, y: 75 }, // 客床(55,55) 门垫(50,85) 左中空地
  windowsill:  { x: 55, y: 78 }, // 花盆(30,55) 望远镜(75,45) 种子盒(20,65) 中下空地
};

export function roomCharPos(roomId: MemoryRoom): { x: number; y: number } {
  return ROOM_CHAR_POS[roomId] || { x: 52, y: 78 };
}

/** 用户小人斜后跟随 */
export function userPos(charX: number, charY: number): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(92, charX - 10)),
    y: Math.max(42, Math.min(92, charY + 4)),
  };
}

/** 角色在一个房间里 beat 之间的轻微漂移，让画面活一点 */
export function jitterPos(base: { x: number; y: number }): { x: number; y: number } {
  const jx = (Math.random() - 0.5) * 18; // ±9%
  const jy = (Math.random() - 0.5) * 10; // ±5%
  // 以 base.y 为参考做 ±5% 上下抖动，不再硬锁死在 58..86；
  // 否则小房间里 base.y 已经挪到 78-82 的空地，硬钳住 58..86 会把角色拽回家具身上。
  const minY = Math.max(55, base.y - 12);
  const maxY = Math.min(88, base.y + 8);
  return {
    x: Math.max(18, Math.min(82, base.x + jx)),
    y: Math.max(minY, Math.min(maxY, base.y + jy)),
  };
}

/**
 * 选下一个房间。优先 LLM 推荐，否则按固定顺序取第一个未访问过的房间；
 * 全部访问完返回 null。
 */
export function pickNextRoom(
  currentRoom: MemoryRoom,
  visitedRooms: MemoryRoom[],
  preferred?: MemoryRoom,
): MemoryRoom | null {
  if (preferred && preferred !== currentRoom && !visitedRooms.includes(preferred)) {
    return preferred;
  }
  const idx = GUIDED_ROOM_ORDER.indexOf(currentRoom);
  for (let i = idx + 1; i < GUIDED_ROOM_ORDER.length; i++) {
    const r = GUIDED_ROOM_ORDER[i];
    if (!visitedRooms.includes(r)) return r;
  }
  for (const r of GUIDED_ROOM_ORDER) {
    if (!visitedRooms.includes(r)) return r;
  }
  return null;
}
