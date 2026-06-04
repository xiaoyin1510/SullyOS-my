import React, { useEffect, useMemo, useState } from 'react';
import { X, Sparkle, ShoppingCartSimple, Plus, Minus, Trash, Receipt, Gift, PaperPlaneTilt, Storefront, BowlFood, ArrowsClockwise } from '@phosphor-icons/react';
import { APIConfig, CharacterProfile, Message, UserProfile } from '../../types';
import { NUOMI_COMMERCE_FEATURE_EVENT, isNuomiCommerceFeatureEnabled, setNuomiCommerceFeatureEnabled } from '../../utils/nuomiCommerceFeature';

export type CommerceMode = 'shopping' | 'delivery';
type ProductSource = 'default' | 'manual' | 'ai';
type ProductVariation = { id: string; name: string; price: number };
type Product = { id: string; name: string; category: string; price: number; description?: string; note?: string; image?: string; emoji?: string; variations?: ProductVariation[]; source?: ProductSource };
type CartLine = { productId: string; variationId?: string; qty: number };

export type CommerceCardItem = { id?: string; name: string; category?: string; description?: string; note?: string; variationName?: string; qty: number; price: number; subtotal: number; emoji?: string; image?: string };
export type CommerceCardKind = 'shopping_receipt' | 'shopping_gift' | 'delivery_request' | 'delivery_gift' | 'delivery_paid' | 'delivery_rejected' | 'char_delivery_to_user' | 'char_purchase_to_user';
export type CommerceCardPayload = {
    version: 2; id: string; kind: CommerceCardKind; title: string; subtitle?: string; mode: CommerceMode; actorName: string; targetName?: string; charName?: string; userName?: string;
    items: CommerceCardItem[]; total: number; note?: string; status?: 'pending' | 'paid' | 'rejected' | 'gifted' | 'receipt'; createdAt: number; aiPrompt?: string;
};
export type CommerceMessagePayload = { card?: CommerceCardPayload; systemContent?: string; triggerAI?: boolean; toast?: string; role?: 'user' | 'assistant'; metadata?: Record<string, any> };

type Props = { open: boolean; initialMode?: CommerceMode; onClose: () => void; char?: CharacterProfile | null; userProfile?: UserProfile; apiConfig?: APIConfig; recentMessages?: Message[]; onSendToChat?: (payload: CommerceMessagePayload) => Promise<void> | void };
type AiPreset = { id: string; name: string; baseUrl: string; apiKey: string; model: string };
type AiSettings = { baseUrl: string; apiKey: string; model: string; presetName: string; presets: AiPreset[]; models: string[]; contextMessageCount: number };
type ProductFormState = { name: string; category: string; price: string; description: string; emoji: string; image: string };
type ProductEditFormState = { name: string; price: string; description: string };
type DirectForm = { name: string; amount: string; note: string };

const STORAGE_VERSION = 5;
const AI_KEY = `nuomi_commerce_ai_settings_v${STORAGE_VERSION}`;
const blankProductForm: ProductFormState = { name: '', category: '', price: '', description: '', emoji: '🎁', image: '' };
const blankDirect: DirectForm = { name: '', amount: '', note: '' };

const defaultProducts: Product[] = [
    { id: 'plush-phone-charm', name: '毛绒手机挂件', category: '可爱小物', price: 19.9, description: '软乎乎的手机挂件，适合挂在角色手机旁边。', emoji: '🧸', source: 'default' },
    { id: 'chat-energy-box', name: '聊天能量补给盒', category: '零食饮料', price: 36, description: '巧克力、饼干和小饮料的组合，适合深夜聊天。', emoji: '🍫', source: 'default' },
    { id: 'memory-notebook', name: '记忆手账本', category: '生活用品', price: 28, description: '可以记录约定、日程、灵感和聊天里的小细节。', emoji: '📔', source: 'default' },
    { id: 'tiny-flower', name: '迷你花束', category: '礼物', price: 45, description: '一束小小的花，适合当作突然的惊喜。', emoji: '💐', source: 'default' },
    { id: 'sleep-mask', name: '云朵眼罩', category: '生活用品', price: 25, description: '柔软遮光，适合提醒TA好好休息。', emoji: '☁️', source: 'default' },
    { id: 'lucky-coffee-card', name: '咖啡兑换券', category: '礼物', price: 18, description: '给TA换一杯醒神咖啡。', emoji: '☕', source: 'default' },
];
const defaultDelivery: Product[] = [
    { id: 'mango-sago', name: '杨枝甘露', category: '甜品饮料', price: 21, emoji: '🥭', source: 'default' },
    { id: 'burger-set', name: '汉堡薯条套餐', category: '快餐', price: 32, emoji: '🍔', source: 'default' },
    { id: 'beef-noodle', name: '热汤牛肉面', category: '热食', price: 29, emoji: '🍜', source: 'default' },
    { id: 'fried-chicken', name: '香酥炸鸡盒', category: '快餐', price: 28, emoji: '🍗', source: 'default' },
    { id: 'milk-tea', name: '珍珠奶茶', category: '甜品饮料', price: 16, emoji: '🧋', source: 'default' },
    { id: 'strawberry-cake', name: '草莓小蛋糕', category: '甜品饮料', price: 23, emoji: '🍰', source: 'default' },
];

const money = (n: number) => `¥${Number(n || 0).toFixed(2).replace(/\.00$/, '')}`;
const id = (p = 'id') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const key = (mode: CommerceMode, charId?: string) => `nuomi_commerce_${mode}_products_v${STORAGE_VERSION}_${charId || 'global'}`;
const catKey = (mode: CommerceMode, charId?: string) => `nuomi_commerce_${mode}_categories_v${STORAGE_VERSION}_${charId || 'global'}`;
const readCats = (mode: CommerceMode, charId?: string): string[] => { try { const v = JSON.parse(localStorage.getItem(catKey(mode, charId)) || '[]'); return Array.isArray(v) ? v.filter(Boolean).map(String) : []; } catch { return []; } };
const writeCats = (mode: CommerceMode, charId: string | undefined, cats: string[]) => { try { localStorage.setItem(catKey(mode, charId), JSON.stringify(Array.from(new Set(cats.filter(Boolean))))); } catch {} };
const read = (mode: CommerceMode, charId?: string): Product[] | null => { try { const v = JSON.parse(localStorage.getItem(key(mode, charId)) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
const write = (mode: CommerceMode, charId: string | undefined, products: Product[]) => { try { localStorage.setItem(key(mode, charId), JSON.stringify(products)); } catch {} };
const normalizeAi = (raw: any, fallback?: APIConfig): AiSettings => {
    const rawBaseUrl = String(raw?.baseUrl || '').trim();
    const fallbackBaseUrl = String(fallback?.baseUrl || '').trim();
    const presets = Array.isArray(raw?.presets) ? raw.presets : [];
    const shouldDropLegacyPrefill = !!rawBaseUrl && !!fallbackBaseUrl && rawBaseUrl === fallbackBaseUrl && !raw?.apiKey && !raw?.model && presets.length === 0;
    return { baseUrl: shouldDropLegacyPrefill ? '' : rawBaseUrl, apiKey: raw?.apiKey || '', model: raw?.model || '', presetName: raw?.presetName || '', presets, models: Array.isArray(raw?.models) ? raw.models : [], contextMessageCount: Math.max(0, Math.min(100, Number(raw?.contextMessageCount ?? 18))) };
};
const readAi = (fallback?: APIConfig): AiSettings => { try { return normalizeAi(JSON.parse(localStorage.getItem(AI_KEY) || '{}'), fallback); } catch { return normalizeAi({}, fallback); } };
const saveAi = (s: AiSettings) => { try { localStorage.setItem(AI_KEY, JSON.stringify(s)); } catch {} };
const lineKey = (l: CartLine) => `${l.productId}::${l.variationId || 'default'}`;
const baseUrl = (url: string) => (url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');

function findProduct(products: Product[], line: CartLine) {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return null;
    const variation = line.variationId ? product.variations?.find((v) => v.id === line.variationId) : undefined;
    return { product, variation, price: variation?.price ?? product.price, label: variation ? `${product.name}（${variation.name}）` : product.name };
}
function summary(products: Product[], cart: CartLine[]) {
    const lines = cart.map((line) => {
        const found = findProduct(products, line);
        return found ? { ...found, qty: line.qty, subtotal: found.price * line.qty } : null;
    }).filter(Boolean) as Array<{ product: Product; variation?: ProductVariation; price: number; label: string; qty: number; subtotal: number }>;
    return { lines, total: lines.reduce((s, l) => s + l.subtotal, 0) };
}
function cardItems(sum: ReturnType<typeof summary>): CommerceCardItem[] {
    return sum.lines.map((l) => ({ id: l.product.id, name: l.product.name, category: l.product.category, description: l.product.description, variationName: l.variation?.name, qty: l.qty, price: l.price, subtotal: l.subtotal, emoji: l.product.emoji, image: l.product.image }));
}
function messagesText(messages: Message[] | undefined, count: number) {
    const n = Math.max(0, Math.min(100, Number(count ?? 18)));
    if (n <= 0) return '';
    return (messages || []).slice(-n).map((m) => `${m.role === 'assistant' ? 'char' : m.role === 'user' ? 'user' : 'system'}：${String(m.content || '').slice(0, 180)}`).join('\n');
}
function charText(char?: CharacterProfile | null) {
    if (!char) return '未选择角色';
    const data: Record<string, any> = { name: char.name };
    ['persona', 'description', 'systemPrompt', 'background', 'personality', 'speakingStyle', 'worldview'].forEach((k) => { const v = (char as any)[k]; if (v) data[k] = String(v).slice(0, 700); });
    const mounted = (char as any).mountedWorldbooks;
    if (Array.isArray(mounted) && mounted.length) {
        data.mountedWorldbooks = mounted.slice(0, 8).map((w: any) => ({ title: String(w.title || '').slice(0, 80), category: w.category, content: String(w.content || '').slice(0, 900) }));
    }
    return JSON.stringify(data, null, 2);
}
function parseJsonArray(text: string) {
    const s = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const a = s.indexOf('['); const b = s.lastIndexOf(']');
    return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
}
async function aiRestock(
    ai: AiSettings,
    mode: CommerceMode,
    targetCategory: string,
    char?: CharacterProfile | null,
    recentMessages?: Message[],
    existingProducts: Product[] = [],
    existingCategories: string[] = []
) {
    const root = baseUrl(ai.baseUrl);
    if (!root || !ai.apiKey || !ai.model) throw new Error('请先设置 URL、API Key，并拉取/选择模型');
    const fixedCategory = targetCategory && targetCategory !== '全部' ? targetCategory.trim() : '';
    const modeLabel = mode === 'delivery' ? '外卖' : '购物';
    const activeExisting = existingProducts.slice(0, 180).map(p => `${p.category}/${p.name}/${p.price}`).join('；');
    const contextCount = Math.max(0, Math.min(100, Number(ai.contextMessageCount ?? 18)));
    const categoryRule = fixedCategory
        ? `本次用户正在“${fixedCategory}”分类里点击 AI 补货，只能生成“${fixedCategory}”分类的${modeLabel}商品；每个对象的 category 必须严格等于“${fixedCategory}”。`
        : `本次用户在“全部”分类点击 AI 补货，可以根据角色自由选择或新增合适分类。`;
    const prompt = `请根据角色人设、已挂载世界书、最近聊天上下文和当前关系，为“购物中心”的【${modeLabel}】补货。

角色资料：
${charText(char)}

最近聊天（最近 ${contextCount} 条，每条最多 180 字）：
${messagesText(recentMessages, contextCount) || '不参考聊天记录'}

现有分类：${existingCategories.filter(c => c !== '全部').join('、') || '暂无'}
现有商品（避免重复）：${activeExisting || '暂无'}

分类要求：${categoryRule}

补货选品要求：商品和分类可以参考角色性格、世界书设定、生活习惯、情绪、关系进展和最近对话来决定“适合补什么货”；它们应该像角色会真正感兴趣、购买、制作、想收到或想送出的东西。不要替换已有商品，不要重复现有商品或只换一个名字。不要参考“神经链接/记忆宫殿”的按天或按月记忆。

详情页文案要求：description 必须是正常商家/平台视角的商品详情页文案，只描述商品本身的功能、材质、口味、卖点、使用场景或搭配建议；禁止使用角色第一人称或第二人称代入，禁止写“给你/给TA/陪你/你现在/她喜欢/他记得/聊天里/记忆里/关系里”等像角色根据记忆说话的句子。可以让商品选择贴合角色，但详情页文案必须像普通购物平台的商品介绍。

只输出严格 JSON 数组。每个商品对象字段：name、category、price、description、emoji。description 表示“详情页”内容，写给普通顾客看的商家商品介绍。不要输出款式 variations，不要输出商品备注 note。`;
    const res = await fetch(`${root}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` }, body: JSON.stringify({ model: ai.model, messages: [{ role: 'system', content: '你是购物中心补货助手，只输出 JSON 数组，不输出解释。' }, { role: 'user', content: prompt }], temperature: 0.85 }) });
    if (!res.ok) throw new Error(`API 请求失败：${res.status}`);
    const data = await res.json();
    const arr = parseJsonArray(data?.choices?.[0]?.message?.content || '[]');
    if (!Array.isArray(arr)) throw new Error('AI 返回不是数组');
    return arr.slice(0, 36).map((x: any, i: number): Product => {
        const price = Number(x.price) || 10 + i;
        const categoryName = fixedCategory || String(x.category || `${modeLabel}推荐`).slice(0, 18);
        return {
            id: id(mode === 'delivery' ? 'ai-delivery' : 'ai-product'),
            name: String(x.name || `${modeLabel}商品${i + 1}`).slice(0, 32),
            category: categoryName,
            price,
            description: String(x.description || '商品详情待补充。').replace(/(给你|给TA|陪你|你现在|聊天里|记忆里|她喜欢|他喜欢|关系里)/g, '').slice(0, 360),
            emoji: String(x.emoji || (mode === 'delivery' ? '🥡' : '🎁')).slice(0, 4),
            source: 'ai'
        };
    });
}
async function pullModels(ai: AiSettings) {
    const root = baseUrl(ai.baseUrl);
    if (!root || !ai.apiKey) throw new Error('请先填写 URL 和 API Key');
    const res = await fetch(`${root}/models`, { headers: { Authorization: `Bearer ${ai.apiKey}` } });
    if (!res.ok) throw new Error(`拉取失败：${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const models = list.map((m: any) => String(m.id || m.name || m.model || '')).filter(Boolean);
    if (!models.length) throw new Error('没有识别到模型名称');
    return models;
}

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => <label className="block space-y-1.5"><span className="text-[12px] font-black text-slate-500">{label}</span>{children}{hint && <span className="block text-[10px] text-slate-400 leading-snug">{hint}</span>}</label>;
const inputClass = 'w-full h-10 rounded-2xl border border-slate-100 bg-white px-3 text-sm outline-none focus:border-pink-200';
const areaClass = 'w-full min-h-[72px] rounded-2xl border border-slate-100 bg-white p-3 text-sm outline-none resize-none focus:border-pink-200';

function AddProductCard({ mode, category, onAdd }: { mode: CommerceMode; category: string; onAdd: () => void }) {
    const label = category === '全部' ? '选择/新建分类后添加' : `添加到“${category}”`;
    return <button type="button" onClick={onAdd} className="min-h-[128px] sm:min-h-[220px] rounded-2xl sm:rounded-3xl border-2 border-dashed border-pink-300 bg-white/70 text-pink-500 flex flex-col items-center justify-center gap-1.5 sm:gap-3 active:scale-95">
        <span className="text-3xl sm:text-6xl leading-none">＋</span>
        <span className="text-[10px] sm:text-xs font-black leading-tight">{mode === 'delivery' ? '上传外卖' : '上传商品'}</span>
        <span className="hidden sm:block px-3 text-[11px] font-bold text-slate-400 text-center">{label}</span>
    </button>;
}
function ProductCard({ mode, product, checked, manage, selected, onCheck, onOpenDetail, onEdit, onAdd, onDelete }: { mode: CommerceMode; product: Product; checked?: boolean; manage?: boolean; selected?: boolean; onCheck: () => void; onOpenDetail: () => void; onEdit: () => void; onAdd: () => void; onDelete: () => void }) {
    const longPressTimer = React.useRef<number | null>(null);
    const longPressed = React.useRef(false);
    const clearLongPress = () => {
        if (longPressTimer.current != null) {
            window.clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };
    const startLongPress = () => {
        clearLongPress();
        longPressed.current = false;
        longPressTimer.current = window.setTimeout(() => {
            longPressTimer.current = null;
            longPressed.current = true;
            onEdit();
        }, 560);
    };
    const handleMainClick = () => {
        if (longPressed.current) {
            longPressed.current = false;
            return;
        }
        onOpenDetail();
    };
    return <article
        className={`relative rounded-2xl sm:rounded-3xl border p-1.5 sm:p-3 bg-white shadow-sm ${selected ? 'border-pink-300 ring-2 ring-pink-100' : 'border-slate-100'}`}
        onContextMenu={(e) => { e.preventDefault(); onEdit(); }}
        title="点击查看完整详情页，长按修改商品"
    >
        {manage && <button type="button" onClick={onCheck} className={`absolute left-1 top-1 sm:left-2 sm:top-2 z-10 w-6 h-6 sm:w-7 sm:h-7 rounded-full border text-[10px] sm:text-xs font-black ${checked ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-300 border-slate-200'}`}>{checked ? '✓' : ''}</button>}
        <button
            type="button"
            onClick={handleMainClick}
            onPointerDown={startLongPress}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            className="w-full text-left"
        >
            <div className="aspect-[4/3] sm:aspect-[4/3] rounded-xl sm:rounded-2xl bg-gradient-to-br from-pink-50 to-orange-50 flex items-center justify-center overflow-hidden mb-1.5 sm:mb-3">{product.image ? <img src={product.image} alt="" className="w-full h-full object-cover" /> : <span className="text-xl sm:text-4xl">{product.emoji || '🎁'}</span>}</div>
            <div className="min-w-0"><h4 className="text-[10px] sm:text-sm font-black text-slate-800 leading-tight line-clamp-2 min-h-[22px] sm:min-h-0">{product.name}</h4><p className="block text-[9px] sm:text-[11px] text-slate-400 font-bold mt-0.5 truncate">{product.category}</p></div>
            <strong className="mt-0.5 sm:mt-1 block text-[11px] sm:text-sm text-pink-500 shrink-0">{money(product.price)}</strong>
            {product.description && <p className="line-clamp-2 text-[9px] sm:text-[12px] text-slate-500 leading-snug sm:leading-relaxed mt-1 sm:mt-2 min-h-[22px] sm:min-h-0">{product.description}</p>}
        </button>
        <div className="mt-1.5 sm:mt-3 grid grid-cols-[1fr_auto] gap-1 sm:gap-2"><button type="button" onClick={onAdd} className="h-7 sm:h-9 rounded-xl sm:rounded-2xl bg-slate-900 text-white text-[10px] sm:text-xs font-black active:scale-95 flex items-center justify-center gap-0.5 sm:gap-1"><Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" weight="bold" /><span>加入</span></button><button type="button" onClick={onDelete} className="h-7 w-7 sm:h-9 sm:w-9 rounded-xl sm:rounded-2xl bg-slate-50 border border-slate-100 text-slate-400 flex items-center justify-center"><Trash className="w-3.5 h-3.5 sm:w-4 sm:h-4" /></button></div>
    </article>;
}

function ProductDetailSheet({ product, onClose }: { product: Product; onClose: () => void }) {
    return <div className="fixed inset-0 z-[90] bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}>
        <div className="w-full sm:max-w-md max-h-[86dvh] rounded-t-[30px] sm:rounded-[30px] bg-white shadow-2xl overflow-hidden flex flex-col" onMouseDown={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                    <div className="text-[11px] font-black text-slate-400 truncate">{product.category}</div>
                    <h3 className="font-black text-slate-900 text-base leading-tight truncate">{product.name}</h3>
                </div>
                <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
                <div className="rounded-[26px] bg-gradient-to-br from-pink-50 to-orange-50 min-h-[160px] flex items-center justify-center overflow-hidden">
                    {product.image ? <img src={product.image} alt="" className="w-full h-full object-cover" /> : <span className="text-6xl">{product.emoji || '🎁'}</span>}
                </div>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h4 className="text-lg font-black text-slate-900 leading-tight">{product.name}</h4>
                        <div className="mt-1 text-xs font-bold text-slate-400">{product.category}</div>
                    </div>
                    <div className="text-xl font-black text-pink-500 shrink-0">{money(product.price)}</div>
                </div>
                <div>
                    <div className="mb-2 text-[12px] font-black text-slate-500">商品详情页</div>
                    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-sm leading-relaxed text-slate-600 whitespace-pre-wrap">{product.description || '暂无详情。'}</div>
                </div>
                {product.note && <div>
                    <div className="mb-2 text-[12px] font-black text-slate-500">备注</div>
                    <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-sm leading-relaxed text-amber-700 whitespace-pre-wrap">{product.note}</div>
                </div>}
            </div>
        </div>
    </div>;
}

function ProductEditSheet({ mode, product, form, setForm, onClose, onSave }: { mode: CommerceMode; product: Product; form: ProductEditFormState; setForm: React.Dispatch<React.SetStateAction<ProductEditFormState>>; onClose: () => void; onSave: () => void }) {
    const delivery = mode === 'delivery';
    return <div className="fixed inset-0 z-[92] bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}>
        <div className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-t-[30px] sm:rounded-[30px] bg-white p-4 shadow-2xl" onMouseDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
                <div className="min-w-0">
                    <h3 className="font-black text-slate-900">修改{delivery ? '外卖' : '商品'}</h3>
                    <div className="text-[11px] font-bold text-slate-400 truncate">分类：{product.category}</div>
                </div>
                <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
                <Field label="名称"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputClass} /></Field>
                <Field label="价格"><input value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} type="number" className={inputClass} /></Field>
                <Field label={delivery ? '详情页 / 外卖说明' : '详情页'}><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={areaClass} placeholder={delivery ? '例如：店铺口味、套餐内容、配送说明……' : '按正常商家视角描述商品卖点、材质、用途……'} /></Field>
                <button onClick={onSave} className="w-full h-11 rounded-2xl bg-slate-900 text-white text-sm font-black">保存修改</button>
            </div>
        </div>
    </div>;
}

function Cart({ products, cart, title, onInc, onDec, onClear }: { products: Product[]; cart: CartLine[]; title: string; onInc: (l: CartLine) => void; onDec: (l: CartLine) => void; onClear: () => void }) {
    const sum = summary(products, cart);
    return <aside className="rounded-[28px] border border-slate-100 bg-white shadow-sm p-3 min-h-[210px] flex flex-col"><div className="flex items-center justify-between mb-3"><div className="font-black text-slate-800 flex items-center gap-1.5"><ShoppingCartSimple className="w-4 h-4" weight="bold" />{title}</div>{cart.length > 0 && <button type="button" onClick={onClear} className="text-[11px] font-bold text-slate-400 flex items-center gap-1"><Trash className="w-3.5 h-3.5" />清空</button>}</div>{sum.lines.length === 0 ? <div className="h-28 rounded-2xl border border-dashed border-slate-200 bg-white/50 flex items-center justify-center text-xs font-bold text-slate-400">还没有选择</div> : <div className="space-y-2 max-h-52 overflow-y-auto pr-1">{sum.lines.map((l) => <div key={`${l.product.id}-${l.variation?.id || 'default'}`} className="rounded-2xl bg-slate-50 p-2.5"><div className="flex justify-between gap-2"><div className="min-w-0"><div className="text-xs font-black text-slate-700 truncate">{l.product.emoji || '🎁'} {l.label}</div><div className="text-[11px] font-bold text-slate-400">{money(l.price)} / 件</div></div><div className="text-xs font-black text-pink-500">{money(l.subtotal)}</div></div><div className="flex justify-end items-center gap-2 mt-2"><button type="button" onClick={() => onDec({ productId: l.product.id, variationId: l.variation?.id, qty: l.qty })} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button><span className="w-6 text-center text-xs font-black">{l.qty}</span><button type="button" onClick={() => onInc({ productId: l.product.id, variationId: l.variation?.id, qty: l.qty })} className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button></div></div>)}</div>}<div className="mt-auto pt-4 flex items-center justify-between border-t border-slate-100"><span className="text-xs font-bold text-slate-400">合计</span><strong className="text-xl text-slate-900">{money(sum.total)}</strong></div></aside>;
}


function CartActionSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return <div className="fixed inset-0 z-[88] bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}>
        <div className="w-full sm:max-w-md max-h-[86dvh] rounded-t-[30px] sm:rounded-[30px] bg-[#f8fafc] shadow-2xl overflow-hidden flex flex-col" onMouseDown={e => e.stopPropagation()}>
            <div className="p-4 bg-white border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
                <div className="font-black text-slate-900 flex items-center gap-2"><ShoppingCartSimple className="w-5 h-5" weight="bold" />{title}</div>
                <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 overflow-y-auto space-y-3">{children}</div>
        </div>
    </div>;
}

function CommerceToast({ message, leaving, className = '' }: { message: string; leaving: boolean; className?: string }) {
    return <div className={`${className} rounded-2xl bg-slate-900 text-white px-3 py-2 text-xs font-bold transition-all duration-500 ease-out ${leaving ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'}`}>{message}</div>;
}


export default function NuomiCommerceMiniApp({ open, initialMode = 'shopping', onClose, char, userProfile, apiConfig, recentMessages, onSendToChat }: Props) {
    const [tab, setTab] = useState<CommerceMode>(initialMode);
    const [products, setProducts] = useState<Product[]>(() => read('shopping', char?.id) || defaultProducts);
    const [delivery, setDelivery] = useState<Product[]>(() => read('delivery', char?.id) || defaultDelivery);
    const [shoppingCustomCats, setShoppingCustomCats] = useState<string[]>(() => readCats('shopping', char?.id));
    const [deliveryCustomCats, setDeliveryCustomCats] = useState<string[]>(() => readCats('delivery', char?.id));
    const [category, setCategory] = useState('全部');
    const [deliveryCategory, setDeliveryCategory] = useState('全部');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [cart, setCart] = useState<CartLine[]>([]);
    const [deliveryCart, setDeliveryCart] = useState<CartLine[]>([]);
    const [note, setNote] = useState('');
    const [deliveryNote, setDeliveryNote] = useState('');
    const [toast, setToast] = useState<string | null>(null);
    const [toastLeaving, setToastLeaving] = useState(false);
    const [manage, setManage] = useState(false);
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [checkedDelivery, setCheckedDelivery] = useState<Record<string, boolean>>({});
    const [formFor, setFormFor] = useState<CommerceMode | null>(null);
    const [form, setForm] = useState<ProductFormState>(blankProductForm);
    const [categoryFor, setCategoryFor] = useState<CommerceMode | null>(null);
    const [categoryDraft, setCategoryDraft] = useState('');
    const [apiOpen, setApiOpen] = useState(false);
    const [dataOpen, setDataOpen] = useState(false);
    const [featureEnabled, setFeatureEnabled] = useState(() => isNuomiCommerceFeatureEnabled());
    const [ai, setAi] = useState<AiSettings>(() => readAi(apiConfig));
    const [loadingAi, setLoadingAi] = useState(false);
    const [directShop, setDirectShop] = useState<DirectForm>(blankDirect);
    const [directFood, setDirectFood] = useState<DirectForm>(blankDirect);
    const [detailProduct, setDetailProduct] = useState<Product | null>(null);
    const [editTarget, setEditTarget] = useState<{ mode: CommerceMode; product: Product } | null>(null);
    const [editForm, setEditForm] = useState<ProductEditFormState>({ name: '', price: '', description: '' });
    const [cartSheetOpen, setCartSheetOpen] = useState<CommerceMode | null>(null);
    const actor = userProfile?.name || '我';
    const charName = char?.name || 'TA';

    useEffect(() => { if (open) { setTab(initialMode); setToast(null); setToastLeaving(false); setProducts(read('shopping', char?.id) || defaultProducts); setDelivery(read('delivery', char?.id) || defaultDelivery); setShoppingCustomCats(readCats('shopping', char?.id)); setDeliveryCustomCats(readCats('delivery', char?.id)); setFeatureEnabled(isNuomiCommerceFeatureEnabled()); } }, [open, initialMode, char?.id]);
    useEffect(() => {
        if (!toast) return;
        setToastLeaving(false);
        const fadeTimer = window.setTimeout(() => setToastLeaving(true), 3000);
        const clearTimer = window.setTimeout(() => setToast(null), 3600);
        return () => { window.clearTimeout(fadeTimer); window.clearTimeout(clearTimer); };
    }, [toast]);
    useEffect(() => {
        if (!open || typeof window === 'undefined') return;
        const sync = () => setFeatureEnabled(isNuomiCommerceFeatureEnabled());
        window.addEventListener(NUOMI_COMMERCE_FEATURE_EVENT, sync as EventListener);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(NUOMI_COMMERCE_FEATURE_EVENT, sync as EventListener);
            window.removeEventListener('storage', sync);
        };
    }, [open]);
    useEffect(() => write('shopping', char?.id, products), [products, char?.id]);
    useEffect(() => write('delivery', char?.id, delivery), [delivery, char?.id]);
    useEffect(() => writeCats('shopping', char?.id, shoppingCustomCats), [shoppingCustomCats, char?.id]);
    useEffect(() => writeCats('delivery', char?.id, deliveryCustomCats), [deliveryCustomCats, char?.id]);

    const cats = useMemo(() => ['全部', ...Array.from(new Set([...shoppingCustomCats, ...products.map(p => p.category).filter(Boolean)]))], [products, shoppingCustomCats]);
    const dcats = useMemo(() => ['全部', ...Array.from(new Set([...deliveryCustomCats, ...delivery.map(p => p.category).filter(Boolean)]))], [delivery, deliveryCustomCats]);
    const visible = useMemo(() => category === '全部' ? products : products.filter(p => p.category === category), [products, category]);
    const dvisible = useMemo(() => deliveryCategory === '全部' ? delivery : delivery.filter(p => p.category === deliveryCategory), [delivery, deliveryCategory]);
    const selected = products.find(p => p.id === selectedId) || visible[0] || products[0];
    const ssum = summary(products, cart);
    const dsum = summary(delivery, deliveryCart);
    const dtotal = dsum.total;
    const shoppingCartQty = ssum.lines.reduce((sum, line) => sum + line.qty, 0);
    const deliveryCartQty = dsum.lines.reduce((sum, line) => sum + line.qty, 0);
    const activeCartQty = tab === 'shopping' ? shoppingCartQty : deliveryCartQty;

    const addLine = (setter: React.Dispatch<React.SetStateAction<CartLine[]>>, product: Product, variationId?: string) => setter(prev => {
        const next = { productId: product.id, variationId, qty: 1 };
        const k = lineKey(next);
        return prev.some(l => lineKey(l) === k) ? prev.map(l => lineKey(l) === k ? { ...l, qty: l.qty + 1 } : l) : [...prev, next];
    });
    const inc = (setter: React.Dispatch<React.SetStateAction<CartLine[]>>, line: CartLine) => setter(prev => prev.map(l => lineKey(l) === lineKey(line) ? { ...l, qty: l.qty + 1 } : l));
    const dec = (setter: React.Dispatch<React.SetStateAction<CartLine[]>>, line: CartLine) => setter(prev => prev.flatMap(l => lineKey(l) !== lineKey(line) ? [l] : l.qty <= 1 ? [] : [{ ...l, qty: l.qty - 1 }]));

    const makePrompt = (kind: CommerceCardKind, items: CommerceCardItem[], total: number, orderNote?: string) => {
        const detail = items.map(i => `${i.name}${i.variationName ? `（${i.variationName}）` : ''}×${i.qty}，单价${money(i.price)}，详情页：${i.description || '无'}`).join('；');
        const natural = `请你作为${charName}，结合人设、关系和上下文自然回应。不要规定感谢；适合感谢就感谢，不适合可以吐槽、害羞、拒绝、转移话题或做其他符合人设的反应。不要机械复述卡片。`;
        if (kind === 'delivery_request') return `[外卖代付请求] ${actor}向你发起请求：${detail}。金额${money(total)}。备注：${orderNote || '无'}。你可以选择支付、暂不支付、拒绝或提出别的建议，请明确表达你的选择。${natural}`;
        if (kind === 'shopping_gift') return `[购物礼物] ${actor}已经买给你：${detail}。合计${money(total)}。购物备注：${orderNote || '无'}。这不是代付请求，用户已支付。${natural}`;
        if (kind === 'delivery_gift') return `[外卖礼物] ${actor}已经为你点了：${detail}。合计${money(total)}。备注：${orderNote || '无'}。这不是代付请求，用户已支付。${natural}`;
        if (kind === 'shopping_receipt') return `[购物小票] ${actor}展示了一张小票：${detail}。合计${money(total)}。购物备注：${orderNote || '无'}。${natural}`;
        if (kind === 'char_purchase_to_user') return `[你给用户买东西] 聊天里出现一张卡片，表示你给${actor}买了：${detail}。合计${money(total)}。备注：${orderNote || '无'}。请承接这个行为自然说话。${natural}`;
        if (kind === 'char_delivery_to_user') return `[你给用户点外卖] 聊天里出现一张卡片，表示你给${actor}点了：${detail}。合计${money(total)}。备注：${orderNote || '无'}。请承接这个行为自然说话。${natural}`;
        return natural;
    };
    const card = (kind: CommerceCardKind, mode: CommerceMode, items: CommerceCardItem[], total: number, orderNote?: string): CommerceCardPayload => {
        const titles: Record<CommerceCardKind, string> = { shopping_receipt: '购物小票', shopping_gift: `送给${charName}的购物礼物`, delivery_request: '外卖代付请求', delivery_gift: `给${charName}点的外卖`, delivery_paid: `${charName}已完成支付`, delivery_rejected: `${charName}已拒绝支付`, char_delivery_to_user: `${charName}给${actor}点了外卖`, char_purchase_to_user: `${charName}给${actor}买了东西` };
        const status = kind === 'delivery_request' ? 'pending' : kind === 'delivery_paid' ? 'paid' : kind === 'delivery_rejected' ? 'rejected' : kind.includes('gift') || kind.startsWith('char_') ? 'gifted' : 'receipt';
        return { version: 2, id: id('commerce-card'), kind, title: titles[kind], mode, actorName: kind.startsWith('char_') ? charName : actor, targetName: kind.startsWith('char_') ? actor : charName, charName, userName: actor, items, total, note: orderNote, status, createdAt: Date.now(), aiPrompt: makePrompt(kind, items, total, orderNote) };
    };
    const sendCard = async (c: CommerceCardPayload, role: 'user' | 'assistant' = 'user', msg = '卡片已发送') => onSendToChat?.({ card: c, role, triggerAI: false, toast: msg, metadata: { commerceCard: c } });
    const toggleFeature = () => {
        const next = !featureEnabled;
        setNuomiCommerceFeatureEnabled(next);
        setFeatureEnabled(next);
        setToast(next ? '购物中心已打开' : '购物中心已关闭');
    };

    const checkout = async (gift: boolean) => { if (!ssum.lines.length) return setToast('请先选择商品'); const c = card(gift ? 'shopping_gift' : 'shopping_receipt', 'shopping', cardItems(ssum), ssum.total, note); await sendCard(c, 'user', gift ? '礼物卡片已发送' : '小票卡片已发送'); setCart([]); setNote(''); setToast(gift ? '已送给TA；需要TA回应时，请点聊天窗右上角原版触发AI' : '小票已弹出卡片'); onClose(); };
    const deliveryItems = (): CommerceCardItem[] => cardItems(dsum).map(i => ({ ...i, description: undefined }));
    const requestFood = async () => { const items = deliveryItems(); if (!items[0]?.name || dtotal <= 0) return setToast('请先从外卖菜单里选择商品'); await sendCard(card('delivery_request', 'delivery', items, dtotal, deliveryNote), 'user', '外卖请求卡片已发送'); setDeliveryCart([]); setDeliveryNote(''); setToast('已发送外卖请求卡片'); onClose(); };
    const giftFood = async () => { const items = deliveryItems(); if (!items[0]?.name || dtotal <= 0) return setToast('请先从外卖菜单里选择商品'); await sendCard(card('delivery_gift', 'delivery', items, dtotal, deliveryNote), 'user', '外卖礼物卡片已发送'); setDeliveryCart([]); setDeliveryNote(''); setToast('已为TA点单；需要TA回应时，请点聊天窗右上角原版触发AI'); onClose(); };
    const charBuyFromCart = async () => { if (!ssum.lines.length) return setToast('请先选择商品'); const c = card('char_purchase_to_user', 'shopping', cardItems(ssum), ssum.total, note); await sendCard(c, 'assistant', 'TA主动购买卡片已弹出'); setCart([]); setNote(''); setToast('已弹出TA主动购买卡片'); onClose(); };
    const charDeliveryFromCart = async () => { const items = deliveryItems(); if (!items[0]?.name || dtotal <= 0) return setToast('请先从外卖菜单里选择商品'); await sendCard(card('char_delivery_to_user', 'delivery', items, dtotal, deliveryNote), 'assistant', 'TA主动外卖卡片已弹出'); setDeliveryCart([]); setDeliveryNote(''); setToast('已弹出TA主动外卖卡片'); onClose(); };
    const direct = async (mode: CommerceMode) => { const f = mode === 'shopping' ? directShop : directFood; const total = Number(f.amount) || 0; if (!f.name.trim() || total <= 0) return setToast('请填写名称和金额'); const item: CommerceCardItem = { name: f.name.trim(), qty: 1, price: total, subtotal: total, description: mode === 'shopping' ? '角色主动购买的物品，不要求来自商品库。' : undefined, emoji: mode === 'shopping' ? '🎁' : '🥡' }; await sendCard(card(mode === 'shopping' ? 'char_purchase_to_user' : 'char_delivery_to_user', mode, [item], total, f.note), 'assistant', 'TA主动卡片已弹出'); mode === 'shopping' ? setDirectShop(blankDirect) : setDirectFood(blankDirect); setToast('已弹出角色主动卡片'); onClose(); };


    const startManualAdd = (mode: CommerceMode) => {
        const active = mode === 'shopping' ? category : deliveryCategory;
        if (!active || active === '全部') {
            setToast('请先切换到具体分类，或点击“＋分类”新建分类');
            return;
        }
        setForm({ ...blankProductForm, category: active, emoji: mode === 'delivery' ? '🥡' : '🎁' });
        setFormFor(mode);
    };
    const openCategorySheet = (mode: CommerceMode) => { setCategoryDraft(''); setCategoryFor(mode); };
    const saveCategory = () => {
        const name = categoryDraft.trim();
        if (!name || name === '全部') { setToast('请输入有效分类名称'); return; }
        if (categoryFor === 'shopping') { setShoppingCustomCats(prev => prev.includes(name) ? prev : [...prev, name]); setCategory(name); }
        else if (categoryFor === 'delivery') { setDeliveryCustomCats(prev => prev.includes(name) ? prev : [...prev, name]); setDeliveryCategory(name); }
        setCategoryFor(null);
        setCategoryDraft('');
        setToast(`已添加分类：${name}`);
    };

    const addManual = () => {
        const price = Number(form.price) || 0; if (!form.name.trim() || price <= 0) return setToast('请填写名称和价格');
        const targetCategory = form.category.trim() || (formFor === 'delivery' ? deliveryCategory : category);
        if (!targetCategory || targetCategory === '全部') return setToast('请先选择或新增一个分类');
        const product: Product = { id: id(formFor === 'delivery' ? 'manual-delivery' : 'manual-product'), name: form.name.trim(), category: targetCategory, price, description: formFor === 'delivery' ? undefined : (form.description.trim() || '用户手动上传的商品。'), emoji: form.emoji.trim() || (formFor === 'delivery' ? '🥡' : '🎁'), image: formFor === 'delivery' ? undefined : (form.image.trim() || undefined), source: 'manual' };
        if (formFor === 'delivery') { setDelivery(prev => [product, ...prev]); setDeliveryCategory(targetCategory); } else { setProducts(prev => [product, ...prev]); setCategory(targetCategory); setSelectedId(product.id); }
        setFormFor(null); setForm(blankProductForm); setToast(`已保存到“${targetCategory}”分类`);
    };
    const startEditProduct = (mode: CommerceMode, product: Product) => {
        setDetailProduct(null);
        setEditTarget({ mode, product });
        setEditForm({ name: product.name, price: String(product.price), description: product.description || '' });
    };
    const saveEditProduct = () => {
        if (!editTarget) return;
        const name = editForm.name.trim();
        const price = Number(editForm.price) || 0;
        if (!name || price <= 0) return setToast('请填写名称和价格');
        const description = editForm.description.trim() || undefined;
        const updater = (p: Product): Product => p.id === editTarget.product.id ? { ...p, name, price, description } : p;
        if (editTarget.mode === 'shopping') setProducts(prev => prev.map(updater));
        else setDelivery(prev => prev.map(updater));
        setEditTarget(null);
        setToast('商品已修改');
    };
    const remove = (mode: CommerceMode, ids: string[]) => { if (!ids.length) return; if (!window.confirm(`确定删除 ${ids.length} 个商品吗？`)) return; if (mode === 'shopping') { setProducts(p => p.filter(x => !ids.includes(x.id))); setCart(c => c.filter(x => !ids.includes(x.productId))); setChecked({}); } else { setDelivery(p => p.filter(x => !ids.includes(x.id))); setDeliveryCart(c => c.filter(x => !ids.includes(x.productId))); setCheckedDelivery({}); } setToast('已删除'); };
    const removeCat = (mode: CommerceMode, cat: string) => {
        if (cat === '全部') return setToast('不能删除“全部”');
        if (!window.confirm(`确定删除分类“${cat}”吗？这个分类下的商品也会一起删除。`)) return;
        if (mode === 'shopping') {
            const ids = products.filter(p => p.category === cat).map(p => p.id);
            setProducts(p => p.filter(x => x.category !== cat)); setCart(c => c.filter(x => !ids.includes(x.productId))); setChecked({}); setShoppingCustomCats(prev => prev.filter(c => c !== cat)); setCategory('全部');
        } else {
            const ids = delivery.filter(p => p.category === cat).map(p => p.id);
            setDelivery(p => p.filter(x => x.category !== cat)); setDeliveryCart(c => c.filter(x => !ids.includes(x.productId))); setCheckedDelivery({}); setDeliveryCustomCats(prev => prev.filter(c => c !== cat)); setDeliveryCategory('全部');
        }
        setToast('分类已删除');
    };
    const doAi = async () => {
        const mode = tab;
        const targetCat = mode === 'shopping' ? category : deliveryCategory;
        setLoadingAi(true);
        try {
            const sourceProducts = mode === 'shopping' ? products : delivery;
            const sourceCats = mode === 'shopping' ? cats : dcats;
            const items = await aiRestock(ai, mode, targetCat, char, recentMessages, sourceProducts, sourceCats);
            if (mode === 'shopping') {
                setProducts(prev => [...items, ...prev]);
                if (targetCat !== '全部') setCategory(targetCat);
            } else {
                setDelivery(prev => [...items, ...prev]);
                if (targetCat !== '全部') setDeliveryCategory(targetCat);
            }
            setToast(targetCat === '全部' ? `${mode === 'delivery' ? '外卖' : '购物'} AI 已补货` : `已为“${targetCat}”补货`);
        } catch (e: any) {
            setToast(e?.message || 'AI补货失败');
        } finally {
            setLoadingAi(false);
        }
    };
    const refreshLocalData = () => {
        setProducts(read('shopping', char?.id) || defaultProducts);
        setDelivery(read('delivery', char?.id) || defaultDelivery);
        setShoppingCustomCats(readCats('shopping', char?.id));
        setDeliveryCustomCats(readCats('delivery', char?.id));
        setAi(readAi(apiConfig));
        setCart([]);
        setDeliveryCart([]);
        setChecked({});
        setCheckedDelivery({});
    };
    const exportCommerceData = () => {
        const data: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('nuomi_commerce_')) continue;
            const raw = localStorage.getItem(k);
            if (raw != null) data[k] = raw;
        }
        const payload = { type: 'nuomi-commerce-data', version: STORAGE_VERSION, exportedAt: new Date().toISOString(), charId: char?.id || null, charName: char?.name || '', data };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nuomi-commerce-${char?.name || 'data'}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setToast('购物中心数据已导出到本地，包含 API Key 和全部预设，请妥善保存');
    };
    const importCommerceData = async (file: File) => {
        try {
            const payload = JSON.parse(await file.text());
            const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
            let count = 0;
            for (const [k, v] of Object.entries(data)) {
                if (typeof k === 'string' && k.startsWith('nuomi_commerce_') && typeof v === 'string') {
                    localStorage.setItem(k, v);
                    count++;
                }
            }
            if (!count) throw new Error('没有识别到购物中心数据');
            refreshLocalData();
            setDataOpen(false);
            setToast(`已导入 ${count} 项购物中心数据`);
        } catch (e: any) {
            setToast(e?.message || '导入失败，请确认文件正确');
        }
    };

    if (!open) return null;
    const productList = tab === 'shopping' ? visible : dvisible;
    const activeCats = tab === 'shopping' ? cats : dcats;
    const activeCat = tab === 'shopping' ? category : deliveryCategory;
    const setActiveCat = tab === 'shopping' ? setCategory : setDeliveryCategory;
    const activeChecked = tab === 'shopping' ? checked : checkedDelivery;
    const setActiveChecked = tab === 'shopping' ? setChecked : setCheckedDelivery;

    return <div className="fixed inset-0 z-[70] bg-slate-900/35 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-3" onMouseDown={onClose}>
        <section className="w-full sm:max-w-[980px] h-[100dvh] sm:h-[800px] sm:max-h-[92vh] rounded-none sm:rounded-[34px] bg-[#f8fafc] border border-white/70 shadow-2xl overflow-hidden flex flex-col" onMouseDown={e => e.stopPropagation()}>
            <header className="px-4 py-3 bg-white flex items-center justify-between gap-3 shrink-0 relative z-10"><div className="flex items-center gap-2 min-w-0"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-100 to-orange-100 text-pink-500 flex items-center justify-center shadow-sm">{tab === 'shopping' ? <Storefront className="w-5 h-5" weight="fill" /> : <BowlFood className="w-5 h-5" weight="fill" />}</div><div className="flex items-center gap-2 min-w-0"><h2 className="text-base font-black text-slate-900 whitespace-nowrap">购物中心</h2><button onClick={toggleFeature} className={`h-8 px-3 rounded-xl text-sm font-black border shrink-0 transition-colors ${featureEnabled ? 'bg-pink-50 text-pink-500 border-pink-200' : 'bg-white text-slate-500 border-slate-200'}`}>{featureEnabled ? '开' : '关'}</button></div></div><div className="flex items-center gap-2"><div className="p-1 rounded-2xl bg-slate-100 flex gap-1"><button onClick={() => setTab('shopping')} className={`h-8 px-3 rounded-xl text-xs font-black ${tab === 'shopping' ? 'bg-white text-pink-500 shadow-sm' : 'text-slate-400'}`}>购物</button><button onClick={() => setTab('delivery')} className={`h-8 px-3 rounded-xl text-xs font-black ${tab === 'delivery' ? 'bg-white text-orange-500 shadow-sm' : 'text-slate-400'}`}>外卖</button></div><button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><X className="w-5 h-5" /></button></div></header>
            {toast && <CommerceToast message={toast} leaving={toastLeaving} className="mx-4 mt-3 shrink-0" />}
            <div className="px-3 sm:px-4 pt-1 pb-3 shrink-0 bg-white"><div className="flex flex-wrap gap-2"><button onClick={() => setApiOpen(true)} className="h-8 px-3 rounded-full text-xs font-black whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200">⚙ API</button><button onClick={() => setDataOpen(true)} className="h-8 px-3 rounded-full text-xs font-black whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200">数据</button><button onClick={doAi} disabled={loadingAi} className="h-8 px-3 rounded-full text-xs font-black whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">{loadingAi ? <ArrowsClockwise className="w-3.5 h-3.5 animate-spin" /> : <Sparkle className="w-3.5 h-3.5" weight="fill" />}AI补货</button><button onClick={() => setManage(v => !v)} className="h-8 px-3 rounded-full text-xs font-black whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200">{manage ? '完成管理' : '管理'}</button></div></div>
            <div className="p-3 sm:p-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
                <main className="flex flex-col gap-3 overflow-visible">
                    <div className="sticky top-0 z-40 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-[#f8fafc] border-b border-slate-100 shadow-[0_8px_14px_rgba(248,250,252,0.96)]">
                        <div className="flex flex-wrap sm:flex-nowrap gap-2 overflow-visible sm:overflow-x-auto pb-1 shrink-0">
                            <button type="button" onClick={() => setCartSheetOpen(tab)} className={`relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm border ${tab === 'shopping' ? 'bg-pink-50 text-pink-500 border-pink-100' : 'bg-orange-50 text-orange-500 border-orange-100'}`} title={tab === 'shopping' ? '打开购物车' : '打开外卖篮'}>
                                {tab === 'shopping' ? <ShoppingCartSimple className="w-5 h-5" weight="bold" /> : <BowlFood className="w-5 h-5" weight="bold" />}
                                {activeCartQty > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900 text-white text-[10px] font-black flex items-center justify-center leading-none">{activeCartQty > 99 ? '99+' : activeCartQty}</span>}
                            </button>
                            {activeCats.map(c => <button key={c} onClick={() => setActiveCat(c)} className={`h-8 px-3 rounded-full text-xs font-black whitespace-nowrap border ${activeCat === c ? 'bg-slate-900 text-white border-slate-900' : 'bg-white/80 text-slate-500 border-slate-100'}`}>{c}</button>)}
                            <button onClick={() => openCategorySheet(tab)} className="h-8 px-3 rounded-full text-xs font-black whitespace-nowrap bg-white text-pink-500 border border-pink-100">＋分类</button>
                        </div>
                        {manage && <div className="flex flex-wrap sm:flex-nowrap gap-2 overflow-visible sm:overflow-x-auto pt-2"><button onClick={() => remove(tab, Object.keys(activeChecked).filter(k => activeChecked[k]))} className="h-8 px-3 rounded-full bg-rose-50 text-rose-500 border border-rose-100 text-xs font-black whitespace-nowrap">删除选中</button><button onClick={() => removeCat(tab, activeCat)} className="h-8 px-3 rounded-full bg-rose-50 text-rose-500 border border-rose-100 text-xs font-black whitespace-nowrap">删除当前分类</button></div>}
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 overflow-visible content-start pb-3">{activeCat !== '全部' && <AddProductCard mode={tab} category={activeCat} onAdd={() => startManualAdd(tab)} />}{productList.map(p => <ProductCard key={p.id} mode={tab} product={p} manage={manage} checked={!!activeChecked[p.id]} onCheck={() => setActiveChecked(prev => ({ ...prev, [p.id]: !prev[p.id] }))} selected={tab === 'shopping' && selected?.id === p.id} onOpenDetail={() => setDetailProduct(p)} onEdit={() => startEditProduct(tab, p)} onAdd={() => tab === 'shopping' ? addLine(setCart, p) : addLine(setDeliveryCart, p)} onDelete={() => remove(tab, [p.id])} />)}</div>
                </main>
            </div>
        </section>
        {cartSheetOpen === 'shopping' && <CartActionSheet title="购物车" onClose={() => setCartSheetOpen(null)}>
            <Cart products={products} cart={cart} title="购物车" onInc={l => inc(setCart, l)} onDec={l => dec(setCart, l)} onClear={() => setCart([])} />
            <Field label="购物备注（会显示在卡片里）"><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="包装、原因、想说的话……" className={areaClass} /></Field>
            <div className="grid grid-cols-3 gap-2"><button onClick={() => checkout(false)} className="h-11 rounded-2xl bg-white text-slate-700 border border-slate-100 text-[11px] sm:text-xs font-black flex items-center justify-center gap-1"><Receipt className="w-4 h-4" />给TA发小票</button><button onClick={() => checkout(true)} className="h-11 rounded-2xl bg-pink-500 text-white text-[11px] sm:text-xs font-black flex items-center justify-center gap-1"><Gift className="w-4 h-4" weight="fill" />送给TA</button><button onClick={charBuyFromCart} className="h-11 rounded-2xl bg-slate-900 text-white text-[11px] sm:text-xs font-black flex items-center justify-center gap-1"><Gift className="w-4 h-4" weight="fill" />TA主动给我买</button></div>
        </CartActionSheet>}
        {cartSheetOpen === 'delivery' && <CartActionSheet title="外卖篮" onClose={() => setCartSheetOpen(null)}>
            <Cart products={delivery} cart={deliveryCart} title="外卖篮" onInc={l => inc(setDeliveryCart, l)} onDec={l => dec(setDeliveryCart, l)} onClear={() => setDeliveryCart([])} />
            <Field label="备注（会显示在卡片里）"><textarea value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} className={areaClass} placeholder="少冰、不要香菜、配送说明……" /></Field>
            <div className="flex justify-between rounded-2xl bg-white border border-slate-100 px-3 py-2"><span className="text-xs font-bold text-slate-400">当前合计</span><strong className="text-xl text-slate-900">{money(dtotal)}</strong></div>
            <div className="grid grid-cols-3 gap-2"><button onClick={giftFood} className="h-11 rounded-2xl bg-orange-500 text-white text-[11px] sm:text-xs font-black flex items-center justify-center gap-1"><Gift className="w-4 h-4" />为TA点单</button><button onClick={requestFood} className="h-11 rounded-2xl bg-white text-slate-700 border border-slate-100 text-[11px] sm:text-xs font-black flex items-center justify-center gap-1"><PaperPlaneTilt className="w-4 h-4" />发起请求</button><button onClick={charDeliveryFromCart} className="h-11 rounded-2xl bg-slate-900 text-white text-[11px] sm:text-xs font-black flex items-center justify-center gap-1"><Gift className="w-4 h-4" />TA主动给我点外卖</button></div>
        </CartActionSheet>}
        {formFor && <ProductFormSheet mode={formFor} form={form} setForm={setForm} onClose={() => setFormFor(null)} onSave={addManual} />}
        {categoryFor && <CategorySheet mode={categoryFor} value={categoryDraft} setValue={setCategoryDraft} onClose={() => setCategoryFor(null)} onSave={saveCategory} />}
        {apiOpen && <ApiSheet ai={ai} setAi={setAi} onClose={() => setApiOpen(false)} />}
        {dataOpen && <DataSheet onClose={() => setDataOpen(false)} onExport={exportCommerceData} onImport={importCommerceData} />}
        {detailProduct && <ProductDetailSheet product={detailProduct} onClose={() => setDetailProduct(null)} />}
        {editTarget && <ProductEditSheet mode={editTarget.mode} product={editTarget.product} form={editForm} setForm={setEditForm} onClose={() => setEditTarget(null)} onSave={saveEditProduct} />}
    </div>;
}


function DataSheet({ onClose, onExport, onImport }: { onClose: () => void; onExport: () => void; onImport: (file: File) => void }) {
    const [fileName, setFileName] = useState('');
    return <div className="fixed inset-0 z-[80] bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}>
        <div className="w-full sm:max-w-md rounded-t-[30px] sm:rounded-[30px] bg-white p-4 shadow-2xl" onMouseDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3"><h3 className="font-black text-slate-900">购物中心数据管理</h3><button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><X className="w-5 h-5" /></button></div>
            <div className="space-y-3">
                <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-[12px] leading-relaxed text-amber-700 font-bold">导出文件只会下载到你的本地设备；内容包含购物/外卖商品、分类、AI 补货设置、API Key 和全部 API 预设。请不要把这个文件上传到公开网络。</div>
                <button type="button" onClick={onExport} className="w-full h-11 rounded-2xl bg-slate-900 text-white text-sm font-black">导出购物/外卖数据</button>
                <label className="block">
                    <span className="mb-1.5 block text-[12px] font-black text-slate-500">导入购物/外卖数据</span>
                    <input type="file" accept="application/json,.json" className="block w-full text-xs text-slate-500 file:mr-3 file:h-10 file:rounded-2xl file:border-0 file:bg-pink-50 file:px-4 file:text-xs file:font-black file:text-pink-500" onChange={e => { const file = e.target.files?.[0]; if (!file) return; setFileName(file.name); onImport(file); }} />
                </label>
                {fileName && <div className="text-[11px] text-slate-400">已选择：{fileName}</div>}
            </div>
        </div>
    </div>;
}


function CategorySheet({ mode, value, setValue, onClose, onSave }: { mode: CommerceMode; value: string; setValue: (v: string) => void; onClose: () => void; onSave: () => void }) {
    return <div className="fixed inset-0 z-[80] bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}>
        <div className="w-full sm:max-w-md rounded-t-[30px] sm:rounded-[30px] bg-white p-4 shadow-2xl" onMouseDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3"><h3 className="font-black text-slate-900">新增{mode === 'delivery' ? '外卖' : '购物'}分类</h3><button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><X className="w-5 h-5" /></button></div>
            <div className="space-y-3"><Field label="分类名称"><input value={value} onChange={e => setValue(e.target.value)} className={inputClass} placeholder={mode === 'delivery' ? '例如：甜品饮料' : '例如：生活用品'} autoFocus /></Field><button onClick={onSave} className="w-full h-11 rounded-2xl bg-slate-900 text-white text-sm font-black">保存分类</button></div>
        </div>
    </div>;
}
function DirectBox({ mode, form, setForm, onSend }: { mode: CommerceMode; form: DirectForm; setForm: React.Dispatch<React.SetStateAction<DirectForm>>; onSend: () => void }) {
    const delivery = mode === 'delivery';
    return <div className="rounded-[28px] border border-slate-100 bg-white shadow-sm p-3 space-y-2"><div className="text-xs font-black text-slate-800">{delivery ? 'TA 主动给我点外卖' : 'TA 主动给我买'}</div><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputClass} placeholder={delivery ? '外卖名，可不在外卖库' : '商品名，可不在商品库'} /><input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={inputClass} type="number" placeholder="金额" /><input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className={inputClass} placeholder="备注" /><button onClick={onSend} className="w-full h-10 rounded-2xl bg-slate-900 text-white text-xs font-black">{delivery ? '弹外卖卡片' : '弹购买卡片'}</button></div>;
}
function ProductFormSheet({ mode, form, setForm, onClose, onSave }: { mode: CommerceMode; form: ProductFormState; setForm: React.Dispatch<React.SetStateAction<ProductFormState>>; onClose: () => void; onSave: () => void }) {
    const delivery = mode === 'delivery';
    return <div className="fixed inset-0 z-[80] bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}><div className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-t-[30px] sm:rounded-[30px] bg-white p-4 shadow-2xl" onMouseDown={e => e.stopPropagation()}><div className="flex justify-between items-center mb-3"><h3 className="font-black text-slate-900">手动上传{delivery ? '外卖' : '商品'}到“{form.category || '未选择'}”</h3><button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><X className="w-5 h-5" /></button></div><div className="space-y-3"><Field label="名称"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputClass} /></Field><Field label="价格"><input value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} type="number" className={inputClass} /></Field>{delivery && <Field label="Emoji（商品主图）"><input value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))} className={inputClass} placeholder="例如：🍔" /></Field>}{!delivery && <><Field label="详情页"><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={areaClass} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Emoji"><input value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))} className={inputClass} /></Field><Field label="图片URL"><input value={form.image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))} className={inputClass} /></Field></div><Field label="上传本地图片" hint="可选，会保存到浏览器本地。"><input type="file" accept="image/*" className="text-xs" onChange={e => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => setForm(f => ({ ...f, image: String(r.result || '') })); r.readAsDataURL(file); }} /></Field></>}<button onClick={onSave} className="w-full h-11 rounded-2xl bg-slate-900 text-white text-sm font-black">保存到当前分类</button></div></div></div>;
}
function ApiSheet({ ai, setAi, onClose }: { ai: AiSettings; setAi: React.Dispatch<React.SetStateAction<AiSettings>>; onClose: () => void }) {
    const [draft, setDraft] = useState<AiSettings>(ai);
    const [selectedPresetId, setSelectedPresetId] = useState('');
    const [status, setStatus] = useState<string | null>(null);
    const [statusLeaving, setStatusLeaving] = useState(false);
    useEffect(() => {
        if (!status) return;
        setStatusLeaving(false);
        const fadeTimer = window.setTimeout(() => setStatusLeaving(true), 3000);
        const clearTimer = window.setTimeout(() => setStatus(null), 3600);
        return () => { window.clearTimeout(fadeTimer); window.clearTimeout(clearTimer); };
    }, [status]);
    const applyPreset = (presetId: string) => {
        setSelectedPresetId(presetId);
        const p = draft.presets.find(x => x.id === presetId);
        if (p) setDraft(s => ({ ...s, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, presetName: p.name }));
    };
    const persist = (next: AiSettings, msg: string) => {
        setDraft(next);
        setAi(next);
        saveAi(next);
        setStatus(msg);
    };
    const deletePreset = () => {
        if (!selectedPresetId) return;
        const removed = draft.presets.find(p => p.id === selectedPresetId);
        const next = { ...draft, presets: draft.presets.filter(p => p.id !== selectedPresetId), presetName: removed?.name === draft.presetName ? '' : draft.presetName };
        setSelectedPresetId('');
        persist(next, '预设已删除');
    };
    const saveCurrent = () => persist(draft, 'API 设置已保存');
    const savePreset = () => {
        const name = draft.presetName.trim() || `预设${draft.presets.length + 1}`;
        const next = { ...draft, presetName: name, presets: [{ id: id('preset'), name, baseUrl: draft.baseUrl, apiKey: draft.apiKey, model: draft.model }, ...draft.presets.filter(p => p.name !== name)] };
        persist(next, '预设已保存');
    };
    const doPull = async () => {
        try {
            const models = await pullModels(draft);
            setDraft(s => ({ ...s, models, model: s.model || models[0] }));
            setStatus(`已拉取 ${models.length} 个模型，请选择后点“保存”`);
        } catch (e: any) {
            setStatus(e?.message || '拉取模型失败');
        }
    };
    return <div className="fixed inset-0 z-[80] bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}><div className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-[30px] sm:rounded-[30px] bg-white p-4 shadow-2xl" onMouseDown={e => e.stopPropagation()}><div className="flex justify-between items-center mb-3"><h3 className="font-black text-slate-900">购物中心 AI 补货 API</h3><button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><X className="w-5 h-5" /></button></div>{status && <CommerceToast message={status} leaving={statusLeaving} className="mb-3" />}<div className="space-y-3"><div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2"><Field label="预设"><select value={selectedPresetId} onChange={e => applyPreset(e.target.value)} className={inputClass}><option value="">选择预设</option>{draft.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><button onClick={deletePreset} disabled={!selectedPresetId} className="h-10 sm:self-end px-3 rounded-2xl bg-rose-50 text-rose-500 border border-rose-100 text-xs font-black disabled:opacity-40 whitespace-nowrap">删除预设</button></div><Field label="URL"><input value={draft.baseUrl} onChange={e => setDraft(s => ({ ...s, baseUrl: e.target.value }))} className={inputClass} placeholder="例如：https://api.openai.com/v1" /></Field><Field label="API Key"><input value={draft.apiKey} onChange={e => setDraft(s => ({ ...s, apiKey: e.target.value }))} className={inputClass} placeholder="sk-..." /></Field><div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2"><Field label="模型"><select value={draft.model} onChange={e => setDraft(s => ({ ...s, model: e.target.value }))} className={inputClass}><option value="">请选择模型</option>{draft.models.map(m => <option key={m} value={m}>{m}</option>)}{draft.model && !draft.models.includes(draft.model) && <option value={draft.model}>{draft.model}</option>}</select></Field><button onClick={doPull} className="h-10 sm:self-end px-3 rounded-2xl bg-pink-50 text-pink-500 border border-pink-100 text-xs font-black whitespace-nowrap">拉取模型</button></div><Field label="预设名称"><input value={draft.presetName} onChange={e => setDraft(s => ({ ...s, presetName: e.target.value }))} className={inputClass} placeholder="例如：补货API" /></Field><Field label={`AI 补货参考最近聊天：${draft.contextMessageCount} 条`} hint="范围 0-100；每条最多读取 180 字。0 表示不参考聊天记录，只参考人设、世界书、分类和已有商品。"><input type="range" min={0} max={100} step={1} value={draft.contextMessageCount} onChange={e => setDraft(s => ({ ...s, contextMessageCount: Number(e.target.value) }))} className="w-full" /></Field><div className="grid grid-cols-2 gap-2"><button onClick={saveCurrent} className="h-11 rounded-2xl bg-slate-900 text-white text-xs font-black">保存</button><button onClick={savePreset} className="h-11 rounded-2xl bg-pink-50 text-pink-500 border border-pink-100 text-xs font-black">保存预设</button></div><p className="text-[11px] text-slate-400 leading-relaxed">填写内容不会自动保存；只有点击“保存”或“保存预设”后才会写入本地。</p></div></div></div>;
}
