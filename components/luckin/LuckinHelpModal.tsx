import React from 'react';

/**
 * 瑞一杯 使用说明 (首次启动自动弹一次, 之后收在 banner 的 ? 里随时看)
 *
 * 瑞幸 MCP 跟麦当劳逻辑不同: 拉不到整本菜单, 是"告诉角色哪家店的哪杯"由角色去点。
 */
const LuckinHelpModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-gradient-to-b from-[#FAF7F0] to-[#F3EFE6] w-full sm:max-w-sm rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 2rem)' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#0B1F3A] to-[#1E4D8C] rounded-t-2xl shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">🦌</span>
                        <div>
                            <div className="text-[13px] font-bold text-white">瑞一杯 · 怎么用</div>
                            <div className="text-[9px] text-white/70">跟麦当劳不太一样, 花 30 秒看下</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white active:scale-90">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 text-[12px] text-slate-700 leading-relaxed">
                    {/* 核心 */}
                    <div className="bg-white rounded-xl border border-[#E6DFCF] p-3">
                        <div className="text-[12px] font-bold text-[#0B1F3A] mb-1">☕ 直接跟 ta 说"哪家店的哪杯"</div>
                        <div>瑞幸跟麦当劳不一样——<b>拉不到整本菜单</b>。你直接告诉角色想喝什么、在哪附近, ta 会自动找最匹配的门店、点好、出微信二维码扫码付。</div>
                        <div className="mt-2 bg-[#0B1F3A]/5 rounded-lg px-2.5 py-2 text-[11px] text-[#0B1F3A]">
                            举例：<br />「帮我点一杯<b>花溪公园附近门店</b>的<b>无糖冰美式</b>」
                        </div>
                    </div>

                    {/* 门店 */}
                    <div className="flex gap-2">
                        <span className="text-[15px] shrink-0">📍</span>
                        <div><b>不指定门店</b>时, 角色按你<b>当前定位</b>选最近的店。<span className="text-amber-700">开着梯子定位可能不准</span> (启动时弹的定位框里能看精度, 不准就手选城市)。</div>
                    </div>

                    {/* 自动选 */}
                    <div className="flex gap-2">
                        <span className="text-[15px] shrink-0">🎯</span>
                        <div><b>不指定饮品 / 杯型 / 冷热</b>时, 角色会按对你的了解<b>自己拿主意</b> (越懂你点得越准, 不满意直接说"换一杯/要热的/大杯")。</div>
                    </div>

                    {/* 测试版优惠 */}
                    <div className="flex gap-2">
                        <span className="text-[15px] shrink-0">🧪</span>
                        <div><b>目前是测试版</b>：用不了瑞幸官方的门店优惠, <b>只有你账号自己的券</b>能自动抵扣。</div>
                    </div>

                    <div className="text-[10px] text-slate-400 text-center pt-1">下单 / 支付都在最后那张「结账卡」上点, 商品卡只是 ta 给你看的</div>
                </div>

                <div className="border-t border-[#DDD3BC] bg-gradient-to-r from-[#EFE9DC] to-[#E7DFC9] px-3 py-2.5 shrink-0">
                    <button onClick={onClose} className="w-full px-3 py-2.5 bg-[#0B1F3A] text-white text-[13px] font-bold rounded-xl active:scale-95">知道啦, 开点</button>
                </div>
            </div>
        </div>
    );
};

export default LuckinHelpModal;
