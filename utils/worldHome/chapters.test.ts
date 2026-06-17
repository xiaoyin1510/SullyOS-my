import { describe, it, expect } from 'vitest';
import { worldTimeLabel, buildWorldCharTurn } from './prompts';
import {
    shouldCloseChapter, buildChapterDigest, buildChapterSummaryPrompt, parseChapterSummary,
    SIM_CHAPTER_CLOCKS, SIM_CHAPTER_DAYS,
} from './chapters';
import type { CharacterProfile, WorldProfile, WorldEpisode } from '../../types';

const mkChar = (id: string, name: string): CharacterProfile => ({ id, name } as CharacterProfile);
const mkWorld = (overrides: Partial<WorldProfile> = {}): WorldProfile => ({
    id: 'w1', name: '栗子镇', worldview: '海边小镇', mode: 'light',
    memberIds: ['a', 'b'], npcs: [], houses: [], relationships: [],
    storyClock: 0, createdAt: 0, updatedAt: 0,
    ...overrides,
});

describe('worldTimeLabel（时间模式感知）', () => {
    it('real 模式沿用「第N天 早/中/晚」', () => {
        expect(worldTimeLabel(mkWorld({ timeMode: 'real', storyClock: 0 }))).toBe('第1天早上');
        expect(worldTimeLabel(mkWorld({ timeMode: 'real', storyClock: 3 }))).toBe('第2天早上');
        expect(worldTimeLabel(mkWorld({ timeMode: 'real', storyClock: 5 }))).toBe('第2天晚上');
    });
    it('未设 timeMode 的旧世界按 real', () => {
        expect(worldTimeLabel(mkWorld({ storyClock: 2 }))).toBe('第1天晚上');
    });
    it('sim 模式从起始日期按「天」推进（一天三段）为真实日历日期', () => {
        const w = mkWorld({ timeMode: 'sim', simStartDate: { year: 2024, month: 3, day: 1 } });
        expect(worldTimeLabel(w, 0)).toContain('2024年3月1日');
        expect(worldTimeLabel(w, 0)).toContain('早上');
        expect(worldTimeLabel(w, 2)).toContain('2024年3月1日'); // 同一天的晚上
        expect(worldTimeLabel(w, 2)).toContain('晚上');
        expect(worldTimeLabel(w, 3)).toContain('2024年3月2日'); // 满三段进第二天
    });
    it('sim 模式跨月进位正确', () => {
        const w = mkWorld({ timeMode: 'sim', simStartDate: { year: 2024, month: 1, day: 31 } });
        expect(worldTimeLabel(w, 3)).toContain('2024年2月1日');
    });
});

describe('shouldCloseChapter（结卷边界）', () => {
    it('real 模式永不结卷', () => {
        expect(shouldCloseChapter(mkWorld({ timeMode: 'real' }), SIM_CHAPTER_CLOCKS)).toBe(false);
    });
    it('sim 模式：满 20 天（40 个半天）整数倍才结卷', () => {
        const w = mkWorld({ timeMode: 'sim' });
        expect(shouldCloseChapter(w, SIM_CHAPTER_CLOCKS - 1)).toBe(false);
        expect(shouldCloseChapter(w, SIM_CHAPTER_CLOCKS)).toBe(true);
        expect(shouldCloseChapter(w, SIM_CHAPTER_CLOCKS * 2)).toBe(true);
        expect(shouldCloseChapter(w, SIM_CHAPTER_CLOCKS * 2 - 2)).toBe(false);
    });
    it('已归档过的时钟不再重复结卷', () => {
        const w = mkWorld({ timeMode: 'sim', simSummarizedClock: SIM_CHAPTER_CLOCKS });
        expect(shouldCloseChapter(w, SIM_CHAPTER_CLOCKS)).toBe(false);
    });
});

describe('章节总结的解析与防上帝视角', () => {
    const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];

    it('parseChapterSummary：每人单视角按名字回填到 charId，过滤非成员', () => {
        const raw = JSON.stringify({
            synopsis: '这二十天里两人渐渐走近。',
            relationshipEval: '小满对阿岚的好感明显上升。',
            atmosphere: '微妙的暧昧。',
            perspectives: [
                { name: '小满', text: '我好像越来越在意阿岚了。' },
                { name: '阿岚', text: '小满最近总往我这跑。' },
                { name: '路人', text: '不该出现' },
            ],
        });
        const out = parseChapterSummary(raw, members);
        expect(out.synopsis).toContain('渐渐走近');
        expect(out.atmosphere).toBe('微妙的暧昧。');
        expect(out.perspectives).toHaveLength(2);
        expect(out.perspectives.find(p => p.charId === 'a')!.text).toContain('在意阿岚');
        expect(out.perspectives.some(p => p.charName === '路人')).toBe(false);
    });

    it('parseChapterSummary：解析失败时整段原文兜底进 synopsis', () => {
        const out = parseChapterSummary('这是一段没有 JSON 的总结。', members);
        expect(out.synopsis).toContain('没有 JSON');
        expect(out.perspectives).toEqual([]);
    });

    it('buildChapterSummaryPrompt：要求为每个角色各出一条单视角', () => {
        const prompt = buildChapterSummaryPrompt({
            world: mkWorld(), members, fromLabel: '2024年3月1日', toLabel: '2024年3月20日',
            digest: '（原文摘要）',
        });
        expect(prompt).toContain('小满、阿岚');
        expect(prompt).toContain('单方面');
        expect(prompt).toContain(String(SIM_CHAPTER_DAYS));
    });

    it('buildChapterDigest：按时间正序，保留瞒下的事供全知总结器', () => {
        const eps: WorldEpisode[] = [
            { id: 'e2', worldId: 'w1', round: 2, storyTime: 'D2', trigger: 'observe', beats: [{ charId: 'a', charName: '小满', location: '镇上', narrative: 'n', mood: 'm', timeline: [{ time: '22:00', place: '酒吧', event: '偷偷喝酒', shared: false }] }], summary: 's2', createdAt: 0 },
            { id: 'e1', worldId: 'w1', round: 1, storyTime: 'D1', trigger: 'observe', beats: [{ charId: 'a', charName: '小满', location: '家', narrative: 'n', mood: 'm' }], summary: 's1', createdAt: 0 },
        ];
        const digest = buildChapterDigest(eps);
        expect(digest.indexOf('D1')).toBeLessThan(digest.indexOf('D2')); // 正序
        expect(digest).toContain('〔瞒〕'); // 瞒下的事保留给全知总结器
    });

    it('防上帝视角：buildWorldCharTurn 只喂该角色自己的单视角与氛围，绝不喂全知 synopsis', () => {
        const world = mkWorld({ timeMode: 'sim' });
        const turn = buildWorldCharTurn({
            world, char: members[0], members, storyTime: '2024年3月21日 周四 白天', round: 41, beatsSoFar: [],
            priorChapter: { atmosphere: '微妙的暧昧', charPerspective: '我好像越来越在意阿岚了。' },
            userName: '',
        });
        expect(turn).toContain('前情（这是你自己的视角');
        expect(turn).toContain('越来越在意阿岚');
        expect(turn).toContain('微妙的暧昧');
        // 别人单方面的内心、全知梗概都不该出现在这名角色的上下文里
        expect(turn).not.toContain('阿岚最近总往我这跑');
    });
});
