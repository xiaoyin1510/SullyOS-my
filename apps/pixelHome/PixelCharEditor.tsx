/**
 * Pixel Home — 像素小人捏人器（图层素材版）
 *
 * 选前发/后发/眼型 + 发色/眼色/肤色/衣服/裤子 → 实时预览 → 保存
 * 颜色支持预设色块 + 自定义取色器（HTML5 color input）
 * 支持在合成结果上二次手绘（customPixels）
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { PixelCharConfig } from './pixelCharGenerator';
import {
  DEFAULT_CONFIG, ensurePixelChar, ASSET_SIZE,
  HAIR_COLORS, EYE_COLORS, SKIN_TONES, OUTFIT_COLORS,
  FRONT_HAIR_COUNT, BACK_HAIR_COUNT, EYE_COUNT,
  FRONT_HAIR_NAMES, BACK_HAIR_NAMES, EYE_NAMES,
} from './pixelCharGenerator';

interface Props {
  initial?: PixelCharConfig | null;
  target?: 'char' | 'user';
  targetLabel?: string;
  onSave: (config: PixelCharConfig, imageUri: string) => void;
  onCancel: () => void;
}

const PAINT_SCALE = 6; // 画布上每个像素点放大倍数

const PixelCharEditor: React.FC<Props> = ({ initial, target = 'char', targetLabel, onSave, onCancel }) => {
  const [config, setConfig] = useState<PixelCharConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...(initial || {}),
  }));
  const [previewUri, setPreviewUri] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState('#ff4757');
  const [isEraser, setIsEraser] = useState(false);

  const uploadRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  const update = useCallback((partial: Partial<PixelCharConfig>) => {
    setConfig(prev => ({ ...prev, ...partial }));
  }, []);

  // 每次 config 变化异步重新生成预览
  useEffect(() => {
    let cancelled = false;
    setGenerating(true);
    ensurePixelChar(config).then(uri => {
      if (!cancelled) {
        setPreviewUri(uri);
        setGenerating(false);
      }
    }).catch(err => {
      console.error('[PixelCharEditor] generate failed', err);
      if (!cancelled) setGenerating(false);
    });
    return () => { cancelled = true; };
  }, [config]);

  // 画布模式下绘制底图（合成结果放大 + 棋盘格）
  useEffect(() => {
    if (!drawMode || !canvasRef.current || !previewUri) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // 棋盘背景
    for (let y = 0; y < ASSET_SIZE.h; y++) {
      for (let x = 0; x < ASSET_SIZE.w; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#2a2a3a' : '#323248';
        ctx.fillRect(x * PAINT_SCALE, y * PAINT_SCALE, PAINT_SCALE, PAINT_SCALE);
      }
    }

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // 网格
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= ASSET_SIZE.w; i++) {
        ctx.beginPath();
        ctx.moveTo(i * PAINT_SCALE + 0.5, 0);
        ctx.lineTo(i * PAINT_SCALE + 0.5, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i <= ASSET_SIZE.h; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * PAINT_SCALE + 0.5);
        ctx.lineTo(canvas.width, i * PAINT_SCALE + 0.5);
        ctx.stroke();
      }
    };
    img.src = previewUri;
  }, [drawMode, previewUri]);

  const paintAt = useCallback((e: React.PointerEvent) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor((e.clientX - rect.left) / rect.width * ASSET_SIZE.w);
    const py = Math.floor((e.clientY - rect.top) / rect.height * ASSET_SIZE.h);
    if (px < 0 || px >= ASSET_SIZE.w || py < 0 || py >= ASSET_SIZE.h) return;
    const key = `${px},${py}`;
    setConfig(prev => {
      const customPixels = { ...(prev.customPixels || {}) };
      customPixels[key] = isEraser ? 'transparent' : drawColor;
      return { ...prev, customPixels };
    });
  }, [drawColor, isEraser]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    paintAt(e);
  }, [paintAt]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (isDrawing.current) paintAt(e);
  }, [paintAt]);
  const onPointerUp = useCallback(() => { isDrawing.current = false; }, []);

  const clearCustomPixels = useCallback(() => {
    setConfig(prev => ({ ...prev, customPixels: undefined }));
  }, []);

  const handleUploadSprite = useCallback(async (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|webp|gif)/)) return;
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setConfig(prev => ({ ...prev, customSprite: dataUri }));
  }, []);

  const clearCustomSprite = useCallback(() => {
    setConfig(prev => {
      const { customSprite: _, ...rest } = prev;
      return rest as PixelCharConfig;
    });
  }, []);

  const handleSave = useCallback(() => {
    onSave(config, config.customSprite || previewUri);
  }, [config, previewUri, onSave]);

  const styleItems = useMemo(() => ({
    frontHair: Array.from({ length: FRONT_HAIR_COUNT }, (_, i) => ({ value: i + 1, label: FRONT_HAIR_NAMES[i] || `前发${i + 1}` })),
    backHair: Array.from({ length: BACK_HAIR_COUNT }, (_, i) => ({ value: i + 1, label: BACK_HAIR_NAMES[i] || `后发${i + 1}` })),
    eyes: Array.from({ length: EYE_COUNT }, (_, i) => ({ value: i + 1, label: EYE_NAMES[i] || `眼型${i + 1}` })),
  }), []);

  const canvasW = ASSET_SIZE.w * PAINT_SCALE;
  const canvasH = ASSET_SIZE.h * PAINT_SCALE;

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-3 no-scrollbar">
      {targetLabel && (
        <div className="text-center text-[11px] text-slate-400">
          正在捏 <span className={target === 'user' ? 'text-emerald-300 font-bold' : 'text-violet-300 font-bold'}>{targetLabel}</span>
        </div>
      )}

      {/* 预览 / 画布 */}
      <div className="flex flex-col items-center gap-2">
        {config.customSprite ? (
          <>
            <div className="w-28 h-28 bg-slate-800 rounded-xl border border-emerald-600/50 flex items-center justify-center p-2"
              style={{
                backgroundImage: 'linear-gradient(45deg, #1e293b 25%, transparent 25%, transparent 75%, #1e293b 75%), linear-gradient(45deg, #1e293b 25%, transparent 25%, transparent 75%, #1e293b 75%)',
                backgroundSize: '8px 8px', backgroundPosition: '0 0, 4px 4px',
              }}>
              <img src={config.customSprite} alt="uploaded" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} draggable={false} />
            </div>
            <span className="text-[10px] text-emerald-400 font-medium">已导入自定义像素小人</span>
            <div className="flex gap-2">
              <button onClick={() => uploadRef.current?.click()}
                className="text-[10px] text-slate-400 hover:text-slate-200 underline">
                重新上传
              </button>
              <button onClick={clearCustomSprite}
                className="text-[10px] text-slate-400 hover:text-red-400 underline">
                清除，恢复捏人
              </button>
            </div>
          </>
        ) : drawMode ? (
          <>
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              className="rounded-lg border border-slate-600 touch-none select-none"
              style={{ width: canvasW, maxWidth: '100%', aspectRatio: `${canvasW} / ${canvasH}`, imageRendering: 'pixelated', touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
            />
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button onClick={() => setIsEraser(false)}
                className={`px-2 py-1 rounded text-[10px] font-bold ${!isEraser ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                画笔
              </button>
              <button onClick={() => setIsEraser(true)}
                className={`px-2 py-1 rounded text-[10px] font-bold ${isEraser ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                橡皮
              </button>
              <label className="relative w-6 h-6 rounded border border-slate-500 overflow-hidden cursor-pointer"
                title="画笔颜色" style={{ background: drawColor }}>
                <input type="color" value={drawColor}
                  onChange={e => { setDrawColor(e.target.value); setIsEraser(false); }}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
              <button onClick={clearCustomPixels}
                className="px-2 py-1 rounded text-[10px] font-bold bg-slate-700 text-slate-300">
                清除手绘
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-28 h-28 bg-slate-800 rounded-xl border border-slate-700 flex items-center justify-center p-2 relative"
              style={{
                backgroundImage: 'linear-gradient(45deg, #1e293b 25%, transparent 25%, transparent 75%, #1e293b 75%), linear-gradient(45deg, #1e293b 25%, transparent 25%, transparent 75%, #1e293b 75%)',
                backgroundSize: '8px 8px', backgroundPosition: '0 0, 4px 4px',
              }}>
              {previewUri
                ? <img src={previewUri} alt="preview" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} draggable={false} />
                : <span className="text-[10px] text-slate-500">加载中…</span>}
              {generating && previewUri && (
                <span className="absolute top-1 right-1 text-[9px] text-slate-500">…</span>
              )}
            </div>
          </>
        )}

        {!config.customSprite && (
          <div className="flex items-center gap-3">
            <button onClick={() => setDrawMode(!drawMode)}
              className="text-[10px] text-slate-400 hover:text-slate-200 underline">
              {drawMode ? '返回参数调整' : '打开画布手绘'}
            </button>
            {!drawMode && (
              <button onClick={() => uploadRef.current?.click()}
                className="text-[10px] text-emerald-400 hover:text-emerald-300 underline">
                直接上传像素小人
              </button>
            )}
          </div>
        )}
        <input ref={uploadRef} type="file" accept="image/png,image/webp,image/jpeg,image/gif" className="hidden"
          onChange={e => { if (e.target.files?.[0]) { handleUploadSprite(e.target.files[0]); e.target.value = ''; } }} />
      </div>

      {/* 参数区（画布模式 / 自定义精灵下折叠） */}
      {!drawMode && !config.customSprite && (
        <>
          <Section title="前发">
            <StylePicker items={[{ value: 0, label: '无' }, ...styleItems.frontHair]}
              selected={config.frontHair} onSelect={v => update({ frontHair: v })} />
          </Section>

          <Section title="后发">
            <StylePicker items={[{ value: 0, label: '无' }, ...styleItems.backHair]}
              selected={config.backHair} onSelect={v => update({ backHair: v })} />
          </Section>

          <Section title="眼型">
            <StylePicker items={styleItems.eyes}
              selected={config.eyes} onSelect={v => update({ eyes: v })} />
          </Section>

          <Section title="发色">
            <ColorPicker colors={HAIR_COLORS} selected={config.hairColor} onSelect={c => update({ hairColor: c })} />
          </Section>

          <Section title="眼睛颜色">
            <ColorPicker colors={EYE_COLORS} selected={config.eyeColor} onSelect={c => update({ eyeColor: c })} />
          </Section>

          <Section title="肤色">
            <ColorPicker colors={SKIN_TONES} selected={config.skinTone} onSelect={c => update({ skinTone: c })} />
          </Section>

          <Section title="上衣">
            <ColorPicker colors={OUTFIT_COLORS} selected={config.outfitColor} onSelect={c => update({ outfitColor: c })} />
          </Section>

          <Section title="裤子">
            <ColorPicker colors={OUTFIT_COLORS} selected={config.outfitColor2} onSelect={c => update({ outfitColor2: c })} />
          </Section>
        </>
      )}

      <div className="flex gap-2 pt-2">
        <button onClick={onCancel}
          className="flex-1 py-2.5 bg-slate-700 text-slate-300 text-xs font-bold rounded-xl active:scale-95 transition-transform">
          取消
        </button>
        <button onClick={handleSave} disabled={!config.customSprite && !previewUri}
          className="flex-1 py-2.5 bg-amber-500 text-white text-xs font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-50">
          保存角色
        </button>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">{title}</span>
    {children}
  </div>
);

const StylePicker: React.FC<{
  items: { value: number; label: string }[];
  selected: number;
  onSelect: (v: number) => void;
}> = ({ items, selected, onSelect }) => (
  <div className="flex gap-1 flex-wrap">
    {items.map(it => (
      <button key={it.value} onClick={() => onSelect(it.value)}
        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
          selected === it.value ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-300'
        }`}>
        {it.label}
      </button>
    ))}
  </div>
);

const ColorPicker: React.FC<{
  colors: string[];
  selected: string;
  onSelect: (c: string) => void;
}> = ({ colors, selected, onSelect }) => {
  const inPalette = colors.some(c => c.toLowerCase() === selected.toLowerCase());
  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      {colors.map(c => (
        <button key={c} onClick={() => onSelect(c)}
          className={`w-6 h-6 rounded-lg border-2 transition-all active:scale-90 ${
            selected.toLowerCase() === c.toLowerCase() ? 'border-white scale-110' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
      {/* 自定义取色器 */}
      <label className={`relative w-6 h-6 rounded-lg border-2 cursor-pointer overflow-hidden ${
        !inPalette ? 'border-white scale-110' : 'border-slate-500'
      }`} title="自定义颜色">
        <span className="absolute inset-0 pointer-events-none"
          style={{
            background: inPalette
              ? 'conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
              : selected,
          }} />
        <input type="color" value={selected} onChange={e => onSelect(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer" />
      </label>
    </div>
  );
};

export default PixelCharEditor;
