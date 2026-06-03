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
// 本次小更新 key —— 5.25 情绪 buff 也接入 Instant Push
export const UPDATE_NOTIFICATION_KEY_2026_05_25 = 'sullyos_update_2026_05_25_seen';

export const FAQ_TARGET_SECTION_KEY = 'sullyos_faq_target_section';
export const CHANGELOG_2026_04 = 'changelog-2026-04';
export const CHANGELOG_2026_05 = 'changelog-2026-05';
export const CHANGELOG_2026_05_10 = 'changelog-2026-05-10';
export const CHANGELOG_2026_05_17 = 'changelog-2026-05-17';
export const CHANGELOG_2026_05_27 = 'changelog-2026-05-27';

export const shouldShowUpdateNotification = (): boolean => {
    try {
        return !localStorage.getItem(UPDATE_NOTIFICATION_KEY_2026_05_25);
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
            localStorage.setItem(UPDATE_NOTIFICATION_KEY_2026_05_25, Date.now().toString());
            sessionStorage.setItem(FAQ_TARGET_SECTION_KEY, CHANGELOG_2026_05_27);
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
                        src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f514.png"
                        alt="update"
                        className="w-10 h-10 mx-auto mb-2"
                    />
                    <h2 className="text-lg font-extrabold text-slate-800">小更新提醒</h2>
                    <p className="text-[11px] text-slate-400 mt-1">2026 年 5 月 27 日 · 情绪也能后台生成了</p>
                </div>

                <div className="px-6 pb-4 space-y-3">
                    <div className="bg-gradient-to-br from-rose-50 to-amber-50 border border-rose-100 rounded-2xl p-4">
                        <p className="text-[13px] text-slate-700 leading-relaxed">
                            一句话：开了 <strong className="text-rose-600">Instant 模式</strong>之后，给角色发完消息就能<strong className="text-amber-600">彻底关掉网页走人</strong> —— 不用守在前台等。角色回复好了，会自己<strong className="text-rose-600">以推送通知的形式</strong>回到你手机上。
                        </p>
                        <p className="text-[12px] text-slate-500 leading-relaxed mt-2">
                            这次新增：连角色的<strong>「情绪 / 状态」</strong>也搬到了云端。所以现在<strong>聊天回复</strong>和<strong>情绪 buff</strong> 都不用再在前端等生成了，发完即走。
                        </p>
                        <p className="text-[12px] text-slate-500 leading-relaxed mt-2">
                            <strong className="text-rose-600">上个版本配过 Instant Push 的同学：这次自动生效，不用重新配。</strong>第一次用的话，先到<strong>设置 → Instant Push</strong> 配一次，更新说明里附了配置视频；记得<strong>允许通知权限</strong>，不然回复推不回来。
                        </p>
                    </div>
                    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3">
                        <p className="text-[12px] font-bold text-rose-600 text-center">
                            点下方按钮看图文 + 视频教程
                        </p>
                    </div>
                </div>

                <div className="px-6 pb-7 pt-2">
                    <button
                        onClick={handleView}
                        className="w-full py-3.5 bg-gradient-to-r from-rose-500 to-amber-500 text-white font-bold rounded-2xl shadow-lg shadow-rose-200 active:scale-95 transition-transform text-sm"
                    >
                        查看 5 月 27 日小更新
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
