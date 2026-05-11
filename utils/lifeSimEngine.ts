/**
 * LifeSim Engine — 都市模拟人生 · 2026 现代版
 * 现代都市戏剧沙盒：公寓合租、职场社交、城市生活
 */

import {
    LifeSimState, SimFamily, SimNPC, SimAction, SimActionType,
    SimEventType, SimPendingEffect, SimEffectCode, NPCDesire,
    SimSeason, SimWeather, SimTimeOfDay, SimProfession, SimFestival,
    SimGender,
} from '../types';

const genId = () => Math.random().toString(36).slice(2, 10);

// ── NPC 素材库 ──────────────────────────────────────────────

const NPC_EMOJIS = ['👩‍💻','👨‍💼','👩‍🎨','🧑‍🍳','👨‍⚕️','👩‍🔬','🧑‍🎤','👨‍✈️','👩‍💼','🧑‍🏫',
                    '🕶️','💅','🎧','📱','💼','🎬','🎸','☕','🍸','✨'];

const NPC_NAMES = [
    '苏然','林夜','沈默','陆北','顾言','叶青','许晚','秦川','白露','温笛',
    '程漫','江行','宋雨','韩城','方瑾','钟离','楚安','裴南','何时','唐绪',
    '黎明','萧然','周也','孟晚','赵雪','冯遥','魏岚','傅远','曲星','贺年',
];

const PERSONALITIES = [
    ['社牛','爱玩','话多'],
    ['社恐','宅','敏感'],
    ['卷王','上进','焦虑'],
    ['摸鱼','佛系','随缘'],
    ['文青','矫情','有品味'],
    ['话题女王','八卦','消息灵通'],
    ['职场精英','高冷','目标明确'],
    ['暖男/暖女','热心','老好人'],
    ['叛逆','独立','不按常理出牌'],
    ['精致','自恋','外貌协会'],
];

const FAMILY_EMOJIS = ['🏢','🏙️','🏬','🏨','🌃','🌆','🏗️','🌇','🎪','🏛️'];
const FAMILY_NAMES = ['星河公寓','云顶阁','都会花园','摩登大厦','城市之光','天际线','霓虹坊'];

const PROFESSIONS: SimProfession[] = [
    'programmer','designer','finance','influencer','lawyer','freelancer','barista','musician',
    'internet_troll','fanfic_writer','fan_artist','college_student','tired_worker','old_fashioned','fashion_designer',
];
const PROFESSION_LABELS: Record<SimProfession, { zh: string; emoji: string; color: string }> = {
    programmer:      { zh: '码农', emoji: '💻', color: '#22d3ee' },
    designer:        { zh: '设计师', emoji: '🎨', color: '#f472b6' },
    finance:         { zh: '金融', emoji: '📊', color: '#a78bfa' },
    influencer:      { zh: '网红', emoji: '📱', color: '#fb923c' },
    lawyer:          { zh: '律师', emoji: '⚖️', color: '#fbbf24' },
    freelancer:      { zh: '自由职业', emoji: '☕', color: '#34d399' },
    barista:         { zh: '咖啡师', emoji: '🧋', color: '#a3845c' },
    musician:        { zh: '音乐人', emoji: '🎸', color: '#c084fc' },
    internet_troll:  { zh: '互联网喷子', emoji: '🔥', color: '#ef4444' },
    fanfic_writer:   { zh: '同人文作者', emoji: '✍️', color: '#818cf8' },
    fan_artist:      { zh: '同人画师', emoji: '🖌️', color: '#f0abfc' },
    college_student: { zh: '大学生', emoji: '🎓', color: '#60a5fa' },
    tired_worker:    { zh: '疲惫社畜', emoji: '😮‍💨', color: '#78716c' },
    old_fashioned:   { zh: '老古板', emoji: '🧐', color: '#a8a29e' },
    fashion_designer:{ zh: '服装设计师', emoji: '👗', color: '#e879f9' },
};

// ── NPC 角色原型（archetype）─────────────────────────────────

interface NPCArchetype {
    profession: SimProfession;
    personalityPool: string[][];
    bioTemplates: string[];
    backstoryTemplates: string[];
}

const NPC_ARCHETYPES: NPCArchetype[] = [
    {
        profession: 'internet_troll',
        personalityPool: [['社牛','暴躁','话多'], ['叛逆','嘴毒','爱杠'], ['傲娇','毒舌','表面嫌弃']],
        bioTemplates: [
            '键盘侠出身，在各大论坛留下无数战绩，现实中其实有点社恐。',
            '退休水军，如今在小区群里发挥余热，谁都喷过一遍。',
            '前豆瓣鹅组资深成员，擅长花式阴阳怪气。',
        ],
        backstoryTemplates: [
            '曾因一条微博和半个互联网对线三天，账号被封了七个。搬进公寓后发现隔壁住着当年的论战对手。',
            '大学时是校园BBS的风云人物，毕业后把战场转移到微博和知乎。最近被公司优化，有大把时间上网冲浪。',
            '自称"互联网考古学家"，手机里存了三百多张截图等着秋后算账。在公寓群里经常"友善"地提醒大家注意素质。',
        ],
    },
    {
        profession: 'fanfic_writer',
        personalityPool: [['文青','敏感','脑洞大'], ['社恐','宅','有品味'], ['话多','热情','不按常理出牌']],
        bioTemplates: [
            '日更三千字的同人文写手，AO3和LOFTER双平台运营。',
            '擅长刀人的BE作者，写完自己先哭。白天上班族，晚上产粮机器。',
            '多CP战士，墙头众多但每个都爱得真诚。梦想出一本同人志。',
        ],
        backstoryTemplates: [
            '高中在贴吧写的第一篇同人文意外爆火，从此走上不归路。搬来是因为旧房东嫌TA半夜敲键盘太吵。',
            '写的一篇文被原作者翻牌，至今是人生高光时刻。正在筹备线下同好聚会。',
            '和画师室友是网上认识的，为了一起搞创作才合租。最近正在肝十万字长篇。',
        ],
    },
    {
        profession: 'fan_artist',
        personalityPool: [['精致','有品味','独立'], ['社恐','宅','敏感'], ['叛逆','不按常理出牌','有品味']],
        bioTemplates: [
            '半夜两点还在赶稿的同人画师，iPad是生命。约稿排到半年后。',
            '擅长画甜饼的太太，笔下人物自带滤镜。偶尔接商稿补贴生活。',
            '从涂鸦到板绘自学成才，风格独特辨识度极高。梦想开画展。',
        ],
        backstoryTemplates: [
            '美院毕业后在二次元圈混得风生水起。父母至今以为TA在正经画画。',
            '一张同人图在推特上被转了两万次，从此打开新世界。和文手室友是灵魂伙伴。',
            '曾因画风之争和另一个画师在超话大战三百回合。搬进公寓后发现对方就住楼上。',
        ],
    },
    {
        profession: 'college_student',
        personalityPool: [['社牛','爱玩','好奇'], ['卷王','上进','焦虑'], ['摸鱼','佛系','随缘']],
        bioTemplates: [
            '大三学生，在考研和摆烂之间反复横跳。室友觉得TA是隐藏学霸。',
            '刚转来的交换生，对一切充满好奇。社交能力惊人但考试成谜。',
            '研二在读，课题做不下去就来楼下串门。论文deadline是永远的痛。',
        ],
        backstoryTemplates: [
            '高考超常发挥考进985，发现身边的人都比自己强。租了单间想安静学习，结果天天被邻居热闹吸引。',
            '社团参加了八个，绩点在及格线徘徊。父母以为TA在认真读书，其实每天参加各种局。',
            '被导师催论文催到搬出宿舍，发现公寓比宿舍还热闹。论文进度为零，八卦储量为满。',
        ],
    },
    {
        profession: 'tired_worker',
        personalityPool: [['佛系','丧','敏感'], ['社恐','宅','焦虑'], ['上进','焦虑','卷王']],
        bioTemplates: [
            '996是日常，每天地铁通勤两小时。最大愿望是睡到自然醒。',
            '互联网大厂螺丝钉，工牌上的微笑是最后的体面。周末只想躺平。',
            '从大厂跳到创业公司又跳回大厂，发现哪里都一样累。养了只猫当精神支柱。',
        ],
        backstoryTemplates: [
            '曾是充满理想的应届生，三年社畜磨平了棱角。搬来是因为离公司近，能多睡半小时。',
            '上份工作太拼进了医院，辞职后因为房贷不得不立刻找下家。在公寓里是最安静的存在。',
            '工作之余在B站吐槽职场意外火了。白天社畜晚上UP主，比以前更累了。',
        ],
    },
    {
        profession: 'old_fashioned',
        personalityPool: [['严肃','固执','讲原则'], ['高冷','独立','要强'], ['唠叨','热心','老好人']],
        bioTemplates: [
            '坚持看报纸的最后一代人，觉得年轻人不靠谱。但谁有困难都帮。',
            '退休教师，自封"楼长"。作息规律到能当钟表。',
            '前国企中层，说话永远端着。最看不惯年轻人熬夜和点外卖。',
        ],
        backstoryTemplates: [
            '在这栋楼住最久，见证无数住户来去。嘴上说受不了年轻人吵闹，每次有人搬走都偷偷难过。',
            '老伴去世后独居，每天最大乐趣是楼下和老人下棋。对隔壁年轻人又好奇又嫌弃。',
            '子女都在外地，逢年过节才回来。在公寓群最爱发早安图和养生链接。年轻人嘴上嫌烦，其实都挺喜欢TA。',
        ],
    },
    {
        profession: 'programmer',
        personalityPool: [['宅','社恐','理性'], ['卷王','上进','焦虑'], ['摸鱼','佛系','话少']],
        bioTemplates: [
            '写代码比说话流利，GitHub绿得像草原。冰箱里永远只有可乐和外卖。',
            '全栈工程师，从前端写到运维。头发是唯一软肋。',
            '35岁危机提前到来的码农，正在偷偷学新技术准备跳槽。',
        ],
        backstoryTemplates: [
            '从小就拆电脑，大学自学编程拿了ACM银牌。工作后发现写业务代码和竞赛完全不同。',
            '创业失败两次，现在老实在大厂搬砖。偶尔半夜打开side project看看，叹口气关掉。',
            '上次因需求变更和产品经理在会议室吵了一架，现在是公寓里"社恐但吵架很厉害的人"。',
        ],
    },
    {
        profession: 'fashion_designer',
        personalityPool: [['精致','自恋','外貌协会'], ['叛逆','独立','有品味'], ['话多','热情','不按常理出牌']],
        bioTemplates: [
            '独立设计师，小红书上有死忠粉。衣柜比卧室大。',
            '从快时尚跳出做独立品牌，审美在线但余额不在线。',
            '海归设计师，巴黎学的高定回来做淘宝店。但每天穿得像走红毯。',
        ],
        backstoryTemplates: [
            '从小爱把妈妈衣服剪了重缝，被打无数次。现在妈妈成了TA最大粉丝。',
            '在某时装周后台实习过，回来后对公寓所有人的穿搭都看不下去。自愿当造型顾问。',
            '为省钱租了最小的房间，预算全砸在面料上。工作台从卧室延伸到客厅，室友习惯了满地布料。',
        ],
    },
    {
        profession: 'influencer',
        personalityPool: [['社牛','话多','自恋'], ['精致','外貌协会','上进'], ['话题女王','八卦','消息灵通']],
        bioTemplates: [
            '小红书十万粉博主，每顿饭先拍照。生活的每刻都是素材。',
            '从素人到网红只用一条视频，但维持流量需要每天营业。',
            '直播带货新手，正在搭建自己的IP。室友经常被拉去当群演。',
        ],
        backstoryTemplates: [
            '辞掉稳定工作全职自媒体，父母以为TA还在上班。每天最紧张的是看后台数据。',
            '一条吐槽视频上了热搜，从此开启网红之路。把公共区域变成拍摄场地，引发了小型内战。',
            '曾在直播间翻车掉了两万粉。现在做内容如履薄冰，但表面永远元气满满。',
        ],
    },
    {
        profession: 'barista',
        personalityPool: [['文青','有品味','独立'], ['佛系','随缘','暖男/暖女'], ['社牛','热心','话多']],
        bioTemplates: [
            '咖啡鉴赏师，能从拿铁判断豆子产地。梦想开精品咖啡馆。',
            '前白领转行做咖啡师，觉得拉花比做PPT有意义。',
            '在楼下咖啡店工作，是公寓所有人的"续命恩人"。',
        ],
        backstoryTemplates: [
            '辞掉高薪金融工作学咖啡，所有人觉得TA疯了。两年后拿下SCA认证。',
            '在楼下咖啡店打工，是公寓消息最灵通的人。谁吵架谁暗恋，TA比当事人都清楚。',
            '在意大利学了半年咖啡，回来发现国内精品咖啡已经卷得不行。正在攒钱开店。',
        ],
    },
];

// ── NPC 关系模板 ─────────────────────────────────────────────

interface NPCRelationshipSeed {
    type: string;
    relValue: number;
    addGrudge?: boolean;
    addCrush?: boolean;
}

const RELATIONSHIP_SEEDS: NPCRelationshipSeed[] = [
    { type: 'friends', relValue: 40 },
    { type: 'rivals', relValue: -20, addGrudge: true },
    { type: 'crush', relValue: 50, addCrush: true },
    { type: 'strangers', relValue: 5 },
    { type: 'exes', relValue: -30, addGrudge: true },
    { type: 'childhood_friends', relValue: 60 },
    { type: 'online_friends', relValue: 30 },
];

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function rollGender(): SimGender {
    const r = Math.random();
    return r < 0.45 ? 'male' : r < 0.9 ? 'female' : 'nonbinary';
}

const GENDER_LABELS: Record<SimGender, string> = { male: '♂', female: '♀', nonbinary: '⚧' };
export function getGenderLabel(g?: SimGender): string { return g ? GENDER_LABELS[g] : ''; }

/** 根据原型生成一个完整的NPC（带故事） */
function rollNPCFromArchetype(name: string, archetype: NPCArchetype): SimNPC {
    const personality = pickRandom(archetype.personalityPool);
    const bio = pickRandom(archetype.bioTemplates);
    const backstory = pickRandom(archetype.backstoryTemplates);
    const gender = rollGender();

    return {
        id: genId(),
        name,
        emoji: '',
        personality,
        mood: Math.floor(Math.random() * 40) + 30,
        familyId: null,
        profession: archetype.profession,
        gold: Math.floor(Math.random() * 30) + 20,
        gender,
        bio,
        backstory,
        desires: [],
        grudges: [],
        crushes: [],
    };
}

/** 为一组NPC随机roll关系 */
function rollRelationships(npcs: SimNPC[], families: SimFamily[]): void {
    if (npcs.length < 2) return;
    const pairCount = Math.floor(npcs.length * 0.6) + 1;
    const usedPairs = new Set<string>();

    for (let i = 0; i < pairCount; i++) {
        const a = npcs[Math.floor(Math.random() * npcs.length)];
        const b = npcs[Math.floor(Math.random() * npcs.length)];
        if (a.id === b.id) continue;
        const key = [a.id, b.id].sort().join('-');
        if (usedPairs.has(key)) continue;
        usedPairs.add(key);

        const seed = pickRandom(RELATIONSHIP_SEEDS);
        if (seed.addGrudge) {
            if (!a.grudges) a.grudges = [];
            a.grudges.push(b.id);
        }
        if (seed.addCrush) {
            if (!a.crushes) a.crushes = [];
            a.crushes.push(b.id);
        }

        // 更新家庭关系值
        for (const fam of families) {
            if (fam.memberIds.includes(a.id) && fam.memberIds.includes(b.id)) {
                if (!fam.relationships[a.id]) fam.relationships[a.id] = {};
                if (!fam.relationships[b.id]) fam.relationships[b.id] = {};
                fam.relationships[a.id][b.id] = clamp(seed.relValue + Math.floor(Math.random() * 20 - 10));
                fam.relationships[b.id][a.id] = clamp(seed.relValue + Math.floor(Math.random() * 20 - 10));
            }
        }
    }
}

// ── 四季系统 ──────────────────────────────────────────────────

export const SEASON_INFO: Record<SimSeason, { zh: string; emoji: string; color: string; skyGrad: [string,string] }> = {
    spring: { zh: '春', emoji: '🌸', color: '#c4b5fd', skyGrad: ['#1e1b4b','#312e81'] },
    summer: { zh: '夏', emoji: '🌆', color: '#fbbf24', skyGrad: ['#0c0a3e','#1e1b4b'] },
    fall:   { zh: '秋', emoji: '🍁', color: '#f97316', skyGrad: ['#1c1917','#292524'] },
    winter: { zh: '冬', emoji: '🌃', color: '#94a3b8', skyGrad: ['#0f172a','#1e293b'] },
};

export const TIME_INFO: Record<SimTimeOfDay, { zh: string; emoji: string }> = {
    dawn:      { zh: '黎明', emoji: '🌅' },
    morning:   { zh: '上午', emoji: '🌤️' },
    afternoon: { zh: '下午', emoji: '☀️' },
    evening:   { zh: '傍晚', emoji: '🌇' },
    night:     { zh: '夜晚', emoji: '🌙' },
};

const TIME_ORDER: SimTimeOfDay[] = ['dawn','morning','afternoon','evening','night'];

export const WEATHER_INFO: Record<SimWeather, { zh: string; emoji: string }> = {
    sunny:  { zh: '晴天', emoji: '☀️' },
    cloudy: { zh: '多云', emoji: '⛅' },
    rainy:  { zh: '小雨', emoji: '🌧️' },
    stormy: { zh: '暴风雨', emoji: '⛈️' },
    snowy:  { zh: '飘雪', emoji: '🌨️' },
    windy:  { zh: '大风', emoji: '🌬️' },
};

// ── 节日历法 ──────────────────────────────────────────────────

export const FESTIVALS: SimFestival[] = [
    { name: '新年倒计时', season: 'spring', day: 1,  emoji: '🎆', description: '新年了！全城烟花绽放，朋友圈刷爆。', moodBonus: 20, relBonus: 15, chaosChange: -10 },
    { name: '音乐节', season: 'spring', day: 8,  emoji: '🎵', description: '城市音乐节开幕，live house场场爆满。', moodBonus: 15, relBonus: 10, chaosChange: -5 },
    { name: '创业路演', season: 'spring', day: 20, emoji: '💡', description: '创业圈路演日，社交名片疯狂交换中。', moodBonus: 10, relBonus: 5, chaosChange: 0 },
    { name: '泳池派对', season: 'summer', day: 6,  emoji: '🏖️', description: '天台泳池派对！全公寓的人都来了。', moodBonus: 10, relBonus: 8, chaosChange: -3 },
    { name: '啤酒节', season: 'summer', day: 20, emoji: '🍻', description: '夏夜啤酒节！大家喝高了什么都敢说。', moodBonus: 25, relBonus: 15, chaosChange: 8 },
    { name: '双十一', season: 'fall',   day: 14, emoji: '🛒', description: '购物狂欢节！所有人都在比拼购物车。', moodBonus: 15, relBonus: 10, chaosChange: -5 },
    { name: '万圣夜', season: 'fall',   day: 21, emoji: '🎃', description: '万圣节变装派对，面具下暧昧升温。', moodBonus: 12, relBonus: 18, chaosChange: 5 },
    { name: '跨年演唱会', season: 'winter', day: 10, emoji: '🎤', description: '冬日跨年演唱会，灯光和温暖交织。', moodBonus: 8, relBonus: 5, chaosChange: -3 },
    { name: '年终盛典', season: 'winter', day: 27, emoji: '🎊', description: '年末盛典！老板发红包，同事们嗨翻。', moodBonus: 25, relBonus: 20, chaosChange: -20 },
];

// ── 向后兼容存根 ──────────────────────────────────────────────

/** @deprecated 物品系统已移除，保留空对象供旧代码兼容 */
export const ITEM_DEFS: Record<string, { zh: string; emoji: string; basePrice: number; category: string }> = {};

/** @deprecated 活动系统已移除，保留存根供旧代码兼容 */
export function getActivityLabel(_a: any): { zh: string; emoji: string } {
    return { zh: '?', emoji: '?' };
}

/** @deprecated 活动结果系统已移除，保留存根供旧代码兼容 */
export function applyActivityResult(
    state: LifeSimState,
    _npcId: string,
    _activity: any,
    _isFestival: boolean
): { newState: LifeSimState; resultDesc: string } {
    return { newState: deepClone(state), resultDesc: '活动系统已移除。' };
}

/** @deprecated 世界库存系统已移除，保留存根供旧代码兼容 */
export function sellWorldInventory(
    state: LifeSimState,
    _isFestivalDay: boolean
): { newState: LifeSimState; goldEarned: number; desc: string } {
    return { newState: deepClone(state), goldEarned: 0, desc: '库存系统已移除。' };
}

// ── 天气生成 ──────────────────────────────────────────────────

export function generateWeather(season: SimSeason): SimWeather {
    const r = Math.random();
    switch (season) {
        case 'spring': return r < 0.40 ? 'sunny' : r < 0.70 ? 'cloudy' : r < 0.92 ? 'rainy' : 'stormy';
        case 'summer': return r < 0.50 ? 'sunny' : r < 0.72 ? 'cloudy' : r < 0.85 ? 'rainy' : r < 0.95 ? 'stormy' : 'windy';
        case 'fall':   return r < 0.30 ? 'sunny' : r < 0.58 ? 'cloudy' : r < 0.80 ? 'rainy' : r < 0.88 ? 'stormy' : 'windy';
        case 'winter': return r < 0.22 ? 'sunny' : r < 0.48 ? 'cloudy' : r < 0.82 ? 'snowy' : 'stormy';
    }
}

// ── 迁移旧存档 ────────────────────────────────────────────────

/** 为旧存档补全默认值，同时清除已移除的字段 */
export function migrateLifeSimState(state: LifeSimState): LifeSimState {
    const s = deepClone(state);
    if (!s.season) s.season = 'spring';
    if (!s.day) s.day = 1;
    if (!s.year) s.year = 1;
    if (!s.timeOfDay) s.timeOfDay = 'morning';
    if (!s.weather) s.weather = generateWeather(s.season);
    if (s.lastActiveTimestamp === undefined) s.lastActiveTimestamp = Date.now();
    if (s.useIndependentApiConfig === undefined) s.useIndependentApiConfig = false;

    // 清除已移除的旧字段
    delete (s as any).buildings;
    delete (s as any).worldInventory;
    delete (s as any).worldGold;

    for (const npc of s.npcs) {
        if (!npc.profession) npc.profession = PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)];
        if (npc.gold === undefined) npc.gold = Math.floor(Math.random() * 50) + 10;
        // 添加新的戏剧系统字段
        if (!npc.desires) npc.desires = [];
        if (!npc.grudges) npc.grudges = [];
        if (!npc.crushes) npc.crushes = [];
        // 迁移：为旧NPC补充故事字段
        if (!npc.gender) npc.gender = rollGender();
        if (!npc.bio) {
            const arch = NPC_ARCHETYPES.find(a => a.profession === npc.profession);
            npc.bio = arch ? pickRandom(arch.bioTemplates) : undefined;
        }
        if (!npc.backstory) {
            const arch = NPC_ARCHETYPES.find(a => a.profession === npc.profession);
            npc.backstory = arch ? pickRandom(arch.backstoryTemplates) : undefined;
        }
        // 清除已移除的旧字段
        delete (npc as any).energy;
        delete (npc as any).skills;
        delete (npc as any).inventory;
        delete (npc as any).currentActivity;
        delete (npc as any).activityResult;
    }
    return s;
}

// ── 初始化 ───────────────────────────────────────────────────

/** 创建全新游戏状态，默认3个家庭各2个NPC，使用角色原型系统 */
export function createNewLifeSimState(): LifeSimState {
    const families: SimFamily[] = [];
    const npcs: SimNPC[] = [];

    const usedNames = new Set<string>();
    const pickName = () => {
        const shuffled = [...NPC_NAMES].sort(() => Math.random() - 0.5);
        for (const n of shuffled) {
            if (!usedNames.has(n)) { usedNames.add(n); return n; }
        }
        return `小人${genId().slice(0,3)}`;
    };

    // 从原型池中随机抽取6个不同原型
    const shuffledArchetypes = [...NPC_ARCHETYPES].sort(() => Math.random() - 0.5);
    const selectedArchetypes = shuffledArchetypes.slice(0, 6);

    for (let i = 0; i < 3; i++) {
        const familyId = genId();
        const memberIds: string[] = [];

        for (let j = 0; j < 2; j++) {
            const archetype = selectedArchetypes[i * 2 + j];
            const npc = rollNPCFromArchetype(pickName(), archetype);
            npc.familyId = familyId;
            npcs.push(npc);
            memberIds.push(npc.id);
        }

        const relationships: Record<string, Record<string, number>> = {};
        for (const a of memberIds) {
            relationships[a] = {};
            for (const b of memberIds) {
                if (a !== b) relationships[a][b] = Math.floor(Math.random() * 40) + 20;
            }
        }

        const INITIAL_POSITIONS = [
            { x: 20, y: 25 },
            { x: 75, y: 30 },
            { x: 46, y: 63 },
        ];
        const pos = INITIAL_POSITIONS[i] || { x: 15 + i * 30, y: 30 };

        const family: SimFamily = {
            id: familyId,
            name: FAMILY_NAMES[i],
            emoji: FAMILY_EMOJIS[i],
            memberIds,
            relationships,
            homeX: pos.x,
            homeY: pos.y,
        };
        families.push(family);
    }

    // 为NPC们随机roll初始关系网
    rollRelationships(npcs, families);

    return {
        id: genId(),
        createdAt: Date.now(),
        turnNumber: 1,
        currentActorId: 'user',
        families,
        npcs,
        actionLog: [],
        pendingEffects: [],
        chaosLevel: 0,
        charQueue: [],
        replayPending: [],
        useIndependentApiConfig: false,
        isProcessingCharTurn: false,
        gameOver: false,
        season: 'spring',
        day: 1,
        year: 1,
        timeOfDay: 'morning',
        weather: 'sunny',
        lastActiveTimestamp: Date.now(),
    };
}

// ── 工具函数 ─────────────────────────────────────────────────

export function getNPC(state: LifeSimState, id: string): SimNPC | undefined {
    return state.npcs.find(n => n.id === id);
}

export function getFamily(state: LifeSimState, id: string): SimFamily | undefined {
    return state.families.find(f => f.id === id);
}

export function getFamilyMembers(state: LifeSimState, familyId: string): SimNPC[] {
    return state.npcs.filter(n => n.familyId === familyId);
}

export function getIndependentNPCs(state: LifeSimState): SimNPC[] {
    return state.npcs.filter(n => n.familyId === null);
}

export function getRelationship(family: SimFamily, npcA: string, npcB: string): number {
    return family.relationships?.[npcA]?.[npcB] ?? 0;
}

export function clamp(v: number, min = -100, max = 100): number {
    return Math.max(min, Math.min(max, v));
}

export function getProfessionInfo(p: SimProfession) {
    return PROFESSION_LABELS[p] ?? PROFESSION_LABELS.freelancer;
}

/** 计算两个NPC的性格兼容性 (-1 to 1) */
function personalityCompatibility(a: SimNPC, b: SimNPC): number {
    const conflictPairs = [
        ['暴躁', '暴躁'], ['暴躁', '傲娇'], ['暴躁', '要强'],
        ['冲动', '冲动'], ['冲动', '腹黑'],
        ['严肃', '懒散'], ['完美主义', '懒散'],
    ];
    const synergyPairs = [
        ['善良', '单纯'], ['温柔', '单纯'], ['热情', '活泼'],
        ['随和', '善良'], ['乐天', '活泼'], ['理性', '严肃'],
        ['腹黑', '腹黑'],
    ];
    let score = 0;
    for (const [x, y] of conflictPairs) {
        if ((a.personality.includes(x) && b.personality.includes(y)) ||
            (a.personality.includes(y) && b.personality.includes(x))) {
            score -= 0.4;
        }
    }
    for (const [x, y] of synergyPairs) {
        if ((a.personality.includes(x) && b.personality.includes(y)) ||
            (a.personality.includes(y) && b.personality.includes(x))) {
            score += 0.3;
        }
    }
    return clamp(score, -1, 1);
}

// ── 时间推进 ──────────────────────────────────────────────────

/**
 * 推进时间：用户每结束一个回合，时间前进一格
 * dawn -> morning -> afternoon -> evening -> night -> dawn(次日)
 */
export function advanceTimeOfDay(state: LifeSimState): {
    newState: LifeSimState;
    newDay: boolean;
    newSeason: boolean;
    festival?: SimFestival;
    events: string[];
} {
    const s = deepClone(state);
    const events: string[] = [];
    let newDay = false;
    let newSeason = false;
    let festival: SimFestival | undefined;

    const currentIdx = TIME_ORDER.indexOf(s.timeOfDay ?? 'morning');
    const nextIdx = (currentIdx + 1) % TIME_ORDER.length;
    s.timeOfDay = TIME_ORDER[nextIdx];

    // 到黎明 = 新的一天
    if (s.timeOfDay === 'dawn') {
        newDay = true;
        s.day = (s.day ?? 1) + 1;

        // 新天气
        s.weather = generateWeather(s.season ?? 'spring');
        events.push(`${TIME_INFO.dawn.emoji} 新的一天开始了——今日天气：${WEATHER_INFO[s.weather].zh} ${WEATHER_INFO[s.weather].emoji}`);

        // 检查节日
        const fest = FESTIVALS.find(f => f.season === s.season && f.day === s.day);
        if (fest) {
            festival = fest;
            s.lastFestival = fest.name;
            // 应用节日效果
            for (const npc of s.npcs) {
                npc.mood = clamp(npc.mood + fest.moodBonus);
            }
            for (const fam of s.families) {
                for (const aId of fam.memberIds) {
                    for (const bId of fam.memberIds) {
                        if (aId !== bId) {
                            if (!fam.relationships[aId]) fam.relationships[aId] = {};
                            fam.relationships[aId][bId] = clamp((fam.relationships[aId][bId] ?? 0) + fest.relBonus);
                        }
                    }
                }
            }
            s.chaosLevel = clamp(s.chaosLevel + fest.chaosChange, 0, 100);
            events.push(`${fest.emoji} 节日：${fest.name}！${fest.description}`);
        }

        // 检查季节切换（28天一个季节）
        if ((s.day ?? 1) > 28) {
            newSeason = true;
            s.day = 1;
            const seasonOrder: SimSeason[] = ['spring', 'summer', 'fall', 'winter'];
            const currentSeasonIdx = seasonOrder.indexOf(s.season ?? 'spring');
            const nextSeasonIdx = (currentSeasonIdx + 1) % seasonOrder.length;
            s.season = seasonOrder[nextSeasonIdx];
            if (nextSeasonIdx === 0) s.year = (s.year ?? 1) + 1; // 冬→春 = 新年
            s.weather = generateWeather(s.season);
            const si = SEASON_INFO[s.season];
            events.push(`${si.emoji} 季节交替！迎来${si.zh}季。`);
        }
    }

    return { newState: s, newDay, newSeason, festival, events };
}

// ── 后果引擎 ────────────────────────────────────────────────

export interface ActionResult {
    newState: LifeSimState;
    immediateResult: string;
    pendingDesc?: string;
}

export function createNPC(name?: string, emoji?: string, personality?: string[]): SimNPC {
    const n = name || NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)];
    const e = emoji || NPC_EMOJIS[Math.floor(Math.random() * NPC_EMOJIS.length)];
    const p = personality || PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
    // 如果有匹配的原型就用原型生成故事，否则随机
    const matchedArchetype = NPC_ARCHETYPES.find(a => p.some(trait => a.personalityPool.flat().includes(trait)));
    const profession = matchedArchetype?.profession || PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)];
    const gender = rollGender();
    const bio = matchedArchetype ? pickRandom(matchedArchetype.bioTemplates) : undefined;
    const backstory = matchedArchetype ? pickRandom(matchedArchetype.backstoryTemplates) : undefined;
    return {
        id: genId(),
        name: n,
        emoji: e,
        personality: p,
        mood: Math.floor(Math.random() * 30) + 40,
        familyId: null,
        profession,
        gold: Math.floor(Math.random() * 20) + 10,
        gender,
        bio,
        backstory,
        desires: [],
        grudges: [],
        crushes: [],
    };
}

export function applyAddNPC(
    state: LifeSimState,
    npc: SimNPC,
    targetFamilyId: string
): ActionResult {
    const s = deepClone(state);
    const family = s.families.find(f => f.id === targetFamilyId);
    if (!family) return { newState: s, immediateResult: '公寓不存在，什么都没发生。' };

    npc.familyId = targetFamilyId;
    s.npcs.push(npc);
    family.memberIds.push(npc.id);

    const existing = family.memberIds.filter(id => id !== npc.id);
    for (const memberId of existing) {
        const member = s.npcs.find(n => n.id === memberId);
        if (!member) continue;
        const compat = personalityCompatibility(npc, member);
        const base = Math.floor(compat * 40 + (Math.random() * 20 - 10));
        if (!family.relationships[npc.id]) family.relationships[npc.id] = {};
        if (!family.relationships[memberId]) family.relationships[memberId] = {};
        family.relationships[npc.id][memberId] = clamp(base);
        family.relationships[memberId][npc.id] = clamp(base + Math.floor(Math.random() * 20 - 10));
    }

    const avgRel = existing.length > 0
        ? existing.reduce((sum, id) => sum + (family.relationships[npc.id]?.[id] ?? 0), 0) / existing.length
        : 50;

    const profInfo = getProfessionInfo(npc.profession ?? 'freelancer');
    let result = '';
    let pendingDesc: string | undefined;

    if (avgRel < -20) {
        result = `${npc.emoji}${npc.name}（${profInfo.emoji}${profInfo.zh}）搬进了${family.name}，但气场完全不对，室友们的表情很微妙……`;
        const eff: SimPendingEffect = {
            id: genId(),
            triggerTurn: s.turnNumber + 3,
            npcId: npc.id,
            familyId: targetFamilyId,
            description: `${npc.name}和${family.name}室友的矛盾持续积累，快要爆发了`,
            effectCode: 'fight_break',
            effectValue: -20,
        };
        s.pendingEffects.push(eff);
        s.chaosLevel = clamp(s.chaosLevel + 10, 0, 100);
        pendingDesc = eff.description;
    } else if (avgRel > 30) {
        result = `${npc.emoji}${npc.name}（${profInfo.emoji}${profInfo.zh}）搬进了${family.name}，大家聊得很来，直接约了周末聚餐！`;
        npc.mood = clamp(npc.mood + 10);
    } else {
        result = `${npc.emoji}${npc.name}（${profInfo.emoji}${profInfo.zh}）搬进了${family.name}，室友们在客厅偷偷打量中……`;
    }

    return { newState: s, immediateResult: result, pendingDesc };
}

export function applyMoveNPC(
    state: LifeSimState,
    npcId: string,
    targetFamilyId: string | null
): ActionResult {
    const s = deepClone(state);
    const npc = s.npcs.find(n => n.id === npcId);
    if (!npc) return { newState: s, immediateResult: '找不到这个NPC。' };

    const oldFamilyId = npc.familyId;
    const oldFamily = oldFamilyId ? s.families.find(f => f.id === oldFamilyId) : null;
    const newFamily = targetFamilyId ? s.families.find(f => f.id === targetFamilyId) : null;

    if (oldFamily) {
        oldFamily.memberIds = oldFamily.memberIds.filter(id => id !== npcId);
        for (const memberId of oldFamily.memberIds) {
            const rel = oldFamily.relationships?.[npcId]?.[memberId] ?? 0;
            const member = s.npcs.find(n => n.id === memberId);
            if (member) member.mood = clamp(member.mood + (rel < 0 ? 15 : -5));
        }
    }

    if (newFamily) {
        npc.familyId = targetFamilyId;
        newFamily.memberIds.push(npcId);
        for (const memberId of newFamily.memberIds.filter(id => id !== npcId)) {
            const member = s.npcs.find(n => n.id === memberId);
            if (!member) continue;
            const compat = personalityCompatibility(npc, member);
            const base = Math.floor(compat * 30 + (Math.random() * 20 - 10));
            if (!newFamily.relationships[npcId]) newFamily.relationships[npcId] = {};
            if (!newFamily.relationships[memberId]) newFamily.relationships[memberId] = {};
            newFamily.relationships[npcId][memberId] = clamp(base);
            newFamily.relationships[memberId][npcId] = clamp(base);
        }
    } else {
        npc.familyId = null;
        s.chaosLevel = clamp(s.chaosLevel + 5, 0, 100);
    }

    const from = oldFamily ? oldFamily.name : '独居';
    const to = newFamily ? newFamily.name : '独居';
    return { newState: s, immediateResult: `${npc.emoji}${npc.name}从${from}搬到了${to}。` };
}

export function applyGoSolo(
    state: LifeSimState,
    npcId: string,
    newFamilyName?: string
): ActionResult {
    const s = deepClone(state);
    const npc = s.npcs.find(n => n.id === npcId);
    if (!npc) return { newState: s, immediateResult: '找不到这个NPC。' };

    const oldFamily = npc.familyId ? s.families.find(f => f.id === npc.familyId) : null;
    if (oldFamily) oldFamily.memberIds = oldFamily.memberIds.filter(id => id !== npcId);

    const newFamilyId = genId();
    const familyName = newFamilyName || `${npc.name}的单人公寓`;
    const SOLO_POSITIONS = [
        { x: 12, y: 55 }, { x: 85, y: 20 }, { x: 50, y: 12 },
        { x: 88, y: 68 }, { x: 8, y: 72 }, { x: 60, y: 82 },
    ];
    const soloPos = SOLO_POSITIONS[s.families.length % SOLO_POSITIONS.length];
    const newFamily: SimFamily = {
        id: newFamilyId,
        name: familyName,
        emoji: '🏢',
        memberIds: [npcId],
        relationships: {},
        homeX: Math.max(5, Math.min(93, soloPos.x + Math.floor(Math.random() * 8 - 4))),
        homeY: Math.max(5, Math.min(90, soloPos.y + Math.floor(Math.random() * 8 - 4))),
    };
    s.families.push(newFamily);
    npc.familyId = newFamilyId;
    s.chaosLevel = clamp(s.chaosLevel + 8, 0, 100);

    return { newState: s, immediateResult: `${npc.emoji}${npc.name}搬出去单住了，在"${familyName}"开始独居生活！${oldFamily ? `${oldFamily.name}的室友们都没想到。` : ''}` };
}

/** 根据NPC特征生成世界故事叙述 */
function buildWorldStoryNarration(eventType: SimEventType, involvedNpcs: SimNPC[], description: string): string {
    const names = involvedNpcs.map(n => {
        const prof = getProfessionInfo(n.profession ?? 'freelancer');
        return `${n.name}（${prof.zh}）`;
    });
    const nameStr = names.join('、');

    // 根据NPC的职业和性格生成更丰富的故事
    const storyTemplates: Record<SimEventType, string[]> = {
        fight: [
            `💢 ${nameStr}之间爆发了一场激烈的冲突！${description ? description + '。' : ''}整栋楼都能听到争吵声，其他住户纷纷关上门假装没听到……`,
            `💢 因为一件小事，${nameStr}彻底撕破了脸！${description ? description + '。' : ''}公寓群里的气氛骤然紧张，大家开始站队。`,
            `💢 ${nameStr}在公共区域大吵了一架！${description ? description + '。' : ''}有人在群里直播了全程，评论区已经炸了。`,
        ],
        party: [
            `🎉 ${nameStr}决定一起办一场聚会！${description ? description + '。' : ''}欢声笑语从客厅传到走廊，连平时不出门的住户都探出了头。`,
            `🎉 一场突如其来的聚会在公寓里展开——${nameStr}是主要参与者。${description ? description + '。' : ''}大家的关系在推杯换盏中悄悄升温。`,
            `🎉 ${nameStr}组了个局！${description ? description + '。' : ''}气氛热烈到隔壁楼都来打听发生了什么。`,
        ],
        romance: [
            `💕 ${nameStr}之间的气氛突然变得微妙起来……${description ? description + '。' : ''}其他住户开始在背后窃窃私语，公寓里的八卦值直线上升。`,
            `💕 有眼尖的住户发现${nameStr}最近走得特别近！${description ? description + '。' : ''}这到底是友情还是爱情？整栋楼都在吃瓜。`,
            `💕 某个深夜，${nameStr}被发现在楼顶天台聊了很久……${description ? description + '。' : ''}第二天公寓群里炸开了锅。`,
        ],
        gossip: [
            `🤫 一条关于${nameStr}的八卦开始在公寓里疯传……${description ? description + '。' : ''}没人知道消息源头在哪，但每个人都绘声绘色地在转述。`,
            `🤫 ${nameStr}的一些"秘密"突然在公寓群里被爆了出来！${description ? description + '。' : ''}当事人的心情急转直下，其他人却看得津津有味。`,
            `🤫 有人在匿名树洞里爆料了关于${nameStr}的猛料！${description ? description + '。' : ''}整栋楼的吃瓜群众都坐不住了。`,
        ],
        rivalry: [
            `⚔️ ${nameStr}之间的暗中较劲浮上了水面！${description ? description + '。' : ''}从此公寓里多了一层剑拔弩张的气氛。`,
            `⚔️ 不知不觉间，${nameStr}开始了一场无声的竞争。${description ? description + '。' : ''}其他住户夹在中间左右为难。`,
            `⚔️ ${nameStr}正式宣战了！${description ? description + '。' : ''}公寓的和平日子一去不复返……`,
        ],
        alliance: [
            `🤝 ${nameStr}悄悄达成了某种默契……${description ? description + '。' : ''}他们开始频繁地碰头密谈，其他人感到了一丝不安。`,
            `🤝 出人意料地，${nameStr}居然联手了！${description ? description + '。' : ''}这个同盟将改变公寓里的力量格局。`,
            `🤝 ${nameStr}结成了同盟！${description ? description + '。' : ''}有了彼此的支持，他们在公寓里的话语权明显增强。`,
        ],
    };

    const templates = storyTemplates[eventType] || [`${description}`];
    return templates[Math.floor(Math.random() * templates.length)];
}

export function applyTriggerEvent(
    state: LifeSimState,
    eventType: SimEventType,
    involvedIds: string[],
    description: string
): ActionResult {
    const s = deepClone(state);
    const involvedNpcs = involvedIds.map(id => s.npcs.find(n => n.id === id)).filter((n): n is SimNPC => !!n);
    let result = '';

    switch (eventType) {
        case 'fight': {
            for (let i = 0; i < involvedIds.length; i++) {
                const npc = s.npcs.find(n => n.id === involvedIds[i]);
                if (npc) npc.mood = clamp(npc.mood - 20);
                for (let j = i + 1; j < involvedIds.length; j++) {
                    const npcA = involvedIds[i]; const npcB = involvedIds[j];
                    for (const fam of s.families) {
                        if (fam.memberIds.includes(npcA) && fam.memberIds.includes(npcB)) {
                            if (!fam.relationships[npcA]) fam.relationships[npcA] = {};
                            if (!fam.relationships[npcB]) fam.relationships[npcB] = {};
                            fam.relationships[npcA][npcB] = clamp((fam.relationships[npcA][npcB] ?? 0) - 30);
                            fam.relationships[npcB][npcA] = clamp((fam.relationships[npcB][npcA] ?? 0) - 30);
                        }
                    }
                }
            }
            s.chaosLevel = clamp(s.chaosLevel + 15, 0, 100);
            break;
        }
        case 'party': {
            for (const npcId of involvedIds) {
                const npc = s.npcs.find(n => n.id === npcId);
                if (npc) npc.mood = clamp(npc.mood + 15);
            }
            for (let i = 0; i < involvedIds.length; i++) {
                for (let j = i + 1; j < involvedIds.length; j++) {
                    const npcA = involvedIds[i]; const npcB = involvedIds[j];
                    for (const fam of s.families) {
                        if (fam.memberIds.includes(npcA) && fam.memberIds.includes(npcB)) {
                            if (!fam.relationships[npcA]) fam.relationships[npcA] = {};
                            if (!fam.relationships[npcB]) fam.relationships[npcB] = {};
                            fam.relationships[npcA][npcB] = clamp((fam.relationships[npcA][npcB] ?? 0) + 20);
                            fam.relationships[npcB][npcA] = clamp((fam.relationships[npcB][npcA] ?? 0) + 20);
                        }
                    }
                }
            }
            s.chaosLevel = clamp(s.chaosLevel - 5, 0, 100);
            break;
        }
        case 'romance': {
            if (involvedIds.length >= 2) {
                const [npcAId, npcBId] = involvedIds;
                for (const fam of s.families) {
                    if (fam.memberIds.includes(npcAId) && fam.memberIds.includes(npcBId)) {
                        if (!fam.relationships[npcAId]) fam.relationships[npcAId] = {};
                        if (!fam.relationships[npcBId]) fam.relationships[npcBId] = {};
                        fam.relationships[npcAId][npcBId] = clamp((fam.relationships[npcAId][npcBId] ?? 0) + 35);
                        fam.relationships[npcBId][npcAId] = clamp((fam.relationships[npcBId][npcAId] ?? 0) + 35);
                    }
                }
            }
            s.chaosLevel = clamp(s.chaosLevel + 8, 0, 100);
            break;
        }
        case 'gossip': {
            s.chaosLevel = clamp(s.chaosLevel + 12, 0, 100);
            if (involvedIds.length > 0) {
                const targetNpc = s.npcs.find(n => n.id === involvedIds[0]);
                if (targetNpc) targetNpc.mood = clamp(targetNpc.mood - 10);
            }
            break;
        }
        case 'alliance': {
            s.chaosLevel = clamp(s.chaosLevel + 5, 0, 100);
            break;
        }
        case 'rivalry': {
            s.chaosLevel = clamp(s.chaosLevel + 10, 0, 100);
            break;
        }
    }

    result = buildWorldStoryNarration(eventType, involvedNpcs, description);
    return { newState: s, immediateResult: result };
}

// ── 事件链辅助：生成延迟效果 ────────────────────────────────

function spawnEffect(
    state: LifeSimState,
    code: SimEffectCode,
    delayTurns: number,
    description: string,
    opts?: {
        npcId?: string;
        familyId?: string;
        involvedNpcIds?: string[];
        severity?: number;
        chainFrom?: string;
    }
): void {
    state.pendingEffects.push({
        id: genId(),
        triggerTurn: state.turnNumber + delayTurns,
        effectCode: code,
        description,
        npcId: opts?.npcId,
        familyId: opts?.familyId,
        involvedNpcIds: opts?.involvedNpcIds,
        severity: opts?.severity ?? 1,
        chainFrom: opts?.chainFrom,
    });
}

/** 在所有家庭中查找两个NPC之间的关系值 */
function findRelationship(state: LifeSimState, aId: string, bId: string): { family: SimFamily; value: number } | null {
    for (const fam of state.families) {
        if (fam.memberIds.includes(aId) && fam.memberIds.includes(bId)) {
            return { family: fam, value: fam.relationships?.[aId]?.[bId] ?? 0 };
        }
    }
    return null;
}

/** 修改两个NPC之间的关系（同一家庭内） */
function adjustRelationship(state: LifeSimState, aId: string, bId: string, delta: number): void {
    for (const fam of state.families) {
        if (fam.memberIds.includes(aId) && fam.memberIds.includes(bId)) {
            if (!fam.relationships[aId]) fam.relationships[aId] = {};
            if (!fam.relationships[bId]) fam.relationships[bId] = {};
            fam.relationships[aId][bId] = clamp((fam.relationships[aId][bId] ?? 0) + delta);
            fam.relationships[bId][aId] = clamp((fam.relationships[bId][aId] ?? 0) + delta);
            return;
        }
    }
}

/** 将NPC移出当前家庭，创建独立家庭 */
function makeNPCRunaway(state: LifeSimState, npc: SimNPC): string {
    const oldFamily = npc.familyId ? state.families.find(f => f.id === npc.familyId) : null;
    if (oldFamily) {
        oldFamily.memberIds = oldFamily.memberIds.filter(id => id !== npc.id);
    }
    const newFamId = genId();
    const SOLO_POSITIONS = [
        { x: 12, y: 55 }, { x: 85, y: 20 }, { x: 50, y: 12 },
        { x: 88, y: 68 }, { x: 8, y: 72 }, { x: 60, y: 82 },
    ];
    const soloPos = SOLO_POSITIONS[state.families.length % SOLO_POSITIONS.length];
    state.families.push({
        id: newFamId,
        name: `${npc.name}的单人公寓`,
        emoji: '🏢',
        memberIds: [npc.id],
        relationships: {},
        homeX: Math.max(5, Math.min(93, soloPos.x + Math.floor(Math.random() * 8 - 4))),
        homeY: Math.max(5, Math.min(90, soloPos.y + Math.floor(Math.random() * 8 - 4))),
    });
    npc.familyId = newFamId;
    return newFamId;
}

// ── 结算待决效果 ─────────────────────────────────────────────

export function settlePendingEffects(state: LifeSimState): { newState: LifeSimState; events: string[] } {
    const s = deepClone(state);
    const events: string[] = [];
    const remaining: SimPendingEffect[] = [];

    for (const eff of s.pendingEffects) {
        if (eff.triggerTurn <= s.turnNumber) {
            switch (eff.effectCode) {

                // ── fight_break (矛盾爆发) ──
                case 'fight_break': {
                    if (eff.npcId && eff.familyId) {
                        const npc = s.npcs.find(n => n.id === eff.npcId);
                        const family = s.families.find(f => f.id === eff.familyId);
                        if (npc && family) {
                            npc.mood = clamp(npc.mood - 25);
                            s.chaosLevel = clamp(s.chaosLevel + 15, 0, 100);
                            if (npc.mood < -20 && Math.random() > 0.4) {
                                makeNPCRunaway(s, npc);
                                events.push(`💥 ${eff.description}——${npc.name}彻底忍不了了，连夜搬走！`);
                            } else {
                                events.push(`😤 ${eff.description}——大吵一架，但勉强没搬走。`);
                                // 60% chance spawns revenge_plot in 2-4 turns
                                if (Math.random() < 0.6) {
                                    const otherMembers = family.memberIds.filter(id => id !== npc.id);
                                    if (otherMembers.length > 0) {
                                        const targetId = otherMembers[Math.floor(Math.random() * otherMembers.length)];
                                        const target = s.npcs.find(n => n.id === targetId);
                                        spawnEffect(s, 'revenge_plot', 2 + Math.floor(Math.random() * 3),
                                            `${npc.name}对${target?.name ?? '某人'}怀恨在心，酝酿着复仇……`,
                                            { npcId: npc.id, involvedNpcIds: [npc.id, targetId], chainFrom: eff.id });
                                    }
                                }
                            }
                        }
                    }
                    break;
                }

                // ── mood_drop (心情低落) ──
                case 'mood_drop': {
                    if (eff.npcId) {
                        const npc = s.npcs.find(n => n.id === eff.npcId);
                        if (npc) {
                            npc.mood = clamp(npc.mood + (eff.effectValue ?? -15));
                            events.push(`😞 ${eff.description}`);
                        }
                    }
                    break;
                }

                // ── relationship_change (关系变化) ──
                case 'relationship_change': {
                    events.push(`🔄 ${eff.description}`);
                    break;
                }

                // ── revenge_plot (复仇计划) ──
                case 'revenge_plot': {
                    const involved = eff.involvedNpcIds ?? [];
                    const npc = eff.npcId ? s.npcs.find(n => n.id === eff.npcId) : null;
                    const targetId = involved.find(id => id !== eff.npcId);
                    const target = targetId ? s.npcs.find(n => n.id === targetId) : null;
                    if (npc && target) {
                        npc.mood = clamp(npc.mood - 20);
                        target.mood = clamp(target.mood - 20);
                        adjustRelationship(s, npc.id, target.id, -40);
                        s.chaosLevel = clamp(s.chaosLevel + 12, 0, 100);
                        // Add grudge
                        if (!npc.grudges) npc.grudges = [];
                        if (!npc.grudges.includes(target.id)) npc.grudges.push(target.id);
                        events.push(`🗡️ ${npc.name}对${target.name}发起了报复！两人大打出手，关系降至冰点！`);
                        // If mood already very low, 50% chance spawns npc_runaway
                        if (npc.mood < -30 && Math.random() < 0.5) {
                            spawnEffect(s, 'npc_runaway', 1,
                                `${npc.name}心灰意冷，准备离开……`,
                                { npcId: npc.id, chainFrom: eff.id });
                        }
                    }
                    break;
                }

                // ── love_triangle (三角恋) ──
                case 'love_triangle': {
                    const involved = eff.involvedNpcIds ?? [];
                    if (involved.length >= 3) {
                        const [compA, compB, crushTarget] = involved;
                        const npcA = s.npcs.find(n => n.id === compA);
                        const npcB = s.npcs.find(n => n.id === compB);
                        const crushNpc = s.npcs.find(n => n.id === crushTarget);
                        if (npcA && npcB && crushNpc) {
                            adjustRelationship(s, compA, compB, -30);
                            s.chaosLevel = clamp(s.chaosLevel + 10, 0, 100);
                            events.push(`💔 ${npcA.name}和${npcB.name}都喜欢${crushNpc.name}，两人之间的火药味越来越浓！`);
                            // 40% chance spawns betrayal in 2-3 turns
                            if (Math.random() < 0.4) {
                                const betrayer = Math.random() < 0.5 ? compA : compB;
                                const victim = betrayer === compA ? compB : compA;
                                const betrayerNpc = s.npcs.find(n => n.id === betrayer);
                                const victimNpc = s.npcs.find(n => n.id === victim);
                                spawnEffect(s, 'betrayal', 2 + Math.floor(Math.random() * 2),
                                    `${betrayerNpc?.name ?? '某人'}暗中背叛了${victimNpc?.name ?? '某人'}的信任……`,
                                    { npcId: betrayer, involvedNpcIds: [betrayer, victim], chainFrom: eff.id });
                            }
                        }
                    }
                    break;
                }

                // ── jealousy_spiral (嫉妒螺旋) ──
                case 'jealousy_spiral': {
                    const npc = eff.npcId ? s.npcs.find(n => n.id === eff.npcId) : null;
                    if (npc) {
                        npc.mood = clamp(npc.mood - 25);
                        events.push(`😈 ${npc.name}被嫉妒吞噬，开始到处说别人的坏话！`);
                        // Spawns gossip_wildfire in 1-2 turns
                        spawnEffect(s, 'gossip_wildfire', 1 + Math.floor(Math.random() * 2),
                            `${npc.name}的嫉妒引发了一波八卦风暴……`,
                            { npcId: npc.id, familyId: npc.familyId ?? undefined, chainFrom: eff.id });
                    }
                    break;
                }

                // ── family_feud (家族世仇) ──
                case 'family_feud': {
                    const involved = eff.involvedNpcIds ?? [];
                    // Find two families from involved NPC IDs
                    const familyIds = new Set<string>();
                    for (const nId of involved) {
                        const n = s.npcs.find(nn => nn.id === nId);
                        if (n?.familyId) familyIds.add(n.familyId);
                    }
                    const famIdArr = Array.from(familyIds);
                    if (famIdArr.length >= 2) {
                        const famA = s.families.find(f => f.id === famIdArr[0]);
                        const famB = s.families.find(f => f.id === famIdArr[1]);
                        if (famA && famB) {
                            // Cross-family relationships all drop -20
                            for (const aId of famA.memberIds) {
                                for (const bId of famB.memberIds) {
                                    adjustRelationship(s, aId, bId, -20);
                                }
                            }
                            s.chaosLevel = clamp(s.chaosLevel + 15, 0, 100);
                            events.push(`⚔️ ${famA.name}和${famB.name}爆发了公寓大战！所有跨公寓关系急剧恶化！`);
                            // 30% chance: weakest-mood member runs away
                            if (Math.random() < 0.3) {
                                const allMembers = [...famA.memberIds, ...famB.memberIds]
                                    .map(id => s.npcs.find(n => n.id === id))
                                    .filter((n): n is SimNPC => !!n);
                                if (allMembers.length > 0) {
                                    const weakest = allMembers.reduce((a, b) => a.mood < b.mood ? a : b);
                                    spawnEffect(s, 'npc_runaway', 1,
                                        `${weakest.name}受不了家族争斗的压力……`,
                                        { npcId: weakest.id, chainFrom: eff.id });
                                }
                            }
                        }
                    }
                    break;
                }

                // ── betrayal (背叛) ──
                case 'betrayal': {
                    const involved = eff.involvedNpcIds ?? [];
                    if (involved.length >= 2) {
                        const betrayer = s.npcs.find(n => n.id === involved[0]);
                        const victim = s.npcs.find(n => n.id === involved[1]);
                        if (betrayer && victim) {
                            // Flip relationship to negative
                            const rel = findRelationship(s, betrayer.id, victim.id);
                            const newRelVal = rel ? -Math.abs(rel.value) - 20 : -50;
                            if (rel) {
                                if (!rel.family.relationships[betrayer.id]) rel.family.relationships[betrayer.id] = {};
                                if (!rel.family.relationships[victim.id]) rel.family.relationships[victim.id] = {};
                                rel.family.relationships[betrayer.id][victim.id] = clamp(newRelVal);
                                rel.family.relationships[victim.id][betrayer.id] = clamp(newRelVal);
                            }
                            victim.mood = clamp(victim.mood - 30);
                            s.chaosLevel = clamp(s.chaosLevel + 18, 0, 100);
                            // Add grudge for victim
                            if (!victim.grudges) victim.grudges = [];
                            if (!victim.grudges.includes(betrayer.id)) victim.grudges.push(betrayer.id);
                            events.push(`🔪 ${betrayer.name}背叛了${victim.name}的信任！${victim.name}心碎了，关系彻底崩盘！`);
                        }
                    }
                    break;
                }

                // ── romantic_confession (浪漫告白) ──
                case 'romantic_confession': {
                    const involved = eff.involvedNpcIds ?? [];
                    if (involved.length >= 2) {
                        const confessor = s.npcs.find(n => n.id === involved[0]);
                        const target = s.npcs.find(n => n.id === involved[1]);
                        if (confessor && target) {
                            const rel = findRelationship(s, confessor.id, target.id);
                            const relVal = rel?.value ?? 0;
                            s.chaosLevel = clamp(s.chaosLevel + 5, 0, 100);
                            if (relVal > 40) {
                                // Success!
                                confessor.mood = clamp(confessor.mood + 25);
                                target.mood = clamp(target.mood + 25);
                                adjustRelationship(s, confessor.id, target.id, 40);
                                // Add crushes
                                if (!confessor.crushes) confessor.crushes = [];
                                if (!confessor.crushes.includes(target.id)) confessor.crushes.push(target.id);
                                if (!target.crushes) target.crushes = [];
                                if (!target.crushes.includes(confessor.id)) target.crushes.push(confessor.id);
                                events.push(`💕 ${confessor.name}向${target.name}告白了——成功了！两人心意相通，甜蜜指数爆表！`);
                            } else {
                                // Rejection
                                confessor.mood = clamp(confessor.mood - 30);
                                adjustRelationship(s, confessor.id, target.id, -15);
                                events.push(`💔 ${confessor.name}鼓起勇气向${target.name}告白……但被拒绝了。气氛变得尴尬。`);
                            }
                        }
                    }
                    break;
                }

                // ── gossip_wildfire (八卦野火) ──
                case 'gossip_wildfire': {
                    const familyId = eff.familyId ?? (eff.npcId ? s.npcs.find(n => n.id === eff.npcId)?.familyId : null);
                    if (familyId) {
                        const members = s.npcs.filter(n => n.familyId === familyId);
                        for (const m of members) {
                            m.mood = clamp(m.mood - 8);
                        }
                        s.chaosLevel = clamp(s.chaosLevel + 8, 0, 100);
                        const family = s.families.find(f => f.id === familyId);
                        events.push(`🗣️ 八卦在${family?.name ?? '某公寓'}的群里疯传！所有人心情变差。`);
                        // 25% chance spawns fight_break
                        if (Math.random() < 0.25 && members.length > 1) {
                            const weakest = members.reduce((a, b) => a.mood < b.mood ? a : b);
                            spawnEffect(s, 'fight_break', 1,
                                `${weakest.name}因为八卦被气到了，矛盾一触即发……`,
                                { npcId: weakest.id, familyId, chainFrom: eff.id });
                        }
                    }
                    break;
                }

                // ── npc_runaway (NPC出走) ──
                case 'npc_runaway': {
                    const npc = eff.npcId ? s.npcs.find(n => n.id === eff.npcId) : null;
                    if (npc && npc.familyId) {
                        const oldFamilyName = s.families.find(f => f.id === npc.familyId)?.name ?? '原公寓';
                        const newFamId = makeNPCRunaway(s, npc);
                        let extraMsg = '';
                        // 30% chance: if they have a crush, the crush follows
                        if (npc.crushes && npc.crushes.length > 0 && Math.random() < 0.3) {
                            const crushId = npc.crushes[0];
                            const crush = s.npcs.find(n => n.id === crushId);
                            if (crush && crush.familyId && crush.familyId !== newFamId) {
                                const crushOldFamily = s.families.find(f => f.id === crush.familyId);
                                if (crushOldFamily) {
                                    crushOldFamily.memberIds = crushOldFamily.memberIds.filter(id => id !== crushId);
                                }
                                crush.familyId = newFamId;
                                const newFam = s.families.find(f => f.id === newFamId);
                                if (newFam) {
                                    newFam.memberIds.push(crushId);
                                    if (!newFam.relationships[npc.id]) newFam.relationships[npc.id] = {};
                                    if (!newFam.relationships[crushId]) newFam.relationships[crushId] = {};
                                    newFam.relationships[npc.id][crushId] = 60;
                                    newFam.relationships[crushId][npc.id] = 60;
                                }
                                extraMsg = `${crush.name}追随${npc.name}一起离开了！`;
                            }
                        }
                        events.push(`🏃 ${npc.name}搬离了${oldFamilyName}，开始独居！${extraMsg}`);
                    }
                    break;
                }

                // ── mood_breakdown (情绪崩溃) ──
                case 'mood_breakdown': {
                    const npc = eff.npcId ? s.npcs.find(n => n.id === eff.npcId) : null;
                    if (npc) {
                        npc.mood = clamp(-80);
                        // All relationships -10
                        for (const fam of s.families) {
                            if (fam.memberIds.includes(npc.id)) {
                                for (const otherId of fam.memberIds) {
                                    if (otherId !== npc.id) {
                                        if (!fam.relationships[npc.id]) fam.relationships[npc.id] = {};
                                        if (!fam.relationships[otherId]) fam.relationships[otherId] = {};
                                        fam.relationships[npc.id][otherId] = clamp((fam.relationships[npc.id][otherId] ?? 0) - 10);
                                        fam.relationships[otherId][npc.id] = clamp((fam.relationships[otherId][npc.id] ?? 0) - 10);
                                    }
                                }
                            }
                        }
                        events.push(`😭 ${npc.name}彻底崩溃了！情绪降至最低点，和所有人的关系都变差了。`);
                        // 40% chance spawns npc_runaway in 2 turns
                        if (Math.random() < 0.4) {
                            spawnEffect(s, 'npc_runaway', 2,
                                `${npc.name}崩溃后萌生了出走的念头……`,
                                { npcId: npc.id, chainFrom: eff.id });
                        }
                    }
                    break;
                }

                // ── secret_alliance (秘密同盟) ──
                case 'secret_alliance': {
                    const involved = eff.involvedNpcIds ?? [];
                    if (involved.length >= 2) {
                        const npcA = s.npcs.find(n => n.id === involved[0]);
                        const npcB = s.npcs.find(n => n.id === involved[1]);
                        if (npcA && npcB) {
                            // Cross-family relationship +50
                            adjustRelationship(s, npcA.id, npcB.id, 50);
                            events.push(`🤫 ${npcA.name}和${npcB.name}秘密结盟了！跨公寓的地下联盟悄然形成。`);
                            // 20% chance spawns power_shift in 3-4 turns
                            if (Math.random() < 0.2) {
                                const familyId = npcA.familyId ?? npcB.familyId;
                                spawnEffect(s, 'power_shift', 3 + Math.floor(Math.random() * 2),
                                    `秘密同盟开始暗中影响家庭的权力格局……`,
                                    { familyId: familyId ?? undefined, involvedNpcIds: involved, chainFrom: eff.id });
                            }
                        }
                    }
                    break;
                }

                // ── power_shift (权力更迭) ──
                case 'power_shift': {
                    const familyId = eff.familyId;
                    const members = familyId
                        ? s.npcs.filter(n => n.familyId === familyId)
                        : (eff.involvedNpcIds ?? []).map(id => s.npcs.find(n => n.id === id)).filter((n): n is SimNPC => !!n);
                    if (members.length >= 2) {
                        const weakest = members.reduce((a, b) => a.mood < b.mood ? a : b);
                        const strongest = members.reduce((a, b) => a.mood > b.mood ? a : b);
                        weakest.mood = clamp(weakest.mood + 30);
                        strongest.mood = clamp(strongest.mood - 20);
                        s.chaosLevel = clamp(s.chaosLevel + 8, 0, 100);
                        events.push(`👑 权力更迭！${weakest.name}翻身得势（心情+30），${strongest.name}失势（心情-20）！`);
                    }
                    break;
                }

                // ── reconciliation (和解) ──
                case 'reconciliation': {
                    const involved = eff.involvedNpcIds ?? [];
                    if (involved.length >= 2) {
                        const npcA = s.npcs.find(n => n.id === involved[0]);
                        const npcB = s.npcs.find(n => n.id === involved[1]);
                        if (npcA && npcB) {
                            adjustRelationship(s, npcA.id, npcB.id, 40);
                            npcA.mood = clamp(npcA.mood + 15);
                            npcB.mood = clamp(npcB.mood + 15);
                            s.chaosLevel = clamp(s.chaosLevel - 10, 0, 100);
                            // Remove grudges between them
                            if (npcA.grudges) npcA.grudges = npcA.grudges.filter(id => id !== npcB.id);
                            if (npcB.grudges) npcB.grudges = npcB.grudges.filter(id => id !== npcA.id);
                            events.push(`🕊️ ${npcA.name}和${npcB.name}终于和解了！两人冰释前嫌，气氛变得温暖。`);
                        }
                    }
                    break;
                }

                default:
                    events.push(`⚡ ${eff.description}`);
                    break;
            }
        } else {
            remaining.push(eff);
        }
    }

    s.pendingEffects = remaining;
    return { newState: s, events };
}

// ── 回合推进 & 游戏结束判定 ──────────────────────────────────

export function advanceTurn(state: LifeSimState): LifeSimState {
    const s = deepClone(state);
    s.turnNumber += 1;
    return s;
}

export function checkGameOver(state: LifeSimState): { over: boolean; reason?: string } {
    // Chaos no longer ends the game — only empty world does
    if (state.npcs.length <= 0) return { over: true, reason: '所有人都搬走了，这座城市空无一人……' };
    return { over: false };
}

// ── 描述函数 (UI辅助) ──────────────────────────────────────────

export function getFamilyAtmosphere(state: LifeSimState, familyId: string): string {
    const family = getFamily(state, familyId);
    if (!family || family.memberIds.length === 0) return '无人';
    const members = getFamilyMembers(state, familyId);
    if (members.length <= 1) return '独居';
    let totalRel = 0; let relCount = 0;
    for (const a of members) {
        for (const b of members) {
            if (a.id !== b.id) { totalRel += getRelationship(family, a.id, b.id); relCount++; }
        }
    }
    const avg = relCount > 0 ? totalRel / relCount : 0;
    if (avg > 50) return '室友情深 🤝';
    if (avg > 20) return '相安无事 😐';
    if (avg > -10) return '暗流涌动 😬';
    if (avg > -40) return '互看不顺 😤';
    return '快要翻脸 💢';
}

export function getChaosLabel(chaos: number): { label: string; color: string } {
    if (chaos < 20) return { label: '岁月静好', color: 'text-green-500' };
    if (chaos < 40) return { label: '有点drama', color: 'text-yellow-500' };
    if (chaos < 60) return { label: '全员修罗场', color: 'text-orange-500' };
    if (chaos < 80) return { label: '社死现场', color: 'text-red-500' };
    return { label: '都市废墟', color: 'text-purple-600' };
}

export function getRelLabel(val: number): { label: string; color: string } {
    if (val > 60) return { label: '亲密', color: 'text-pink-500' };
    if (val > 30) return { label: '友好', color: 'text-green-500' };
    if (val > 0)  return { label: '普通', color: 'text-gray-400' };
    if (val > -30) return { label: '不合', color: 'text-yellow-500' };
    if (val > -60) return { label: '敌视', color: 'text-orange-500' };
    return { label: '死敌', color: 'text-red-600' };
}

export function getMoodLabel(mood: number): { label: string; emoji: string } {
    if (mood > 60) return { label: '心情很好', emoji: '😄' };
    if (mood > 30) return { label: '还不错', emoji: '🙂' };
    if (mood > 0)  return { label: '一般', emoji: '😐' };
    if (mood > -30) return { label: '不太好', emoji: '😕' };
    if (mood > -60) return { label: '很差', emoji: '😤' };
    return { label: '崩溃边缘', emoji: '😡' };
}

/** 获取今日节日（如果有的话）*/
export function getTodayFestival(state: LifeSimState): SimFestival | undefined {
    return FESTIVALS.find(f => f.season === state.season && f.day === state.day);
}

// ── 深克隆 ────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

export { deepClone };
