/**
 * Memory Dive — 选项浮层
 *
 * 不画在对话框里。当选项出现时，以浮层形式从下屏区域上浮，
 * 覆盖在像素房间的下半部分，像 GBA/3DS 里从地面弹出的选项牌。
 */

import React from 'react';
import type { DiveChoice } from './memoryDiveTypes';

interface Props {
  choices: DiveChoice[] | null;
  visible: boolean;
  disabled: boolean;
  onPick: (c: DiveChoice) => void;
}

const MemoryDiveChoices: React.FC<Props> = ({ choices, visible, disabled, onPick }) => {
  if (!visible || !choices || choices.length === 0) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">
      {/* 底部渐变压暗，让选项跳出来 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />

      <div className="relative p-3 pointer-events-auto">
        <div className="text-[10px] text-amber-300/90 uppercase tracking-widest mb-1.5 pl-1 text-center"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          你的回应
        </div>
        <div className="space-y-1.5 max-w-md mx-auto">
          {choices.map((choice, i) => (
            <button key={choice.id}
              onClick={() => onPick(choice)}
              disabled={disabled}
              className="block w-full text-left px-3 py-2.5 rounded-sm bg-slate-900/90 hover:bg-emerald-800/70 border-2 border-slate-700 hover:border-emerald-400/80 text-[12.5px] text-slate-100 hover:text-white transition-colors active:scale-[0.98] disabled:opacity-50"
              style={{
                boxShadow: '0 2px 0 #0f172a, inset 0 0 0 1px rgba(255,255,255,0.04)',
                animation: `diveChoiceIn 260ms ease-out ${i * 70}ms both`,
              }}
            >
              <span className="text-amber-400 mr-2">▸</span>
              {choice.text}
              {choice.action && (
                <span className="ml-2 text-[9px] text-slate-500">
                  ({labelForAction(choice.action)})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes diveChoiceIn {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

function labelForAction(a: DiveChoice['action']): string {
  switch (a) {
    case 'comfort': return '安慰';
    case 'question': return '追问';
    case 'observe': return '观察';
    case 'leave': return '离开';
    case 'unlock': return '解锁';
    default: return '';
  }
}

export default MemoryDiveChoices;
