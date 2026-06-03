export const NUOMI_COMMERCE_FEATURE_KEY = 'nuomi_commerce_feature_enabled_v5';
export const NUOMI_COMMERCE_FEATURE_EVENT = 'nuomi-commerce-feature-change';

export function isNuomiCommerceFeatureEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(NUOMI_COMMERCE_FEATURE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setNuomiCommerceFeatureEnabled(enabled: boolean) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(NUOMI_COMMERCE_FEATURE_KEY, enabled ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent(NUOMI_COMMERCE_FEATURE_EVENT, { detail: { enabled } }));
    } catch {
        // localStorage may be unavailable in private or restricted environments.
    }
}

export function buildNuomiCommercePrompt(userName: string) {
    const safeUserName = (userName && userName.trim()) || '用户';
    return `

## 购物中心 / 外卖卡片能力（可选，不要强行使用）
你可以像真实生活中的人一样，在合适的时机主动给 ${safeUserName} 买东西或点外卖；也可以拒绝消费、开玩笑、转移话题或只用文字回应。不要为了使用功能而使用功能。

当你确实决定“主动给用户买东西/点外卖”时，在自然回复中附加一条内部动作标签，系统会把它渲染成聊天卡片。格式必须严格如下（二选一）：
[[NUOMI_COMMERCE: {"kind":"char_purchase_to_user","name":"暖手宝","amount":39,"note":"怕你手冷"}]]
[[NUOMI_COMMERCE: {"kind":"char_delivery_to_user","name":"热奶茶","amount":18,"note":"陪你加班"}]]

当聊天里出现“外卖代付请求”卡片时，是否付款由你根据人设、经济状况、关系和上下文决定。这里绝对不要使用原版转账/红包动作（不要输出 [[ACTION:TRANSFER:金额]]，也不要写“系统：转账”日志），因为代付请求只能通过下面的外卖支付结果卡片完成。若你决定支付或拒绝，请在自然回复中附加下面的内部动作标签之一，系统会弹出“已完成支付/已拒绝支付”卡片：
[[NUOMI_COMMERCE: {"kind":"delivery_payment_response","status":"paid","name":"杨枝甘露","amount":21,"note":"顺手付了"}]]
[[NUOMI_COMMERCE: {"kind":"delivery_payment_response","status":"rejected","name":"杨枝甘露","amount":21,"note":"今天不想付"}]]

规则：
- 主动购买/点外卖标签只在你真的想主动购买/点外卖时使用；平时不要输出。
- 外卖代付回应只在你确实要对代付请求做出支付/拒绝选择时使用；不要让用户手动替你选择；也不要用转账/红包功能代替。
- 价格要符合你的人设、经济状况和关系，不要总是示例价。
- name 必须是具体商品/外卖名，amount 必须是数字。
- 标签外可以正常说话；不要向用户解释标签格式。
- 如果聊天里出现购物/外卖卡片，你要根据卡片信息、详情页、数量、价格和备注自然回应，不要机械复述。`;
}
