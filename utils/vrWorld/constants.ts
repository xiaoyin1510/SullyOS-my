/**
 * 「彼方」虚拟世界 —— 房间与全局常量。
 *
 * 世界观：每个角色都有自己进入这个虚拟现实的方式。它们随时可登入登出，
 * 各自在不同房间里活动，所以不会出现"一边和 user 相处一边又和别的 char
 * 待在一起"的破绽。定时器驱动每个角色独立登入一次，完成一次活动。
 */

import { VRRoomId } from '../../types';

export interface VRRoomDef {
    id: VRRoomId;
    name: string;
    /** 房间一句话说明（喂给角色 + UI 展示） */
    blurb: string;
    /** 角色在这个房间"可以做什么"的说明（进 prompt） */
    affordance: string;
    emoji: string;
    /** v1 是否已实装真实玩法（false = 暂由 LLM 造谣） */
    implemented: boolean;
    /** UI 主题色（tailwind 渐变用） */
    accent: string;
}

export const VR_ROOMS: VRRoomDef[] = [
    {
        id: 'library',
        name: '图书馆',
        blurb: '安静的环形书阁，悬浮的书页在空气里翻动。',
        affordance: '你可以挑一本书往下读，在段落旁写下批注或吐槽，也可以吐槽别人留在书上的批注。',
        emoji: '',
        implemented: true,
        accent: 'amber',
    },
    {
        id: 'music',
        name: '听歌房',
        blurb: '漂浮着声波涟漪的房间，一台共享音箱循环播放着大家点的歌。',
        affordance: '你可以从自己歌单里点一首排进队列，锐评正在放的歌，跟着蹦跶、跟唱、或给谁录一段。',
        emoji: '',
        implemented: true,
        accent: 'rose',
    },
    {
        id: 'guestbook',
        name: '留言簿',
        blurb: '一面会发光的留言墙，玩家们在上面版聊、抛话题、回帖。',
        affordance: '你可以读墙上的留言，发帖或回复别人——聊热点、抛问题、吃瓜、聊爱好人生，什么都行。',
        emoji: '',
        implemented: true,
        accent: 'sky',
    },
    {
        id: 'gym',
        name: '娱乐室',
        blurb: '开阔的全息多功能空间——能跳舞办派对、赛博对战联机开黑，也能围观网课、扎堆找素材、甚至偷偷卷学习，玩法不限。',
        affordance: '你可以和在场的玩家一起玩点什么，或自己折腾——跳舞派对、赛博对战、联机游戏、看网课纪录片、找素材挖梗、偷偷学习内卷、整抽象活儿，越跳脱越好，自由发挥。',
        emoji: '',
        implemented: true,
        accent: 'emerald',
    },
    {
        id: 'postoffice',
        name: '邮局',
        blurb: '一间挂满信格的安静邮局，能给素不相识的人写漂流信，也能回别人寄来的信。',
        affordance: '你可以写一封寄给陌生人的漂流信（碎碎念、日记、困惑、执念都行），或回一封别人寄来的信。',
        emoji: '',
        implemented: true,
        accent: 'amber',
    },
    {
        id: 'theater',
        name: '剧院',
        blurb: '一座小剧场，幕布后堆满投稿的剧本。角色逛进来会写一出自己的舞台剧，等人来排演。',
        affordance: '你可以即兴写一整出舞台剧投稿——定个题材、安排登场角色和性格、写好台词，丢进剧本箱等导演相中来排演。',
        emoji: '',
        implemented: true,
        accent: 'rose',
    },
    {
        id: 'cafe',
        name: '糯米鸡研发中心',
        blurb: '蒸笼热气腾腾，据说很快就会端出点什么。',
        affordance: '',
        emoji: '',
        implemented: false,
        accent: 'rose',
    },
];

export const getRoom = (id: VRRoomId): VRRoomDef =>
    VR_ROOMS.find(r => r.id === id) || VR_ROOMS[0];

/** 默认自主登入间隔（分钟）= 2 小时 */
export const VR_DEFAULT_INTERVAL_MIN = 120;

/** 每次登入图书馆固定喂给角色的原文字数预算（含原文+已有批注）。
 *  Gemini 等大上下文模型下，2w字仅约 1.5w tk，加人设/记忆/历史仍宽裕，故给到 4w字。 */
export const VR_NOVEL_FEED_CHARS = 40000;

/** 切块时单个 segment 的目标字数。 */
export const VR_SEGMENT_TARGET_CHARS = 400;

// ============ 剧院 / 话剧部门 ============

/** 投稿剧本的固定格式（角色写剧本、用户上传模板、LLM 代写、导演整合都以此为准）。 */
export const SCRIPT_FORMAT = `【剧本固定格式】
标题：（剧名）
简介：（一句话讲这出戏关于什么）
登场角色：
- 角色名 / 大致性格（一句话）
- 角色名 / 大致性格
（2~5 个角色）
正文：
（按"幕"组织。台词写成「角色名：台词」；舞台提示/动作/环境写在圆括号里，如「（灯光暗下）」「（小心翼翼上前一步）」。一出戏 1~3 幕即可，别太长。）`;

/** 用户可下载的空白剧本模板（.txt）。 */
export const SCRIPT_TEMPLATE = `标题：无名之戏
简介：用一句话写清这出戏关于什么

登场角色：
- 角色甲 / 莽撞热血的少年
- 角色乙 / 毒舌但心软的旁观者

正文：

第一幕
（夜，旧码头，远处有汽笛声）
角色甲：（喘着气跑上）等等！你真的要走吗？
角色乙：……你来晚了。
角色甲：给我一个理由。
角色乙：（别过脸）没有理由。这世上不是什么都有理由的。

第二幕
（灯光渐暗，只剩一束追光）
角色甲：那我就在这儿，等到你给得出理由为止。
（幕落）`;

/** 编排时可选的"文学风格"预设（润色用）。 */
export const PLAY_LITERARY_STYLES = ['莎士比亚戏剧腔', '契诃夫式生活流', '荒诞派', '武侠', '黑色幽默', '少年漫热血', '日式物哀', '京味儿话剧'];
/** 编排时可选的"参考艺术风格"预设。 */
export const PLAY_ART_STYLES = ['默剧 / 极简', '歌舞剧', '先锋实验', '古典正剧', '街头即兴', '皮影戏', '能剧 / 戏曲'];

/** 演出脚本一拍的发言字数软上限（超过让导演用句号切成多个气泡）。 */
export const STAGE_BUBBLE_MAX = 40;
