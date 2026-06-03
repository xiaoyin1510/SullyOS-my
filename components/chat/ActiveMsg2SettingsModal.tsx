import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../../types';
import { ActiveMsgClient, getDefaultActiveMsgFirstSendTime } from '../../utils/activeMsgClient';

interface ActiveMsg2SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  char: CharacterProfile;
  apiConfig: APIConfig;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  onSave: (config: NonNullable<CharacterProfile['activeMsg2Config']>) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const MODE_OPTIONS = [
  { id: 'fixed', label: '固定', desc: '到点直接发你写好的内容' },
  { id: 'auto', label: '自动', desc: '用当前角色设定和聊天快照自己生成' },
  { id: 'prompted', label: '提示词', desc: '围绕你写的方向生成主动消息' },
] as const;

const RECURRENCE_OPTIONS = [
  { id: 'none', label: '一次' },
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' },
] as const;

const ActiveMsg2SettingsModal: React.FC<ActiveMsg2SettingsModalProps> = ({
  isOpen,
  onClose,
  char,
  apiConfig,
  userProfile,
  groups,
  realtimeConfig,
  onSave,
  addToast,
}) => {
  const saved = char.activeMsg2Config;
  const [enabled, setEnabled] = useState(saved?.enabled ?? false);
  const [mode, setMode] = useState<NonNullable<CharacterProfile['activeMsg2Config']>['mode']>(saved?.mode ?? 'auto');
  const [firstSendTime, setFirstSendTime] = useState(saved?.firstSendTime ?? getDefaultActiveMsgFirstSendTime());
  const [recurrenceType, setRecurrenceType] = useState(saved?.recurrenceType ?? 'none');
  const [userMessage, setUserMessage] = useState(saved?.userMessage ?? '');
  const [promptHint, setPromptHint] = useState(saved?.promptHint ?? '');
  const [maxTokens, setMaxTokens] = useState(String(saved?.maxTokens ?? ''));
  const [useSecondaryApi, setUseSecondaryApi] = useState(saved?.useSecondaryApi ?? false);
  const [secUrl, setSecUrl] = useState(saved?.secondaryApi?.baseUrl ?? '');
  const [secKey, setSecKey] = useState(saved?.secondaryApi?.apiKey ?? '');
  const [secModel, setSecModel] = useState(saved?.secondaryApi?.model ?? '');
  const [globalReady, setGlobalReady] = useState(false);
  const [pushSummary, setPushSummary] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const next = char.activeMsg2Config;
    setEnabled(next?.enabled ?? false);
    setMode(next?.mode ?? 'auto');
    setFirstSendTime(next?.firstSendTime ?? getDefaultActiveMsgFirstSendTime());
    setRecurrenceType(next?.recurrenceType ?? 'none');
    setUserMessage(next?.userMessage ?? '');
    setPromptHint(next?.promptHint ?? '');
    setMaxTokens(next?.maxTokens ? String(next.maxTokens) : '');
    setUseSecondaryApi(next?.useSecondaryApi ?? false);
    setSecUrl(next?.secondaryApi?.baseUrl ?? '');
    setSecKey(next?.secondaryApi?.apiKey ?? '');
    setSecModel(next?.secondaryApi?.model ?? '');

    void (async () => {
      const globalConfig = await ActiveMsgClient.getGlobalConfig();
      const pushStatus = await ActiveMsgClient.getPushStatus();
      setGlobalReady(Boolean(globalConfig.tenantToken));
      setPushSummary(pushStatus.supported
        ? `权限：${pushStatus.permission} / 订阅：${pushStatus.hasSubscription ? '已就绪' : '未创建'}`
        : '当前环境不支持 Web Push');
    })();
  }, [isOpen, char.id, char.activeMsg2Config]);

  const buildNextConfig = (): NonNullable<CharacterProfile['activeMsg2Config']> => ({
    enabled,
    mode,
    firstSendTime,
    recurrenceType,
    userMessage: userMessage.trim() || undefined,
    promptHint: promptHint.trim() || undefined,
    maxTokens: maxTokens.trim() ? Number(maxTokens) : undefined,
    taskUuid: saved?.taskUuid,
    remoteStatus: saved?.remoteStatus || 'idle',
    useSecondaryApi: useSecondaryApi && !!secUrl,
    secondaryApi: useSecondaryApi && secUrl ? {
      baseUrl: secUrl.trim(),
      apiKey: secKey.trim(),
      model: secModel.trim(),
    } : undefined,
    lastSyncedAt: saved?.lastSyncedAt,
    lastError: saved?.lastError,
  });

  const handleSubmit = async () => {
    const nextConfig = buildNextConfig();
    setIsSubmitting(true);

    try {
      if (!nextConfig.enabled) {
        if (nextConfig.taskUuid) {
          await ActiveMsgClient.cancelTask(nextConfig.taskUuid);
        }
        onSave({
          ...nextConfig,
          taskUuid: undefined,
          remoteStatus: 'idle',
          lastSyncedAt: Date.now(),
          lastError: undefined,
        });
        addToast('主动消息 2.0 已关闭。', 'info');
        onClose();
        return;
      }

      if (!globalReady) {
        throw new Error('请先去系统设置里完成“主动消息 2.0”的全局配置。');
      }

      const result = await ActiveMsgClient.scheduleCharacterTask({
        char,
        config: nextConfig,
        userProfile,
        groups,
        realtimeConfig,
        apiConfig,
      });

      onSave({
        ...nextConfig,
        taskUuid: result.uuid,
        remoteStatus: result.status === 'sent' ? 'sent' : 'scheduled',
        lastSyncedAt: Date.now(),
        lastError: undefined,
      });
      addToast('主动消息 2.0 任务已创建。', 'success');
      onClose();
    } catch (error: any) {
      const message = error?.message || '主动消息 2.0 保存失败。';
      onSave({
        ...nextConfig,
        remoteStatus: 'error',
        lastError: message,
      });
      addToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="主动消息 2.0"
      onClose={onClose}
      footer={(
        <>
          <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform">
            取消
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 py-3 bg-fuchsia-500 text-white font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50">
            {isSubmitting ? '保存中...' : enabled ? '保存并同步' : '关闭 2.0'}
          </button>
        </>
      )}
    >
      <div className="space-y-4 text-sm text-slate-600">
        <p className="text-xs leading-relaxed text-slate-500">
          这是新的云端主动消息入口。它会把当前角色设定、最近聊天快照和推送订阅一起提交到主动消息标准服务里。长周期循环任务建议在剧情变化后重新保存一次，避免使用过旧的上下文。
        </p>

        <div className="flex items-center justify-between bg-fuchsia-50 border border-fuchsia-100 rounded-2xl p-4">
          <div>
            <div className="font-bold text-slate-700">启用主动消息 2.0</div>
            <div className="text-xs text-fuchsia-600 mt-1">{pushSummary || '正在检查 Push 状态...'}</div>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-12 h-7 rounded-full transition-colors relative ${enabled ? 'bg-fuchsia-500' : 'bg-slate-200'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {saved?.taskUuid ? (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs space-y-1">
            <div>当前任务 UUID：<span className="font-mono break-all">{saved.taskUuid}</span></div>
            <div>状态：<span className="font-bold">{saved.remoteStatus || 'unknown'}</span></div>
            {saved.lastError ? <div className="text-red-500">最近错误：{saved.lastError}</div> : null}
          </div>
        ) : null}

        {enabled ? (
          <>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">模式</label>
              <div className="space-y-2">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setMode(option.id)}
                    className={`w-full text-left rounded-2xl border px-4 py-3 transition-all ${mode === option.id ? 'bg-fuchsia-500 text-white border-fuchsia-500' : 'bg-white border-slate-200 text-slate-600'}`}
                  >
                    <div className="font-bold">{option.label}</div>
                    <div className={`text-xs mt-1 ${mode === option.id ? 'text-fuchsia-50' : 'text-slate-400'}`}>{option.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">首次发送时间</label>
              <input
                type="datetime-local"
                value={firstSendTime}
                onChange={(event) => setFirstSendTime(event.target.value)}
                className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">重复方式</label>
              <div className="grid grid-cols-3 gap-2">
                {RECURRENCE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setRecurrenceType(option.id)}
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${recurrenceType === option.id ? 'bg-fuchsia-500 text-white border-fuchsia-500' : 'bg-white border-slate-200 text-slate-600'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-2 pl-1">
                2.0 标准版目前只支持：一次 / 每天 / 每周。30 分钟、1 小时、2 小时这类间隔暂时不支持。
              </div>
            </div>

            {mode === 'fixed' ? (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">固定消息内容</label>
                <textarea
                  value={userMessage}
                  onChange={(event) => setUserMessage(event.target.value)}
                  placeholder="到点后直接推送这段消息"
                  className="w-full h-28 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm resize-none"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
                    {mode === 'prompted' ? '额外提示词' : '补充灵感 (可选)'}
                  </label>
                  <textarea
                    value={promptHint}
                    onChange={(event) => setPromptHint(event.target.value)}
                    placeholder={mode === 'prompted' ? '例如：晚安前撒娇一下，但别太油' : '例如：今天下雨、想找我聊一点轻松的'}
                    className="w-full h-24 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm resize-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">maxTokens (可选)</label>
                  <input
                    type="number"
                    min={1}
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(event.target.value)}
                    placeholder="例如 120"
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm"
                  />
                </div>
              </>
            )}

            <div className="pt-1 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-bold text-slate-700">使用单独 API</div>
                  <div className="text-xs text-slate-400 mt-1">不开启则复用当前聊天主 API。</div>
                </div>
                <button
                  onClick={() => setUseSecondaryApi(!useSecondaryApi)}
                  className={`w-12 h-7 rounded-full transition-colors relative ${useSecondaryApi ? 'bg-fuchsia-500' : 'bg-slate-200'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${useSecondaryApi ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {useSecondaryApi ? (
                <div className="space-y-3 bg-slate-50 rounded-2xl p-3">
                  <input value={secUrl} onChange={(event) => setSecUrl(event.target.value)} placeholder="API URL" className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-slate-200" />
                  <input type="password" value={secKey} onChange={(event) => setSecKey(event.target.value)} placeholder="API Key" className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-slate-200" />
                  <input value={secModel} onChange={(event) => setSecModel(event.target.value)} placeholder="Model" className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-slate-200" />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
};

export default React.memo(ActiveMsg2SettingsModal);
