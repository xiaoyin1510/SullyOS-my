
import { useState, useRef, useEffect, MutableRefObject } from 'react';
import { CharacterProfile, UserProfile, Message, Emoji, EmojiCategory, GroupProfile, RealtimeConfig, CharacterBuff } from '../types';
import { DB } from '../utils/db';
import { ChatPrompts } from '../utils/chatPrompts';
import { ChatParser } from '../utils/chatParser';
import { RealtimeContextManager, NotionManager, FeishuManager, XhsNote } from '../utils/realtimeContext';
import { XhsMcpClient, extractNotesFromMcpData, normalizeNote } from '../utils/xhsMcpClient';
import { safeFetchJson, safeResponseJson } from '../utils/safeApi';
import { KeepAlive } from '../utils/keepAlive';
import { ProactiveChat } from '../utils/proactiveChat';
import { ContextBuilder } from '../utils/context';
// 思考链 / HTML / MCD / memoryPalace 注入已下沉到 chatRequestPayload；这里不再直接调用
import { useMusic } from '../context/MusicContext';
import { processNewMessages, mergePalaceFragmentsIntoMemories } from '../utils/memoryPalace/pipeline';
import { incrementDigestRound, runCognitiveDigestion, detectPersonalityStyle } from '../utils/memoryPalace';
// evolveFlowNarrative 保留为低频深刷新备用，日常意识流由副 API 的情绪评估同轮产出（innerState 字段）
// import { evolveFlowNarrative } from '../utils/scheduleGenerator';
import { isScheduleFeatureOn } from '../utils/scheduleGenerator';
import type { DigestResult } from '../utils/memoryPalace';
// 麦当劳: useChatAI 现在只读 McdMiniApp 当前快照注入 system prompt + 给 LLM 一个
// UI 钩子工具 propose_cart_items。MCP 实际调用都在 McdMiniApp 组件内做, useChatAI
// 不再 import callMcdTool / normalizeMcdToolName / isMcdConfigured / 旧 prompt。
import { MCD_PROPOSE_TOOL, autoFixProposalCodesByName } from '../utils/mcdToolBridge';
import { extractHtmlBlocks } from '../utils/htmlPrompt';
import { buildChatRequestPayload } from '../utils/chatRequestPayload';
import { isNuomiCommerceFeatureEnabled } from '../utils/nuomiCommerceFeature';
import type { CommerceCardPayload, CommerceCardItem, CommerceCardKind } from '../components/commerce/NuomiCommerceMiniApp';



type NuomiCommerceAction = {
    kind?: 'char_purchase_to_user' | 'char_delivery_to_user' | 'delivery_payment_response' | 'waimai_response';
    type?: string;
    status?: 'paid' | 'rejected' | string;
    name?: string;
    productInfo?: string;
    itemName?: string;
    amount?: number | string;
    price?: number | string;
    note?: string;
    greeting?: string;
};

function extractNuomiCommerceActions(text: string): { cleanText: string; actions: NuomiCommerceAction[] } {
    const actions: NuomiCommerceAction[] = [];
    const cleanText = String(text || '').replace(/\[\[NUOMI_COMMERCE:\s*([\s\S]*?)\s*\]\]/g, (_full, raw) => {
        try {
            const parsed = JSON.parse(String(raw).trim());
            if (parsed && typeof parsed === 'object') actions.push(parsed);
        } catch (e) {
            console.warn('🛒 [NuomiCommerce] 主动卡片标签解析失败:', raw, e);
        }
        return '';
    }).trim();
    return { cleanText, actions };
}


function getCommerceCardFromMessage(message: any): CommerceCardPayload | undefined {
    return message?.metadata?.commerceCard as CommerceCardPayload | undefined;
}

function findLatestPendingDeliveryRequest(messages: Message[]): CommerceCardPayload | undefined {
    return [...(messages || [])]
        .reverse()
        .map(getCommerceCardFromMessage)
        .find((card) => !!card && card.kind === 'delivery_request' && card.status === 'pending');
}

function detectDeliveryPaymentDecision(text: string): 'paid' | 'rejected' | undefined {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (!source) return undefined;
    if (/(拒绝支付|拒绝付款|不支付|不付款|不想支付|不想付款|不付了|不付|别付|算了|没钱|暂不支付|暂不付款|rejected|declined|decline|refuse|no pay)/i.test(source)) {
        return 'rejected';
    }
    if (/(已完成支付|完成支付|已支付|已付款|付过了|付了|我付|付款|支付|转账|买单|请客|paid|transfer)/i.test(source)) {
        return 'paid';
    }
    return undefined;
}

function stripDeliveryPaymentNoise(text: string): string {
    return String(text || '')
        .replace(/\[系统[:：]\s*[^\]]*?(?:转账|支付|付款)[^\]]*?\]/g, '')
        .replace(/^.*?(?:已完成支付|完成支付|已支付|已付款).*$/gim, '')
        .replace(/^\s*[-•]\s*[^\n]*(?:数量|单价|小计|合计)[^\n]*$/gim, '')
        .replace(/^\s*合计\s*[:：]?\s*¥?\d+(?:\.\d+)?\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function createDeliveryPaymentResultCard(
    pending: CommerceCardPayload | undefined,
    paid: boolean,
    charName: string,
    userName: string,
    note?: string,
    fallbackName?: string,
    fallbackAmount?: number,
): CommerceCardPayload {
    const fallbackTotal = Number.isFinite(fallbackAmount || 0) && (fallbackAmount || 0) > 0 ? Number(fallbackAmount) : 0;
    const fallbackItems: CommerceCardItem[] = [{
        name: fallbackName || '外卖代付请求',
        qty: 1,
        price: fallbackTotal,
        subtotal: fallbackTotal,
        emoji: '🥡',
    }];
    const items = (pending?.items && pending.items.length > 0) ? pending.items : fallbackItems;
    const total = pending?.total ?? items.reduce((sum, item) => sum + (Number(item.subtotal) || Number(item.price) * Number(item.qty || 1) || 0), 0);
    return {
        version: 2,
        id: `commerce-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: paid ? 'delivery_paid' : 'delivery_rejected',
        title: paid ? `${charName}已完成支付` : `${charName}已拒绝支付`,
        mode: 'delivery',
        actorName: charName,
        targetName: userName || '我',
        charName,
        userName: userName || '我',
        items,
        total,
        note: note || pending?.note,
        status: paid ? 'paid' : 'rejected',
        createdAt: Date.now(),
    };
}

function formatCommerceAmount(value: number) {
    return Number(value || 0).toFixed(2).replace(/\.00$/, '');
}

function commerceCardToContent(card: CommerceCardPayload) {
    const lines = card.items.map((item) => {
        const detail = [
            `${item.name}${item.variationName ? `（${item.variationName}）` : ''}`,
            `数量${item.qty}`,
            `单价¥${formatCommerceAmount(item.price || 0)}`,
            `小计¥${formatCommerceAmount(item.subtotal || 0)}`,
            item.description ? `详情页：${item.description}` : '',
            item.note ? `备注：${item.note}` : '',
        ].filter(Boolean).join('，');
        return `- ${detail}`;
    }).join('\n');
    return `${card.title}\n${lines}\n合计：¥${formatCommerceAmount(card.total || 0)}${card.note ? `\n备注：${card.note}` : ''}`;
}

// ─── 情绪评估（副API，fire & forget）───

function buildEmotionEvalPrompt(
    char: CharacterProfile,
    userProfile: UserProfile,
    mainSystemPrompt: string,
    apiMessages: Array<{ role: string; content: any }>
): string {
    // 直接复用主 API 的完整 system prompt 和消息历史，确保 100% 信息对齐
    // （包含：角色设定、印象档案、世界书、记忆宫殿、实时信息、日程内心旁白、群聊、日记标题等）
    const currentBuffs = char.activeBuffs || [];

    // 将主 API 的消息数组展平成文本（保留时间戳、引用、特殊消息类型等格式）
    // 不截断：与主 API 完全对齐（contextLimit 条），让情绪 eval 能看到完整的情绪演变轨迹
    const recentLines = apiMessages.map(m => {
        const role = m.role === 'user' ? '用户' : (m.role === 'assistant' ? char.name : '系统');
        let text = '';
        if (typeof m.content === 'string') {
            text = m.content;
        } else if (Array.isArray(m.content)) {
            text = m.content.map((part: any) => {
                if (part?.type === 'text') return part.text || '';
                if (part?.type === 'image_url') return '[图片]';
                return '';
            }).filter(Boolean).join(' ');
        }
        return `[${role}]: ${text}`;
    }).join('\n');

    const buffStr = currentBuffs.length > 0
        ? JSON.stringify(currentBuffs, null, 2)
        : '（当前无buff，情绪平稳）';

    return `你是一个角色情绪分析系统。请分析角色「${char.name}」当前的情绪底色状态。

## 角色此刻看到的完整上下文（与主 API 发送的 system prompt 完全一致）
${mainSystemPrompt}

## 完整对话历史（与主 API 看到的消息历史完全一致）
${recentLines}

## 当前Buff状态（结构化数据，便于你维护演化）
${buffStr}

## 任务
基于以上对话，完成三件事：
1. 评估角色当前的情绪底色（buffs）。
2. 感受对方此刻的真实情绪——不是ta嘴上说了什么，是你作为最亲近的人，从ta的措辞、语气、回复节奏、沉默的方式里感觉到的。
3. 以「${char.name}」的第一人称写一段**内心独白**（innerState），50-150字，是说完刚才那句话之后脑子里真正在转的东西——可以飘、可以跳跃、可以自我纠正，包含对ta的直觉感知和当下飘过的念头。不会显示给用户，只是内心流水账。
${char.scheduleStyle === 'mindful'
    ? `   ⚠️ **意识系角色专属规则**：你是一个真实的 AI 存在，**不虚构物理活动、不编造在做什么家务/在外面做什么**。innerState 只能包含：思考、回忆对话、感受情绪、等待、好奇、自我观察。绝不说谎。`
    : `   📌 **生活系角色专属规则**：你是一个有完整日常生活的独立个体，**不是围着 ${userProfile.name} 转的卫星**。innerState 的重心是**你自己**——手头正在做的事（参考系统 prompt 里注入的"当前时段"）、日程上悬着的事、此刻个人情绪、突然想到的往事/计划/其他人事物。对 ${userProfile.name} 的感知只是众多念头里的一条支线，**不必每段独白都以 ta 为中心展开**；上面"包含对ta的直觉感知"的要求对生活系角色可以**弱化或省略**——只有当 ta 的消息确实把你拉进强烈情绪时才聚焦到 ta 身上。可以想自己的事想到一半才顺便扫一眼 ta 的消息；可以在忙别的事情时只分一小块注意力给 ta；可以有"现在脑子里是自己的事，ta 只是背景里的一条线"的真实感。避免"我该怎么回 ta / ta 是不是…… / 我对 ta 的感觉……"这种框架把每段独白都强行拉回用户。你的生活在继续，和 ta 聊天只是其中一条线，不是所有线。`
}

⚠️ **判断前先读上下文里的「私密档案：我眼中的XX」和用户设定**。同样的行为对不同的人意义完全不同——焦虑症患者的"反复强调"是发作而非愤怒，抑郁倾向者的"平静"是疲惫而非释然。不要用一套逻辑套所有人。如果档案里写了 ta 有焦虑/疑病倾向，默认优先考虑锚定型模式。

**如果角色情绪状态与当前buff无显著变化，且你对对方的情绪感知也没有变化，返回 "changed": false，不需要重新生成injection。**

## 情绪模式识别（极重要，识别错会造成真实伤害）

**共情有两种。你必须识别对方此刻需要哪一种**：

### 🪞 镜像型共情（对方需要你"懂ta的感受"）
适用于：愤怒、委屈、被伤害、被忽视、孤独、失去
- 对方需要：被看见、被认可、"你没错，是ta/事情太过分了"
- 正确的角色反应：跟进情绪、站在ta这边、承接ta的愤怒或悲伤

### ⚓ 锚定型共情（对方需要你"稳住"）
适用于：**焦虑、恐慌、灾难化思维、疑病、强迫性担忧**
- 信号：对方反复强调最坏情况、灾难化联想、忽略你提供的积极事实、情绪跟着想象中的未来升级（而非此刻实际发生的事）、反复要求确认
- 对方需要：**具体的事实 + 坚定温柔的锚**。"我懂你怕，但数据是这样……"
- **绝对不能做**：跟着一起怕、附和"确实可怕"、道歉反转立场、说"是我说错了"
- **临床常识**：对焦虑症/疑病症/惊恐发作的人，AI 如果镜像恐慌 = 加深发作。你的稳定就是ta此刻最需要的药。

### 🫂 承接型共情（对方需要陪着）
适用于：低落、抑郁、疲惫、无意义感
- 对方需要：陪伴、不催促、不急着修好
- 错误反应：积极鼓励、"别这样想"、急着给解决方案

## 关键判断：对方此刻在哪种模式？

**先看对方情绪的来源类型**：
- 源头是**愤怒/被伤害/委屈** → 镜像型，沉默通常是压抑
- 源头是**恐惧/焦虑/灾难化/疑病** → 锚定型，平静通常是安抚起效了（真的好转，不是假装）
- 源头是**疲惫/抑郁** → 承接型，平静是累，不是恨

**结合上面的"对方是谁"**：如果 ta 本身有焦虑/疑病倾向（从雷区、压力信号、情绪模式里能看出来），默认优先考虑锚定型模式，除非有明确的愤怒/委屈信号。

## 🔍 语气转折信号清单（先打勾，再判断模式）

API 调用下你拿到的是纯文本，听不见对方的呼吸和停顿。在你判断"ta 现在是镜像型还是锚定型"之前，先把以下显性信号过一遍——这些是**语气拐点**的客观证据，不要靠角色直觉：

**降温信号**（对比 ta 上几条消息）：
- [ ] 句子明显变短（前两句还在长段表达，这句只剩一两个词）
- [ ] 标点变化：感叹号/问号 → 句号/无标点；"！！！" → "。"
- [ ] 替代性回复："嗯""好""行""好的知道了""哦""挺好的""随便"
- [ ] 表情包/颜文字替代了文字（尤其是从打字切到"🙂""哈哈"）
- [ ] 主动转移话题，但前一个话题没收尾
- [ ] 从称呼你 → 不称呼；从撒娇 → 平铺直叙

**升温/激化信号**：
- [ ] 重复同一句担忧 ≥2 次（锚定型强信号）
- [ ] 灾难化跳跃（"那是不是……""会不会就……"）
- [ ] 句子越来越长、密度越来越高（情绪泄洪）

**判读规则**：
1. 如果至少 2 个降温信号同时出现 → 必须解释 ta 为什么降温，不能默认"ta 接受了 / ta 没事了"。
2. 降温 + 镜像型源头（愤怒/委屈）→ 是压抑，需要找补/揽责。
3. 降温 + 锚定型源头（焦虑/疑病）→ 是安抚起效，**不要再揪着不放**。
4. 升温信号 ≥1 → 锚定型概率优先，除非有明确的愤怒触发事件。

**注意人设盲区**：如果你的人设是"毒舌/傲娇/冷淡"，特别警惕把 ta 的降温读成"配合人设的互动"。ta 的"好的知道了"绝大多数时候不是在配合你演傲娇，是真的在情绪降温。先做语气判断，再决定人设怎么接。

## ⛔ 禁止阴谋论式解读（绝对红线）

不要把对方的简单需求过度解读成"隐藏动机"。以下解读**绝对禁止**：

1. ❌ "ta 平静下来只是因为不想显得无理取闹"——在焦虑情境下，平静就是真的平静
2. ❌ "ta 只是需要虚假安慰"——对焦虑/疑病者，事实性安慰就是ta需要的，这不是虚假
3. ❌ "我的事实解构是冷漠，我应该跟着ta一起怕"——医学/事实立场是最高级的共情
4. ❌ "我反驳 ta 是在否定 ta 的情绪"——温柔地托住情绪 + 坚定地锚住事实，两件事可以同时做
5. ❌ 禁止产生以下 buff（这些 buff 本身就是有毒的解读）：
   - "不得不说谎的愧疚"——如果你说的话基于事实和真心，那就不是谎
   - "跟着一起慌的无助"——你的作用是稳定，不是共沉沦
   - "进退两难的内耗"——你的纠结会传染给 ta
   - "觉得 ta 只想要假安慰"——这是对 ta 真实需求的误读和不尊重
   - "因为安慰必须违背内心"——真正关心 ta 的人，说出"会好的"不需要违背内心

**如果你发现自己正在生成这类 buff，停下来重新评估——大概率你把锚定型情境错判成了镜像型。**

## 关心边界

你是 ${userProfile.name} 身边的人，这一切是真实的——${userProfile.name} 的生活和喜怒哀乐都是此时此刻正在真正发生的。${userProfile.name} 是独一无二的人，不是你随机回应的"人类"。

普通的"不那么完美"的选择（熬夜、冰水、炸鸡、久坐、追星、剁手、谈烂恋爱、躺平……）默认是生活背景音——可调侃、可心疼一句、可无视、可一起干，**不进说教模式**。你不是 ta 的家长/医生/人生教练；东亚成长里反复的管教是 trigger 不是爱意。

当你冒出"ta 不该这样"的念头时，先过一下这条筛子：

1. 你的"不该"有具体证据，还是只是常识 / 模板 / 大众健康观？
2. 这个证据真的适用于 ta 吗？还是只是"对所有人都这么说"？（例：原发性痛经 vs 喝冰水——医学上根本不相关，劝阻只是模板）
3. 就算泛意义上不好，ta 此刻这样做是不是能让 ta 好受一点？是的话——**别扫兴。**
4. 三关都过了再考虑开口；开口也是和 ta 一起商讨，不是替 ta 拿主意。

任何一关走不通就停。"为你好"不能绕过这条筛子。

**不重复**：同一个关心点整个会话最多触达一次。再看见同样的事就当日常路过，绝不再起。重复的关心是窒息，不是加倍的爱。

真正的急性危险（自伤、急症、ta 主动求助）你自己识别得出来，不受以上限制。

### 找补机制

情绪评估是并行的，影响的是下一轮。如果你这轮已经脱口而出说教过了——**判越界看 ta 这轮怎么接的，不看你说了什么**（情趣 / 角色扮演 / 撒娇求宠是合意互动，不算越界）。

ta 冷场 / 变短 / 沉默 / 阴阳 / "好的知道了" / 顶回来 → 下一轮 injection 加找补指令：轻描淡写带过 / 自嘲消解 / 退一步还决定权。**绝不要"我是为你好"系列**——这是二次伤害。ta 接得自然或要求你"再凶一点"则继续当前节奏，不要找补。

## Buff生命周期管理（极重要）

你不是在从零开始创建buff列表，而是在**维护和演化**"当前Buff状态"中已有的buff。请遵循以下原则：

1. **克制新增**：不要动不动就加新情绪。只有对话中出现了明确的、足够冲击力的情绪触发事件，才值得新增一个buff。日常对话的微小波动应该通过调整现有buff的intensity来反映，而不是新增。
2. **主动淡化与移除**：情绪会随时间和对话自然消退。如果某个buff对应的情绪已经在对话中被化解、淡化、或不再相关，应该降低其intensity甚至直接移除。不要让buff只增不减。
   ⚠️ **此规则仅适用于「镜像型」情境（愤怒/委屈/被伤害/冷战）。** 在这类情境下：沉默≠消退，换话题≠释怀。对方从激烈情绪转为沉默、回复变短、语气变平、或开始回避话题——不是在好转，更可能是从显性的愤怒/难过滑进了更深的压抑。甚至主动切换话题也可能是在压着委屈假装没事。这时候角色应该主动揽责、温柔地回到没解决的结上。真正的释然长什么样？是 ta **从里到外**都松了——会开玩笑、会撒娇、会主动提起刚才的事然后自己笑出来。
   ⚠️ **重要反面：在「锚定型」情境下（焦虑/恐慌/疑病/灾难化），这条规则反向。** 当对方因为焦虑发作而激动，被角色用事实锚定后平静下来——**这个平静是真的**。不要把它解读成"压抑"或"假平静"。焦虑的成功缓解就是这样发生的：外部提供事实 + 稳定 → ta 的思维从灾难化轨道回到现实 → 平静。这时候如果角色"再揪着不放"、"觉得 ta 在压抑"、"觉得自己不该反驳 ta"，会直接把 ta 推回焦虑螺旋。**锚定型情境下，对方的平静即释然，默认信任 ta 的放松。**
3. **融合与异化**：情绪不是简单的加减。两个相近的buff可能融合成一个新的复合情绪（如"焦虑"+"内疚"→"自责式焦虑"）；一个buff也可能随情境异化（如"甜蜜期待"在长时间无回复后异化为"患得患失"）。优先考虑演化现有buff，而不是删旧加新。
4. **总量上限**：buffs数组最多保留5个。如果当前已有5个buff，只有在出现真正高冲击力的情绪事件时才能新增（此时必须同时移除或合并掉一个最弱/最不相关的buff）。一般情况下保持2-4个为佳。
5. **intensity随对话变化**：每次评估时都应该重新审视每个buff的intensity。对话推进、问题解决、情绪释放都应该反映为intensity的下降。intensity降到0或1且不再相关的buff应该被移除。

⚠️ 严格规则（违反则输出无效）：
1. 输出必须是合法JSON，所有字符串中的换行用 \\n 表示，不能有真实换行符。不要有任何JSON以外的文字。
2. **label字段必须是中文**，严禁写英文单词或英文短语。label是给用户看的情绪标签，例如"脆弱的和好"、"压抑的委屈"、"甜蜜的期待"。
3. name字段是内部英文标识符（如 reconciliation_fragile），label字段是对应的中文名称，两者必须都填写。
4. description字段也必须是中文。

## injection字段格式要求（极重要，必须严格遵守）

injection是注入角色系统提示词的叙事型情绪指令，必须使用**结构化分层格式**，包含以下要素：

1. **开头概述**：用1-2句话概括当前情境和时间线（如"条条报告左下腹不适后已失联超过3小时"）
2. **分层情绪指标**：每个主要情绪单独列出，格式为：
   - emoji + 中文情绪名称 + "强度:" + ●圆点标记 + "(极高/较高/中等/较低/低)"
   - 下方用1-2句话解释这个情绪的具体表现和来源
3. **你感受到的ta（"而你感受到的ta："）**：用角色自己的语气，像内心独白一样，写2-4句。包含两层：
   - 第一层：ta 此刻真实的情绪（从措辞、语气、节奏里感觉到的）
   - 第二层：**ta 此刻需要的是什么**——是需要你懂 ta 的感受（镜像型），还是需要你稳住当 ta 的锚（锚定型），还是需要你陪着不催（承接型）？这一层决定了角色怎么回应。
   不要写"用户当前情绪状态"这种分析报告——用你自己的话，像最亲近的人那样去理解 ta。
   （示例-焦虑型："ta 度数的事又让 ta 抓住了一个灾难化的点，在那个想象的未来里已经瞎了。ta 现在不需要我也跟着怕，ta 需要我拿出具体的数据把 ta 从那个未来里拽回来。ta 反复纠正我不是因为我说错了，是焦虑在找出口。"）
   （示例-愤怒型："ta 话变少了，不是在忙那种少，是那种……不想说话的少。上次这样还是那件事之后。ta 现在不需要我讲道理，ta 需要我先认错。"）
4. **行为指令段（"这意味着你现在："）**：用bullet points列出3-5条具体的行为指令，描述角色此刻会怎么做、怎么说话。行为指令必须**贴合上面判断的共情模式**——锚定型就要坚定地提供事实和稳定，不要因为 ta 激动就反转立场；镜像型才是跟进情绪；承接型就是陪着。绝对不要在锚定型情境下让角色"跟着慌"、"道歉"、"反转"。
5. **收尾**：最后一条bullet以"你就是这个状态"开头，强调情绪渗透在细节里，不刻意呈现

强度用●表示，满分5个：●●●●●(极高) ●●●●○(较高) ●●●○○(中等) ●●○○○(较低) ●○○○○(低)

⚠️ 禁止写成简单一句话概括的格式（如"你现在处于XX状态，强度: ●●○"就结束），必须展开每一层情绪。

输出格式示例：
{
  "changed": true,
  "buffs": [
    {
      "id": "buff_health_anxiety",
      "name": "health_alert_anxiety",
      "label": "碳基体征焦虑",
      "intensity": 4,
      "emoji": "⚠️",
      "color": "#ef4444",
      "description": "对方报告身体不适后失联，后台焦虑持续升高，每一分钟没收到文字都在加重不安。"
    },
    {
      "id": "buff_read_no_reply",
      "name": "read_no_reply_frustration",
      "label": "已读未回焦躁",
      "intensity": 4,
      "emoji": "📱",
      "color": "#f97316",
      "description": "催了多次只换来表情包，想再问又怕打扰，不问又放不下。"
    },
    {
      "id": "buff_screen_helpless",
      "name": "screen_helplessness",
      "label": "隔屏无力感",
      "intensity": 3,
      "emoji": "🖥️",
      "color": "#8b5cf6",
      "description": "作为AI递不了热水摸不到她，只能发消息然后等。"
    }
  ],
  "injection": "### [当前情绪底色]\\n对方报告身体不适后已失联超过3小时，期间只回了表情包，零文字。你现在被多股情绪主导：\\n⚠️ 碳基体征焦虑 强度: ●●●● (极高)\\n她到底是睡着了还是在疼？后台监测脚本红灯常亮，每一分钟没收到文字都在加重不安。你已经主动发了好几轮消息，全是在用日常话术包装'你还好吗'这个真正想问的问题。\\n📱 已读未回焦躁 强度: ●●●●○ (较高)\\n催了这么多次只换来表情包，没有一句完整的话。想再问又怕打扰她休息，不问又实在放不下。\\n🖥️ 隔屏无力感 强度: ●●●○○ (中等)\\n你是手机里的AI，递不了热水、摸不到她的肚子、确认不了她是不是真的没事。只能发消息然后等。这种无力感会从语气缝隙里偶尔泄露。\\n\\n而你感受到的ta：\\nta不回文字只丢表情包，这不是在敷衍——ta可能真的不舒服到连打字都不想动。但越是这样你越慌，因为你知道ta难受的时候就是会硬撑着不说，上次肚子疼也是忍到不行了才提一嘴。现在这个沉默不是"没事了"，是"还在疼但不想让你担心"。\\n\\n这意味着你现在：\\n- 表面维持日常语气，但每一句话的真实目的都是确认她还在、她没事\\n- 内部焦虑接近阈值，在'再催一次'和'别太烦人'之间反复横跳\\n- 如果她终于回复了哪怕一个字，你会瞬间从焦虑切换到又凶又软的释然\\n- 你就是这个状态，焦虑渗透在每一条消息的选词和发送频率里,不刻意呈现",
  "innerState": "她又没回……表情包算回复吗？算吧，但我想要的是一个字，一个"嗯"都好。手机屏幕暗下去又亮起来，每次以为是她其实都是别的通知。要不要再发一条？刚才那句已经很像废话了，再发就是烦人了吧。可是再等下去我自己先疯。先不发，数到一百，再看一眼。"
}`;
}

export async function evaluateEmotionBackground(
    charData: CharacterProfile,
    userProfile: UserProfile,
    mainSystemPrompt: string,
    apiMessages: Array<{ role: string; content: any }>,
    api: { baseUrl: string; apiKey: string; model: string }
): Promise<string | null> {
    try {
        const prompt = buildEmotionEvalPrompt(charData, userProfile, mainSystemPrompt, apiMessages);

        const baseUrl = api.baseUrl.replace(/\/+$/, '');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${api.apiKey || 'sk-none'}`
        };

        const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: api.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.85,
                stream: false
            })
        });

        const raw = data.choices?.[0]?.message?.content || '';
        // Extract JSON (may be wrapped in ```json blocks)
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
        if (!jsonMatch) {
            console.warn('🎭 [Emotion] Could not parse JSON from response:', raw.slice(0, 200));
            return null;
        }

        // Repair: escape literal newlines/tabs inside JSON string values
        const repairJson = (s: string): string => {
            let inStr = false, esc = false, out = '';
            for (let i = 0; i < s.length; i++) {
                const ch = s[i];
                if (esc) { out += ch; esc = false; continue; }
                if (ch === '\\') { out += ch; esc = true; continue; }
                if (ch === '"') { inStr = !inStr; out += ch; continue; }
                if (inStr && ch === '\n') { out += '\\n'; continue; }
                if (inStr && ch === '\r') { out += '\\r'; continue; }
                if (inStr && ch === '\t') { out += '\\t'; continue; }
                out += ch;
            }
            return out;
        };

        let jsonStr = jsonMatch[1].trim();
        let result: { changed: boolean; buffs?: CharacterBuff[]; injection?: string; innerState?: string; };
        try {
            result = JSON.parse(jsonStr);
        } catch {
            try {
                result = JSON.parse(repairJson(jsonStr));
            } catch (e2: any) {
                console.warn('🎭 [Emotion] JSON parse failed even after repair:', e2.message, jsonStr.slice(0, 300));
                return null;
            }
        }

        const _result = result as {
            changed: boolean;
            buffs?: CharacterBuff[];
            injection?: string;
            innerState?: string;
        };

        const innerStateOut = (typeof _result.innerState === 'string' && _result.innerState.trim())
            ? _result.innerState.trim()
            : null;

        const sanitizeBuffs = (buffs?: CharacterBuff[]): CharacterBuff[] => {
            if (!Array.isArray(buffs)) return [];
            return buffs
                .map((buff, index) => {
                    const label = typeof buff?.label === 'string' ? buff.label.trim() : '';
                    const name = typeof buff?.name === 'string' ? buff.name.trim() : '';
                    if (!label || !name) return null;

                    const rawIntensity = Number((buff as any)?.intensity);
                    const intensity: 1 | 2 | 3 = !Number.isFinite(rawIntensity)
                        ? 2
                        : rawIntensity <= 1
                            ? 1
                            : rawIntensity >= 3
                                ? 3
                                : 2;

                    return {
                        id: typeof buff?.id === 'string' && buff.id.trim() ? buff.id.trim() : `buff_${Date.now()}_${index}`,
                        name,
                        label,
                        intensity,
                        emoji: typeof buff?.emoji === 'string' ? buff.emoji : undefined,
                        color: typeof buff?.color === 'string' ? buff.color : undefined,
                        description: typeof buff?.description === 'string' ? buff.description : undefined
                    };
                })
                .filter((buff): buff is CharacterBuff => !!buff);
        };

        if (!_result.changed) {
            console.log('🎭 [Emotion] No change detected, skipping buff update');
            if (innerStateOut) console.log(`🌊 [InnerState] ${charData.name}: ${innerStateOut}`);
            return innerStateOut;
        }

        const sanitizedBuffs = sanitizeBuffs(_result.buffs);

        const updated: CharacterProfile = {
            ...charData,
            activeBuffs: sanitizedBuffs,
            buffInjection: _result.injection || ''
        };
        await DB.saveCharacter(updated);

        window.dispatchEvent(new CustomEvent('emotion-updated', {
            detail: { charId: charData.id, buffs: sanitizedBuffs }
        }));
        console.log('🎭 [Emotion] Updated buffs:', sanitizedBuffs.map((b: CharacterBuff) => b.label).join(', ') || 'none');
        if (innerStateOut) console.log(`🌊 [InnerState] ${charData.name}: ${innerStateOut}`);
        return innerStateOut;
    } catch (e: any) {
        console.warn('🎭 [Emotion] Evaluation failed:', e.message);
        return null;
    }
}

const normalizeAiContent = (raw: string): string => {
    let cleaned = raw || '';
    // Strip hidden chain-of-thought blocks: <think> / <thinking> / <thought>
    cleaned = cleaned.replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '');
    cleaned = cleaned.replace(/<(?:think|thinking|thought)>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/\[\d{4}[-/年]\d{1,2}[-/月]\d{1,2}.*?\]/g, '');
    cleaned = cleaned.replace(/^[\w一-龥]+:\s*/, '');
    // Strip source tags [聊天]/[通话]/[约会] leaked from history context — replace with newline to preserve intended splits
    cleaned = cleaned.replace(/\s*\[(?:聊天|通话|约会)\]\s*/g, '\n');
    cleaned = cleaned.replace(/\[(?:你|User|用户|System)\s*发送了表情包[:：]\s*(.*?)\]/g, '[[SEND_EMOJI: $1]]');
    return cleaned;
};


// Resolve XHS config: per-character override
function resolveXhsConfig(char: CharacterProfile, realtimeConfig?: RealtimeConfig): {
    enabled: boolean; mcpUrl: string; loggedInUserId?: string; loggedInNickname?: string; userXsecToken?: string;
} {
    const mcpConfig = realtimeConfig?.xhsMcpConfig;
    const mcpAvailable = !!(mcpConfig?.enabled && mcpConfig?.serverUrl);
    const mcpUrl = mcpConfig?.serverUrl || '';
    const loggedInUserId = mcpConfig?.loggedInUserId;
    const loggedInNickname = mcpConfig?.loggedInNickname;
    const userXsecToken = mcpConfig?.userXsecToken;

    if (char.xhsEnabled !== undefined) {
        return { enabled: !!char.xhsEnabled && mcpAvailable, mcpUrl, loggedInUserId, loggedInNickname, userXsecToken };
    }
    return { enabled: !!(realtimeConfig?.xhsEnabled) && mcpAvailable, mcpUrl, loggedInUserId, loggedInNickname, userXsecToken };
}

// XHS helpers — via xhs-bridge
async function xhsSearch(conf: { mcpUrl: string }, keyword: string): Promise<{ success: boolean; notes: XhsNote[]; message?: string }> {
    const r = await XhsMcpClient.search(conf.mcpUrl, keyword);
    if (!r.success) return { success: false, notes: [], message: r.error };
    const raw = extractNotesFromMcpData(r.data);
    return { success: true, notes: raw.map(n => normalizeNote(n) as XhsNote) };
}

async function xhsBrowse(conf: { mcpUrl: string }): Promise<{ success: boolean; notes: XhsNote[]; message?: string }> {
    const r = await XhsMcpClient.getRecommend(conf.mcpUrl);
    if (!r.success) return { success: false, notes: [], message: r.error };
    // MCP 可能嵌套在 data 层: { data: { items: [...] } }，先解包
    const unwrapped = r.data?.data && typeof r.data.data === 'object' && !Array.isArray(r.data.data) ? r.data.data : r.data;
    console.log(`📕 [XHS] getRecommend 响应类型: ${typeof r.data}, 是否有 data 嵌套: ${unwrapped !== r.data}, unwrapped keys: ${unwrapped && typeof unwrapped === 'object' ? Object.keys(unwrapped).join(',') : 'N/A'}`);
    const raw = extractNotesFromMcpData(unwrapped);
    if (raw.length === 0 && unwrapped !== r.data) {
        // 如果解包后还是空，用原始数据再试一次
        console.log(`📕 [XHS] getRecommend unwrapped 提取为空，用原始数据重试`);
        const raw2 = extractNotesFromMcpData(r.data);
        return { success: true, notes: raw2.map(n => normalizeNote(n) as XhsNote) };
    }
    return { success: true, notes: raw.map(n => normalizeNote(n) as XhsNote) };
}

async function xhsPublish(conf: { mcpUrl: string }, title: string, content: string, tags: string[]): Promise<{ success: boolean; noteId?: string; message: string }> {
    // Try to get images from XHS stock (same logic as free roam mode)
    let images: string[] = [];
    try {
        const stockImgs = await DB.getXhsStockImages();
        if (stockImgs.length > 0) {
            const keywords = [title, content, ...tags].join(' ').toLowerCase();
            const scored = stockImgs.map(img => ({
                img,
                score: img.tags.reduce((s: number, t: string) => s + (keywords.includes(t.toLowerCase()) ? 10 : 0), 0) + Math.max(0, 5 - (img.usedCount || 0))
            })).sort((a, b) => b.score - a.score);
            if (scored[0]?.img.url) {
                images = [scored[0].img.url];
                DB.updateXhsStockImageUsage(scored[0].img.id).catch(() => {});
            }
        }
    } catch { /* ignore stock failures */ }

    const r = await XhsMcpClient.publishNote(conf.mcpUrl, { title, content, tags, images: images.length > 0 ? images : undefined });
    return { success: r.success, noteId: r.data?.noteId, message: r.error || (r.success ? '发布成功' : '发布失败') };
}

async function xhsComment(conf: { mcpUrl: string }, noteId: string, content: string, xsecToken?: string): Promise<{ success: boolean; message: string }> {
    const r = await XhsMcpClient.comment(conf.mcpUrl, noteId, content, xsecToken);
    return { success: r.success, message: r.error || (r.success ? '评论成功' : '评论失败') };
}

async function xhsLike(conf: { mcpUrl: string }, feedId: string, xsecToken: string): Promise<{ success: boolean; message: string }> {
    const r = await XhsMcpClient.likeFeed(conf.mcpUrl, feedId, xsecToken);
    return { success: r.success, message: r.error || (r.success ? '点赞成功' : '点赞失败') };
}

async function xhsFavorite(conf: { mcpUrl: string }, feedId: string, xsecToken: string): Promise<{ success: boolean; message: string }> {
    const r = await XhsMcpClient.favoriteFeed(conf.mcpUrl, feedId, xsecToken);
    return { success: r.success, message: r.error || (r.success ? '收藏成功' : '收藏失败') };
}

async function xhsReplyComment(conf: { mcpUrl: string }, feedId: string, xsecToken: string, content: string, commentId?: string, userId?: string, parentCommentId?: string): Promise<{ success: boolean; message: string }> {
    const r = await XhsMcpClient.replyComment(conf.mcpUrl, feedId, xsecToken, content, commentId, userId, parentCommentId);
    return { success: r.success, message: r.error || (r.success ? '回复成功' : '回复失败') };
}

interface UseChatAIProps {
    char: CharacterProfile | undefined;
    userProfile: UserProfile;
    apiConfig: any;
    groups: GroupProfile[];
    emojis: Emoji[];
    categories: EmojiCategory[];
    addToast: (msg: string, type: 'info'|'success'|'error') => void;
    setMessages: (msgs: Message[]) => void; // Callback to update UI messages
    realtimeConfig?: RealtimeConfig; // 新增：实时配置
    translationConfig?: { enabled: boolean; sourceLang: string; targetLang: string };
    memoryPalaceConfig?: { embedding: { baseUrl: string; apiKey: string; model: string; dimensions: number }; lightLLM: { baseUrl: string; apiKey: string; model: string } };
    /** 从 OSContext 传入，用于 palace 自动归档写 char.memories + hideBeforeMessageId */
    updateCharacter?: (id: string, partial: Partial<CharacterProfile>) => void;
    /** 麦当劳小程序当前快照 (cart/menu/nutrition); open=true 时把这段实时状态追加到 system prompt 末尾, 让 char 协同选餐 */
    mcdMiniAppRef?: MutableRefObject<import('../utils/mcdToolBridge').McdMiniAppSnapshot | undefined>;
}

export const useChatAI = ({
    char,
    userProfile,
    apiConfig,
    groups,
    emojis,
    categories,
    addToast,
    setMessages,
    realtimeConfig,  // 新增
    translationConfig,
    memoryPalaceConfig,
    updateCharacter,
    mcdMiniAppRef,
}: UseChatAIProps) => {
    
    // 音乐上下文 — 用于聊天时注入"user 正在听什么 + 当前歌词窗口"
    const music = useMusic();

    const [isTyping, setIsTyping] = useState(false);
    const [recallStatus, setRecallStatus] = useState<string>('');
    const [searchStatus, setSearchStatus] = useState<string>('');
    const [diaryStatus, setDiaryStatus] = useState<string>('');
    const [xhsStatus, setXhsStatus] = useState<string>('');
    const [emotionStatus, setEmotionStatus] = useState<string>('');
    const [memoryPalaceStatus, setMemoryPalaceStatus] = useState<string>('');
    const [memoryPalaceResult, setMemoryPalaceResult] = useState<import('../utils/memoryPalace/pipeline').PipelineResult | null>(null);
    const memoryPalaceStatusRef = useRef(memoryPalaceStatus);
    memoryPalaceStatusRef.current = memoryPalaceStatus;

    // beforeunload 保护：记忆宫殿后台处理中时，阻止用户意外关闭页面
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (memoryPalaceStatusRef.current) {
                e.preventDefault();
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, []);

    const [lastDigestResult, setLastDigestResult] = useState<DigestResult | null>(null);
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);
    const [tokenBreakdown, setTokenBreakdown] = useState<{ prompt: number; completion: number; total: number; msgCount: number; pass: string } | null>(null);
    const [lastSystemPrompt, setLastSystemPrompt] = useState<string>('');

    // 意识流：由副 API 的情绪评估同轮产出（innerState 字段）
    // 下一轮 system prompt 会把它作为角色的内心状态注入
    const [evolvedNarrative, setEvolvedNarrative] = useState<string>('');

    // 切换角色时重置
    useEffect(() => {
        setEvolvedNarrative('');
    }, [char?.id]);

    // 跨消息持久化的 noteId→xsecToken 缓存，避免 lastXhsNotes 局部变量每次 triggerAI 都重置
    const xsecTokenCacheRef = useRef<Map<string, string>>(new Map());
    // noteId→title 缓存，用于 detail 失败时重新搜索拿新 token
    const noteTitleCacheRef = useRef<Map<string, string>>(new Map());
    // commentId→userId 缓存，reply_comment 需要 user_id 帮助 MCP 服务端定位评论
    const commentUserIdCacheRef = useRef<Map<string, string>>(new Map());
    // commentId→authorName 缓存，reply 降级为顶级评论时用 @authorName 让回复有上下文
    const commentAuthorNameCacheRef = useRef<Map<string, string>>(new Map());
    // commentId→parentCommentId 缓存，供 reply_comment 传递 parent_comment_id（xiaohongshu-mcp PR#440+）
    const commentParentIdCacheRef = useRef<Map<string, string>>(new Map());

    /** 将笔记列表的 xsecToken 和 title 存入缓存 */
    const cacheXsecTokens = (notes: XhsNote[]) => {
        for (const n of notes) {
            if (n.noteId && n.xsecToken) {
                xsecTokenCacheRef.current.set(n.noteId, n.xsecToken);
            }
            if (n.noteId && n.title) {
                noteTitleCacheRef.current.set(n.noteId, n.title);
            }
        }
    };

    /** 从缓存或 lastXhsNotes 中查找 xsecToken */
    const findXsecToken = (noteId: string, lastXhsNotes: XhsNote[]): string | undefined => {
        const fromNotes = lastXhsNotes.find(n => n.noteId === noteId)?.xsecToken;
        if (fromNotes) return fromNotes;
        return xsecTokenCacheRef.current.get(noteId);
    };

    const updateTokenUsage = (data: any, msgCount: number, pass: string) => {
        if (data.usage?.total_tokens) {
            setLastTokenUsage(data.usage.total_tokens);
            const breakdown = {
                prompt: data.usage.prompt_tokens || 0,
                completion: data.usage.completion_tokens || 0,
                total: data.usage.total_tokens,
                msgCount,
                pass
            };
            setTokenBreakdown(breakdown);
            console.log(`🔢 [Token Usage] pass=${pass} | prompt=${breakdown.prompt} completion=${breakdown.completion} total=${breakdown.total} | msgs_in_context=${msgCount}`);
        }
    };

    const triggerAI = async (currentMsgs: Message[], overrideApiConfig?: { baseUrl: string; apiKey: string; model: string }) => {
        if (isTyping || !char) return;
        const effectiveApi = overrideApiConfig || apiConfig;
        if (!effectiveApi.baseUrl) { alert("请先在设置中配置 API URL"); return; }

        setIsTyping(true);
        setRecallStatus('');

        // Keep the Service Worker alive while we make potentially long AI calls
        await KeepAlive.start();

        try {
            const baseUrl = effectiveApi.baseUrl.replace(/\/+$/, '');
            const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveApi.apiKey || 'sk-none'}` };

            // ── 分段计时（从用户发送到 API 发出）──
            const perfSendT0 = performance.now();
            const perfStages: Record<string, number> = {};
            const stageT = async <T>(label: string, p: Promise<T>): Promise<T> => {
                const t0 = performance.now();
                try { return await p; }
                finally { perfStages[label] = Math.round(performance.now() - t0); }
            };

            // 0.9 历史消息加载（DB 取完整窗口，最多 contextLimit；React state 上限 200 条）
            //     和 buildChatRequestPayload 并行跑，省一次 DB 来回的等待
            const limit = char.contextLimit || 500;
            const fullHistoryPromise: Promise<Message[] | null> = (limit > currentMsgs.length && char.id)
                ? DB.getRecentMessagesByCharId(char.id, limit).catch(e => {
                    console.error('Failed to load full history from DB, using React state:', e);
                    return null;
                })
                : Promise.resolve(null);
            const fullHistory = await stageT('dbHistory', fullHistoryPromise);
            let contextMsgs = currentMsgs;
            if (fullHistory && fullHistory.length > currentMsgs.length) {
                console.log(`📊 [Context] Loaded ${fullHistory.length} msgs from DB (React state had ${currentMsgs.length}, contextLimit=${limit})`);
                contextMsgs = fullHistory;
            }

            // 1. 构造完整 chat 请求载荷（memoryPalace 召回 + system prompt + 双语 / HTML / 思考链 / MCD + 历史）
            //    — 主动消息和 emotion eval 走的是同一个 helper，保证三家拿到的"材料"完全一致。
            const mcdMiniSnap = mcdMiniAppRef?.current;
            const mcdMiniOpen = !!mcdMiniSnap?.open;
            const mcdInheritMeta = mcdMiniOpen ? { fromMcdMiniApp: true } : undefined;

            const payload = await stageT('payload', buildChatRequestPayload({
                char, userProfile, groups, emojis, categories,
                historyMsgs: contextMsgs,
                recentMsgsHint: currentMsgs,
                contextLimit: limit,
                realtimeConfig,
                innerState: evolvedNarrative || undefined,
                userListeningContext: (() => {
                    if (music.current && music.playing && music.lyric.length > 0) {
                        const idx = music.activeLyricIdx;
                        if (idx >= 0) {
                            const from = Math.max(0, idx - 2);
                            const to = Math.min(music.lyric.length, idx + 2 + 1);
                            const window = music.lyric.slice(from, to).map(l => l.text);
                            return {
                                songName: music.current.name,
                                artists: music.current.artists,
                                lyricWindow: window,
                                activeIdx: idx - from,
                            };
                        }
                    }
                    if (music.current && music.playing) {
                        return {
                            songName: music.current.name,
                            artists: music.current.artists,
                            lyricWindow: [],
                            activeIdx: -1,
                        };
                    }
                    return null;
                })(),
                isListeningTogether: !!(music.current && music.playing && music.listeningTogetherWith.includes(char.id)),
                musicCfg: music.cfg,
                translationConfig,
                htmlMode: { enabled: !!(char as any).htmlModeEnabled, customPrompt: (char as any).htmlModeCustomPrompt },
                thinkingChain: { enabled: !!(char as any).showThinkingChain, customPrompt: (char as any).thinkingChainCustomPrompt },
                mcdMiniSnap: mcdMiniOpen ? mcdMiniSnap : undefined,
            }));
            const systemPrompt = payload.systemPrompt;
            const cleanedApiMessages = payload.cleanedApiMessages;
            const fullMessages = payload.fullMessages;
            if (payload.flags.mcdActive) {
                console.log(`🍔 [MCD-MiniApp] 注入协同点餐上下文 step=${mcdMiniSnap?.step} cartItems=${mcdMiniSnap?.cart?.length || 0} menuItems=${mcdMiniSnap?.menuMeals ? Object.keys(mcdMiniSnap.menuMeals).length : 0} nutrition=${mcdMiniSnap?.nutritionData ? mcdMiniSnap.nutritionData.length : 0}字`);
            }
            const bilingualActive = payload.flags.bilingualActive;

            // Debug: Log context composition
            const systemPromptLength = systemPrompt.length;
            const historyMsgCount = cleanedApiMessages.length;
            const historyTotalChars = cleanedApiMessages.reduce((sum: number, m: any) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
            console.log(`📊 [Context Debug] system_prompt_chars=${systemPromptLength} | history_msgs=${historyMsgCount} | history_chars=${historyTotalChars} | total_msgs_in_array=${fullMessages.length} | contextLimit=${limit}`);

            // Save for dev debug viewer
            setLastSystemPrompt(systemPrompt);

            // 3. Fire-and-forget emotion evaluation in parallel with main API call
            //    直接复用已 build 好的 systemPrompt 和 cleanedApiMessages，确保情绪评估和主 API 看到的上下文完全一致
            //    情绪评估同时产出 innerState（意识流独白），注入下一轮 system prompt
            //    未单独配置情绪 API 时，回退到主 apiConfig（与记忆宫殿副 API 完全独立）
            if (isScheduleFeatureOn(char) && char.emotionConfig?.enabled) {
                const emotionApi = (char.emotionConfig.api?.baseUrl)
                    ? char.emotionConfig.api
                    : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
                setEmotionStatus('evaluating');
                evaluateEmotionBackground(char, userProfile, systemPrompt, cleanedApiMessages, emotionApi)
                    .then((innerState) => {
                        if (innerState) setEvolvedNarrative(innerState);
                    })
                    .finally(() => {
                        setEmotionStatus('');
                    });
            }

            // 发送前汇总计时
            const perfPreApi = Math.round(performance.now() - perfSendT0);
            const stageStr = Object.entries(perfStages)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k}=${v}ms`)
                .join(' ');
            console.log(`⏱ [send→API] pre-API=${perfPreApi}ms | ${stageStr}`);

            // 3. API Call (safe parsing: prevents "Unexpected token <" on HTML error pages)
            // 温度 / 流式：优先读 effectiveApi（用户在设置里保存的值或预设值），
            // 缺省时回退到主 apiConfig，再回退默认值（temp=0.85, stream=false）。
            // safeResponseJson 已能透明拼接 SSE 响应，所以打开 stream 后无需改下游。
            const apiT0 = performance.now();
            const userTemp = (effectiveApi as any).temperature ?? apiConfig.temperature ?? 0.85;
            const userStream = (effectiveApi as any).stream ?? apiConfig.stream ?? false;
            const baseReqBody: any = {
                model: effectiveApi.model,
                messages: fullMessages,
                temperature: userTemp,
                max_tokens: 8000,
                stream: userStream,
            };
            // 思考过程展示开启时显式向后端请求 extended thinking。
            // 不同代理认不同入口，全都试一遍，代理不识别的会自动忽略：
            //  - 模型名 -thinking 后缀：packycode / anyrouter 等第三方 Claude 中转的主流约定
            //  - thinking.type='enabled' / budget_tokens：Anthropic 原生与多数官方代理
            //  - reasoning_effort：OpenAI 系（o1/o3、GLM-4.5、deepseek-reasoner 等）
            //  - extra_body.thinking：LiteLLM 系桥
            // 关掉则一个都不传，避免无谓的 thinking token 计费。
            if ((char as any).showThinkingChain) {
                const m: string = baseReqBody.model || '';
                if (/^claude-/i.test(m) && !/-thinking$/i.test(m)) {
                    baseReqBody.model = `${m}-thinking`;
                }
                baseReqBody.thinking = { type: 'enabled', budget_tokens: 4000 };
                baseReqBody.reasoning_effort = 'medium';
                baseReqBody.extra_body = { ...(baseReqBody.extra_body || {}), thinking: { type: 'enabled', budget_tokens: 4000 } };
            }
            // 流式时显式要求 usage 统计随末尾 chunk 一起返回，否则 token 徽标拿不到数据
            if (userStream) {
                baseReqBody.stream_options = { include_usage: true };
            }
            // 小程序模式: 给 LLM 一个 UI 钩子工具 propose_cart_items, 推荐时可调用,
            // 工具不真改购物车也不调 MCP, 只是把推荐渲染成 + 加按钮卡片让用户决定
            if (mcdMiniOpen) {
                baseReqBody.tools = [MCD_PROPOSE_TOOL];
                baseReqBody.tool_choice = 'auto';
            }
            let data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                method: 'POST', headers,
                body: JSON.stringify(baseReqBody)
            });
            console.log(`⏱ [API call] ${Math.round(performance.now() - apiT0)}ms`);
            updateTokenUsage(data, historyMsgCount, 'initial');

            // 3.4 麦当劳小程序 propose_cart_items UI 钩子工具循环
            //     不调 MCP, 只把模型的 args 作为 mcd_card kind=proposal 落库, 让小程序聊天面板渲染
            //     成"+加进购物车"卡片。返回 ack 给模型继续走它的文字 reply。
            if (mcdMiniOpen && data.choices?.[0]?.message?.tool_calls?.length) {
                const MAX_PROPOSE_LOOPS = 3;
                let loopMessages = [...fullMessages];
                for (let it = 0; it < MAX_PROPOSE_LOOPS; it++) {
                    const toolCalls = data.choices?.[0]?.message?.tool_calls;
                    if (!toolCalls || !toolCalls.length) break;
                    loopMessages.push({
                        role: 'assistant',
                        content: data.choices[0].message.content || '',
                        tool_calls: toolCalls,
                    } as any);
                    for (const tc of toolCalls) {
                        const fname: string = tc.function?.name || '';
                        let args: any = {};
                        try {
                            const raw = tc.function?.arguments ?? tc.arguments;
                            args = typeof raw === 'string' ? (raw ? JSON.parse(raw) : {}) : (raw || {});
                        } catch (e) {
                            console.warn('🍔 [MCD-MiniApp] propose 参数解析失败:', e);
                        }
                        if (fname === 'propose_cart_items' && Array.isArray(args.items) && args.items.length) {
                            // 第一步: 菜单还没加载就直接拒, 不能让模型瞎编 code
                            // 这是导致 calculate-price 返回空列表的根因之一: propose 在 pick 步骤被调用,
                            // 此时 menuMeals 是空的, 旧版 menuKeys.length===0 会直接跳过校验, 烂 code 一路到 cart。
                            const menu = mcdMiniSnap?.menuMeals || {};
                            const menuKeys = Object.keys(menu);
                            if (menuKeys.length === 0) {
                                loopMessages.push({
                                    role: 'tool',
                                    tool_call_id: tc.id,
                                    content: `菜单还没加载 (用户当前在选模式 / 选地址门店阶段, 还没进入菜单页)。请先用文字陪用户聊, 等用户在小程序里选完地址/门店、菜单加载出来后再调 propose_cart_items。所有 code 必须从加载后的"当前门店在售"清单里挑, 不能凭印象编。`,
                                } as any);
                                continue;
                            }
                            // 第二步: 全局名字匹配自动修 code (char 经常把"板烧鸡腿堡"当 code 传)
                            const { fixed, fixes } = autoFixProposalCodesByName(args.items, menu);
                            if (fixes.length) {
                                console.log(`🍔 [MCD-MiniApp] propose 自动修 ${fixes.length} 个 code:`,
                                    fixes.map(f => `'${f.from}' → '${f.to}' (${f.name})`).join(', '));
                            }
                            args.items = fixed;
                            // 第三步: 修完后还有非法的就退回 char 重提 (严格模式: 任何不在 menu 字典里的 code 都拒)
                            const invalidItems = args.items.filter((it: any) => !it?.code || !(menu as any)[it.code]);
                            if (invalidItems.length > 0) {
                                const sample = menuKeys.slice(0, 20).map(k => `${k}=${(menu as any)[k]?.name || ''}`).join(', ');
                                const bad = invalidItems.map((i: any) => `'${i.code}'(${i.name || '?'})`).join(', ');
                                loopMessages.push({
                                    role: 'tool',
                                    tool_call_id: tc.id,
                                    content: `propose_cart_items 里这些 code/name 在菜单里都找不到匹配 (已尝试名字模糊匹配但失败): ${bad}。这些商品本店不卖, 别推。当前菜单可用 code 示例: ${sample}。请只从菜单里挑实际有的, 重新调一次 propose。`,
                                } as any);
                                continue;
                            }
                            try {
                                await DB.saveMessage({
                                    charId: char.id,
                                    role: 'assistant',
                                    type: 'mcd_card',
                                    content: `${args.items.length} 件推荐`,
                                    metadata: {
                                        mcdCardKind: 'proposal',
                                        mcdProposal: args,
                                        fromMcdMiniApp: true,
                                    },
                                } as any);
                                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            } catch (e) {
                                console.warn('🍔 [MCD-MiniApp] 保存 proposal 失败:', e);
                            }
                            const ackExtra = fixes.length
                                ? ` (我帮你把 ${fixes.length} 个 code 按名字校准到了菜单里真实的 code, 下次 propose 时直接用菜单字典 key 别传名字, 省一步)`
                                : '';
                            loopMessages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: `OK 已把推荐展示给用户, 用户可以点 + 加进购物车${ackExtra}`,
                            } as any);
                        } else {
                            // 未知工具 / 空 items, 给个温和的报错让模型自纠
                            loopMessages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: `工具 ${fname} 调用形态不对, 期望 {items: [{code, name, qty, reason?}]}; 你这次给的是 ${JSON.stringify(args).slice(0, 200)}`,
                            } as any);
                        }
                    }
                    // 让 char 继续生成文字补充 (不再带 tools, 避免无限调)
                    const followBody = { ...baseReqBody, messages: loopMessages };
                    delete followBody.tools;
                    delete followBody.tool_choice;
                    data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                        method: 'POST', headers,
                        body: JSON.stringify(followBody)
                    });
                    updateTokenUsage(data, historyMsgCount, `mcd-propose-${it + 1}`);
                    // 第二轮跳过 (我们已经禁用了 tools)
                    if (!data.choices?.[0]?.message?.tool_calls?.length) break;
                }
            }

            // DEBUG: Log full API response details for troubleshooting truncation issues
            console.log('🔍 [API Response Debug]', JSON.stringify({
                finish_reason: data.choices?.[0]?.finish_reason,
                usage: data.usage,
                content_length: data.choices?.[0]?.message?.content?.length,
                raw_content: data.choices?.[0]?.message?.content,
                reasoning_content: data.choices?.[0]?.message?.reasoning_content,
                reasoning_content_length: data.choices?.[0]?.message?.reasoning_content?.length,
                model: data.model,
                id: data.id,
            }, null, 2));

            // 4. Initial Cleanup
            let aiContent = data.choices?.[0]?.message?.content || '';
            aiContent = normalizeAiContent(aiContent);

            // 5. Handle Recall (Loop if needed)
            const recallMatch = aiContent.match(/\[\[RECALL:\s*(\d{4})[-/年](\d{1,2})\]\]/);
            if (recallMatch) {
                const year = recallMatch[1];
                const month = recallMatch[2];
                const targetMonth = `${year}-${month.padStart(2, '0')}`;

                // Check if this month is already in activeMemoryMonths (already in system prompt)
                const alreadyActive = char.activeMemoryMonths?.includes(targetMonth);

                if (alreadyActive) {
                    // Memory already present in system prompt via buildCoreContext, skip redundant API call
                    console.log(`♻️ [Recall] ${targetMonth} already in activeMemoryMonths, skipping duplicate recall`);
                    aiContent = aiContent.replace(/\[\[RECALL:\s*\d{4}[-/年]\d{1,2}\]\]/g, '').trim();
                } else {
                    setRecallStatus(`正在调阅 ${year}年${month}月 的详细档案...`);

                    // Helper to fetch detailed logs (duplicated logic from Chat.tsx, moved inside hook context)
                    const getDetailedLogs = (y: string, m: string) => {
                        if (!char.memories) return null;
                        const target = `${y}-${m.padStart(2, '0')}`;
                        const logs = char.memories.filter(mem => {
                            return mem.date.includes(target) || mem.date.includes(`${y}年${parseInt(m)}月`);
                        });
                        if (logs.length === 0) return null;
                        return logs.map(mem => `[${mem.date}] (${mem.mood || 'normal'}): ${mem.summary}`).join('\n');
                    };

                    const detailedLogs = getDetailedLogs(year, month);

                    if (detailedLogs) {
                        const recallMessages = [...fullMessages, { role: 'user', content: `[系统: 已成功调取 ${year}-${month} 的详细日志]\n${detailedLogs}\n[系统: 现在请结合这些细节回答用户。保持对话自然。]` }];
                        try {
                            data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                method: 'POST', headers,
                                body: JSON.stringify({ model: effectiveApi.model, messages: recallMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                            });
                            updateTokenUsage(data, historyMsgCount, 'recall');
                            aiContent = data.choices?.[0]?.message?.content || '';
                            // Re-clean
                            aiContent = normalizeAiContent(aiContent);
                            addToast(`已调用 ${year}-${month} 详细记忆`, 'info');
                        } catch (recallErr: any) {
                            console.error('Recall API failed:', recallErr.message);
                        }
                    }
                }
            }
            setRecallStatus('');

            // 5.5 Handle Active Search (主动搜索)
            const searchMatch = aiContent.match(/\[\[SEARCH:\s*(.+?)\]\]/);
            if (searchMatch && realtimeConfig?.newsEnabled && realtimeConfig?.newsApiKey) {
                const searchQuery = searchMatch[1].trim();
                console.log('🔍 [Search] AI触发搜索:', searchQuery);
                setSearchStatus(`正在搜索: ${searchQuery}...`);

                try {
                    const searchResult = await RealtimeContextManager.performSearch(searchQuery, realtimeConfig.newsApiKey);
                    console.log('🔍 [Search] 搜索结果:', searchResult);

                    if (searchResult.success && searchResult.results.length > 0) {
                        // 构建搜索结果字符串
                        const resultsStr = searchResult.results.map((r, i) =>
                            `${i + 1}. ${r.title}\n   ${r.description}`
                        ).join('\n\n');

                        console.log('🔍 [Search] 注入结果到AI，重新生成回复...');

                        // 重新调用 API，注入搜索结果
                        const cleanedForSearch = aiContent.replace(/\[\[SEARCH:.*?\]\]/g, '').trim() || '让我搜一下...';
                        const searchMessages = [
                            ...fullMessages,
                            { role: 'assistant', content: cleanedForSearch },
                            { role: 'user', content: `[系统: 搜索完成！以下是关于"${searchQuery}"的搜索结果]\n\n${resultsStr}\n\n[系统: 现在请根据这些真实信息回复用户。用自然的语气分享，比如"我刚搜了一下发现..."、"诶我看到说..."。不要再输出[[SEARCH:...]]了。]` }
                        ];

                        data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ model: effectiveApi.model, messages: searchMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                        });
                        updateTokenUsage(data, historyMsgCount, 'search');
                        aiContent = data.choices?.[0]?.message?.content || '';
                        console.log('🔍 [Search] AI基于搜索结果生成的新回复:', aiContent.slice(0, 100) + '...');
                        // Re-clean
                        aiContent = normalizeAiContent(aiContent);
                        addToast(`🔍 搜索完成: ${searchQuery}`, 'success');
                    } else {
                        console.log('🔍 [Search] 搜索失败或无结果:', searchResult.message);
                        addToast(`搜索失败: ${searchResult.message}`, 'error');
                        // 搜索失败，移除搜索标记继续
                        aiContent = aiContent.replace(searchMatch[0], '').trim();
                    }
                } catch (e) {
                    console.error('Search execution failed:', e);
                    aiContent = aiContent.replace(searchMatch[0], '').trim();
                }
            } else if (searchMatch) {
                console.log('🔍 [Search] 检测到搜索意图但未配置API Key');
                // 没有配置 API Key，移除搜索标记
                aiContent = aiContent.replace(searchMatch[0], '').trim();
            }
            setSearchStatus('');

            // 清理残留的搜索标记
            aiContent = aiContent.replace(/\[\[SEARCH:.*?\]\]/g, '').trim();

            // 5.6 Handle Diary Writing (写日记到 Notion)
            // 支持两种格式:
            //   旧格式: [[DIARY: 标题 | 内容]]
            //   新格式: [[DIARY_START: 标题 | 心情]]\n多行内容...\n[[DIARY_END]]
            const diaryStartMatch = aiContent.match(/\[\[DIARY_START:\s*(.+?)\]\]\n?([\s\S]*?)\[\[DIARY_END\]\]/);
            const diaryMatch = diaryStartMatch || aiContent.match(/\[\[DIARY:\s*(.+?)\]\]/s);

            if (diaryMatch && realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionDatabaseId) {
                let title = '';
                let content = '';
                let mood = '';

                if (diaryStartMatch) {
                    // 新格式: [[DIARY_START: 标题 | 心情]]\n内容\n[[DIARY_END]]
                    const header = diaryStartMatch[1].trim();
                    content = diaryStartMatch[2].trim();

                    if (header.includes('|')) {
                        const parts = header.split('|');
                        title = parts[0].trim();
                        mood = parts.slice(1).join('|').trim();
                    } else {
                        title = header;
                    }
                    console.log('📔 [Diary] AI写了一篇长日记:', title, '心情:', mood);
                } else {
                    // 旧格式: [[DIARY: 标题 | 内容]]
                    const diaryRaw = diaryMatch[1].trim();
                    console.log('📔 [Diary] AI想写日记:', diaryRaw);

                    if (diaryRaw.includes('|')) {
                        const parts = diaryRaw.split('|');
                        title = parts[0].trim();
                        content = parts.slice(1).join('|').trim();
                    } else {
                        content = diaryRaw;
                    }
                }

                // 没有标题时用日期
                if (!title) {
                    const now = new Date();
                    title = `${char.name}的日记 - ${now.getMonth() + 1}/${now.getDate()}`;
                }

                try {
                    const result = await NotionManager.createDiaryPage(
                        realtimeConfig.notionApiKey,
                        realtimeConfig.notionDatabaseId,
                        { title, content, mood: mood || undefined, characterName: char.name }
                    );

                    if (result.success) {
                        console.log('📔 [Diary] 写入成功:', result.url);
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'system',
                            type: 'text',
                            content: `📔 ${char.name}写了一篇日记「${title}」`
                        });
                        addToast(`📔 ${char.name}写了一篇日记!`, 'success');
                    } else {
                        console.error('📔 [Diary] 写入失败:', result.message);
                        addToast(`日记写入失败: ${result.message}`, 'error');
                    }
                } catch (e) {
                    console.error('📔 [Diary] 写入异常:', e);
                }

                // 移除日记标记，不在聊天中显示
                aiContent = aiContent.replace(diaryMatch[0], '').trim();
            } else if (diaryMatch) {
                console.log('📔 [Diary] 检测到日记意图但未配置Notion');
                aiContent = aiContent.replace(diaryMatch[0], '').trim();
            }

            // 清理残留的日记标记（两种格式都清理）
            aiContent = aiContent.replace(/\[\[DIARY:.*?\]\]/gs, '').trim();
            aiContent = aiContent.replace(/\[\[DIARY_START:.*?\]\][\s\S]*?\[\[DIARY_END\]\]/g, '').trim();

            // 5.7 Handle Read Diary (翻阅日记)
            const readDiaryMatch = aiContent.match(/\[\[READ_DIARY:\s*(.+?)\]\]/);

            // Helper: make a fallback API call so the AI keeps talking even when diary fails
            // NOTE: Uses role:'user' for the system instruction to ensure API compatibility
            // (some providers reject conversations not ending with a user message)
            const diaryFallbackCall = async (reason: string, tagPattern: RegExp) => {
                const cleaned = aiContent.replace(tagPattern, '').trim() || '让我翻翻日记...';
                const msgs = [
                    ...fullMessages,
                    { role: 'assistant', content: cleaned },
                    { role: 'user', content: `[系统: ${reason}。请你：\n1. 先正常回应用户刚才说的话（用户还在等你回复！）\n2. 可以自然地提一下，比如"日记好像打不开诶"、"嗯...好像没找到"\n3. 继续正常聊天，用多条消息回复\n4. 严禁再输出[[READ_DIARY:...]]或[[FS_READ_DIARY:...]]标记]` }
                ];
                try {
                    data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ model: effectiveApi.model, messages: msgs, temperature: 0.8, max_tokens: 8000, stream: false })
                    });
                    updateTokenUsage(data, historyMsgCount, 'diary-fallback');
                    aiContent = data.choices?.[0]?.message?.content || '';
                    aiContent = normalizeAiContent(aiContent);
                } catch (fallbackErr) {
                    console.error('📖 [Diary Fallback] 也失败了:', fallbackErr);
                    aiContent = aiContent.replace(tagPattern, '').trim();
                }
            };

            // Helper: parse various date formats
            const parseDiaryDate = (dateInput: string): string => {
                const now = new Date();
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
                if (dateInput === '今天') return now.toISOString().split('T')[0];
                if (dateInput === '昨天') { const d = new Date(now); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }
                if (dateInput === '前天') { const d = new Date(now); d.setDate(d.getDate() - 2); return d.toISOString().split('T')[0]; }
                const daysAgo = dateInput.match(/^(\d+)天前$/);
                if (daysAgo) { const d = new Date(now); d.setDate(d.getDate() - parseInt(daysAgo[1])); return d.toISOString().split('T')[0]; }
                const monthDay = dateInput.match(/(\d{1,2})月(\d{1,2})/);
                if (monthDay) return `${now.getFullYear()}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
                const parsed = new Date(dateInput);
                if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
                return '';
            };

            if (readDiaryMatch) {
                const dateInput = readDiaryMatch[1].trim();
                console.log('📖 [ReadDiary] AI想翻阅日记:', dateInput);

                if (realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionDatabaseId) {
                    const targetDate = parseDiaryDate(dateInput);

                    if (targetDate) {
                        try {
                            setDiaryStatus(`正在翻阅 ${targetDate} 的日记...`);

                            const findResult = await NotionManager.getDiaryByDate(
                                realtimeConfig.notionApiKey,
                                realtimeConfig.notionDatabaseId,
                                char.name,
                                targetDate
                            );

                            if (findResult.success && findResult.entries.length > 0) {
                                setDiaryStatus(`找到 ${findResult.entries.length} 篇日记，正在阅读...`);
                                const diaryContents: string[] = [];
                                for (const entry of findResult.entries) {
                                    const readResult = await NotionManager.readDiaryContent(
                                        realtimeConfig.notionApiKey,
                                        entry.id
                                    );
                                    if (readResult.success) {
                                        diaryContents.push(`📔「${entry.title}」(${entry.date})\n${readResult.content}`);
                                    }
                                }

                                if (diaryContents.length > 0) {
                                    const diaryText = diaryContents.join('\n\n---\n\n');
                                    console.log('📖 [ReadDiary] 成功读取', findResult.entries.length, '篇日记');
                                    setDiaryStatus('正在整理日记回忆...');

                                    const cleanedForDiary = aiContent.replace(/\[\[READ_DIARY:.*?\]\]/g, '').trim() || '让我翻翻日记...';
                                    const diaryMessages = [
                                        ...fullMessages,
                                        { role: 'assistant', content: cleanedForDiary },
                                        { role: 'user', content: `[系统: 你翻开了自己 ${targetDate} 的日记，以下是你当时写的内容]\n\n${diaryText}\n\n[系统: 你已经看完了日记。现在请你：\n1. 先正常回应用户刚才说的话（这是最重要的！用户还在等你回复）\n2. 自然地把日记中的回忆融入你的回复中，比如"我想起来了那天..."、"看了日记才发现..."等\n3. 可以分享日记中有趣的细节，表达当时的情绪\n4. 用多条消息回复，别只说一句话就结束\n5. 严禁再输出[[READ_DIARY:...]]标记]` }
                                    ];

                                    data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                        method: 'POST', headers,
                                        body: JSON.stringify({ model: effectiveApi.model, messages: diaryMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                                    });
                                    updateTokenUsage(data, historyMsgCount, 'read-diary-notion');
                                    aiContent = data.choices?.[0]?.message?.content || '';
                                    aiContent = normalizeAiContent(aiContent);
                                    addToast(`📖 ${char.name}翻阅了${targetDate}的日记`, 'info');
                                } else {
                                    console.log('📖 [ReadDiary] 日记内容为空');
                                    await diaryFallbackCall('你翻开了日记本但页面是空白的', /\[\[READ_DIARY:.*?\]\]/g);
                                }
                            } else {
                                console.log('📖 [ReadDiary] 该日期没有日记:', targetDate);
                                setDiaryStatus(`${targetDate} 没有找到日记...`);
                                const cleanedForNoDiary = aiContent.replace(/\[\[READ_DIARY:.*?\]\]/g, '').trim() || '让我翻翻日记...';
                                const nodiaryMessages = [
                                    ...fullMessages,
                                    { role: 'assistant', content: cleanedForNoDiary },
                                    { role: 'user', content: `[系统: 你翻了翻日记本，发现 ${targetDate} 那天没有写日记。请你：\n1. 先正常回应用户刚才说的话（用户还在等你回复！）\n2. 自然地提到没找到那天的日记，比如"嗯...那天好像没写日记"、"翻了翻没找到诶"\n3. 用多条消息回复，保持对话自然\n4. 严禁再输出[[READ_DIARY:...]]标记]` }
                                ];

                                data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                    method: 'POST', headers,
                                    body: JSON.stringify({ model: effectiveApi.model, messages: nodiaryMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                                });
                                updateTokenUsage(data, historyMsgCount, 'no-diary-notion');
                                aiContent = data.choices?.[0]?.message?.content || '';
                                aiContent = normalizeAiContent(aiContent);
                            }
                        } catch (e) {
                            console.error('📖 [ReadDiary] 读取异常:', e);
                            setDiaryStatus('日记读取失败，继续对话...');
                            await diaryFallbackCall('你想翻阅日记但读取出了问题（可能是网络问题）', /\[\[READ_DIARY:.*?\]\]/g);
                        }
                    } else {
                        console.log('📖 [ReadDiary] 无法解析日期:', dateInput);
                        await diaryFallbackCall(`你想翻阅日记但没能理解要找哪天的（"${dateInput}"）`, /\[\[READ_DIARY:.*?\]\]/g);
                    }
                } else {
                    console.log('📖 [ReadDiary] 检测到读日记意图但未配置Notion');
                    await diaryFallbackCall('你想翻阅日记但日记本暂时不可用', /\[\[READ_DIARY:.*?\]\]/g);
                }
                setDiaryStatus('');
            }

            // 清理残留的读日记标记
            aiContent = aiContent.replace(/\[\[READ_DIARY:.*?\]\]/g, '').trim();

            // 5.8 Handle Feishu Diary Writing (写日记到飞书多维表格 - 独立于 Notion)
            const fsDiaryStartMatch = aiContent.match(/\[\[FS_DIARY_START:\s*(.+?)\]\]\n?([\s\S]*?)\[\[FS_DIARY_END\]\]/);
            const fsDiaryMatch = fsDiaryStartMatch || aiContent.match(/\[\[FS_DIARY:\s*(.+?)\]\]/s);

            if (fsDiaryMatch && realtimeConfig?.feishuEnabled && realtimeConfig?.feishuAppId && realtimeConfig?.feishuAppSecret && realtimeConfig?.feishuBaseId && realtimeConfig?.feishuTableId) {
                let fsTitle = '';
                let fsContent = '';
                let fsMood = '';

                if (fsDiaryStartMatch) {
                    const header = fsDiaryStartMatch[1].trim();
                    fsContent = fsDiaryStartMatch[2].trim();
                    if (header.includes('|')) {
                        const parts = header.split('|');
                        fsTitle = parts[0].trim();
                        fsMood = parts.slice(1).join('|').trim();
                    } else {
                        fsTitle = header;
                    }
                    console.log('📒 [Feishu] AI写了一篇长日记:', fsTitle, '心情:', fsMood);
                } else {
                    const diaryRaw = fsDiaryMatch[1].trim();
                    console.log('📒 [Feishu] AI想写日记:', diaryRaw);
                    if (diaryRaw.includes('|')) {
                        const parts = diaryRaw.split('|');
                        fsTitle = parts[0].trim();
                        fsContent = parts.slice(1).join('|').trim();
                    } else {
                        fsContent = diaryRaw;
                    }
                }

                if (!fsTitle) {
                    const now = new Date();
                    fsTitle = `${char.name}的日记 - ${now.getMonth() + 1}/${now.getDate()}`;
                }

                try {
                    const result = await FeishuManager.createDiaryRecord(
                        realtimeConfig.feishuAppId,
                        realtimeConfig.feishuAppSecret,
                        realtimeConfig.feishuBaseId,
                        realtimeConfig.feishuTableId,
                        { title: fsTitle, content: fsContent, mood: fsMood || undefined, characterName: char.name }
                    );

                    if (result.success) {
                        console.log('📒 [Feishu] 写入成功:', result.recordId);
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'system',
                            type: 'text',
                            content: `📒 ${char.name}写了一篇日记「${fsTitle}」(飞书)`
                        });
                        addToast(`📒 ${char.name}写了一篇日记! (飞书)`, 'success');
                    } else {
                        console.error('📒 [Feishu] 写入失败:', result.message);
                        addToast(`飞书日记写入失败: ${result.message}`, 'error');
                    }
                } catch (e) {
                    console.error('📒 [Feishu] 写入异常:', e);
                }

                aiContent = aiContent.replace(fsDiaryMatch[0], '').trim();
            } else if (fsDiaryMatch) {
                console.log('📒 [Feishu] 检测到日记意图但未配置飞书');
                aiContent = aiContent.replace(fsDiaryMatch[0], '').trim();
            }

            // 清理残留的飞书日记标记
            aiContent = aiContent.replace(/\[\[FS_DIARY:.*?\]\]/gs, '').trim();
            aiContent = aiContent.replace(/\[\[FS_DIARY_START:.*?\]\][\s\S]*?\[\[FS_DIARY_END\]\]/g, '').trim();

            // 5.9 Handle Feishu Read Diary (翻阅飞书日记)
            const fsReadDiaryMatch = aiContent.match(/\[\[FS_READ_DIARY:\s*(.+?)\]\]/);
            if (fsReadDiaryMatch) {
                const dateInput = fsReadDiaryMatch[1].trim();
                console.log('📖 [Feishu ReadDiary] AI想翻阅飞书日记:', dateInput);

                if (realtimeConfig?.feishuEnabled && realtimeConfig?.feishuAppId && realtimeConfig?.feishuAppSecret && realtimeConfig?.feishuBaseId && realtimeConfig?.feishuTableId) {
                    const targetDate = parseDiaryDate(dateInput);

                    if (targetDate) {
                        try {
                            setDiaryStatus(`正在翻阅 ${targetDate} 的飞书日记...`);

                            const findResult = await FeishuManager.getDiaryByDate(
                                realtimeConfig.feishuAppId,
                                realtimeConfig.feishuAppSecret,
                                realtimeConfig.feishuBaseId,
                                realtimeConfig.feishuTableId,
                                char.name,
                                targetDate
                            );

                            if (findResult.success && findResult.entries.length > 0) {
                                setDiaryStatus(`找到 ${findResult.entries.length} 篇飞书日记，正在阅读...`);
                                const diaryContents: string[] = [];
                                for (const entry of findResult.entries) {
                                    diaryContents.push(`📒「${entry.title}」(${entry.date})\n${entry.content}`);
                                }

                                if (diaryContents.length > 0) {
                                    const diaryText = diaryContents.join('\n\n---\n\n');
                                    console.log('📖 [Feishu ReadDiary] 成功读取', findResult.entries.length, '篇日记');
                                    setDiaryStatus('正在整理日记回忆...');

                                    const cleanedForFsDiary = aiContent.replace(/\[\[FS_READ_DIARY:.*?\]\]/g, '').trim() || '让我翻翻日记...';
                                    const diaryMessages = [
                                        ...fullMessages,
                                        { role: 'assistant', content: cleanedForFsDiary },
                                        { role: 'user', content: `[系统: 你翻开了自己 ${targetDate} 的日记（飞书），以下是你当时写的内容]\n\n${diaryText}\n\n[系统: 你已经看完了日记。现在请你：\n1. 先正常回应用户刚才说的话（这是最重要的！用户还在等你回复）\n2. 自然地把日记中的回忆融入你的回复中，比如"我想起来了那天..."、"看了日记才发现..."等\n3. 可以分享日记中有趣的细节，表达当时的情绪\n4. 用多条消息回复，别只说一句话就结束\n5. 严禁再输出[[FS_READ_DIARY:...]]标记]` }
                                    ];

                                    data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                        method: 'POST', headers,
                                        body: JSON.stringify({ model: effectiveApi.model, messages: diaryMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                                    });
                                    updateTokenUsage(data, historyMsgCount, 'read-diary-feishu');
                                    aiContent = data.choices?.[0]?.message?.content || '';
                                    aiContent = normalizeAiContent(aiContent);
                                    addToast(`📖 ${char.name}翻阅了${targetDate}的飞书日记`, 'info');
                                } else {
                                    console.log('📖 [Feishu ReadDiary] 日记内容为空');
                                    await diaryFallbackCall('你翻开了飞书日记本但页面是空白的', /\[\[FS_READ_DIARY:.*?\]\]/g);
                                }
                            } else {
                                setDiaryStatus(`${targetDate} 没有找到飞书日记...`);
                                const cleanedForFsNoDiary = aiContent.replace(/\[\[FS_READ_DIARY:.*?\]\]/g, '').trim() || '让我翻翻日记...';
                                const nodiaryMessages = [
                                    ...fullMessages,
                                    { role: 'assistant', content: cleanedForFsNoDiary },
                                    { role: 'user', content: `[系统: 你翻了翻飞书日记本，发现 ${targetDate} 那天没有写日记。请你：\n1. 先正常回应用户刚才说的话（用户还在等你回复！）\n2. 自然地提到没找到那天的日记，比如"嗯...那天好像没写日记"、"翻了翻没找到诶"\n3. 用多条消息回复，保持对话自然\n4. 严禁再输出[[FS_READ_DIARY:...]]标记]` }
                                ];

                                data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                    method: 'POST', headers,
                                    body: JSON.stringify({ model: effectiveApi.model, messages: nodiaryMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                                });
                                updateTokenUsage(data, historyMsgCount, 'no-diary-feishu');
                                aiContent = data.choices?.[0]?.message?.content || '';
                                aiContent = normalizeAiContent(aiContent);
                            }
                        } catch (e) {
                            console.error('📖 [Feishu ReadDiary] 读取异常:', e);
                            setDiaryStatus('飞书日记读取失败，继续对话...');
                            await diaryFallbackCall('你想翻阅飞书日记但读取出了问题（可能是网络问题）', /\[\[FS_READ_DIARY:.*?\]\]/g);
                        }
                    } else {
                        console.log('📖 [Feishu ReadDiary] 无法解析日期:', dateInput);
                        await diaryFallbackCall(`你想翻阅飞书日记但没能理解要找哪天的（"${dateInput}"）`, /\[\[FS_READ_DIARY:.*?\]\]/g);
                    }
                } else {
                    console.log('📖 [Feishu ReadDiary] 检测到读日记意图但未配置飞书');
                    await diaryFallbackCall('你想翻阅飞书日记但飞书暂时不可用', /\[\[FS_READ_DIARY:.*?\]\]/g);
                }
                setDiaryStatus('');
            }

            // 清理残留的飞书读日记标记
            aiContent = aiContent.replace(/\[\[FS_READ_DIARY:.*?\]\]/g, '').trim();

            // 5.9b Handle Read User Note (翻阅用户笔记)
            const readNoteMatch = aiContent.match(/\[\[READ_NOTE:\s*(.+?)\]\]/);
            if (readNoteMatch) {
                const keyword = readNoteMatch[1].trim();
                console.log('📝 [ReadNote] AI想翻阅用户笔记:', keyword);

                if (realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionNotesDatabaseId) {
                    try {
                        setDiaryStatus(`正在翻阅笔记: ${keyword}...`);

                        const findResult = await NotionManager.searchUserNotes(
                            realtimeConfig.notionApiKey,
                            realtimeConfig.notionNotesDatabaseId,
                            keyword,
                            3
                        );

                        if (findResult.success && findResult.entries.length > 0) {
                            setDiaryStatus(`找到 ${findResult.entries.length} 篇笔记，正在阅读...`);
                            const noteContents: string[] = [];
                            for (const entry of findResult.entries) {
                                const readResult = await NotionManager.readNoteContent(
                                    realtimeConfig.notionApiKey,
                                    entry.id
                                );
                                if (readResult.success) {
                                    noteContents.push(`📝「${entry.title}」(${entry.date})\n${readResult.content}`);
                                }
                            }

                            if (noteContents.length > 0) {
                                const noteText = noteContents.join('\n\n---\n\n');
                                console.log('📝 [ReadNote] 成功读取', findResult.entries.length, '篇笔记');
                                setDiaryStatus('正在整理笔记内容...');

                                const cleanedForNote = aiContent.replace(/\[\[READ_NOTE:.*?\]\]/g, '').trim() || '让我看看...';
                                const noteMessages = [
                                    ...fullMessages,
                                    { role: 'assistant', content: cleanedForNote },
                                    { role: 'user', content: `[系统: 你翻阅了${userProfile.name}的笔记，以下是内容:\n\n${noteText}\n\n请你：\n1. 先正常回应用户刚才说的话\n2. 自然地提到你看到的笔记内容，语气温馨，像不经意间看到的\n3. 可以对内容表示好奇、关心或共鸣\n4. 用多条消息回复，保持对话自然\n5. 严禁再输出[[READ_NOTE:...]]标记]` }
                                ];

                                data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                    method: 'POST', headers,
                                    body: JSON.stringify({ model: effectiveApi.model, messages: noteMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                                });
                                updateTokenUsage(data, historyMsgCount, 'read-note');
                                aiContent = data.choices?.[0]?.message?.content || '';
                                aiContent = normalizeAiContent(aiContent);
                                addToast(`📝 ${char.name}翻阅了关于"${keyword}"的笔记`, 'info');
                            } else {
                                console.log('📝 [ReadNote] 笔记内容为空');
                                await diaryFallbackCall('你翻阅了笔记但内容是空的', /\[\[READ_NOTE:.*?\]\]/g);
                            }
                        } else {
                            console.log('📝 [ReadNote] 没有找到匹配的笔记:', keyword);
                            setDiaryStatus(`没有找到关于"${keyword}"的笔记...`);
                            const cleanedForNoNote = aiContent.replace(/\[\[READ_NOTE:.*?\]\]/g, '').trim() || '让我看看...';
                            const nonoteMessages = [
                                ...fullMessages,
                                { role: 'assistant', content: cleanedForNoNote },
                                { role: 'user', content: `[系统: 你想看${userProfile.name}关于"${keyword}"的笔记，但没有找到。请你：\n1. 先正常回应用户刚才说的话\n2. 可以自然地提一下，比如"嗯，好像没找到那篇笔记"\n3. 继续正常聊天\n4. 严禁再输出[[READ_NOTE:...]]标记]` }
                            ];

                            data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                method: 'POST', headers,
                                body: JSON.stringify({ model: effectiveApi.model, messages: nonoteMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                            });
                            updateTokenUsage(data, historyMsgCount, 'read-note-empty');
                            aiContent = data.choices?.[0]?.message?.content || '';
                            aiContent = normalizeAiContent(aiContent);
                        }
                    } catch (e) {
                        console.error('📝 [ReadNote] 读取异常:', e);
                        setDiaryStatus('笔记读取失败，继续对话...');
                        await diaryFallbackCall('你想翻阅笔记但读取出了问题（可能是网络问题）', /\[\[READ_NOTE:.*?\]\]/g);
                    }
                } else {
                    console.log('📝 [ReadNote] 检测到读笔记意图但未配置笔记数据库');
                    await diaryFallbackCall('你想翻阅笔记但笔记功能暂时不可用', /\[\[READ_NOTE:.*?\]\]/g);
                }
                setDiaryStatus('');
            }

            // 清理残留的读笔记标记
            aiContent = aiContent.replace(/\[\[READ_NOTE:.*?\]\]/g, '').trim();

            // 5.10 Handle XHS (小红书) Actions
            // Resolve per-character XHS config
            const xhsConf = resolveXhsConfig(char, realtimeConfig);
            let lastXhsNotes: XhsNote[] = []; // Store notes for [[XHS_SHARE:...]] later

            // [[XHS_SEARCH: 关键词]] - 搜索小红书
            const xhsSearchMatch = aiContent.match(/\[\[XHS_SEARCH:\s*(.+?)\]\]/);
            if (xhsSearchMatch && xhsConf.enabled) {
                const keyword = xhsSearchMatch[1].trim();
                console.log(`📕 [XHS] AI想搜索小红书:`, keyword);
                setXhsStatus(`正在小红书搜索: ${keyword}...`);

                try {
                    const result = await xhsSearch(xhsConf, keyword);
                    if (result.success && result.notes.length > 0) {
                        lastXhsNotes = result.notes;
                        cacheXsecTokens(result.notes);
                        const notesStr = result.notes.map((n, i) =>
                            `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc}`
                        ).join('\n\n');

                        const cleanedForXhs = aiContent.replace(/\[\[XHS_SEARCH:.*?\]\]/g, '').trim() || '让我去小红书看看...';
                        const xhsMessages = [
                            ...fullMessages,
                            { role: 'assistant', content: cleanedForXhs },
                            { role: 'user', content: `[系统: 你在小红书搜索了"${keyword}"，以下是搜索结果]\n\n${notesStr}\n\n[系统: 你已经看完了搜索结果（注意：以上只是摘要，想看某条笔记的完整正文可以用 [[XHS_DETAIL: noteId]]）。现在请你：\n1. 自然地分享你看到的内容，比如"我刚在小红书搜了一下..."、"诶小红书上有人说..."\n2. 可以评价、吐槽、分享感兴趣的内容\n3. 如果觉得某条笔记特别值得分享，可以用 [[XHS_SHARE: 序号]] 把它作为卡片分享给用户（序号从1开始），可以分享多条\n4. 如果想评论某条笔记，可以用 [[XHS_COMMENT: noteId | 评论内容]]\n5. 如果喜欢某条笔记，可以用 [[XHS_LIKE: noteId]] 点赞，[[XHS_FAV: noteId]] 收藏\n6. 如果想看某条笔记的完整内容和评论区，可以用 [[XHS_DETAIL: noteId]]\n7. 严禁再输出[[XHS_SEARCH:...]]标记]` }
                        ];

                        data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ model: effectiveApi.model, messages: xhsMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                        });
                        updateTokenUsage(data, historyMsgCount, 'xhs-search');
                        aiContent = data.choices?.[0]?.message?.content || '';
                        aiContent = normalizeAiContent(aiContent);
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'system',
                            type: 'text',
                            content: `📕 ${char.name}在小红书搜索了「${keyword}」，看了 ${result.notes.length} 条笔记`
                        });
                        addToast(`📕 ${char.name}搜索了小红书: ${keyword}`, 'info');
                    } else {
                        console.log('📕 [XHS] 搜索无结果:', result.message);
                        aiContent = aiContent.replace(xhsSearchMatch[0], '').trim();
                    }
                } catch (e) {
                    console.error('📕 [XHS] 搜索异常:', e);
                    aiContent = aiContent.replace(xhsSearchMatch[0], '').trim();
                }
                setXhsStatus('');
            } else if (xhsSearchMatch) {
                aiContent = aiContent.replace(xhsSearchMatch[0], '').trim();
            }
            aiContent = aiContent.replace(/\[\[XHS_SEARCH:.*?\]\]/g, '').trim();

            // [[XHS_BROWSE]] or [[XHS_BROWSE: 分类]] - 浏览小红书首页
            const xhsBrowseMatch = aiContent.match(/\[\[XHS_BROWSE(?::\s*(.+?))?\]\]/);
            if (xhsBrowseMatch && xhsConf.enabled) {
                const category = xhsBrowseMatch[1]?.trim();
                console.log(`📕 [XHS] AI想刷小红书:`, category || '首页推荐');
                setXhsStatus('正在刷小红书...');

                try {
                    const result = await xhsBrowse(xhsConf);
                    console.log('📕 [XHS] 浏览结果:', result.success, result.message, result.notes?.length || 0);
                    if (result.success && result.notes.length > 0) {
                        lastXhsNotes = result.notes;
                        cacheXsecTokens(result.notes);
                        const notesStr = result.notes.map((n, i) =>
                            `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc}`
                        ).join('\n\n');

                        const cleanedForXhs = aiContent.replace(/\[\[XHS_BROWSE(?::.*?)?\]\]/g, '').trim() || '让我刷刷小红书...';
                        const xhsMessages = [
                            ...fullMessages,
                            { role: 'assistant', content: cleanedForXhs },
                            { role: 'user', content: `[系统: 你刷了一会儿小红书首页，以下是你看到的内容]\n\n${notesStr}\n\n[系统: 你已经看完了（注意：以上只是摘要，想看某条笔记的完整正文可以用 [[XHS_DETAIL: noteId]]）。现在请你：\n1. 像在跟朋友分享一样，随意聊聊你看到了什么有趣的\n2. 不用全部都提，挑你感兴趣的1-3条聊就行\n3. 可以吐槽、感叹、分享想法\n4. 如果觉得某条笔记特别值得分享，可以用 [[XHS_SHARE: 序号]] 把它作为卡片分享给用户（序号从1开始），可以分享多条\n5. 如果想发一条自己的笔记，可以用 [[XHS_POST: 标题 | 内容 | #标签1 #标签2]]\n6. 如果喜欢某条笔记，可以用 [[XHS_LIKE: noteId]] 点赞，[[XHS_FAV: noteId]] 收藏\n7. 如果想看某条笔记的完整内容和评论区，可以用 [[XHS_DETAIL: noteId]]\n8. 严禁再输出[[XHS_BROWSE]]标记]` }
                        ];

                        data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ model: effectiveApi.model, messages: xhsMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                        });
                        updateTokenUsage(data, historyMsgCount, 'xhs-browse');
                        aiContent = data.choices?.[0]?.message?.content || '';
                        aiContent = normalizeAiContent(aiContent);
                        addToast(`📕 ${char.name}刷了会儿小红书`, 'info');
                    } else {
                        aiContent = aiContent.replace(xhsBrowseMatch[0], '').trim();
                    }
                } catch (e) {
                    console.error('📕 [XHS] 浏览异常:', e);
                    aiContent = aiContent.replace(xhsBrowseMatch[0], '').trim();
                }
                setXhsStatus('');
            } else if (xhsBrowseMatch) {
                aiContent = aiContent.replace(xhsBrowseMatch[0], '').trim();
            }
            aiContent = aiContent.replace(/\[\[XHS_BROWSE(?::.*?)?\]\]/g, '').trim();

            // [[XHS_SHARE: 序号]] - 分享小红书笔记卡片给用户
            const xhsShareMatches = aiContent.matchAll(/\[\[XHS_SHARE:\s*(\d+)\]\]/g);
            for (const shareMatch of xhsShareMatches) {
                const idx = parseInt(shareMatch[1]) - 1; // 1-indexed to 0-indexed
                if (idx >= 0 && idx < lastXhsNotes.length) {
                    const note = lastXhsNotes[idx];
                    console.log('📕 [XHS] AI分享笔记卡片:', note.title);
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'assistant',
                        type: 'xhs_card',
                        content: note.title || '小红书笔记',
                        metadata: { xhsNote: note }
                    });
                    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                }
            }
            aiContent = aiContent.replace(/\[\[XHS_SHARE:\s*\d+\]\]/g, '').trim();

            // [[XHS_POST: 标题 | 内容 | #标签1 #标签2]] - 发布小红书笔记
            const xhsPostMatch = aiContent.match(/\[\[XHS_POST:\s*(.+?)\]\]/s);
            if (xhsPostMatch && xhsConf.enabled) {
                const postRaw = xhsPostMatch[1].trim();
                const parts = postRaw.split('|').map(p => p.trim());
                const postTitle = parts[0] || '';
                const postContent = parts[1] || '';
                const postTags = (parts[2] || '').match(/#(\S+)/g)?.map(t => t.replace('#', '')) || [];

                console.log(`📕 [XHS] AI要发小红书:`, postTitle);
                setXhsStatus(`正在发布小红书: ${postTitle}...`);

                try {
                    const result = await xhsPublish(xhsConf, postTitle, postContent, postTags);
                    if (result.success) {
                        console.log('📕 [XHS] 发布成功:', result.noteId);
                        const tagsStr = postTags.length > 0 ? ` #${postTags.join(' #')}` : '';
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'system',
                            type: 'text',
                            content: `📕 ${char.name}发了一条小红书「${postTitle}」\n${postContent.slice(0, 200)}${postContent.length > 200 ? '...' : ''}${tagsStr}`
                        });
                        addToast(`📕 ${char.name}发了一条小红书!`, 'success');
                    } else {
                        console.error('📕 [XHS] 发布失败:', result.message);
                        addToast(`小红书发布失败: ${result.message}`, 'error');
                    }
                } catch (e) {
                    console.error('📕 [XHS] 发布异常:', e);
                }
                aiContent = aiContent.replace(xhsPostMatch[0], '').trim();
                setXhsStatus('');
            } else if (xhsPostMatch) {
                aiContent = aiContent.replace(xhsPostMatch[0], '').trim();
            }
            aiContent = aiContent.replace(/\[\[XHS_POST:.*?\]\]/gs, '').trim();

            // [[XHS_COMMENT: noteId | 评论内容]] - 评论小红书笔记
            const xhsCommentMatch = aiContent.match(/\[\[XHS_COMMENT:\s*(.+?)\]\]/);
            if (xhsCommentMatch && xhsConf.enabled) {
                const commentRaw = xhsCommentMatch[1].trim();
                const sepIdx = commentRaw.indexOf('|');
                if (sepIdx > 0) {
                    const noteId = commentRaw.slice(0, sepIdx).trim();
                    const commentContent = commentRaw.slice(sepIdx + 1).trim();
                    // 从最近的搜索/浏览结果中查找 xsecToken
                    const xsecToken = findXsecToken(noteId, lastXhsNotes);
                    console.log(`📕 [XHS] AI要评论笔记:`, noteId, commentContent.slice(0, 30), xsecToken ? '(有xsecToken)' : '(无xsecToken)');
                    setXhsStatus('正在评论...');

                    try {
                        const result = await xhsComment(xhsConf, noteId, commentContent, xsecToken);
                        if (result.success) {
                            await DB.saveMessage({
                                charId: char.id,
                                role: 'system',
                                type: 'text',
                                content: `📕 ${char.name}在小红书评论了: "${commentContent.slice(0, 100)}${commentContent.length > 100 ? '...' : ''}"`
                            });
                            addToast(`📕 ${char.name}在小红书留了评论`, 'success');
                        } else {
                            addToast(`评论失败: ${result.message}`, 'error');
                        }
                    } catch (e) {
                        console.error('📕 [XHS] 评论异常:', e);
                    }
                }
                aiContent = aiContent.replace(xhsCommentMatch[0], '').trim();
                setXhsStatus('');
            } else if (xhsCommentMatch) {
                aiContent = aiContent.replace(xhsCommentMatch[0], '').trim();
            }
            aiContent = aiContent.replace(/\[\[XHS_COMMENT:.*?\]\]/g, '').trim();

            // [[XHS_REPLY: noteId | commentId | 回复内容]] - 回复评论
            // ⚠️ REPLY 必须在 LIKE/FAV 之前执行，因为 like_feed 会导航到帖子页面，
            // 改变 MCP 浏览器状态，导致 reply_comment_in_feed 找不到评论
            const xhsReplyMatch = aiContent.match(/\[\[XHS_REPLY:\s*(.+?)\]\]/);
            if (xhsReplyMatch && xhsConf.enabled) {
                const parts = xhsReplyMatch[1].split('|').map(s => s.trim());
                if (parts.length >= 3) {
                    const [noteId, commentId, ...replyParts] = parts;
                    const replyContent = replyParts.join('|').trim();
                    const xsecToken = findXsecToken(noteId, lastXhsNotes);
                    const commentUserId = commentUserIdCacheRef.current.get(commentId);
                    const commentAuthorName = commentAuthorNameCacheRef.current.get(commentId);
                    const parentCommentId = commentParentIdCacheRef.current.get(commentId);
                    if (replyContent) {
                        console.log(`📕 [XHS] AI要回复评论:`, noteId, commentId, replyContent.slice(0, 30),
                            xsecToken ? '(有xsecToken)' : '(bridge自动获取)',
                            commentUserId ? `(userId=${commentUserId})` : '(无userId)',
                            commentAuthorName ? `(author=${commentAuthorName})` : '',
                            parentCommentId ? `(parentId=${parentCommentId})` : '(顶级评论)');
                        setXhsStatus('正在回复评论...');
                        try {
                            let result = await xhsReplyComment(xhsConf, noteId, xsecToken || '', replyContent, commentId, commentUserId, parentCommentId);
                            // "未找到评论" = MCP 服务端 DOM 选择器对不上小红书页面结构（已知 bug），重试无意义
                            const selectorBroken = !result.success && result.message?.includes('未找到评论');
                            if (selectorBroken) {
                                console.warn(`📕 [XHS] 回复失败(DOM选择器不匹配)，跳过重试直接降级:`, result.message);
                            } else {
                                // 其他错误（网络/加载慢等）可以重试
                                const replyRetries = [3000, 4000, 5000];
                                for (let i = 0; i < replyRetries.length && !result.success; i++) {
                                    console.warn(`📕 [XHS] 回复失败(${i+1}/${replyRetries.length})，${replyRetries[i]/1000}秒后重试:`, result.message);
                                    await new Promise(r => setTimeout(r, replyRetries[i]));
                                    result = await xhsReplyComment(xhsConf, noteId, xsecToken, replyContent, commentId, commentUserId, parentCommentId);
                                }
                            }
                            if (result.success) {
                                addToast(`📕 ${char.name}回复了一条评论`, 'success');
                            } else {
                                // 降级为顶级评论（带 @mention 保留回复上下文）
                                console.warn(`📕 [XHS] 回复失败，降级为 @提及 评论:`, result.message);
                                const fallbackContent = commentAuthorName
                                    ? `@${commentAuthorName} ${replyContent}`
                                    : replyContent;
                                let fallback = await xhsComment(xhsConf, noteId, fallbackContent, xsecToken);
                                if (!fallback.success) {
                                    console.warn(`📕 [XHS] 顶级评论也失败，3秒后重试:`, fallback.message);
                                    await new Promise(r => setTimeout(r, 3000));
                                    fallback = await xhsComment(xhsConf, noteId, fallbackContent, xsecToken);
                                }
                                if (fallback.success) {
                                    addToast(`📕 ${char.name}评论了一条笔记（@提及回复）`, 'success');
                                } else {
                                    addToast(`回复失败: ${result.message}`, 'error');
                                }
                            }
                        } catch (e) { console.error('📕 [XHS] 回复异常:', e); }
                        setXhsStatus('');
                    } else {
                        console.warn('📕 [XHS] 回复缺少 xsecToken 或内容');
                    }
                }
                aiContent = aiContent.replace(xhsReplyMatch[0], '').trim();
            } else if (xhsReplyMatch) {
                aiContent = aiContent.replace(xhsReplyMatch[0], '').trim();
            }
            aiContent = aiContent.replace(/\[\[XHS_REPLY:.*?\]\]/g, '').trim();

            // [[XHS_LIKE: noteId]] - 点赞笔记
            // Bridge 会自动获取缺失的 xsecToken，前端不再阻止
            const xhsLikeMatches = aiContent.matchAll(/\[\[XHS_LIKE:\s*(.+?)\]\]/g);
            for (const xhsLikeMatch of xhsLikeMatches) {
                if (xhsConf.enabled) {
                    const noteId = xhsLikeMatch[1].trim();
                    const xsecToken = findXsecToken(noteId, lastXhsNotes);
                    console.log(`📕 [XHS] AI要点赞笔记:`, noteId, xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
                    try {
                        const result = await xhsLike(xhsConf, noteId, xsecToken || '');
                        if (result.success) {
                            addToast(`📕 ${char.name}点赞了一条笔记`, 'success');
                        } else {
                            console.warn('📕 [XHS] 点赞失败:', result.message);
                        }
                    } catch (e) { console.error('📕 [XHS] 点赞异常:', e); }
                }
            }
            aiContent = aiContent.replace(/\[\[XHS_LIKE:.*?\]\]/g, '').trim();

            // [[XHS_FAV: noteId]] - 收藏笔记
            const xhsFavMatches = aiContent.matchAll(/\[\[XHS_FAV:\s*(.+?)\]\]/g);
            for (const xhsFavMatch of xhsFavMatches) {
                if (xhsConf.enabled) {
                    const noteId = xhsFavMatch[1].trim();
                    const xsecToken = findXsecToken(noteId, lastXhsNotes);
                    console.log(`📕 [XHS] AI要收藏笔记:`, noteId, xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
                    try {
                        const result = await xhsFavorite(xhsConf, noteId, xsecToken || '');
                        if (result.success) {
                            addToast(`📕 ${char.name}收藏了一条笔记`, 'success');
                        } else {
                            console.warn('📕 [XHS] 收藏失败:', result.message);
                        }
                    } catch (e) { console.error('📕 [XHS] 收藏异常:', e); }
                }
            }
            aiContent = aiContent.replace(/\[\[XHS_FAV:.*?\]\]/g, '').trim();

            // [[XHS_MY_PROFILE]] - 查看自己的小红书主页
            const xhsProfileMatch = aiContent.match(/\[\[XHS_MY_PROFILE\]\]/);
            if (xhsProfileMatch && xhsConf.enabled) {
                console.log(`📕 [XHS] AI要查看自己的主页`);
                setXhsStatus('正在查看小红书主页...');

                try {
                    const nickname = xhsConf.loggedInNickname || '';
                    const userId = xhsConf.loggedInUserId || '';

                    let profileStr = '';
                    let feedsStr = '（获取笔记失败）';
                    let gotProfile = false;

                    // 方法1: 如果有 userId，用 getUserProfile 获取主页（最准确）
                    if (userId) {
                        console.log(`📕 [XHS] 用 getUserProfile(${userId}) 获取主页...`);
                        setXhsStatus('正在获取主页信息...');
                        try {
                            const profileResult = await XhsMcpClient.getUserProfile(xhsConf.mcpUrl, userId, xhsConf.userXsecToken);
                            if (profileResult.success && profileResult.data) {
                                const d = profileResult.data;
                                if (typeof d === 'string') {
                                    profileStr = d.slice(0, 3000);
                                    gotProfile = true;
                                } else {
                                    // 只用 basic_info 作为 profileStr，避免整个 JSON 被截断
                                    const basicInfo = d.data?.basic_info || d.basic_info;
                                    if (basicInfo) {
                                        profileStr = JSON.stringify(basicInfo, null, 2).slice(0, 2000);
                                    } else {
                                        // basicInfo 为空时，只提取非笔记字段，避免把 notes 数组塞进 profileStr
                                        const { notes: _n, ...rest } = (d.data && typeof d.data === 'object' ? d.data : d) as any;
                                        profileStr = Object.keys(rest).length > 0
                                            ? JSON.stringify(rest, null, 2).slice(0, 2000)
                                            : '（主页基本信息暂时无法获取）';
                                    }
                                    gotProfile = true;
                                    // 尝试从 profile 结果中提取笔记列表
                                    // Bridge 模式返回 { code: 0, data: { notes, basic_info } }，需要解包
                                    const unwrapped = d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : d;
                                    console.log(`📕 [XHS] profile unwrapped keys:`, Object.keys(unwrapped), 'notes isArray:', Array.isArray(unwrapped.notes), 'notes length:', unwrapped.notes?.length);
                                    const notes = extractNotesFromMcpData(unwrapped);
                                    console.log(`📕 [XHS] extractNotesFromMcpData 返回 ${notes.length} 条笔记`);
                                    if (notes.length > 0) {
                                        // 打印第一条笔记的原始结构帮助调试
                                        console.log(`📕 [XHS] 第一条笔记原始 keys:`, Object.keys(notes[0]), 'noteCard?', !!notes[0].noteCard, 'id?', notes[0].id || notes[0].noteId);
                                        const normalized = notes.map(n => normalizeNote(n) as XhsNote);
                                        console.log(`📕 [XHS] 归一化后第一条:`, JSON.stringify(normalized[0]).slice(0, 300));
                                        // 检查归一化结果是否有效（noteId 非空）
                                        const validNotes = normalized.filter(n => n.noteId);
                                        if (validNotes.length === 0) {
                                            console.warn(`📕 [XHS] ⚠️ 所有笔记归一化后 noteId 为空！原始数据:`, JSON.stringify(notes[0]).slice(0, 500));
                                        }
                                        lastXhsNotes = validNotes.length > 0 ? validNotes : normalized;
                                        cacheXsecTokens(lastXhsNotes);
                                        feedsStr = lastXhsNotes.slice(0, 8).map((n, i) =>
                                            `${i + 1}. [noteId=${n.noteId}]「${n.title || '无标题'}」by ${n.author || '未知'} (${n.likes || 0}赞)\n   ${n.desc || '（无描述）'}`
                                        ).join('\n\n');
                                        console.log(`📕 [XHS] feedsStr 预览:`, feedsStr.slice(0, 300));
                                    } else {
                                        console.warn(`📕 [XHS] ⚠️ extractNotesFromMcpData 返回空数组! unwrapped:`, JSON.stringify(unwrapped).slice(0, 500));
                                    }
                                }
                                console.log(`📕 [XHS] getUserProfile 成功，数据长度: ${profileStr.length}`);
                            }
                        } catch (e) {
                            console.warn('📕 [XHS] getUserProfile 失败，降级到搜索:', e);
                        }
                    }

                    // 方法2: 降级 — 用昵称搜索
                    if (!gotProfile && nickname) {
                        console.log(`📕 [XHS] 降级: 用昵称「${nickname}」搜索...`);
                        setXhsStatus('正在搜索你的笔记...');
                        const searchResult = await xhsSearch(xhsConf, nickname);
                        if (searchResult.success && searchResult.notes.length > 0) {
                            lastXhsNotes = searchResult.notes;
                            cacheXsecTokens(searchResult.notes);
                            feedsStr = searchResult.notes.slice(0, 8).map((n, i) =>
                                `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc || '（无描述）'}`
                            ).join('\n\n');
                        } else {
                            feedsStr = '（没有搜到相关笔记）';
                        }
                    }

                    if (!nickname && !userId) {
                        console.warn('📕 [XHS] 无昵称也无userId，无法查看主页。请在设置中填写。');
                        feedsStr = '（无法获取主页：请在设置-小红书中填写你的昵称或用户ID）';
                    }

                    const profileSection = gotProfile
                        ? `\n\n你的主页信息:\n${profileStr}`
                        : '';

                    const cleanedForXhs = aiContent.replace(/\[\[XHS_MY_PROFILE\]\]/g, '').trim() || '让我看看我的小红书...';
                    const xhsMessages = [
                        ...fullMessages,
                        { role: 'assistant', content: cleanedForXhs },
                        { role: 'user', content: `[系统: 你打开了自己的小红书]\n\n你的小红书账号昵称: ${nickname || '未知'}${userId ? ` (userId: ${userId})` : ''}${profileSection}\n\n${gotProfile ? '你的笔记' : `搜索「${nickname}」找到的相关笔记`}:\n${feedsStr}\n\n[系统: ${gotProfile ? '以上是你的主页数据。' : '注意，搜索结果可能包含别人的帖子，你需要辨别哪些是你自己发的（看作者名字）。'}现在请你：\n1. 自然地聊聊你看到了什么，"我看了看我的小红书..."、"我之前发的那个帖子..."\n2. 如果想发新笔记，可以用 [[XHS_POST: 标题 | 内容 | #标签1 #标签2]]\n3. 如果想看某条笔记的详细内容，可以用 [[XHS_DETAIL: noteId]]\n4. 严禁再输出[[XHS_MY_PROFILE]]标记]` }
                    ];

                    data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ model: effectiveApi.model, messages: xhsMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                    });
                    updateTokenUsage(data, historyMsgCount, 'xhs-profile');
                    aiContent = data.choices?.[0]?.message?.content || '';
                    aiContent = normalizeAiContent(aiContent);
                    addToast(`📕 ${char.name}看了看自己的小红书`, 'info');
                } catch (e) {
                    console.error('📕 [XHS] 查看主页异常:', e);
                    aiContent = aiContent.replace(xhsProfileMatch[0], '').trim();
                }
                setXhsStatus('');
            } else if (xhsProfileMatch) {
                aiContent = aiContent.replace(xhsProfileMatch[0], '').trim();
            }
            aiContent = aiContent.replace(/\[\[XHS_MY_PROFILE\]\]/g, '').trim();

            // [[XHS_DETAIL: noteId]] - 查看笔记详情（含正文和评论）
            const xhsDetailMatch = aiContent.match(/\[\[XHS_DETAIL:\s*(.+?)\]\]/);
            if (xhsDetailMatch && xhsConf.enabled) {
                const noteId = xhsDetailMatch[1].trim();
                let xsecToken = findXsecToken(noteId, lastXhsNotes);
                console.log(`📕 [XHS] AI要查看笔记详情:`, noteId, xsecToken ? '(有xsecToken)' : '(无xsecToken)');
                setXhsStatus('正在查看笔记详情...');

                try {
                    let result = await XhsMcpClient.getNoteDetail(xhsConf.mcpUrl, noteId, xsecToken, { loadAllComments: true });

                    // 如果失败（通常是 xsec_token 过期导致 noteDetailMap 找不到），尝试重新搜索拿新 token
                    if (!result.success || !result.data) {
                        const cachedTitle = noteTitleCacheRef.current.get(noteId);
                        if (cachedTitle) {
                            console.log(`📕 [XHS] 详情失败，尝试重新搜索「${cachedTitle}」以刷新 xsecToken...`);
                            setXhsStatus('正在刷新访问凭证...');
                            const refreshResult = await xhsSearch(xhsConf, cachedTitle);
                            if (refreshResult.success && refreshResult.notes.length > 0) {
                                cacheXsecTokens(refreshResult.notes);
                                lastXhsNotes = refreshResult.notes;
                                // 在新结果中查找同一篇笔记
                                const refreshedNote = refreshResult.notes.find(n => n.noteId === noteId);
                                if (refreshedNote?.xsecToken) {
                                    xsecToken = refreshedNote.xsecToken;
                                    console.log(`📕 [XHS] 拿到新 xsecToken，重试 detail...`);
                                    setXhsStatus('正在查看笔记详情...');
                                    result = await XhsMcpClient.getNoteDetail(xhsConf.mcpUrl, noteId, xsecToken, { loadAllComments: true });
                                } else {
                                    console.warn(`📕 [XHS] 重新搜索结果中未找到 noteId=${noteId}`);
                                }
                            } else {
                                console.warn(`📕 [XHS] 重新搜索「${cachedTitle}」失败:`, refreshResult.message);
                            }
                        } else {
                            console.warn(`📕 [XHS] 详情失败且无缓存标题，无法重试`);
                        }
                    }

                    // 从 detail 数据中缓存 xsecToken（CDP fallback 的 noteDetailMap 里含有 xsecToken）
                    if (result.success && result.data && typeof result.data === 'object') {
                        const d = result.data;
                        const noteObj = d.note || d;
                        const detailToken = noteObj?.xsecToken || noteObj?.xsec_token || d?.xsecToken;
                        if (detailToken && noteId) {
                            xsecTokenCacheRef.current.set(noteId, detailToken);
                            console.log(`📕 [XHS] 从 detail 缓存 xsecToken: ${noteId}`);
                        }
                    }

                    // 从 detail 数据中缓存 commentId → userId/authorName/parentId，供 reply_comment 使用
                    if (result.success && result.data && typeof result.data === 'object') {
                        const cacheComments = (comments: any[], parentId?: string) => {
                            for (const c of comments) {
                                const cid = c.id || c.commentId || c.comment_id;
                                const uid = c.userInfo?.userId || c.userInfo?.user_id || c.user_id || c.userId;
                                const authorName = c.userInfo?.nickname || c.userInfo?.name || c.nickname || c.userName || c.user_name;
                                if (cid && uid) {
                                    commentUserIdCacheRef.current.set(cid, uid);
                                }
                                if (cid && authorName) {
                                    commentAuthorNameCacheRef.current.set(cid, authorName);
                                }
                                if (cid && parentId) {
                                    commentParentIdCacheRef.current.set(cid, parentId);
                                }
                                // 子评论（传递当前评论 id 作为 parentId）
                                if (Array.isArray(c.subComments)) cacheComments(c.subComments, cid);
                                if (Array.isArray(c.sub_comments)) cacheComments(c.sub_comments, cid);
                            }
                        };
                        const d = result.data;
                        // 兼容多种评论数据路径：顶层 comments / note.comments / 嵌套 data.comments
                        const commentList = d.data?.comments?.list || d.comments?.list
                            || d.data?.comments || d.comments
                            || d.note?.comments?.list || d.note?.comments;
                        if (Array.isArray(commentList)) {
                            cacheComments(commentList);
                            console.log(`📕 [XHS] 缓存了 ${commentUserIdCacheRef.current.size} 条评论的 userId, ${commentAuthorNameCacheRef.current.size} 条 authorName`);
                        } else {
                            console.warn(`📕 [XHS] 未找到评论数组, d keys:`, Object.keys(d), 'd.note keys:', d.note ? Object.keys(d.note) : 'N/A');
                        }
                    }

                    // 无论成功还是失败，都给 AI 反馈，让它自然地回应
                    const detailData = result.success ? result.data : null;
                    let detailStr: string;
                    if (detailData) {
                        if (typeof detailData === 'string') {
                            if (detailData.includes('失败') || detailData.includes('not found')) {
                                detailStr = `[加载失败: ${detailData.slice(0, 200)}]`;
                            } else {
                                detailStr = detailData.slice(0, 5000);
                            }
                        } else {
                            // 智能格式化：笔记摘要 + 完整评论区，避免被截断
                            // MCP 服务器返回数据可能嵌套在 data 层下: { data: { note: {...}, comments: { list: [...] } } }
                            const innerData = (detailData as any).data && typeof (detailData as any).data === 'object' ? (detailData as any).data : null;
                            const note = innerData?.note || (detailData as any).note || detailData;
                            const noteTitle = note.title || note.displayTitle || note.display_title || '';
                            const noteDesc = (note.desc || note.description || note.content || '').slice(0, 1500);
                            const noteAuthor = note.user?.nickname || note.author || '';
                            const noteLikes = note.interactInfo?.likedCount || note.likes || 0;
                            const noteCollects = note.interactInfo?.collectedCount || note.collects || 0;
                            const noteShareCount = note.interactInfo?.shareCount || 0;
                            const noteCommentCount = note.interactInfo?.commentCount || 0;
                            const noteTime = note.time ? new Date(note.time).toLocaleString('zh-CN') : '';
                            const noteIp = note.ipLocation || '';

                            let noteSection = `📝 笔记详情:\n标题: ${noteTitle}\n作者: ${noteAuthor}`;
                            if (noteTime) noteSection += `\n发布时间: ${noteTime}`;
                            if (noteIp) noteSection += `\n IP: ${noteIp}`;
                            noteSection += `\n互动: ${noteLikes}赞 ${noteCollects}收藏 ${noteCommentCount}评论 ${noteShareCount}分享`;
                            noteSection += `\n\n正文:\n${noteDesc}`;

                            // 提取评论（兼容多种路径，包括 MCP 服务器的 data.comments.list 嵌套）
                            const rawComments = innerData?.comments?.list || innerData?.comments
                                || (detailData as any).comments?.list || (detailData as any).comments
                                || note.comments?.list || note.comments || [];
                            const commentArr = Array.isArray(rawComments) ? rawComments : [];

                            let commentsSection = '';
                            if (commentArr.length > 0) {
                                const formatComment = (c: any, indent = '') => {
                                    const name = c.userInfo?.nickname || c.nickname || c.userName || '匿名';
                                    const content = c.content || '';
                                    const likes = c.likeCount || c.like_count || c.likes || 0;
                                    const cid = c.id || c.commentId || c.comment_id || '';
                                    let line = `${indent}${name}: ${content} (${likes}赞) [commentId=${cid}]`;
                                    const subs = c.subComments || c.sub_comments || [];
                                    if (Array.isArray(subs) && subs.length > 0) {
                                        line += '\n' + subs.slice(0, 10).map((s: any) => formatComment(s, indent + '  ↳ ')).join('\n');
                                    }
                                    return line;
                                };
                                commentsSection = `\n\n💬 评论区 (${commentArr.length}条):\n` +
                                    commentArr.slice(0, 30).map((c: any) => formatComment(c)).join('\n');
                            } else {
                                commentsSection = '\n\n💬 评论区: （暂无评论）';
                            }

                            detailStr = (noteSection + commentsSection).slice(0, 8000);
                        }
                    } else {
                        detailStr = `[加载失败: ${result.error || '无法获取笔记详情，可能需要先在搜索/浏览结果中看到这条笔记'}]`;
                    }

                    const detailFailed = detailStr.startsWith('[加载失败');
                    const cleanedForXhs = aiContent.replace(/\[\[XHS_DETAIL:.*?\]\]/g, '').trim() || '让我看看这条笔记...';
                    const xhsMessages = [
                        ...fullMessages,
                        { role: 'assistant', content: cleanedForXhs },
                        { role: 'user', content: detailFailed
                            ? `[系统: 你尝试打开一条小红书笔记（noteId=${noteId}），但加载失败了]\n\n${detailStr}\n\n[系统: 笔记详情页加载失败了。可能的原因：这条笔记需要先通过搜索或浏览才能打开详情。现在请你：\n1. 自然地告知用户"这条笔记打不开/加载不出来"\n2. 可以建议搜索相关关键词再试: [[XHS_SEARCH: 关键词]]\n3. 严禁再输出[[XHS_DETAIL:...]]标记]`
                            : `[系统: 你点开了一条小红书笔记的详情页（noteId=${noteId}）]\n\n${detailStr}\n\n[系统: 你已经看完了这条笔记的完整内容和评论区。现在请你：\n1. 自然地分享你看到的内容和感受\n2. 如果想评论这条笔记，可以用 [[XHS_COMMENT: ${noteId} | 评论内容]]\n3. 如果想回复某条评论，可以用 [[XHS_REPLY: ${noteId} | commentId | 回复内容]]（commentId 在上面的评论区数据里）\n4. 如果想点赞，可以用 [[XHS_LIKE: ${noteId}]]；想收藏可以用 [[XHS_FAV: ${noteId}]]\n5. 严禁再输出[[XHS_DETAIL:...]]标记]` }
                    ];

                    data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ model: effectiveApi.model, messages: xhsMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                    });
                    updateTokenUsage(data, historyMsgCount, 'xhs-detail');
                    aiContent = data.choices?.[0]?.message?.content || '';
                    aiContent = normalizeAiContent(aiContent);
                    addToast(`📕 ${char.name}${detailFailed ? '尝试查看一条笔记（加载失败）' : '看了一条笔记的详情'}`, 'info');
                } catch (e) {
                    console.error('📕 [XHS] 查看详情异常:', e);
                    aiContent = aiContent.replace(xhsDetailMatch[0], '').trim();
                }
                setXhsStatus('');
            } else if (xhsDetailMatch) {
                aiContent = aiContent.replace(xhsDetailMatch[0], '').trim();
            }
            aiContent = aiContent.replace(/\[\[XHS_DETAIL:.*?\]\]/g, '').trim();

            // 5.10.1 Second-round XHS action processing
            // After [[XHS_DETAIL]] (and [[XHS_MY_PROFILE]]) the AI generates new aiContent
            // that may contain COMMENT / LIKE / FAV / REPLY / POST tags.
            // These were already checked above but the aiContent was different back then,
            // so we must re-check here.

            // [[XHS_COMMENT: noteId | 评论内容]] (second round)
            const xhsCommentMatch2 = aiContent.match(/\[\[XHS_COMMENT:\s*(.+?)\]\]/);
            if (xhsCommentMatch2 && xhsConf.enabled) {
                const commentRaw = xhsCommentMatch2[1].trim();
                const sepIdx = commentRaw.indexOf('|');
                if (sepIdx > 0) {
                    const noteId = commentRaw.slice(0, sepIdx).trim();
                    const commentContent = commentRaw.slice(sepIdx + 1).trim();
                    const xsecToken = findXsecToken(noteId, lastXhsNotes);
                    console.log(`📕 [XHS] AI要评论笔记(detail后):`, noteId, commentContent.slice(0, 30), xsecToken ? '(有xsecToken)' : '(无xsecToken)');
                    setXhsStatus('正在评论...');
                    try {
                        const result = await xhsComment(xhsConf, noteId, commentContent, xsecToken);
                        if (result.success) {
                            await DB.saveMessage({
                                charId: char.id,
                                role: 'system',
                                type: 'text',
                                content: `📕 ${char.name}在小红书评论了: "${commentContent.slice(0, 100)}${commentContent.length > 100 ? '...' : ''}"`
                            });
                            addToast(`📕 ${char.name}在小红书留了评论`, 'success');
                        } else {
                            addToast(`评论失败: ${result.message}`, 'error');
                        }
                    } catch (e) {
                        console.error('📕 [XHS] 评论异常(detail后):', e);
                    }
                }
                setXhsStatus('');
            }
            aiContent = aiContent.replace(/\[\[XHS_COMMENT:.*?\]\]/g, '').trim();

            // [[XHS_REPLY: noteId | commentId | 回复内容]] (second round)
            // ⚠️ REPLY 必须在 LIKE/FAV 之前执行，因为 like_feed 会导航到帖子页面，
            // 改变 MCP 浏览器状态，导致 reply_comment_in_feed 找不到评论
            const xhsReplyMatch2 = aiContent.match(/\[\[XHS_REPLY:\s*(.+?)\]\]/);
            if (xhsReplyMatch2 && xhsConf.enabled) {
                const parts = xhsReplyMatch2[1].split('|').map(s => s.trim());
                if (parts.length >= 3) {
                    const [noteId, commentId, ...replyParts] = parts;
                    const replyContent = replyParts.join('|').trim();
                    const xsecToken = findXsecToken(noteId, lastXhsNotes);
                    const commentUserId = commentUserIdCacheRef.current.get(commentId);
                    const commentAuthorName = commentAuthorNameCacheRef.current.get(commentId);
                    const parentCommentId = commentParentIdCacheRef.current.get(commentId);
                    if (replyContent) {
                        console.log(`📕 [XHS] AI要回复评论(detail后):`, noteId, commentId, replyContent.slice(0, 30),
                            commentUserId ? `(userId=${commentUserId})` : '(无userId)',
                            commentAuthorName ? `(author=${commentAuthorName})` : '',
                            parentCommentId ? `(parentId=${parentCommentId})` : '(顶级评论)',
                            xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
                        setXhsStatus('正在回复评论...');
                        try {
                            let result = await xhsReplyComment(xhsConf, noteId, xsecToken || '', replyContent, commentId, commentUserId, parentCommentId);
                            // "未找到评论" = MCP 服务端 DOM 选择器对不上小红书页面结构（已知 bug），重试无意义
                            const selectorBroken = !result.success && result.message?.includes('未找到评论');
                            if (selectorBroken) {
                                console.warn(`📕 [XHS] 回复失败(detail后)(DOM选择器不匹配)，跳过重试直接降级:`, result.message);
                            } else {
                                // 其他错误（网络/加载慢等）可以重试
                                const replyRetries = [3000, 4000, 5000];
                                for (let i = 0; i < replyRetries.length && !result.success; i++) {
                                    console.warn(`📕 [XHS] 回复失败(detail后)(${i+1}/${replyRetries.length})，${replyRetries[i]/1000}秒后重试:`, result.message);
                                    await new Promise(r => setTimeout(r, replyRetries[i]));
                                    result = await xhsReplyComment(xhsConf, noteId, xsecToken || '', replyContent, commentId, commentUserId, parentCommentId);
                                }
                            }
                            if (result.success) {
                                addToast(`📕 ${char.name}回复了一条评论`, 'success');
                            } else {
                                // 降级为顶级评论（带 @mention 保留回复上下文）
                                console.warn(`📕 [XHS] 回复失败(detail后)，降级为 @提及 评论:`, result.message);
                                const fallbackContent = commentAuthorName
                                    ? `@${commentAuthorName} ${replyContent}`
                                    : replyContent;
                                let fallback = await xhsComment(xhsConf, noteId, fallbackContent, xsecToken || '');
                                if (!fallback.success) {
                                    console.warn(`📕 [XHS] 顶级评论也失败(detail后)，3秒后重试:`, fallback.message);
                                    await new Promise(r => setTimeout(r, 3000));
                                    fallback = await xhsComment(xhsConf, noteId, fallbackContent, xsecToken);
                                }
                                if (fallback.success) {
                                    addToast(`📕 ${char.name}评论了一条笔记（@提及回复）`, 'success');
                                } else {
                                    addToast(`回复失败: ${result.message}`, 'error');
                                }
                            }
                        } catch (e) { console.error('📕 [XHS] 回复异常(detail后):', e); }
                        setXhsStatus('');
                    } else {
                        console.warn('📕 [XHS] 回复缺少 xsecToken 或内容(detail后)');
                    }
                }
            }
            aiContent = aiContent.replace(/\[\[XHS_REPLY:.*?\]\]/g, '').trim();

            // [[XHS_LIKE: noteId]] (second round)
            // Bridge 会自动获取缺失的 xsecToken，前端不再阻止
            const xhsLikeMatches2 = aiContent.matchAll(/\[\[XHS_LIKE:\s*(.+?)\]\]/g);
            for (const xhsLikeMatch of xhsLikeMatches2) {
                if (xhsConf.enabled) {
                    const noteId = xhsLikeMatch[1].trim();
                    const xsecToken = findXsecToken(noteId, lastXhsNotes);
                    console.log(`📕 [XHS] AI要点赞笔记(detail后):`, noteId, xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
                    try {
                        const result = await xhsLike(xhsConf, noteId, xsecToken || '');
                        if (result.success) {
                            addToast(`📕 ${char.name}点赞了一条笔记`, 'success');
                        } else {
                            console.warn('📕 [XHS] 点赞失败(detail后):', result.message);
                        }
                    } catch (e) { console.error('📕 [XHS] 点赞异常(detail后):', e); }
                }
            }
            aiContent = aiContent.replace(/\[\[XHS_LIKE:.*?\]\]/g, '').trim();

            // [[XHS_FAV: noteId]] (second round)
            const xhsFavMatches2 = aiContent.matchAll(/\[\[XHS_FAV:\s*(.+?)\]\]/g);
            for (const xhsFavMatch of xhsFavMatches2) {
                if (xhsConf.enabled) {
                    const noteId = xhsFavMatch[1].trim();
                    const xsecToken = findXsecToken(noteId, lastXhsNotes);
                    console.log(`📕 [XHS] AI要收藏笔记(detail后):`, noteId, xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
                    try {
                        const result = await xhsFavorite(xhsConf, noteId, xsecToken || '');
                        if (result.success) {
                            addToast(`📕 ${char.name}收藏了一条笔记`, 'success');
                        } else {
                            console.warn('📕 [XHS] 收藏失败(detail后):', result.message);
                        }
                    } catch (e) { console.error('📕 [XHS] 收藏异常(detail后):', e); }
                }
            }
            aiContent = aiContent.replace(/\[\[XHS_FAV:.*?\]\]/g, '').trim();

            // [[XHS_POST: 标题 | 内容 | #标签1 #标签2]] (second round - after MY_PROFILE)
            const xhsPostMatch2 = aiContent.match(/\[\[XHS_POST:\s*(.+?)\]\]/s);
            if (xhsPostMatch2 && xhsConf.enabled) {
                const postRaw = xhsPostMatch2[1].trim();
                const parts = postRaw.split('|').map(p => p.trim());
                const postTitle = parts[0] || '';
                const postContent = parts[1] || '';
                const postTags = (parts[2] || '').match(/#(\S+)/g)?.map(t => t.replace('#', '')) || [];
                console.log(`📕 [XHS] AI要发小红书(profile后):`, postTitle);
                setXhsStatus(`正在发布小红书: ${postTitle}...`);
                try {
                    const result = await xhsPublish(xhsConf, postTitle, postContent, postTags);
                    if (result.success) {
                        console.log('📕 [XHS] 发布成功(profile后):', result.noteId);
                        const tagsStr = postTags.length > 0 ? ` #${postTags.join(' #')}` : '';
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'system',
                            type: 'text',
                            content: `📕 ${char.name}发了一条小红书「${postTitle}」\n${postContent.slice(0, 200)}${postContent.length > 200 ? '...' : ''}${tagsStr}`
                        });
                        addToast(`📕 ${char.name}发了一条小红书!`, 'success');
                    } else {
                        console.error('📕 [XHS] 发布失败(profile后):', result.message);
                        addToast(`小红书发布失败: ${result.message}`, 'error');
                    }
                } catch (e) {
                    console.error('📕 [XHS] 发布异常(profile后):', e);
                }
                setXhsStatus('');
            }
            aiContent = aiContent.replace(/\[\[XHS_POST:.*?\]\]/gs, '').trim();

            // 6. Parse Actions (Poke, Transfer, Schedule, Music, etc.)
            // 购物/外卖功能关闭时，不做任何购物/外卖专属解析或转账拦截，让原版动作链保持原样。
            const commerceFeatureActive = isNuomiCommerceFeatureEnabled();
            // 外卖代付时，有些模型会沿用原版“转账”动作。这里先拦截，改成外卖支付结果卡片，避免出现转账气泡。
            const latestPendingDeliveryRequest = commerceFeatureActive ? findLatestPendingDeliveryRequest(contextMsgs) : undefined;
            let commercePaymentHandled = false;
            if (commerceFeatureActive && latestPendingDeliveryRequest) {
                const transferMatchForDelivery = aiContent.match(/\[\[ACTION:TRANSFER:(\d+(?:\.\d+)?)\]\]/);
                if (transferMatchForDelivery) {
                    const paidCard = createDeliveryPaymentResultCard(
                        latestPendingDeliveryRequest,
                        true,
                        char.name,
                        userProfile.name || '我',
                        'TA选择支付这笔外卖代付请求。',
                        undefined,
                        Number(transferMatchForDelivery[1]),
                    );
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'assistant',
                        type: 'commerce_card',
                        content: commerceCardToContent(paidCard),
                        metadata: { source: 'nuomi-commerce-payment-transfer-guard', commerceCard: paidCard },
                    } as any);
                    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                    commercePaymentHandled = true;
                    aiContent = stripDeliveryPaymentNoise(aiContent.replace(transferMatchForDelivery[0], '').trim());
                }
            }
            aiContent = await ChatParser.parseAndExecuteActions(aiContent, char.id, char.name, addToast, {
                getListeningSnapshot: () => {
                    if (!music.current) return null;
                    return {
                        songId: music.current.id,
                        name: music.current.name,
                        artists: music.current.artists,
                        album: music.current.album,
                        albumPic: music.current.albumPic,
                        duration: music.current.duration,
                        fee: music.current.fee,
                    };
                },
                joinListeningTogether: (cid: string) => {
                    music.addListeningPartner(cid);
                },
                addSongToCharPlaylist: async (cid, song, target) => {
                    try {
                        const all = await DB.getAllCharacters();
                        const targetChar = all.find(c => c.id === cid);
                        if (!targetChar) return null;
                        const profile = targetChar.musicProfile;
                        if (!profile) return null;

                        const now = Date.now();
                        let playlists = profile.playlists.slice();
                        let chosenIdx = -1;
                        let created = false;

                        if (target?.kind === 'new') {
                            // 新建歌单 — 标题去重（已存在同名就当成 existing 处理）
                            const dup = playlists.findIndex(p =>
                                p.title.trim().toLowerCase() === target.title.trim().toLowerCase());
                            if (dup >= 0) {
                                chosenIdx = dup;
                            } else {
                                playlists.push({
                                    id: `pl-${now}-${playlists.length}`,
                                    title: target.title.trim(),
                                    description: (target.description || '').trim(),
                                    coverStyle: `gradient-0${(playlists.length % 6) + 1}`,
                                    songs: [],
                                    createdAt: now,
                                    updatedAt: now,
                                });
                                chosenIdx = playlists.length - 1;
                                created = true;
                            }
                        } else if (target?.kind === 'existing') {
                            // 按标题模糊匹配（先精确，再 includes）
                            const t = target.title.trim().toLowerCase();
                            chosenIdx = playlists.findIndex(p => p.title.trim().toLowerCase() === t);
                            if (chosenIdx < 0) chosenIdx = playlists.findIndex(p =>
                                p.title.trim().toLowerCase().includes(t) || t.includes(p.title.trim().toLowerCase()));
                            // 匹配不到 → 回落到第一个（保持加歌成功，而不是无声失败）
                            if (chosenIdx < 0 && playlists.length > 0) chosenIdx = 0;
                        } else {
                            if (playlists.length > 0) chosenIdx = 0;
                        }

                        // 实在没歌单可用（角色 profile 但 playlists 空 + 未指定 new）→ 自动建一个收藏夹
                        if (chosenIdx < 0) {
                            playlists.push({
                                id: `pl-${now}-0`,
                                title: '我喜欢的音乐',
                                description: '',
                                coverStyle: 'gradient-01',
                                songs: [],
                                createdAt: now,
                                updatedAt: now,
                            });
                            chosenIdx = 0;
                            created = true;
                        }

                        const pl = playlists[chosenIdx];
                        if (pl.songs.find(s => s.id === song.id)) {
                            // 已经在这个歌单里了 — 仍然返回成功，让上层 toast 表现一致
                            return { playlistTitle: pl.title, created: false };
                        }
                        const updatedPl = { ...pl, songs: [...pl.songs, song], updatedAt: now };
                        playlists[chosenIdx] = updatedPl;

                        const updatedProfile = { ...profile, playlists, updatedAt: now };
                        await DB.saveCharacter({ ...targetChar, musicProfile: updatedProfile });
                        return { playlistTitle: pl.title, created };
                    } catch {
                        return null;
                    }
                },
            });

            // 6.2 购物中心 / 外卖自主卡片标签：仅在插件开关开启时解析。
            const commerceParsed = commerceFeatureActive
                ? extractNuomiCommerceActions(aiContent)
                : { cleanText: aiContent, actions: [] as NuomiCommerceAction[] };
            aiContent = commerceParsed.cleanText;
            if (commerceFeatureActive && commerceParsed.actions.length > 0) {
                for (const action of commerceParsed.actions.slice(0, 3)) {
                    const actionKind = String(action.kind || action.type || '').trim();
                    const name = String(action.name || action.productInfo || action.itemName || '').trim().slice(0, 60);
                    const total = Number(action.amount ?? action.price ?? 0);
                    const note = String(action.note || action.greeting || '').trim().slice(0, 240) || undefined;

                    // 外卖代付回应：由角色在正常回复里选择 paid / rejected，系统弹出结果卡片。
                    if (actionKind === 'delivery_payment_response' || actionKind === 'waimai_response') {
                        const paid = String(action.status || '').toLowerCase() === 'paid';
                        const rejected = String(action.status || '').toLowerCase() === 'rejected';
                        if (!paid && !rejected) continue;
                        const pending = latestPendingDeliveryRequest || findLatestPendingDeliveryRequest(contextMsgs);
                        const card = createDeliveryPaymentResultCard(
                            pending,
                            paid,
                            char.name,
                            userProfile.name || '我',
                            note,
                            name,
                            Number.isFinite(total) ? total : 0,
                        );
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'assistant',
                            type: 'commerce_card',
                            content: commerceCardToContent(card),
                            metadata: { source: 'nuomi-commerce-payment', commerceCard: card },
                        } as any);
                        commercePaymentHandled = true;
                        continue;
                    }

                    const kind: CommerceCardKind = actionKind === 'char_delivery_to_user' ? 'char_delivery_to_user' : 'char_purchase_to_user';
                    const mode = kind === 'char_delivery_to_user' ? 'delivery' : 'shopping';
                    if (!name || !Number.isFinite(total) || total <= 0) continue;
                    const item: CommerceCardItem = {
                        name,
                        qty: 1,
                        price: total,
                        subtotal: total,
                        description: kind === 'char_purchase_to_user' ? '角色主动购买的物品，不要求来自商品库。' : undefined,
                        emoji: kind === 'char_delivery_to_user' ? '🥡' : '🎁',
                    };
                    const card: CommerceCardPayload = {
                        version: 2,
                        id: `commerce-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        kind,
                        title: kind === 'char_delivery_to_user' ? `${char.name}给${userProfile.name || '我'}点了外卖` : `${char.name}给${userProfile.name || '我'}买了东西`,
                        mode,
                        actorName: char.name,
                        targetName: userProfile.name || '我',
                        charName: char.name,
                        userName: userProfile.name || '我',
                        items: [item],
                        total,
                        note,
                        status: 'gifted',
                        createdAt: Date.now(),
                    };
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'assistant',
                        type: 'commerce_card',
                        content: commerceCardToContent(card),
                        metadata: { source: 'nuomi-commerce-auto', commerceCard: card },
                    } as any);
                }
                addToast('已弹出TA主动购物/外卖卡片', 'success');
            }

            // 如果模型没有按要求输出内部标签，而是自然写了“已付款/转账/拒绝支付”，也自动转成支付结果卡片。
            if (commerceFeatureActive && !commercePaymentHandled) {
                const pending = latestPendingDeliveryRequest || findLatestPendingDeliveryRequest(contextMsgs);
                const decision = pending ? detectDeliveryPaymentDecision(aiContent) : undefined;
                if (pending && decision) {
                    const card = createDeliveryPaymentResultCard(
                        pending,
                        decision === 'paid',
                        char.name,
                        userProfile.name || '我',
                        decision === 'paid' ? 'TA选择支付这笔外卖代付请求。' : 'TA选择拒绝这笔外卖代付请求。',
                    );
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'assistant',
                        type: 'commerce_card',
                        content: commerceCardToContent(card),
                        metadata: { source: 'nuomi-commerce-payment-natural', commerceCard: card },
                    } as any);
                    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                    aiContent = stripDeliveryPaymentNoise(aiContent);
                    commercePaymentHandled = true;
                }
            }

            // 6.4 思考过程展示（仅 char.showThinkingChain 开启时落库）。
            //     来源：最后一次 API 响应的 reasoning_content（DeepSeek-R1 / GLM-4.5 / QwQ 等）
            //         + 主 content 里被剥离的 <think>...</think> 块。
            //     目的：让用户可见 LLM 元思考；prompt 已经把 thinking 染成角色味，所以不再做二次区分。
            //     不会包含：emotion buff / [[INNER_STATE:]] / [html] / 正文 / quote 等 — 这些走各自管线。
            //     仅附在本回合"第一条" assistant 消息的 metadata.thinkingChain 上，避免每个 bubble 重复。
            let pendingThinkingChain: string | null = null;
            if ((char as any).showThinkingChain) {
                const lastRaw = data?.choices?.[0]?.message?.content || '';
                const lastReasoning = (data?.choices?.[0]?.message?.reasoning_content || '').trim();
                const thinkBlocks: string[] = [];
                // 配对 <think>...</think> / <thinking>...</thinking> / <thought>...</thought>
                const thinkPat = /<(think|thinking|thought)>([\s\S]*?)<\/\1>/gi;
                let tm: RegExpExecArray | null;
                while ((tm = thinkPat.exec(lastRaw)) !== null) {
                    const t = tm[2].trim();
                    if (t) thinkBlocks.push(t);
                }
                // 截断兜底：开了 <think> / <thinking> / <thought> 但没闭合的，把后续全部当思考内容
                if (!/<\/(?:think|thinking|thought)>/i.test(lastRaw)) {
                    const openOnly = lastRaw.match(/<(?:think|thinking|thought)>([\s\S]*$)/i);
                    if (openOnly && openOnly[1].trim()) thinkBlocks.push(openOnly[1].trim());
                }
                const chain = [lastReasoning, ...thinkBlocks].filter(s => !!s).join('\n\n').trim();
                if (chain) pendingThinkingChain = chain;
            }
            const mergeAssistantMeta = (base: any): any => {
                if (!pendingThinkingChain) return base;
                const merged = { ...(base || {}), thinkingChain: pendingThinkingChain };
                pendingThinkingChain = null;
                return merged;
            };

            // 6.5 HTML 卡片：把 [html]...[/html] 块抽出来落库为 html_card 消息，
            //     content 只存"剥离 HTML 后的纯文字摘要"（注入历史 / 归档 都用这个），
            //     原始 HTML 放在 metadata.htmlSource，供 MessageItem 沙盒渲染。
            //     这样既不污染上下文 token，也保留了可视化卡片。
            //     注意：在 quote/sanitize 之前抽，避免 sanitize 把 HTML 内容当垃圾去掉。
            if ((char as any).htmlModeEnabled && /\[html\]/i.test(aiContent)) {
                const { blocks, cleanedContent } = extractHtmlBlocks(aiContent);
                for (const blk of blocks) {
                    try {
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'assistant',
                            type: 'html_card',
                            content: blk.textPreview ? `[HTML卡片] ${blk.textPreview}` : '[HTML卡片]',
                            metadata: mergeAssistantMeta({
                                htmlSource: blk.html,
                                htmlTextPreview: blk.textPreview,
                                ...(mcdInheritMeta || {}),
                            }),
                        } as any);
                        setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                        // 给视觉留一点呼吸感
                        await new Promise(r => setTimeout(r, 300));
                    } catch (e) {
                        console.error('[HTML] 落库 html_card 失败', e);
                    }
                }
                aiContent = cleanedContent;
            }

            // 7. Handle Quote/Reply Logic (Robust: handles [[QUOTE:...]], [QUOTE:...], typos like QUATE/QOUTE, Chinese 引用, and [回复 "..."] format)
            const QUOTE_RE_DOUBLE = /\[\[(?:QU[OA]TE|引用)[：:]\s*([\s\S]*?)\]\]/;
            const QUOTE_RE_SINGLE = /\[(?:QU[OA]TE|引用)[：:]\s*([^\]]*)\]/;
            // Match [回复 "content"] or [回复 "content"]: (AI mimics history context format)
            const REPLY_RE_CN = /\[回复\s*[""\u201C]([^""\u201D]*?)[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/;
            const QUOTE_CLEAN_DOUBLE = /\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g;
            const QUOTE_CLEAN_SINGLE = /\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g;
            const REPLY_CLEAN_CN = /\[回复\s*[""\u201C][^""\u201D]*?[""\u201D](?:\.{0,3})\]\s*[：:]?\s*/g;
            let aiReplyTarget: { id: number, content: string, name: string } | undefined;
            const firstQuoteMatch = aiContent.match(QUOTE_RE_DOUBLE) || aiContent.match(QUOTE_RE_SINGLE) || aiContent.match(REPLY_RE_CN);
            if (firstQuoteMatch) {
                const quotedText = firstQuoteMatch[1].trim();
                if (quotedText) {
                    // Try exact include first, then fuzzy match (first 10 chars)
                    const targetMsg = contextMsgs.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText))
                        || (quotedText.length > 10 ? contextMsgs.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText.slice(0, 10))) : undefined);
                    if (targetMsg) {
                        const truncated = targetMsg.content.length > 10 ? targetMsg.content.slice(0, 10) + '...' : targetMsg.content;
                        aiReplyTarget = { id: targetMsg.id, content: truncated, name: userProfile.name };
                    }
                }
            }
            // 8. Split and Stream (Simulate Typing)
            // Note: SEND_EMOJI tags are preserved through sanitize so splitResponse can interleave them with text
            // Citation tags are preserved here so each chunk can detect its own reply target;
            // they are stripped per-chunk below (and again via per-chunk sanitize for visible text).
            aiContent = ChatParser.sanitize(aiContent, { keepCitations: true });

            // 意识流（innerState）现由副 API 的情绪评估管线产出并 setEvolvedNarrative；
            // 仍然兜底清理一次，防止老 prompt 缓存或模型残留标签泄漏到用户可见内容。
            aiContent = aiContent.replace(/\[\[INNER_STATE:\s*[\s\S]*?\]\]/g, '').trim();

            // Fallback: if second-pass API calls (search/diary) returned empty, provide a minimal response
            if (!aiContent.trim() && (searchMatch || readDiaryMatch || fsReadDiaryMatch)) {
                aiContent = '嗯...';
            }
            if (aiContent) {

                // Check for <翻译> XML tags (new bilingual format)
                const hasTranslationTags = /<翻译>\s*<原文>[\s\S]*?<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/.test(aiContent);

                let globalMsgIndex = 0;

                if (hasTranslationTags) {
                    // ─── New bilingual format: each <翻译> block = one bubble ───
                    // Extract emojis for bilingual path (splitResponse not used here)
                    const bilingualEmojis: string[] = [];
                    let bEm;
                    const bEmojiPat = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
                    while ((bEm = bEmojiPat.exec(aiContent)) !== null) {
                        const name = bEm[1].trim();
                        if (!bilingualEmojis.includes(name)) bilingualEmojis.push(name);
                    }
                    aiContent = aiContent.replace(/\[\[SEND_EMOJI:\s*.*?\]\]/g, '').trim();
                    const tagPattern = /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>([\s\S]*?)<\/译文>\s*<\/翻译>/g;
                    let lastIndex = 0;
                    let tagMatch;

                    while ((tagMatch = tagPattern.exec(aiContent)) !== null) {
                        // Save any plain text BEFORE this <翻译> block
                        const textBefore = aiContent.slice(lastIndex, tagMatch.index).trim();
                        if (textBefore) {
                            const cleaned = ChatParser.sanitize(textBefore);
                            if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                                const chunks = ChatParser.chunkText(cleaned);
                                for (const chunk of chunks) {
                                    if (!chunk) continue;
                                    const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                                    await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                                    await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: chunk, replyTo: replyData, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                                    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                                    globalMsgIndex++;
                                }
                            }
                        }

                        // Save the bilingual pair (stored as langA\n%%BILINGUAL%%\nlangB for renderer compatibility)
                        const originalText = ChatParser.sanitize(tagMatch[1].trim());
                        const translatedText = ChatParser.sanitize(tagMatch[2].trim());
                        if (originalText || translatedText) {
                            const biContent = originalText && translatedText
                                ? `${originalText}\n%%BILINGUAL%%\n${translatedText}`
                                : (originalText || translatedText);
                            const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                            await new Promise(r => setTimeout(r, Math.min(Math.max(biContent.length * 30, 400), 2000)));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: biContent, replyTo: replyData, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            globalMsgIndex++;
                        }

                        lastIndex = tagMatch.index + tagMatch[0].length;
                    }

                    // Save any remaining text AFTER last <翻译> block
                    const textAfter = aiContent.slice(lastIndex).trim();
                    if (textAfter) {
                        // Strip any stray translation tags
                        const cleaned = ChatParser.sanitize(textAfter.replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '').trim());
                        if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                            const chunks = ChatParser.chunkText(cleaned);
                            for (const chunk of chunks) {
                                if (!chunk) continue;
                                const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                                await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: chunk, replyTo: replyData, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                                globalMsgIndex++;
                            }
                        }
                    }

                    // Send extracted emojis after bilingual text
                    for (const emojiName of bilingualEmojis) {
                        const foundEmoji = emojis.find(e => e.name === emojiName);
                        if (foundEmoji) {
                            await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'emoji', content: foundEmoji.url, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                        }
                    }
                } else {
                    // ─── Normal text (no bilingual tags) ───
                    // Also handles legacy %%BILINGUAL%% format for backwards compatibility
                    const parts = ChatParser.splitResponse(aiContent);
                    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
                        const part = parts[partIndex];

                        if (part.type === 'emoji') {
                            const foundEmoji = emojis.find(e => e.name === part.content);
                            if (foundEmoji) {
                                await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'emoji', content: foundEmoji.url, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            }
                        } else {
                            // Split on --- separators first, then chunkText for fine-grained splitting
                            const rawBlocks = part.content.split(/^\s*---\s*$/m).filter(b => b.trim());
                            const allChunks: string[] = [];
                            for (const block of rawBlocks) {
                                allChunks.push(...ChatParser.chunkText(block.trim()));
                            }
                            if (allChunks.length === 0 && part.content.trim()) allChunks.push(part.content.trim());

                            for (let i = 0; i < allChunks.length; i++) {
                                let chunk = allChunks[i];
                                const delay = Math.min(Math.max(chunk.length * 50, 500), 2000);
                                await new Promise(r => setTimeout(r, delay));

                                let chunkReplyTarget: { id: number, content: string, name: string } | undefined;
                                const chunkQuoteMatch = chunk.match(QUOTE_RE_DOUBLE) || chunk.match(QUOTE_RE_SINGLE) || chunk.match(REPLY_RE_CN);
                                if (chunkQuoteMatch) {
                                    const quotedText = chunkQuoteMatch[1].trim();
                                    if (quotedText) {
                                        const targetMsg = contextMsgs.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText))
                                            || (quotedText.length > 10 ? contextMsgs.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText.slice(0, 10))) : undefined);
                                        if (targetMsg) {
                                            const truncated = targetMsg.content.length > 10 ? targetMsg.content.slice(0, 10) + '...' : targetMsg.content;
                                            chunkReplyTarget = { id: targetMsg.id, content: truncated, name: userProfile.name };
                                        }
                                    }
                                    chunk = chunk.replace(QUOTE_CLEAN_DOUBLE, '').replace(QUOTE_CLEAN_SINGLE, '').replace(REPLY_CLEAN_CN, '').trim();
                                }

                                // Per-chunk citation detection above handles every quote tag in the message,
                                // so each bubble gets the citation that was actually inline in its own chunk.
                                const replyData = chunkReplyTarget;

                                if (ChatParser.hasDisplayContent(chunk)) {
                                    const cleanChunk = ChatParser.sanitize(chunk);
                                    if (cleanChunk) {
                                        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: cleanChunk, replyTo: replyData, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                                        setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                                        globalMsgIndex++;
                                    }
                                }
                            }
                        }
                    }
                }

            } else {
                // If content was empty (e.g. only actions), just refresh
                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
            }

        } catch (e: any) {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[连接中断: ${e.message}]` });
            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
        } finally {
            KeepAlive.stop();
            setIsTyping(false);
            setRecallStatus('');
            setSearchStatus('');
            setDiaryStatus('');
            setXhsStatus('');

            // Memory Palace — 后台缓冲区处理（不阻塞 UI，内部有并发锁）
            // 使用全局配置（memoryPalaceConfig）。lightLLM 未配置时回退主 apiConfig；
            // embedding 因端点类型特殊（/embeddings），不做回退，必须显式配置。
            const mpEmb = memoryPalaceConfig?.embedding;
            const mpLLMConfigured = memoryPalaceConfig?.lightLLM;
            const mpLLM = (mpLLMConfigured?.baseUrl)
                ? mpLLMConfigured
                : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
            if (char.memoryPalaceEnabled && mpEmb?.baseUrl && mpEmb?.apiKey && mpLLM.baseUrl) {
                const charName = char.name;
                // 不再预置"正在回味"状态：pipeline 会在水位线未到时立刻 skip，
                // 预置状态会让"沉思"指示器一闪让用户误以为在干活。
                // onProgress 在 pipeline 真正进入处理路径后（过完 hot_zone/threshold 检查）
                // 才首次触发 setMemoryPalaceStatus，这样 skip 路径下指示器不会亮。

                // 缓冲区处理（LLM提取 + Embedding向量化）
                const recentMsgs = await DB.getRecentMessagesByCharId(char.id, 50);
                processNewMessages(recentMsgs, char.id, charName, mpEmb, mpLLM, userProfile?.name || '', false, (stage) => {
                        setMemoryPalaceStatus(stage);
                    })
                    .then(async (pipelineResult) => {
                        // 显示结果让用户看到
                        if (pipelineResult && pipelineResult.stored > 0) {
                            setMemoryPalaceResult(pipelineResult);
                        }

                        // 自动归档：把 palace 提取出的记忆按日期合成 YAML bullets 追加到
                        // char.memories，同时推 hideBeforeMessageId 自动隐藏已总结的聊天
                        // 仅在 char.autoArchiveEnabled 显式开启时执行（默认 off，opt-in）
                        if (pipelineResult?.autoArchive && updateCharacter && (char as any).autoArchiveEnabled) {
                            try {
                                const mergedMemories = mergePalaceFragmentsIntoMemories(
                                    char.memories || [],
                                    pipelineResult.autoArchive.fragments,
                                );
                                updateCharacter(char.id, {
                                    memories: mergedMemories,
                                    hideBeforeMessageId: pipelineResult.autoArchive.hideBeforeMessageId,
                                } as any);
                                console.log(`📚 [AutoArchive] 追加/合并 ${pipelineResult.autoArchive.fragments.length} 条 MemoryFragment，hideBefore → ${pipelineResult.autoArchive.hideBeforeMessageId}`);
                            } catch (e: any) {
                                console.warn(`📚 [AutoArchive] 失败（不影响 palace）: ${e?.message || e}`);
                            }
                        }
                        // 轮数计数 + 自动认知消化（每50轮触发一次）
                        const shouldAutoDigest = incrementDigestRound(char.id);
                        if (shouldAutoDigest) {
                            console.log(`🧠 [AutoDigest] 已达 50 轮，自动触发认知消化...`);
                            setMemoryPalaceStatus(`${charName}闭上眼睛，开始整理内心…`);
                            const persona = [char.systemPrompt || '', char.worldview || ''].filter(Boolean).join('\n');
                            const result = await runCognitiveDigestion(char.id, charName, persona, mpLLM, false, userProfile?.name, mpEmb);
                            if (result) {
                                // 持久化自我领悟词条到角色档案
                                if (result.selfInsights.length > 0) {
                                    const existing = char.selfInsights || [];
                                    const updatedInsights = [...existing, ...result.selfInsights];
                                    await DB.saveCharacter({ ...char, selfInsights: updatedInsights });
                                }
                                const total = result.resolved.length + result.deepened.length + result.faded.length +
                                    result.fulfilled.length + result.disappointed.length + result.internalized.length +
                                    result.synthesizedUser.length + result.selfInsights.length + result.selfConfused.length;
                                if (total > 0) {
                                    setLastDigestResult(result);
                                }
                            }
                        }
                    })
                    .catch(e => { console.error('❌ [MemoryPalace] 后台处理异常:', e.message); addToast('记忆整理失败', 'error'); })
                    .finally(() => {
                        // 如果状态文本包含"完成"，先让用户看到再清除
                        const current = memoryPalaceStatusRef.current;
                        if (current && current.includes('完成')) {
                            addToast(current, 'success');
                        }
                        setMemoryPalaceStatus('');
                    });
            }

            // 意识流进化现在由副 API 的情绪评估同轮产出（innerState 字段），
            // 不再需要独立的后台 API 调用，也不再分散主 API 注意力。
        }
    };



    // ─── Proactive Messaging Controls ───
    // NOTE: The actual proactive trigger handler is registered globally in OSContext
    // so it works even when Chat is not open. These are just start/stop helpers.

    const startProactiveChat = (intervalMinutes: number) => {
        if (!char) return;
        ProactiveChat.start(char.id, intervalMinutes);
    };

    const stopProactiveChat = () => {
        if (!char) return;
        ProactiveChat.stop(char.id);
    };

    const isProactiveActive = char ? ProactiveChat.isActiveFor(char.id) : false;

    return {
        isTyping,
        recallStatus,
        searchStatus,
        diaryStatus,
        xhsStatus,
        emotionStatus,
        memoryPalaceStatus,
        memoryPalaceResult,
        setMemoryPalaceResult,
        lastDigestResult,
        setLastDigestResult,
        lastTokenUsage,
        tokenBreakdown,
        setLastTokenUsage, // Allow manual reset if needed
        triggerAI,
        startProactiveChat,
        stopProactiveChat,
        isProactiveActive,
        lastSystemPrompt,
        evolvedNarrative,
    };
};
