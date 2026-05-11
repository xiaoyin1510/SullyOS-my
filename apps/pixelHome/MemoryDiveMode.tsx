/**
 * Memory Dive (记忆潜行) — 像素 RPG 探索（剧本版）
 *
 * 3DS 风格上下双屏：
 *   上屏：像素房间 + 角色 + 用户跟随小人（家具纯装饰，不交互）
 *   下屏：固定高度的复古对话框 + 打字机 + 选项
 *
 * 流程：一次 LLM 生成整房间的剧本（beats + per-choice reactions），
 *   角色站在房间里说 N 段戏，每段 3 个选项对应 3 种独立反应；
 *   所有 beats 走完进入下一个房间；所有房间走完结算。
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { MemoryRoom, RemoteVectorConfig } from '../../utils/memoryPalace/types';
import type { APIConfig, CharacterProfile, UserProfile } from '../../types';
import type { PixelHomeState, PixelAsset } from './types';
import type {
  DiveSession, DiveDialogue, DiveChoice, DiveBuffValues,
  DiveResult, RoomExploreState, RoomScript, DiveScriptChoice,
} from './memoryDiveTypes';
import { BUFF_META } from './memoryDiveTypes';
import { ROOM_META } from './roomTemplates';
import { ContextBuilder } from '../../utils/context';
import {
  planRoomVisit,
  generateIntroDialogues, generateOutroDialogues,
  createInitialBuffs, applyChoiceBuff, computeDiveResult,
  emitDiveEmotion,
} from './memoryDiveEngine';
import MemoryDiveRoom from './MemoryDiveRoom';
import MemoryDiveDialogue from './MemoryDiveDialogue';
import MemoryDiveChoices from './MemoryDiveChoices';
import MemoryDiveAmbient from './MemoryDiveAmbient';
import {
  pickNextRoom, roomCharPos, userPos, jitterPos,
} from './memoryDiveNav';

interface Props {
  charId: string;
  charName: string;
  charProfile: CharacterProfile;
  userProfile: UserProfile;
  charSprite?: string;
  playerSprite?: string;
  userName: string;
  homeState: PixelHomeState;
  assets: PixelAsset[];
  apiConfig: APIConfig;
  remoteVectorConfig?: RemoteVectorConfig;
  onExit: (result: DiveResult | null) => void;
}

const BEAT_MOVE_DURATION_MS = 700;
const WALK_STEP_MS = 180;
const TRANSITION_HALF_MS = 400;
const BEATS_PER_ROOM = 3;

type PlaybackStep =
  | 'intro'
  | 'beat-talk'
  | 'beat-reaction'
  | 'room-close'
  | 'room-transition'
  | 'done';

const MemoryDiveMode: React.FC<Props> = ({
  charId, charName, charProfile, userProfile, charSprite, playerSprite,
  userName, homeState, assets, apiConfig, remoteVectorConfig, onExit,
}) => {
  const fullCharContext = useMemo(() =>
    ContextBuilder.buildCoreContext(charProfile, userProfile, true),
    [charProfile, userProfile],
  );

  // ─── Session ─────────────────────────────────────────
  const [session, setSession] = useState<DiveSession | null>(null);
  const [showResult, setShowResult] = useState<DiveResult | null>(null);

  // ─── 对话显示 ─────────────────────────────────────────
  const [dialogueQueue, setDialogueQueue] = useState<DiveDialogue[]>([]);
  const [currentDialogue, setCurrentDialogue] = useState<DiveDialogue | null>(null);
  const [pendingChoices, setPendingChoices] = useState<DiveChoice[] | null>(null);

  // ─── 角色视觉 ─────────────────────────────────────────
  const [charWalking, setCharWalking] = useState(false);
  const [charFlip, setCharFlip] = useState(false);
  const [walkStep, setWalkStep] = useState<0 | 1>(0);
  const [transitionState, setTransitionState] = useState<'idle' | 'out' | 'in'>('idle');
  const [isLoadingScript, setIsLoadingScript] = useState(false);
  // API 失败时展示的错误——非空就在下屏面板渲染"重新召回"按钮
  const [loadError, setLoadError] = useState<string | null>(null);

  // ─── Refs（callback 从这里读最新值） ───────────────────
  const sessionRef = useRef<DiveSession | null>(null);
  const scriptRef = useRef<RoomScript | null>(null);
  const beatIdxRef = useRef(0);
  const playbackStepRef = useRef<PlaybackStep>('intro');
  const initializedRef = useRef(false);
  const stepTimerRef = useRef<number | null>(null);
  const moveTimerRef = useRef<number | null>(null);
  // 上一房间的情绪余温（传给下一房间的 LLM 做衔接）
  const prevMoodHintRef = useRef<string | undefined>(undefined);
  const prevRoomRef = useRef<MemoryRoom | undefined>(undefined);
  // 上一场景的"最后一句"——新房间第一句必须承接它
  const prevEndingLineRef = useRef<string | undefined>(undefined);
  const prevEndingSpeakerRef = useRef<'character' | 'narrator' | undefined>(undefined);
  // 后台预载下一个房间：播到一半时偷偷 generate，切换时能秒进
  const preloadedRef = useRef<{
    roomId: MemoryRoom;
    script: RoomScript;
    memoryTexts: string[];
  } | null>(null);
  const preloadingRef = useRef(false);

  // 加载文案：随转场上下文变化
  const [loadingText, setLoadingText] = useState<string>('薄雾正在聚拢');
  // 本次房间召回的记忆碎片（给下屏氛围面板展示用，不调 LLM）
  const [roomMemoryTexts, setRoomMemoryTexts] = useState<string[]>([]);

  // ─── 初始化 ───────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initialRoom: MemoryRoom = 'living_room';
    const roomStates = new Map<MemoryRoom, RoomExploreState>();
    for (const room of Object.keys(ROOM_META) as MemoryRoom[]) {
      roomStates.set(room, {
        roomId: room,
        visitedSlots: new Set(),
        hasLockedContent: room === 'attic',
        unlocked: false,
      });
    }
    const charPos = roomCharPos(initialRoom);
    const uPos = userPos(charPos.x, charPos.y);

    setSession({
      charId, charName, mode: 'guided',
      phase: 'intro',
      currentRoom: initialRoom,
      playerPos: uPos,
      charPos,
      dialogues: [],
      roomStates,
      buffValues: createInitialBuffs(),
      visitedRooms: [initialRoom],
      isLoading: false,
      startedAt: Date.now(),
    });

    // 开场只保留叙事 / 角色台词，不要开场选项（改成自动衔接剧本加载）
    const intro = generateIntroDialogues(charName, 'guided')
      .filter(d => d.speaker !== 'user_choice' || !d.choices);
    playbackStepRef.current = 'intro';
    enqueueDialogues(intro);
  }, [charId, charName]);

  // session ref 同步
  useEffect(() => { sessionRef.current = session; }, [session]);

  // ─── 清理 ─────────────────────────────────────────────
  useEffect(() => () => {
    if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
    if (moveTimerRef.current) window.clearTimeout(moveTimerRef.current);
  }, []);

  // 走路脚步循环
  useEffect(() => {
    if (!charWalking) {
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
      return;
    }
    stepTimerRef.current = window.setInterval(() => {
      setWalkStep(s => (s === 0 ? 1 : 0));
    }, WALK_STEP_MS);
    return () => {
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
    };
  }, [charWalking]);

  // ─── 对话队列 ─────────────────────────────────────────
  const enqueueDialogues = useCallback((items: DiveDialogue[]) => {
    const narratives: DiveDialogue[] = [];
    let choicesMsg: DiveDialogue | null = null;
    for (const d of items) {
      if (d.speaker === 'user_choice' && d.choices && d.choices.length > 0) {
        choicesMsg = d;
      } else if (d.speaker !== 'user_choice') {
        narratives.push(d);
      }
    }
    setSession(prev => prev ? { ...prev, dialogues: [...prev.dialogues, ...items] } : prev);
    if (narratives.length > 0) {
      setDialogueQueue(prev => [...prev, ...narratives]);
    }
    if (choicesMsg?.choices) {
      setPendingChoices(choicesMsg.choices);
    }
  }, []);

  // current 空 + 队列非空 → 自动弹下一条
  useEffect(() => {
    if (currentDialogue) return;
    if (dialogueQueue.length === 0) return;
    const [next, ...rest] = dialogueQueue;
    setCurrentDialogue(next);
    setDialogueQueue(rest);
  }, [currentDialogue, dialogueQueue]);

  const advanceDialogue = useCallback(() => {
    setCurrentDialogue(null);
  }, []);

  // ─── 当前房间布局 ─────────────────────────────────────
  const currentRoomLayout = useMemo(() =>
    session ? homeState.rooms.find(r => r.roomId === session.currentRoom) : undefined,
    [homeState, session?.currentRoom],
  );

  // ─── 角色移动（beat 间微漂，增加生命感） ───────────────
  const shiftChar = useCallback((to: { x: number; y: number }) => {
    setSession(prev => {
      if (!prev) return prev;
      const dx = to.x - prev.charPos.x;
      setCharFlip(dx < 0);
      return {
        ...prev,
        charPos: to,
        playerPos: userPos(to.x, to.y),
      };
    });
    setCharWalking(true);
    if (moveTimerRef.current) window.clearTimeout(moveTimerRef.current);
    moveTimerRef.current = window.setTimeout(() => {
      setCharWalking(false);
      moveTimerRef.current = null;
    }, BEAT_MOVE_DURATION_MS);
  }, []);

  // ═════════════════════════════════════════════════════
  // 剧本播放——drainHandlerRef 在 queue 清空后触发下一步
  // ═════════════════════════════════════════════════════
  const drainHandlerRef = useRef<() => void>(() => {});
  // 前向声明，让各 callback 之间可以互相调用
  const playBeatRef = useRef<(idx: number) => void>(() => {});
  const playCloseRef = useRef<() => void>(() => {});
  const enterNewRoomRef = useRef<(roomId: MemoryRoom) => Promise<void>>(async () => {});
  const handleExitRef = useRef<() => void>(() => {});
  // 在当前剧本加载完成后，延迟触发对下一个房间的预载
  const schedulePreloadRef = useRef<() => void>(() => {});

  // 装入当前房间的剧本：优先用预载结果；否则调 LLM。
  // 失败时不用兜底占位，直接 setLoadError，让下屏渲染"重新召回"按钮。
  const loadScriptForCurrentRoom = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;

    // 1) 预载命中？直接秒进，省掉 loading
    if (preloadedRef.current?.roomId === s.currentRoom) {
      const { script, memoryTexts } = preloadedRef.current;
      preloadedRef.current = null;
      scriptRef.current = script;
      beatIdxRef.current = 0;
      setRoomMemoryTexts(memoryTexts);
      setIsLoadingScript(false);
      setLoadError(null);
      if (script.introNarrator) {
        const now = Date.now();
        enqueueDialogues([{
          id: `intro_room_${now}`,
          speaker: 'narrator',
          text: script.introNarrator,
          timestamp: now,
        }]);
        drainHandlerRef.current = () => playBeatRef.current(0);
      } else {
        playBeatRef.current(0);
      }
      // 还没走完的房间，继续预载下一个
      schedulePreloadRef.current();
      return;
    }

    // 2) 正常调用
    setIsLoadingScript(true);
    setLoadError(null);
    try {
      const res = await planRoomVisit(
        {
          charId, charName, room: s.currentRoom,
          beatCount: BEATS_PER_ROOM,
          visitedRooms: s.visitedRooms,
          recentDialogues: s.dialogues.slice(-10),
          currentBuffs: s.buffValues,
          previousMoodHint: prevMoodHintRef.current,
          previousRoom: prevRoomRef.current,
          previousEndingLine: prevEndingLineRef.current,
          previousEndingSpeaker: prevEndingSpeakerRef.current,
        },
        apiConfig, fullCharContext, remoteVectorConfig,
      );
      scriptRef.current = res.script;
      beatIdxRef.current = 0;
      setRoomMemoryTexts(res.memoryTexts);
      setIsLoadingScript(false);
      if (res.script.introNarrator) {
        const now = Date.now();
        enqueueDialogues([{
          id: `intro_room_${now}`,
          speaker: 'narrator',
          text: res.script.introNarrator,
          timestamp: now,
        }]);
        drainHandlerRef.current = () => playBeatRef.current(0);
      } else {
        playBeatRef.current(0);
      }
      schedulePreloadRef.current();
    } catch (err: any) {
      console.error('[MemoryDive] planRoomVisit failed:', err);
      setIsLoadingScript(false);
      setLoadError(err?.message || '生成失败');
    }
  }, [charId, charName, apiConfig, fullCharContext, remoteVectorConfig, enqueueDialogues]);

  // 后台静默预载"下一个房间"的剧本。播到 beat 1 左右触发——
  // 用户读对话时偷偷 generate，真正切换房间时能秒进。
  // 失败就算了（主流程上真正切换时会走正常调用 / 错误 UI）。
  const preloadNextRoom = useCallback(async () => {
    const s = sessionRef.current;
    const curScript = scriptRef.current;
    if (!s || !curScript) return;
    if (preloadingRef.current) return;

    const next = pickNextRoom(s.currentRoom, s.visitedRooms, curScript.nextRoom);
    if (!next || next === s.currentRoom) return;
    if (preloadedRef.current?.roomId === next) return;

    // 用当前房间的 closingNarrator / finalMoodHint 作为"上个场景余温"的近似值。
    // 用户真正选择造成的最后一句差异是捕捉不到的（还没选呢），但 90% 的衔接已覆盖。
    const prevMoodGuess = curScript.finalMoodHint || curScript.closingNarrator;
    const prevEndingGuess = curScript.closingNarrator || curScript.finalMoodHint;

    preloadingRef.current = true;
    try {
      const res = await planRoomVisit(
        {
          charId, charName, room: next,
          beatCount: BEATS_PER_ROOM,
          visitedRooms: s.visitedRooms,
          recentDialogues: s.dialogues.slice(-10),
          currentBuffs: s.buffValues,
          previousMoodHint: prevMoodGuess,
          previousRoom: s.currentRoom,
          previousEndingLine: prevEndingGuess,
          previousEndingSpeaker: 'narrator',
        },
        apiConfig, fullCharContext, remoteVectorConfig,
      );
      // 真正切过去时 currentRoom 才是 next，本地已改过的话要放弃
      if (sessionRef.current?.currentRoom !== s.currentRoom) return;
      preloadedRef.current = { roomId: next, script: res.script, memoryTexts: res.memoryTexts };
      console.log('[MemoryDive] preloaded', next);
    } catch (e) {
      console.warn('[MemoryDive] preload 失败（静默）:', e);
    } finally {
      preloadingRef.current = false;
    }
  }, [charId, charName, apiConfig, fullCharContext, remoteVectorConfig]);

  // 在当前房间播到一会之后触发预载（不要刚 load 完就调，让 beat 0 先展开）
  useEffect(() => {
    schedulePreloadRef.current = () => {
      window.setTimeout(() => preloadNextRoom(), 1800);
    };
  }, [preloadNextRoom]);

  // 手动重试：用户按"重新召回"按钮
  const handleRetryLoad = useCallback(() => {
    setLoadError(null);
    loadScriptForCurrentRoom();
  }, [loadScriptForCurrentRoom]);

  // 播放一段戏：narrator + charLine + 设置 3 个选项
  const playBeat = useCallback((idx: number) => {
    const script = scriptRef.current;
    const s = sessionRef.current;
    if (!script || !s) return;
    const beat = script.beats[idx];
    if (!beat) {
      playCloseRef.current();
      return;
    }
    beatIdxRef.current = idx;

    // 角色微漂位置，让画面活一点（第 0 段不漂，刚进场）
    if (idx > 0) {
      shiftChar(jitterPos(roomCharPos(s.currentRoom)));
    }

    const now = Date.now();
    const items: DiveDialogue[] = [];
    if (beat.narratorLine) {
      items.push({
        id: `beat_${idx}_n_${now}`,
        speaker: 'narrator',
        text: beat.narratorLine,
        timestamp: now,
      });
    }
    items.push({
      id: `beat_${idx}_c_${now}`,
      speaker: 'character',
      text: beat.charLine,
      timestamp: now + 1,
    });
    // 选项作为 user_choice dialogue，enqueueDialogues 会把它拆出来变成 pendingChoices
    items.push({
      id: `beat_${idx}_choices_${now}`,
      speaker: 'user_choice',
      text: '',
      choices: beat.choices.map(c => ({
        id: c.id,
        text: c.text,
        action: c.action,
        buffEffect: c.buffEffect,
      })),
      timestamp: now + 2,
    });
    enqueueDialogues(items);
    // 选项会阻塞 advance effect，这里不设 drainHandler
    drainHandlerRef.current = () => {};
  }, [enqueueDialogues, shiftChar]);

  // 播放房间收尾
  const playClose = useCallback(() => {
    const script = scriptRef.current;
    const s = sessionRef.current;
    if (!script || !s) return;

    const now = Date.now();
    const items: DiveDialogue[] = [];
    if (script.closingNarrator) {
      items.push({
        id: `close_n_${now}`,
        speaker: 'narrator',
        text: script.closingNarrator,
        timestamp: now,
      });
    }
    if (script.finalMoodHint) {
      items.push({
        id: `close_mood_${now}`,
        speaker: 'narrator',
        text: script.finalMoodHint,
        timestamp: now + 1,
      });
    }
    // 没有收尾文案时给一个默认兜底，至少让流程继续
    if (items.length === 0) {
      items.push({
        id: `close_fallback_${now}`,
        speaker: 'narrator',
        text: '薄雾在身后合拢，你们准备离开这里。',
        timestamp: now,
      });
    }
    enqueueDialogues(items);

    // 收尾播完 → 去下一个房间或结算
    drainHandlerRef.current = () => {
      const sess = sessionRef.current;
      if (!sess) return;
      const next = pickNextRoom(sess.currentRoom, sess.visitedRooms, scriptRef.current?.nextRoom);
      if (next) {
        enterNewRoomRef.current(next);
      } else {
        handleExitRef.current();
      }
    };
  }, [enqueueDialogues]);

  // 选项被选中：应用 buff，播放对应 reaction，reaction 播完推进 beat
  const handleChoice = useCallback((choice: DiveChoice) => {
    const s = sessionRef.current;
    const script = scriptRef.current;
    if (!s || !script) return;

    // 找到对应的 scriptChoice（带 reaction 文本）
    const beat = script.beats[beatIdxRef.current];
    const scriptChoice: DiveScriptChoice | undefined =
      beat?.choices.find(c => c.id === choice.id);

    const now = Date.now();
    const echo: DiveDialogue = {
      id: `echo_${now}`,
      speaker: 'user_choice',
      text: choice.text,
      timestamp: now,
    };

    setSession(prev => prev ? {
      ...prev,
      dialogues: [...prev.dialogues, echo],
      buffValues: applyChoiceBuff(prev.buffValues, choice),
    } : prev);
    setPendingChoices(null);

    // 入队反应
    const reactionItems: DiveDialogue[] = [];
    if (scriptChoice?.reaction) {
      reactionItems.push({
        id: `react_${now}`,
        speaker: 'character',
        text: scriptChoice.reaction,
        timestamp: now + 1,
      });
    }
    if (scriptChoice?.reactionNarrator) {
      reactionItems.push({
        id: `react_n_${now}`,
        speaker: 'narrator',
        text: scriptChoice.reactionNarrator,
        timestamp: now + 2,
      });
    }
    if (reactionItems.length > 0) {
      enqueueDialogues(reactionItems);
    }

    // reaction 播完 → 进下一段或收尾
    drainHandlerRef.current = () => {
      const nextIdx = beatIdxRef.current + 1;
      const s2 = scriptRef.current;
      if (!s2) return;
      if (nextIdx < s2.beats.length) {
        playBeatRef.current(nextIdx);
      } else {
        playCloseRef.current();
      }
    };
  }, [enqueueDialogues]);

  // 进入新房间：淡出 → 换 room → 淡入 → 装载剧本
  const enterNewRoom = useCallback(async (roomId: MemoryRoom) => {
    // 把当前房间的情绪余温/房间名/最后一句存入 ref，供下一轮 planRoomVisit 衔接用
    const cur = sessionRef.current;
    const curScript = scriptRef.current;
    if (cur) prevRoomRef.current = cur.currentRoom;
    prevMoodHintRef.current = curScript?.finalMoodHint || curScript?.closingNarrator;
    // 找到对话历史中最后一句 character/narrator 台词，作为严格衔接锚点
    if (cur) {
      const lastLine = [...cur.dialogues].reverse()
        .find(d => d.speaker === 'character' || d.speaker === 'narrator');
      prevEndingLineRef.current = lastLine?.text;
      prevEndingSpeakerRef.current = lastLine?.speaker as 'character' | 'narrator' | undefined;
    }

    // 设置转场加载文案
    setLoadingText(`走向${ROOM_META[roomId].name}`);

    setTransitionState('out');
    await new Promise(res => window.setTimeout(res, TRANSITION_HALF_MS));

    const entry = roomCharPos(roomId);
    setSession(prev => {
      if (!prev) return prev;
      const visited = prev.visitedRooms.includes(roomId)
        ? prev.visitedRooms
        : [...prev.visitedRooms, roomId];
      return {
        ...prev,
        currentRoom: roomId,
        visitedRooms: visited,
        charPos: entry,
        playerPos: userPos(entry.x, entry.y),
        phase: 'exploring',
      };
    });

    setTransitionState('in');
    await new Promise(res => window.setTimeout(res, TRANSITION_HALF_MS));
    setTransitionState('idle');

    // 转场完毕后装载剧本
    await loadScriptForCurrentRoom();
  }, [loadScriptForCurrentRoom]);

  // 结算
  const handleExit = useCallback(() => {
    const s = sessionRef.current;
    if (!s) { onExit(null); return; }
    // 置为 outro，阻止 advance effect 继续触发
    setSession(prev => prev ? { ...prev, phase: 'outro' } : prev);
    const outro = generateOutroDialogues(charName, s.buffValues);
    enqueueDialogues(outro);
    drainHandlerRef.current = () => {};
    const result = computeDiveResult({ ...s, phase: 'outro' });

    // 后台向角色发射情绪（若启用了 emotionConfig）——角色不记得发生了什么，
    // 但潜意识里会留一层情绪底色，与 chat app 的 buff 系统共用同一套机制
    // 情绪 API 未单独配置时回退到主 apiConfig（与记忆宫殿副 API 完全独立）
    if (charProfile.emotionConfig?.enabled) {
      const emotionApi = (charProfile.emotionConfig.api?.baseUrl)
        ? charProfile.emotionConfig.api
        : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
      // fire-and-forget
      emitDiveEmotion({
        charProfile,
        diveDialogues: s.dialogues,
        diveBuffs: s.buffValues,
        visitedRooms: s.visitedRooms,
        api: emotionApi,
      }).catch(err => console.warn('[MemoryDive] emitDiveEmotion failed:', err));
    }

    window.setTimeout(() => setShowResult(result), 1400);
  }, [charName, charProfile, enqueueDialogues, onExit]);

  const handleFinalExit = useCallback(() => onExit(showResult), [showResult, onExit]);

  // 用户主动点「结束」
  const handleUserExit = useCallback(() => {
    setDialogueQueue([]);
    setCurrentDialogue(null);
    setPendingChoices(null);
    drainHandlerRef.current = () => {};
    handleExit();
  }, [handleExit]);

  // 把最新函数绑定到 ref，供其它 callback 互相调用
  useEffect(() => { playBeatRef.current = playBeat; }, [playBeat]);
  useEffect(() => { playCloseRef.current = playClose; }, [playClose]);
  useEffect(() => { enterNewRoomRef.current = enterNewRoom; }, [enterNewRoom]);
  useEffect(() => { handleExitRef.current = handleExit; }, [handleExit]);

  // loadScriptForCurrentRoom 也用 ref 暴露，让 init effect 能设置初始
  // drainHandler 又不会被后续重渲反复覆盖
  const loadScriptRef = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => { loadScriptRef.current = loadScriptForCurrentRoom; }, [loadScriptForCurrentRoom]);

  // 首次：开场旁白播完后装载 living_room 剧本（只设一次，不做转场）
  useEffect(() => {
    drainHandlerRef.current = () => { loadScriptRef.current(); };
    // 之后的 drainHandler 由各 playback 函数自行覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动前进：队列空 + 无选项 + 不在读取/行走/转场/错误 → 触发 drainHandler
  useEffect(() => {
    if (!session || showResult) return;
    if (currentDialogue || dialogueQueue.length > 0) return;
    if (pendingChoices && pendingChoices.length > 0) return;
    if (isLoadingScript) return;
    if (loadError) return; // 失败态下用户按钮重试，不自动重触发
    if (charWalking) return;
    if (transitionState !== 'idle') return;
    if (session.phase === 'outro') return;

    const t = window.setTimeout(() => {
      drainHandlerRef.current();
    }, 350);
    return () => window.clearTimeout(t);
  }, [currentDialogue, dialogueQueue.length, pendingChoices, isLoadingScript, loadError,
      charWalking, transitionState, showResult, session?.phase, session]);

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════

  if (showResult) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 p-6">
        <div className="max-w-sm w-full space-y-6 text-center">
          <div className="text-3xl">✨</div>
          <h2 className="text-lg font-bold text-slate-100">记忆潜行结束</h2>
          <div className="text-xs text-slate-400">
            探索了 {showResult.visitedRooms.length} 个房间 · {showResult.totalDialogues} 段对话
          </div>
          {showResult.buffs.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest">获得的印记</div>
              {showResult.buffs.map(buff => (
                <div key={buff.type}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <span className="text-xl">{buff.icon}</span>
                  <div className="text-left flex-1">
                    <div className="text-sm font-bold text-slate-200">{buff.label} +{buff.value}</div>
                    <div className="text-[10px] text-slate-400">{buff.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-500 italic">
            {charName}眨了眨眼，看起来什么都不记得了。<br/>
            但你知道，你们之间多了一些微妙的东西。
          </p>
          <button onClick={handleFinalExit}
            className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-all active:scale-95">
            回到像素家园
          </button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-950">
        <span className="text-xs text-slate-500">正在下沉……</span>
      </div>
    );
  }

  const meta = ROOM_META[session.currentRoom];
  // 选项是否应当显示——严格门控，避免在对话切换间隙闪烁
  const choicesVisible = !!pendingChoices &&
    !currentDialogue &&
    dialogueQueue.length === 0 &&
    !isLoadingScript &&
    !charWalking &&
    transitionState === 'idle';

  // 对话框是否应当显示——选项 / 加载 / 转场时隐藏；有当前对话或队列非空时显示
  const isLoadingDialogueState = session.isLoading || isLoadingScript;
  const dialogueVisible = !choicesVisible && !isLoadingDialogueState &&
    (!!currentDialogue || dialogueQueue.length > 0);

  return (
    <div className="h-full w-full flex flex-col bg-slate-950 overflow-hidden select-none">
      {/* 顶栏（薄） */}
      <div className="shrink-0 flex items-center justify-between px-3 pt-11 pb-1.5 bg-black/70 backdrop-blur-sm border-b border-slate-800 z-20">
        <div className="flex items-center gap-1">
          <button onClick={handleUserExit}
            className="p-1.5 -ml-1 rounded-sm hover:bg-slate-700/60 active:scale-90 transition-all"
            aria-label="结束潜行"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-300">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="text-[10px] font-bold text-violet-300 ml-0.5">
            🌀 {meta.emoji} {meta.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {(Object.entries(session.buffValues) as [keyof DiveBuffValues, number][]).map(([key, val]) =>
            val > 0 ? (
              <span key={key} className="text-[9px] text-slate-400" title={BUFF_META[key].label}>
                {BUFF_META[key].icon}{Math.round(val * 10) / 10}
              </span>
            ) : null
          )}
        </div>
      </div>

      {/* 上屏：像素房间 + 对话框浮层 + 选项浮层 */}
      <div className="flex-1 min-h-0 relative border-b-2 border-slate-800">
        <MemoryDiveRoom
          roomId={session.currentRoom}
          layout={currentRoomLayout}
          assets={assets}
          charSprite={charSprite}
          playerSprite={playerSprite}
          charName={charName}
          userName={userName}
          charPos={session.charPos}
          playerPos={session.playerPos}
          charWalking={charWalking}
          charFlip={charFlip}
          walkStep={walkStep}
          transitionState={transitionState}
        />

        {/* 对话框：悬浮在房间下沿 */}
        {dialogueVisible && (
          <div className="absolute left-2 right-2 bottom-2 z-20 pointer-events-auto">
            <MemoryDiveDialogue
              current={currentDialogue}
              queueRemaining={dialogueQueue.length}
              choicesPending={!!pendingChoices && pendingChoices.length > 0}
              charName={charName}
              charAvatar={charProfile.avatar}
              disabled={charWalking || transitionState !== 'idle'}
              onAdvance={advanceDialogue}
            />
          </div>
        )}

        {/* 选项浮层：覆盖房间下半部，优先级高于对话框 */}
        <MemoryDiveChoices
          choices={pendingChoices}
          visible={choicesVisible}
          disabled={charWalking || transitionState !== 'idle'}
          onPick={handleChoice}
        />
      </div>

      {/* 下屏：梦核氛围面板——房间名 + 本次召回的记忆碎片 / 加载引导 / 错误重试 */}
      <MemoryDiveAmbient
        roomName={meta.name}
        memoryFragments={roomMemoryTexts}
        isLoading={isLoadingDialogueState}
        loadingText={loadingText}
        loadError={loadError}
        onRetry={handleRetryLoad}
      />
    </div>
  );
};

export default MemoryDiveMode;
