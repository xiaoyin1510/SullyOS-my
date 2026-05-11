
import React, { useState, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { processImage } from '../utils/file';

const UserApp: React.FC = () => {
    const { closeApp, userProfile, updateUserProfile, addToast } = useOS();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await processImage(file);
                updateUserProfile({ avatar: base64 });
                addToast('头像已更新', 'success');
            } catch (err: any) {
                addToast(err.message, 'error');
            }
        }
    };

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col animate-fade-in">
             {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 sticky top-0 z-10">
                <div className="flex items-center gap-2 w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-slate-700 tracking-wide">个人档案</h1>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Avatar */}
                <div className="flex flex-col items-center gap-4">
                    <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-32 h-32 rounded-full bg-white shadow-lg p-1 cursor-pointer group relative"
                    >
                        <img src={userProfile.avatar} className="w-full h-full rounded-full object-cover group-hover:opacity-80 transition-opacity" />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-xs font-bold text-slate-600 bg-white/80 px-2 py-1 rounded-full">更换</span>
                        </div>
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
                </div>

                {/* Info Form */}
                <div className="space-y-6">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">你的名字</label>
                        <input 
                            value={userProfile.name}
                            onChange={(e) => updateUserProfile({ name: e.target.value })}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold text-slate-700 focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">关于我 / 设定</label>
                        <p className="text-[10px] text-slate-400 mb-2">这些信息会发送给 AI，让它知道你是谁 (例如：大学生、喜欢吃辣、性格内向)。</p>
                        <textarea 
                            value={userProfile.bio}
                            onChange={(e) => updateUserProfile({ bio: e.target.value })}
                            className="w-full h-48 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 leading-relaxed resize-none focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                            placeholder="描述你自己..."
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UserApp;
