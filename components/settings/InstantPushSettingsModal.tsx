import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import { useOS } from '../../context/OSContext';
import { generateClientToken } from '../../utils/vapidGen';
import {
  loadInstantConfig,
  saveInstantConfig,
  getOrCreateInstantSubscription,
  sendTestInstantPush,
  probeInstantWorkerCapabilities,
  probeInstantWorkerVersion,
  copyInstantWorkerBundleToClipboard,
  copyDenoLoaderToClipboard,
  buildCloudflareDashboardUrl,
  normalizeWorkerUrl,
} from '../../utils/instantPushClient';
import { isPushVapidReady } from '../../utils/pushVapid';
import {
  markWorkerBuildSeen,
} from '../WorkerUpdateReminderEvent';
import { INSTANT_WORKER_VERSION } from '../../utils/instantWorkerVersion';
import { FAQ_TARGET_SECTION_KEY, CHANGELOG_2026_05_27 } from '../UpdateNotificationEvent';
import { InstantPushConfig, AppID } from '../../types';

interface InstantPushSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 由 Settings 注入: 点"去配置 VAPID"时打开顶层 PushVapidSettingsModal */
  onOpenVapid?: () => void;
}

export const InstantPushSettingsModal: React.FC<InstantPushSettingsModalProps> = ({
  open,
  onClose,
  onOpenVapid,
}) => {
  const { apiConfig, addToast, openApp } = useOS();

  const [workerUrl, setWorkerUrl] = useState('');
  const [clientToken, setClientToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [autoTriggerOnSend, setAutoTriggerOnSend] = useState(false);
  const [useD1BlobStore, setUseD1BlobStore] = useState(false);
  const [d1Available, setD1Available] = useState(false);
  const [d1CheckedAt, setD1CheckedAt] = useState<number | undefined>(undefined);
  const [d1CheckedWorkerUrl, setD1CheckedWorkerUrl] = useState('');

  const [vapidReady, setVapidReady] = useState(false);

  const [testStatus, setTestStatus] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [capabilityStatus, setCapabilityStatus] = useState('');
  const [capabilityStatusKind, setCapabilityStatusKind] = useState<'idle' | 'loading' | 'success' | 'warning' | 'error'>('idle');
  const [capabilityBusy, setCapabilityBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [denoCopyStatus, setDenoCopyStatus] = useState('');
  // 对比已部署的 worker 自报版本: 'idle' 初始, 'checking' 拉取中, 'latest' 完全匹配, 'stale' 任何
  // 不匹配 (拉不到 / 旧 bundle 没 /version / 版本对不上). 故意不展开 stale 的子情况 —— 对用户而言
  // 都是"该重新部署"。staleDetail 仅用于在 stale 时给出可读的原因 (HTTP xxx / 网络错误等)。
  const [versionCheck, setVersionCheck] = useState<'idle' | 'checking' | 'latest' | 'stale'>('idle');
  const [versionCheckDetail, setVersionCheckDetail] = useState('');

  // GitHub 上 worker.bundle.js 的地址 — 主路径是 app 内「复制 Worker 代码」直接拷贝
  // 本地随包的 bundle; 这个 URL 仅作复制失败时的兜底入口. vite.config.ts 注入的
  // __BUILD_BRANCH__: release (master / main) 或非 git 环境 (unknown) 走 master,
  // 其他分支用当前分支, 方便 PR 前在自己 fork / 分支上测 (分支需已推到远端).
  const INSTANT_PUSH_BUNDLE_URL = (() => {
    const branch = (typeof __BUILD_BRANCH__ !== 'undefined' && __BUILD_BRANCH__) || 'master';
    const ref = branch === 'master' || branch === 'main' || branch === 'unknown' ? 'master' : branch;
    return `https://github.com/qegj567-cloud/SullyOS/blob/${ref}/worker/instant-push/worker.bundle.js`;
  })();

  useEffect(() => {
    if (!open) return;
    const cfg = loadInstantConfig();
    setWorkerUrl(cfg.workerUrl);
    setClientToken(cfg.clientToken ?? '');
    setEnabled(cfg.enabled);
    setAutoTriggerOnSend(cfg.autoTriggerOnSend ?? false);
    setUseD1BlobStore(!!cfg.useD1BlobStore && !!cfg.d1Available);
    setD1Available(!!cfg.d1Available);
    setD1CheckedAt(cfg.d1CheckedAt);
    setD1CheckedWorkerUrl(cfg.d1CheckedWorkerUrl ?? normalizeWorkerUrl(cfg.workerUrl ?? '') ?? '');
    setVapidReady(isPushVapidReady());
    setTestStatus('');
    setCapabilityStatus('');
    setCapabilityStatusKind('idle');
    setCopyStatus('');
    setDenoCopyStatus('');
    setVersionCheck('idle');
    setVersionCheckDetail('');
  }, [open]);

  const normalizedWorkerUrl = normalizeWorkerUrl(workerUrl);
  const canUseD1 = !!d1Available && !!normalizedWorkerUrl && d1CheckedWorkerUrl === normalizedWorkerUrl;

  const resetD1State = () => {
    setD1Available(false);
    setUseD1BlobStore(false);
    setD1CheckedAt(undefined);
    setD1CheckedWorkerUrl('');
  };

  const currentCfg = (): InstantPushConfig => ({
    enabled,
    workerUrl: normalizedWorkerUrl,
    clientToken: clientToken.trim() || undefined,
    autoTriggerOnSend,
    useD1BlobStore: canUseD1 ? useD1BlobStore : false,
    d1Available: canUseD1,
    d1CheckedAt: canUseD1 ? d1CheckedAt : undefined,
    d1CheckedWorkerUrl: canUseD1 ? d1CheckedWorkerUrl : undefined,
  });

  const handleWorkerUrlChange = (value: string) => {
    setWorkerUrl(value);
    const nextUrl = normalizeWorkerUrl(value);
    if (d1CheckedWorkerUrl && nextUrl !== d1CheckedWorkerUrl) {
      resetD1State();
      setCapabilityStatus('Worker 地址变了，需要重新检测 D1 能力');
      setCapabilityStatusKind('warning');
    }
  };

  const handleGenerateToken = () => {
    setClientToken(generateClientToken());
  };

  const handleCopyWorkerCode = async () => {
    setCopyStatus('加载中…');
    try {
      await copyInstantWorkerBundleToClipboard();
      setCopyStatus('已复制');
      setTimeout(() => setCopyStatus(''), 2000);
    } catch (e) {
      const err = e as { message?: string } | null;
      setCopyStatus('');
      addToast(`复制失败：${err?.message ?? '未知错误'}`, 'error');
    }
  };

  const handleCheckDeployedVersion = async () => {
    if (versionCheck === 'checking') return;
    if (!normalizedWorkerUrl) {
      setVersionCheck('stale');
      setVersionCheckDetail('请先填 Worker URL');
      return;
    }
    setVersionCheck('checking');
    setVersionCheckDetail('');
    const result = await probeInstantWorkerVersion(currentCfg());
    if (result.ok) {
      setVersionCheck('latest');
      setVersionCheckDetail('');
    } else {
      // 任何拉取失败 / 版本不匹配 → 一律视为旧版, 不再细分 404/405/网络错误。
      setVersionCheck('stale');
      setVersionCheckDetail(result.error ?? '未知错误');
    }
  };

  const handleOpenTutorial = () => {
    try {
      sessionStorage.setItem(FAQ_TARGET_SECTION_KEY, CHANGELOG_2026_05_27);
    } catch { /* ignore */ }
    openApp(AppID.FAQ);
    onClose();
  };

  const handleOpenCF = () => {
    window.open('https://dash.cloudflare.com/?to=/:account/workers-and-pages/create', '_blank');
  };

  // Deno loader 是 8 行自动追新片段 (站点 origin 由 buildDenoLoaderSnippet 现场推算),
  // 贴一次之后 Worker 每次冷启动自动拉站点最新 bundle, 不需要「复制 Worker 代码」式更新。
  const handleCopyDenoLoader = async () => {
    try {
      await copyDenoLoaderToClipboard();
      setDenoCopyStatus('已复制');
      setTimeout(() => setDenoCopyStatus(''), 2000);
    } catch (e) {
      const err = e as { message?: string } | null;
      setDenoCopyStatus('');
      addToast(`复制失败：${err?.message ?? '未知错误'}`, 'error');
    }
  };

  const handleOpenDeno = () => {
    window.open('https://app.deno.com', '_blank');
  };

  const handleProbeCapabilities = async () => {
    if (capabilityBusy) return;
    const cfg = {
      ...currentCfg(),
      useD1BlobStore: false,
      d1Available: false,
      d1CheckedAt: undefined,
      d1CheckedWorkerUrl: undefined,
    };
    setCapabilityBusy(true);
    setCapabilityStatus('正在检测 Worker 连接…');
    setCapabilityStatusKind('loading');
    try {
      const result = await probeInstantWorkerCapabilities(cfg);
      const checkedAt = Date.now();
      const checkedWorkerUrl = cfg.workerUrl;
      if (!result.ok) {
        const errorText = result.error === 'X-Client-Token required'
          ? 'Worker 要求 Client Token'
          : (result.error === 'X-Client-Token invalid' ? 'Client Token 不对' : result.error);
        resetD1State();
        setCapabilityStatus(`连接失败：${errorText ?? '未知错误'}`);
        setCapabilityStatusKind('error');
        saveInstantConfig({ ...cfg, d1Available: false, useD1BlobStore: false });
        return;
      }

      if (result.d1Available) {
        setD1Available(true);
        setD1CheckedAt(checkedAt);
        setD1CheckedWorkerUrl(checkedWorkerUrl);
        setCapabilityStatus('连接正常，检测到 D1，可以启用 D1 envelope');
        setCapabilityStatusKind('success');
        saveInstantConfig({
          ...cfg,
          useD1BlobStore,
          d1Available: true,
          d1CheckedAt: checkedAt,
          d1CheckedWorkerUrl: checkedWorkerUrl,
        });
      } else {
        const reasonText = result.d1Reason === 'DB binding missing'
          ? 'Worker 没有绑定 DB'
          : (result.d1Reason === 'D1 schema init failed' ? 'D1 表初始化失败' : result.d1Reason);
        resetD1State();
        setCapabilityStatus(`连接正常，未检测到 D1：${reasonText ?? 'Worker 没有绑定 DB'}`);
        setCapabilityStatusKind('warning');
        saveInstantConfig({ ...cfg, d1Available: false, useD1BlobStore: false });
      }
    } catch (e) {
      const err = e as { message?: string } | null;
      resetD1State();
      setCapabilityStatus(`检测失败：${err?.message ?? String(e)}`);
      setCapabilityStatusKind('error');
      saveInstantConfig({ ...cfg, d1Available: false, useD1BlobStore: false });
    } finally {
      setCapabilityBusy(false);
    }
  };

  const handleTest = async () => {
    if (testBusy) return;
    if (!isPushVapidReady()) {
      setTestStatus('请先到「推送凭据 (VAPID)」生成密钥对');
      return;
    }
    const cfg = currentCfg();
    saveInstantConfig(cfg);
    setTestBusy(true);
    setTestStatus('正在获取订阅…');
    try {
      const { sub, reason } = await getOrCreateInstantSubscription();
      if (!sub) {
        setTestStatus(`订阅失败：${reason ?? '未知'}`);
        return;
      }
      setTestStatus('调用 LLM 并推送中…');
      const result = await sendTestInstantPush(apiConfig);
      if (result.ok) {
        setTestStatus('推送已发出，请查看系统通知');
      } else {
        setTestStatus(`失败：${result.error ?? '未知错误'}`);
      }
    } catch (e) {
      const err = e as { message?: string } | null;
      setTestStatus(`错误：${err?.message ?? String(e)}`);
    } finally {
      setTestBusy(false);
    }
  };

  const handleSave = () => {
    const cfg = currentCfg();
    saveInstantConfig(cfg);
    // 保存为启用状态视为「已按当前 worker 版本配好」，避免随后被无意义地提醒更新。
    if (cfg.enabled) markWorkerBuildSeen();
    addToast('Instant Push 配置已保存', 'success');
    onClose();
  };

  const testStatusColor = testStatus.includes('推送已发出')
    ? 'text-emerald-600'
    : testStatus.includes('失败') || testStatus.includes('错误') || testStatus.includes('请先到')
    ? 'text-rose-500'
    : 'text-slate-500';

  return (
    <Modal
      isOpen={open}
      title="Instant Push 配置"
      onClose={onClose}
      footer={
        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl text-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 py-3 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 text-sm"
          >
            保存
          </button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">

        {/* 顶部教程入口 — 打开面板第一眼就能看到，方便第一次自己配的用户 */}
        <button
          type="button"
          onClick={handleOpenTutorial}
          className="w-full flex items-center gap-3 rounded-2xl p-3 bg-gradient-to-r from-rose-50 to-amber-50 border border-rose-200 hover:from-rose-100 hover:to-amber-100 text-left transition-colors"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[12px] font-bold text-rose-600">第一次配置？先看视频教程</span>
            <span className="block text-[11px] text-slate-500">跟着视频一步步点，大概十分钟搞定</span>
          </span>
          <span className="shrink-0 text-rose-500 font-bold text-sm">看教程 →</span>
        </button>

        {/* VAPID 状态横条 */}
        <div className={`rounded-2xl p-3 border ${vapidReady ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] leading-relaxed">
              <p className={`font-bold ${vapidReady ? 'text-emerald-700' : 'text-rose-700'}`}>
                {vapidReady ? 'VAPID 已配置' : 'VAPID 未配置'}
              </p>
              <p className={vapidReady ? 'text-emerald-600' : 'text-rose-600'}>
                {vapidReady
                  ? '与 Proactive Push 共用同一份。改了之后两边的订阅都会续上。'
                  : '需要先生成 VAPID 密钥对，Worker env 也要同步填进去。'}
              </p>
            </div>
            {onOpenVapid && (
              <button
                type="button"
                onClick={onOpenVapid}
                className={`shrink-0 px-3 py-2 text-[11px] rounded-xl font-bold ${vapidReady ? 'bg-white text-emerald-700 border border-emerald-300 hover:bg-emerald-50' : 'bg-rose-500 text-white hover:bg-rose-600'}`}
              >
                {vapidReady ? '查看 / 重生成' : '去生成 →'}
              </button>
            )}
          </div>
        </div>

        {/* ① Worker 配置 */}
        <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">① Worker 配置</p>

          <div className="space-y-1">
            <label className="text-[11px] text-slate-500 font-medium">Worker URL</label>
            <input
              type="url"
              value={workerUrl}
              onChange={(e) => handleWorkerUrlChange(e.target.value)}
              placeholder="https://instant-push.xxx.workers.dev"
              className="w-full text-xs bg-white border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-slate-500 font-medium">Client Token（可选，防止他人滥用 Worker）</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={clientToken}
                onChange={(e) => setClientToken(e.target.value)}
                placeholder="留空则裸跑"
                className="flex-1 text-[11px] font-mono bg-white border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400"
              />
              <button
                type="button"
                onClick={handleGenerateToken}
                className="shrink-0 px-3 py-2 text-[11px] bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-medium"
              >
                随机
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-indigo-500"
            />
            <span className="text-[12px] text-slate-600 font-medium">启用 Instant Push</span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoTriggerOnSend}
              onChange={(e) => setAutoTriggerOnSend(e.target.checked)}
              className="accent-indigo-500 mt-0.5"
            />
            <span className="text-[12px] text-slate-600 font-medium leading-relaxed">
              发送后自动触发回复
              <span className="block text-[11px] text-slate-400 font-normal">
                关闭时发完文本仍需手动点 ⚡ 触发，跟本地模式一致；开启后发文本即自动让角色回复。
              </span>
            </span>
          </label>

          <div className="border-t border-slate-200 pt-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-slate-600 font-bold">D1 envelope</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  默认走分片；检测到 Worker 绑定了 D1 后，才允许把大包改成短 push + 拉完整包。
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleProbeCapabilities()}
                disabled={capabilityBusy || !normalizedWorkerUrl}
                className={`shrink-0 px-3 py-2 text-[11px] rounded-xl font-bold ${capabilityBusy || !normalizedWorkerUrl ? 'bg-slate-100 text-slate-400' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {capabilityBusy ? '检测中…' : '检测连接'}
              </button>
            </div>

            <label className={`flex items-start gap-2 ${canUseD1 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
              <input
                type="checkbox"
                checked={canUseD1 && useD1BlobStore}
                disabled={!canUseD1}
                onChange={(e) => setUseD1BlobStore(e.target.checked)}
                className="accent-indigo-500 mt-0.5"
              />
              <span className="text-[12px] text-slate-600 font-medium leading-relaxed">
                使用 D1 envelope 承接大 payload
                <span className="block text-[11px] text-slate-400 font-normal">
                  {canUseD1
                    ? '已检测到可用 D1；关闭时继续使用默认分片。'
                    : '先检测连接；没有 D1 时这个选项会保持关闭。'}
                </span>
              </span>
            </label>

            {capabilityStatus && (
              <p className={`text-[11px] leading-relaxed ${capabilityStatusKind === 'error' || capabilityStatusKind === 'warning' ? 'text-amber-600' : capabilityStatusKind === 'success' ? 'text-emerald-600' : 'text-slate-500'}`}>
                {capabilityStatus}
              </p>
            )}
          </div>
        </div>

        {/* ② 部署 Worker */}
        <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">② 部署 Worker</p>

          {/* 方式 A · Deno (推荐): loader 冷启动自动拉最新 bundle, 部署一次永久追新 */}
          <div className="rounded-xl bg-white border border-indigo-200 p-3 space-y-2">
            <p className="text-[12px] text-slate-600 font-bold">方式 A · Deno Deploy（推荐，自动追新）</p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              在 Deno 控制台新建 <strong>Playground</strong>，把复制到的 loader（仅 8 行）粘贴进去部署；
              VAPID 公钥/私钥到「推送凭据 (VAPID)」面板复制 env 清单，填进 Playground 的环境变量。
              之后 Worker 每次冷启动会自动拉取站点最新代码，<strong>无需手动更新</strong>。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleCopyDenoLoader()}
                className="py-2 rounded-xl text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600"
              >
                {denoCopyStatus || '复制 Deno Loader'}
              </button>
              <button
                type="button"
                onClick={handleOpenDeno}
                className="py-2 rounded-xl text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                ↗ Deno 控制台
              </button>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            <strong>方式 B · Cloudflare（手动更新）：</strong>在 CF 后台 Create → Worker 建一个空 Worker，进
            <strong> Edit code</strong> 把下面复制到的
            <code className="font-mono"> worker.bundle.js </code>全部内容粘贴覆盖，再 Deploy；
            VAPID 公钥/私钥到「推送凭据 (VAPID)」面板复制 env 清单，粘进 Worker 的 Variables。
          </p>

          {/* Worker 代码版本 + 对比已部署: 拉 worker /version 跟随包版本对, 拉不到 / 不一致都算旧 */}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white border border-slate-200 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500">最新 Worker 代码版本</p>
              <p className="text-[12px] font-bold text-slate-700 font-mono">{INSTANT_WORKER_VERSION}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleCheckDeployedVersion()}
              disabled={versionCheck === 'checking' || !normalizedWorkerUrl}
              className={`shrink-0 px-3 py-2 text-[11px] rounded-xl font-bold ${
                versionCheck === 'checking' || !normalizedWorkerUrl
                  ? 'bg-slate-100 text-slate-400'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {versionCheck === 'checking' ? '查询中…' : '对比已部署'}
            </button>
          </div>
          {versionCheck === 'latest' && (
            <p className="text-[11px] leading-relaxed text-emerald-600">
              ✓ 你部署的 Worker 已是最新 ({INSTANT_WORKER_VERSION})
            </p>
          )}
          {versionCheck === 'stale' && (
            <p className="text-[11px] leading-relaxed text-amber-600">
              你部署的 Worker 不是最新版 —— Deno：进 Playground 重新部署一次（保存即可）；
              CF：复制下面的最新代码重新粘贴 Deploy
              {versionCheckDetail ? ` (${versionCheckDetail})` : ''}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleCopyWorkerCode()}
              className="py-2 rounded-xl text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600"
            >
              {copyStatus || '复制 Worker 代码'}
            </button>
            <button
              type="button"
              onClick={handleOpenCF}
              className="py-2 rounded-xl text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              ↗ CF Dashboard
            </button>
          </div>
          {/* 非 release 分支提示: 兜底 GitHub 链接指向当前分支的 bundle */}
          {typeof __BUILD_BRANCH__ !== 'undefined'
            && __BUILD_BRANCH__
            && __BUILD_BRANCH__ !== 'master'
            && __BUILD_BRANCH__ !== 'main'
            && __BUILD_BRANCH__ !== 'unknown' && (
            <p className="text-[10px] text-amber-600 leading-tight pt-1">
              当前为分支 <code className="font-mono">{__BUILD_BRANCH__}</code> — 兜底 GitHub 链接指向该分支的 bundle，确保已推到远端.
            </p>
          )}

          <div className="flex items-center justify-end pt-1">
            <a
              href={INSTANT_PUSH_BUNDLE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-slate-400 hover:text-slate-600 underline-offset-2 hover:underline"
            >
              复制失败？去 GitHub 打开 worker.bundle.js →
            </a>
          </div>
        </div>

        {/* ③ 测试推送 */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testBusy}
            className={`w-full py-3 rounded-xl text-sm font-bold ${testBusy ? 'bg-slate-200 text-slate-400' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}
          >
            {testBusy ? '测试中…' : '🔔 发送测试推送'}
          </button>
          {testStatus && (
            <p className={`text-[11px] text-center ${testStatusColor}`}>{testStatus}</p>
          )}
          {!apiConfig.baseUrl && (
            <p className="text-[11px] text-amber-600 text-center">请先在 Settings → API 配置 Chat API，测试推送会复用它</p>
          )}
          <p className="text-[11px] text-slate-400 text-center leading-relaxed">
            测试推送带 <code>metadata.test=true</code> 标记，SW 收到后即使 app 在前台也会强制弹系统通知 —— 真实消息照旧前台静默由 in-app UI 兜底。
          </p>
        </div>

      </div>
    </Modal>
  );
};
