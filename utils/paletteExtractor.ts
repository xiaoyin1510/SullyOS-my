/**
 * 调色板提取 — Median Cut 色彩量化
 *
 * 纯 JS 实现，无外部依赖。
 * - extractPalette: 从 ImageData 提取 N 色调色板
 * - applyPalette: 将图片重映射到指定调色板
 */

// ─── Median Cut 调色板提取 ───────────────────────────

/**
 * 从图片中提取 N 色调色板。
 * @param imageData 图片数据
 * @param colorCount 目标颜色数 (4-16)
 * @returns hex 颜色数组
 */
export function extractPalette(imageData: ImageData, colorCount: number): string[] {
  const { data, width, height } = imageData;
  const pixels: [number, number, number][] = [];

  // 收集所有非透明像素
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 20) continue; // 跳过透明
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }

  if (pixels.length === 0) return ['#808080'];

  // Median Cut
  const buckets = medianCut(pixels, colorCount);

  // 每个 bucket 取平均色
  return buckets.map(bucket => {
    let r = 0, g = 0, b = 0;
    for (const [pr, pg, pb] of bucket) {
      r += pr; g += pg; b += pb;
    }
    const n = bucket.length;
    return rgbToHex(Math.round(r / n), Math.round(g / n), Math.round(b / n));
  });
}

/**
 * Median Cut 递归分割。
 */
function medianCut(
  pixels: [number, number, number][],
  targetCount: number,
): [number, number, number][][] {
  if (targetCount <= 1 || pixels.length <= 1) return [pixels];

  // 找到 RGB 中 range 最大的通道
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const [r, g, b] of pixels) {
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (g < minG) minG = g; if (g > maxG) maxG = g;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }

  const rangeR = maxR - minR;
  const rangeG = maxG - minG;
  const rangeB = maxB - minB;

  // 按最大 range 的通道排序
  let channel: 0 | 1 | 2;
  if (rangeR >= rangeG && rangeR >= rangeB) channel = 0;
  else if (rangeG >= rangeR && rangeG >= rangeB) channel = 1;
  else channel = 2;

  pixels.sort((a, b) => a[channel] - b[channel]);

  // 从中位数切分
  const mid = Math.floor(pixels.length / 2);
  const left = pixels.slice(0, mid);
  const right = pixels.slice(mid);

  // 递归：平均分配目标颜色数
  const leftCount = Math.floor(targetCount / 2);
  const rightCount = targetCount - leftCount;

  return [
    ...medianCut(left, leftCount),
    ...medianCut(right, rightCount),
  ];
}

// ─── 调色板应用 ──────────────────────────────────────

/**
 * 将图片的每个像素重映射到最近的调色板颜色。
 * @param imageData 原始图片数据（会被修改）
 * @param palette hex 调色板
 */
export function applyPalette(imageData: ImageData, palette: string[]): void {
  const { data } = imageData;
  const paletteRgb = palette.map(hexToRgb);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 20) continue; // 跳过透明

    const r = data[i], g = data[i + 1], b = data[i + 2];
    let minDist = Infinity;
    let bestIdx = 0;

    for (let j = 0; j < paletteRgb.length; j++) {
      const [pr, pg, pb] = paletteRgb[j];
      const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (dist < minDist) {
        minDist = dist;
        bestIdx = j;
      }
    }

    data[i] = paletteRgb[bestIdx][0];
    data[i + 1] = paletteRgb[bestIdx][1];
    data[i + 2] = paletteRgb[bestIdx][2];
  }
}

// ─── 辅助 ────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
