/**
 * 图片占位 / 已上传图片
 *
 * - 空状态: 美丽的渐变拍立得 + 📷 + caption
 * - 已上传: 渲染 src(<img>),保留拍立得相框 + caption
 *
 * 现在不接 file 真正上传管线 (需要再做一轮 storage),
 * 先把容器和占位做出来,onPick 留给将来调起 file picker。
 */

import React from 'react';
import { PAPER_TONES, MONO_STACK, SCRIPT_STACK, seedFloat } from './paper';
import { Camera, Plus } from '@phosphor-icons/react';

type FrameKind = 'polaroid' | 'filmstrip' | 'frame' | 'tape';

const GRADIENT_PALETTE = [
    'linear-gradient(160deg, #FBE6D4 0%, #F4C7C0 60%, #C9D6B5 100%)',  // 黄昏
    'linear-gradient(160deg, #d6c8e8 0%, #f5eef7 60%, #fff0f5 100%)',  // 薰衣草雾
    'linear-gradient(160deg, #b9d3e0 0%, #f0faf5 60%, #fdf9eb 100%)',  // 海光
    'linear-gradient(160deg, #fbb8c8 0%, #f5e295 60%, #f5eef7 100%)',  // 蜜桃
    'linear-gradient(160deg, #88c5a8 0%, #cee2da 60%, #fff8e6 100%)',  // 草绿
    'linear-gradient(160deg, #2d3a4a 0%, #5a7a8e 60%, #d4c8a0 100%)',  // 暮色 (深)
];

interface Props {
    seed: string;
    src?: string;
    caption?: string;
    frame?: FrameKind;
    onPick?: () => void;
}

const JournalImageSlot: React.FC<Props> = ({ seed, src, caption, frame = 'polaroid', onPick }) => {
    const gradient = GRADIENT_PALETTE[Math.floor(seedFloat(seed, 1) * GRADIENT_PALETTE.length)];

    const inner = src ? (
        <div
            style={{
                width: '100%',
                aspectRatio: '4 / 3',
                backgroundImage: `url(${src})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRadius: 2,
            }}
        />
    ) : (
        <button
            onClick={onPick}
            disabled={!onPick}
            className="w-full active:scale-[0.99] transition disabled:cursor-default"
            style={{
                aspectRatio: '4 / 3',
                background: gradient,
                borderRadius: 2,
                border: 'none',
                cursor: onPick ? 'pointer' : 'default',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            {/* 白色装饰小日 / 山 */}
            <span
                style={{
                    position: 'absolute',
                    top: '24%', right: '18%',
                    width: 14, height: 14,
                    background: 'rgba(255,255,255,0.85)',
                    borderRadius: '50%',
                    boxShadow: '0 0 12px rgba(255,255,255,0.6)',
                }}
            />
            <span
                style={{
                    position: 'absolute',
                    bottom: '38%', left: '20%',
                    width: 0, height: 0,
                    borderLeft: '12px solid transparent',
                    borderRight: '12px solid transparent',
                    borderBottom: '20px solid rgba(58,42,38,0.55)',
                }}
            />
            <span
                style={{
                    position: 'absolute',
                    bottom: '38%', left: '50%',
                    width: 0, height: 0,
                    borderLeft: '8px solid transparent',
                    borderRight: '8px solid transparent',
                    borderBottom: '14px solid rgba(58,42,38,0.45)',
                }}
            />
            {/* 占位 icon + 提示 */}
            <span
                className="absolute inset-0 flex flex-col items-center justify-center"
                style={{ color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 2px rgba(0,0,0,0.18)' }}
            >
                <Camera weight="fill" size={20} style={{ marginBottom: 4 }} />
                <span
                    style={{
                        ...MONO_STACK,
                        fontSize: 9,
                        letterSpacing: '0.3em',
                    }}
                >
                    {onPick ? '+ 添 加 图 片' : 'IMAGE'}
                </span>
            </span>
        </button>
    );

    if (frame === 'tape') {
        return (
            <div className="relative">
                <div
                    style={{
                        position: 'absolute', top: -6, left: '20%',
                        width: 36, height: 12,
                        background: 'repeating-linear-gradient(135deg, #fbe6d4 0 4px, rgba(255,255,255,0.5) 4px 6px, #fbe6d4 6px 10px)',
                        clipPath: 'polygon(2% 0, 100% 5%, 99% 100%, 0 95%)',
                        transform: 'rotate(-6deg)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        zIndex: 2,
                    }}
                />
                {inner}
                {caption && (
                    <div
                        className="mt-1.5 text-center"
                        style={{
                            ...SCRIPT_STACK,
                            fontSize: 13,
                            color: PAPER_TONES.inkSoft,
                        }}
                    >
                        {caption}
                    </div>
                )}
            </div>
        );
    }

    if (frame === 'filmstrip') {
        return (
            <div
                style={{
                    background: '#1a1a1a',
                    padding: '8px 4px',
                    borderRadius: 3,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                }}
            >
                <div
                    className="flex justify-between mb-1"
                    style={{ fontSize: 6, color: '#888' }}
                >
                    {Array.from({ length: 6 }).map((_, i) => (
                        <span key={i} style={{ width: 8, height: 6, background: '#333', borderRadius: 1 }} />
                    ))}
                </div>
                <div className="px-1">{inner}</div>
                <div
                    className="flex justify-between mt-1"
                    style={{ fontSize: 6, color: '#888' }}
                >
                    {Array.from({ length: 6 }).map((_, i) => (
                        <span key={i} style={{ width: 8, height: 6, background: '#333', borderRadius: 1 }} />
                    ))}
                </div>
                {caption && (
                    <div
                        className="mt-1 text-center"
                        style={{
                            ...MONO_STACK,
                            fontSize: 8.5, letterSpacing: '0.2em',
                            color: '#aaa',
                        }}
                    >
                        {caption}
                    </div>
                )}
            </div>
        );
    }

    if (frame === 'frame') {
        return (
            <div
                style={{
                    background: '#fffaf2',
                    padding: '6px',
                    border: '6px double #d4b89a',
                    borderRadius: 4,
                }}
            >
                {inner}
                {caption && (
                    <div
                        className="mt-2 text-center"
                        style={{
                            ...SCRIPT_STACK,
                            fontSize: 13,
                            color: PAPER_TONES.inkSoft,
                        }}
                    >
                        {caption}
                    </div>
                )}
            </div>
        );
    }

    // polaroid (默认)
    return (
        <div
            style={{
                background: '#fff',
                padding: '8px 8px 18px 8px',
                borderRadius: 3,
                boxShadow: '0 2px 4px rgba(122,90,114,0.12), 0 8px 18px -8px rgba(122,90,114,0.22)',
            }}
        >
            {inner}
            {caption && (
                <div
                    className="mt-2 px-1 truncate"
                    style={{
                        ...SCRIPT_STACK,
                        fontSize: 13,
                        color: PAPER_TONES.inkSoft,
                        textAlign: 'center',
                    }}
                >
                    {caption}
                </div>
            )}
            {!src && !caption && onPick && (
                <div
                    className="mt-1 px-1 flex items-center justify-center gap-1"
                    style={{ ...MONO_STACK, fontSize: 9, letterSpacing: '0.2em', color: PAPER_TONES.inkFaint }}
                >
                    <Plus weight="bold" size={10} /> CAPTION
                </div>
            )}
        </div>
    );
};

export default JournalImageSlot;
