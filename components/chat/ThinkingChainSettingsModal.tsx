import React, { useEffect, useState } from 'react';
import { THINKING_CHAIN_PRESETS, resolveThinkingChainStyle, ThinkingChainStyleId } from './MessageItem';

interface ThinkingChainSettingsValue {
    enabled: boolean;
    styleId: ThinkingChainStyleId;
    customColors: { bg: string; accent: string; text: string };
    customPrompt: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    value: ThinkingChainSettingsValue;
    onChange: (next: Partial<ThinkingChainSettingsValue>) => void;
}

const SAMPLE_CHAIN = '又叫乖乖猫咪……烦死了。算了也没那么烦，比起这个——午饭吃没吃？她又拿力学所当借口，呵，老一套。算了，先骂一句再问。';

const STYLE_LIST: Array<{ id: ThinkingChainStyleId; name: string; sub: string }> = [
    { id: 'echo',    name: '心象',  sub: '暗紫 × 暖金，二次元卡牌' },
    { id: 'whisper', name: '心声',  sub: '羊皮纸暖色，私密日记' },
    { id: 'minimal', name: '极简',  sub: '纯白单色，OOC 调试视图' },
    { id: 'custom',  name: '自定',  sub: '三色调教，配你自己的味' },
];

const ColorField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
    <label className="flex items-center gap-3 text-[12px]">
        <span className="w-12 text-slate-500 shrink-0">{label}</span>
        <input
            type="color"
            value={value.startsWith('#') ? value : '#1f2937'}
            onChange={e => onChange(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border border-slate-200"
        />
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="flex-1 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono focus:outline-none focus:border-indigo-300"
            placeholder="#rrggbb 或 css 渐变"
        />
    </label>
);

// 折叠态 + 展开态的迷你预览，用 resolveThinkingChainStyle 渲染，避免重复样式逻辑
const StylePreview: React.FC<{ styleId: ThinkingChainStyleId; customColors: ThinkingChainSettingsValue['customColors']; compact?: boolean }> = ({ styleId, customColors, compact }) => {
    const spec = resolveThinkingChainStyle(styleId, customColors);
    return (
        <div
            className="relative overflow-hidden"
            style={{
                background: spec.bg,
                border: `1px solid ${spec.border}`,
                borderRadius: spec.radius,
                padding: compact ? '6px 8px' : '10px 12px',
            }}
        >
            {spec.showCorners && (
                <>
                    <span aria-hidden className="absolute top-1 left-1 w-1.5 h-1.5 border-t border-l" style={{ borderColor: spec.accent }} />
                    <span aria-hidden className="absolute top-1 right-1 w-1.5 h-1.5 border-t border-r" style={{ borderColor: spec.accent }} />
                    <span aria-hidden className="absolute bottom-1 left-1 w-1.5 h-1.5 border-b border-l" style={{ borderColor: spec.accent }} />
                    <span aria-hidden className="absolute bottom-1 right-1 w-1.5 h-1.5 border-b border-r" style={{ borderColor: spec.accent }} />
                </>
            )}
            <div className="relative flex items-center gap-1.5">
                <span style={{ color: spec.accent, fontSize: compact ? 9 : 11, letterSpacing: '0.3em', fontFamily: spec.fontFamily, fontWeight: 600 }}>
                    {spec.titleZh}
                </span>
                <span style={{ color: spec.text, opacity: 0.6, fontSize: compact ? 6 : 7, letterSpacing: '0.25em' }}>
                    {spec.titleEn}
                </span>
            </div>
            {!compact && (
                <div
                    className={`mt-1 truncate ${spec.italic ? 'italic' : ''}`}
                    style={{ color: spec.text, fontFamily: spec.fontFamily, fontSize: 10.5 }}
                >
                    <span style={{ color: spec.accent }}>{spec.quoteLeft}</span>
                    {SAMPLE_CHAIN.slice(0, 24)}…
                    <span style={{ color: spec.accent }}>{spec.quoteRight}</span>
                </div>
            )}
        </div>
    );
};

const ThinkingChainSettingsModal: React.FC<Props> = ({ isOpen, onClose, value, onChange }) => {
    const [draftPrompt, setDraftPrompt] = useState(value.customPrompt || '');
    useEffect(() => { if (isOpen) setDraftPrompt(value.customPrompt || ''); }, [isOpen, value.customPrompt]);
    if (!isOpen) return null;

    const commitPrompt = () => onChange({ customPrompt: draftPrompt });

    return (
        <div
            className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[1px]"
            onClick={onClose}
        >
            <div
                className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-y-auto no-scrollbar shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 bg-white px-5 pt-5 pb-3 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-base font-bold text-slate-800">心象 · 设置</h2>
                            <p className="text-[11px] text-slate-400 mt-0.5">关于「心象」卡片的所有调教都在这里</p>
                        </div>
                        <button
                            onClick={() => { commitPrompt(); onClose(); }}
                            className="text-[12px] font-bold text-indigo-500 active:scale-95 transition"
                        >
                            完成
                        </button>
                    </div>
                </div>

                <div className="p-5 space-y-6">
                    {/* 0. 这是什么 / 看不见怎么办 */}
                    <section className="rounded-2xl bg-amber-50/70 border border-amber-200/70 px-3.5 py-3 text-[11px] leading-[1.7] text-slate-600">
                        <div className="font-bold text-amber-700 mb-1 text-[11.5px]">⚠ 先看这里：「心象」到底是什么</div>
                        <p>
                            这是 AI 模型**自己原生输出的思考链**——
                            <code className="px-1 py-0.5 mx-0.5 rounded bg-white border border-amber-100 text-[10px] font-mono text-amber-700">reasoning_content</code>
                            字段或
                            <code className="px-1 py-0.5 mx-0.5 rounded bg-white border border-amber-100 text-[10px] font-mono text-amber-700">&lt;think&gt;</code>
                            标签里的内容。**它不是我们额外让模型为角色生成的"内心戏"**，而是模型在准备回复时本来就有的元思考过程。
                        </p>
                        <p className="mt-2">
                            正因如此——**它的本质决定了它不会像角色台词那样鲜活**，更像看一个演员在化妆间的喃喃自语，而不是舞台上的台词。这个功能本来就是给"喜欢看大模型思维链"的用户准备的彩蛋，**不一定适合每个人**。
                        </p>
                        <p className="mt-2">
                            还有一点同样由这个本质决定:思维链**不进入上下文**,也**不会成为角色真实回复的一部分**——它只反映当前模型这一轮的思考瞬间。所以**下一轮,角色不会记得自己上一轮在想什么**,ta 只会基于真正发出去的那段回复(以及对话历史)往下走。
                        </p>
                        <p className="mt-2">
                            如果你看到思考链觉得跳戏 / 影响沉浸感 / 觉得太"AI"——直接关掉就好，不会有任何损失，角色回复本身完全不受影响。
                        </p>
                        <p className="mt-2 text-slate-500">看不太懂上面在说啥？去问给你 API 的人，他/她会比这里讲得清楚。</p>
                        <div className="mt-2.5 pt-2.5 border-t border-amber-200/60">
                            <div className="font-bold text-amber-700 mb-1 text-[11.5px]">开了但没看到「心象」卡片？</div>
                            <ul className="list-disc pl-4 space-y-0.5">
                                <li><b>你的模型不带思考链</b> → 请问你 API 提供者哪些模型支持 thinking，或自己查找</li>
                                <li><b>这一轮模型没思考</b>（短回复 / 模型自己判断不需要） → 正常现象，下一轮可能就有</li>
                                <li><b>代理拒绝转发 thinking 字段</b> → 跟 API 提供方确认对应模型是否启用了 extended thinking</li>
                            </ul>
                        </div>
                        <div className="mt-2.5 pt-2.5 border-t border-amber-200/60">
                            <div className="font-bold text-amber-700 mb-1 text-[11.5px]">思考链一直是英文怎么办？</div>
                            <p>
                                这通常**不是模型本身的问题**——同一个模型走官方渠道（Anthropic / OpenAI / 智谱直连等）能正常保持中文，是中转 API 把 system prompt 截短或改写造成的。可以试：
                            </p>
                            <ul className="list-disc pl-4 space-y-0.5 mt-1">
                                <li>下面「追加提示词」里再加一条肘击：「thinking 必须中文，禁止英文」</li>
                                <li>直接在聊天里跟角色说一句「用中文想」</li>
                                <li>换一个跑得动官克的渠道</li>
                            </ul>
                        </div>
                    </section>

                    {/* 1. 总开关 */}
                    <section>
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => onChange({ enabled: !value.enabled })}>
                            <div>
                                <div className="text-[13px] font-bold text-slate-700">显示思考过程</div>
                                <div className="text-[10.5px] text-slate-400 mt-0.5">关闭后角色回复不再带「心象」卡片，已存的旧消息保留。</div>
                            </div>
                            <div className={`shrink-0 ml-3 w-10 h-6 rounded-full p-1 transition-colors flex items-center ${value.enabled ? 'bg-indigo-500' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${value.enabled ? 'translate-x-4' : ''}`} />
                            </div>
                        </div>
                    </section>

                    {/* 2. 卡片风格 */}
                    <section>
                        <h3 className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">卡片风格</h3>
                        <div className="grid grid-cols-2 gap-2.5">
                            {STYLE_LIST.map(item => {
                                const active = value.styleId === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => onChange({ styleId: item.id })}
                                        className={`text-left rounded-xl p-2 border transition-all ${active ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}
                                    >
                                        <StylePreview styleId={item.id} customColors={value.customColors} compact />
                                        <div className="mt-1.5 flex items-baseline gap-1.5">
                                            <span className="text-[12px] font-bold text-slate-700">{item.name}</span>
                                            <span className="text-[9.5px] text-slate-400">{item.sub}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {value.styleId === 'custom' && (
                            <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                                <div className="text-[10.5px] font-bold text-slate-500 mb-1">三色调教</div>
                                <ColorField
                                    label="背景"
                                    value={value.customColors.bg}
                                    onChange={bg => onChange({ customColors: { ...value.customColors, bg } })}
                                />
                                <ColorField
                                    label="点缀"
                                    value={value.customColors.accent}
                                    onChange={accent => onChange({ customColors: { ...value.customColors, accent } })}
                                />
                                <ColorField
                                    label="正文"
                                    value={value.customColors.text}
                                    onChange={text => onChange({ customColors: { ...value.customColors, text } })}
                                />
                                <div className="text-[9.5px] text-slate-400 leading-relaxed mt-1.5">
                                    背景支持 CSS 渐变（例：linear-gradient(135deg, #1a1a2e, #16213e)）。
                                </div>
                            </div>
                        )}

                        {/* 实时大预览 */}
                        <div className="mt-3 px-1">
                            <div className="text-[9.5px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">实时预览</div>
                            <StylePreview styleId={value.styleId} customColors={value.customColors} />
                        </div>
                    </section>

                    {/* 3. 追加提示词 */}
                    <section>
                        <h3 className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-2">追加提示词</h3>
                        <p className="text-[10.5px] text-slate-400 mb-2 leading-relaxed">
                            原生提示词（让模型用角色第一人称、中文意识流思考）保持不变；这里写的内容**追加在最后**作为「用户对内心独白的额外要求」。
                        </p>
                        <textarea
                            value={draftPrompt}
                            onChange={e => setDraftPrompt(e.target.value)}
                            onBlur={commitPrompt}
                            placeholder="比如：思考时偶尔切到日语 / 多写一些感官细节 / 想到用户时用昵称…"
                            className="w-full h-28 bg-slate-50 rounded-xl p-3 text-[12px] resize-none border border-slate-200 focus:outline-none focus:border-indigo-300"
                        />
                        <div className="text-[9.5px] text-slate-400 mt-1">留空 = 仅使用原生提示词。</div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default ThinkingChainSettingsModal;
export type { ThinkingChainSettingsValue };
