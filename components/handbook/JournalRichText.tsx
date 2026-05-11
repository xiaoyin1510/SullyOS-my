/**
 * 手账内 markdown-lite 渲染
 *
 * 支持:
 *   **粗** *斜* ==高亮== ~~删~~ `代码` [color:red](文字)
 *   行首 # ## ### → 三级标题
 *   行首 - / · / ◦ → 列表
 *   行首 > → 引用
 *   ::: callout ... :::  → 整段 callout (渲染由父级决定)
 *
 * 不支持完整 markdown(链接/图片/表格)。LLM 可控,样本量少,正则就够。
 */

import React from 'react';

export interface RichTextOpts {
    /** 默认正文颜色 */
    color?: string;
    /** 高亮配色,可换 */
    accent?: string;
    /** 删除/code 等次要色 */
    muted?: string;
    /** 粗体颜色(默认 = color) */
    boldColor?: string;
    /** 行首高亮 (#)标题颜色 */
    headColor?: string;
}

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const QUOTE_RE = /^>\s+(.+)$/;
const LIST_RE = /^[-·◦]\s+(.+)$/;

/** 把一行内联 markdown 拆成 React 节点 */
function renderInline(line: string, opts: RichTextOpts, key: string): React.ReactNode[] {
    const accent = opts.accent || '#f29db0';
    const muted = opts.muted || 'rgba(122,90,114,0.55)';
    const bold = opts.boldColor || opts.color || '#3d2f3d';

    // 优先匹配的顺序: code > color > highlight > strike > bold > italic
    // 用一个简单的 token 化方案:逐次找最早出现的标记
    const tokens: { kind: 'text' | 'b' | 'i' | 'h' | 's' | 'c' | 'col'; text: string; col?: string }[] = [];
    let rest = line;
    let safety = 0;
    while (rest.length > 0 && safety++ < 200) {
        // 查找各种 marker 的最早位置
        const candidates: { kind: typeof tokens[number]['kind']; idx: number; len: number; inner: string; col?: string }[] = [];

        const code = rest.match(/`([^`]+)`/);
        if (code && code.index !== undefined) candidates.push({ kind: 'c', idx: code.index, len: code[0].length, inner: code[1] });

        // [color:red](...) — 自定义彩色笔
        const colMatch = rest.match(/\[color:([a-zA-Z#0-9]+)\]\(([^)]+)\)/);
        if (colMatch && colMatch.index !== undefined) {
            candidates.push({ kind: 'col', idx: colMatch.index, len: colMatch[0].length, inner: colMatch[2], col: colorAlias(colMatch[1]) });
        }

        const hi = rest.match(/==([^=]+)==/);
        if (hi && hi.index !== undefined) candidates.push({ kind: 'h', idx: hi.index, len: hi[0].length, inner: hi[1] });

        const st = rest.match(/~~([^~]+)~~/);
        if (st && st.index !== undefined) candidates.push({ kind: 's', idx: st.index, len: st[0].length, inner: st[1] });

        const b = rest.match(/\*\*([^*]+)\*\*/);
        if (b && b.index !== undefined) candidates.push({ kind: 'b', idx: b.index, len: b[0].length, inner: b[1] });

        const it = rest.match(/(?<!\*)\*([^*]+)\*(?!\*)/);
        if (it && it.index !== undefined) candidates.push({ kind: 'i', idx: it.index, len: it[0].length, inner: it[1] });

        if (candidates.length === 0) {
            tokens.push({ kind: 'text', text: rest });
            break;
        }
        candidates.sort((a, b) => a.idx - b.idx);
        const first = candidates[0];
        if (first.idx > 0) tokens.push({ kind: 'text', text: rest.slice(0, first.idx) });
        tokens.push({ kind: first.kind, text: first.inner, col: first.col });
        rest = rest.slice(first.idx + first.len);
    }

    return tokens.map((t, i) => {
        const k = `${key}-${i}`;
        if (t.kind === 'text') return <React.Fragment key={k}>{t.text}</React.Fragment>;
        if (t.kind === 'b') return <strong key={k} style={{ color: bold, fontWeight: 700 }}>{t.text}</strong>;
        if (t.kind === 'i') return <em key={k} style={{ fontStyle: 'italic' }}>{t.text}</em>;
        if (t.kind === 's') return <span key={k} style={{ textDecoration: 'line-through', color: muted }}>{t.text}</span>;
        if (t.kind === 'c') return (
            <code
                key={k}
                style={{
                    fontFamily: '"Courier Prime", "Courier New", monospace',
                    fontSize: '0.92em',
                    background: 'rgba(122,90,114,0.08)',
                    padding: '0 4px',
                    borderRadius: 3,
                    color: muted,
                }}
            >
                {t.text}
            </code>
        );
        if (t.kind === 'h') return (
            <span
                key={k}
                style={{
                    background: `linear-gradient(transparent 55%, ${accent}aa 55%, ${accent}aa 90%, transparent 90%)`,
                    padding: '0 2px',
                }}
            >
                {t.text}
            </span>
        );
        if (t.kind === 'col') return (
            <span key={k} style={{ color: t.col, fontWeight: 600 }}>{t.text}</span>
        );
        return null;
    });
}

function colorAlias(raw: string): string {
    const k = raw.toLowerCase();
    const map: Record<string, string> = {
        red: '#c94a4a', pink: '#e89b91', rose: '#f29db0',
        blue: '#5a7a8e', sky: '#7ea7be', cyan: '#7eb8be',
        green: '#88c5a8', mint: '#88c5a8', sage: '#a3b88c',
        yellow: '#d6b85a', lemon: '#d6b85a', gold: '#c9a14a',
        purple: '#a98ec4', lavender: '#a98ec4', violet: '#9070b8',
        orange: '#e89b6a',
        gray: 'rgba(122,90,114,0.6)', grey: 'rgba(122,90,114,0.6)',
    };
    return map[k] || raw;  // 也允许 #rrggbb 直接传
}

const JournalRichText: React.FC<{
    text: string;
    opts?: RichTextOpts;
    fontSize?: number;
    lineHeight?: string;
    fontFamily?: string;
    italic?: boolean;
}> = ({ text, opts = {}, fontSize = 13.5, lineHeight = '23px', fontFamily, italic }) => {
    const lines = (text || '').split('\n');
    const headColor = opts.headColor || opts.color || '#3d2f3d';
    const blocks: React.ReactNode[] = [];

    let listBuffer: React.ReactNode[] = [];
    const flushList = (key: string) => {
        if (listBuffer.length === 0) return;
        blocks.push(
            <ul
                key={`l-${key}`}
                style={{
                    margin: '4px 0',
                    paddingLeft: 16,
                    listStyle: 'disc',
                    color: opts.color,
                }}
            >
                {listBuffer}
            </ul>
        );
        listBuffer = [];
    };

    lines.forEach((rawLine, i) => {
        const line = rawLine;
        const trimmed = line.trim();

        if (!trimmed) {
            flushList(`${i}`);
            blocks.push(<div key={`sp-${i}`} style={{ height: 6 }} />);
            return;
        }

        const headMatch = trimmed.match(HEADING_RE);
        if (headMatch) {
            flushList(`${i}`);
            const level = headMatch[1].length;
            const sizes = [fontSize + 6, fontSize + 4, fontSize + 2];
            blocks.push(
                <div
                    key={`h-${i}`}
                    style={{
                        fontFamily: '"DM Serif Display", "Noto Serif SC", serif',
                        fontWeight: level === 1 ? 700 : 400,
                        fontSize: sizes[level - 1],
                        lineHeight: 1.15,
                        color: headColor,
                        margin: '4px 0 4px',
                        letterSpacing: '-0.01em',
                    }}
                >
                    {renderInline(headMatch[2], opts, `h${i}`)}
                </div>
            );
            return;
        }

        const quoteMatch = trimmed.match(QUOTE_RE);
        if (quoteMatch) {
            flushList(`${i}`);
            blocks.push(
                <div
                    key={`q-${i}`}
                    style={{
                        borderLeft: `3px solid ${opts.accent || '#f29db0'}`,
                        padding: '2px 0 2px 8px',
                        margin: '4px 0',
                        color: 'rgba(122,90,114,0.75)',
                        fontStyle: 'italic',
                        fontSize,
                        lineHeight,
                    }}
                >
                    {renderInline(quoteMatch[1], opts, `q${i}`)}
                </div>
            );
            return;
        }

        const listMatch = trimmed.match(LIST_RE);
        if (listMatch) {
            listBuffer.push(
                <li key={`li-${i}`} style={{ fontSize, lineHeight }}>
                    {renderInline(listMatch[1], opts, `li${i}`)}
                </li>
            );
            return;
        }

        flushList(`${i}`);
        blocks.push(
            <p
                key={`p-${i}`}
                style={{
                    margin: 0,
                    fontSize,
                    lineHeight,
                    color: opts.color,
                    fontFamily,
                    fontStyle: italic ? 'italic' : undefined,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}
            >
                {renderInline(line, opts, `p${i}`)}
            </p>
        );
    });
    flushList('end');

    return <>{blocks}</>;
};

export default JournalRichText;
