/**
 * Pixel Home — 房屋预设导入/导出
 *
 * 导出：当前角色的全部房间布局 + 用到的像素资产 → JSON 文件
 * 导入：读取 JSON → 覆盖当前角色的房间布局 + 导入缺失的资产
 */

import type {
  PixelHomePreset, PixelRoomPreset, PixelAssetPreset,
  PixelHomeState, PixelRoomLayout, PixelAsset,
} from './types';
import { PixelLayoutDB, PixelAssetDB } from './pixelHomeDb';

// ─── 导出 ────────────────────────────────────────────

export async function exportPreset(
  homeState: PixelHomeState,
  allAssets: PixelAsset[],
  presetName: string,
  author: string,
): Promise<string> {
  // 收集所有使用的 assetId
  const usedAssetIds = new Set<string>();
  for (const room of homeState.rooms) {
    for (const f of room.furniture) {
      if (f.assetId) usedAssetIds.add(f.assetId);
    }
  }

  // 导出房间（去掉 charId）
  const rooms: PixelRoomPreset[] = homeState.rooms.map(r => ({
    roomId: r.roomId,
    furniture: r.furniture,
    wallColor: r.wallColor,
    floorColor: r.floorColor,
    ambiance: r.ambiance,
    wallFillMode: r.wallFillMode,
    wallOffsetX: r.wallOffsetX,
    wallOffsetY: r.wallOffsetY,
    floorFillMode: r.floorFillMode,
    floorOffsetX: r.floorOffsetX,
    floorOffsetY: r.floorOffsetY,
  }));

  // 导出用到的资产（精简，去掉 originalImage 节省空间）
  const assets: PixelAssetPreset[] = allAssets
    .filter(a => usedAssetIds.has(a.id))
    .map(a => ({
      id: a.id,
      name: a.name,
      pixelImage: a.pixelImage,
      pixelSize: a.pixelSize,
      palette: a.palette,
      width: a.width,
      height: a.height,
    }));

  const preset: PixelHomePreset = {
    version: 1,
    name: presetName,
    author,
    createdAt: Date.now(),
    rooms,
    assets,
  };

  return JSON.stringify(preset);
}

/** 导出并下载为 .json 文件 */
export async function downloadPreset(
  homeState: PixelHomeState,
  allAssets: PixelAsset[],
  presetName: string,
  author: string,
): Promise<void> {
  const json = await exportPreset(homeState, allAssets, presetName, author);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pixel_home_${presetName.replace(/\s+/g, '_')}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 导入 ────────────────────────────────────────────

export interface ImportResult {
  success: boolean;
  roomsImported: number;
  assetsImported: number;
  error?: string;
}

/** 从 JSON 字符串解析并导入预设 */
export async function importPreset(
  json: string,
  charId: string,
): Promise<ImportResult> {
  try {
    const preset: PixelHomePreset = JSON.parse(json);

    // 验证格式
    if (!preset.version || !preset.rooms || !Array.isArray(preset.rooms)) {
      return { success: false, roomsImported: 0, assetsImported: 0, error: '无效的预设文件格式' };
    }

    // 导入资产（跳过已存在的）
    let assetsImported = 0;
    if (preset.assets && preset.assets.length > 0) {
      const existingAssets = await PixelAssetDB.getAll();
      const existingIds = new Set(existingAssets.map(a => a.id));

      for (const presetAsset of preset.assets) {
        if (!existingIds.has(presetAsset.id)) {
          const fullAsset: PixelAsset = {
            ...presetAsset,
            originalImage: presetAsset.pixelImage, // 没有原图，用像素图代替
            createdAt: Date.now(),
            tags: ['imported'],
          };
          await PixelAssetDB.save(fullAsset);
          assetsImported++;
        }
      }
    }

    // 导入房间布局
    let roomsImported = 0;
    for (const presetRoom of preset.rooms) {
      const layout: PixelRoomLayout = {
        roomId: presetRoom.roomId,
        charId,
        furniture: presetRoom.furniture,
        wallColor: presetRoom.wallColor,
        floorColor: presetRoom.floorColor,
        ambiance: presetRoom.ambiance,
        wallFillMode: presetRoom.wallFillMode,
        wallOffsetX: presetRoom.wallOffsetX,
        wallOffsetY: presetRoom.wallOffsetY,
        floorFillMode: presetRoom.floorFillMode,
        floorOffsetX: presetRoom.floorOffsetX,
        floorOffsetY: presetRoom.floorOffsetY,
        lastUpdatedAt: Date.now(),
        lastDecoratedBy: 'user',
      };
      await PixelLayoutDB.save(layout);
      roomsImported++;
    }

    return { success: true, roomsImported, assetsImported };
  } catch (err: any) {
    return { success: false, roomsImported: 0, assetsImported: 0, error: err.message || '解析失败' };
  }
}

/** 从文件读取 JSON 字符串 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
