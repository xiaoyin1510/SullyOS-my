import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { extractJson, parseCharBeat, parseNpcScene, storyTimeLabel, buildModeRule, buildWorldCharTurn, parseRolledNpcs, buildNpcRollPrompt, NARRATIVE_STYLES, narrationPersonGuide, realNowSeg, realObserveTarget, worldTimeLabel } from './prompts';
import { applyRelationshipDeltas, collectSeeds, buildSummary } from './engine';
import { ensureThreads, applyBeatToThreads, applyNpcGroupLines, applyNpcDms, npcInboxes, dmThreadsOf, groupThreadOf, formatThreadForPrompt, dmThreadId, GROUP_THREAD_ID } from './threads';
import { WorldScheduler } from './scheduler';
import type { CharacterProfile, WorldProfile } from '../../types';

// scheduler 的 attachListeners 会访问 document/window（node 环境下没有），补最简 stub。
const g = globalThis as any;
if (typeof g.document === 'undefined') g.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
if (typeof g.window === 'undefined') g.window = { addEventListener() {}, removeEventListener() {} };

const mkChar = (id: string, name: string): CharacterProfile => ({ id, name } as CharacterProfile);

const mkWorld = (overrides: Partial<WorldProfile> = {}): WorldProfile => ({
    id: 'w1', name: '栗子镇', worldview: '海边小镇', mode: 'light',
    memberIds: ['a', 'b'], npcs: [], houses: [], relationships: [],
    storyClock: 0, createdAt: 0, updatedAt: 0,
    ...overrides,
});

describe('storyTimeLabel', () => {
    it('一天三段推进：早上/中午/晚上', () => {
        expect(storyTimeLabel(0)).toBe('第1天早上');
        expect(storyTimeLabel(1)).toBe('第1天中午');
        expect(storyTimeLabel(2)).toBe('第1天晚上');
        expect(storyTimeLabel(3)).toBe('第2天早上');
        expect(storyTimeLabel(5)).toBe('第2天晚上');
    });
});

describe('extractJson', () => {
    it('解析 ```json 围栏', () => {
        expect(extractJson('前导文字\n```json\n{"a":1}\n```\n尾巴')).toEqual({ a: 1 });
    });
    it('解析裸 JSON（夹杂正文）', () => {
        expect(extractJson('我来啦 {"a":1} 完事')).toEqual({ a: 1 });
    });
    it('容忍尾逗号', () => {
        expect(extractJson('{"a":1,}')).toEqual({ a: 1 });
    });
    it('剥掉 <think> 块', () => {
        expect(extractJson('<think>{"x":9}</think>{"a":1}')).toEqual({ a: 1 });
    });
    it('解析失败返回 null', () => {
        expect(extractJson('完全不是 JSON')).toBeNull();
    });
});

describe('parseCharBeat', () => {
    const char = mkChar('a', '小满');
    const members = ['小满', '阿岚'];

    it('完整解析一拍', () => {
        const raw = JSON.stringify({
            location: '同居小屋的厨房',
            narrative: '小满把昨晚剩的汤热了。',
            mood: '松弛',
            statusPanel: { 体力: 72, 心情值: 88 },
            phone: { posts: ['今天的汤'], dms: [{ to: '阿岚', lines: ['汤好了，快回来'] }] },
            relationships: [{ with: '阿岚', delta: 2, reason: '一起吃了早饭' }],
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.location).toBe('同居小屋的厨房');
        expect(beat.mood).toBe('松弛');
        expect(beat.statusPanel).toEqual({ 体力: 72, 心情值: 88 });
        expect(beat.phone?.dms?.[0].to).toBe('阿岚');
        expect(beat.relationshipDeltas?.[0]).toMatchObject({ withName: '阿岚', delta: 2 });
    });

    it('JSON 解析失败时把原文兜底进 narrative，不丢内容', () => {
        const beat = parseCharBeat('她只是安静地坐在窗边，看了一下午的海。', char, members);
        expect(beat.narrative).toContain('看了一下午的海');
        expect(beat.charName).toBe('小满');
    });

    it('解析时间轴/备忘录/冲动/秘密（schema v3）', () => {
        const raw = JSON.stringify({
            location: '镇上', narrative: 'x'.repeat(50), mood: '复杂',
            timeline: [
                { time: '9:00', place: '画室', event: '画画', shared: true },
                { time: '11:30', place: '酒吧', event: '偷偷喝了一杯', shared: false },
                { event: '' }, // 无效条目被过滤
            ],
            memo: ['买颜料', '别忘了道歉'],
            impulse: { text: '想辞职', options: ['辞', '再忍忍'] },
            secrets: [{ text: '偷偷去了酒吧', hideFrom: ['阿岚', '陌生人'] }],
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.timeline).toHaveLength(2);
        expect(beat.timeline![1].shared).toBe(false);
        expect(beat.memo).toEqual(['买颜料', '别忘了道歉']);
        expect(beat.impulse).toEqual({ text: '想辞职', options: ['辞', '再忍忍'] });
        // hideFrom 只保留真实成员
        expect(beat.secrets).toEqual([{ text: '偷偷去了酒吧', hideFrom: ['阿岚'] }]);
    });

    it('解析当面对话与群聊发言，过滤非成员的对话对象', () => {
        const raw = JSON.stringify({
            location: '客厅', narrative: 'x', mood: 'y',
            dialogues: [{ with: '阿岚', lines: ['早啊'] }, { with: '路人', lines: ['?'] }],
            phone: { group: ['今天谁做饭'] },
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.dialogues).toEqual([{ with: '阿岚', lines: ['早啊'] }]);
        expect(beat.phone?.group).toEqual(['今天谁做饭']);
    });

    it('过滤非成员的私聊对象与关系对象，delta 截断到 ±4', () => {
        const raw = JSON.stringify({
            location: '镇上', narrative: 'x', mood: 'y',
            phone: { dms: [{ to: '陌生人', lines: ['?'] }, { to: '阿岚', lines: ['在吗'] }] },
            relationships: [{ with: '路人甲', delta: 3 }, { with: '阿岚', delta: 99 }],
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.phone?.dms).toHaveLength(1);
        expect(beat.relationshipDeltas).toHaveLength(1);
        expect(beat.relationshipDeltas?.[0].delta).toBe(4);
    });
});

describe('parseNpcScene', () => {
    it('解析 scene + hooks + 群聊冒泡', () => {
        const out = parseNpcScene('```json\n{"scene":"面包店飘香。","hooks":["老板娘多烤了一炉"],"groupLines":[{"name":"老板娘","line":"栗子包出炉咯"}]}\n```');
        expect(out.scene).toBe('面包店飘香。');
        expect(out.hooks).toEqual(['老板娘多烤了一炉']);
        expect(out.groupLines).toEqual([{ name: '老板娘', line: '栗子包出炉咯' }]);
    });
    it('解析失败时原文兜底', () => {
        const out = parseNpcScene('镇子很安静。');
        expect(out.scene).toBe('镇子很安静。');
        expect(out.hooks).toEqual([]);
        expect(out.groupLines).toEqual([]);
    });
});

describe('文风预设', () => {
    it('新增「日常轻喜剧」preset 可用', () => {
        expect(NARRATIVE_STYLES.sitcom).toBeTruthy();
        expect(NARRATIVE_STYLES.sitcom.name).toBe('日常轻喜剧');
        expect(NARRATIVE_STYLES.sitcom.guide.length).toBeGreaterThan(20);
    });
});

describe('AI roll NPC', () => {
    it('buildNpcRollPrompt 带上世界观、角色人设、已有 NPC 与数量', () => {
        const prompt = buildNpcRollPrompt({
            worldName: '栗子镇', worldview: '海边小镇',
            members: [{ name: '小满', persona: '画师，怕生' }],
            count: 3, existingNames: ['老板娘'],
        });
        expect(prompt).toContain('栗子镇');
        expect(prompt).toContain('小满：画师，怕生');
        expect(prompt).toContain('老板娘');
        expect(prompt).toContain('3');
    });

    it('parseRolledNpcs：解析 npcs，补默认 emoji，过滤空名/重名/超量', () => {
        const raw = JSON.stringify({
            npcs: [
                { name: '面包店老板娘', persona: '热心肠', emoji: '🥖' },
                { name: '', persona: 'x' },                 // 空名过滤
                { name: '老张', persona: '修鞋的' },          // 无 emoji → 默认
                { name: '老板娘', persona: '重名' },          // 与已有重名过滤
            ],
        });
        const out = parseRolledNpcs(raw, ['老板娘']);
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({ name: '面包店老板娘', persona: '热心肠', emoji: '🥖' });
        expect(out[1].emoji).toBe('🙂');
    });

    it('parseRolledNpcs：裸数组也能解析，解析失败返回空', () => {
        expect(parseRolledNpcs('[{"name":"阿福","persona":"门卫"}]')).toHaveLength(1);
        expect(parseRolledNpcs('不是 JSON')).toEqual([]);
    });
});

describe('关系看法（label）可变 + 叙述人称', () => {
    const char = mkChar('a', '小满');
    const members = ['小满', '阿岚'];

    it('parseCharBeat：重大转折时解析 relabel → newLabel', () => {
        const raw = JSON.stringify({
            location: '镇上', narrative: 'x', mood: 'y',
            relationships: [{ with: '阿岚', delta: 3, reason: '一起扛过事', relabel: '不打不相识的损友' }],
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.relationshipDeltas?.[0]).toMatchObject({ withName: '阿岚', delta: 3, newLabel: '不打不相识的损友' });
    });

    it('parseCharBeat：没给 relabel 时 newLabel 为 undefined', () => {
        const raw = JSON.stringify({ location: 'x', narrative: 'x', mood: 'y', relationships: [{ with: '阿岚', delta: 1 }] });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.relationshipDeltas?.[0].newLabel).toBeUndefined();
    });

    it('narrationPersonGuide：随设置切换第一/二/三人称', () => {
        expect(narrationPersonGuide({ narrationPerson: 'first' } as any, '小满')).toContain('第一人称');
        expect(narrationPersonGuide({ narrationPerson: 'second' } as any, '小满')).toContain('第二人称');
        expect(narrationPersonGuide({ narrationPerson: 'third' } as any, '小满')).toContain('第三人称');
        expect(narrationPersonGuide({} as any, '小满')).toContain('第一人称'); // 默认
    });
});

describe('真实时间（跟现实早/中/晚同步，错过当天可补、隔天不补）', () => {
    const at = (s: string) => new Date(s);

    it('realNowSeg：按小时分早/中/晚（深夜算晚）', () => {
        expect(realNowSeg(at('2026-06-15T08:00:00')).seg).toBe(0); // 早
        expect(realNowSeg(at('2026-06-15T13:00:00')).seg).toBe(1); // 中
        expect(realNowSeg(at('2026-06-15T20:00:00')).seg).toBe(2); // 晚
        expect(realNowSeg(at('2026-06-15T02:00:00')).seg).toBe(2); // 深夜→晚
        expect(realNowSeg(at('2026-06-15T13:00:00')).dayKey).toBe('2026-06-15');
    });

    it('没演过 → 演当前这一段', () => {
        expect(realObserveTarget(mkWorld({ timeMode: 'real' }), at('2026-06-15T13:00:00'))).toEqual({ dayKey: '2026-06-15', seg: 1 });
    });

    it('同一天落后 → 补下一段；已追上 → null', () => {
        const w = mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-15', seg: 0 } });
        expect(realObserveTarget(w, at('2026-06-15T20:00:00'))).toEqual({ dayKey: '2026-06-15', seg: 1 }); // 只补一段
        expect(realObserveTarget(mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-15', seg: 2 } }), at('2026-06-15T20:00:00'))).toBeNull();
    });

    it('隔天没补的丢掉 → 直接跳到今天最早一段', () => {
        const w = mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-13', seg: 1 } });
        expect(realObserveTarget(w, at('2026-06-15T20:00:00'))).toEqual({ dayKey: '2026-06-15', seg: 0 });
    });

    it('worldTimeLabel：real 模式显示已演到的现实段', () => {
        const w = mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-15', seg: 2 } });
        expect(worldTimeLabel(w)).toContain('2026年6月15日');
        expect(worldTimeLabel(w)).toContain('晚上');
    });
});

describe('buildModeRule（三档 user 存在感）', () => {
    it('轻度：user 依旧是最重要的人', () => {
        expect(buildModeRule('light', '阿月')).toContain('最重要的人');
    });
    it('中度：user 是普通一员', () => {
        expect(buildModeRule('medium', '阿月')).toContain('普通一员');
    });
    it('重度：user 不存在，禁止提及', () => {
        const rule = buildModeRule('heavy', '阿月');
        expect(rule).toContain('不存在');
        expect(rule).toContain('绝对不要提及');
    });
});

describe('buildWorldCharTurn', () => {
    it('传递路径：公开行程可见，瞒下的行程/正文/心情不外泄', () => {
        const world = mkWorld();
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({
            world, char: members[1], members, storyTime: '第1天白天', round: 1,
            beatsSoFar: [{
                charId: 'a', charName: '小满', location: '镇上', narrative: '她在酒吧后巷哭了一场。', mood: '低落',
                timeline: [
                    { time: '9:00', place: '画室', event: '画了一上午', shared: true },
                    { time: '11:30', place: '酒吧', event: '偷偷去喝了一杯', shared: false },
                ],
            }],
            userName: '阿月',
        });
        // 传递路径：公开行程可见；瞒下的行程、narrative、mood 都不可见
        expect(turn).toContain('9:00 在画室：画了一上午');
        expect(turn).not.toContain('酒吧');
        expect(turn).not.toContain('哭了一场');
        expect(turn).not.toContain('低落');
    });

    it('当面对话完整传给对话对象，公开动态全员可见', () => {
        const world = mkWorld({ houses: [{ id: 'h1', name: '合租屋', residentIds: ['a', 'b'] }] });
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({
            world, char: members[1], members, storyTime: '第1天白天', round: 1,
            beatsSoFar: [{
                charId: 'a', charName: '小满', location: '合租屋的厨房', narrative: 'x', mood: 'y',
                dialogues: [{ with: '阿岚', lines: ['汤好了，趁热'] }],
            }],
            recentPosts: [{ name: '小满', post: '今天的汤格外香' }],
            userName: '',
        });
        expect(turn).toContain('当面对你说');
        expect(turn).toContain('「汤好了，趁热」');
        expect(turn).toContain('小满：今天的汤格外香'); // 社交媒体公开
    });

    it('伏笔爆发与用户心声注入', () => {
        const world = mkWorld();
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({
            world, char: members[1], members, storyTime: '第2天白天', round: 3, beatsSoFar: [],
            exposures: ['你发现/听说了 小满 一直瞒着的事：偷偷去了酒吧。'],
            directive: { impulseText: '想辞职去学烘焙', text: '去吧，我支持你' },
            userName: '阿月',
        });
        expect(turn).toContain('绕不开的事');
        expect(turn).toContain('偷偷去了酒吧');
        expect(turn).toContain('心里的声音');
        expect(turn).toContain('去吧，我支持你');
        expect(turn).toContain('阿月'); // light 模式：联想到 user
    });

    it('手机段：先演绎角色刚发的私聊/群聊出现在后演绎角色的上下文里，标【刚刚】', () => {
        const world = mkWorld();
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        applyBeatToThreads(world, {
            charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z',
            phone: { dms: [{ to: '阿岚', lines: ['睡了吗'] }], group: ['今晚月色不错'] },
        }, members, 3, '第2天白天');
        const turn = buildWorldCharTurn({ world, char: members[1], members, storyTime: '第2天白天', round: 3, beatsSoFar: [], userName: '' });
        expect(turn).toContain('与 小满 的私聊');
        expect(turn).toContain('【刚刚】 小满：睡了吗');
        expect(turn).toContain('【刚刚】 小满：今晚月色不错');
    });

    it('关系有向：自己的视角带数值，对方对自己只有模糊体感（不泄露数值与关系名）', () => {
        const world = mkWorld({
            relationships: [
                { fromId: 'a', toId: 'b', label: '单恋', value: 85 },
                { fromId: 'b', toId: 'a', label: '普通同事', value: 30 },
            ],
        });
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({ world, char: members[0], members, storyTime: '第1天白天', round: 1, beatsSoFar: [], userName: '' });
        expect(turn).toContain('你对 阿岚');
        expect(turn).toContain('「单恋」');        // 理智上的标签
        expect(turn).toContain('好感 85（亲密无间）'); // 自己的好感数值 + 档位
        expect(turn).toContain('你能隐约感觉到 阿岚 对你的态度：有好感'); // 对方 30 → 有好感（只给档位）
        expect(turn).not.toContain('好感 30');    // 对方的数值是对方的内心，不泄露
        expect(turn).not.toContain('普通同事');   // 对方眼中的关系名同理
    });

    it('独居与同居安排都体现在 prompt 里', () => {
        const world = mkWorld({ houses: [{ id: 'h1', name: '合租屋', residentIds: ['a', 'b'] }], memberIds: ['a', 'b', 'c'] });
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚'), mkChar('c', '十一')];
        const turn = buildWorldCharTurn({ world, char: members[0], members, storyTime: '第1天白天', round: 1, beatsSoFar: [], userName: '' });
        expect(turn).toContain('合租屋：小满、阿岚 同住');
        expect(turn).toContain('十一 独居');
    });
});

describe('世界消息线程（交替传递）', () => {
    const members = [{ id: 'a', name: '小满' }, { id: 'b', name: '阿岚' }];

    it('A 发的私聊与 B 的回复进同一条 dm 线程，按时间交替', () => {
        const world = mkWorld();
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '阿岚', lines: ['在吗', '想你了'] }] } }, members, 1, '第1天白天');
        applyBeatToThreads(world, { charId: 'b', charName: '阿岚', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '小满', lines: ['刚看到，怎么啦'] }] } }, members, 1, '第1天白天');
        const threads = dmThreadsOf(world, 'a');
        expect(threads).toHaveLength(1);
        expect(threads[0].id).toBe(dmThreadId('a', 'b'));
        expect(threads[0].messages.map(m => `${m.fromName}:${m.text}`)).toEqual([
            '小满:在吗', '小满:想你了', '阿岚:刚看到，怎么啦',
        ]);
        // B 的视角是同一条线程
        expect(dmThreadsOf(world, 'b')[0].id).toBe(threads[0].id);
    });

    it('群聊：成员发言与 NPC 冒泡都进 group_main，NPC 名字必须真实存在', () => {
        const world = mkWorld({ npcs: [{ id: 'n1', name: '老板娘', persona: '面包店' }] });
        ensureThreads(world);
        applyNpcGroupLines(world, [{ name: '老板娘', line: '新出炉的栗子包！' }, { name: '不存在的人', line: 'x' }], 1, '第1天白天');
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { group: ['冲了'] } }, members, 1, '第1天白天');
        const group = groupThreadOf(world)!;
        expect(group.id).toBe(GROUP_THREAD_ID);
        expect(group.messages.map(m => m.fromName)).toEqual(['老板娘', '小满']);
    });

    it('formatThreadForPrompt：本轮消息标【刚刚】，历史消息标剧情时间', () => {
        const world = mkWorld();
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '阿岚', lines: ['老消息'] }] } }, members, 1, '第1天白天');
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '阿岚', lines: ['新消息'] }] } }, members, 2, '第1天夜晚');
        const text = formatThreadForPrompt(dmThreadsOf(world, 'b')[0], 'b', 10, 2);
        expect(text).toContain('[第1天白天] 小满：老消息');
        expect(text).toContain('【刚刚】 小满：新消息');
    });
});

describe('NPC 私聊（角色发、NPC 那一轮统一回复）', () => {
    const members = [{ id: 'a', name: '小满' }];

    it('parseCharBeat：可以给 NPC 发私信（to=NPC名也保留）', () => {
        const raw = JSON.stringify({ location: 'x', narrative: 'x', mood: 'y', phone: { dms: [{ to: '老板娘', lines: ['今天还有栗子包吗'] }] } });
        const beat = parseCharBeat(raw, mkChar('a', '小满'), ['小满'], ['老板娘']);
        expect(beat.phone?.dms?.[0]).toEqual({ to: '老板娘', lines: ['今天还有栗子包吗'] });
    });

    it('applyBeatToThreads：角色→NPC 私信落进 char↔npc 线程；npcInboxes 能捞到待回', () => {
        const world = mkWorld({ npcs: [{ id: 'n1', name: '老板娘', persona: '面包店' }] });
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '老板娘', lines: ['还有栗子包吗'] }] } }, members, 1, '第1天早上');
        const tid = dmThreadId('a', 'n1');
        expect(dmThreadsOf(world, 'a').some(t => t.id === tid)).toBe(true);
        const inbox = npcInboxes(world);
        expect(inbox).toHaveLength(1);
        expect(inbox[0]).toMatchObject({ npcName: '老板娘', memberName: '小满' });
    });

    it('applyNpcDms：NPC 回复后该线程不再算待回', () => {
        const world = mkWorld({ npcs: [{ id: 'n1', name: '老板娘', persona: '面包店' }] });
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '老板娘', lines: ['还有栗子包吗'] }] } }, members, 1, '第1天早上');
        applyNpcDms(world, [{ from: '老板娘', to: '小满', lines: ['刚出炉，给你留俩'] }], members, 1, '第1天早上');
        expect(npcInboxes(world)).toHaveLength(0);
        const thread = dmThreadsOf(world, 'a').find(t => t.id === dmThreadId('a', 'n1'))!;
        expect(thread.messages.map(m => `${m.fromName}:${m.text}`)).toEqual(['小满:还有栗子包吗', '老板娘:刚出炉，给你留俩']);
    });

    it('parseNpcScene：解析 NPC 私信回复', () => {
        const out = parseNpcScene('```json\n{"scene":"x","hooks":[],"groupLines":[],"dms":[{"from":"老板娘","to":"小满","lines":["给你留俩"]}]}\n```');
        expect(out.dms).toEqual([{ from: '老板娘', to: '小满', lines: ['给你留俩'] }]);
    });

    it('parseNpcScene：解析动态点赞/评论（NPC+路人），likes 钳整数', () => {
        const out = parseNpcScene('```json\n{"scene":"x","feedReactions":[{"ref":"3_a_0","likes":"12","comments":[{"from":"街角咖啡师","text":"好可爱！"},{"from":"路人乙"}]}]}\n```');
        expect(out.feedReactions).toHaveLength(1);
        expect(out.feedReactions[0]).toMatchObject({ ref: '3_a_0', likes: 12 });
        expect(out.feedReactions[0].comments).toEqual([{ from: '街角咖啡师', text: '好可爱！' }]); // 无 text 的被过滤
    });
});

describe('applyRelationshipDeltas（有向回填）', () => {
    const members = [{ id: 'a', name: '小满' }, { id: 'b', name: '阿岚' }];

    it('只改"该角色→对方"这条边，反向不动', () => {
        const world = mkWorld({
            relationships: [
                { fromId: 'a', toId: 'b', value: 60 },
                { fromId: 'b', toId: 'a', value: 20 },
            ],
        });
        applyRelationshipDeltas(world, [
            { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', relationshipDeltas: [{ withName: '阿岚', delta: 3 }] },
        ], members);
        expect(world.relationships.find(r => r.fromId === 'a' && r.toId === 'b')!.value).toBe(63);
        expect(world.relationships.find(r => r.fromId === 'b' && r.toId === 'a')!.value).toBe(20);
    });

    it('不存在的边按 0（陌生中立）起步，数值钳在 -100~100（可为负）', () => {
        const world = mkWorld({ relationships: [{ fromId: 'a', toId: 'b', value: 99 }] });
        applyRelationshipDeltas(world, [
            { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', relationshipDeltas: [{ withName: '阿岚', delta: 4 }] },
            { charId: 'b', charName: '阿岚', location: 'x', narrative: 'y', mood: 'z', relationshipDeltas: [{ withName: '小满', delta: -4 }] },
        ], members);
        expect(world.relationships.find(r => r.fromId === 'a' && r.toId === 'b')!.value).toBe(100); // 99+4 钳到 100
        expect(world.relationships.find(r => r.fromId === 'b' && r.toId === 'a')!.value).toBe(-4);  // 新边 0 起步 −4 → 负数
    });
});

describe('伏笔与摘要防泄密', () => {
    it('collectSeeds：显式 secrets + timeline 未声张条目自动补伏笔，不重复', () => {
        const world = mkWorld();
        collectSeeds(world, {
            charId: 'b', charName: '阿岚', location: 'x', narrative: 'y', mood: 'z',
            timeline: [
                { time: '9:00', place: '图书馆', event: '看书', shared: true },
                { time: '22:00', place: '酒吧', event: '偷偷去喝了一杯', shared: false },
                { time: '23:30', place: '河边', event: '一个人坐了很久', shared: false },
            ],
            secrets: [{ text: '偷偷去喝了一杯', hideFrom: ['小满'] }],
        }, 2, '第1天夜晚');
        const seeds = world.seeds!;
        // 显式 secret 1 条 + timeline 自动补 1 条（河边；酒吧已被 secrets 覆盖不重复）
        expect(seeds).toHaveLength(2);
        expect(seeds[0]).toMatchObject({ charName: '阿岚', text: '偷偷去喝了一杯', hideFrom: ['小满'], status: 'pending' });
        expect(seeds[1].text).toContain('河边');
        expect(seeds[1].hideFrom).toEqual([]);
    });

    it('buildSummary 只用公开信息：瞒下的事和正文绝不进全员可见的摘要', () => {
        const summary = buildSummary('第1天夜晚', [{
            charId: 'b', charName: '阿岚', location: '镇上', narrative: '她在酒吧后巷给前任打了电话。', mood: '崩溃',
            timeline: [
                { time: '20:00', place: '餐厅', event: '和同事聚餐', shared: true },
                { time: '22:00', place: '酒吧', event: '偷偷去喝了一杯', shared: false },
            ],
        }], []);
        expect(summary).toContain('和同事聚餐');
        expect(summary).not.toContain('酒吧');
        expect(summary).not.toContain('前任');
        expect(summary).not.toContain('崩溃');
    });
});

describe('WorldScheduler', () => {
    beforeEach(() => {
        localStorage.removeItem('world_tick_slots');
        localStorage.removeItem('world_tick_fired');
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        WorldScheduler.onTrigger(() => {});
    });

    it('reconcile：今天已过去的时段视为已耗尽，不补火（防止配置完瞬间连烧）', () => {
        vi.setSystemTime(new Date('2026-06-11T15:00:00')); // 15点：早/午已过
        const fired: string[] = [];
        WorldScheduler.onTrigger((id) => { fired.push(id); });
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['morning', 'noon', 'evening'] }]);
        const rec = JSON.parse(localStorage.getItem('world_tick_fired')!).w1;
        expect(rec.fired).toEqual(['morning', 'noon']);
        expect(fired).toEqual([]); // 不立即触发
    });

    it('到点触发当天未跑的时段，且每时段一天最多一次', () => {
        vi.setSystemTime(new Date('2026-06-11T08:00:00'));
        const fired: string[] = [];
        WorldScheduler.onTrigger((id, trigger) => { fired.push(`${id}:${trigger}`); });
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['morning'] }]);
        expect(fired).toEqual([]);
        vi.setSystemTime(new Date('2026-06-11T09:30:00'));
        vi.advanceTimersByTime(61_000); // 主线程轮询
        expect(fired).toEqual(['w1:tick']);
        vi.advanceTimersByTime(10 * 61_000); // 同一天不再重复
        expect(fired).toEqual(['w1:tick']);
    });

    it('跨天后时段配额重置', () => {
        vi.setSystemTime(new Date('2026-06-11T10:00:00'));
        const fired: string[] = [];
        WorldScheduler.onTrigger(() => { fired.push('x'); });
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['morning'] }]); // 10点：morning 已耗尽
        vi.advanceTimersByTime(61_000);
        expect(fired).toHaveLength(0);
        vi.setSystemTime(new Date('2026-06-12T09:30:00')); // 第二天早上
        vi.advanceTimersByTime(61_000);
        expect(fired).toHaveLength(1);
    });

    it('移除世界后清掉残留', () => {
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['evening'] }]);
        expect(JSON.parse(localStorage.getItem('world_tick_slots')!).w1).toBeTruthy();
        WorldScheduler.reconcile([]);
        expect(localStorage.getItem('world_tick_slots')).toBeNull();
    });
});
