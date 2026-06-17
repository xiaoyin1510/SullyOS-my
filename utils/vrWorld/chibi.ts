/**
 * 彼方 chibi 立绘解析（单一来源）：vrState.chibi → date 皮肤/sprites → 头像兜底。
 * VRWorldApp 的房间站位、剧院的演出回放共用这套逻辑。
 */
import type { CharacterProfile } from '../../types';

export interface ChibiDisplay {
    img: string;
    scale: number;
    offsetY: number;
    flip: boolean;
    /** 是否走了兜底（没专属 chibi） */
    isFallback: boolean;
}

export const getChibi = (char: CharacterProfile): ChibiDisplay => {
    const c = char.vrState?.chibi;
    if (c?.img) return { img: c.img, scale: c.scale ?? 1, offsetY: c.offsetY ?? 0, flip: !!c.flip, isFallback: false };
    const sprites = (char.activeSkinSetId && char.dateSkinSets?.find(s => s.id === char.activeSkinSetId)?.sprites)
        || char.sprites || {};
    const fb = sprites['happy'] || sprites['normal'] || sprites['smile'] || char.avatar || '';
    return { img: fb, scale: 1, offsetY: 0, flip: false, isFallback: true };
};
