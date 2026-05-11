import React from 'react';
import { WarningCircle, X } from '@phosphor-icons/react';

const ResetCityDialog: React.FC<{
    participantCount: number;
    mainPlotCount: number;
    processing: boolean;
    onCancel: () => void;
    onArchiveAndReset: () => void;
    onDirectReset: () => void;
}> = ({ participantCount, mainPlotCount, processing, onCancel, onArchiveAndReset, onDirectReset }) => {
    return (
        <div
            className="absolute inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: 'rgba(0,0,0,0.35)' }}
            onClick={event => { if (event.target === event.currentTarget && !processing) onCancel(); }}
        >
            <div
                className="retro-window w-full"
                style={{
                    maxWidth: 340,
                    boxShadow: '4px 4px 0 rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.5)',
                }}
            >
                <div className="retro-titlebar">
                    <span className="flex items-center gap-1">
                        <WarningCircle size={11} weight="fill" /> reset-city.exe
                    </span>
                    {!processing && (
                        <button
                            onClick={onCancel}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 18,
                                height: 18,
                                borderRadius: 3,
                                background: 'rgba(255,255,255,0.15)',
                                border: '1px solid rgba(255,255,255,0.25)',
                                color: 'white',
                            }}
                        >
                            <X size={10} weight="bold" />
                        </button>
                    )}
                </div>

                <div style={{ padding: 12 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#4d475c', lineHeight: 1.5 }}>
                        是否结束这场游戏，并生成小结？
                    </p>
                    <p style={{ fontSize: 10, color: '#7d778a', lineHeight: 1.6, marginTop: 6 }}>
                        当前参与角色 {participantCount} 个，已记录主线 {mainPlotCount} 条。
                    </p>

                    <div className="retro-inset" style={{ padding: '7px 9px', marginTop: 8 }}>
                        <p style={{ fontSize: 9, color: '#7d746d', lineHeight: 1.6 }}>
                            “确定” 会调用 API 把这局《都市人生》浓缩成一张像素风结算小卡片，并发送到参与角色的聊天记录里。
                        </p>
                    </div>
                </div>

                <div style={{ padding: '0 12px 12px' }} className="space-y-2">
                    <button
                        onClick={onCancel}
                        disabled={processing}
                        className="retro-btn w-full"
                        style={{ padding: '7px 12px', opacity: processing ? 0.6 : 1 }}
                    >
                        取消
                    </button>
                    <button
                        onClick={onArchiveAndReset}
                        disabled={processing}
                        className="retro-btn retro-btn-primary w-full"
                        style={{ padding: '7px 12px', opacity: processing ? 0.6 : 1 }}
                    >
                        {processing ? '正在生成小结...' : '确定'}
                    </button>
                    <button
                        onClick={onDirectReset}
                        disabled={processing}
                        className="retro-btn w-full"
                        style={{
                            padding: '7px 12px',
                            background: 'linear-gradient(180deg, #e8d8d8, #d3b6b6)',
                            borderColor: '#b78585',
                            color: '#7b4a4a',
                            opacity: processing ? 0.6 : 1,
                        }}
                    >
                        直接结束游戏
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ResetCityDialog;
