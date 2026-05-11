import { SimAction } from '../types';

export interface LifeSimResetCardData {
    type: 'lifesim_reset_card';
    title: string;
    summary: string;
    headline?: string;
    userName: string;
    participantNames: string[];
    charName: string;
    charAvatar?: string;
    mainPlotCount: number;
    turnCount: number;
}

export function createLifeSimResetCardData(input: {
    summary: string;
    headline?: string;
    userName: string;
    participantNames: string[];
    charName: string;
    charAvatar?: string;
    mainPlotCount: number;
    turnCount: number;
}): LifeSimResetCardData {
    return {
        type: 'lifesim_reset_card',
        title: '都市人生 - 城市小结',
        summary: input.summary,
        headline: input.headline,
        userName: input.userName,
        participantNames: input.participantNames,
        charName: input.charName,
        charAvatar: input.charAvatar,
        mainPlotCount: input.mainPlotCount,
        turnCount: input.turnCount,
    };
}

export function formatLifeSimResetCardForContext(card: LifeSimResetCardData, currentCharName?: string): string {
    const others = card.participantNames.filter(name => name && name !== currentCharName);
    const joined = others.length > 0 ? `${others.join('、')} 和 ${card.userName}` : card.userName;
    const headline = card.headline ? `这一局最像主线标题的是《${card.headline}》。` : '';
    return `[都市人生结算卡] 你和 ${joined} 一起玩了《都市人生》。${headline}整局共推进了 ${card.turnCount} 回合，主线节点 ${card.mainPlotCount} 个。最终小结：${card.summary}`;
}

export function tryParseLifeSimResetCard(raw: any): LifeSimResetCardData | null {
    if (!raw || typeof raw !== 'object' || raw.type !== 'lifesim_reset_card') return null;
    return {
        type: 'lifesim_reset_card',
        title: String(raw.title || '都市人生 - 城市小结'),
        summary: String(raw.summary || ''),
        headline: raw.headline ? String(raw.headline) : undefined,
        userName: String(raw.userName || '用户'),
        participantNames: Array.isArray(raw.participantNames) ? raw.participantNames.map(String) : [],
        charName: String(raw.charName || ''),
        charAvatar: raw.charAvatar ? String(raw.charAvatar) : undefined,
        mainPlotCount: Number(raw.mainPlotCount || 0),
        turnCount: Number(raw.turnCount || 0),
    };
}

export function summarizeMainPlots(actions: SimAction[]): { headline?: string; beats: string[] } {
    const mainPlots = actions.filter(action => action.storyKind === 'main_plot');
    return {
        headline: mainPlots[0]?.headline,
        beats: mainPlots.slice(0, 6).map(action => action.headline || action.description),
    };
}
