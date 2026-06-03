/**
 * Memory Dive — 对话框（纯粹的像素框 + 分页 + 打字机）
 *
 * 本组件只负责一个像素边框的小对话框。外层容器（位置、宽高、
 * 背景、加载态浮层）由父组件负责——现在对话框悬浮在上屏房间
 * 的下沿，而下屏是独立的氛围面板。
 *
 * 选项出现 / 加载中 / 无内容时，父组件不渲染本组件。
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import type { DiveDialogue } from './memoryDiveTypes';

interface Props {
  current: DiveDialogue | null;
  /** 本句后还有多少条在排队（仅影响 ▼/◆ 提示） */
  queueRemaining: number;
  /** 这条说完后是否会立刻出选项（影响 ▼/◆ 提示） */
  choicesPending: boolean;
  charName: string;
  charAvatar?: string;
  disabled: boolean;
  onAdvance: () => void;
}

const TYPE_SPEED_MS = 22;
// 每页允许的最多视觉行数（超过就硬切）——保守估计 3 行
const PAGE_MAX_LINES = 3;
// 窄屏中文每行大约能容的字数（头像右侧 ~260px / 13px ≈ 20 字）
const CHARS_PER_LINE = 20;
// 每页字符硬上限。作为 line-based 限制之外的保险丝，防止单页过长；
// 取 CHARS_PER_LINE * PAGE_MAX_LINES，也就是 3 行能装满的理论极限。
const PAGE_CHAR_LIMIT = CHARS_PER_LINE * PAGE_MAX_LINES;

/** 估计一段文本渲染成几行（考虑显式 \n） */
function estimateLines(s: string): number {
  if (!s) return 0;
  const segs = s.split('\n');
  let n = 0;
  for (const seg of segs) {
    n += Math.max(1, Math.ceil(seg.length / CHARS_PER_LINE));
  }
  return n;
}

/**
 * 按"段落 → 限定字数 & 限定行数"两步切页：
 *   1. 先按 \n\n 切成段落（绝对页边界）
 *   2. 段落内按字数上限 + 估算行数两路限制切
 */
function paginate(text: string, charLimit: number): string[] {
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const pages: string[] = [];
  for (const para of paragraphs) {
    pages.push(...paginateParagraph(para, charLimit));
  }
  return pages;
}

function paginateParagraph(text: string, limit: number): string[] {
  if (!text) return [];
  // 只要能在 PAGE_MAX_LINES 行内塞下，就保持单页——字符数不再是独立门槛，
  // 避免 40 字左右的句子被多余地劈成两页
  if (estimateLines(text) <= PAGE_MAX_LINES && text.length <= limit) return [text];

  // 单字符断句点（中英文标点 + 换行 + 单个 em dash）；'——' 连字会在循环里特殊处理
  const breakChars = new Set(['。', '！', '？', '；', '\n', '，', '、', ',', '.', '!', '?', '—', '-']);
  const pages: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + limit, text.length);
    // 在合理窗口里找最近的标点/换行断开
    if (end < text.length) {
      let found = -1;
      const minEnd = i + Math.floor(limit * 0.55);
      for (let j = end; j >= minEnd; j--) {
        if (breakChars.has(text[j]) || text[j] === '\n') { found = j + 1; break; }
      }
      if (found > 0) end = found;
    }
    let piece = text.slice(i, end).replace(/^\s+/, '');
    // 若估算行数超限，继续缩短
    while (estimateLines(piece) > PAGE_MAX_LINES && piece.length > 1) {
      piece = piece.slice(0, piece.length - 1);
      end = i + piece.length + (text.slice(i, end).length - piece.length);
    }
    // 重新定位 end（以保留字符数为准）
    end = i + piece.length;
    if (piece) pages.push(piece);
    i = end;
    // 吃掉紧跟的空白，防止下一页开头是空格/换行
    while (i < text.length && /\s/.test(text[i])) i++;
  }
  return pages;
}

const MemoryDiveDialogue: React.FC<Props> = ({
  current, queueRemaining, choicesPending, charName, charAvatar,
  disabled, onAdvance,
}) => {
  const pages = useMemo(
    () => (current ? paginate(current.text, PAGE_CHAR_LIMIT) : []),
    [current?.id, current?.text],
  );
  const [pageIdx, setPageIdx] = useState(0);
  useEffect(() => { setPageIdx(0); }, [current?.id]);
  const currentPage = pages[pageIdx] || '';
  const isLastPage = pageIdx >= pages.length - 1;

  const [typed, setTyped] = useState(0);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    setTyped(0);
    if (!currentPage) return;
    let i = 0;
    timerRef.current = window.setInterval(() => {
      i++;
      setTyped(i);
      if (i >= currentPage.length && timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, TYPE_SPEED_MS);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [currentPage]);
  const isPageComplete = typed >= currentPage.length;

  const handleTap = () => {
    if (disabled) return;
    if (!current) return;
    if (!isPageComplete) { setTyped(currentPage.length); return; }
    if (!isLastPage) { setPageIdx(i => i + 1); return; }
    onAdvance();
  };

  const isEmojiAvatar = !!charAvatar && !charAvatar.startsWith('http') && !charAvatar.startsWith('data:') && !charAvatar.startsWith('/');
  const isImageAvatar = !!charAvatar && !isEmojiAvatar;

  const advanceGlyph =
    !isLastPage ? '▼' :
    queueRemaining > 0 ? '▼' :
    choicesPending ? '◆' : '◆';

  return (
    <div
      className="relative bg-slate-900/95 rounded-sm"
      style={{
        height: 108,
        boxShadow:
          'inset 0 0 0 2px #1e293b, inset 0 0 0 4px #475569, 0 0 0 1px #0f172a, 0 4px 18px rgba(0,0,0,0.55)',
      }}
    >
      {/* 只保留右上/左上两个装饰像素，底部让位给右下的推进指示器
          （之前 bl/br 两颗会和 ▼/◆ 混淆） */}
      <CornerPx pos="tl" /><CornerPx pos="tr" />

      {/* 头像 + 说话人名字（作为整体竖直居中） */}
      <div className="absolute left-1.5 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 w-16">
        <div className="w-16 h-16">
          {current?.speaker === 'character' && (
            <AvatarFace src={charAvatar} isEmoji={isEmojiAvatar} isImage={isImageAvatar}
              glyph="·" toneClass="border-violet-500/60 bg-violet-900/30" />
          )}
          {current?.speaker === 'narrator' && (
            <AvatarFace src={undefined} isEmoji={false} isImage={false}
              glyph="📖" toneClass="border-slate-600/60 bg-slate-800/60" />
          )}
        </div>
        {current?.speaker === 'character' && (
          <div className="max-w-full px-1.5 py-0.5 rounded-sm bg-slate-800/90 border border-violet-500/50 text-[10px] leading-none font-bold text-violet-200 truncate">
            {charName}
          </div>
        )}
        {current?.speaker === 'narrator' && (
          <div className="max-w-full px-1.5 py-0.5 rounded-sm bg-slate-800/90 border border-slate-600/60 text-[9px] leading-none uppercase tracking-[0.2em] text-slate-400 truncate">
            旁白
          </div>
        )}
      </div>

      {/* 文本区 —— 名字已上移到头像下方的小框里，这里只放台词 */}
      <button
        type="button"
        onClick={handleTap}
        disabled={disabled || !current}
        className="absolute left-[76px] right-2 top-3 bottom-6 text-left flex flex-col min-w-0"
      >
        <div className="flex-1 min-h-0 overflow-hidden text-[12.5px] leading-[1.5] text-slate-100 whitespace-pre-wrap">
          {current && (
            <>
              {currentPage.slice(0, typed)}
              {!isPageComplete && (
                <span className="ml-0.5 inline-block w-1.5 h-3 align-middle bg-slate-400 animate-pulse" />
              )}
            </>
          )}
        </div>
      </button>

      {/* 右下角：页码 + 推进箭头（绝对定位，保证永远贴在框右下） */}
      <div className="absolute right-2 bottom-1 flex items-center gap-1.5 pointer-events-none">
        {current && pages.length > 1 && (
          <span className="text-[9px] text-slate-600">{pageIdx + 1}/{pages.length}</span>
        )}
        {current && isPageComplete && (
          <span className="text-[11px] text-amber-300/90 animate-bounce"
            style={{ animationDuration: '1.2s' }}>
            {advanceGlyph}
          </span>
        )}
      </div>
    </div>
  );
};

const AvatarFace: React.FC<{
  src?: string;
  isEmoji: boolean;
  isImage: boolean;
  glyph: string;
  toneClass: string;
}> = ({ src, isEmoji, isImage, glyph, toneClass }) => (
  <div
    className={`w-full h-full rounded-sm border-2 overflow-hidden flex items-center justify-center ${toneClass}`}
    style={{ imageRendering: 'pixelated' as any }}
  >
    {isImage && (
      <img src={src} className="w-full h-full object-cover"
        style={{ imageRendering: 'pixelated' as any }} draggable={false} alt="" />
    )}
    {isEmoji && <span className="text-3xl">{src}</span>}
    {!isImage && !isEmoji && (
      <span className="text-2xl opacity-70">{glyph}</span>
    )}
  </div>
);

const CornerPx: React.FC<{ pos: 'tl' | 'tr' | 'bl' | 'br' }> = ({ pos }) => {
  const p: Record<string, string> = {
    tl: 'top-0 left-0', tr: 'top-0 right-0',
    bl: 'bottom-0 left-0', br: 'bottom-0 right-0',
  };
  return <div className={`absolute ${p[pos]} w-1.5 h-1.5 bg-amber-400/70 pointer-events-none`} />;
};

export default MemoryDiveDialogue;
