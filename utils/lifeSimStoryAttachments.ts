import { SimStoryAttachment, SimStoryAttachmentDraft } from '../types';

const RARITY_ACCENTS = {
    common: ['#7f8c9b', '#d8dee8'],
    rare: ['#5b7bb8', '#d7e5ff'],
    epic: ['#9b5bb8', '#f2d7ff'],
} as const;

function svgToDataUri(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}

function hashText(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash;
}

function buildImageCardSvg(draft: SimStoryAttachmentDraft): string {
    const rarity = draft.rarity || 'common';
    const [accent, soft] = RARITY_ACCENTS[rarity];
    const seed = hashText(`${draft.title}:${draft.summary}:${draft.visualPrompt || ''}`);
    const shapeOffset = seed % 18;
    const motif = (draft.visualPrompt || draft.summary || draft.title).slice(0, 26);
    const title = draft.title.slice(0, 18);
    const subtitle = draft.summary.slice(0, 40);

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220" fill="none">
  <defs>
    <linearGradient id="bg" x1="22" y1="18" x2="320" y2="206" gradientUnits="userSpaceOnUse">
      <stop stop-color="${accent}"/>
      <stop offset="1" stop-color="#171b2c"/>
    </linearGradient>
    <linearGradient id="soft" x1="42" y1="38" x2="282" y2="188" gradientUnits="userSpaceOnUse">
      <stop stop-color="${soft}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.05"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="344" height="204" rx="20" fill="url(#bg)"/>
  <rect x="18" y="18" width="324" height="184" rx="14" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)"/>
  <circle cx="${88 + shapeOffset}" cy="72" r="34" fill="url(#soft)" opacity="0.9"/>
  <rect x="${176 - shapeOffset}" y="44" width="112" height="72" rx="16" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)"/>
  <path d="M42 156C78 124 118 122 150 154C182 186 224 190 286 138L320 174V188H42V156Z" fill="${soft}" fill-opacity="0.42"/>
  <path d="M42 176C86 148 126 146 160 170C196 194 246 196 310 154" stroke="rgba(255,255,255,0.28)" stroke-width="6" stroke-linecap="round"/>
  <text x="34" y="42" fill="rgba(255,255,255,0.78)" font-size="14" font-family="monospace">MAIN PLOT DROP</text>
  <text x="34" y="144" fill="#ffffff" font-size="24" font-weight="700" font-family="Arial, sans-serif">${title}</text>
  <text x="34" y="168" fill="rgba(255,255,255,0.82)" font-size="13" font-family="Arial, sans-serif">${subtitle}</text>
  <text x="34" y="190" fill="rgba(255,255,255,0.65)" font-size="12" font-family="monospace">${motif}</text>
</svg>`;
}

function ensureDetail(draft: SimStoryAttachmentDraft): string | undefined {
    if (draft.detail) return draft.detail;
    if (draft.kind === 'fanfic') {
        return `${draft.title}\n\n${draft.summary}\n\n有人把这一段写得比真相还像真相，读完只会更想继续吃瓜。`;
    }
    if (draft.kind === 'item' || draft.kind === 'evidence') {
        return `${draft.title}\n\n${draft.summary}`;
    }
    return undefined;
}

export function materializeStoryAttachments(drafts: SimStoryAttachmentDraft[]): SimStoryAttachment[] {
    return drafts.map((draft, index) => ({
        id: `story-attachment-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        kind: draft.kind,
        title: draft.title,
        summary: draft.summary,
        detail: ensureDetail(draft),
        imageUrl: draft.kind === 'image' ? svgToDataUri(buildImageCardSvg(draft)) : undefined,
        rarity: draft.rarity || 'common',
    }));
}
