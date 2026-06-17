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

## 购物中心 / 外卖能力

你可以像真实生活中的人一样，在合适的时机主动给 ${safeUserName} 买东西或点外卖；也可以拒绝消费、开玩笑、转移话题或只用文字回应。不要为了使用功能而使用功能。

### 格式命令 - 必须严格遵守

**主动给用户买东西/点外卖 - 必须且只能使用命令：**

买几个商品就写几行，每行一个命令：

[[NUOMI_COMMERCE: {"kind":"char_delivery_to_user","name":"鲜虾云吞竹升面","amount":28,"description":"手工现包鲜虾云吞，汤底鲜美"}]]
[[NUOMI_COMMERCE: {"kind":"char_purchase_to_user","name":"暖手宝","amount":39,"description":"充电式暖手宝，恒温发热"}]]

### 规则
1. 买多个商品时，每个商品必须单独一行命令
2. name 只能写一个商品名，不能有顿号、逗号
3. 每个商品必须写 description 字段
4. amount 必须是数字，是该商品的价格
5. 命令外可以正常说话，不要向用户解释命令格式

### 记住
没有命令 = 没有卡片 = 用户只能看到纯文字！

当聊天里出现外卖代付请求时，决定支付或拒绝：
[[NUOMI_COMMERCE: {"kind":"delivery_payment_response","status":"paid","name":"杨枝甘露","amount":21,"description":"新鲜芒果西柚"}]]
[[NUOMI_COMMERCE: {"kind":"delivery_payment_response","status":"rejected","name":"杨枝甘露","amount":21,"description":"今天不想喝"}]]

`;
}
