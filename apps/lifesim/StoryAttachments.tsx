import React, { useState } from 'react';
import { SimStoryAttachment } from '../../types';
import { BookOpen, FileText, ImageSquare, Package, X } from '@phosphor-icons/react';

const KIND_META = {
    image: { label: '插图', Icon: ImageSquare },
    item: { label: '道具', Icon: Package },
    fanfic: { label: '同人文', Icon: BookOpen },
    evidence: { label: '附件', Icon: FileText },
} as const;

const RARITY_COLORS = {
    common: '#7f8c9b',
    rare: '#5b7bb8',
    epic: '#9b5bb8',
} as const;

const StoryAttachments: React.FC<{
    attachments?: SimStoryAttachment[];
    compact?: boolean;
}> = ({ attachments, compact = false }) => {
    const [active, setActive] = useState<SimStoryAttachment | null>(null);

    if (!attachments || attachments.length === 0) return null;

    return (
        <>
            <div style={{ marginTop: compact ? 5 : 8, minWidth: 0 }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                    <span style={{ fontSize: compact ? 8 : 9, fontWeight: 700, color: '#7a6f95', letterSpacing: '0.06em' }}>
                        ATTACHMENTS
                    </span>
                    <span style={{ fontSize: compact ? 8 : 9, color: '#aaa' }}>{attachments.length}</span>
                </div>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                    {attachments.map(item => {
                        const meta = KIND_META[item.kind];
                        const Icon = meta.Icon;
                        const accent = RARITY_COLORS[item.rarity || 'common'];
                        return (
                            <button
                                key={item.id}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setActive(item);
                                }}
                                className="flex-shrink-0"
                                style={{
                                    width: compact ? 118 : 132,
                                    textAlign: 'left',
                                    border: `1px solid ${accent}55`,
                                    borderLeft: `3px solid ${accent}`,
                                    borderRadius: 4,
                                    background: 'rgba(255,255,255,0.6)',
                                    padding: 6,
                                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)',
                                }}
                            >
                                {item.imageUrl && (
                                    <img
                                        src={item.imageUrl}
                                        alt={item.title}
                                        style={{
                                            width: '100%',
                                            height: compact ? 58 : 66,
                                            objectFit: 'cover',
                                            borderRadius: 3,
                                            border: '1px solid rgba(0,0,0,0.08)',
                                            marginBottom: 5,
                                        }}
                                    />
                                )}
                                <div className="flex items-center gap-1">
                                    <Icon size={11} weight="bold" style={{ color: accent, flexShrink: 0 }} />
                                    <span style={{ fontSize: 8, fontWeight: 700, color: accent }}>{meta.label}</span>
                                </div>
                                <div style={{ fontSize: compact ? 9 : 10, fontWeight: 700, color: '#4c4658', marginTop: 3, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                                    {item.title}
                                </div>
                                <div style={{ fontSize: 8, color: '#7d7887', marginTop: 3, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                                    {item.summary}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {active && (
                <div
                    onClick={() => setActive(null)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.42)',
                        zIndex: 70,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 16,
                    }}
                >
                    <div
                        className="retro-window"
                        onClick={event => event.stopPropagation()}
                        style={{
                            width: '100%',
                            maxWidth: 360,
                            maxHeight: '78vh',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            minWidth: 0,
                        }}
                    >
                        <div className="retro-titlebar">
                            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{active.title}</span>
                            <button
                                onClick={() => setActive(null)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 18,
                                    height: 18,
                                    borderRadius: 3,
                                    background: 'rgba(255,255,255,0.15)',
                                    border: '1px solid rgba(255,255,255,0.25)',
                                    color: 'white',
                                    flexShrink: 0,
                                }}
                            >
                                <X size={10} weight="bold" />
                            </button>
                        </div>

                        <div className="no-scrollbar" style={{ padding: 12, overflowY: 'auto', overflowX: 'hidden' }}>
                            {active.imageUrl && (
                                <img
                                    src={active.imageUrl}
                                    alt={active.title}
                                    style={{
                                        width: '100%',
                                        borderRadius: 6,
                                        border: '1px solid rgba(0,0,0,0.1)',
                                        marginBottom: 10,
                                    }}
                                />
                            )}

                            <div style={{ fontSize: 10, color: '#6e6780', fontWeight: 700, marginBottom: 4 }}>
                                {KIND_META[active.kind].label} · {(active.rarity || 'common').toUpperCase()}
                            </div>

                            {(active.kind === 'fanfic' || active.kind === 'evidence') && active.detail ? (
                                <>
                                    <div className="retro-inset" style={{ padding: '8px 10px', marginTop: 2 }}>
                                        <div style={{ fontSize: 10, color: '#777', fontWeight: 700, marginBottom: 4 }}>
                                            原文
                                        </div>
                                        <div style={{ fontSize: 11, color: '#4f4b58', lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                            {active.detail}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 10, color: '#7b7387', lineHeight: 1.6, marginTop: 9, overflowWrap: 'anywhere' }}>
                                        {active.summary}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ fontSize: 12, color: '#444', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                                        {active.summary}
                                    </div>
                                    {active.detail && (
                                        <div className="retro-inset" style={{ padding: '8px 10px', marginTop: 10 }}>
                                            <div style={{ fontSize: 10, color: '#777', fontWeight: 700, marginBottom: 4 }}>
                                                展开内容
                                            </div>
                                            <div style={{ fontSize: 11, color: '#4f4b58', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                                {active.detail}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default StoryAttachments;
