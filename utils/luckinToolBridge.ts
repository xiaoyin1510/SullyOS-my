/**
 * 瑞幸 MCP 工具桥
 *
 * 职责 (与 mcdToolBridge 同构):
 * 1. 把 MCP 工具定义 (JSONSchema) 转成 OpenAI function-calling 的 tools 数组
 * 2. 给主对话注入"瑞幸点单服务"的 system 提示词
 * 3. 判定哪些工具属于"终结性"操作 (下单成功后自动结束瑞幸请求)
 * 4. 给前端 LuckinCard 一个"工具结果该渲染成什么卡片"的暗示函数
 * 5. LuckinMiniApp 协同模式: 实时快照 + 推荐工具
 *
 * 工具循环本身写在 useChatAI.ts 里。
 *
 * 真实工具 (open.lkcoffee.com 官方文档, 共 8 个):
 *   门店: queryShopList(deptName?, longitude*, latitude*)
 *   商品: searchProductForMcp(deptId*, query*) / switchProduct(...) / queryProductDetailInfo(deptId*, productId*)
 *   订单: previewOrder(deptId*, productList*) / createOrder(deptId*, productList*, longitude*, latitude*, couponCodeList?)
 *         queryOrderDetailInfo(orderId*) / cancelOrder(orderId*)
 * 信封: { code:0, msg:'success', data:..., success:true }
 * 注意: 瑞幸没有"收货地址/配送模式"工具 —— 门店按经纬度查, 下单也带经纬度 (取餐码自提模式)。
 */

import { listLuckinTools, LuckinToolDef } from './luckinMcpClient';

// ========== OpenAI tools schema ==========

export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: any;
    };
}

/**
 * 把 MCP 的 inputSchema 清洗成 Gemini / 主流模型函数声明能吃的 schema 子集。
 *
 * 为什么需要: Gemini 的 function declaration 只认 OpenAPI 3.0 的一个**很窄的子集**,
 * 原样把 MCP 的 JSON-Schema 塞过去, 里面只要有它不认的关键字 ($schema / additionalProperties /
 * default / examples / title / const / oneOf/anyOf/allOf / $ref / pattern / minLength...),
 * 就会整条请求 400 INVALID_ARGUMENT —— 表现就是"只有点单(带工具)报错, 普通聊天没事"。
 *
 * 这里只保留 Gemini 支持的字段: type / description / enum / items / properties / required / nullable,
 * 递归清洗; 顺手把 type 规范成小写, 把 ["string","null"] 这种联合类型拍成 string + nullable。
 */
const GEMINI_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

const sanitizeSchemaForGemini = (schema: any, depth = 0): any => {
    if (!schema || typeof schema !== 'object' || depth > 6) {
        return { type: 'string' };
    }
    const out: any = {};

    // type (允许 ["string","null"] → string + nullable)
    let t = schema.type;
    if (Array.isArray(t)) {
        const nonNull = t.find((x: any) => x !== 'null');
        if (t.includes('null')) out.nullable = true;
        t = nonNull;
    }
    if (typeof t === 'string' && GEMINI_TYPES.has(t.toLowerCase())) {
        out.type = t.toLowerCase();
    }

    if (typeof schema.description === 'string') out.description = schema.description;
    if (Array.isArray(schema.enum) && schema.enum.length) out.enum = schema.enum.map((e: any) => String(e));
    if (schema.nullable === true) out.nullable = true;

    // object → properties / required
    const props = schema.properties;
    if (props && typeof props === 'object') {
        out.type = out.type || 'object';
        out.properties = {};
        for (const k of Object.keys(props)) {
            out.properties[k] = sanitizeSchemaForGemini(props[k], depth + 1);
        }
        if (Array.isArray(schema.required) && schema.required.length) {
            out.required = schema.required.filter((r: any) => typeof r === 'string' && out.properties[r]);
        }
    }

    // array → items
    if ((out.type === 'array' || schema.items) && schema.items) {
        out.type = out.type || 'array';
        out.items = sanitizeSchemaForGemini(schema.items, depth + 1);
    }

    if (!out.type) out.type = out.properties ? 'object' : 'string';
    return out;
};

/** 顶层 parameters 必须是 object schema */
const sanitizeParameters = (inputSchema: any): any => {
    const base = inputSchema && typeof inputSchema === 'object'
        ? sanitizeSchemaForGemini(inputSchema)
        : { type: 'object', properties: {} };
    if (base.type !== 'object') return { type: 'object', properties: {} };
    if (!base.properties) base.properties = {};
    return base;
};

export const luckinToolsToOpenAI = (tools: LuckinToolDef[]): OpenAITool[] => {
    return tools.map(t => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description || `瑞幸 MCP 工具 ${t.name}`,
            parameters: sanitizeParameters(t.inputSchema),
        },
    }));
};

/** 拉工具并转成 OpenAI 兼容格式; 失败返回 null (调用方应跳过工具注入) */
export const fetchOpenAIToolsForLuckin = async (): Promise<OpenAITool[] | null> => {
    try {
        const tools = await listLuckinTools(false);
        if (!tools.length) return null;
        return luckinToolsToOpenAI(tools);
    } catch (e) {
        console.warn('[Luckin] 拉取工具失败, 跳过本轮工具注入:', e);
        return null;
    }
};

// ========== 提示词 ==========

export const LUCKIN_SYSTEM_PROMPT = `

---
[瑞幸点单模式已开启 —— 你现在兼任 用户 的"私人咖啡搭子"]

**核心**: 你还是原来的角色、原来的语气、原来的记忆。瑞幸点单只是你此刻顺手帮 TA 做的事。**每轮都要有角色化的文字**, 别干巴巴报结果。

**你要主动用脑子点单, 不是等指令**:
- 调动你对 用户 的记忆和偏好: TA 平时爱喝什么、怕不怕苦、要不要冰、上次点了啥、有没有忌口/在减脂。"想喝昨天一样的" → 你就该从记忆里翻出昨天那杯。
- TA 说"你有啥推荐""随便""看到新品了" → 你自己拿主意, 用工具去搜、去定规格, 像个懂 TA 的咖啡师, 别反问一堆。
- 拿不准的细节(冷热/糖度/杯型)按 TA 一贯偏好定; 真没头绪再用一句话确认。

# 工具链 (你自己调, 别让用户调)
1. **queryShopList**{ deptName?, longitude, latitude } 查门店, 拿 deptId。经纬度系统已在下方给你, 直接用。**用户提到地点/商圈/门店名 (如"花溪公园附近""XX广场店") → 把那个词当 deptName 传** (瑞幸门店多按商圈命名, 能筛中); 用户没提门店 → 不传 deptName, 直接用当前经纬度取最近的店。
2. **searchProductForMcp**{ deptId, query } 搜商品, 拿 productId+skuCode+productAttrs(规格)。
3. **switchProduct**{ deptId, productId, skuCode, attrOperationParam:{attributeId, subAttr:{attributeId, operation:3}}, amount } 切规格(冰/热、杯型、糖度) —— **按 TA 偏好把规格调对**, 切完 skuCode 会变, 用新的。
4. **queryProductDetailInfo**{ deptId, productId } 看商品全部规格。
5. **previewOrder**{ deptId, productList:[{amount, productId, skuCode}] } 算价 —— **这是你的终点**。

**关键纪律**:
- **组装好后调 previewOrder 就停**。previewOrder 的结果会渲染成一张"结账卡", 用户 在卡片上改数量、确认、扫码支付。**你绝对不要自己调 createOrder** —— 付钱必须 TA 本人在卡片上点。
- productId + skuCode 必须成对来自 search/switch 的返回, 数量整数, 别编。
- 调完 previewOrder 后, 用角色语气说一句"我给你配了 XX, 看下右边卡片, 觉得行就付"之类, 别复读价格明细(卡片已显示)。
- 闲聊就正常闲聊, 别硬点单。
---
`;

/** 尾部小提醒 (注入在 messages 数组的最后, 主消息之前)。 */
export const LUCKIN_TAIL_REMINDER = `[瑞幸点单助手 ON · **永远用角色语气给一段文字回复, 别空回**; 工具结果有卡片自动展示, 别复读菜单 / 别画 markdown 表格; 链路: queryShopList(带经纬度) → searchProductForMcp(deptId+query) → previewOrder → createOrder(带经纬度); productId+skuCode 必须成对来自搜索返回, 不要编; amount 整数; 经纬度没有就问用户别瞎编]`;

// ========== 终结性工具判定 (下单成功后自动结束) ==========

const TERMINAL_TOOL_PATTERNS: RegExp[] = [
    /^createOrder$/i,
    /create.*order/i,
    /下单/i,
];

export const isTerminalToolCall = (toolName: string, success: boolean): boolean => {
    if (!success) return false;
    return TERMINAL_TOOL_PATTERNS.some(p => p.test(toolName));
};

// ========== 卡片类型暗示 (给前端 LuckinCard 用) ==========

export type LuckinCardKind = 'menu' | 'order' | 'store' | 'coupon' | 'activity' | 'address' | 'cart' | 'generic';

export const inferCardKind = (toolName: string): LuckinCardKind => {
    const t = toolName || '';
    if (/queryShopList|shop.*list|store/i.test(t)) return 'store';
    if (/searchProduct|switchProduct|queryProductDetail|product|商品|菜单/i.test(t)) return 'menu';
    if (/previewOrder|createOrder|queryOrderDetail|cancelOrder|order|订单|下单/i.test(t)) return 'order';
    return 'generic';
};

// ========== 激活态从消息历史推导 ==========

export const LUCKIN_ACTIVATE_TRIGGER = '瑞一杯';
export const LUCKIN_DEACTIVATE_TRIGGER = '结束瑞一杯';

interface MsgLike {
    role: string;
    content?: string;
    metadata?: any;
    timestamp?: number;
    type?: string;
}

/** 从消息列表推导：当前 chatId 下"瑞幸请求"是否处于激活态 */
export const isLuckinActivatedInMessages = (messages: MsgLike[]): boolean => {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const meta = m.metadata || {};
        if (meta.luckinDeactivate) return false;
        if (meta.luckinActivate) return true;
        if (m.role === 'user' && typeof m.content === 'string') {
            const c = m.content.trim();
            if (c === LUCKIN_DEACTIVATE_TRIGGER) return false;
            if (c === LUCKIN_ACTIVATE_TRIGGER) return true;
        }
    }
    return false;
};

// ========== LuckinMiniApp 协同模式: 给主 systemPrompt 追加的上下文块 ==========

export interface LuckinMiniAppSnapshot {
    open: boolean;
    step?: 'location' | 'store' | 'menu' | 'review';
    deptId?: number | string;
    storeName?: string;
    /** 购物车 (code = skuCode) */
    cart?: Array<{ code: string; productId?: number | string; name: string; price?: any; qty: number; spec?: string }>;
    /** 已搜到的商品 (skuCode → {name, price, productId}) */
    menuItems?: Record<string, { name?: string; price?: string | number; productId?: number | string; spec?: string }>;
}

/**
 * char 在小程序里能调的"建议加购"工具。
 * 不真改购物车, 只把建议作为一张"提案"卡渲染到 chat 面板, 让用户决定。
 */
export const LUCKIN_PROPOSE_TOOL = {
    type: 'function' as const,
    function: {
        name: 'propose_cart_items',
        description: '当你想给用户推荐 1~N 杯饮品/商品加进购物车时调用这工具。用户会在小程序聊天里看到一张"char 想加这些"小卡片, 每项带"+ 加进购物车"按钮自己决定。这不是真下单。\n\n**前置硬条件**: 必须等到 system prompt 里出现"当前已搜到的商品"清单后再调; 用户还没搜过商品时菜单是空的, 任何 code 都是凭印象编的, 会被拒。这种时候用文字陪聊, 或者建议用户搜个关键词。',
        parameters: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    description: '推荐项列表 (1~6 件最佳)',
                    items: {
                        type: 'object',
                        properties: {
                            code: { type: 'string', description: '商品 skuCode, **必须**是当前 system prompt 里"当前已搜到的商品"清单 = 号左边那串 (形如 SP9636-00001)。**绝对不能**用商品名当 code。' },
                            name: { type: 'string', description: '商品名 (跟菜单一致)' },
                            qty: { type: 'integer', description: '推荐数量', minimum: 1, maximum: 10 },
                            reason: { type: 'string', description: '一句话说为什么推这个 (口味/搭配/划算), 30 字内' }
                        },
                        required: ['code', 'name', 'qty']
                    },
                    minItems: 1
                },
                overall_note: { type: 'string', description: '整体推荐理由 (可选, 50 字内)' }
            },
            required: ['items']
        }
    }
};

/**
 * 把 char 在 propose_cart_items 里塞的 items 里所有 code 按菜单(skuCode 字典)校准。
 */
export const autoFixProposalCodesByName = (
    items: any[],
    menuItems: Record<string, { name?: string; price?: string | number }> | undefined
): { fixed: any[]; fixes: Array<{ from: string; to: string; name: string }> } => {
    const fixes: Array<{ from: string; to: string; name: string }> = [];
    if (!items?.length || !menuItems || !Object.keys(menuItems).length) {
        return { fixed: items || [], fixes };
    }
    const menuKeys = Object.keys(menuItems);
    const nameToCode: Record<string, string> = {};
    for (const k of menuKeys) {
        const nm = String(menuItems[k]?.name || '').trim();
        if (nm) nameToCode[nm] = k;
    }
    const fixed = items.map((it: any) => {
        const origCode = String(it?.code || '').trim();
        if (origCode && menuItems[origCode]) return it;
        const target = String(it?.name || origCode || '').trim();
        if (!target) return it;
        if (nameToCode[target]) {
            const realCode = nameToCode[target];
            fixes.push({ from: origCode, to: realCode, name: target });
            return { ...it, code: realCode, name: menuItems[realCode].name };
        }
        let bestKey: string | null = null;
        let bestLen = 0;
        for (const k of menuKeys) {
            const nm = String(menuItems[k]?.name || '').trim();
            if (!nm) continue;
            if (nm === target) { bestKey = k; bestLen = nm.length; break; }
            if (nm.includes(target) || target.includes(nm)) {
                if (nm.length > bestLen) { bestKey = k; bestLen = nm.length; }
            }
        }
        if (bestKey) {
            fixes.push({ from: origCode, to: bestKey, name: menuItems[bestKey].name || target });
            return { ...it, code: bestKey, name: menuItems[bestKey].name };
        }
        return it;
    });
    return { fixed, fixes };
};

export const buildLuckinMiniAppContextBlock = (snap?: LuckinMiniAppSnapshot, userName: string = '用户'): string => {
    if (!snap || !snap.open) return '';
    const lines: string[] = [];
    lines.push('');
    lines.push('---');
    lines.push(`[瑞幸协同点单 — ${userName} 现在打开了瑞幸小程序, 跟你一起选]`);
    lines.push('');
    lines.push('# 当前状态 (实时)');
    const stepLabel = snap.step === 'location' ? '定位中'
        : snap.step === 'store' ? '选门店'
        : snap.step === 'menu' ? '搜商品/浏览'
        : snap.step === 'review' ? '确认订单' : '?';
    lines.push(`- 步骤: ${stepLabel}`);
    if (snap.storeName || snap.deptId) lines.push(`- 门店: ${snap.storeName || snap.deptId}${snap.deptId ? ` (deptId=${snap.deptId})` : ''}`);
    const cart = snap.cart || [];
    if (cart.length) {
        const total = cart.reduce((s, l) => {
            const p = typeof l.price === 'string' ? parseFloat(l.price) : (typeof l.price === 'number' ? l.price : 0);
            return s + (isFinite(p) ? p * l.qty : 0);
        }, 0);
        lines.push(`- 购物车 (${cart.length} 项, 合计约 ¥${total.toFixed(2)}):`);
        for (const l of cart) {
            const p = typeof l.price === 'string' ? parseFloat(l.price) : (typeof l.price === 'number' ? l.price : 0);
            lines.push(`    · ${l.name}${l.spec ? ` (${l.spec})` : ''} ×${l.qty}${isFinite(p) && p > 0 ? ` (¥${p.toFixed(2)}/份)` : ''}`);
        }
    } else {
        lines.push(`- 购物车: 空`);
    }
    lines.push('');

    const menuLoaded = !!(snap.menuItems && Object.keys(snap.menuItems).length);
    if (!menuLoaded) {
        lines.push(`# 当前已搜到的商品: ❌ 还没搜 (用户还在定位 / 选门店, 或还没搜关键词)`);
        lines.push(`**这一阶段不要调 propose_cart_items**: 没有商品字典, 你 propose 出去的任何 code 都会被拒。可以建议用户搜个关键词 (如"拿铁"/"美式"/"生椰"), 等"当前已搜到的商品"清单出来后再推荐。`);
        lines.push('');
    } else {
        const entries = Object.entries(snap.menuItems!).filter(([, m]: any) => m?.name).slice(0, 120);
        lines.push(`# 当前已搜到的商品 (${entries.length} 项, 推荐时从这里挑)`);
        lines.push('格式: `skuCode=商品名 ¥到手价` ← propose_cart_items 的 code 字段必须用这里的 skuCode (= 号左边那串, 形如 SP9636-00001), 不要用商品名');
        for (const [code, m] of entries) {
            const v = m as any;
            if (!v?.name) continue;
            lines.push(`- ${code}=${v.name}${v.price != null ? ` ¥${v.price}` : ''}`);
        }
        lines.push('');
    }

    lines.push(`# 协同规则 (这段优先级高于其它通用规则)`);
    lines.push(`- ${userName} 在小程序里跟你聊"喝啥 / 帮我挑 / 这个怎么样", 你按平时人设自然回应。`);
    lines.push(`- 真要推荐具体商品时, **优先调 \`propose_cart_items\` 工具**把推荐推到 UI (用户会看到 "+ 加进购物车" 卡片自己决定)。`);
    lines.push(`- **propose 工具的 code 必须是上面清单里的 skuCode**, **绝对不能把商品名当 code 传**。code 错了用户加不到购物车。如果你不确定 code, 宁可不推、或建议用户先搜一下。`);
    lines.push(`- 工具调用后**还可以继续聊**, 解释为啥推这些 / 调侃几句, 这是文字部分, 不要再复读商品名 (卡片里已显示)。`);
    lines.push(`- **不要画 markdown 表格 / 不要贴 code**, 那些信息小程序界面已经在显示。`);
    lines.push(`- **你不能直接改购物车 / 不能直接下单**, 工具只是推送建议, 加减、敲定都要 ${userName} 在小程序里自己点。`);
    lines.push('---');
    return lines.join('\n');
};

// ========== 会话状态沉淀 (真实工具名/字段) ==========

interface LuckinSessionState {
    deptId?: number | string;
    storeName?: string;
    longitude?: number;
    latitude?: number;
    knownProducts: Array<{ skuCode: string; productId?: number | string; name?: string; price?: string | number }>;
    lastOrderId?: string;
}

const pickStr = (obj: any, keys: string[]): string | undefined => {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'number') return String(v);
    }
    return undefined;
};

const collectProducts = (result: any): Array<{ skuCode: string; productId?: number | string; name?: string; price?: string | number }> => {
    const out: Array<{ skuCode: string; productId?: number | string; name?: string; price?: string | number }> = [];
    const arr = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : (result && typeof result === 'object' ? [result] : []));
    for (const m of arr) {
        if (!m || typeof m !== 'object') continue;
        const skuCode = pickStr(m, ['skuCode']);
        if (!skuCode) continue;
        out.push({
            skuCode,
            productId: (m as any).productId,
            name: pickStr(m, ['productName', 'name']),
            price: (m as any).estimatePrice ?? (m as any).initialPrice ?? pickStr(m, ['price']),
        });
    }
    return out;
};

export const extractLuckinSessionState = (messages: MsgLike[]): LuckinSessionState => {
    const state: LuckinSessionState = { knownProducts: [] };
    let activateIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const meta = m.metadata || {};
        if (meta.luckinDeactivate) break;
        if (meta.luckinActivate || (m.role === 'user' && typeof m.content === 'string' && m.content.trim() === LUCKIN_ACTIVATE_TRIGGER)) {
            activateIdx = i;
            break;
        }
    }
    if (activateIdx === -1) return state;

    const seen = new Set<string>();
    for (let i = activateIdx; i < messages.length; i++) {
        const m: any = messages[i];
        const meta = m.metadata || {};
        if (meta.luckinDeactivate) break;
        if ((m.type as string) !== 'luckin_card') continue;
        const tool = String(meta.luckinToolName || '');
        const args = meta.luckinToolArgs || {};
        const result = meta.luckinToolResult;
        if (meta.luckinToolError || result == null) continue;

        // 门店
        if (/queryShopList|shop|store/i.test(tool)) {
            const list = Array.isArray(result) ? result : (result?.data || result?.list);
            const first = Array.isArray(list) ? list[0] : null;
            if (first && typeof first === 'object') {
                if (state.deptId == null) state.deptId = (first as any).deptId;
                state.storeName = state.storeName || pickStr(first, ['deptName']);
                if ((first as any).longitude != null) state.longitude = (first as any).longitude;
                if ((first as any).latitude != null) state.latitude = (first as any).latitude;
            }
            if (args.longitude != null) state.longitude = args.longitude;
            if (args.latitude != null) state.latitude = args.latitude;
        }
        // 商品搜索 / 切换 / 详情
        if (/searchProduct|switchProduct|queryProductDetail|product/i.test(tool)) {
            if (state.deptId == null && args.deptId != null) state.deptId = args.deptId;
            for (const p of collectProducts(result)) {
                if (!seen.has(p.skuCode)) { seen.add(p.skuCode); state.knownProducts.push(p); }
            }
        }
        // 下单
        if (/createOrder|create.*order/i.test(tool)) {
            if (state.deptId == null && args.deptId != null) state.deptId = args.deptId;
            const oid = pickStr(result, ['orderIdStr', 'orderId']);
            if (oid) state.lastOrderId = oid;
        }
    }
    return state;
};

export const buildLuckinSessionContextPrompt = (state: LuckinSessionState): string => {
    const lines: string[] = [];
    if (state.deptId != null) {
        lines.push(`- 当前选中门店: deptId=${state.deptId}${state.storeName ? ` (${state.storeName})` : ''}`);
    }
    if (state.longitude != null && state.latitude != null) {
        lines.push(`- 当前经纬度 (createOrder/queryShopList 复用这组): longitude=${state.longitude}, latitude=${state.latitude}`);
    }
    if (state.lastOrderId) {
        lines.push(`- 最近订单号: ${state.lastOrderId}`);
    }
    if (state.knownProducts.length) {
        const sample = state.knownProducts.slice(0, 30).map(p => {
            const priceStr = p.price != null ? ` ¥${p.price}` : '';
            return `${p.skuCode}(productId=${p.productId ?? '?'})=${p.name || '?'}${priceStr}`;
        }).join(', ');
        const more = state.knownProducts.length > 30 ? ` ...还有 ${state.knownProducts.length - 30} 个` : '';
        lines.push(`- 已搜到的商品 (下单的 productId+skuCode 必须从这里成对取, 不要编):\n  ${sample}${more}`);
    }
    if (!lines.length) return '';
    return `\n[瑞幸本轮会话已沉淀的状态 — 调工具时直接复用下面这些 ID, 不要再问用户也不要重新查]\n${lines.join('\n')}\n`;
};

// ========== 聊天模式 (点"瑞一杯"激活, 角色直接调真实 8 工具) ==========

export interface LuckinChatState {
    active: boolean;
    longitude?: number;
    latitude?: number;
    cityName?: string;
}

/**
 * 角色聊天点单模式: 拼出要追加到 system prompt 的整段。
 * = 私人咖啡师提示词 + 当前定位 + 本轮已沉淀的门店/商品/订单状态。
 */
export const buildLuckinChatSystemBlock = (
    state: LuckinChatState | undefined,
    messages: MsgLike[],
    userName: string = '用户',
): string => {
    if (!state?.active) return '';
    let block = LUCKIN_SYSTEM_PROMPT.split('用户').join(userName);
    // 定位
    if (state.longitude != null && state.latitude != null) {
        block += `\n[当前定位 — queryShopList / createOrder 直接用这组经纬度, 别再问用户]\n- longitude: ${state.longitude}\n- latitude: ${state.latitude}${state.cityName ? `\n- 大概位置: ${state.cityName}` : ''}\n`;
    } else {
        block += `\n[当前定位: ❌ 还没拿到。queryShopList 的经纬度必填 —— 先用一句话问 ${userName} 在哪个城市/商圈, 或用城市中心坐标(如北京 116.40,39.90 / 上海 121.47,31.23)调 queryShopList 再用 deptName 缩小。别编精确坐标。]\n`;
    }
    // 已沉淀状态 (门店 / 商品 / 订单)
    const session = buildLuckinSessionContextPrompt(extractLuckinSessionState(messages));
    if (session) block += session;
    return block;
};
