import React, { useState, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { Worldbook } from '../types';
import Modal from '../components/os/Modal';
import { DiamondsFour, BookOpen } from '@phosphor-icons/react';

const WorldbookApp: React.FC = () => {
    const { closeApp, worldbooks, addWorldbook, updateWorldbook, deleteWorldbook, addToast } = useOS();
    
    // View State
    const [isEditing, setIsEditing] = useState(false);
    const [editingBook, setEditingBook] = useState<Worldbook | null>(null);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [previewBookId, setPreviewBookId] = useState<string | null>(null);

    // Edit Form State
    const [tempTitle, setTempTitle] = useState('');
    const [tempContent, setTempContent] = useState('');
    const [tempCategory, setTempCategory] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Grouping Logic
    const groupedBooks = useMemo(() => {
        const groups: Record<string, Worldbook[]> = {};
        const defaultCat = '未分类设定 (General)';
        
        worldbooks.forEach(wb => {
            const cat = wb.category || defaultCat;
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(wb);
        });
        
        // Auto-expand the first category if none selected and groups exist
        if (!expandedCategory && Object.keys(groups).length > 0) {
            // setExpandedCategory(Object.keys(groups)[0]); // Optional: Auto open first
        }
        
        return groups;
    }, [worldbooks]);

    const handleCreate = () => {
        setEditingBook(null); 
        setTempTitle('');
        setTempContent('');
        setTempCategory(''); // Default empty
        setIsEditing(true);
    };

    const handleEdit = (book: Worldbook) => {
        setEditingBook(book);
        setTempTitle(book.title);
        setTempContent(book.content);
        setTempCategory(book.category || '');
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!tempTitle.trim()) {
            addToast('请输入标题', 'error');
            return;
        }

        const category = tempCategory.trim() || '未分类设定 (General)';

        if (editingBook) {
            await updateWorldbook(editingBook.id, {
                title: tempTitle,
                content: tempContent,
                category: category
            });
            addToast('已保存 (同步至相关角色)', 'success');
        } else {
            const newBook: Worldbook = {
                id: `wb-${Date.now()}`,
                title: tempTitle,
                content: tempContent,
                category: category,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            addWorldbook(newBook);
            addToast('新书已创建', 'success');
        }
        setIsEditing(false);
    };

    const requestDelete = (e: React.MouseEvent, book: Worldbook) => {
        e.stopPropagation();
        setEditingBook(book);
        setShowDeleteConfirm(true);
    };

    const confirmDelete = () => {
        if (editingBook) {
            deleteWorldbook(editingBook.id);
            // Toast logic handled in Context
            setShowDeleteConfirm(false);
            setEditingBook(null);
            setIsEditing(false);
        }
    };

    const toggleCategory = (cat: string) => {
        setExpandedCategory(expandedCategory === cat ? null : cat);
    };

    const togglePreview = (id: string) => {
        setPreviewBookId(previewBookId === id ? null : id);
    };

    // --- Render ---

    // EDIT MODAL (Full Screen Overlay Style)
    if (isEditing) {
        return (
            <div className="h-full w-full bg-slate-50 flex flex-col font-sans animate-fade-in">
                <div className="h-16 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md border-b border-slate-200 shrink-0 z-20">
                    <button onClick={() => setIsEditing(false)} className="px-3 py-1 text-slate-500 font-bold text-sm">取消</button>
                    <span className="font-bold text-slate-800">{editingBook ? '编辑条目' : '新建条目'}</span>
                    <button onClick={handleSave} className="px-4 py-1.5 bg-indigo-500 text-white rounded-full text-xs font-bold shadow-md active:scale-95 transition-transform">保存</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block tracking-wider">标题 (Title)</label>
                            <input 
                                value={tempTitle}
                                onChange={e => setTempTitle(e.target.value)}
                                placeholder="例如: 魔法体系、公司背景..." 
                                className="w-full text-lg font-bold text-slate-800 bg-white border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block tracking-wider">分组 (Group)</label>
                            <div className="relative">
                                <input 
                                    value={tempCategory}
                                    onChange={e => setTempCategory(e.target.value)}
                                    placeholder="例如: 世界观、人物、地理..." 
                                    className="w-full text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                                    list="category-suggestions"
                                />
                                <datalist id="category-suggestions">
                                    {Object.keys(groupedBooks).map(cat => (
                                        <option key={cat} value={cat} />
                                    ))}
                                </datalist>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 pl-1">输入相同名称可自动归入已有分组。</p>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block tracking-wider">设定内容 (Content)</label>
                            <textarea 
                                value={tempContent}
                                onChange={e => setTempContent(e.target.value)}
                                placeholder="在此输入详细的设定内容，支持 Markdown 格式..." 
                                className="w-full h-80 bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-700 leading-relaxed resize-none outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-mono"
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // LIST VIEW
    return (
        <div className="h-full w-full relative overflow-hidden font-sans bg-slate-100 flex flex-col">
            {/* Background Atmosphere */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-slate-100 to-violet-50 pointer-events-none"></div>
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-200/20 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-white/80 to-transparent pointer-events-none z-10"></div>

            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-xl flex items-end pb-3 px-6 border-b border-white/40 shrink-0 sticky top-0 z-20 shadow-sm">
                <div className="flex justify-between items-center w-full">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-slate-700 text-lg tracking-wide flex items-center gap-2">
                        <DiamondsFour size={18} className="text-indigo-500" /> 世界书
                    </span>
                    <button onClick={handleCreate} className="w-9 h-9 bg-indigo-500 text-white rounded-full shadow-lg shadow-indigo-200 flex items-center justify-center active:scale-90 transition-transform hover:bg-indigo-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    </button>
                </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-5 pb-24 space-y-4 no-scrollbar relative z-0">
                {Object.keys(groupedBooks).length === 0 && (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4 opacity-60">
                        <BookOpen size={48} className="text-slate-400" />
                        <span className="text-xs font-medium">世界还是空白的...</span>
                    </div>
                )}

                {Object.entries(groupedBooks).map(([category, books]) => (
                    <div key={category} className="animate-slide-up">
                        {/* Category Header */}
                        <div 
                            onClick={() => toggleCategory(category)}
                            className="flex items-center gap-2 py-2 px-1 cursor-pointer select-none group"
                        >
                            <div className={`transition-transform duration-300 ${expandedCategory === category ? 'rotate-90' : ''}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400 group-hover:text-indigo-500"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                            </div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider group-hover:text-indigo-600 transition-colors">{category}</h3>
                            <span className="text-[9px] bg-white/50 px-1.5 rounded text-slate-400 border border-white/50">{books.length}</span>
                        </div>

                        {/* Group Items */}
                        <div className={`space-y-3 pl-2 transition-all duration-300 overflow-hidden ${expandedCategory === category ? 'max-h-[1000px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                            {books.map(book => (
                                <div key={book.id} className="bg-white/60 backdrop-blur-md rounded-2xl border border-white/60 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                                    {/* Item Header */}
                                    <div 
                                        onClick={() => togglePreview(book.id)}
                                        className="p-4 cursor-pointer flex justify-between items-start"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className={`w-1.5 h-1.5 rounded-full ${previewBookId === book.id ? 'bg-indigo-400' : 'bg-slate-300'}`}></div>
                                                <h4 className={`text-sm font-bold truncate transition-colors ${previewBookId === book.id ? 'text-indigo-700' : 'text-slate-700'}`}>{book.title}</h4>
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-mono pl-3.5">
                                                Updated: {new Date(book.updatedAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleEdit(book); }} 
                                                className="p-2 rounded-full hover:bg-white text-slate-400 hover:text-indigo-600 transition-colors"
                                                title="编辑"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                            </button>
                                            <button 
                                                onClick={(e) => requestDelete(e, book)} 
                                                className="p-2 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                                                title="删除"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded Content Preview */}
                                    {previewBookId === book.id && (
                                        <div className="px-4 pb-4 pt-0 animate-fade-in">
                                            <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-3"></div>
                                            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap font-light select-text">
                                                {book.content || <span className="italic text-slate-400">暂无内容...</span>}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Delete Confirmation Modal */}
            <Modal 
                isOpen={showDeleteConfirm} 
                title="删除确认" 
                onClose={() => setShowDeleteConfirm(false)}
                footer={
                    <div className="flex gap-3 w-full">
                        <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:scale-95 transition-transform">取消</button>
                        <button onClick={confirmDelete} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200 active:scale-95 transition-transform">确认删除</button>
                    </div>
                }
            >
                <div className="text-center py-4 text-sm text-slate-600 flex flex-col items-center gap-3">
                    <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-1">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                    </div>
                    <div>
                        确定要删除 <span className="font-bold text-slate-900">"{editingBook?.title}"</span> 吗？
                        <br/><span className="text-xs text-red-400 opacity-80 mt-1 block">此操作无法撤销。</span>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default WorldbookApp;