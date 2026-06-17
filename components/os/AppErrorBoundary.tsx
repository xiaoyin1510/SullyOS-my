import React, { Component, ErrorInfo } from 'react';
import { isChunkLoadError, tryAutoReloadForChunkError } from '../../utils/chunkLoadRecovery';

const ERROR_COPY_LABEL = '\u590d\u5236\u62a5\u9519\u4fe1\u606f';
const ERROR_COPIED_LABEL = '\u5df2\u590d\u5236';
const ERROR_MANUAL_COPY_LABEL = '\u8bf7\u624b\u52a8\u590d\u5236';
const ERROR_PROMPT_LABEL = '\u8bf7\u624b\u52a8\u590d\u5236\u62a5\u9519\u4fe1\u606f';
const ERROR_TITLE = '\u5e94\u7528\u8fd0\u884c\u9519\u8bef';
const ERROR_RETURN_LABEL = '\u8fd4\u56de\u684c\u9762';
const CHUNK_ERROR_TITLE = '\u8d44\u6e90\u52a0\u8f7d\u5931\u8d25';
const CHUNK_ERROR_HINT = '\u5e94\u7528\u7ec4\u4ef6\u6ca1\u6709\u52a0\u8f7d\u6210\u529f\uff0c\u901a\u5e38\u662f\u7248\u672c\u521a\u66f4\u65b0\u6216\u7f51\u7edc\u77ac\u65ad\u5bfc\u81f4\u7684\uff0c\u5237\u65b0\u4e00\u6b21\u5373\u53ef\u6062\u590d\u3002';
const CHUNK_ERROR_RELOADING = '\u6b63\u5728\u81ea\u52a8\u5237\u65b0\u6062\u590d\u2026';
const CHUNK_ERROR_RELOAD_LABEL = '\u5237\u65b0\u91cd\u8bd5';

type AppErrorBoundaryProps = {
    children: React.ReactNode;
    onCloseApp: () => void;
    resetKey: string;
};

type AppErrorBoundaryState = {
    hasError: boolean;
    error: Error | null;
    copyLabel: string;
    /** 懒加载 chunk 失败 (iOS Safari "Importing a module script failed." 等) — 走刷新恢复 UI */
    isChunkError: boolean;
    /** 已发起自动整页刷新, 页面即将重载 */
    autoReloading: boolean;
};

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    private copyLabelTimer: number | null = null;

    constructor(props: AppErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            copyLabel: ERROR_COPY_LABEL,
            isChunkError: false,
            autoReloading: false,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
        return { hasError: true, error, isChunkError: isChunkLoadError(error) };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('App Crash:', error, errorInfo);
        // chunk 加载失败: Safari 会把失败缓存进模块表, 同一 URL 本页内重试必失败,
        // 只有整页 reload 能恢复 — 自动刷一次 (冷却期内返回 false, 留给手动按钮)。
        if (isChunkLoadError(error) && tryAutoReloadForChunkError()) {
            this.setState({ autoReloading: true });
        }
    }

    componentDidUpdate(prevProps: AppErrorBoundaryProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
            this.setState({
                hasError: false,
                error: null,
                copyLabel: ERROR_COPY_LABEL,
                isChunkError: false,
                autoReloading: false,
            });
        }
    }

    componentWillUnmount() {
        if (this.copyLabelTimer) {
            window.clearTimeout(this.copyLabelTimer);
        }
    }

    private updateCopyLabel = (label: string) => {
        if (this.copyLabelTimer) {
            window.clearTimeout(this.copyLabelTimer);
        }

        this.setState({ copyLabel: label });
        this.copyLabelTimer = window.setTimeout(() => {
            this.setState({ copyLabel: ERROR_COPY_LABEL });
            this.copyLabelTimer = null;
        }, 1800);
    };

    private handleCopy = async () => {
        const errText = this.state.error?.stack || this.state.error?.message || 'Unknown Error';

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(errText);
                this.updateCopyLabel(ERROR_COPIED_LABEL);
                return;
            }
        } catch {
            // Fall back to the hidden textarea path below.
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = errText;
            textarea.setAttribute('readonly', 'true');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.pointerEvents = 'none';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textarea);

            if (copied) {
                this.updateCopyLabel(ERROR_COPIED_LABEL);
                return;
            }
        } catch {
            // Fall back to manual copy prompt.
        }

        window.prompt(ERROR_PROMPT_LABEL, errText);
        this.updateCopyLabel(ERROR_MANUAL_COPY_LABEL);
    };

    private handleClose = () => {
        this.setState({
            hasError: false,
            error: null,
            copyLabel: ERROR_COPY_LABEL,
            isChunkError: false,
            autoReloading: false,
        });
        this.props.onCloseApp();
    };

    private handleReload = () => {
        window.location.reload();
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        if (this.state.isChunkError) {
            return (
                <div className="relative isolate z-[120] w-full h-full flex flex-col items-center justify-center bg-slate-900/95 text-white p-6 text-center space-y-4 pointer-events-auto">
                    <img
                        src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f635.png"
                        alt="error"
                        className="w-10 h-10"
                    />
                    <h2 className="text-lg font-bold">{CHUNK_ERROR_TITLE}</h2>
                    <p className="text-xs text-slate-300 max-w-xs leading-relaxed">
                        {CHUNK_ERROR_HINT}
                    </p>
                    {this.state.autoReloading ? (
                        <p className="text-sm font-bold text-slate-200">{CHUNK_ERROR_RELOADING}</p>
                    ) : (
                        <div className="flex flex-col gap-3 w-full max-w-xs">
                            <button
                                type="button"
                                onClick={this.handleReload}
                                className="w-full px-6 py-3 bg-red-600 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform"
                            >
                                {CHUNK_ERROR_RELOAD_LABEL}
                            </button>
                            <button
                                type="button"
                                onClick={this.handleClose}
                                className="w-full px-4 py-2 bg-slate-700 rounded-full text-xs font-bold active:scale-95 transition-transform"
                            >
                                {ERROR_RETURN_LABEL}
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div className="relative isolate z-[120] w-full h-full flex flex-col items-center justify-center bg-slate-900/95 text-white p-6 text-center space-y-4 pointer-events-auto">
                <img
                    src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f635.png"
                    alt="error"
                    className="w-10 h-10"
                />
                <h2 className="text-lg font-bold">{ERROR_TITLE}</h2>
                <p className="text-xs text-slate-300 font-mono bg-black/30 p-3 rounded-2xl max-w-full overflow-auto max-h-40 select-text break-all whitespace-pre-wrap">
                    {this.state.error?.message || 'Unknown Error'}
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                    <button
                        type="button"
                        onClick={this.handleCopy}
                        className="w-full px-4 py-2 bg-slate-700 rounded-full text-xs font-bold active:scale-95 transition-transform"
                    >
                        {this.state.copyLabel}
                    </button>
                    <button
                        type="button"
                        onClick={this.handleClose}
                        className="w-full px-6 py-3 bg-red-600 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform"
                    >
                        {ERROR_RETURN_LABEL}
                    </button>
                </div>
            </div>
        );
    }
}

export default AppErrorBoundary;
