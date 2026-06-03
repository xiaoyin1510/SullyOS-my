/**
 * 方形「正在播放」组件 — 用于桌面第二页的风车布局
 * — 全局 Music Context 驱动，点击跳到 Music App。
 * — 填满父容器（由父的 aspect-square 约束成方形）。
 */
import React from 'react';
import { Play, Pause, SkipBack, SkipForward } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { useMusic } from '../../context/MusicContext';
import { AppID } from '../../types';

const formatTime = (sec: number) => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const NowPlayingSquareWidget: React.FC<{ contentColor: string }> = ({ contentColor }) => {
  const { openApp } = useOS();
  const { current, playing, progress, duration, togglePlay, nextSong, prevSong } = useMusic();

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const hasSong = !!current;

  const albumPic = current?.albumPic;
  const title = current?.name || '抽一张来听';
  const artists = current?.artists || '— 轻触，进入';
  const statusText = !hasSong ? 'Standby' : (playing ? 'Now Playing' : 'Paused');
  const dotColor = !hasSong ? '#fbbf24' : (playing ? '#4ade80' : '#fbbf24');

  const stopProp = (e: React.MouseEvent) => { e.stopPropagation(); };
  const handlePlay = (e: React.MouseEvent) => { e.stopPropagation(); if (hasSong) togglePlay(); else openApp(AppID.Music); };
  const handleNext = (e: React.MouseEvent) => { e.stopPropagation(); if (hasSong) nextSong(); };
  const handlePrev = (e: React.MouseEvent) => { e.stopPropagation(); if (hasSong) prevSong(); };

  return (
    <div
      onClick={() => openApp(AppID.Music)}
      className="relative w-full h-full rounded-[1.75rem] overflow-hidden cursor-pointer animate-fade-in group transition-transform active:scale-[0.98] flex flex-col justify-between"
      style={{
        background: 'rgba(20,18,24,0.82)',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.07)',
        padding: '12px',
        color: contentColor,
      }}
    >
      {/* 背景封面（不再实时 blur — 改用低透明度覆盖） */}
      {albumPic ? (
        <div className="absolute inset-0 opacity-35 pointer-events-none"
          style={{
            backgroundImage: `url(${albumPic})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            transform: 'scale(1.1)',
          }}
        />
      ) : (
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(120% 100% at 95% 100%, rgba(192,132,252,0.22), transparent 55%),' +
              'radial-gradient(100% 80% at 0% 0%, rgba(96,165,250,0.14), transparent 60%)',
          }}
        />
      )}

      {/* 顶部：封面 + 文字 */}
      <div className="relative flex items-center gap-2 z-10 min-w-0">
        <div
          className="w-9 h-9 shrink-0 rounded-lg overflow-hidden relative"
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          {albumPic ? (
            <img src={albumPic} alt="" className="w-full h-full object-cover"
              style={{ animation: playing ? 'spin 14s linear infinite' : 'none' }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-[10px] font-bold opacity-50" style={{ letterSpacing: '0.15em' }}>♪</span>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="w-1 h-1 rounded-full shrink-0"
              style={{
                background: dotColor,
                boxShadow: playing ? `0 0 6px ${dotColor}` : 'none',
                animation: playing ? 'pulse 2s ease-in-out infinite' : 'none',
              }} />
            <span className="text-[7.5px] uppercase font-bold opacity-55" style={{ letterSpacing: '0.22em' }}>
              {statusText}
            </span>
          </div>
          <div className="text-[11.5px] font-semibold truncate leading-tight">{title}</div>
          <div className="text-[9px] opacity-55 truncate leading-tight mt-[1px]">{artists}</div>
        </div>
      </div>

      {/* 中间：均衡器条 */}
      <div className="relative flex-1 flex items-center justify-center gap-[3px] z-10 opacity-40 py-1">
        {[5, 9, 4, 7, 5, 8, 4].map((h, i) => (
          <div
            key={i}
            className="w-[2px] rounded-full"
            style={{
              height: `${h * 1.2}px`,
              background: 'currentColor',
              animation: playing ? `pulse ${1.2 + (i * 0.1)}s ease-in-out infinite` : 'none',
              animationDelay: `${i * 70}ms`,
            }}
          />
        ))}
      </div>

      {/* 底部：进度 + 控件 */}
      <div className="relative z-10 flex flex-col gap-1.5">
        {/* 进度条 */}
        <div className="flex flex-col gap-0.5">
          <div className="h-[3px] w-full rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <div className="h-full rounded-full transition-[width] duration-150"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, #60a5fa, #c084fc)',
                boxShadow: '0 0 6px rgba(192,132,252,0.55)',
              }} />
          </div>
          <div className="flex justify-between text-[7.5px] uppercase font-medium opacity-50" style={{ letterSpacing: '0.15em' }}>
            <span>{formatTime(progress)}</span>
            <span>{hasSong ? `-${formatTime(Math.max(0, duration - progress))}` : '--:--'}</span>
          </div>
        </div>

        {/* 播放控件 */}
        <div className="flex justify-center items-center gap-3">
          <button
            aria-label="Previous"
            onClick={handlePrev}
            onMouseDown={stopProp}
            className="w-6 h-6 flex items-center justify-center opacity-70 hover:opacity-100 active:scale-90 transition disabled:opacity-30"
            disabled={!hasSong}
          >
            <SkipBack size={14} weight="fill" />
          </button>
          <button
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={handlePlay}
            onMouseDown={stopProp}
            className="w-9 h-9 flex items-center justify-center rounded-full active:scale-95 transition"
            style={{
              background: contentColor,
              color: 'rgba(20,18,24,0.95)',
              boxShadow: '0 3px 10px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
          >
            {playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
          </button>
          <button
            aria-label="Next"
            onClick={handleNext}
            onMouseDown={stopProp}
            className="w-6 h-6 flex items-center justify-center opacity-70 hover:opacity-100 active:scale-90 transition disabled:opacity-30"
            disabled={!hasSong}
          >
            <SkipForward size={14} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default NowPlayingSquareWidget;
