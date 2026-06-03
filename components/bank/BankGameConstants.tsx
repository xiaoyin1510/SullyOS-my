
import React from 'react';
import { ShopRecipe, ShopStaff, RoomLayout, DollhouseRoom, DollhouseState } from '../../types';

// Pixel Art Assets (Twemoji CDN for consistent cross-platform rendering)
export const BANK_ASSETS = {
    // Backgrounds (Patterns)
    floors: {
        wood: 'repeating-linear-gradient(0deg, #c19a6b 0px, #c19a6b 4px, #a67c52 5px)',
        tile: 'conic-gradient(from 90deg at 2px 2px, #fdf6e3 90deg, #eee8d5 0) 0 0/20px 20px',
        check: 'conic-gradient(#eee8d5 90deg, #fdf6e3 90deg 180deg, #eee8d5 180deg 270deg, #fdf6e3 270deg) 0 0 / 40px 40px'
    },
    // Furniture Icons (Twemoji CDN)
    furniture: {
        table: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa91.png',
        counter: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f371.png',
        plant: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fab4.png',
        window: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa9f.png',
        rug: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f9f6.png'
    }
};

export const SHOP_RECIPES: ShopRecipe[] = [
    { id: 'recipe-coffee-001', name: '手冲咖啡', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2615.png', cost: 0, appeal: 10, isUnlocked: true },
    { id: 'recipe-cake-001', name: '草莓蛋糕', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f370.png', cost: 50, appeal: 20, isUnlocked: false },
    { id: 'recipe-tea-001', name: '伯爵红茶', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f375.png', cost: 80, appeal: 25, isUnlocked: false },
    { id: 'recipe-donut-001', name: '甜甜圈', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f369.png', cost: 120, appeal: 30, isUnlocked: false },
    { id: 'recipe-icecream-001', name: '抹茶冰淇淋', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f366.png', cost: 200, appeal: 40, isUnlocked: false },
    { id: 'recipe-pudding-001', name: '焦糖布丁', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f36e.png', cost: 300, appeal: 50, isUnlocked: false },
    { id: 'recipe-cocktail-001', name: '特调气泡水', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f379.png', cost: 500, appeal: 80, isUnlocked: false },
];

export const AVAILABLE_STAFF: Omit<ShopStaff, 'hireDate' | 'fatigue'>[] = [
    { id: 'staff-dog-01', name: '柴犬服务生', avatar: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f436.png', role: 'waiter', maxFatigue: 120 },
    { id: 'staff-bear-01', name: '棕熊大厨', avatar: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f43b.png', role: 'chef', maxFatigue: 150 },
    { id: 'staff-rabbit-01', name: '兔兔前台', avatar: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f430.png', role: 'waiter', maxFatigue: 80 },
    { id: 'staff-penguin-01', name: '企鹅采购', avatar: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f427.png', role: 'manager', maxFatigue: 110 },
];

// --- DOLLHOUSE ROOM LAYOUTS ---
export const ROOM_LAYOUTS: RoomLayout[] = [
    {
        id: 'layout-cafe',
        name: '咖啡吧台',
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2615.png',
        description: '经典咖啡店格局，带吧台和窗户',
        apCost: 0,
        floorWidthRatio: 1,
        floorDepthRatio: 1,
        hasCounter: true,
        hasWindow: true,
    },
    {
        id: 'layout-kitchen',
        name: '后厨',
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f373.png',
        description: '宽敞的厨房空间',
        apCost: 100,
        floorWidthRatio: 1,
        floorDepthRatio: 0.8,
        hasCounter: true,
        hasWindow: false,
    },
    {
        id: 'layout-lounge',
        name: '休息室',
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6cb.png',
        description: '温馨的休息区，适合放沙发',
        apCost: 150,
        floorWidthRatio: 1,
        floorDepthRatio: 1,
        hasCounter: false,
        hasWindow: true,
    },
    {
        id: 'layout-storage',
        name: '储藏室',
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4e6.png',
        description: '小型储物间',
        apCost: 80,
        floorWidthRatio: 0.7,
        floorDepthRatio: 0.7,
        hasCounter: false,
        hasWindow: false,
    },
    {
        id: 'layout-vip',
        name: 'VIP包间',
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2728.png',
        description: '高级包间，适合放高端装饰',
        apCost: 300,
        floorWidthRatio: 1,
        floorDepthRatio: 1,
        hasCounter: false,
        hasWindow: true,
    },
    {
        id: 'layout-garden',
        name: '空中花园',
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f33f.png',
        description: '二楼露天阳台风格',
        apCost: 250,
        floorWidthRatio: 1,
        floorDepthRatio: 1,
        hasCounter: false,
        hasWindow: true,
    },
];

// --- WALLPAPER / FLOOR PRESETS ---
export const WALLPAPER_PRESETS = [
    { id: 'wp-cream', name: '奶油白', style: 'linear-gradient(180deg, #FEF9F0, #F5EBD8)' },
    { id: 'wp-blush', name: '蜜桃粉', style: 'linear-gradient(180deg, #FFF0F0, #FFE0E0)' },
    { id: 'wp-mint', name: '薄荷绿', style: 'linear-gradient(180deg, #F0FFF4, #C6F6D5)' },
    { id: 'wp-sky', name: '天空蓝', style: 'linear-gradient(180deg, #EBF8FF, #BEE3F8)' },
    { id: 'wp-lavender', name: '薰衣草', style: 'linear-gradient(180deg, #FAF5FF, #E9D8FD)' },
    { id: 'wp-warm', name: '暖阳橘', style: 'linear-gradient(180deg, #FFFAF0, #FEEBC8)' },
    { id: 'wp-brick', name: '复古砖墙', style: 'repeating-linear-gradient(0deg, #D4A574 0px, #D4A574 8px, #C4956A 8px, #C4956A 10px, #DEB587 10px, #DEB587 18px, #C4956A 18px, #C4956A 20px)' },
    { id: 'wp-stripe', name: '条纹', style: 'repeating-linear-gradient(90deg, #FFF8E1 0px, #FFF8E1 12px, #FFE0B2 12px, #FFE0B2 14px)' },
];

export const FLOOR_PRESETS = [
    { id: 'fl-wood', name: '木地板', style: 'linear-gradient(135deg, #C4A77D, #B8956E)' },
    { id: 'fl-tile', name: '白瓷砖', style: 'conic-gradient(from 90deg at 2px 2px, #fdf6e3 90deg, #eee8d5 0) 0 0/20px 20px' },
    { id: 'fl-check', name: '棋盘格', style: 'conic-gradient(#eee8d5 90deg, #fdf6e3 90deg 180deg, #eee8d5 180deg 270deg, #fdf6e3 270deg) 0 0 / 20px 20px' },
    { id: 'fl-dark', name: '深木纹', style: 'linear-gradient(135deg, #8B7355, #6D5A3F)' },
    { id: 'fl-marble', name: '大理石', style: 'linear-gradient(135deg, #F5F5F5 0%, #E0E0E0 25%, #F5F5F5 50%, #EEEEEE 75%, #F5F5F5 100%)' },
    { id: 'fl-tatami', name: '榻榻米', style: 'repeating-linear-gradient(0deg, #C8B88A 0px, #C8B88A 3px, #D4C89A 3px, #D4C89A 6px)' },
];

// --- DEFAULT STICKER LIBRARY ---
export const STICKER_LIBRARY = [
    { id: 'stk-plant1', name: '盆栽', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fab4.png', category: 'decor' },
    { id: 'stk-plant2', name: '仙人掌', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f335.png', category: 'decor' },
    { id: 'stk-flower', name: '花束', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f490.png', category: 'decor' },
    { id: 'stk-frame', name: '相框', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f5bc.png', category: 'wall' },
    { id: 'stk-clock', name: '挂钟', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f550.png', category: 'wall' },
    { id: 'stk-lamp', name: '台灯', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa94.png', category: 'decor' },
    { id: 'stk-sofa', name: '沙发', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6cb.png', category: 'furniture' },
    { id: 'stk-table', name: '桌子', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa91.png', category: 'furniture' },
    { id: 'stk-book', name: '书架', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4da.png', category: 'furniture' },
    { id: 'stk-coffee', name: '咖啡', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2615.png', category: 'food' },
    { id: 'stk-cake', name: '蛋糕', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f370.png', category: 'food' },
    { id: 'stk-candle', name: '蜡烛', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f56f.png', category: 'decor' },
    { id: 'stk-rug', name: '地毯', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f9f6.png', category: 'floor' },
    { id: 'stk-cat', name: '猫咪', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f431.png', category: 'pet' },
    { id: 'stk-star', name: '星星', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2b50.png', category: 'decor' },
    { id: 'stk-heart', name: '爱心', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2764.png', category: 'decor' },
    { id: 'stk-window', name: '窗户', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa9f.png', category: 'wall' },
    { id: 'stk-sign', name: '招牌', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1faa7.png', category: 'wall' },
];

// --- INITIAL DOLLHOUSE STATE ---
export const INITIAL_DOLLHOUSE: DollhouseState = {
    rooms: [
        {
            id: 'room-1f-left',
            name: '咖啡店',
            floor: 0,
            position: 'left',
            isUnlocked: true,
            layoutId: 'layout-cafe',
            wallpaperLeft: 'linear-gradient(180deg, #FEF9F0, #F5EBD8)',
            wallpaperRight: 'linear-gradient(180deg, #FEF9F0, #F5EBD8)',
            floorStyle: 'linear-gradient(135deg, #C4A77D, #B8956E)',
            roomTextureUrl: 'https://sharkpan.xyz/f/2WzAFQ/CAFE.png',
            stickers: [],
            staffIds: [],
        },
        {
            id: 'room-1f-right',
            name: '后厨',
            floor: 0,
            position: 'right',
            isUnlocked: false,
            layoutId: 'layout-kitchen',
            stickers: [],
            staffIds: [],
        },
        {
            id: 'room-2f-left',
            name: '休息室',
            floor: 1,
            position: 'left',
            isUnlocked: false,
            layoutId: 'layout-lounge',
            stickers: [],
            staffIds: [],
        },
        {
            id: 'room-2f-right',
            name: 'VIP包间',
            floor: 1,
            position: 'right',
            isUnlocked: false,
            layoutId: 'layout-vip',
            stickers: [],
            staffIds: [],
        },
    ],
    activeRoomId: null,
};
