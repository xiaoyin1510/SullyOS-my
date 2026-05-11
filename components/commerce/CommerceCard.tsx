import React from 'react';
import { CommerceCardPayload } from './NuomiCommerceMiniApp';

type Action = 'mark_paid' | 'mark_rejected';

export default function CommerceCard({
    card,
    onAction,
}: {
    card: CommerceCardPayload;
    onAction?: (action: Action, card: CommerceCardPayload) => void;
}) {
    const isDelivery = card.mode === 'delivery';
    const isPendingPay = card.kind === 'delivery_request' && card.status === 'pending';
    const theme = isDelivery
        ? 'from-orange-50 to-amber-50 border-orange-100 text-orange-600'
        : 'from-pink-50 to-rose-50 border-pink-100 text-pink-600';
    const icon = isDelivery ? '🥡' : '🛒';
    const statusText = card.status === 'paid'
        ? '已完成支付'
        : card.status === 'rejected'
        ? '已拒绝支付'
        : card.status === 'pending'
        ? '等待选择'
        : card.status === 'gifted'
        ? '已送出'
        : '已记录';
    const total = `¥${Number(card.total || 0).toFixed(2).replace(/\.00$/, '')}`;

    return (
        <div className={`w-[min(92vw,350px)] overflow-hidden rounded-[22px] border bg-gradient-to-br shadow-sm ${theme}`}>
            <div className="px-3.5 py-3 border-b border-white/70 flex items-start gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-white/80 flex items-center justify-center text-xl shadow-sm shrink-0">{icon}</div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-black uppercase opacity-70">Nuomi Card</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/75 font-black">{statusText}</span>
                    </div>
                    <div className="text-sm font-black text-slate-900 leading-tight">{card.title}</div>
                    {card.subtitle && <div className="text-[11px] font-bold text-slate-500 mt-0.5">{card.subtitle}</div>}
                </div>
            </div>

            <div className="p-3 space-y-2 bg-white/45">
                {card.items.map((item, index) => (
                    <div key={`${item.id || item.name}-${index}`} className="rounded-2xl bg-white/85 border border-white p-2.5">
                        <div className="flex gap-2">
                            <div className="w-12 h-12 rounded-xl bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center text-2xl">
                                {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover" /> : (item.emoji || (isDelivery ? '🥡' : '🎁'))}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-xs font-black text-slate-800 truncate">{item.name}{item.variationName ? `（${item.variationName}）` : ''}</div>
                                        {item.category && <div className="text-[10px] font-bold text-slate-400 mt-0.5">{item.category}</div>}
                                    </div>
                                    <div className="text-xs font-black text-slate-900 shrink-0">¥{Number(item.subtotal || 0).toFixed(2).replace(/\.00$/, '')}</div>
                                </div>
                                <div className="mt-1 text-[10px] font-bold text-slate-400">数量 {item.qty} · 单价 ¥{Number(item.price || 0).toFixed(2).replace(/\.00$/, '')}</div>
                                {item.description && <p className="mt-1 text-[11px] leading-snug text-slate-500 whitespace-pre-wrap"><span className="font-black text-slate-400">详情页：</span>{item.description}</p>}
                                {item.note && <p className="mt-1 rounded-xl bg-slate-50 px-2 py-1 text-[10px] leading-snug text-slate-500">备注：{item.note}</p>}
                            </div>
                        </div>
                    </div>
                ))}
                {card.note && <div className="rounded-2xl bg-white/85 border border-white px-3 py-2 text-[11px] leading-snug text-slate-600 whitespace-pre-wrap">备注：{card.note}</div>}
                <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] font-black text-slate-500">合计</span>
                    <span className="text-xl font-black text-slate-900">{total}</span>
                </div>
            </div>

            {isPendingPay && (
                <div className="p-2.5 bg-white/65 border-t border-white/75 grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => onAction?.('mark_paid', card)}
                            className="h-9 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 text-xs font-black active:scale-95"
                        >
                            TA已付款
                        </button>
                        <button
                            type="button"
                            onClick={() => onAction?.('mark_rejected', card)}
                            className="h-9 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 text-xs font-black active:scale-95"
                        >
                            TA拒绝支付
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
