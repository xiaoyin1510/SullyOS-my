
import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, SocialPost, SocialComment, SubAccount, SocialAppProfile } from '../types';
import { ContextBuilder } from '../utils/context';
import { processImage } from '../utils/file';
import Modal from '../components/os/Modal';
import { safeResponseJson } from '../utils/safeApi';
import { House, User, Package, Warning } from '@phosphor-icons/react';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;

const STICKER_OPTIONS = [
    { code: '2728', label: 'sparkles' },
    { code: '1f388', label: 'balloon' },
    { code: '1f3a8', label: 'palette' },
    { code: '1f4f7', label: 'camera' },
    { code: '1f3b5', label: 'music' },
    { code: '1f3ae', label: 'game' },
    { code: '1f354', label: 'burger' },
    { code: '1f3d6-fe0f', label: 'beach' },
    { code: '1f4a4', label: 'sleep' },
    { code: '1f4a1', label: 'idea' },
];

// --- Constants & Styles ---
const BRAND_COLOR = '#ff2442'; // Premium Red

// Advanced Gradients for "Image" backgrounds
const POST_STYLES = [
    { name: 'Sunset', bg: 'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 99%, #FECFEF 100%)', text: '#fff' },
    { name: 'Ocean', bg: 'linear-gradient(120deg, #89f7fe 0%, #66a6ff 100%)', text: '#fff' },
    { name: 'Peach', bg: 'linear-gradient(to top, #fff1eb 0%, #ace0f9 100%)', text: '#555' },
    { name: 'Night', bg: 'linear-gradient(to top, #30cfd0 0%, #330867 100%)', text: '#fff' },
    { name: 'Love', bg: 'linear-gradient(to top, #f43b47 0%, #453a94 100%)', text: '#fff' },
    { name: 'Fresh', bg: 'linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)', text: '#444' },
    { name: 'Lemon', bg: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', text: '#fff' },
    { name: 'Plum', bg: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)', text: '#fff' },
];

const getRandomStyle = () => POST_STYLES[Math.floor(Math.random() * POST_STYLES.length)];

// --- Robust JSON Parser ---
const safeParseJSON = (input: string) => {
    const clean = input.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        const parsed = JSON.parse(clean);
        if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
            const keys = Object.keys(parsed);
            if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
                return parsed[keys[0]];
            }
        }
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        try {
            const start = clean.indexOf('[');
            if (start === -1) return [];
            let end = clean.lastIndexOf('}');
            while (end > start) {
                const attempt = clean.substring(start, end + 1) + ']';
                try {
                    const result = JSON.parse(attempt);
                    if (Array.isArray(result)) return result;
                } catch (err) {}
                end = clean.lastIndexOf('}', end - 1);
            }
            return [];
        } catch (e2) {
            return [];
        }
    }
};

// --- Icons ---

const Icons = {
    Heart: ({ filled, onClick, className }: { filled?: boolean, onClick?: (e: any) => void, className?: string }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? BRAND_COLOR : "none"} stroke={filled ? BRAND_COLOR : "currentColor"} strokeWidth={2} className={`transition-transform active:scale-75 cursor-pointer ${className || "w-6 h-6"}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
        </svg>
    ),
    Star: ({ filled, onClick, className }: { filled?: boolean, onClick?: (e: any) => void, className?: string }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? "#fbbf24" : "none"} stroke={filled ? "#fbbf24" : "currentColor"} strokeWidth={2} className={`transition-transform active:scale-75 cursor-pointer ${className || "w-6 h-6"}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.563.563 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.563.563 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
        </svg>
    ),
    Share: ({ className, onClick }: { className?: string, onClick?: () => void }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className || "w-6 h-6"}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
        </svg>
    ),
    ChatBubble: ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className || "w-6 h-6"}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
        </svg>
    ),
    Back: ({ onClick, className }: { onClick: () => void, className?: string }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={className || "w-6 h-6 cursor-pointer text-slate-800"}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
    ),
    Plus: ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={className || "w-6 h-6"}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
    ),
    Pencil: ({ className, onClick }: { className?: string, onClick?: () => void }) => (
        <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className || "w-4 h-4"}>
            <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
        </svg>
    )
};

// --- Main App ---

const SocialApp: React.FC = () => {
    const { closeApp, characters, updateCharacter, apiConfig, addToast, userProfile, groups } = useOS();
    const [feed, setFeed] = useState<SocialPost[]>([]);
    // Modes: 'home' (Feed) | 'me' (Profile) | 'create' (Modal Overlay)
    const [activeTab, setActiveTab] = useState<'home' | 'me'>('home');
    const [isCreateOpen, setIsCreateOpen] = useState(false); 
    
    const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [loadingComments, setLoadingComments] = useState(false);
    
    // Post Creation State
    const [newPostTitle, setNewPostTitle] = useState('');
    const [newPostContent, setNewPostContent] = useState('');
    const [newPostEmoji, setNewPostEmoji] = useState('2728');

    // Comment Input State
    const [commentInput, setCommentInput] = useState('');
    const [isReplyingToUser, setIsReplyingToUser] = useState(false);

    // Settings / Handle Management
    const [showSettings, setShowSettings] = useState(false);
    const [characterHandles, setCharacterHandles] = useState<Record<string, SubAccount[]>>({});

    // Sharing State
    const [showShareModal, setShowShareModal] = useState(false);

    // Profile Sub-tab
    const [profileTab, setProfileTab] = useState<'notes' | 'collects'>('notes');

    // User Custom Profile State (Local - Decoupled from Global UserProfile)
    const [socialProfile, setSocialProfile] = useState<SocialAppProfile>({
        name: userProfile.name,
        avatar: userProfile.avatar,
        bio: '这个人很懒，什么都没写。'
    });
    const [userSparkId, setUserSparkId] = useState('95279527');
    const [userBgImage, setUserBgImage] = useState('');
    const [isEditingId, setIsEditingId] = useState(false);
    
    const userBgInputRef = useRef<HTMLInputElement>(null);
    const socialAvatarInputRef = useRef<HTMLInputElement>(null);

    // Refs
    const commentsEndRef = useRef<HTMLDivElement>(null);
    const detailScrollRef = useRef<HTMLDivElement>(null);
    const prevCommentCountRef = useRef(0); // Track comment count to prevent initial jump

    useEffect(() => {
        DB.getSocialPosts().then(posts => {
            if (posts.length > 0) {
                setFeed(posts.sort((a,b) => b.timestamp - a.timestamp));
            }
        });
        
        // Load User Config & Social Profile from DB assets and LocalStorage (hybrid migration)
        const loadAssets = async () => {
            const savedUserId = localStorage.getItem('spark_user_id');
            // Try load from DB first
            const dbBg = await DB.getAsset('spark_user_bg');
            const dbProfileStr = await DB.getAsset('spark_social_profile');
            
            // Fallback to localStorage if DB missing (Legacy migration)
            const lsBg = localStorage.getItem('spark_user_bg');
            const lsProfileStr = localStorage.getItem('spark_social_profile');

            if (savedUserId) setUserSparkId(savedUserId);
            
            if (dbBg) {
                setUserBgImage(dbBg);
            } else if (lsBg) {
                // Migrate to DB
                setUserBgImage(lsBg);
                await DB.saveAsset('spark_user_bg', lsBg);
                localStorage.removeItem('spark_user_bg');
            }
            
            let loadedProfile = null;
            if (dbProfileStr) {
                try { loadedProfile = JSON.parse(dbProfileStr); } catch(e) {}
            } else if (lsProfileStr) {
                try { loadedProfile = JSON.parse(lsProfileStr); } catch(e) {}
                // Migrate to DB
                if (loadedProfile) {
                    await DB.saveAsset('spark_social_profile', lsProfileStr!);
                    localStorage.removeItem('spark_social_profile');
                }
            }

            if (loadedProfile) {
                setSocialProfile(loadedProfile);
            } else {
                // Initial fallback to global user profile only once
                setSocialProfile({
                    name: userProfile.name,
                    avatar: userProfile.avatar,
                    bio: userProfile.bio || '这个人很懒，什么都没写。'
                });
            }
        };
        loadAssets();

        // Load Handles
        const savedHandles = localStorage.getItem('spark_char_handles');
        let initialHandles: Record<string, SubAccount[]> = {};
        if (savedHandles) {
            try { initialHandles = JSON.parse(savedHandles); } catch(e) {}
        }
        
        // Ensure every character has at least one default handle
        characters.forEach(c => {
            if (!initialHandles[c.id] || initialHandles[c.id].length === 0) {
                initialHandles[c.id] = [{ 
                    id: 'default', 
                    handle: c.socialProfile?.handle || c.name, 
                    note: '主账号' 
                }];
            }
        });
        setCharacterHandles(initialHandles);

    }, [characters.length]);

    // Save Handles to LocalStorage whenever updated
    useEffect(() => {
        if (Object.keys(characterHandles).length > 0) {
            localStorage.setItem('spark_char_handles', JSON.stringify(characterHandles));
        }
    }, [characterHandles]);

    // FIX: Only scroll to bottom if comment count INCREASES, not on initial load
    // This prevents the "jumping" behavior when opening a post
    useEffect(() => {
        if (selectedPost) {
            const currentCount = selectedPost.comments.length;
            if (currentCount > prevCommentCountRef.current) {
                // New comment added: only scroll the internal detail panel.
                // Avoid scrollIntoView(), which can scroll outer containers and shift the whole app layout.
                const detailScroller = detailScrollRef.current;
                if (detailScroller) {
                    detailScroller.scrollTo({
                        top: detailScroller.scrollHeight,
                        behavior: 'smooth'
                    });
                }
            }
            prevCommentCountRef.current = currentCount;
        } else {
            prevCommentCountRef.current = 0; // Reset
        }
    }, [selectedPost?.comments.length]);

    // --- Helpers ---

    const addSubAccount = (charId: string) => {
        const newAcct: SubAccount = {
            id: `sub-${Date.now()}`,
            handle: '新马甲',
            note: '身份备注'
        };
        setCharacterHandles(prev => ({
            ...prev,
            [charId]: [...(prev[charId] || []), newAcct]
        }));
    };

    const updateSubAccount = (charId: string, acctId: string, field: keyof SubAccount, value: string) => {
        setCharacterHandles(prev => ({
            ...prev,
            [charId]: prev[charId].map(a => a.id === acctId ? { ...a, [field]: value } : a)
        }));
    };

    const deleteSubAccount = (charId: string, acctId: string) => {
        setCharacterHandles(prev => ({
            ...prev,
            [charId]: prev[charId].filter(a => a.id !== acctId)
        }));
    };

    const handleUserBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await processImage(file, { skipCompression: true });
                setUserBgImage(base64);
                // Save to DB Assets
                await DB.saveAsset('spark_user_bg', base64);
                addToast('背景图已更新', 'success');
            } catch (err) {
                addToast('图片处理失败', 'error');
            }
        }
    };

    const handleSocialAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await processImage(file);
                setSocialProfile(prev => ({ ...prev, avatar: base64 }));
            } catch (err: any) {
                addToast(err.message, 'error');
            }
        }
    };

    const saveUserProfileChanges = async () => {
        localStorage.setItem('spark_user_id', userSparkId);
        // Save Profile to DB Assets (contains base64 avatar)
        await DB.saveAsset('spark_social_profile', JSON.stringify(socialProfile));
        setIsEditingId(false);
        addToast('主页资料已保存 (仅在 Spark 生效)', 'success');
    };

    const persistFeed = (newFeed: SocialPost[]) => {
        setFeed(newFeed);
        Promise.all(newFeed.map(p => DB.saveSocialPost(p))).catch(console.error);
    };

    const updatePostInFeed = (post: SocialPost) => {
        setFeed(prev => {
            const next = prev.map(p => p.id === post.id ? post : p);
            DB.saveSocialPost(post);
            return next;
        });
        setSelectedPost(current => (current?.id === post.id ? post : current));
    };

    const removePostFromFeed = (postId: string) => {
        setFeed(prev => {
            const next = prev.filter(p => p.id !== postId);
            DB.deleteSocialPost(postId);
            return next;
        });
        setSelectedPost(current => (current?.id === postId ? null : current));
    };

    // --- AI Logic (Updated for Multi-Handle) ---
    const handleRefresh = async () => {
        if (!apiConfig.apiKey) { addToast('请配置 API Key', 'error'); return; }
        setIsRefreshing(true);
        try {
            const shuffledChars = [...characters].sort(() => 0.5 - Math.random());
            const selectedChars = shuffledChars.slice(0, Math.min(3, characters.length));
            
            // Build Character Map with Multiple Handles Info
            let charContexts = "";
            let identityMap = "### 角色身份表 (Identities)\n";

            for (const char of selectedChars) {
                const coreContext = ContextBuilder.buildCoreContext(char, userProfile, false);
                const msgs = await DB.getMessagesByCharId(char.id);
                const recentStatus = msgs.length > 0 ? `(最近私聊状态: 刚和用户聊过 "${msgs[msgs.length-1].content.substring(0, 20)}...")` : '(最近无私聊，生活平淡)';
                
                const handles = characterHandles[char.id] || [];
                const handleList = handles.map(h => `- 网名: "${h.handle}" (备注: ${h.note})`).join('\n');
                
                identityMap += `\n角色 [${char.name}] 可用账号:\n${handleList}\n`;
                charContexts += `\n<<< 角色档案: ${char.name} >>>\n${coreContext}\n${recentStatus}\n<<< 档案结束 >>>\n`;
            }

            const prompt = `### 任务: 模拟社交APP "Spark" 的推荐流
你需要生成 6-8 条新的社交媒体帖子。

### 🎭 内容构成 (混合模式)
1. **角色发帖 (30%)**: 
   - 选中的角色: ${selectedChars.map(c => c.name).join(', ')}
   - **关键规则**: 每个角色有多个马甲(账号)。请根据内容需要，选择最合适的账号身份发帖。
   - 例如：如果是吐槽，可能用小号；如果是发美照，用大号。请务必使用 **Configured Handle (网名)**。
   - **内容方向**: 公开发言，生活日常、吐槽、或者暗戳戳的记录。

2. **路人/网友发帖 (70%)**: 
   - 模拟真实的互联网生态：吃瓜群众、技术宅、美妆博主、情感树洞。

### 身份配置
${identityMap}

### 🚫 绝对禁令
1. **禁止扮演用户**: 绝对禁止生成作者名为 "${socialProfile.name}" (用户) 的帖子。
2. **禁止上帝视角**。

### 输入上下文
${charContexts}

### 输出格式 (JSON Array)
[
  {
    "isCharacter": true/false,
    "charId": "如果是角色填ID, 否则null", 
    "authorName": "必须填身份表中定义的【网名】",
    "title": "简短吸睛的标题",
    "content": "正文内容...",
    "emojis": ["🎈", "✨"],
    "likes": 随机数 (0 - 10000)
  },
  ...
]`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }], temperature: 0.95, max_tokens: 8000 })
            });
            if (!response.ok) throw new Error('API Error');
            const data = await safeResponseJson(response);
            const json = safeParseJSON(data.choices[0].message.content);
            if (!Array.isArray(json)) throw new Error('Parsed data is not an array');
            
            const newPosts: SocialPost[] = json.map((item: any) => {
                let avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${item.authorName}`;
                if (item.isCharacter) {
                    // Try to find matching char by ID first, then by Handle match
                    const c = characters.find(char => char.id === item.charId) || characters.find(char => {
                        const handles = characterHandles[char.id] || [];
                        return handles.some(h => h.handle === item.authorName);
                    });
                    if (c) avatar = c.avatar;
                } else {
                    const seeds = ['micah', 'avataaars', 'bottts', 'notionists'];
                    avatar = `https://api.dicebear.com/7.x/${seeds[Math.floor(Math.random() * seeds.length)]}/svg?seed=${item.authorName + Math.random()}`;
                }
                return {
                    id: `post-${Date.now()}-${Math.random()}`,
                    authorName: item.authorName || 'Unknown',
                    authorAvatar: avatar,
                    title: item.title || '无标题',
                    content: item.content || '...',
                    images: item.emojis || ['2728'],
                    likes: item.likes || 0,
                    isCollected: false,
                    isLiked: false,
                    comments: [],
                    timestamp: Date.now(),
                    tags: ['Life', 'Vlog'],
                    bgStyle: getRandomStyle().bg
                };
            });
            const updatedFeed = [...newPosts, ...feed];
            persistFeed(updatedFeed);
            addToast('首页已刷新: 冲浪模式开启', 'success');
        } catch (e: any) { addToast('刷新失败: ' + e.message, 'error'); } finally { setIsRefreshing(false); }
    };

    const generateComments = async (post: SocialPost) => {
        if (!post || post.comments.length > 0 || !apiConfig.apiKey) return;
        setLoadingComments(true);
        try {
            const shuffledChars = [...characters].sort(() => 0.5 - Math.random());
            const selectedChars = shuffledChars.slice(0, 2);
            
            let identityMap = "";
            for (const char of selectedChars) {
                const handles = characterHandles[char.id] || [];
                const hList = handles.map(h => `"${h.handle}" (${h.note})`).join(', ');
                identityMap += `- 角色 ${char.name} 可用身份: ${hList}\n`;
            }

            let contextPrompt = "";
            for (const char of selectedChars) {
                contextPrompt += `\n<<< 评论者角色: ${char.name} >>>\n${ContextBuilder.buildCoreContext(char, userProfile, false)}\n`;
            }
            
            let authorType = "Stranger";
            if (post.authorName === socialProfile.name) authorType = "User";
            else { 
                const c = characters.find(ch => {
                    const handles = characterHandles[ch.id] || [];
                    return handles.some(h => h.handle === post.authorName);
                });
                if (c) authorType = `Character "${c.name}"`; 
            }

            const prompt = `### 任务: 模拟社交APP评论区
**帖子来源**: "Spark" 社区
**楼主**: "${post.authorName}" (${authorType})
**帖子**: "${post.title}"

请生成 4-6 条评论。混合使用 **选定角色** 和 **随机路人**。
角色评论时，请选择一个符合语境的马甲身份。

### 角色身份库
${identityMap}

### 禁令
- **绝对禁止** 生成署名为 "${socialProfile.name}" 的评论。

### 输入上下文
${contextPrompt}

### 输出格式 (JSON Array)
[
  { "author": "网名 (Handle) 或 路人昵称", "content": "评论内容..." }
]`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }], temperature: 0.8 })
            });
            if (response.ok) {
                const data = await safeResponseJson(response);
                const json = safeParseJSON(data.choices[0].message.content);
                if (Array.isArray(json)) {
                    const comments: SocialComment[] = json.map((c: any) => {
                        const authorName = c.author || c.authorName || 'Unknown';
                        let avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${authorName}`;
                        
                        // Check if char
                        const char = characters.find(ch => {
                            const handles = characterHandles[ch.id] || [];
                            return handles.some(h => h.handle === authorName);
                        });

                        if (char) avatar = char.avatar;
                        return { id: `cmt-${Math.random()}`, authorName: authorName, authorAvatar: avatar, content: c.content || '...', likes: Math.floor(Math.random() * 100), isCharacter: !!char };
                    });
                    updatePostInFeed({ ...post, comments });
                }
            }
        } catch (e: any) { addToast("评论加载失败", "error"); } finally { setLoadingComments(false); }
    };

    const generateRepliesToUser = async (post: SocialPost, userContent: string) => {
        if (!apiConfig.apiKey) return;
        setIsReplyingToUser(true);
        try {
            // Simplified handle map for replies
            let identityMap = "";
            characters.forEach(char => {
                const handles = characterHandles[char.id] || [];
                const hList = handles.map(h => `"${h.handle}"`).join(', ');
                identityMap += `- ${char.name}: ${hList}\n`;
            });

            const prompt = `### 任务: 回复用户的评论
**场景**: 用户 "${socialProfile.name}" 在帖子下发了一条评论: "${userContent}"。
**帖子**: "${post.title}"
请生成 1-3 条对用户评论的回复。
${identityMap}

### 输出格式 (JSON Array)
[
  { "author": "网名 (Handle)", "content": "回复内容..." }
]`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }], temperature: 0.9 })
            });
            if (response.ok) {
                const data = await safeResponseJson(response);
                const json = safeParseJSON(data.choices[0].message.content);
                if (Array.isArray(json)) {
                    const newReplies: SocialComment[] = json.map((c: any) => {
                        const authorName = c.author || c.authorName || 'Unknown';
                        let avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${authorName}`;
                        
                        const char = characters.find(ch => {
                            const handles = characterHandles[ch.id] || [];
                            return handles.some(h => h.handle === authorName);
                        });

                        if (char) avatar = char.avatar;
                        return { id: `cmt-reply-${Date.now()}-${Math.random()}`, authorName: authorName, authorAvatar: avatar, content: `回复 @${socialProfile.name}: ${c.content}`, likes: Math.floor(Math.random() * 10) };
                    });
                    if (newReplies.length > 0) {
                        updatePostInFeed({ ...post, comments: [...(post.comments || []), ...newReplies] });
                        addToast(`收到 ${newReplies.length} 条新回复`, 'info');
                    }
                }
            }
        } catch (e) {} finally { setIsReplyingToUser(false); }
    };

    const handleShare = async (targetId: string, isGroup: boolean) => {
        if (!selectedPost) return;
        try {
            await DB.saveMessage({ charId: isGroup ? 'user' : targetId, groupId: isGroup ? targetId : undefined, role: 'user', type: 'social_card', content: '[分享帖子]', metadata: { post: selectedPost } });
            setShowShareModal(false);
            addToast('分享成功', 'success');
        } catch (e) { addToast('分享失败', 'error'); }
    };

    const handleCreatePost = () => {
        if (!newPostContent.trim()) return;
        const post: SocialPost = { 
            id: `user-post-${Date.now()}`, 
            authorName: socialProfile.name, // Use Local Identity
            authorAvatar: socialProfile.avatar, // Use Local Identity
            title: newPostTitle || '无标题', 
            content: newPostContent, 
            images: [newPostEmoji], 
            likes: 0, 
            isCollected: false, 
            isLiked: false, 
            comments: [], 
            timestamp: Date.now(), 
            tags: ['User'], 
            bgStyle: getRandomStyle().bg 
        };
        persistFeed([post, ...feed]);
        setNewPostContent(''); setNewPostTitle(''); 
        setIsCreateOpen(false); // Close Modal
        setActiveTab('home'); 
        addToast('发布成功', 'success');
    };

    const handleDeletePost = (postId: string) => { removePostFromFeed(postId); addToast('帖子已删除', 'success'); };
    const handleLike = (e: any, post: SocialPost) => { e.stopPropagation(); updatePostInFeed({ ...post, isLiked: !post.isLiked, likes: post.isLiked ? post.likes - 1 : post.likes + 1 }); };
    
    const handleSendComment = async () => { 
        if (!selectedPost || !commentInput.trim()) return; 
        
        const updatedPost = { 
            ...selectedPost, 
            comments: [...(selectedPost.comments || []), { 
                id: `cmt-user-${Date.now()}`, 
                authorName: socialProfile.name, // Use Local Identity
                authorAvatar: socialProfile.avatar, // Use Local Identity
                content: commentInput.trim(), 
                likes: 0, 
                isCharacter: false 
            }] 
        }; 
        
        updatePostInFeed(updatedPost); 
        const contentToSend = commentInput; 
        setCommentInput(''); 
        await generateRepliesToUser(updatedPost, contentToSend); 
    };
    
    const handleClearFeed = () => { DB.clearSocialPosts(); setFeed([]); setShowSettings(false); addToast('推荐流已清空', 'success'); };

    // --- Renderers ---

    // 1. Feed Item (Glassmorphism)
    const renderFeedItem = (post: SocialPost) => (
        <div key={post.id} onClick={() => { setSelectedPost(post); generateComments(post); }} className="break-inside-avoid mb-3 bg-white/70 backdrop-blur-md rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer active:scale-[0.98] border border-white/50 relative group">
            <div className="aspect-[4/5] w-full flex items-center justify-center relative overflow-hidden" style={{ background: post.bgStyle }}>
                {/* Decorative Overlay for "Premium" look */}
                <div className="absolute inset-0 bg-white/5 backdrop-blur-[1px]"></div>
                <div className="relative z-10 text-6xl drop-shadow-xl filter saturate-150 transform transition-transform group-hover:scale-110 duration-500">{post.images[0]}</div>
                {post.title && (
                    <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-black/50 via-black/20 to-transparent">
                        <h3 className="text-white font-bold text-sm line-clamp-2 drop-shadow-md leading-tight">{post.title}</h3>
                    </div>
                )}
            </div>
            <div className="p-3">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2 min-w-0">
                        <img src={post.authorAvatar} className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-white/50" />
                        <span className="text-[11px] text-slate-700 truncate font-medium">{post.authorName}</span>
                    </div>
                    <div className="flex items-center gap-1 text-slate-400 group-hover:text-slate-600 transition-colors">
                        <Icons.Heart filled={post.isLiked} className="w-4 h-4" onClick={(e) => handleLike(e, post)} />
                        <span className="text-[10px] font-medium">{post.likes}</span>
                    </div>
                </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); handleDeletePost(post.id); }} className="absolute top-2 right-2 z-20 w-6 h-6 bg-black/20 text-white rounded-full flex items-center justify-center text-xs backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80">×</button>
        </div>
    );

    // 2. Detail Overlay (Glassmorphism)
    // FIX: Using a fixed container for backdrop to prevent layout gaps.
    // REMOVED 'key={selectedPost.id}' to prevent re-mounting jitter.
    // SEPARATED scrollable container from animation wrapper.
    const renderDetail = () => {
        if (!selectedPost) return null;
        return (
            <div 
                className="absolute inset-0 z-[60] h-full w-full bg-white/90 backdrop-blur-xl flex flex-col"
            >
                {/* 
                   Animation Wrapper. 
                   We want the whole overlay content to slide up. 
                   We ensure this doesn't re-render on state changes like comments.
                */}
                <div className="flex-1 w-full h-full flex flex-col animate-slide-up relative overflow-hidden">
                    {/* Header - Shrink 0 to stay at top, with safe-area for notch devices */}
                    <div className="flex items-center justify-between px-4 bg-white/60 backdrop-blur-xl border-b border-white/20 shrink-0 relative z-20" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: '12px' }}>
                        <button onClick={() => setSelectedPost(null)} className="p-2 -m-2 active:opacity-60"><Icons.Back onClick={() => setSelectedPost(null)} /></button>
                        <div className="flex items-center gap-2">
                            <img src={selectedPost.authorAvatar} className="w-8 h-8 rounded-full object-cover border border-white/50" />
                            <span className="text-sm font-bold text-slate-800">{selectedPost.authorName}</span>
                        </div>
                        <button onClick={() => setShowShareModal(true)} className="p-2 -m-2 active:opacity-60"><Icons.Share onClick={() => setShowShareModal(true)} className="w-6 h-6 text-slate-800 cursor-pointer hover:text-[#ff2442]" /></button>
                    </div>

                    {/* Scrollable Area */}
                    <div ref={detailScrollRef} className="flex-1 overflow-y-auto no-scrollbar pb-24">
                        {/* Main Visual */}
                        <div className="w-full aspect-square flex items-center justify-center text-[8rem] relative overflow-hidden" style={{ background: selectedPost.bgStyle }}>
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/10"></div>
                            {/* Removed animate-bounce-slow to prevent reflow jitter */}
                            <div className="relative z-10 drop-shadow-2xl filter saturate-125">{selectedPost.images[0]}</div>
                        </div>

                        <div className="p-6 space-y-4">
                            <h1 className="text-2xl font-black text-slate-900 leading-snug tracking-tight">{selectedPost.title}</h1>
                            <p className="text-[15px] text-slate-700 leading-relaxed whitespace-pre-wrap font-light">{selectedPost.content}</p>
                            
                            <div className="flex gap-2 flex-wrap pt-2">
                                {selectedPost.tags.map(t => <span key={t} className="text-xs font-bold text-blue-600 bg-blue-50/50 backdrop-blur-sm border border-blue-100 px-2.5 py-1 rounded-full">#{t}</span>)}
                            </div>
                            <div className="text-xs text-slate-400 font-medium border-b border-slate-100/50 pb-6">{new Date(selectedPost.timestamp).toLocaleDateString()}</div>
                        </div>

                        {/* Comments Section */}
                        <div className="px-6 pb-6">
                            <div className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                                <span>共 {selectedPost.comments.length} 条评论</span>
                                {(loadingComments || isReplyingToUser) && <div className="w-3 h-3 border-2 border-slate-300 border-t-[#ff2442] rounded-full animate-spin"></div>}
                            </div>
                            
                            <div className="space-y-6">
                                {selectedPost.comments.length === 0 && !loadingComments && <div className="text-center text-slate-300 text-xs py-10">快来抢沙发...</div>}
                                {selectedPost.comments.map(c => (
                                    <div key={c.id} className="flex gap-3 animate-fade-in group">
                                        <img src={c.authorAvatar} className="w-9 h-9 rounded-full object-cover shrink-0 border border-slate-100" />
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start">
                                                <span className={`text-xs font-bold ${c.isCharacter ? 'text-slate-800' : 'text-slate-500'}`}>{c.authorName}</span>
                                                <div className="flex items-center gap-1 text-slate-400 cursor-pointer hover:text-[#ff2442]">
                                                    <Icons.Heart filled={false} className="w-3.5 h-3.5" />
                                                    <span className="text-[10px]">{c.likes}</span>
                                                </div>
                                            </div>
                                            <p className="text-[13px] text-slate-700 mt-0.5 leading-normal font-light">{c.content}</p>
                                        </div>
                                    </div>
                                ))}
                                <div ref={commentsEndRef} />
                            </div>
                        </div>
                    </div>

                    {/* Bottom Input Bar - Absolute to sit on top of scroll area at bottom */}
                    <div className="absolute bottom-0 w-full pb-[env(safe-area-inset-bottom)] z-30 pointer-events-none">
                         <div className="pointer-events-auto h-16 bg-white/80 backdrop-blur-xl border-t border-white/40 px-4 flex items-center justify-between gap-4 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
                            <div className="flex-1 bg-slate-100/50 rounded-full px-5 py-2.5 flex items-center gap-2 focus-within:bg-white focus-within:ring-1 focus-within:ring-slate-200 transition-all border border-transparent focus-within:border-slate-200">
                                <input 
                                    value={commentInput}
                                    onChange={(e) => setCommentInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSendComment()}
                                    placeholder="说点什么..."
                                    className="bg-transparent text-sm w-full outline-none text-slate-800 placeholder:text-slate-400"
                                />
                                {commentInput.trim() && <button onClick={handleSendComment} className="text-[#ff2442] font-bold text-sm animate-fade-in">发送</button>}
                            </div>
                            <div className="flex gap-5 text-slate-600 shrink-0 items-center">
                                <div className="flex flex-col items-center gap-0.5">
                                    <Icons.Heart filled={selectedPost.isLiked} onClick={(e) => handleLike(e, selectedPost)} className="w-6 h-6" />
                                    <span className="text-[10px] font-medium">{selectedPost.likes}</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                    <Icons.Star filled={selectedPost.isCollected} onClick={() => updatePostInFeed({...selectedPost, isCollected: !selectedPost.isCollected})} className="w-6 h-6" />
                                    <span className="text-[10px] font-medium">{selectedPost.isCollected ? '已收藏' : '收藏'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        // Main Container with Premium Gradient Background
        <div className="h-full w-full bg-gradient-to-br from-rose-50 via-slate-50 to-teal-50 flex flex-col font-sans relative text-slate-900 overflow-hidden">
            
            {/* --- Modals (Settings, Share) --- */}
            <Modal isOpen={showSettings} title="身份管理" onClose={() => setShowSettings(false)}>
                <div className="space-y-6">
                    <div className="max-h-[50vh] overflow-y-auto no-scrollbar space-y-6 px-1">
                        <p className="text-xs text-slate-400 bg-slate-50 p-2 rounded-lg">
                            为角色添加“马甲”(Sub-Accounts)。AI 发帖时会根据内容选择合适的身份。
                        </p>
                        {characters.map(c => (
                            <div key={c.id} className="space-y-3 pb-4 border-b border-slate-50">
                                <div className="flex items-center gap-2">
                                    <img src={c.avatar} className="w-6 h-6 rounded-full object-cover" />
                                    <span className="text-sm font-bold text-slate-700">{c.name}</span>
                                    <button onClick={() => addSubAccount(c.id)} className="ml-auto text-[10px] bg-[#ff2442] text-white px-2 py-1 rounded-full shadow-sm active:scale-95 transition-transform">+ 添加马甲</button>
                                </div>
                                
                                <div className="space-y-2 pl-4 border-l-2 border-slate-100">
                                    {(characterHandles[c.id] || []).map((acct) => (
                                        <div key={acct.id} className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm space-y-2 relative group">
                                            <div className="flex gap-2">
                                                <div className="flex-1">
                                                    <label className="text-[9px] text-slate-400 uppercase font-bold">网名 (Handle)</label>
                                                    <input 
                                                        value={acct.handle} 
                                                        onChange={(e) => updateSubAccount(c.id, acct.id, 'handle', e.target.value)} 
                                                        className="w-full text-sm font-bold text-slate-800 border-b border-dashed border-slate-200 focus:border-[#ff2442] outline-none py-1" 
                                                    />
                                                </div>
                                                <button 
                                                    onClick={() => deleteSubAccount(c.id, acct.id)}
                                                    className="text-slate-300 hover:text-red-400 p-1"
                                                    title="删除"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                            <div>
                                                <label className="text-[9px] text-slate-400 uppercase font-bold">备注 (Context Note)</label>
                                                <input 
                                                    value={acct.note} 
                                                    onChange={(e) => updateSubAccount(c.id, acct.id, 'note', e.target.value)} 
                                                    placeholder="例如: 吐槽号 / 认真模式"
                                                    className="w-full text-xs text-slate-500 bg-slate-50 rounded px-2 py-1 focus:bg-white transition-colors outline-none" 
                                                />
                                            </div>
                                        </div>
                                    ))}
                                    {(characterHandles[c.id]?.length || 0) === 0 && (
                                        <div className="text-[10px] text-red-400 italic flex items-center gap-1"><Warning size={12} weight="bold" /> 请至少保留一个身份</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button onClick={handleClearFeed} className="flex-1 py-3 bg-white border border-slate-200 text-slate-500 font-bold rounded-xl text-xs active:bg-slate-50">清空推荐流</button>
                        <button onClick={() => setShowSettings(false)} className="flex-1 py-3 bg-[#ff2442] text-white font-bold rounded-xl text-xs shadow-lg shadow-red-200 active:scale-95 transition-transform">完成</button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={showShareModal} title="分享帖子" onClose={() => setShowShareModal(false)}>
                <div className="grid grid-cols-4 gap-4 p-2">
                    {characters.map(c => (
                        <button key={c.id} onClick={() => handleShare(c.id, false)} className="flex flex-col items-center gap-2 group">
                            <img src={c.avatar} className="w-12 h-12 rounded-full object-cover border border-slate-100 group-active:scale-90 transition-transform" />
                            <span className="text-[10px] text-slate-600 truncate w-full text-center">{c.name}</span>
                        </button>
                    ))}
                </div>
            </Modal>

            {/* --- Create Post Modal (Full Screen Overlay) --- */}
            {isCreateOpen && (
                <div className="absolute inset-0 z-50 bg-white flex flex-col animate-slide-up">
                    {/* Create Header */}
                    <div className="h-14 flex items-center justify-between px-4 bg-white sticky top-0 z-20 border-b border-slate-50">
                        <button onClick={() => setIsCreateOpen(false)} className="text-slate-600 text-sm font-bold px-2 py-1">取消</button>
                        <span className="text-sm font-bold text-slate-800">发布笔记</span>
                        <button 
                            onClick={handleCreatePost} 
                            disabled={!newPostContent.trim()}
                            className={`px-4 py-1.5 rounded-full text-xs font-bold text-white transition-all ${newPostContent.trim() ? 'bg-[#ff2442] shadow-md shadow-red-200' : 'bg-slate-200 text-slate-400'}`}
                        >
                            发布
                        </button>
                    </div>

                    {/* Create Content */}
                    <div className="flex-1 overflow-y-auto no-scrollbar p-6">
                        <input 
                            value={newPostTitle} 
                            onChange={e => setNewPostTitle(e.target.value)} 
                            placeholder="填写标题会有更多赞哦~" 
                            className="text-xl font-black placeholder:text-slate-300 outline-none mb-4 w-full" 
                        />
                        <textarea 
                            value={newPostContent} 
                            onChange={e => setNewPostContent(e.target.value)} 
                            placeholder="分享你此刻的想法..." 
                            className="w-full h-auto min-h-[200px] resize-none outline-none text-base leading-relaxed placeholder:text-slate-300 font-medium" 
                        />
                        
                        {/* Sticker Selector - Flowing after text */}
                        <div className="mt-4 pt-4 border-t border-slate-50">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">添加心情贴纸 (Sticker)</p>
                            <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                                {STICKER_OPTIONS.map(sticker => (
                                    <button
                                        key={sticker.code}
                                        onClick={() => setNewPostEmoji(sticker.code)}
                                        className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-all shrink-0 ${newPostEmoji === sticker.code ? 'border-[#ff2442] bg-red-50' : 'border-slate-100'}`}
                                    >
                                        <img src={twemojiUrl(sticker.code)} alt={sticker.label} className="w-7 h-7" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Main Feed View --- */}
            <div className={`flex-col h-full ${selectedPost || isCreateOpen ? 'hidden' : 'flex'}`}>
                
                {/* Top Nav - Glass */}
                <div className="h-11 flex items-center justify-between px-4 sticky top-0 bg-white/60 backdrop-blur-xl z-30 border-b border-white/20">
                    <button onClick={closeApp} className="p-1"><Icons.Back onClick={closeApp} /></button>
                    <div className="flex gap-6 text-base font-bold text-slate-300">
                        <button className={`${activeTab === 'home' ? 'text-slate-800 scale-110 border-b-2 border-[#ff2442] pb-1' : 'hover:text-slate-500'} transition-all`} onClick={() => setActiveTab('home')}>发现</button>
                        <button className={`${activeTab === 'me' ? 'text-slate-800 scale-110 border-b-2 border-[#ff2442] pb-1' : 'hover:text-slate-500'} transition-all`} onClick={() => setActiveTab('me')}>我的</button>
                    </div>
                    <button onClick={() => setShowSettings(true)} className="text-slate-800 font-bold text-sm">管理</button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    
                    {activeTab === 'home' && (
                        <div className="p-2 min-h-full">
                            {/* Refresh Button - Above Posts */}
                            <div className="flex items-center justify-center py-3">
                                {isRefreshing ? (
                                    <div className="text-center text-xs text-[#ff2442] font-bold animate-pulse flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-[#ff2442] border-t-transparent rounded-full animate-spin"></div> 正在获取新鲜事...
                                    </div>
                                ) : (
                                    <button onClick={handleRefresh} className="px-6 py-2 bg-white/80 backdrop-blur-md rounded-full text-xs font-bold text-slate-500 shadow-sm border border-white hover:text-[#ff2442] active:scale-95 transition-all">
                                        点击刷新推荐流
                                    </button>
                                )}
                            </div>
                            <div className="columns-2 gap-2 space-y-2 pb-24">
                                {feed.map(post => renderFeedItem(post))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'me' && (
                        <div className="min-h-full bg-white/80 backdrop-blur-xl animate-fade-in">
                            {/* Profile Header (Enhanced) */}
                            <div className="relative group">
                                <div className="h-40 w-full overflow-hidden bg-slate-200 relative cursor-pointer" onClick={() => userBgInputRef.current?.click()}>
                                    {userBgImage ? (
                                        <img src={userBgImage} className="w-full h-full object-cover" />
                                    ) : (
                                        <img src={userProfile.avatar} className="w-full h-full object-cover blur-2xl opacity-60 scale-125" />
                                    )}
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                        <span className="text-white text-xs font-bold bg-black/30 px-3 py-1 rounded-full backdrop-blur-md">更换背景</span>
                                    </div>
                                    <input type="file" ref={userBgInputRef} className="hidden" accept="image/*" onChange={handleUserBgUpload} />
                                </div>
                                
                                <div className="px-6 relative -mt-12 flex justify-between items-end">
                                    {/* Social Avatar - Clickable to change */}
                                    <div className="w-24 h-24 rounded-full p-1 bg-white/90 backdrop-blur-md shadow-lg relative group cursor-pointer" onClick={() => socialAvatarInputRef.current?.click()}>
                                        <img src={socialProfile.avatar} className="w-full h-full rounded-full object-cover" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-full">
                                            <span className="text-white text-[10px] font-bold">更换</span>
                                        </div>
                                        <input type="file" ref={socialAvatarInputRef} className="hidden" accept="image/*" onChange={handleSocialAvatarUpload} />
                                    </div>

                                    <div className="flex gap-2 mb-2">
                                        <button onClick={() => { setIsEditingId(!isEditingId); if(isEditingId) saveUserProfileChanges(); }} className="px-4 py-1.5 rounded-full border border-slate-200/60 bg-white/50 backdrop-blur-sm text-xs font-bold text-slate-600 hover:bg-white transition-colors">
                                            {isEditingId ? '保存资料' : '编辑资料'}
                                        </button>
                                        <button className="p-1.5 rounded-full border border-slate-200/60 bg-white/50 backdrop-blur-sm text-slate-600 hover:bg-white transition-colors"><Icons.Share className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="px-6 pt-4 pb-6">
                                {isEditingId ? (
                                    <input 
                                        value={socialProfile.name} 
                                        onChange={e => setSocialProfile({...socialProfile, name: e.target.value})}
                                        className="text-2xl font-black text-slate-800 bg-slate-100/50 px-2 rounded outline-none border-b border-dashed border-slate-300 w-full mb-1"
                                    />
                                ) : (
                                    <h2 className="text-2xl font-black text-slate-800">{socialProfile.name}</h2>
                                )}

                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-slate-400 font-mono">Spark ID: </span>
                                    {isEditingId ? (
                                        <input 
                                            value={userSparkId} 
                                            onChange={e => setUserSparkId(e.target.value)} 
                                            className="text-xs font-mono text-slate-600 bg-slate-100 px-1 rounded outline-none border-b border-primary w-24"
                                        />
                                    ) : (
                                        <span className="text-xs text-slate-400 font-mono">{userSparkId}</span>
                                    )}
                                </div>
                                
                                {isEditingId ? (
                                    <textarea 
                                        value={socialProfile.bio} 
                                        onChange={e => setSocialProfile({...socialProfile, bio: e.target.value})}
                                        className="w-full mt-3 text-sm text-slate-600 bg-slate-50 p-2 rounded-lg outline-none resize-none border border-slate-200 focus:border-primary/50"
                                        rows={3}
                                        placeholder="填写你的个人简介..."
                                    />
                                ) : (
                                    <p className="text-sm text-slate-600 mt-3 leading-relaxed font-light">{socialProfile.bio}</p>
                                )}

                                <div className="flex gap-6 mt-5 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-sm">
                                    <div className="text-center"><span className="block font-bold text-slate-800">142</span><span className="text-[10px] text-slate-400">关注</span></div>
                                    <div className="text-center"><span className="block font-bold text-slate-800">12.5k</span><span className="text-[10px] text-slate-400">粉丝</span></div>
                                    <div className="text-center"><span className="block font-bold text-slate-800">8902</span><span className="text-[10px] text-slate-400">获赞与收藏</span></div>
                                </div>
                            </div>

                            {/* Sticky Tabs */}
                            <div className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-slate-100 flex">
                                <button onClick={() => setProfileTab('notes')} className={`flex-1 py-3 text-sm font-bold transition-colors ${profileTab === 'notes' ? 'text-slate-900 border-b-2 border-[#ff2442]' : 'text-slate-400'}`}>笔记</button>
                                <button onClick={() => setProfileTab('collects')} className={`flex-1 py-3 text-sm font-bold transition-colors ${profileTab === 'collects' ? 'text-slate-900 border-b-2 border-[#ff2442]' : 'text-slate-400'}`}>收藏</button>
                            </div>

                            <div className="p-2 min-h-[300px] bg-slate-50/50 pb-24">
                                <div className="columns-2 gap-2 space-y-2">
                                    {feed.filter(p => profileTab === 'notes' ? p.authorName === socialProfile.name : p.isCollected).map(post => (
                                        <div key={post.id} onClick={() => { setSelectedPost(post); generateComments(post); }} className="break-inside-avoid bg-white rounded-xl overflow-hidden shadow-sm border border-slate-100 cursor-pointer">
                                            <div className="aspect-[4/5] flex items-center justify-center text-4xl" style={{ background: post.bgStyle }}>{post.images[0]}</div>
                                            <div className="p-3">
                                                <h4 className="text-xs font-bold text-slate-800 line-clamp-2 leading-tight">{post.title}</h4>
                                                <div className="flex justify-between items-center mt-2">
                                                    <div className="flex items-center gap-1"><img src={post.authorAvatar} className="w-3 h-3 rounded-full" /><span className="text-[9px] text-slate-400 truncate w-12">{post.authorName}</span></div>
                                                    <div className="flex items-center gap-0.5 text-slate-400"><Icons.Heart filled={post.isLiked} className="w-3 h-3" /><span className="text-[9px]">{post.likes}</span></div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {feed.filter(p => profileTab === 'notes' ? p.authorName === socialProfile.name : p.isCollected).length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-2">
                                        <Package size={48} className="text-slate-300 opacity-30" />
                                        <span className="text-xs">空空如也</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Bottom Navigation - Floating Glass Island (Only shown when not creating) */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] h-16 bg-white/80 backdrop-blur-2xl rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-white/50 flex items-center justify-around z-40">
                    <button onClick={() => setActiveTab('home')} className={`text-sm font-medium flex flex-col items-center justify-center gap-0.5 transition-all w-12 h-12 rounded-full ${activeTab === 'home' ? 'text-slate-900 bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <House size={24} weight={activeTab === 'home' ? 'fill' : 'regular'} />
                    </button>
                    <button onClick={() => setIsCreateOpen(true)} className="w-12 h-12 bg-[#ff2442] text-white rounded-full flex items-center justify-center shadow-lg shadow-red-200 active:scale-95 transition-transform text-2xl font-light -mt-6 border-4 border-white/50">+</button>
                    <button onClick={() => setActiveTab('me')} className={`text-sm font-medium flex flex-col items-center justify-center gap-0.5 transition-all w-12 h-12 rounded-full ${activeTab === 'me' ? 'text-slate-900 bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <User size={24} />
                    </button>
                </div>
            </div>

            {selectedPost && renderDetail()}
        </div>
    );
};

export default SocialApp;
