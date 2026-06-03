import { SimAction, UserProfile } from '../types';

export function buildLifeSimSessionSummaryPrompt(
    user: UserProfile,
    participantNames: string[],
    actionLog: SimAction[]
): string {
    const mainPlots = actionLog.filter(action => action.storyKind === 'main_plot');
    const recentBeats = mainPlots.slice(-8).map((action, index) => {
        const title = action.headline || `节点 ${index + 1}`;
        const result = action.immediateResult || action.description;
        return `- ${title}: ${result}`;
    }).join('\n');

    return `
你是《都市人生》结束结算器。
任务：把这一整局的世界线浓缩成 300 字以内的中文总结。

规则：
- 输出 JSON：{ "summary": "..." }
- 直接写可读总结，不要解释格式。
- 重点是“这群人一起玩出了什么主线”，不是技术细节。
- 语气像漂亮的小卡片文案，要简洁、有画面感、能让角色读懂。
- 需要点到玩家名字 ${user.name}，以及参与角色：${participantNames.join('、') || '无人参与'}。
- 如果有多个主线节点，合成一段顺畅的总叙述。

主线节点：
${recentBeats || '- 这一局几乎没抽到完整主线，更多是零散吃瓜。'}
    `.trim();
}

export function buildFallbackLifeSimSessionSummary(
    userName: string,
    participantNames: string[],
    actionLog: SimAction[]
): string {
    const mainPlots = actionLog.filter(action => action.storyKind === 'main_plot');
    const beats = mainPlots.slice(-3).map(action => action.headline || action.description).filter(Boolean);
    const cast = participantNames.length > 0 ? `${participantNames.join('、')} 和 ${userName}` : userName;

    if (beats.length === 0) {
        return `${cast} 一起围观了这座城的日常鸡飞狗跳，虽然没有拉出完整主线，但几段暧昧、站队和小型风波已经把气氛炒热。`;
    }

    return `${cast} 一起把这局《都市人生》推成了 ${beats.join('、')} 这条世界线，整座城从吃瓜围观一路滚到站队升级，最后所有人都被卷进同一场 drama 里。`.slice(0, 300);
}
