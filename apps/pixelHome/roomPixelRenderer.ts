/**
 * Pixel Home — 默认家具像素渲染器
 *
 * 为每个槽位生成默认的像素风格家具图标（Canvas 生成）。
 * 用户可以用自定义资产替换这些默认图。
 */

import type { MemoryRoom } from '../../utils/memoryPalace/types';

// 缓存生成的默认家具图
const _cache: Map<string, string> = new Map();

// 调色板
const PAL = {
  wood:      '#8b6914',
  woodDark:  '#5c4a1e',
  woodLight: '#c4a35a',
  fabric:    '#6366f1',
  fabricDark:'#4338ca',
  white:     '#f8fafc',
  cream:     '#fef3c7',
  gray:      '#94a3b8',
  grayDark:  '#475569',
  glass:     '#93c5fd',
  green:     '#4ade80',
  greenDark: '#16a34a',
  pink:      '#f472b6',
  gold:      '#fbbf24',
  red:       '#ef4444',
  black:     '#1e293b',
  paper:     '#fefce8',
  metal:     '#9ca3af',
  rust:      '#b45309',
  cobweb:    '#d1d5db',
  mirror:    '#bfdbfe',
  purple:    '#a78bfa',
  cyan:      '#22d3ee',
};

/**
 * 获取默认家具像素图的 data URI。
 * 每个房间的每个槽位有独特的像素小图标。
 */
export function defaultFurniturePixelSrc(roomId: MemoryRoom, slotId: string): string {
  const key = `${roomId}_${slotId}`;
  if (_cache.has(key)) return _cache.get(key)!;

  const SIZE = 16; // 原始像素尺寸
  const SCALE = 4; // 展示放大倍数
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * SCALE;
  canvas.height = SIZE * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // 先画到小 canvas 再放大
  const small = document.createElement('canvas');
  small.width = SIZE;
  small.height = SIZE;
  const sCtx = small.getContext('2d')!;

  drawDefaultFurniture(sCtx, roomId, slotId, SIZE);

  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  const dataUri = canvas.toDataURL('image/png');
  _cache.set(key, dataUri);
  return dataUri;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawDefaultFurniture(ctx: CanvasRenderingContext2D, roomId: MemoryRoom, slotId: string, size: number) {
  // 清空
  ctx.clearRect(0, 0, size, size);

  switch (`${roomId}:${slotId}`) {
    // ─── 客厅 ─────────────────────────────
    case 'living_room:sofa':
      rect(ctx, 2, 8, 12, 5, PAL.fabric);
      rect(ctx, 1, 9, 1, 4, PAL.fabricDark);
      rect(ctx, 14, 9, 1, 4, PAL.fabricDark);
      rect(ctx, 3, 7, 10, 2, PAL.fabric);
      rect(ctx, 4, 13, 2, 2, PAL.woodDark); // legs
      rect(ctx, 10, 13, 2, 2, PAL.woodDark);
      break;
    case 'living_room:tv':
      rect(ctx, 3, 3, 10, 8, PAL.black);
      rect(ctx, 4, 4, 8, 6, PAL.glass);
      rect(ctx, 7, 11, 2, 2, PAL.grayDark);
      rect(ctx, 5, 13, 6, 1, PAL.gray);
      break;
    case 'living_room:coffee_table':
      rect(ctx, 3, 8, 10, 2, PAL.wood);
      rect(ctx, 3, 7, 10, 1, PAL.woodLight);
      rect(ctx, 4, 10, 1, 4, PAL.woodDark);
      rect(ctx, 11, 10, 1, 4, PAL.woodDark);
      break;
    case 'living_room:rug':
      rect(ctx, 2, 10, 12, 4, PAL.cream);
      rect(ctx, 3, 11, 10, 2, PAL.pink);
      rect(ctx, 2, 10, 12, 1, PAL.gold);
      rect(ctx, 2, 13, 12, 1, PAL.gold);
      break;
    case 'living_room:clock':
      rect(ctx, 5, 2, 6, 6, PAL.wood);
      rect(ctx, 6, 3, 4, 4, PAL.white);
      px(ctx, 8, 4, PAL.black); // 12
      px(ctx, 8, 6, PAL.black); // 6
      px(ctx, 7, 5, PAL.red);   // hand
      px(ctx, 8, 5, PAL.red);
      break;

    // ─── 卧室 ─────────────────────────────
    case 'bedroom:bed':
      rect(ctx, 1, 7, 14, 7, PAL.fabric);
      rect(ctx, 2, 5, 12, 3, PAL.white); // pillow
      rect(ctx, 1, 6, 1, 8, PAL.woodDark);
      rect(ctx, 14, 6, 1, 8, PAL.woodDark);
      rect(ctx, 1, 14, 14, 1, PAL.woodDark);
      break;
    case 'bedroom:nightstand':
      rect(ctx, 4, 6, 8, 8, PAL.wood);
      rect(ctx, 5, 7, 6, 3, PAL.woodDark);
      rect(ctx, 5, 11, 6, 2, PAL.woodDark);
      rect(ctx, 4, 14, 2, 1, PAL.woodDark);
      rect(ctx, 10, 14, 2, 1, PAL.woodDark);
      break;
    case 'bedroom:lamp':
      rect(ctx, 6, 3, 4, 5, PAL.gold);
      rect(ctx, 5, 2, 6, 2, PAL.gold);
      rect(ctx, 7, 8, 2, 5, PAL.gray);
      rect(ctx, 6, 13, 4, 1, PAL.grayDark);
      break;
    case 'bedroom:curtain':
      rect(ctx, 1, 1, 4, 14, PAL.fabric);
      rect(ctx, 11, 1, 4, 14, PAL.fabric);
      rect(ctx, 1, 1, 14, 1, PAL.woodDark);
      rect(ctx, 5, 2, 6, 12, PAL.glass); // window
      break;
    case 'bedroom:frame':
      rect(ctx, 3, 3, 10, 10, PAL.wood);
      rect(ctx, 4, 4, 8, 8, PAL.white);
      rect(ctx, 5, 5, 6, 6, PAL.pink);
      px(ctx, 7, 7, PAL.red);
      px(ctx, 8, 8, PAL.red);
      break;

    // ─── 书房 ─────────────────────────────
    case 'study:desk':
      rect(ctx, 1, 7, 14, 2, PAL.wood);
      rect(ctx, 1, 6, 14, 1, PAL.woodLight);
      rect(ctx, 2, 9, 2, 5, PAL.woodDark);
      rect(ctx, 12, 9, 2, 5, PAL.woodDark);
      break;
    case 'study:bookshelf':
      rect(ctx, 2, 1, 12, 14, PAL.wood);
      rect(ctx, 3, 2, 4, 3, PAL.red);
      rect(ctx, 7, 2, 3, 3, PAL.fabric);
      rect(ctx, 10, 2, 3, 3, PAL.green);
      rect(ctx, 3, 6, 3, 3, PAL.gold);
      rect(ctx, 6, 6, 4, 3, PAL.cyan);
      rect(ctx, 10, 6, 3, 3, PAL.purple);
      rect(ctx, 3, 10, 10, 4, PAL.woodDark);
      break;
    case 'study:whiteboard':
      rect(ctx, 2, 2, 12, 10, PAL.white);
      rect(ctx, 1, 1, 14, 1, PAL.gray);
      rect(ctx, 1, 12, 14, 1, PAL.gray);
      rect(ctx, 1, 1, 1, 12, PAL.gray);
      rect(ctx, 14, 1, 1, 12, PAL.gray);
      px(ctx, 4, 5, PAL.red);
      px(ctx, 5, 5, PAL.red);
      px(ctx, 8, 7, PAL.fabric);
      break;
    case 'study:pen_holder':
      rect(ctx, 5, 7, 6, 7, PAL.gray);
      rect(ctx, 5, 7, 6, 1, PAL.grayDark);
      px(ctx, 6, 4, PAL.red);
      px(ctx, 6, 5, PAL.red);
      px(ctx, 6, 6, PAL.red);
      px(ctx, 8, 3, PAL.fabric);
      px(ctx, 8, 4, PAL.fabric);
      px(ctx, 8, 5, PAL.fabric);
      px(ctx, 8, 6, PAL.fabric);
      px(ctx, 10, 5, PAL.green);
      px(ctx, 10, 6, PAL.green);
      break;
    case 'study:globe':
      rect(ctx, 5, 3, 6, 6, PAL.glass);
      rect(ctx, 6, 4, 4, 4, PAL.green);
      rect(ctx, 7, 9, 2, 3, PAL.gray);
      rect(ctx, 5, 12, 6, 1, PAL.grayDark);
      break;

    // ─── 阁楼 ─────────────────────────────
    case 'attic:chest':
      rect(ctx, 2, 7, 12, 7, PAL.woodDark);
      rect(ctx, 2, 7, 12, 2, PAL.rust);
      rect(ctx, 7, 9, 2, 2, PAL.gold);
      break;
    case 'attic:cobweb':
      px(ctx, 1, 1, PAL.cobweb);
      px(ctx, 2, 2, PAL.cobweb);
      px(ctx, 3, 3, PAL.cobweb);
      px(ctx, 4, 4, PAL.cobweb);
      px(ctx, 2, 1, PAL.cobweb);
      px(ctx, 3, 1, PAL.cobweb);
      px(ctx, 1, 2, PAL.cobweb);
      px(ctx, 1, 3, PAL.cobweb);
      px(ctx, 5, 3, PAL.cobweb);
      px(ctx, 3, 5, PAL.cobweb);
      break;
    case 'attic:mirror':
      rect(ctx, 4, 2, 8, 11, PAL.woodDark);
      rect(ctx, 5, 3, 6, 9, PAL.mirror);
      rect(ctx, 6, 5, 4, 5, PAL.glass);
      // dust particles
      px(ctx, 5, 4, PAL.cobweb);
      px(ctx, 9, 6, PAL.cobweb);
      break;
    case 'attic:window':
      rect(ctx, 3, 1, 10, 8, PAL.woodDark);
      rect(ctx, 4, 2, 8, 6, PAL.glass);
      rect(ctx, 8, 2, 1, 6, PAL.woodDark);
      rect(ctx, 4, 5, 8, 1, PAL.woodDark);
      // light rays
      px(ctx, 6, 10, PAL.gold);
      px(ctx, 7, 11, PAL.gold);
      px(ctx, 8, 12, PAL.gold);
      break;
    case 'attic:music_box':
      rect(ctx, 4, 8, 8, 6, PAL.rust);
      rect(ctx, 4, 7, 8, 2, PAL.wood);
      rect(ctx, 7, 5, 2, 3, PAL.gold);
      px(ctx, 7, 4, PAL.gold);
      break;

    // ─── 个人房间 ─────────────────────────
    case 'self_room:vanity':
      rect(ctx, 3, 7, 10, 7, PAL.wood);
      rect(ctx, 4, 2, 8, 6, PAL.mirror);
      rect(ctx, 5, 3, 6, 4, PAL.glass);
      rect(ctx, 4, 8, 3, 2, PAL.woodDark); // drawer
      rect(ctx, 9, 8, 3, 2, PAL.woodDark);
      break;
    case 'self_room:diary':
      rect(ctx, 4, 5, 8, 9, PAL.purple);
      rect(ctx, 5, 6, 6, 7, PAL.paper);
      rect(ctx, 4, 5, 1, 9, PAL.fabricDark);
      px(ctx, 6, 8, PAL.black);
      px(ctx, 7, 8, PAL.black);
      px(ctx, 8, 8, PAL.black);
      break;
    case 'self_room:trophy':
      rect(ctx, 6, 3, 4, 3, PAL.gold);
      rect(ctx, 5, 2, 6, 1, PAL.gold);
      rect(ctx, 7, 6, 2, 4, PAL.gold);
      rect(ctx, 5, 10, 6, 2, PAL.woodDark);
      break;
    case 'self_room:poster':
      rect(ctx, 2, 2, 12, 11, PAL.white);
      rect(ctx, 3, 3, 10, 9, PAL.cream);
      rect(ctx, 5, 5, 6, 5, PAL.red);
      px(ctx, 7, 6, PAL.white);
      px(ctx, 8, 7, PAL.white);
      break;
    case 'self_room:pet_bed':
      rect(ctx, 3, 9, 10, 5, PAL.fabric);
      rect(ctx, 2, 8, 12, 2, PAL.fabricDark);
      rect(ctx, 5, 10, 4, 3, PAL.cream); // cushion
      break;

    // ─── 用户房 ──────────────────────────
    case 'user_room:guest_bed':
      rect(ctx, 1, 8, 14, 6, PAL.green);
      rect(ctx, 2, 6, 12, 3, PAL.white);
      rect(ctx, 1, 7, 1, 7, PAL.woodDark);
      rect(ctx, 14, 7, 1, 7, PAL.woodDark);
      break;
    case 'user_room:photo_wall':
      rect(ctx, 2, 2, 5, 4, PAL.wood);
      rect(ctx, 3, 3, 3, 2, PAL.glass);
      rect(ctx, 9, 3, 5, 5, PAL.wood);
      rect(ctx, 10, 4, 3, 3, PAL.pink);
      rect(ctx, 4, 8, 4, 4, PAL.wood);
      rect(ctx, 5, 9, 2, 2, PAL.cream);
      break;
    case 'user_room:gift_shelf':
      rect(ctx, 2, 3, 12, 11, PAL.wood);
      rect(ctx, 3, 4, 4, 3, PAL.red);
      rect(ctx, 4, 3, 2, 1, PAL.gold); // ribbon
      rect(ctx, 9, 5, 3, 3, PAL.fabric);
      rect(ctx, 3, 9, 3, 4, PAL.green);
      break;
    case 'user_room:letter_box':
      rect(ctx, 4, 5, 8, 8, PAL.wood);
      rect(ctx, 5, 6, 6, 3, PAL.paper);
      rect(ctx, 6, 10, 4, 2, PAL.woodDark);
      px(ctx, 8, 4, PAL.red); // flag
      px(ctx, 8, 5, PAL.gray);
      break;
    case 'user_room:welcome_mat':
      rect(ctx, 2, 10, 12, 4, PAL.green);
      rect(ctx, 3, 11, 10, 2, PAL.greenDark);
      rect(ctx, 2, 10, 12, 1, PAL.cream);
      rect(ctx, 2, 13, 12, 1, PAL.cream);
      break;

    // ─── 窗台/露台 ────────────────────────
    case 'windowsill:flower_pot':
      rect(ctx, 5, 9, 6, 5, PAL.rust);
      rect(ctx, 4, 8, 8, 2, PAL.rust);
      rect(ctx, 6, 5, 2, 4, PAL.green);
      rect(ctx, 8, 4, 2, 5, PAL.green);
      px(ctx, 6, 4, PAL.pink);
      px(ctx, 9, 3, PAL.red);
      break;
    case 'windowsill:wind_chime':
      rect(ctx, 7, 1, 2, 1, PAL.gray);
      px(ctx, 5, 3, PAL.cyan);
      px(ctx, 5, 4, PAL.cyan);
      px(ctx, 5, 5, PAL.cyan);
      px(ctx, 8, 3, PAL.glass);
      px(ctx, 8, 4, PAL.glass);
      px(ctx, 8, 5, PAL.glass);
      px(ctx, 8, 6, PAL.glass);
      px(ctx, 11, 3, PAL.purple);
      px(ctx, 11, 4, PAL.purple);
      px(ctx, 6, 2, PAL.gray);
      px(ctx, 7, 2, PAL.gray);
      px(ctx, 8, 2, PAL.gray);
      px(ctx, 9, 2, PAL.gray);
      px(ctx, 10, 2, PAL.gray);
      break;
    case 'windowsill:telescope':
      rect(ctx, 9, 3, 3, 2, PAL.grayDark);
      rect(ctx, 6, 5, 5, 2, PAL.gray);
      rect(ctx, 5, 7, 2, 6, PAL.woodDark);
      rect(ctx, 9, 7, 2, 6, PAL.woodDark);
      rect(ctx, 10, 2, 2, 2, PAL.glass);
      break;
    case 'windowsill:seed_box':
      rect(ctx, 3, 8, 10, 6, PAL.wood);
      rect(ctx, 3, 8, 10, 1, PAL.woodLight);
      rect(ctx, 5, 10, 2, 2, PAL.green);
      rect(ctx, 8, 9, 2, 2, PAL.greenDark);
      px(ctx, 10, 10, PAL.gold);
      break;
    case 'windowsill:lantern':
      rect(ctx, 6, 2, 4, 2, PAL.gray);
      rect(ctx, 5, 4, 6, 8, PAL.red);
      rect(ctx, 6, 5, 4, 6, PAL.gold);
      rect(ctx, 5, 12, 6, 1, PAL.gray);
      px(ctx, 7, 1, PAL.gray);
      px(ctx, 8, 1, PAL.gray);
      break;

    default:
      // 通用占位
      rect(ctx, 4, 4, 8, 8, PAL.gray);
      rect(ctx, 5, 5, 6, 6, PAL.cobweb);
      break;
  }
}

/** 生成房间缩略图（供俯瞰地图使用） */
export function generateRoomPixelThumbnail(_roomId: MemoryRoom): string {
  // TODO: 生成包含已放置家具的房间完整缩略图
  return '';
}
