import React, { useRef } from 'react';
import { BankFullState, CharacterProfile } from '../../types';
import BankAssetIcon from './BankAssetIcon';
import { processImage } from '../../utils/file';

interface Props {
    state: BankFullState;
    onOpenAddTx: () => void;
    onFeedPet: () => void;
    onRefreshVisitor: () => void;
    onUpdatePet: (updates: any) => void;
    onUpdateConfig: (updates: any) => void;
    onOpenAddGoal: () => void;
    onDeleteGoal: (id: string) => void;
    characters: CharacterProfile[];
}

const BankDashboard: React.FC<Props> = ({ 
    state, onOpenAddTx, onFeedPet, onRefreshVisitor, onUpdatePet, onUpdateConfig, 
    onOpenAddGoal, onDeleteGoal, characters 
}) => {
    const petImageInputRef = useRef<HTMLInputElement>(null);
    
    // Visitor: Resolve Character
    const visitorChar = characters.find(c => c.id === state.shop.activeVisitor?.charId);
    
    // Logic for "Pet": Use the Manager (first staff)
    const manager = state.shop.staff[0];
    const petImg = manager?.avatar || 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f425.png'; 

    const isOverBudget = state.todaySpent > state.config.dailyBudget;
    const progressPercent = Math.min(100, (state.todaySpent / state.config.dailyBudget) * 100);
    const remaining = state.config.dailyBudget - state.todaySpent;

    // Derived stats for bars
    // Hunger -> Energy (100 - Fatigue)
    const energyLevel = manager ? Math.max(0, 100 - manager.fatigue) : 100;
    // Mood -> Appeal (Scaled, e.g., max 200)
    const moodLevel = Math.min(100, (state.shop.appeal / 200) * 100);

    const handlePetImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await processImage(file);
                // Assuming updating the manager's avatar if this component were fully functional
                // onUpdatePet({ image: base64 }); 
                // Since this might be legacy, we just log or ignore, or try to map it.
            } catch (e) {}
        }
    };

    return (
        <div className="p-6 space-y-8">
            
            {/* 1. Retro Console Status Card */}
            <div className="bg-slate-100 rounded-3xl p-1 shadow-sm border-b-4 border-slate-200">
                <div className="bg-white rounded-[1.3rem] p-5 border border-slate-100 relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <div className="text-[10px] text-slate-400 font-bold mb-1 tracking-widest uppercase">BUDGET TRACKER</div>
                            <div className="flex items-baseline gap-2">
                                <span className={`text-3xl font-black font-mono tracking-tighter ${isOverBudget ? 'text-red-500' : 'text-slate-800'}`}>
                                    {state.config.currencySymbol}{state.todaySpent.toFixed(0)}
                                </span>
                                <span className="text-xs text-slate-400 font-medium">/ {state.config.dailyBudget}</span>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md text-[10px] font-bold font-mono mb-1">
                                AP: {state.shop.actionPoints}
                            </div>
                            {isOverBudget && <span className="text-[9px] text-red-400 font-bold bg-red-50 px-1 rounded">OVERLOAD</span>}
                        </div>
                    </div>

                    {/* Pixel Progress Bar */}
                    <div className="h-4 bg-slate-100 rounded-sm border border-slate-200 overflow-hidden relative">
                        {/* Stripes pattern */}
                        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(45deg, #000 25%, transparent 25%, transparent 50%, #000 50%, #000 75%, transparent 75%, transparent)', backgroundSize: '4px 4px' }}></div>
                        <div 
                            className={`h-full transition-all duration-500 border-r-2 border-black/10 ${isOverBudget ? 'bg-red-400' : 'bg-emerald-400'}`} 
                            style={{ width: `${progressPercent}%` }}
                        ></div>
                    </div>
                    
                    <div className="flex justify-between mt-2 text-[10px] font-bold text-slate-400 font-mono">
                        <span>SPENT</span>
                        <span>{remaining >= 0 ? `LEFT: ${remaining.toFixed(0)}` : `OVER: ${Math.abs(remaining).toFixed(0)}`}</span>
                    </div>
                </div>
            </div>

            {/* 2. Pet Room Scene (Pixel/Game Style) */}
            <div className="relative w-full aspect-[16/10] bg-[#e0f2fe] rounded-3xl overflow-hidden shadow-[inset_0_0_20px_rgba(0,0,0,0.05)] border-4 border-white ring-1 ring-slate-100 group">
                
                {/* Background Decor */}
                <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(#0ea5e9 1px, transparent 1px), linear-gradient(90deg, #0ea5e9 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                <div className="absolute bottom-0 w-full h-1/4 bg-[#bae6fd] border-t-2 border-[#7dd3fc]"></div>

                {/* Status HUD in Room */}
                <div className="absolute top-3 left-3 flex flex-col gap-1">
                    <div className="flex items-center gap-1 bg-white/80 backdrop-blur px-2 py-0.5 rounded-full border border-white/50 shadow-sm">
                        <img src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2728.png" alt="" className="w-3 h-3" />
                        <div className="w-10 h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-rose-400" style={{ width: `${moodLevel}%` }}></div></div>
                    </div>
                    <div className="flex items-center gap-1 bg-white/80 backdrop-blur px-2 py-0.5 rounded-full border border-white/50 shadow-sm">
                        <img src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f50b.png" alt="" className="w-3 h-3" />
                        <div className="w-10 h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-orange-400" style={{ width: `${energyLevel}%` }}></div></div>
                    </div>
                </div>

                {/* Visitor Area (Left) */}
                {visitorChar && (
                    <div className="absolute bottom-[20%] left-[15%] w-16 h-24 flex flex-col items-center animate-fade-in z-10">
                        <div className="relative group/visitor cursor-pointer active:scale-95 transition-transform">
                            {/* Visitor Sprite */}
                            <img src={visitorChar.sprites?.chibi || visitorChar.avatar} className="w-16 h-16 object-contain drop-shadow-md" />
                            {/* Dialogue Bubble */}
                            <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-white px-3 py-2 rounded-xl rounded-bl-none shadow-lg text-[10px] text-slate-700 w-28 whitespace-normal leading-tight z-20 border border-slate-100 opacity-0 group-hover/visitor:opacity-100 transition-opacity pointer-events-none">
                                {state.shop.activeVisitor?.message}
                            </div>
                        </div>
                        <div className="bg-black/10 px-1.5 rounded text-[8px] text-slate-600 mt-1 backdrop-blur-sm">{visitorChar.name}</div>
                    </div>
                )}

                {/* Pet Area (Center-Right) */}
                <div className="absolute bottom-[25%] right-[25%] flex flex-col items-center z-10">
                    <div 
                        className="relative cursor-pointer active:scale-90 transition-transform group/pet"
                        onClick={() => {
                            // Simple bounce interaction
                            const el = document.getElementById('pet-sprite');
                            if(el) {
                                el.classList.remove('animate-bounce');
                                void el.offsetWidth; // trigger reflow
                                el.classList.add('animate-bounce');
                            }
                        }}
                    >
                        <img 
                            id="pet-sprite"
                            src={petImg} 
                            className="w-20 h-20 object-contain drop-shadow-lg animate-float" 
                        />
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white px-2 py-1 rounded-lg text-[9px] font-bold text-slate-500 shadow-sm border border-slate-100 opacity-0 group-hover/pet:opacity-100 transition-opacity whitespace-nowrap">
                            Level {state.shop.shopLevel}
                        </div>
                    </div>
                </div>

                {/* Change Skin Button (Subtle) */}
                <button onClick={() => petImageInputRef.current?.click()} className="absolute top-3 right-3 p-1.5 bg-white/50 hover:bg-white rounded-lg text-slate-400 hover:text-slate-600 transition-all backdrop-blur-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM16 10a.75.75 0 0 1 .75.75h1.5a.75.75 0 0 1 0-1.5h-1.5A.75.75 0 0 1 16 10ZM5 10a.75.75 0 0 1 .75.75h1.5a.75.75 0 0 1 0-1.5h-1.5A.75.75 0 0 1 5 10ZM14.55 6.06a.75.75 0 0 1 0 1.06l-1.06 1.06a.75.75 0 0 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0ZM6.51 14.1l1.06-1.06a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06ZM14.55 13.94a.75.75 0 0 0 0-1.06l-1.06-1.06a.75.75 0 0 0-1.06 1.06l1.06 1.06a.75.75 0 0 0 1.06 0ZM6.51 5.9a.75.75 0 0 0 1.06 1.06l1.06-1.06a.75.75 0 1 0-1.06-1.06L6.51 5.9Z" /></svg>
                </button>
                <input type="file" ref={petImageInputRef} className="hidden" accept="image/*" onChange={handlePetImageUpload} />
            </div>

            {/* Action Buttons Row */}
            <div className="grid grid-cols-2 gap-3">
                <button 
                    onClick={onFeedPet}
                    className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-slate-100 shadow-sm active:scale-95 transition-transform hover:border-orange-200 group"
                >
                    <img src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f357.png" alt="feed" className="w-6 h-6 mb-1 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-slate-700">投喂</span>
                    <span className="text-[9px] text-orange-400 font-mono font-bold">-10 AP</span>
                </button>
                
                <button 
                    onClick={onRefreshVisitor}
                    className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-slate-100 shadow-sm active:scale-95 transition-transform hover:border-indigo-200 group"
                >
                    <img src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6aa.png" alt="invite" className="w-6 h-6 mb-1 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-slate-700">邀请访客</span>
                    <span className="text-[9px] text-indigo-400 font-mono font-bold">-20 AP</span>
                </button>
            </div>

            {/* 3. Goals Section */}
            <div>
                <div className="flex justify-between items-center mb-3 px-1">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
心愿单
                    </h3>
                    <button onClick={onOpenAddGoal} className="w-5 h-5 bg-white text-slate-400 rounded-md flex items-center justify-center shadow-sm text-xs hover:text-slate-600 border border-slate-200">+</button>
                </div>
                
                <div className="space-y-3">
                    {state.goals.length === 0 && (
                        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-4 text-center text-xs text-slate-400">
                            暂无心愿目标
                        </div>
                    )}
                    {state.goals.map(goal => (
                        <div key={goal.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden">
                            <div className="flex justify-between items-start mb-2 relative z-10">
                                <div className="flex items-center gap-2">
                                    <div className="w-5 h-5 flex items-center justify-center">
                                        <BankAssetIcon
                                            value={goal.icon}
                                            alt={goal.name}
                                            imgClassName="w-5 h-5 object-contain"
                                            textClassName="text-lg leading-none"
                                        />
                                    </div>
                                    <div>
                                        <div className="font-bold text-sm text-slate-700">{goal.name}</div>
                                        <div className="text-[10px] text-slate-400 font-mono">{state.config.currencySymbol}{goal.targetAmount}</div>
                                    </div>
                                </div>
                                <span className="text-xs font-bold text-slate-600">{Math.round((goal.currentAmount / goal.targetAmount) * 100)}%</span>
                            </div>
                            
                            {/* Progress Bar Background */}
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden relative z-10">
                                <div 
                                    className={`h-full rounded-full transition-all duration-500 ${goal.isCompleted ? 'bg-emerald-400' : 'bg-indigo-400'}`} 
                                    style={{ width: `${Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)}%` }}
                                ></div>
                            </div>

                            {/* Delete */}
                            <button onClick={() => onDeleteGoal(goal.id)} className="absolute top-2 right-2 p-1 text-slate-300 hover:text-red-400 z-20">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Daily Budget Config */}
            <div className="pt-4 border-t border-slate-100">
                <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="text-xs font-bold text-slate-500">每日预算设定</span>
                    <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200">
                        <span className="text-xs text-slate-400">{state.config.currencySymbol}</span>
                        <input 
                            type="number" 
                            value={state.config.dailyBudget} 
                            onChange={(e) => onUpdateConfig({ dailyBudget: parseFloat(e.target.value) })}
                            className="w-16 text-right bg-transparent border-none text-sm font-bold text-slate-700 outline-none p-0"
                        />
                    </div>
                </div>
                <p className="text-[9px] text-slate-400 mt-2 text-center">
                    昨日结余将转化为今日的行动点数 (AP)。
                </p>
            </div>

        </div>
    );
};

export default BankDashboard;
