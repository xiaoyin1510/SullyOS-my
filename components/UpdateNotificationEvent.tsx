/**
 * UpdateNotificationEvent.tsx
 * 版本更新强制提醒弹窗 (2026.5.10 小更新)
 *
 * 所有尚未确认过本次弹窗的用户，打开后都会被强制接到一次，
 * 点击"查看更新"后会跳转到使用帮助 App 的对应更新日志页。
 */

import React from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';

// 历史 key —— 保留, 让老用户的"已看过"状态延续到本月新弹窗判断里
export const UPDATE_NOTIFICATION_KEY = 'sullyos_update_2026_04_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05 = 'sullyos_update_2026_05_seen';
// 本次小更新 key —— 5.10「心象」上线
export const UPDATE_NOTIFICATION_KEY_2026_05_10 = 'sullyos_update_2026_05_10_seen';

export const FAQ_TARGET_SECTION_KEY = 'sullyos_faq_target_section';
export const CHANGELOG_2026_04 = 'changelog-2026-04';
export const CHANGELOG_2026_05 = 'changelog-2026-05';
export const CHANGELOG_2026_05_10 = 'changelog-2026-05-10';

export const shouldShowUpdateNotification = (): boolean => {
    try {
        return !localStorage.getItem(UPDATE_NOTIFICATION_KEY_2026_05_10);
    } catch {
        return false;
    }
};

interface UpdateNotificationPopupProps {
    onClose: () => void;
}

export const UpdateNotificationPopup: React.FC<UpdateNotificationPopupProps> = ({ onClose }) => {
    const { openApp } = useOS();

    const handleView = () => {
        try {
            localStorage.setItem(UPDATE_NOTIFICATION_KEY_2026_05_10, Date.now().toString());
            sessionStorage.setItem(FAQ_TARGET_SECTION_KEY, CHANGELOG_2026_05_10);
        } catch { /* ignore */ }
        openApp(AppID.FAQ);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
                <div className="pt-7 pb-3 px-6 text-center">
                    <img
                        src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4ad.png"
                        alt="update"
                        className="w-10 h-10 mx-auto mb-2"
                    />
                    <h2 className="text-lg font-extrabold text-slate-800">小更新提醒</h2>
                    <p className="text-[11px] text-slate-400 mt-1">2026 年 5 月 10 日 · 「心象」上线</p>
                </div>

                <div className="px-6 pb-4 space-y-3">
                    <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100 rounded-2xl p-4">
                        <p className="text-[13px] text-slate-700 leading-relaxed">
                            新增<strong className="text-purple-700">「心象」</strong>——把 AI 模型自己的思考链以二次元卡牌的样子展示在角色每条回复的顶部。提供<strong className="text-indigo-600">4 种卡片风格</strong>、<strong className="text-fuchsia-600">自定义配色</strong>与<strong className="text-violet-600">追加提示词</strong>。
                        </p>
                        <p className="text-[12px] text-slate-500 leading-relaxed mt-2">
                            开启位置：<strong>聊天界面 → 加号 → 第二页 →「展示思考」</strong>。是给"喜欢看大模型思维链"的用户准备的彩蛋，不一定适合每个人，跳戏直接关掉就好。
                        </p>
                        <p className="text-[12px] text-slate-500 leading-relaxed mt-2">
                            另外修了「约会（见面模式）」<strong>上下文构建</strong>导致 token 暴涨的问题，<strong>API 失败后按发送键即可重试</strong>。
                        </p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-3">
                        <p className="text-[12px] font-bold text-purple-700 text-center">
                            点击下方按钮查看本次更新说明
                        </p>
                    </div>
                </div>

                <div className="px-6 pb-7 pt-2">
                    <button
                        onClick={handleView}
                        className="w-full py-3.5 bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-purple-200 active:scale-95 transition-transform text-sm"
                    >
                        查看 5 月 10 日小更新
                    </button>
                </div>
            </div>
        </div>
    );
};

interface UpdateNotificationControllerProps {
    onClose: () => void;
}

export const UpdateNotificationController: React.FC<UpdateNotificationControllerProps> = ({ onClose }) => {
    return <UpdateNotificationPopup onClose={onClose} />;
};
