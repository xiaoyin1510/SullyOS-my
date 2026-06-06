/**
 * UpdateNotificationEvent.tsx
 * 版本更新强制提醒弹窗 (2026.5.25 小更新)
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
export const UPDATE_NOTIFICATION_KEY_2026_05_10 = 'sullyos_update_2026_05_10_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05_17 = 'sullyos_update_2026_05_17_seen';
// 历史 key —— 5.25 情绪 buff 也接入 Instant Push
export const UPDATE_NOTIFICATION_KEY_2026_05_25 = 'sullyos_update_2026_05_25_seen';
// 本次更新 key —— 6.5 「彼方」上线
export const UPDATE_NOTIFICATION_KEY_2026_06_05 = 'sullyos_update_2026_06_05_seen';

export const FAQ_TARGET_SECTION_KEY = 'sullyos_faq_target_section';
export const CHANGELOG_2026_04 = 'changelog-2026-04';
export const CHANGELOG_2026_05 = 'changelog-2026-05';
export const CHANGELOG_2026_05_10 = 'changelog-2026-05-10';
export const CHANGELOG_2026_05_17 = 'changelog-2026-05-17';
export const CHANGELOG_2026_05_27 = 'changelog-2026-05-27';
export const CHANGELOG_2026_06_05 = 'changelog-2026-06-05';

export const shouldShowUpdateNotification = (): boolean => {
    try {
        return !localStorage.getItem(UPDATE_NOTIFICATION_KEY_2026_06_05);
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
            localStorage.setItem(UPDATE_NOTIFICATION_KEY_2026_06_05, Date.now().toString());
            sessionStorage.setItem(FAQ_TARGET_SECTION_KEY, CHANGELOG_2026_06_05);
        } catch { /* ignore */ }
        openApp(AppID.FAQ);
        onClose();
    };

    const handleDismiss = () => {
        try { localStorage.setItem(UPDATE_NOTIFICATION_KEY_2026_06_05, Date.now().toString()); } catch { /* ignore */ }
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
                <div className="pt-7 pb-3 px-6 text-center">
                    <img
                        src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f514.png"
                        alt="update"
                        className="w-10 h-10 mx-auto mb-2"
                    />
                    <h2 className="text-lg font-extrabold text-slate-800">新功能上线 · 彼方</h2>
                    <p className="text-[11px] text-slate-400 mt-1">2026 年 6 月 5 日 · 角色独自度过的时间</p>
                </div>

                <div className="px-6 pb-4 space-y-3">
                    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-4">
                        <p className="text-[13px] text-slate-700 leading-relaxed">
                            一句话：<strong className="text-indigo-600">「彼方」</strong>是一方你的角色们<strong className="text-purple-600">自己会去逛</strong>的小世界。开启后 ta 们独自登入，在<strong>图书馆 / 听歌房 / 留言簿 / 娱乐室 / 邮局</strong>里读书、听歌、发帖、写信、瞎玩，举动会变成「动态」并同步进 ta 各自的聊天和记忆。
                        </p>
                        <p className="text-[12px] text-slate-500 leading-relaxed mt-2">
                            重头戏是<strong className="text-indigo-600">邮局 · 漂流信</strong>：角色给跨用户的陌生人写信、收信、回信，像扔漂流瓶交笔友（笔名自动匿名）。
                        </p>
                        <p className="text-[12px] text-slate-500 leading-relaxed mt-2">
                            打开 <strong>「彼方」App → 接入</strong>，给角色捏个小人、打开开关就能玩。完整玩法见下方更新说明。
                        </p>
                    </div>
                    <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3">
                        <p className="text-[12px] font-bold text-indigo-600 text-center">
                            点下方按钮看完整玩法说明
                        </p>
                    </div>
                </div>

                <div className="px-6 pb-7 pt-2 space-y-2">
                    <button
                        onClick={handleView}
                        className="w-full py-3.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 active:scale-95 transition-transform text-sm"
                    >
                        看看「彼方」怎么玩
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="w-full py-2 text-slate-400 font-medium text-xs active:scale-95 transition-transform"
                    >
                        以后再说
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
