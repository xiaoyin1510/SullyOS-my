/**
 * WorkerUpdateReminderEvent.tsx
 * 后端 (Instant Push Worker) 更新提醒弹窗。
 *
 * 背景：用户的 worker 跑在自己的 Cloudflare 账户里，目前没法保证自动跟上游同步
 * (见 worker/instant-push/README.md 阶段 2 第 5 条存疑说明)。所以每次我们更新
 * worker 代码就 bump utils/instantWorkerVersion.ts 里的 INSTANT_WORKER_VERSION,
 * 启用了 Instant Push 的用户会被提醒一次：去重新部署 / 同步一下 worker。
 *
 * 只提醒启用了 Instant Push 的用户；没开的人完全不受打扰。
 * 同一个版本号只弹一次 (sullyos_worker_build_seen 记 dismiss 过的版本)。
 */

import React, { useState } from 'react';
import {
  loadInstantConfig,
  copyInstantWorkerBundleToClipboard,
  buildCloudflareDashboardUrl,
} from '../utils/instantPushClient';
import { INSTANT_WORKER_VERSION } from '../utils/instantWorkerVersion';

// 记录用户「已确认过的 worker 版本号」。
const WORKER_UPDATE_SEEN_KEY = 'sullyos_worker_build_seen';

/**
 * 把当前 worker 版本标记为已确认。用户点过提醒、或刚配好 worker (视为已是最新)
 * 时调用，避免之后被无意义地反复提醒。
 */
export const markWorkerBuildSeen = (): void => {
  try {
    localStorage.setItem(WORKER_UPDATE_SEEN_KEY, INSTANT_WORKER_VERSION);
  } catch { /* ignore */ }
};

/**
 * 是否要弹「worker 有更新」提醒：
 *  - 只对启用了 Instant Push 的用户弹
 *  - 已确认版本与当前内置版本不一致才弹 (null 也算不一致 —— 老用户首次铺该功能时提醒一次)
 */
export const shouldShowWorkerUpdateReminder = (): boolean => {
  try {
    const cfg = loadInstantConfig();
    if (!cfg.enabled) return false;
    const seen = localStorage.getItem(WORKER_UPDATE_SEEN_KEY);
    return seen !== INSTANT_WORKER_VERSION;
  } catch {
    return false;
  }
};

interface WorkerUpdateReminderPopupProps {
  onClose: () => void;
}

export const WorkerUpdateReminderPopup: React.FC<WorkerUpdateReminderPopupProps> = ({ onClose }) => {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [copyError, setCopyError] = useState('');

  const cfg = loadInstantConfig();
  const dashboardUrl = buildCloudflareDashboardUrl(cfg.workerUrl);
  // workers.dev 子域才能推出确切的 worker name; 自定义域 / 反代退化成 workers 列表页。
  const dashboardLabel = dashboardUrl.includes('/services/view/')
    ? '打开我的 Worker'
    : '打开 Worker 列表';

  const handleCopy = async () => {
    setCopyStatus('loading');
    try {
      await copyInstantWorkerBundleToClipboard();
      setCopyStatus('done');
      setTimeout(() => setCopyStatus((s) => (s === 'done' ? 'idle' : s)), 2500);
    } catch (e) {
      const err = e as { message?: string } | null;
      setCopyError(err?.message ?? '未知错误');
      setCopyStatus('error');
    }
  };

  const handleOpenWorker = () => {
    // 不在这里 markWorkerBuildSeen —— 用户可能只是先打开 dashboard, 还没真粘贴部署。
    // 等他再次回来发"对比已部署"时若一致, 那个流程会顺其自然不再触发提醒。
    window.open(dashboardUrl, '_blank', 'noopener,noreferrer');
  };

  const handleLater = () => {
    markWorkerBuildSeen();
    onClose();
  };

  const copyButtonLabel = copyStatus === 'loading'
    ? '复制中…'
    : copyStatus === 'done'
      ? '✓ 已复制'
      : copyStatus === 'error'
        ? '重试复制'
        : '复制最新代码';

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
        <div className="pt-7 pb-3 px-6 text-center">
          <img
            src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6e0.png"
            alt="worker update"
            className="w-10 h-10 mx-auto mb-2"
          />
          <h2 className="text-lg font-extrabold text-slate-800">Worker 后端有更新</h2>
          <p className="text-[11px] text-slate-400 mt-1">最新版本 {INSTANT_WORKER_VERSION} · Instant Push</p>
        </div>

        <div className="px-6 pb-4 space-y-3">
          <div className="bg-gradient-to-br from-indigo-50 to-sky-50 border border-indigo-100 rounded-2xl p-4 space-y-2">
            <p className="text-[13px] text-slate-700 leading-relaxed">
              推送 worker 有新版本，需要你手动同步一下：
            </p>
            <ol className="text-[12px] text-slate-600 leading-relaxed list-decimal pl-5 space-y-0.5">
              <li>点下面「复制最新代码」</li>
              <li>打开你的 Cloudflare worker 编辑界面</li>
              <li>全选粘贴覆盖，点 Deploy</li>
            </ol>
            <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
              如果不方便现在处理，新代码也已经同步到「设置 → Instant 消息设置」里，
              随时按提示操作即可。
            </p>
            {copyStatus === 'error' && (
              <p className="text-[11px] text-rose-500 leading-relaxed">复制失败：{copyError}</p>
            )}
          </div>
        </div>

        <div className="px-6 pb-7 pt-2 space-y-2">
          <button
            onClick={() => void handleCopy()}
            disabled={copyStatus === 'loading'}
            className={`w-full py-3.5 font-bold rounded-2xl text-sm transition-transform active:scale-95 ${
              copyStatus === 'done'
                ? 'bg-emerald-500 text-white'
                : 'bg-gradient-to-r from-indigo-500 to-sky-500 text-white shadow-lg shadow-indigo-200'
            }`}
          >
            {copyButtonLabel}
          </button>
          <button
            onClick={handleOpenWorker}
            className="w-full py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-2xl text-sm active:scale-95 transition-transform"
          >
            ↗ {dashboardLabel}
          </button>
          <button
            onClick={handleLater}
            className="w-full py-2.5 text-slate-400 font-medium text-[12px]"
          >
            稍后处理
          </button>
        </div>
      </div>
    </div>
  );
};

interface WorkerUpdateReminderControllerProps {
  onClose: () => void;
}

export const WorkerUpdateReminderController: React.FC<WorkerUpdateReminderControllerProps> = ({ onClose }) => {
  return <WorkerUpdateReminderPopup onClose={onClose} />;
};
