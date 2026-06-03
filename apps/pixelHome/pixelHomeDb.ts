/**
 * Pixel Home — IndexedDB 存储层
 *
 * 两个 store：
 *   pixel_home_assets  — 用户生成的像素资产
 *   pixel_home_layouts — 每个角色的每个房间布局
 */

import type { PixelAsset, PixelRoomLayout, PixelHomeState } from './types';
import type { MemoryRoom } from '../../utils/memoryPalace/types';
import { ROOM_SLOTS, DEFAULT_ROOM_COLORS, ALL_ROOMS } from './roomTemplates';
import type { PlacedFurniture } from './types';

// ─── DB 常量 ─────────────────────────────────────────

const DB_NAME = 'AetherOS_Data';
const STORE_ASSETS = 'pixel_home_assets';
const STORE_LAYOUTS = 'pixel_home_layouts';

// ─── 辅助：打开数据库 ───────────────────────────────

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── 资产 CRUD ──────────────────────────────────────

export const PixelAssetDB = {
  async save(asset: PixelAsset): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(asset);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveBatch(assets: PixelAsset[]): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    const store = tx.objectStore(STORE_ASSETS);
    for (const a of assets) store.put(a);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAll(): Promise<PixelAsset[]> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getById(id: string): Promise<PixelAsset | undefined> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).get(id);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async delete(id: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// ─── 布局 CRUD ──────────────────────────────────────

export const PixelLayoutDB = {
  async save(layout: PixelRoomLayout): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readwrite');
    tx.objectStore(STORE_LAYOUTS).put(layout);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async get(charId: string, roomId: MemoryRoom): Promise<PixelRoomLayout | undefined> {
    const db = await openDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readonly');
    const req = tx.objectStore(STORE_LAYOUTS).get([charId, roomId]);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllForChar(charId: string): Promise<PixelRoomLayout[]> {
    const db = await openDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readonly');
    const idx = tx.objectStore(STORE_LAYOUTS).index('charId');
    const req = idx.getAll(charId);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async saveBatch(layouts: PixelRoomLayout[]): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readwrite');
    const store = tx.objectStore(STORE_LAYOUTS);
    for (const l of layouts) store.put(l);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// ─── 内置默认家园预设 ──────────────────────────────

/**
 * 尝试为指定角色加载内置默认家园预设。
 * 查找顺序：
 *   1. public/pixel-presets/<charId>.json   — 该角色专属预设
 *   2. public/pixel-presets/default.json    — 所有角色共用的默认家园
 * 预设文件由仓库 pixelroom/ 导出的 JSON 复制而来。
 *
 * 返回 true 表示成功加载并写入了至少一个房间。
 */
async function trySeedDefaultHome(charId: string): Promise<boolean> {
  // 仅在浏览器环境（有 fetch + 静态资源服务）下尝试
  if (typeof fetch !== 'function') return false;

  const base = (import.meta as any).env?.BASE_URL ?? '/';
  const candidates = [
    `${base}pixel-presets/${encodeURIComponent(charId)}.json`,
    `${base}pixel-presets/default.json`,
  ];

  let preset: any = null;
  for (const url of candidates) {
    try {
      const resp = await fetch(url, { cache: 'force-cache' });
      if (!resp.ok) continue;
      preset = await resp.json();
      if (preset && Array.isArray(preset.rooms) && preset.rooms.length > 0) break;
      preset = null;
    } catch {
      // 继续下一个候选
    }
  }
  if (!preset) return false;

  // 导入资产（跳过已存在的）
  if (Array.isArray(preset.assets) && preset.assets.length > 0) {
    const existingAssets = await PixelAssetDB.getAll();
    const existingIds = new Set(existingAssets.map(a => a.id));
    const toSave = preset.assets
      .filter((a: any) => a && a.id && !existingIds.has(a.id))
      .map((a: any) => ({
        ...a,
        originalImage: a.pixelImage,
        createdAt: Date.now(),
        tags: ['default'],
      }));
    if (toSave.length > 0) await PixelAssetDB.saveBatch(toSave);
  }

  // 导入房间布局
  const layouts: PixelRoomLayout[] = preset.rooms.map((r: any) => ({
    roomId: r.roomId,
    charId,
    furniture: r.furniture || [],
    wallColor: r.wallColor,
    floorColor: r.floorColor,
    ambiance: r.ambiance,
    wallFillMode: r.wallFillMode,
    wallOffsetX: r.wallOffsetX,
    wallOffsetY: r.wallOffsetY,
    floorFillMode: r.floorFillMode,
    floorOffsetX: r.floorOffsetX,
    floorOffsetY: r.floorOffsetY,
    lastUpdatedAt: Date.now(),
    lastDecoratedBy: 'character' as const,
  }));
  if (layouts.length === 0) return false;
  await PixelLayoutDB.saveBatch(layouts);
  return true;
}

// ─── 家园状态整合 ────────────────────────────────────

/**
 * 判断一组房间是不是"还没装修过"——没有任何用户放置的家具、也没有任何关联到具体资产的家具。
 * 用于判断是否值得跑一次默认预设填充（如存在旧版空壳数据）。
 */
function layoutsLookUntouched(layouts: PixelRoomLayout[]): boolean {
  if (layouts.length === 0) return true;
  for (const r of layouts) {
    for (const f of r.furniture || []) {
      if (f.placedBy === 'user') return false;
      if (f.assetId) return false;
    }
  }
  return true;
}

/** 获取角色的完整家园状态，不存在则初始化默认 */
export async function getOrCreateHomeState(charId: string): Promise<PixelHomeState> {
  let existing = await PixelLayoutDB.getAllForChar(charId);

  // 首次进入、或之前只存了空壳（没家具/没用户放置）：尝试加载内置默认家园预设
  if (layoutsLookUntouched(existing)) {
    try {
      const seeded = await trySeedDefaultHome(charId);
      if (seeded) existing = await PixelLayoutDB.getAllForChar(charId);
    } catch (e) {
      console.warn('[pixelHome] seed default home failed:', e);
    }
  }

  if (existing.length === ALL_ROOMS.length) {
    return {
      charId,
      rooms: existing,
      lastLLMDecoration: 0,
    };
  }

  // 补齐缺失的房间
  const existingMap = new Map(existing.map(r => [r.roomId, r]));
  const allRooms: PixelRoomLayout[] = ALL_ROOMS.map(roomId => {
    if (existingMap.has(roomId)) return existingMap.get(roomId)!;

    const slots = ROOM_SLOTS[roomId];
    const colors = DEFAULT_ROOM_COLORS[roomId];
    const furniture: PlacedFurniture[] = slots.map(slot => ({
      slotId: slot.id,
      assetId: null,
      x: slot.defaultX,
      y: slot.defaultY,
      scale: slot.defaultScale,
      rotation: 0,
      placedBy: 'character' as const,
      isDefault: true,
    }));

    return {
      roomId,
      charId,
      furniture,
      wallColor: colors.wall,
      floorColor: colors.floor,
      ambiance: '',
      lastUpdatedAt: Date.now(),
      lastDecoratedBy: 'character' as const,
    };
  });

  // 保存新建的房间
  const newRooms = allRooms.filter(r => !existingMap.has(r.roomId));
  if (newRooms.length > 0) {
    await PixelLayoutDB.saveBatch(newRooms);
  }

  return {
    charId,
    rooms: allRooms,
    lastLLMDecoration: 0,
  };
}
