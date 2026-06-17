import { describe, it, expect, vi } from 'vitest';
import { applyAssistantPostProcessing, PostProcessCtx, XhsCaches } from './applyAssistantPostProcessing';
import { DB } from './db';

// 锁住 renderAndPersist normal path 的引用顺延修复:
// 模型把 [[QUOTE:]] 单独写一行 (典型形态: 标签后紧跟 [[SEND_EMOJI:]] / 换行 + 正文),
// chunkText 按换行拆分后引用标签独占一个 chunk — 剥标签后没有正文不落库,
// 修复前解析出的引用目标随这个空 chunk 一起被丢弃, 表现为"引用被后处理吞掉"。
// 修复后引用目标顺延挂到下一条真正落库的文字气泡。

const makeCtx = (charId: string, contextMsgs: any[]): PostProcessCtx => {
    const xhsCaches: XhsCaches = {
        xsecTokenCache: new Map(),
        noteTitleCache: new Map(),
        commentUserIdCache: new Map(),
        commentAuthorNameCache: new Map(),
        commentParentIdCache: new Map(),
    };
    return {
        char: { id: charId, name: '测试角色' } as any,
        userProfile: { name: '我' } as any,
        emojis: [],
        contextMsgs,
        fullMessages: [],
        initialData: {},
        historyMsgCount: 0,
        xhsCaches,
        api: {
            baseUrl: 'http://localhost:0',
            headers: {},
            effectiveApi: { baseUrl: 'http://localhost:0', apiKey: '', model: 'test' },
        },
        hooks: {
            setMessages: vi.fn(),
            addToast: vi.fn(),
        },
    };
};

const quotedUserMsg = {
    id: 101,
    charId: 'c-quote',
    role: 'user' as const,
    type: 'text' as const,
    content: '引用我说的话，还有后面一长串内容',
    timestamp: Date.now() - 1000,
};

describe('renderAndPersist 引用解析', () => {
    it('[[QUOTE:]] 单独成行 (后跟 SEND_EMOJI + 正文) 时引用顺延到第一条文字气泡', async () => {
        const charId = `c-quote-${Date.now()}`;
        const raw = '[[QUOTE: 引用我说的话]]\n[[SEND_EMOJI: 有点生气]]\n消失了整整三十六个小时';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('消失了整整三十六个小时');
        // 修复前: replyTo 为 undefined (引用目标随空 chunk 丢失)
        expect(texts[0].replyTo).toBeTruthy();
        expect(texts[0].replyTo!.id).toBe(101);
        expect(texts[0].replyTo!.name).toBe('我');
    }, 20000);

    it('[[QUOTE:]] 与正文同一行时引用仍挂在该气泡 (既有行为不回归)', async () => {
        const charId = `c-quote-inline-${Date.now()}`;
        const raw = '[[QUOTE: 引用我说的话]]你干嘛去了';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('你干嘛去了');
        expect(texts[0].replyTo?.id).toBe(101);
    }, 20000);

    it('引用只挂一次: 顺延目标落到首条气泡后, 后续气泡不带 replyTo', async () => {
        const charId = `c-quote-once-${Date.now()}`;
        const raw = '[[QUOTE: 引用我说的话]]\n第一句话\n第二句话';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.map(m => m.content)).toEqual(['第一句话', '第二句话']);
        expect(texts[0].replyTo?.id).toBe(101);
        expect(texts[1].replyTo).toBeFalsy();
    }, 20000);
});

// 历史里引用消息被 buildMessageHistory 渲染成 [xx引用了xx说的「…」，并回复了 ↓]，
// 模型会模仿这个渲染格式而不是规范的 [[QUOTE:]]。修复前这种输出既不被识别成引用、
// 整段方括号还会原样漏进气泡；修复后认作合法引用并剥干净。
describe('renderAndPersist 模仿历史渲染格式的引用兜底', () => {
    it('[我引用了你说的「…」，并回复了 ↓] 单独成行时解析为引用并顺延到正文气泡', async () => {
        const charId = `c-nlquote-${Date.now()}`;
        const raw = '[我引用了你说的「引用我说的话」，并回复了 ↓]\n你干嘛去了';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('你干嘛去了');
        expect(texts[0].replyTo?.id).toBe(101);
        expect(texts[0].replyTo!.name).toBe('我');
    }, 20000);

    it('引用摘要带截断省略号时仍能匹配到原消息', async () => {
        const charId = `c-nlquote-ellipsis-${Date.now()}`;
        const raw = '[用户引用了你之前说的「引用我说的话，还有后面一长…」，并回复了 ↓]\n哈哈这个';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('哈哈这个');
        expect(texts[0].replyTo?.id).toBe(101);
    }, 20000);

    it('与正文同一行时引用挂在该气泡且方括号头不漏进正文', async () => {
        const charId = `c-nlquote-inline-${Date.now()}`;
        const raw = '[你引用了对方说的「引用我说的话」，并回复了 ↓] 这就解释';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('这就解释');
        expect(texts[0].content).not.toContain('引用了');
        expect(texts[0].replyTo?.id).toBe(101);
    }, 20000);

    it('正常含方括号但非引用格式的句子不被误剥', async () => {
        const charId = `c-nlquote-fp-${Date.now()}`;
        const raw = '我看了[那本书]感觉一般';

        await applyAssistantPostProcessing(raw, makeCtx(charId, [{ ...quotedUserMsg, charId }]));

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBe(1);
        expect(texts[0].content).toBe('我看了[那本书]感觉一般');
        expect(texts[0].replyTo).toBeFalsy();
    }, 20000);
});
