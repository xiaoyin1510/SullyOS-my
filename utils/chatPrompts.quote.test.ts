import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import { cleanApiMessages } from './chatRequestPayload';

// 锁住「翻译模式下引用回复, 角色只看到引用、看不到用户实际回复」的修复。
//
// 链路: 双语 char 消息存储为 `原文\n%%BILINGUAL%%\n译文`; 用户引用它时 replyTo.content
// 是完整双语串。buildMessageHistory 把引用拼成
//   [用户引用了你之前说的「<摘要60字>」，并回复了 ↓]\n<用户回复>
// 修复前摘要原样截取 → %%BILINGUAL%% 混进引用头 → cleanApiMessages 在标记处整条截断
// → 「并回复了 ↓」和用户回复全被吃掉, 模型只看到半截引用头。
// 修复后摘要先剥双语标记、只取原文侧, 截断不再波及用户回复。

const char = { id: 'c1', name: '小角色' } as any;
const userProfile = { name: '我' } as any;

const BI_CONTENT = 'こんにちは、元気？\n%%BILINGUAL%%\n你好，最近好吗？';
const USER_REPLY = '我的实际回复内容，不能被吞掉';

const t0 = Date.now() - 60_000;
const makeHistory = () => ([
    { id: 1, charId: 'c1', role: 'assistant', type: 'text', content: BI_CONTENT, timestamp: t0 },
    {
        id: 2, charId: 'c1', role: 'user', type: 'text', content: USER_REPLY, timestamp: t0 + 1000,
        replyTo: { id: 1, content: BI_CONTENT, name: '小角色' },
    },
] as any[]);

describe('buildMessageHistory 引用双语消息', () => {
    it('引用摘要只取原文侧, 不把 %%BILINGUAL%% 混进引用头', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory(makeHistory(), 10, char, userProfile, []);
        const userMsg = apiMessages.find((m: any) => m.role === 'user');
        expect(userMsg).toBeTruthy();
        const content = userMsg!.content as string;
        expect(content).toContain('こんにちは、元気？');
        expect(content).toContain(USER_REPLY);
        expect(content.toLowerCase()).not.toContain('%%bilingual%%');
    });

    it('引用头 + 用户回复经 cleanApiMessages 后完整保留 (修复前回复被截掉)', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory(makeHistory(), 10, char, userProfile, []);
        const cleaned = cleanApiMessages(apiMessages);
        const userMsg = cleaned.find((m: any) => m.role === 'user');
        const content = userMsg!.content as string;
        expect(content).toContain('引用了');
        expect(content).toContain(USER_REPLY);
    });

    it('双语 assistant 消息本体仍在标记处截断只留原文 (既有行为不回归)', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory(makeHistory(), 10, char, userProfile, []);
        const cleaned = cleanApiMessages(apiMessages);
        const aiMsg = cleaned.find((m: any) => m.role === 'assistant');
        const content = aiMsg!.content as string;
        expect(content).toContain('こんにちは、元気？');
        expect(content).not.toContain('你好，最近好吗？');
    });

    it('引用内容是 <翻译> XML 形态时也剥干净、只留原文', () => {
        const xmlBi = '<翻译>\n<原文>おはよう</原文>\n<译文>早上好</译文>\n</翻译>';
        const history = [
            { id: 1, charId: 'c1', role: 'assistant', type: 'text', content: xmlBi, timestamp: t0 },
            {
                id: 2, charId: 'c1', role: 'user', type: 'text', content: USER_REPLY, timestamp: t0 + 1000,
                replyTo: { id: 1, content: xmlBi, name: '小角色' },
            },
        ] as any[];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);
        const userMsg = apiMessages.find((m: any) => m.role === 'user');
        const content = userMsg!.content as string;
        expect(content).toContain('おはよう');
        expect(content).toContain(USER_REPLY);
        expect(content).not.toContain('<翻译>');
        expect(content).not.toContain('<译文>');
    });
});
