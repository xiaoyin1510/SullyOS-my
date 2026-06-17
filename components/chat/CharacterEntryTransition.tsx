import React, { useEffect, useMemo, useRef, useState } from 'react';

// 角色切换「登场」过场 —— 不是换页/换 tab，而是「离开一个人，走进另一个人的空间」。
// 设计：以「即将见到的这个人」的头像虚化铺底（ta 的色彩世界），中心头像带柔光浮现 + 名字升起 → 推进穿过进入聊天。
//
// 性能要点（修「数据多时卡顿 + 头像没看清就进聊天」）：
//   · 全程只动 transform / opacity —— 这两类走合成器线程，主线程再忙（进聊天要挂载大量带图消息）也不掉帧；
//     绝不动画化 filter:blur（每帧重栅格化，是之前卡顿的真凶）。虚化底图的 blur 是静态的，只栅格化一次。
//   · 时间轴：头像先快速「对焦清晰」（缩放+淡入，非模糊），清晰后明确停留一拍让人看清脸与名字，再退场。
// 可轻触跳过；尊重 prefers-reduced-motion；内联 @keyframes（CDN Tailwind 不可靠生成自定义 animate-*）。

interface Props {
  name: string;
  avatar?: string;
  /** 过场播完（或被跳过）后回调，由父组件卸载本层。 */
  onDone: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CharacterEntryTransition: React.FC<Props> = ({ name, avatar, onDone }) => {
  const reduced = useMemo(prefersReducedMotion, []);
  // 头像约 650ms 对焦清晰、名字约 780ms 到位 → 停留到 REVEAL_AT 让人看清，再退场。
  const REVEAL_AT = reduced ? 220 : 1000; // 开始退场的时刻（清晰后的停留终点）
  const EXIT = reduced ? 200 : 440;       // 退场（推进穿过 + 淡出）时长
  const TOTAL = REVEAL_AT + EXIT;

  const [exiting, setExiting] = useState(false);
  const doneRef = useRef(false);
  const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone(); } };

  useEffect(() => {
    const tExit = setTimeout(() => setExiting(true), REVEAL_AT);
    const tDone = setTimeout(finish, TOTAL);
    return () => { clearTimeout(tExit); clearTimeout(tDone); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 轻触跳过：立刻进入退场（仍是平滑推进，不是硬切）
  const skip = () => { if (!exiting) { setExiting(true); window.setTimeout(finish, EXIT); } };

  const avatarBg = avatar ? `url(${avatar})` : '';

  return (
    <div
      onClick={skip}
      aria-hidden
      className="absolute inset-0 z-[140] overflow-hidden flex items-center justify-center cursor-pointer"
      style={{ opacity: exiting ? 0 : 1, transition: `opacity ${EXIT}ms ease-in`, willChange: 'opacity' }}
    >
      <style>{`
        @keyframes charVeilIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes charAvatarIn { 0% { opacity:0; transform: translateY(12px) scale(.84) } 100% { opacity:1; transform: translateY(0) scale(1) } }
        @keyframes charGlowIn { 0% { opacity:0; transform: translate(-50%,-50%) scale(.6) } 45% { opacity:.85 } 100% { opacity:.6; transform: translate(-50%,-50%) scale(1) } }
        @keyframes charNameIn { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform: translateY(0) } }
        @keyframes charLineIn { from { opacity:0; transform: scaleX(0) } to { opacity:.7; transform: scaleX(1) } }
      `}</style>

      {/* 氛围底：虚化头像 = ta 的色彩世界（静态 blur，只栅格化一次）。
          关键：不做淡入 —— showEntry 一为真就「立刻」铺满盖住聊天，否则透明期会透出底下聊天界面，
          变成「聊天先闪一下，过场才淡进来」的本末倒置。无头像时回退主题色光场。 */}
      {avatarBg ? (
        <div className="absolute inset-0 bg-cover bg-center" style={{
          background: avatarBg, backgroundSize: 'cover', backgroundPosition: 'center',
          filter: 'blur(26px)', transform: 'scale(1.16)',
        }} />
      ) : (
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(120% 100% at 50% 40%, hsla(var(--primary-hue),55%,40%,0.9), #0c0b1e 70%)',
        }} />
      )}
      {/* 压暗 + 暗角：让中心头像与名字清晰浮出（静态） */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(115% 95% at 50% 42%, rgba(8,8,18,0.35) 30%, rgba(6,6,16,0.78) 100%)' }} />

      {/* 中心内容：退场时只对这层（无 filter，缩放廉价）做推进穿过；虚化底图随根层淡出即可。 */}
      <div
        className="relative flex flex-col items-center px-8"
        style={{
          transform: exiting ? 'scale(1.14)' : 'scale(1)',
          transition: `transform ${EXIT}ms cubic-bezier(0.4,0,0.2,1)`,
          willChange: 'transform',
        }}
      >
        <div className="relative" style={{ width: 132, height: 132 }}>
          {/* 柔光晕（在头像后绽放） */}
          <div className="absolute" style={{
            left: '50%', top: '50%', width: 230, height: 230, transform: 'translate(-50%,-50%)',
            borderRadius: '9999px', filter: 'blur(8px)',
            background: 'radial-gradient(circle, rgba(255,255,255,0.5) 0%, hsla(var(--primary-hue),80%,80%,0.32) 40%, transparent 66%)',
            animation: reduced ? 'charVeilIn 240ms ease-out both' : 'charGlowIn 680ms cubic-bezier(0.22,1,0.36,1) 40ms both',
          }} />
          {/* 头像：缩放 + 淡入「对焦」，不用 filter:blur（避免每帧重栅格化卡顿） */}
          <div
            className="absolute inset-0 rounded-full bg-cover bg-center"
            style={{
              backgroundImage: avatarBg || undefined,
              backgroundColor: avatarBg ? undefined : 'hsla(var(--primary-hue),50%,55%,0.6)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 0 0 1.5px rgba(255,255,255,0.5), 0 0 28px hsla(var(--primary-hue),80%,80%,0.45)',
              animation: reduced ? 'charVeilIn 280ms ease-out both' : 'charAvatarIn 560ms cubic-bezier(0.22,1,0.36,1) 90ms both',
              willChange: 'transform, opacity',
            }}
          />
        </div>
        <div
          className="mt-5 text-white text-2xl font-medium tracking-wide"
          style={{
            textShadow: '0 2px 18px rgba(0,0,0,0.5), 0 0 24px hsla(var(--primary-hue),80%,80%,0.3)',
            animation: reduced ? 'charNameIn 300ms ease-out both' : 'charNameIn 480ms cubic-bezier(0.22,1,0.36,1) 320ms both',
          }}
        >
          {name}
        </div>
        <div className="mt-3 h-px w-20" style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)',
          transformOrigin: 'center',
          animation: reduced ? 'charVeilIn 300ms ease-out both' : 'charLineIn 540ms ease-out 420ms both',
        }} />
      </div>
    </div>
  );
};

export default CharacterEntryTransition;
