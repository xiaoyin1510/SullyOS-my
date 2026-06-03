/**
 * agenticTools — 二轮 LLM 数据工具的纯函数封装
 *
 * Phase 2 Round 1 (2d) 抽出: 把 applyAssistantPostProcessing.ts 1810 行里的 9 个
 * "read 类" 工具的 data-fetch 部分集中起来, 作为单一 dispatch 入口。
 *
 * - 每个 run* 返回 `{ ok: true, ... } | { ok: false, reason, message? }`
 * - 不调 2nd-pass LLM (这是 applyAssistantPostProcessing / instantToolRunner 的事)
 * - 不修改 aiContent (调用方负责)
 * - 不 toast / setStatus (调用方负责)
 * - XHS 工具会修改 ctx.xhsCaches + ctx.lastXhsNotesRef (跨 tool 共享状态)
 *
 * Phase 2 Round 2 会在 `utils/instantToolRunner.ts` 里复用同一组函数, 接收 worker 发来的
 * tool-request, 把 `detailText` / `resultsText` 等 JSON.stringify 后 POST /continue。
 */

import { CharacterProfile, UserProfile, Message, RealtimeConfig } from '../types';
import { RealtimeContextManager, NotionManager, FeishuManager, XhsNote } from './realtimeContext';
import { XhsMcpClient, extractNotesFromMcpData, normalizeNote } from './xhsMcpClient';

// ─── 共用类型 ────────────────────────────────────────────────────────────────

/** XHS 跨 tool 共享状态 — useRef 持有, 在同一会话内累积 */
export interface XhsCaches {
    xsecTokenCache: Map<string, string>;
    noteTitleCache: Map<string, string>;
    commentUserIdCache: Map<string, string>;
    commentAuthorNameCache: Map<string, string>;
    commentParentIdCache: Map<string, string>;
}

/** 解析 char + realtimeConfig 拿到当前 XHS 配置 (per-character override) */
export interface XhsConfig {
    enabled: boolean;
    mcpUrl: string;
    loggedInUserId?: string;
    loggedInNickname?: string;
    userXsecToken?: string;
}

export function resolveXhsConfig(char: CharacterProfile, realtimeConfig?: RealtimeConfig): XhsConfig {
    const mcpConfig = realtimeConfig?.xhsMcpConfig;
    const mcpAvailable = !!(mcpConfig?.enabled && mcpConfig?.serverUrl);
    const mcpUrl = mcpConfig?.serverUrl || '';
    const loggedInUserId = mcpConfig?.loggedInUserId;
    const loggedInNickname = mcpConfig?.loggedInNickname;
    const userXsecToken = mcpConfig?.userXsecToken;

    if (char.xhsEnabled !== undefined) {
        return { enabled: !!char.xhsEnabled && mcpAvailable, mcpUrl, loggedInUserId, loggedInNickname, userXsecToken };
    }
    return { enabled: !!(realtimeConfig?.xhsEnabled) && mcpAvailable, mcpUrl, loggedInUserId, loggedInNickname, userXsecToken };
}

export interface AgenticToolCtx {
    char: CharacterProfile;
    userProfile: UserProfile;
    realtimeConfig?: RealtimeConfig;
    /** XHS 跨 tool 共享缓存; XHS_SEARCH/BROWSE 写, XHS_DETAIL/COMMENT/REPLY 读 */
    xhsCaches?: XhsCaches;
    /** 上次浏览/搜索得到的笔记列表 (XHS_DETAIL retry 时复用) */
    lastXhsNotesRef?: { current: XhsNote[] };
    /** 工具内部多步操作 (XHS_DETAIL retry / XHS_MY_PROFILE fallback / DIARY read-loop) 透传状态文案 给调用方 UI. 不传则 noop. */
    onProgress?: (channel: 'xhs' | 'diary', text: string) => void;
}

// ─── RECALL ─────────────────────────────────────────────────────────────────

export type RecallResult =
    | { ok: true; alreadyActive: boolean; yearMonth: string; logsText: string | null }
    | { ok: false; reason: 'no_logs'; yearMonth: string };

export async function runRecall(
    args: { year: string; month: string },
    ctx: AgenticToolCtx,
): Promise<RecallResult> {
    const { char } = ctx;
    const targetMonth = `${args.year}-${args.month.padStart(2, '0')}`;
    const alreadyActive = !!char.activeMemoryMonths?.includes(targetMonth);

    if (alreadyActive) {
        return { ok: true, alreadyActive: true, yearMonth: targetMonth, logsText: null };
    }

    if (!char.memories) {
        return { ok: false, reason: 'no_logs', yearMonth: targetMonth };
    }
    const logs = char.memories.filter(mem => {
        return mem.date.includes(targetMonth) || mem.date.includes(`${args.year}年${parseInt(args.month)}月`);
    });
    if (logs.length === 0) {
        return { ok: false, reason: 'no_logs', yearMonth: targetMonth };
    }
    const logsText = logs.map(mem => `[${mem.date}] (${mem.mood || 'normal'}): ${mem.summary}`).join('\n');
    return { ok: true, alreadyActive: false, yearMonth: targetMonth, logsText };
}

// ─── SEARCH ─────────────────────────────────────────────────────────────────

export type SearchResult =
    | { ok: true; query: string; resultsText: string; rawResultCount: number }
    | { ok: false; reason: 'no_api_key' | 'no_results'; query: string; message?: string };

/** Throws on network/transport error — caller wraps in try/catch for byte-equivalent error logging. */
export async function runSearch(
    args: { query: string },
    ctx: AgenticToolCtx,
): Promise<SearchResult> {
    const { realtimeConfig } = ctx;
    if (!realtimeConfig?.newsEnabled || !realtimeConfig?.newsApiKey) {
        return { ok: false, reason: 'no_api_key', query: args.query };
    }
    const searchResult = await RealtimeContextManager.performSearch(args.query, realtimeConfig.newsApiKey);
    if (!searchResult.success || searchResult.results.length === 0) {
        return { ok: false, reason: 'no_results', query: args.query, message: searchResult.message };
    }
    const resultsText = searchResult.results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.description}`
    ).join('\n\n');
    return { ok: true, query: args.query, resultsText, rawResultCount: searchResult.results.length };
}

// ─── READ_DIARY (Notion) ────────────────────────────────────────────────────

export type ReadDiaryResult =
    | { ok: true; date: string; diaryText: string; entryCount: number }
    | { ok: false; reason: 'not_configured' | 'parse_error' | 'not_found' | 'empty_content'; date?: string; dateInput?: string };

/** Throws on network/transport error. */
export async function runReadDiary(
    args: { date: string },
    ctx: AgenticToolCtx,
): Promise<ReadDiaryResult> {
    const { char, realtimeConfig } = ctx;

    if (!realtimeConfig?.notionEnabled || !realtimeConfig?.notionApiKey || !realtimeConfig?.notionDatabaseId) {
        return { ok: false, reason: 'not_configured', dateInput: args.date };
    }

    const targetDate = parseDiaryDate(args.date);
    if (!targetDate) {
        return { ok: false, reason: 'parse_error', dateInput: args.date };
    }

    const findResult = await NotionManager.getDiaryByDate(
        realtimeConfig.notionApiKey,
        realtimeConfig.notionDatabaseId,
        char.name,
        targetDate,
    );

    if (!findResult.success || findResult.entries.length === 0) {
        return { ok: false, reason: 'not_found', date: targetDate };
    }

    ctx.onProgress?.('diary', `找到 ${findResult.entries.length} 篇日记，正在阅读...`);

    const diaryContents: string[] = [];
    for (const entry of findResult.entries) {
        const readResult = await NotionManager.readDiaryContent(
            realtimeConfig.notionApiKey,
            entry.id,
        );
        if (readResult.success) {
            diaryContents.push(`📔「${entry.title}」(${entry.date})\n${readResult.content}`);
        }
    }

    if (diaryContents.length === 0) {
        return { ok: false, reason: 'empty_content', date: targetDate };
    }

    const diaryText = diaryContents.join('\n\n---\n\n');
    return { ok: true, date: targetDate, diaryText, entryCount: findResult.entries.length };
}

// ─── FS_READ_DIARY (Feishu) ─────────────────────────────────────────────────

export type FsReadDiaryResult =
    | { ok: true; date: string; diaryText: string; entryCount: number }
    | { ok: false; reason: 'not_configured' | 'parse_error' | 'not_found' | 'empty_content'; date?: string; dateInput?: string };

/** Throws on network/transport error. */
export async function runFsReadDiary(
    args: { date: string },
    ctx: AgenticToolCtx,
): Promise<FsReadDiaryResult> {
    const { char, realtimeConfig } = ctx;

    if (!realtimeConfig?.feishuEnabled || !realtimeConfig?.feishuAppId || !realtimeConfig?.feishuAppSecret || !realtimeConfig?.feishuBaseId || !realtimeConfig?.feishuTableId) {
        return { ok: false, reason: 'not_configured', dateInput: args.date };
    }

    const targetDate = parseDiaryDate(args.date);
    if (!targetDate) {
        return { ok: false, reason: 'parse_error', dateInput: args.date };
    }

    const findResult = await FeishuManager.getDiaryByDate(
        realtimeConfig.feishuAppId,
        realtimeConfig.feishuAppSecret,
        realtimeConfig.feishuBaseId,
        realtimeConfig.feishuTableId,
        char.name,
        targetDate,
    );

    if (!findResult.success || findResult.entries.length === 0) {
        return { ok: false, reason: 'not_found', date: targetDate };
    }

    ctx.onProgress?.('diary', `找到 ${findResult.entries.length} 篇飞书日记，正在阅读...`);

    const diaryContents: string[] = [];
    for (const entry of findResult.entries) {
        diaryContents.push(`📒「${entry.title}」(${entry.date})\n${entry.content}`);
    }

    if (diaryContents.length === 0) {
        return { ok: false, reason: 'empty_content', date: targetDate };
    }

    const diaryText = diaryContents.join('\n\n---\n\n');
    return { ok: true, date: targetDate, diaryText, entryCount: findResult.entries.length };
}

// ─── READ_NOTE (Notion notes DB) ────────────────────────────────────────────

export type ReadNoteResult =
    | { ok: true; keyword: string; noteText: string; entryCount: number }
    | { ok: false; reason: 'not_configured' | 'not_found' | 'empty_content'; keyword: string };

/** Throws on network/transport error. */
export async function runReadNote(
    args: { keyword: string },
    ctx: AgenticToolCtx,
): Promise<ReadNoteResult> {
    const { realtimeConfig } = ctx;

    if (!realtimeConfig?.notionEnabled || !realtimeConfig?.notionApiKey || !realtimeConfig?.notionNotesDatabaseId) {
        return { ok: false, reason: 'not_configured', keyword: args.keyword };
    }

    const findResult = await NotionManager.searchUserNotes(
        realtimeConfig.notionApiKey,
        realtimeConfig.notionNotesDatabaseId,
        args.keyword,
        3,
    );

    if (!findResult.success || findResult.entries.length === 0) {
        return { ok: false, reason: 'not_found', keyword: args.keyword };
    }

    ctx.onProgress?.('diary', `找到 ${findResult.entries.length} 篇笔记，正在阅读...`);

    const noteContents: string[] = [];
    for (const entry of findResult.entries) {
        const readResult = await NotionManager.readNoteContent(
            realtimeConfig.notionApiKey,
            entry.id,
        );
        if (readResult.success) {
            noteContents.push(`📝「${entry.title}」(${entry.date})\n${readResult.content}`);
        }
    }

    if (noteContents.length === 0) {
        return { ok: false, reason: 'empty_content', keyword: args.keyword };
    }

    const noteText = noteContents.join('\n\n---\n\n');
    return { ok: true, keyword: args.keyword, noteText, entryCount: findResult.entries.length };
}

// ─── XHS helpers (private, used by run* below) ──────────────────────────────

async function xhsSearchImpl(conf: { mcpUrl: string }, keyword: string): Promise<{ success: boolean; notes: XhsNote[]; message?: string }> {
    const r = await XhsMcpClient.search(conf.mcpUrl, keyword);
    if (!r.success) return { success: false, notes: [], message: r.error };
    const raw = extractNotesFromMcpData(r.data);
    return { success: true, notes: raw.map(n => normalizeNote(n) as XhsNote) };
}

async function xhsBrowseImpl(conf: { mcpUrl: string }): Promise<{ success: boolean; notes: XhsNote[]; message?: string }> {
    const r = await XhsMcpClient.getRecommend(conf.mcpUrl);
    if (!r.success) return { success: false, notes: [], message: r.error };
    const unwrapped = r.data?.data && typeof r.data.data === 'object' && !Array.isArray(r.data.data) ? r.data.data : r.data;
    console.log(`📕 [XHS] getRecommend 响应类型: ${typeof r.data}, 是否有 data 嵌套: ${unwrapped !== r.data}, unwrapped keys: ${unwrapped && typeof unwrapped === 'object' ? Object.keys(unwrapped).join(',') : 'N/A'}`);
    const raw = extractNotesFromMcpData(unwrapped);
    if (raw.length === 0 && unwrapped !== r.data) {
        console.log(`📕 [XHS] getRecommend unwrapped 提取为空，用原始数据重试`);
        const raw2 = extractNotesFromMcpData(r.data);
        return { success: true, notes: raw2.map(n => normalizeNote(n) as XhsNote) };
    }
    return { success: true, notes: raw.map(n => normalizeNote(n) as XhsNote) };
}

/** 将笔记列表的 xsecToken 和 title 存入 xhsCaches */
function cacheXsecTokensImpl(caches: XhsCaches | undefined, notes: XhsNote[]): void {
    if (!caches) return;
    for (const n of notes) {
        if (n.noteId && n.xsecToken) caches.xsecTokenCache.set(n.noteId, n.xsecToken);
        if (n.noteId && n.title) caches.noteTitleCache.set(n.noteId, n.title);
    }
}

/** 从 xhsCaches 或 lastXhsNotes 中查找 xsecToken */
function findXsecToken(caches: XhsCaches | undefined, lastXhsNotes: XhsNote[], noteId: string): string | undefined {
    const fromNotes = lastXhsNotes.find(n => n.noteId === noteId)?.xsecToken;
    if (fromNotes) return fromNotes;
    return caches?.xsecTokenCache.get(noteId);
}

// ─── XHS_SEARCH ─────────────────────────────────────────────────────────────

export type XhsSearchResult =
    | { ok: true; keyword: string; notesText: string; notes: XhsNote[] }
    | { ok: false; reason: 'not_enabled' | 'no_results'; keyword: string; message?: string };

/** Throws on network/transport error. */
export async function runXhsSearch(
    args: { keyword: string },
    ctx: AgenticToolCtx,
): Promise<XhsSearchResult> {
    const xhsConf = resolveXhsConfig(ctx.char, ctx.realtimeConfig);
    if (!xhsConf.enabled) {
        return { ok: false, reason: 'not_enabled', keyword: args.keyword };
    }
    const result = await xhsSearchImpl(xhsConf, args.keyword);
    if (!result.success || result.notes.length === 0) {
        return { ok: false, reason: 'no_results', keyword: args.keyword, message: result.message };
    }
    if (ctx.lastXhsNotesRef) ctx.lastXhsNotesRef.current = result.notes;
    cacheXsecTokensImpl(ctx.xhsCaches, result.notes);
    const notesText = result.notes.map((n, i) =>
        `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc}`
    ).join('\n\n');
    return { ok: true, keyword: args.keyword, notesText, notes: result.notes };
}

// ─── XHS_BROWSE ─────────────────────────────────────────────────────────────

export type XhsBrowseResult =
    | { ok: true; category?: string; notesText: string; notes: XhsNote[] }
    | { ok: false; reason: 'not_enabled' | 'no_results'; category?: string; message?: string };

/** Throws on network/transport error. */
export async function runXhsBrowse(
    args: { category?: string },
    ctx: AgenticToolCtx,
): Promise<XhsBrowseResult> {
    const xhsConf = resolveXhsConfig(ctx.char, ctx.realtimeConfig);
    if (!xhsConf.enabled) {
        return { ok: false, reason: 'not_enabled', category: args.category };
    }
    const result = await xhsBrowseImpl(xhsConf);
    console.log('📕 [XHS] 浏览结果:', result.success, result.message, result.notes?.length || 0);
    if (!result.success || result.notes.length === 0) {
        return { ok: false, reason: 'no_results', category: args.category, message: result.message };
    }
    if (ctx.lastXhsNotesRef) ctx.lastXhsNotesRef.current = result.notes;
    cacheXsecTokensImpl(ctx.xhsCaches, result.notes);
    const notesText = result.notes.map((n, i) =>
        `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc}`
    ).join('\n\n');
    return { ok: true, category: args.category, notesText, notes: result.notes };
}

// ─── XHS_MY_PROFILE ─────────────────────────────────────────────────────────

export type XhsMyProfileResult =
    | { ok: true; nickname: string; userId: string; profileStr: string; feedsStr: string; gotProfile: boolean; notes: XhsNote[] }
    | { ok: false; reason: 'not_enabled' | 'no_identity' };

/** Throws on network/transport error in the search-fallback path. The getUserProfile inner try/catch
 *  handles the "profile failed → fallback to search" case gracefully (matches original behavior). */
export async function runXhsMyProfile(
    _args: Record<string, never>,
    ctx: AgenticToolCtx,
): Promise<XhsMyProfileResult> {
    const xhsConf = resolveXhsConfig(ctx.char, ctx.realtimeConfig);
    if (!xhsConf.enabled) return { ok: false, reason: 'not_enabled' };

    const nickname = xhsConf.loggedInNickname || '';
    const userId = xhsConf.loggedInUserId || '';

    if (!nickname && !userId) {
        return { ok: false, reason: 'no_identity' };
    }

    let profileStr = '';
    let feedsStr = '（获取笔记失败）';
    let gotProfile = false;
    let collectedNotes: XhsNote[] = [];

    if (userId) {
            console.log(`📕 [XHS] 用 getUserProfile(${userId}) 获取主页...`);
            ctx.onProgress?.('xhs', '正在获取主页信息...');
            try {
                const profileResult = await XhsMcpClient.getUserProfile(xhsConf.mcpUrl, userId, xhsConf.userXsecToken);
                if (profileResult.success && profileResult.data) {
                    const d = profileResult.data;
                    if (typeof d === 'string') {
                        profileStr = d.slice(0, 3000);
                        gotProfile = true;
                    } else {
                        const basicInfo = d.data?.basic_info || d.basic_info;
                        if (basicInfo) {
                            profileStr = JSON.stringify(basicInfo, null, 2).slice(0, 2000);
                        } else {
                            const { notes: _n, ...rest } = (d.data && typeof d.data === 'object' ? d.data : d) as any;
                            profileStr = Object.keys(rest).length > 0
                                ? JSON.stringify(rest, null, 2).slice(0, 2000)
                                : '（主页基本信息暂时无法获取）';
                        }
                        gotProfile = true;
                        const unwrapped = d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : d;
                        console.log(`📕 [XHS] profile unwrapped keys:`, Object.keys(unwrapped), 'notes isArray:', Array.isArray(unwrapped.notes), 'notes length:', unwrapped.notes?.length);
                        const notes = extractNotesFromMcpData(unwrapped);
                        console.log(`📕 [XHS] extractNotesFromMcpData 返回 ${notes.length} 条笔记`);
                        if (notes.length > 0) {
                            console.log(`📕 [XHS] 第一条笔记原始 keys:`, Object.keys(notes[0]), 'noteCard?', !!notes[0].noteCard, 'id?', notes[0].id || notes[0].noteId);
                            const normalized = notes.map(n => normalizeNote(n) as XhsNote);
                            console.log(`📕 [XHS] 归一化后第一条:`, JSON.stringify(normalized[0]).slice(0, 300));
                            const validNotes = normalized.filter(n => n.noteId);
                            if (validNotes.length === 0) {
                                console.warn(`📕 [XHS] ⚠️ 所有笔记归一化后 noteId 为空！原始数据:`, JSON.stringify(notes[0]).slice(0, 500));
                            }
                            collectedNotes = validNotes.length > 0 ? validNotes : normalized;
                            cacheXsecTokensImpl(ctx.xhsCaches, collectedNotes);
                            feedsStr = collectedNotes.slice(0, 8).map((n, i) =>
                                `${i + 1}. [noteId=${n.noteId}]「${n.title || '无标题'}」by ${n.author || '未知'} (${n.likes || 0}赞)\n   ${n.desc || '（无描述）'}`
                            ).join('\n\n');
                            console.log(`📕 [XHS] feedsStr 预览:`, feedsStr.slice(0, 300));
                        } else {
                            console.warn(`📕 [XHS] ⚠️ extractNotesFromMcpData 返回空数组! unwrapped:`, JSON.stringify(unwrapped).slice(0, 500));
                        }
                    }
                    console.log(`📕 [XHS] getUserProfile 成功，数据长度: ${profileStr.length}`);
                }
            } catch (e) {
                console.warn('📕 [XHS] getUserProfile 失败，降级到搜索:', e);
            }
        }

        if (!gotProfile && nickname) {
            console.log(`📕 [XHS] 降级: 用昵称「${nickname}」搜索...`);
            ctx.onProgress?.('xhs', '正在搜索你的笔记...');
            const searchResult = await xhsSearchImpl(xhsConf, nickname);
            if (searchResult.success && searchResult.notes.length > 0) {
                collectedNotes = searchResult.notes;
                cacheXsecTokensImpl(ctx.xhsCaches, searchResult.notes);
                feedsStr = searchResult.notes.slice(0, 8).map((n, i) =>
                    `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc || '（无描述）'}`
                ).join('\n\n');
            } else {
                feedsStr = '（没有搜到相关笔记）';
            }
        }

    if (ctx.lastXhsNotesRef && collectedNotes.length > 0) {
        ctx.lastXhsNotesRef.current = collectedNotes;
    }

    return { ok: true, nickname, userId, profileStr, feedsStr, gotProfile, notes: collectedNotes };
}

// ─── XHS_DETAIL ─────────────────────────────────────────────────────────────

export type XhsDetailResult =
    | { ok: true; noteId: string; detailText: string; failed: boolean }
    | { ok: false; reason: 'not_enabled'; noteId: string };

/** Throws on network/transport error. */
export async function runXhsDetail(
    args: { noteId: string },
    ctx: AgenticToolCtx,
): Promise<XhsDetailResult> {
    const xhsConf = resolveXhsConfig(ctx.char, ctx.realtimeConfig);
    if (!xhsConf.enabled) return { ok: false, reason: 'not_enabled', noteId: args.noteId };

    const lastNotes = ctx.lastXhsNotesRef?.current ?? [];
    let xsecToken = findXsecToken(ctx.xhsCaches, lastNotes, args.noteId);
    console.log(`📕 [XHS] AI要查看笔记详情:`, args.noteId, xsecToken ? '(有xsecToken)' : '(无xsecToken)');

    let result = await XhsMcpClient.getNoteDetail(xhsConf.mcpUrl, args.noteId, xsecToken, { loadAllComments: true });

        if (!result.success || !result.data) {
            const cachedTitle = ctx.xhsCaches?.noteTitleCache.get(args.noteId);
            if (cachedTitle) {
                console.log(`📕 [XHS] 详情失败，尝试重新搜索「${cachedTitle}」以刷新 xsecToken...`);
                ctx.onProgress?.('xhs', '正在刷新访问凭证...');
                const refreshResult = await xhsSearchImpl(xhsConf, cachedTitle);
                if (refreshResult.success && refreshResult.notes.length > 0) {
                    cacheXsecTokensImpl(ctx.xhsCaches, refreshResult.notes);
                    if (ctx.lastXhsNotesRef) ctx.lastXhsNotesRef.current = refreshResult.notes;
                    const refreshedNote = refreshResult.notes.find(n => n.noteId === args.noteId);
                    if (refreshedNote?.xsecToken) {
                        xsecToken = refreshedNote.xsecToken;
                        console.log(`📕 [XHS] 拿到新 xsecToken，重试 detail...`);
                        ctx.onProgress?.('xhs', '正在查看笔记详情...');
                        result = await XhsMcpClient.getNoteDetail(xhsConf.mcpUrl, args.noteId, xsecToken, { loadAllComments: true });
                    } else {
                        console.warn(`📕 [XHS] 重新搜索结果中未找到 noteId=${args.noteId}`);
                    }
                } else {
                    console.warn(`📕 [XHS] 重新搜索「${cachedTitle}」失败:`, refreshResult.message);
                }
            } else {
                console.warn(`📕 [XHS] 详情失败且无缓存标题，无法重试`);
            }
        }

        // detail 自带的 xsecToken / 评论结构 写回缓存
        if (result.success && result.data && typeof result.data === 'object') {
            const d = result.data;
            const noteObj = (d as any).note || d;
            const detailToken = noteObj?.xsecToken || noteObj?.xsec_token || (d as any)?.xsecToken;
            if (detailToken && args.noteId && ctx.xhsCaches) {
                ctx.xhsCaches.xsecTokenCache.set(args.noteId, detailToken);
                console.log(`📕 [XHS] 从 detail 缓存 xsecToken: ${args.noteId}`);
            }

            if (ctx.xhsCaches) {
                const caches = ctx.xhsCaches;
                const cacheComments = (comments: any[], parentId?: string) => {
                    for (const c of comments) {
                        const cid = c.id || c.commentId || c.comment_id;
                        const uid = c.userInfo?.userId || c.userInfo?.user_id || c.user_id || c.userId;
                        const authorName = c.userInfo?.nickname || c.userInfo?.name || c.nickname || c.userName || c.user_name;
                        if (cid && uid) caches.commentUserIdCache.set(cid, uid);
                        if (cid && authorName) caches.commentAuthorNameCache.set(cid, authorName);
                        if (cid && parentId) caches.commentParentIdCache.set(cid, parentId);
                        if (Array.isArray(c.subComments)) cacheComments(c.subComments, cid);
                        if (Array.isArray(c.sub_comments)) cacheComments(c.sub_comments, cid);
                    }
                };
                const commentList = (d as any).data?.comments?.list || (d as any).comments?.list
                    || (d as any).data?.comments || (d as any).comments
                    || (d as any).note?.comments?.list || (d as any).note?.comments;
                if (Array.isArray(commentList)) {
                    cacheComments(commentList);
                    console.log(`📕 [XHS] 缓存了 ${caches.commentUserIdCache.size} 条评论的 userId, ${caches.commentAuthorNameCache.size} 条 authorName`);
                } else {
                    console.warn(`📕 [XHS] 未找到评论数组, d keys:`, Object.keys(d as any), 'd.note keys:', (d as any).note ? Object.keys((d as any).note) : 'N/A');
                }
            }
        }

        const detailData = result.success ? result.data : null;
        let detailText: string;
        if (detailData) {
            if (typeof detailData === 'string') {
                if (detailData.includes('失败') || detailData.includes('not found')) {
                    detailText = `[加载失败: ${detailData.slice(0, 200)}]`;
                } else {
                    detailText = detailData.slice(0, 5000);
                }
            } else {
                const innerData = (detailData as any).data && typeof (detailData as any).data === 'object' ? (detailData as any).data : null;
                const note = innerData?.note || (detailData as any).note || detailData;
                const noteTitle = note.title || note.displayTitle || note.display_title || '';
                const noteDesc = (note.desc || note.description || note.content || '').slice(0, 1500);
                const noteAuthor = note.user?.nickname || note.author || '';
                const noteLikes = note.interactInfo?.likedCount || note.likes || 0;
                const noteCollects = note.interactInfo?.collectedCount || note.collects || 0;
                const noteShareCount = note.interactInfo?.shareCount || 0;
                const noteCommentCount = note.interactInfo?.commentCount || 0;
                const noteTime = note.time ? new Date(note.time).toLocaleString('zh-CN') : '';
                const noteIp = note.ipLocation || '';

                let noteSection = `📝 笔记详情:\n标题: ${noteTitle}\n作者: ${noteAuthor}`;
                if (noteTime) noteSection += `\n发布时间: ${noteTime}`;
                if (noteIp) noteSection += `\n IP: ${noteIp}`;
                noteSection += `\n互动: ${noteLikes}赞 ${noteCollects}收藏 ${noteCommentCount}评论 ${noteShareCount}分享`;
                noteSection += `\n\n正文:\n${noteDesc}`;

                const rawComments = innerData?.comments?.list || innerData?.comments
                    || (detailData as any).comments?.list || (detailData as any).comments
                    || note.comments?.list || note.comments || [];
                const commentArr = Array.isArray(rawComments) ? rawComments : [];

                let commentsSection = '';
                if (commentArr.length > 0) {
                    const formatComment = (c: any, indent = '') => {
                        const name = c.userInfo?.nickname || c.nickname || c.userName || '匿名';
                        const content = c.content || '';
                        const likes = c.likeCount || c.like_count || c.likes || 0;
                        const cid = c.id || c.commentId || c.comment_id || '';
                        let line = `${indent}${name}: ${content} (${likes}赞) [commentId=${cid}]`;
                        const subs = c.subComments || c.sub_comments || [];
                        if (Array.isArray(subs) && subs.length > 0) {
                            line += '\n' + subs.slice(0, 10).map((s: any) => formatComment(s, indent + '  ↳ ')).join('\n');
                        }
                        return line;
                    };
                    commentsSection = `\n\n💬 评论区 (${commentArr.length}条):\n` +
                        commentArr.slice(0, 30).map((c: any) => formatComment(c)).join('\n');
                } else {
                    commentsSection = '\n\n💬 评论区: （暂无评论）';
                }

                detailText = (noteSection + commentsSection).slice(0, 8000);
            }
        } else {
            detailText = `[加载失败: ${result.error || '无法获取笔记详情，可能需要先在搜索/浏览结果中看到这条笔记'}]`;
        }

    const failed = detailText.startsWith('[加载失败');
    return { ok: true, noteId: args.noteId, detailText, failed };
}

// ─── 共用日期解析 (READ_DIARY / FS_READ_DIARY 共用) ─────────────────────────

export function parseDiaryDate(dateInput: string): string {
    const now = new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
    if (dateInput === '今天') return now.toISOString().split('T')[0];
    if (dateInput === '昨天') { const d = new Date(now); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }
    if (dateInput === '前天') { const d = new Date(now); d.setDate(d.getDate() - 2); return d.toISOString().split('T')[0]; }
    const daysAgo = dateInput.match(/^(\d+)天前$/);
    if (daysAgo) { const d = new Date(now); d.setDate(d.getDate() - parseInt(daysAgo[1])); return d.toISOString().split('T')[0]; }
    const monthDay = dateInput.match(/(\d{1,2})月(\d{1,2})/);
    if (monthDay) return `${now.getFullYear()}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
    const parsed = new Date(dateInput);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return '';
}

// ─── Dispatch (Round 2 instantToolRunner 用) ───────────────────────────────

/**
 * Round 2 instantToolRunner 通过 tool name 调度. Round 1 客户端不使用此入口,
 * 直接 import 具体 run* 函数; 留在这里是为了 Round 2 即插即用。
 */
export async function dispatchAgenticTool(
    toolName: string,
    args: any,
    ctx: AgenticToolCtx,
): Promise<unknown> {
    switch (toolName) {
        case 'recall': return runRecall(args, ctx);
        case 'web_search': return runSearch(args, ctx);
        case 'notion_read_diary': return runReadDiary(args, ctx);
        case 'feishu_read_diary': return runFsReadDiary(args, ctx);
        case 'read_note': return runReadNote(args, ctx);
        case 'xhs_search': return runXhsSearch(args, ctx);
        case 'xhs_browse': return runXhsBrowse(args, ctx);
        case 'xhs_my_profile': return runXhsMyProfile(args, ctx);
        case 'xhs_detail': return runXhsDetail(args, ctx);
        default:
            throw new Error(`Unknown agentic tool: ${toolName}`);
    }
}
