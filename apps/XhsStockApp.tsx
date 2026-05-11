
import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { XhsStockImage } from '../types';
import ConfirmDialog from '../components/os/ConfirmDialog';

const XhsStockApp: React.FC = () => {
    const { closeApp, addToast } = useOS();
    const [images, setImages] = useState<XhsStockImage[]>([]);
    const [view, setView] = useState<'list' | 'add'>('list');
    const [newUrl, setNewUrl] = useState('');
    const [newTags, setNewTags] = useState('');
    const [previewOk, setPreviewOk] = useState<boolean | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean; title: string; message: string;
        variant: 'danger' | 'warning' | 'info'; onConfirm: () => void;
    } | null>(null);
    const [filterTag, setFilterTag] = useState<string | null>(null);

    const loadImages = useCallback(async () => {
        const imgs = await DB.getXhsStockImages();
        setImages(imgs.sort((a, b) => b.addedAt - a.addedAt));
    }, []);

    useEffect(() => { loadImages(); }, [loadImages]);

    // All unique tags
    const allTags = Array.from(new Set(images.flatMap(img => img.tags))).sort();

    const filteredImages = filterTag
        ? images.filter(img => img.tags.includes(filterTag))
        : images;

    const handleAdd = async () => {
        const url = newUrl.trim();
        if (!url) { addToast('请填写图片URL', 'error'); return; }
        if (!/^https?:\/\//i.test(url)) { addToast('URL必须以 http(s):// 开头', 'error'); return; }

        const tags = newTags.split(/[,，\s#]+/).map(t => t.trim()).filter(Boolean);
        if (tags.length === 0) { addToast('至少填一个标签', 'error'); return; }

        const img: XhsStockImage = {
            id: `xhs_stock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            url,
            tags,
            addedAt: Date.now(),
            usedCount: 0,
        };

        await DB.saveXhsStockImage(img);
        setNewUrl('');
        setNewTags('');
        setPreviewOk(null);
        setView('list');
        await loadImages();
        addToast('图片已入库', 'success');
    };

    const handleDelete = (img: XhsStockImage) => {
        setConfirmDialog({
            isOpen: true,
            title: '删除图片',
            message: `确定删除这张图片吗？\n标签: ${img.tags.join(', ')}`,
            variant: 'danger',
            onConfirm: async () => {
                await DB.deleteXhsStockImage(img.id);
                await loadImages();
                addToast('已删除', 'success');
                setConfirmDialog(null);
            }
        });
    };

    const renderAddForm = () => (
        <div className="p-5 space-y-5 animate-fade-in">
            {/* URL Input */}
            <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">图片URL</label>
                <input
                    type="url"
                    value={newUrl}
                    onChange={e => { setNewUrl(e.target.value); setPreviewOk(null); }}
                    placeholder="https://your-image-host.com/image.jpg"
                    className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-transparent placeholder:text-slate-300"
                />
            </div>

            {/* Preview */}
            {newUrl && /^https?:\/\//i.test(newUrl) && (
                <div className="rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 relative" style={{ maxHeight: 200 }}>
                    <img
                        src={newUrl}
                        className="w-full h-full object-contain"
                        style={{ maxHeight: 200 }}
                        onLoad={() => setPreviewOk(true)}
                        onError={() => setPreviewOk(false)}
                        alt="preview"
                    />
                    {previewOk === false && (
                        <div className="absolute inset-0 flex items-center justify-center bg-red-50/90">
                            <span className="text-sm text-red-500 font-medium">图片加载失败，请检查URL</span>
                        </div>
                    )}
                </div>
            )}

            {/* Tags Input */}
            <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">标签 (空格/逗号分隔)</label>
                <input
                    type="text"
                    value={newTags}
                    onChange={e => setNewTags(e.target.value)}
                    placeholder="美食 咖啡 下午茶 或 #穿搭 #日常"
                    className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-transparent placeholder:text-slate-300"
                />
                {newTags && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {newTags.split(/[,，\s#]+/).filter(Boolean).map((tag, i) => (
                            <span key={i} className="px-2.5 py-1 bg-red-50 text-red-500 text-xs rounded-full font-medium">#{tag}</span>
                        ))}
                    </div>
                )}
            </div>

            {/* Submit */}
            <button
                onClick={handleAdd}
                disabled={!newUrl || previewOk === false}
                className="w-full py-3.5 bg-gradient-to-r from-red-400 to-rose-500 text-white font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-transform disabled:opacity-40 disabled:pointer-events-none text-sm"
            >
                添加到图库
            </button>
        </div>
    );

    const renderList = () => (
        <div className="flex-1 overflow-y-auto min-h-0">
            {/* Tag filter */}
            {allTags.length > 0 && (
                <div className="flex gap-1.5 px-4 py-3 overflow-x-auto no-scrollbar border-b border-slate-100">
                    <button
                        onClick={() => setFilterTag(null)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!filterTag ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}
                    >
                        全部 ({images.length})
                    </button>
                    {allTags.map(tag => {
                        const count = images.filter(img => img.tags.includes(tag)).length;
                        return (
                            <button
                                key={tag}
                                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterTag === tag ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}
                            >
                                #{tag} ({count})
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Image grid */}
            {filteredImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-14 h-14 opacity-40">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                    <span className="text-sm">还没有囤图</span>
                    <span className="text-xs text-slate-300">点右上角 + 添加图片</span>
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-1 p-1">
                    {filteredImages.map(img => (
                        <div key={img.id} className="aspect-square bg-slate-100 relative overflow-hidden rounded-sm group">
                            <img src={img.url} className="w-full h-full object-cover" loading="lazy" alt="" />
                            {/* Overlay with tags + delete */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-1.5">
                                <div className="flex flex-wrap gap-0.5">
                                    {img.tags.slice(0, 3).map((tag, i) => (
                                        <span key={i} className="text-[9px] bg-white/20 text-white px-1.5 py-0.5 rounded-full">#{tag}</span>
                                    ))}
                                </div>
                            </div>
                            {/* Used count badge */}
                            {img.usedCount > 0 && (
                                <div className="absolute top-1 left-1 bg-red-500/80 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold">
                                    x{img.usedCount}
                                </div>
                            )}
                            {/* Tags overlay (always visible on mobile) */}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-3">
                                <div className="flex flex-wrap gap-0.5">
                                    {img.tags.slice(0, 2).map((tag, i) => (
                                        <span key={i} className="text-[8px] text-white/80">#{tag}</span>
                                    ))}
                                    {img.tags.length > 2 && <span className="text-[8px] text-white/50">+{img.tags.length - 2}</span>}
                                </div>
                            </div>
                            {/* Delete button */}
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(img); }}
                                className="absolute top-1 right-1 w-6 h-6 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-3.5 h-3.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col font-light relative">
            <ConfirmDialog
                isOpen={!!confirmDialog}
                title={confirmDialog?.title || ''}
                message={confirmDialog?.message || ''}
                variant={confirmDialog?.variant}
                confirmText="确认"
                onConfirm={confirmDialog?.onConfirm || (() => setConfirmDialog(null))}
                onCancel={() => setConfirmDialog(null)}
            />

            {/* Header */}
            <div className="h-14 bg-white/80 backdrop-blur-xl flex items-center px-4 border-b border-slate-100/60 shrink-0 z-10">
                <button onClick={view === 'add' ? () => setView('list') : closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <h1 className="text-lg font-semibold text-slate-800 ml-2 tracking-tight">
                    {view === 'add' ? '添加图片' : '小红书图库'}
                </h1>
                <span className="text-xs text-slate-400 ml-2 font-mono">{images.length}</span>
                <div className="flex-1" />
                {view === 'list' && (
                    <button
                        onClick={() => setView('add')}
                        className="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md active:scale-90 transition-transform"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                    </button>
                )}
            </div>

            {view === 'add' ? renderAddForm() : renderList()}
        </div>
    );
};

export default XhsStockApp;
