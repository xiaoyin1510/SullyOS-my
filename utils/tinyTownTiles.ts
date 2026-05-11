/**
 * City Tile Generator — 精致都市版 v2
 *
 * 用 Canvas API 在运行时生成现代城市风格像素地砖
 * v2: 升级到 32x32 像素，加入抖动渐变、亚像素细节、反光效果
 * 更精致的建筑轮廓、窗户排列和霓虹灯光效
 */

import { SimSeason } from '../types';

const TILE_SIZE = 32;

function createTileCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = TILE_SIZE; c.height = TILE_SIZE;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    return [c, ctx];
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1);
}

function fill(ctx: CanvasRenderingContext2D, color: string) {
    ctx.fillStyle = color; ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
    ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
}

/** 有序抖动 (ordered dithering) 2x2 Bayer 矩阵 */
function dither(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c1: string, c2: string, threshold = 0.5) {
    const bayer = [[0.00, 0.50], [0.75, 0.25]];
    for (let py = y; py < y + h; py++) {
        for (let px2 = x; px2 < x + w; px2++) {
            const v = bayer[py % 2][px2 % 2];
            ctx.fillStyle = v < threshold ? c1 : c2;
            ctx.fillRect(px2, py, 1, 1);
        }
    }
}

/** 高光条纹 */
function highlight(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 0.15) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
}

/** 阴影条纹 */
function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 0.2) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
}

// ── 调色板 ──────────────────────────────────────────────────────

const PAL = {
    // 地面
    asphalt: '#2a2a3a', asphaltMid: '#323242', asphaltLight: '#3a3a4a', asphaltDark: '#1e1e2e',
    sidewalk: '#4a4a5a', sidewalkLight: '#5a5a6a', sidewalkMid: '#525262',
    road: '#303040', roadLine: '#e8c840', roadLineWhite: '#cccccc',
    // 建筑基础
    concrete: '#555568', concreteDark: '#3d3d50', concreteLight: '#6a6a7d', concreteMid: '#4c4c60',
    glass: '#2d4570', glassBright: '#4a70a8', glassReflect: '#7aa0d0', glassDark: '#1e3058',
    steel: '#5a5a6a', steelDark: '#404050', steelLight: '#7a7a8a', steelMid: '#4d4d5d',
    brick: '#6a4030', brickDark: '#4a2820', brickLight: '#8a5a48', brickMid: '#7a4a38',
    // 霓虹色（更柔和、更丰富的层次）
    neonPink: '#ff4488', neonPinkGlow: '#ff88aa', neonBlue: '#44aaff', neonBlueGlow: '#88ccff',
    neonGreen: '#44ff88', neonGreenGlow: '#88ffaa',
    neonPurple: '#aa44ff', neonPurpleGlow: '#cc88ff',
    neonOrange: '#ff8844', neonYellow: '#ffdd44',
    // 窗户（更丰富的灯光色调）
    windowWarm: '#ffe8a0', windowCool: '#a0c8ff', windowDark: '#202030', windowGlow: '#fff4d0',
    windowBlue: '#4080b8',
    // 门
    doorMetal: '#484858', doorGlass: '#3a6090', doorFrame: '#383848',
    // 植物（城市绿化）
    treeDark: '#1a5a30', treeLight: '#2a7a40', treeMid: '#206a38', leafShadow: '#145028',
    // 通用
    outline: '#1a1a2a', white: '#e8e8f0', black: '#0c0c18',
    warmGray: '#6b6577',
    // 季节变体
    springNeon: '#ff88cc', summerNeon: '#ff4444', fallNeon: '#ff8800', winterNeon: '#88ccff',
    // 水/公园
    parkGreen: '#1a4a28', parkLight: '#2a6a3a', parkMid: '#225a32', pondBlue: '#2848a0',
};

// ── 地面 ─────────────────────────────────────────────────────

function drawAsphalt(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.asphalt);
    // 精致碎石纹理 - 多层次
    dither(ctx, 0, 0, 16, 16, PAL.asphalt, PAL.asphaltMid, 0.6);
    dither(ctx, 16, 16, 16, 16, PAL.asphalt, PAL.asphaltMid, 0.6);
    // 散落细节点
    const spots = [[3,5],[8,2],[14,9],[22,4],[27,13],[6,20],[18,24],[25,28],[10,30],[4,14],[20,7],[30,19]];
    spots.forEach(([x, y]) => px(ctx, x, y, PAL.asphaltLight));
    const darkSpots = [[1,8],[12,3],[19,15],[26,22],[7,27],[15,19],[28,6],[5,25]];
    darkSpots.forEach(([x, y]) => px(ctx, x, y, PAL.asphaltDark));
    // 微裂纹
    rect(ctx, 10, 14, 4, 1, PAL.asphaltDark);
    px(ctx, 14, 15, PAL.asphaltDark);
}

function drawAsphaltAlt(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.asphaltMid);
    dither(ctx, 0, 0, 32, 32, PAL.asphaltMid, PAL.asphaltLight, 0.65);
    // 排水口盖
    rect(ctx, 12, 12, 8, 8, PAL.asphaltDark);
    rect(ctx, 13, 13, 6, 6, PAL.steelDark);
    for (let i = 0; i < 4; i++) rect(ctx, 14, 14 + i * 1.5, 4, 1, PAL.asphaltDark);
    highlight(ctx, 13, 13, 6, 1, 0.1);
}

function drawRoad(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.road);
    dither(ctx, 0, 0, 32, 32, PAL.road, PAL.asphaltDark, 0.7);
    // 中间虚线
    rect(ctx, 15, 0, 2, 6, PAL.roadLineWhite);
    rect(ctx, 15, 14, 2, 6, PAL.roadLineWhite);
    // 边线
    rect(ctx, 0, 0, 2, 32, PAL.roadLineWhite);
    rect(ctx, 30, 0, 2, 32, PAL.roadLineWhite);
    // 路面反光
    highlight(ctx, 8, 10, 6, 1, 0.06);
    highlight(ctx, 18, 22, 8, 1, 0.06);
}

function drawSidewalk(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.sidewalk);
    // 砖块纹理 — 精致交错排列
    for (let y = 0; y < 32; y += 4) {
        const offset = (y / 4) % 2 === 0 ? 0 : 4;
        for (let x = -4; x < 36; x += 8) {
            rect(ctx, x + offset, y, 7, 3, PAL.sidewalkLight);
            shadow(ctx, x + offset, y + 3, 7, 1, 0.1);
            highlight(ctx, x + offset, y, 7, 1, 0.08);
        }
    }
    // 灰尘污渍
    px(ctx, 5, 7, PAL.sidewalkMid); px(ctx, 20, 23, PAL.sidewalkMid);
}

function drawPark(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.parkGreen);
    dither(ctx, 0, 0, 32, 32, PAL.parkGreen, PAL.parkMid, 0.55);
    // 草叶纹理
    const grassBlades = [[2,3],[6,8],[10,1],[15,12],[20,5],[25,9],[28,15],[4,20],[12,24],[18,28],[24,22],[30,3],[8,16],[22,18]];
    grassBlades.forEach(([x, y]) => { px(ctx, x, y, PAL.parkLight); px(ctx, x, y-1, PAL.treeLight); });
    // 小花
    px(ctx, 7, 11, '#e879f9'); px(ctx, 23, 7, '#fbbf24'); px(ctx, 14, 26, '#fb7185');
}

// ── 建筑 ─────────────────────────────────────────────────────

function drawApartment(ctx: CanvasRenderingContext2D, accentColor = PAL.neonBlue) {
    fill(ctx, PAL.asphalt);
    // 建筑主体 — 分层渐变
    rect(ctx, 3, 3, 26, 27, PAL.concrete);
    dither(ctx, 3, 3, 26, 27, PAL.concrete, PAL.concreteMid, 0.6);
    // 底部阴影
    rect(ctx, 3, 28, 26, 2, PAL.concreteDark);
    shadow(ctx, 3, 26, 26, 2, 0.15);
    // 窗户网格 — 精致排列
    for (let y = 5; y < 26; y += 4) {
        for (let x = 5; x < 27; x += 5) {
            const lit = ((x * 7 + y * 13) % 10) > 3;
            const wc = lit ? (((x + y) % 3 === 0) ? PAL.windowCool : PAL.windowWarm) : PAL.windowDark;
            rect(ctx, x, y, 3, 2, wc);
            if (lit) {
                // 窗框
                rect(ctx, x, y, 3, 1, PAL.windowGlow);
                shadow(ctx, x, y + 2, 3, 1, 0.15);
            }
            // 窗框描边
            ctx.globalAlpha = 0.2;
            ctx.strokeStyle = PAL.outline;
            ctx.strokeRect(x - 0.5, y - 0.5, 4, 3);
            ctx.globalAlpha = 1;
        }
    }
    // 入口门厅
    rect(ctx, 12, 24, 8, 6, PAL.doorGlass);
    rect(ctx, 11, 24, 1, 6, PAL.doorFrame);
    rect(ctx, 20, 24, 1, 6, PAL.doorFrame);
    highlight(ctx, 13, 24, 3, 6, 0.12);
    // 霓虹顶线 — 双层发光
    rect(ctx, 3, 3, 26, 2, accentColor);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = accentColor;
    ctx.fillRect(3, 1, 26, 2);
    ctx.globalAlpha = 1;
    // 建筑边缘高光
    highlight(ctx, 3, 3, 1, 25, 0.08);
}

function drawSkyscraper(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.asphalt);
    // 高楼主体 — 玻璃幕墙
    rect(ctx, 6, 1, 20, 29, PAL.glass);
    dither(ctx, 6, 1, 20, 29, PAL.glass, PAL.glassDark, 0.55);
    rect(ctx, 6, 29, 20, 2, PAL.steelDark);
    // 幕墙横条反光
    for (let y = 3; y < 28; y += 3) {
        rect(ctx, 7, y, 18, 1, PAL.glassBright);
        highlight(ctx, 7, y, 10, 1, 0.12);
    }
    // 窗户灯光点 — 随机但固定
    for (let y = 5; y < 27; y += 4) {
        for (let x = 8; x < 24; x += 4) {
            const lit = ((x * 11 + y * 7) % 10) > 4;
            if (lit) {
                px(ctx, x, y, PAL.windowWarm);
                px(ctx, x + 1, y, PAL.windowWarm);
            }
        }
    }
    // 天线 — 更精致
    rect(ctx, 15, 0, 2, 2, PAL.steelLight);
    px(ctx, 15, 0, PAL.neonPink);
    px(ctx, 16, 0, PAL.neonPinkGlow);
    // 楼体右侧阴影
    shadow(ctx, 24, 1, 2, 29, 0.12);
    // 入口
    rect(ctx, 13, 27, 6, 4, PAL.doorGlass);
    highlight(ctx, 14, 27, 2, 4, 0.1);
}

function drawCafe(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.asphalt);
    // 店面主体 — 砖墙质感
    rect(ctx, 2, 10, 28, 20, PAL.brickLight);
    dither(ctx, 2, 10, 28, 20, PAL.brickLight, PAL.brickMid, 0.6);
    rect(ctx, 2, 29, 28, 2, PAL.brickDark);
    // 砖纹细节
    for (let y = 12; y < 28; y += 4) {
        const off = (y / 4) % 2 === 0 ? 0 : 3;
        for (let x = 2 + off; x < 30; x += 6) {
            shadow(ctx, x, y + 3, 5, 1, 0.08);
        }
    }
    // 大玻璃橱窗
    rect(ctx, 3, 16, 10, 8, PAL.windowBlue);
    rect(ctx, 19, 16, 10, 8, PAL.windowBlue);
    highlight(ctx, 3, 16, 4, 8, 0.15);
    highlight(ctx, 19, 16, 4, 8, 0.15);
    // 窗户内部温暖光点
    px(ctx, 6, 19, PAL.windowWarm); px(ctx, 8, 20, PAL.windowWarm);
    px(ctx, 23, 19, PAL.windowWarm); px(ctx, 25, 20, PAL.windowWarm);
    // 门
    rect(ctx, 14, 18, 4, 13, PAL.doorGlass);
    rect(ctx, 13, 18, 1, 13, PAL.doorFrame);
    rect(ctx, 18, 18, 1, 13, PAL.doorFrame);
    // 遮阳篷 — 更精致的条纹
    for (let x = 1; x < 31; x++) {
        const stripe = Math.floor(x / 3) % 2;
        const c = stripe === 0 ? PAL.neonOrange : PAL.white;
        rect(ctx, x, 8, 1, 3, c);
    }
    shadow(ctx, 1, 11, 30, 1, 0.15);
    // 招牌 — 渐变发光
    rect(ctx, 5, 6, 22, 2, PAL.neonGreen);
    ctx.globalAlpha = 0.3; ctx.fillStyle = PAL.neonGreenGlow;
    ctx.fillRect(5, 5, 22, 1); ctx.globalAlpha = 1;
    // 窗台花盆
    rect(ctx, 4, 15, 3, 1, '#92400e');
    px(ctx, 5, 14, PAL.treeLight); px(ctx, 6, 14, PAL.treeMid);
    rect(ctx, 26, 15, 3, 1, '#92400e');
    px(ctx, 27, 14, PAL.treeLight); px(ctx, 28, 14, PAL.treeMid);
}

function drawClub(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.asphalt);
    // 建筑主体 — 深色
    rect(ctx, 2, 6, 28, 24, PAL.black);
    dither(ctx, 2, 6, 28, 24, PAL.black, PAL.outline, 0.7);
    rect(ctx, 2, 29, 28, 2, PAL.outline);
    // 霓虹门框 — 双层
    rect(ctx, 10, 14, 12, 16, PAL.neonPurple);
    rect(ctx, 11, 15, 10, 15, PAL.neonPurpleGlow);
    rect(ctx, 12, 16, 8, 14, PAL.black);
    // 门内黑暗渐变
    shadow(ctx, 12, 16, 8, 4, 0.3);
    // 霓虹灯条
    rect(ctx, 2, 6, 28, 2, PAL.neonPink);
    ctx.globalAlpha = 0.4; ctx.fillStyle = PAL.neonPinkGlow;
    ctx.fillRect(2, 5, 28, 1); ctx.globalAlpha = 1;
    rect(ctx, 2, 10, 28, 1, PAL.neonBlue);
    ctx.globalAlpha = 0.3; ctx.fillStyle = PAL.neonBlueGlow;
    ctx.fillRect(2, 9, 28, 1); ctx.globalAlpha = 1;
    // 招牌闪烁 — 多层霓虹灯
    const signs = [
        [6, 3, PAL.neonPink], [10, 2, PAL.neonBlue], [14, 3, PAL.neonYellow],
        [18, 2, PAL.neonGreen], [22, 3, PAL.neonPurple], [26, 2, PAL.neonOrange],
    ];
    signs.forEach(([x, y, c]) => {
        px(ctx, x as number, y as number, c as string);
        ctx.globalAlpha = 0.3; px(ctx, (x as number) + 1, y as number, c as string); ctx.globalAlpha = 1;
    });
    // 地面反光
    for (let x = 10; x < 22; x++) {
        ctx.globalAlpha = 0.08;
        px(ctx, x, 30, PAL.neonPurple); px(ctx, x, 31, PAL.neonPurple);
        ctx.globalAlpha = 1;
    }
}

function drawOffice(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.asphalt);
    // 写字楼主体
    rect(ctx, 5, 2, 22, 28, PAL.steel);
    dither(ctx, 5, 2, 22, 28, PAL.steel, PAL.steelMid, 0.6);
    rect(ctx, 5, 29, 22, 2, PAL.steelDark);
    // 玻璃窗格 — 整齐的网格
    for (let y = 4; y < 28; y += 3) {
        for (let x = 7; x < 25; x += 3) {
            const lit = ((y + x) % 5 < 3);
            rect(ctx, x, y, 2, 2, lit ? PAL.windowWarm : PAL.glassBright);
            if (lit) highlight(ctx, x, y, 2, 1, 0.1);
        }
    }
    // 大厅
    rect(ctx, 12, 24, 8, 7, PAL.doorGlass);
    highlight(ctx, 13, 24, 3, 7, 0.1);
    rect(ctx, 11, 24, 1, 7, PAL.doorFrame);
    rect(ctx, 20, 24, 1, 7, PAL.doorFrame);
    // 顶部装饰
    rect(ctx, 6, 1, 20, 1, PAL.steelLight);
    highlight(ctx, 6, 1, 20, 1, 0.15);
    // 侧面阴影
    shadow(ctx, 25, 2, 2, 28, 0.1);
}

// ── 城市装饰 ─────────────────────────────────────────────────

function drawCityTree(ctx: CanvasRenderingContext2D, season?: SimSeason) {
    fill(ctx, PAL.sidewalk);
    dither(ctx, 0, 0, 32, 32, PAL.sidewalk, PAL.sidewalkLight, 0.65);
    // 树根区域阴影
    ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.ellipse(16, 28, 8, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1;
    // 树干 — 有纹理
    rect(ctx, 14, 18, 4, 12, '#5a4030');
    dither(ctx, 14, 18, 4, 12, '#5a4030', '#4a3020', 0.55);
    highlight(ctx, 14, 18, 1, 12, 0.08);
    // 树冠 — 多层圆形叠加，更自然
    const leafC = season === 'fall' ? '#c06020' : season === 'winter' ? '#6a8aaa' : PAL.treeLight;
    const leafD = season === 'fall' ? '#a04010' : season === 'winter' ? '#5a7a9a' : PAL.treeDark;
    // 底层（大）
    ctx.beginPath(); ctx.arc(16, 12, 10, 0, Math.PI * 2);
    ctx.fillStyle = leafC; ctx.fill();
    // 中层
    ctx.beginPath(); ctx.arc(13, 10, 6, 0, Math.PI * 2);
    ctx.fillStyle = leafD; ctx.fill();
    ctx.beginPath(); ctx.arc(20, 11, 5, 0, Math.PI * 2);
    ctx.fillStyle = leafD; ctx.fill();
    // 顶层高光
    ctx.beginPath(); ctx.arc(15, 8, 5, 0, Math.PI * 2);
    ctx.fillStyle = leafC; ctx.fill();
    highlight(ctx, 12, 5, 6, 3, 0.12);
    // 季节效果
    if (season === 'winter') {
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(16, 7, 7, Math.PI, 0);
        ctx.fillStyle = '#e0eaf0'; ctx.fill();
        ctx.globalAlpha = 1;
    }
    if (season === 'fall') {
        // 飘落的叶子
        px(ctx, 5, 22, '#e08030'); px(ctx, 24, 25, '#d06020');
        px(ctx, 8, 27, '#c06020'); px(ctx, 26, 20, '#b05010');
    }
}

function drawStreetLight(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.sidewalk);
    dither(ctx, 0, 0, 32, 32, PAL.sidewalk, PAL.sidewalkLight, 0.65);
    // 灯柱 — 有粗细变化
    rect(ctx, 15, 8, 2, 22, PAL.steelDark);
    rect(ctx, 14, 26, 4, 3, PAL.steelDark);
    dither(ctx, 15, 8, 2, 22, PAL.steelDark, PAL.steelMid, 0.5);
    // 灯头
    rect(ctx, 10, 4, 12, 4, PAL.steelLight);
    highlight(ctx, 10, 4, 12, 1, 0.15);
    // 灯泡
    rect(ctx, 13, 6, 6, 2, PAL.windowWarm);
    // 光晕 — 多层次
    ctx.globalAlpha = 0.08;
    ctx.beginPath(); ctx.arc(16, 10, 10, 0, Math.PI * 2);
    ctx.fillStyle = PAL.windowWarm; ctx.fill();
    ctx.globalAlpha = 0.05;
    ctx.beginPath(); ctx.arc(16, 14, 14, 0, Math.PI * 2);
    ctx.fillStyle = PAL.windowGlow; ctx.fill();
    ctx.globalAlpha = 1;
    // 地面光影
    highlight(ctx, 10, 28, 12, 2, 0.06);
}

function drawBench(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.sidewalk);
    dither(ctx, 0, 0, 32, 32, PAL.sidewalk, PAL.sidewalkLight, 0.65);
    // 长椅阴影
    shadow(ctx, 7, 22, 18, 2, 0.1);
    // 座面木板
    rect(ctx, 5, 15, 22, 2, '#8a6a58');
    rect(ctx, 5, 17, 22, 2, '#7a5a48');
    // 靠背
    rect(ctx, 5, 11, 22, 2, '#8a6a58');
    rect(ctx, 5, 13, 22, 2, '#7a5a48');
    // 高光
    highlight(ctx, 5, 15, 22, 1, 0.1);
    highlight(ctx, 5, 11, 22, 1, 0.1);
    // 椅腿 — 金属质感
    rect(ctx, 8, 19, 2, 6, PAL.steelDark);
    rect(ctx, 22, 19, 2, 6, PAL.steelDark);
    rect(ctx, 8, 9, 2, 2, PAL.steelDark);
    rect(ctx, 22, 9, 2, 2, PAL.steelDark);
    highlight(ctx, 8, 19, 1, 6, 0.08);
    highlight(ctx, 22, 19, 1, 6, 0.08);
}

function drawTrashCan(ctx: CanvasRenderingContext2D) {
    fill(ctx, PAL.sidewalk);
    dither(ctx, 0, 0, 32, 32, PAL.sidewalk, PAL.sidewalkLight, 0.65);
    // 桶身
    rect(ctx, 10, 10, 12, 16, PAL.steelDark);
    dither(ctx, 10, 10, 12, 16, PAL.steelDark, PAL.steelMid, 0.55);
    // 桶盖
    rect(ctx, 8, 8, 16, 3, PAL.steelLight);
    highlight(ctx, 8, 8, 16, 1, 0.12);
    // 桶底
    rect(ctx, 10, 26, 12, 2, PAL.steel);
    // 金属带
    rect(ctx, 10, 15, 12, 1, PAL.steelLight);
    rect(ctx, 10, 21, 12, 1, PAL.steelLight);
    // 侧面反光
    highlight(ctx, 10, 10, 2, 16, 0.08);
    shadow(ctx, 20, 10, 2, 16, 0.08);
}

// ── 地图背景生成 ──────────────────────────────────────────────

function drawTilemap(cols: number, rows: number, season: SimSeason = 'spring'): string {
    const c = document.createElement('canvas');
    c.width = TILE_SIZE * cols; c.height = TILE_SIZE * rows;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };

    // 城市地面基调
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            ctx.save();
            ctx.translate(col * TILE_SIZE, row * TILE_SIZE);
            const r = rand();
            if (r < 0.5) drawAsphalt(ctx);
            else if (r < 0.8) drawAsphaltAlt(ctx);
            else drawSidewalk(ctx);
            ctx.restore();
        }
    }

    // 季节色调叠加 — 更微妙
    const overlays: Record<SimSeason, string> = {
        spring: 'rgba(180,140,255,0.06)',
        summer: 'rgba(255,100,50,0.05)',
        fall: 'rgba(255,150,50,0.08)',
        winter: 'rgba(120,160,220,0.10)',
    };
    ctx.fillStyle = overlays[season];
    ctx.fillRect(0, 0, c.width, c.height);

    // 散布霓虹光点 — 更柔和、更多层次
    const neonColors = [PAL.neonPink, PAL.neonBlue, PAL.neonGreen, PAL.neonPurple, PAL.neonOrange];
    for (let i = 0; i < 20; i++) {
        const nx = Math.floor(rand() * c.width);
        const ny = Math.floor(rand() * c.height);
        const nc = neonColors[Math.floor(rand() * neonColors.length)];
        // 外层光晕
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = nc;
        ctx.beginPath(); ctx.arc(nx, ny, 6, 0, Math.PI * 2); ctx.fill();
        // 核心亮点
        ctx.globalAlpha = 0.15;
        ctx.fillRect(nx, ny, 2, 2);
    }
    ctx.globalAlpha = 1;

    // 环境光渐变 — 底部更暗，模拟城市灯光
    const grad = ctx.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);

    return c.toDataURL('image/png');
}

// ── 导出接口 ─────────────────────────────────────────────────

export interface TileSet {
    grass: string;
    grassAlt: string;
    path: string;
    water: string;
    sand: string;
    treePine: string;
    treeRound: string;
    flowers: string;
    houseRed: string;
    houseBlue: string;
    houseLarge: string;
    castle: string;
    bridge: string;
    fence: string;
    rock: string;
    bush: string;
    farmPlot: string;
    farmPlotCrop: string;
    mineEntrance: string;
    fishpond: string;
    market: string;
    workshop: string;
    /** 完整城市地图背景 */
    mapBackground: string;
}

const _cache: Record<string, TileSet> = {};

export function getTileSet(season: SimSeason = 'spring'): TileSet {
    if (_cache[season]) return _cache[season];

    const gen = (draw: (ctx: CanvasRenderingContext2D) => void): string => {
        const [c, ctx] = createTileCanvas();
        draw(ctx);
        return c.toDataURL('image/png');
    };

    const generated: TileSet = {
        grass:       gen(drawPark),
        grassAlt:    gen(drawAsphaltAlt),
        path:        gen(drawRoad),
        water:       gen(ctx => drawSidewalk(ctx)),
        sand:        gen(drawSidewalk),
        treePine:    gen(ctx => drawCityTree(ctx, season)),
        treeRound:   gen(ctx => drawCityTree(ctx, season)),
        flowers:     gen(drawBench),
        houseRed:    gen(ctx => drawApartment(ctx, PAL.neonPink)),
        houseBlue:   gen(ctx => drawApartment(ctx, PAL.neonBlue)),
        houseLarge:  gen(drawSkyscraper),
        castle:      gen(drawOffice),
        bridge:      gen(drawStreetLight),
        fence:       gen(drawTrashCan),
        rock:        gen(drawStreetLight),
        bush:        gen(ctx => drawCityTree(ctx, season)),
        farmPlot:    gen(drawCafe),
        farmPlotCrop:gen(drawCafe),
        mineEntrance:gen(drawClub),
        fishpond:    gen(drawPark),
        market:      gen(drawCafe),
        workshop:    gen(drawOffice),
        mapBackground: drawTilemap(20, 19, season),
    };

    _cache[season] = generated;

    return _cache[season];
}

export function houseForFamily(emoji: string): keyof TileSet {
    switch (emoji) {
        case '🏢': return 'houseRed';
        case '🏙️': return 'houseLarge';
        case '🏬': return 'houseBlue';
        case '🏨': return 'castle';
        case '🌃': return 'houseLarge';
        case '🌆': return 'houseRed';
        default: return 'houseLarge';
    }
}

export function decorForEmoji(emoji: string): keyof TileSet | null {
    switch (emoji) {
        case '🌲': case '🌳': return 'treePine';
        case '🪑': return 'flowers';
        case '🚗': return 'path';
        case '💡': return 'bridge';
        case '🌿': return 'bush';
        default: return null;
    }
}

export function buildingTileKey(type: string): keyof TileSet {
    switch (type) {
        case 'cafe':      return 'farmPlot';
        case 'club':      return 'mineEntrance';
        case 'park':      return 'fishpond';
        case 'market':    return 'market';
        case 'office':    return 'workshop';
        default: return 'houseLarge';
    }
}
