/**
 * 引用回复 × 双语角色 回归测试
 *
 * Bug 背景（Discord「老师们遇到了关于引用的bug」）：
 * 开翻译的外语/粤语角色消息落库为「原文\n%%BILINGUAL%%\n译文」。用户引用这类
 * 消息回复时，replyTo 快照原样带着 %%BILINGUAL%% 标记进了拼好的 user 消息，
 * cleanApiMessages 剥双语时从标记处把整条消息砍掉 —— 用户的新回复整段消失，
 * 模型只看到半截引用（即「char 只看到引用、看不到回复」）。
 *
 * 修复落点在 chatPrompts 的引用头构造（源头不让标记混入 user 消息），
 * 这里锁端到端效果 + cleanApiMessages 对 assistant 的既有截断行为。
 */
import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import { cleanApiMessages } from './chatRequestPayload';

const BILINGUAL_CHAR_MSG = 'Bonjour, ça va ?\n%%BILINGUAL%%\n你好，最近怎么样？';
const USER_REPLY = '我想问你昨天说的那件事';

function buildHistoryWithQuote() {
    const char: any = { id: 'c1', name: '露西', timeAwarenessEnabled: false };
    const userProfile: any = { name: '阿初' };
    const messages: any[] = [
        {
            id: 1, charId: 'c1', role: 'assistant', type: 'text',
            content: BILINGUAL_CHAR_MSG, timestamp: 1750000000000,
        },
        {
            id: 2, charId: 'c1', role: 'user', type: 'text',
            content: USER_REPLY, timestamp: 1750000060000,
            replyTo: { id: 1, content: BILINGUAL_CHAR_MSG, name: '露西' },
        },
    ];
    return ChatPrompts.buildMessageHistory(messages, 10, char, userProfile, []);
}

describe('用户引用双语角色消息', () => {
    it('拼出的引用框只取原文侧，不夹带 %%BILINGUAL%% 标记', () => {
        const { apiMessages } = buildHistoryWithQuote();
        const userMsg = apiMessages[1];
        expect(userMsg.role).toBe('user');
        expect(userMsg.content).not.toMatch(/%%bilingual%%/i);
        expect(userMsg.content).toContain('Bonjour, ça va ?');
        expect(userMsg.content).toContain(USER_REPLY);
    });

    it('经过 cleanApiMessages 后用户的回复仍然在（端到端）', () => {
        const { apiMessages } = buildHistoryWithQuote();
        const cleaned = cleanApiMessages(apiMessages);
        expect(cleaned[1].content).toContain('并回复了');
        expect(cleaned[1].content).toContain(USER_REPLY);
    });
});

describe('cleanApiMessages 双语剥离', () => {
    it('assistant 双语消息只保留原文侧（原有行为不回归）', () => {
        const cleaned = cleanApiMessages([
            { role: 'assistant', content: BILINGUAL_CHAR_MSG },
        ]);
        expect(cleaned[0].content).toBe('Bonjour, ça va ?');
    });
});
