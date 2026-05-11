/**
 * 像素化引擎 — Canvas 图片→像素转换核心算法
 *
 * 纯 Canvas API，无外部依赖。
 * - pixelizeImage: 缩放 + 调色板量化 + 轮廓生成
 * - removeBackground: 四角 flood fill 背景去除
 * - autoSplit: 连通域分析，分割合并的形状
 */

// ─── 像素化主函数 ────────────────────────────────────

export interface PixelizeResult {
  imageData: ImageData;
  width: number;
  height: number;
}

/**
 * 将图片像素化。
 * @param source 原始图片 ImageData
 * @param targetSize 目标像素尺寸（较长边）
 * @param palette 可选调色板 (hex 数组)，如果提供则量化到该调色板
 */
export function pixelizeImage(
  source: ImageData,
  targetSize: number,
  palette?: string[],
): PixelizeResult {
  const { width: srcW, height: srcH } = source;

  // 计算等比缩放后的尺寸
  const ratio = srcW / srcH;
  let dstW: number, dstH: number;
  if (ratio >= 1) {
    dstW = targetSize;
    dstH = Math.max(1, Math.round(targetSize / ratio));
  } else {
    dstH = targetSize;
    dstW = Math.max(1, Math.round(targetSize * ratio));
  }

  // 1. 缩放（nearest neighbor 通过取样）
  const result = new ImageData(dstW, dstH);

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      // 对应原图区域的中心点
      const sx = Math.floor((dx + 0.5) * srcW / dstW);
      const sy = Math.floor((dy + 0.5) * srcH / dstH);
      const srcIdx = (sy * srcW + sx) * 4;
      const dstIdx = (dy * dstW + dx) * 4;

      let r = source.data[srcIdx];
      let g = source.data[srcIdx + 1];
      let b = source.data[srcIdx + 2];
      let a = source.data[srcIdx + 3];

      // 2. 调色板量化
      if (palette && palette.length > 0 && a > 20) {
        const nearest = findNearestColor(r, g, b, palette);
        r = nearest[0];
        g = nearest[1];
        b = nearest[2];
      }

      result.data[dstIdx] = r;
      result.data[dstIdx + 1] = g;
      result.data[dstIdx + 2] = b;
      result.data[dstIdx + 3] = a;
    }
  }

  // 3. 生成轮廓线
  addOutline(result, dstW, dstH);

  return { imageData: result, width: dstW, height: dstH };
}

// ─── 背景去除 ────────────────────────────────────────

/**
 * 从四角 flood fill 去除相似背景色。
 * @param source 原始 ImageData（会被修改）
 * @param threshold 颜色差异阈值 (0-255)，默认 30
 */
export function removeBackground(source: ImageData, threshold = 30): ImageData {
  const { width, height, data } = source;
  const result = new ImageData(new Uint8ClampedArray(data), width, height);
  const visited = new Uint8Array(width * height);

  // 从四个角取样背景色
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];

  // 取四角颜色的平均值作为背景参考色
  let bgR = 0, bgG = 0, bgB = 0, count = 0;
  for (const [cx, cy] of corners) {
    const idx = (cy * width + cx) * 4;
    if (data[idx + 3] > 128) { // 不算已经透明的角
      bgR += data[idx];
      bgG += data[idx + 1];
      bgB += data[idx + 2];
      count++;
    }
  }
  if (count === 0) return result; // 四角都透明，无需处理
  bgR = Math.round(bgR / count);
  bgG = Math.round(bgG / count);
  bgB = Math.round(bgB / count);

  // BFS flood fill 从四角开始
  const queue: number[] = [];
  for (const [cx, cy] of corners) {
    const idx = cy * width + cx;
    if (!visited[idx]) {
      queue.push(idx);
      visited[idx] = 1;
    }
  }

  while (queue.length > 0) {
    const pos = queue.shift()!;
    const px = pos % width;
    const py = Math.floor(pos / width);
    const dataIdx = pos * 4;

    const r = result.data[dataIdx];
    const g = result.data[dataIdx + 1];
    const b = result.data[dataIdx + 2];

    // 判断是否是背景色
    const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
    if (dist <= threshold) {
      // 标记为透明
      result.data[dataIdx + 3] = 0;

      // 扩展到相邻像素
      const neighbors = [
        [px - 1, py], [px + 1, py],
        [px, py - 1], [px, py + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
    }
  }

  return result;
}

// ─── 连通域分割 ──────────────────────────────────────

/**
 * 分割合并的形状，返回每个独立形状的边界框。
 */
export function autoSplit(source: ImageData): { x: number; y: number; w: number; h: number }[] {
  const { width, height, data } = source;
  const labels = new Int32Array(width * height);
  let nextLabel = 1;
  const boxes: Map<number, { minX: number; minY: number; maxX: number; maxY: number }> = new Map();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const a = data[idx * 4 + 3];
      if (a < 20 || labels[idx] !== 0) continue;

      // BFS 标记连通域
      const label = nextLabel++;
      const queue = [idx];
      labels[idx] = label;
      let minX = x, minY = y, maxX = x, maxY = y;

      while (queue.length > 0) {
        const pos = queue.shift()!;
        const px = pos % width;
        const py = Math.floor(pos / width);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        const neighbors = [
          [px - 1, py], [px + 1, py],
          [px, py - 1], [px, py + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (labels[nIdx] === 0 && data[nIdx * 4 + 3] >= 20) {
              labels[nIdx] = label;
              queue.push(nIdx);
            }
          }
        }
      }

      boxes.set(label, { minX, minY, maxX, maxY });
    }
  }

  // 过滤掉太小的碎片（面积 < 总面积的 1%）
  const totalArea = width * height;
  return Array.from(boxes.values())
    .map(b => ({ x: b.minX, y: b.minY, w: b.maxX - b.minX + 1, h: b.maxY - b.minY + 1 }))
    .filter(b => b.w * b.h >= totalArea * 0.01);
}

// ─── 辅助函数 ────────────────────────────────────────

/** 在非透明像素边缘添加 1px 黑色轮廓 */
function addOutline(imageData: ImageData, width: number, height: number): void {
  const { data } = imageData;
  const outlineColor = [30, 30, 30, 255]; // 深灰轮廓

  // 先标记需要添加轮廓的位置
  const outlinePositions: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 20) {
        // 当前像素是透明的，检查是否相邻非透明像素
        const neighbors = [
          [x - 1, y], [x + 1, y],
          [x, y - 1], [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = (ny * width + nx) * 4;
            if (data[nIdx + 3] >= 20) {
              outlinePositions.push(idx);
              break;
            }
          }
        }
      }
    }
  }

  // 应用轮廓
  for (const idx of outlinePositions) {
    data[idx] = outlineColor[0];
    data[idx + 1] = outlineColor[1];
    data[idx + 2] = outlineColor[2];
    data[idx + 3] = outlineColor[3];
  }
}

/** 将 hex 颜色转为 [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** 找到调色板中最接近的颜色 */
function findNearestColor(r: number, g: number, b: number, palette: string[]): [number, number, number] {
  let minDist = Infinity;
  let nearest: [number, number, number] = [r, g, b];

  for (const hex of palette) {
    const [pr, pg, pb] = hexToRgb(hex);
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < minDist) {
      minDist = dist;
      nearest = [pr, pg, pb];
    }
  }

  return nearest;
}
