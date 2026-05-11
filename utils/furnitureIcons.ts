/**
 * furnitureIcons — SVG 家具图标 Data URI
 *
 * 将手绘风格的 SVG 家具图标编码为 data URI，
 * 供 RoomApp 等需要 image URL 的场景使用。
 * 比 Twemoji 更精致、更有设计感。
 */

function svgToDataUri(svg: string): string {
    return 'data:image/svg+xml,' + encodeURIComponent(svg.trim());
}

// ── 家具 SVG ──────────────────────────────────

const bedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="b1" x1="6" y1="38" x2="66" y2="56"><stop stop-color="#818cf8"/><stop offset="1" stop-color="#6366f1"/></linearGradient>
    <linearGradient id="b2" x1="8" y1="26" x2="64" y2="40"><stop stop-color="#c7d2fe"/><stop offset="1" stop-color="#a5b4fc"/></linearGradient>
  </defs>
  <rect x="6" y="38" width="60" height="18" rx="4" fill="url(#b1)"/>
  <rect x="8" y="26" width="56" height="14" rx="3" fill="url(#b2)"/>
  <rect x="10" y="30" width="18" height="8" rx="2" fill="#e0e7ff" opacity="0.8"/>
  <rect x="6" y="56" width="7" height="7" rx="1.5" fill="#4f46e5"/>
  <rect x="59" y="56" width="7" height="7" rx="1.5" fill="#4f46e5"/>
  <rect x="8" y="38" width="56" height="2" fill="white" opacity="0.1"/>
</svg>`;

const sofaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="s1" x1="9" y1="30" x2="63" y2="52"><stop stop-color="#c4b5fd"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient>
  </defs>
  <rect x="9" y="30" width="54" height="22" rx="6" fill="url(#s1)"/>
  <rect x="4" y="26" width="14" height="30" rx="5" fill="#a78bfa"/>
  <rect x="54" y="26" width="14" height="30" rx="5" fill="#a78bfa"/>
  <rect x="15" y="34" width="42" height="6" rx="2" fill="#e0e7ff" opacity="0.35"/>
  <rect x="9" y="56" width="7" height="7" rx="1.5" fill="#6d28d9"/>
  <rect x="56" y="56" width="7" height="7" rx="1.5" fill="#6d28d9"/>
</svg>`;

const chairSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="ch1" x1="18" y1="8" x2="54" y2="40"><stop stop-color="#d97706"/><stop offset="1" stop-color="#92400e"/></linearGradient>
  </defs>
  <rect x="18" y="8" width="36" height="30" rx="4" fill="url(#ch1)"/>
  <rect x="20" y="38" width="32" height="8" rx="2" fill="#92400e"/>
  <rect x="20" y="46" width="5" height="18" rx="1" fill="#78350f"/>
  <rect x="47" y="46" width="5" height="18" rx="1" fill="#78350f"/>
  <rect x="18" y="8" width="36" height="3" fill="white" opacity="0.1"/>
</svg>`;

const toiletSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="t1" x1="14" y1="28" x2="58" y2="58"><stop stop-color="#f1f5f9"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient>
    <linearGradient id="t2" x1="22" y1="12" x2="50" y2="44"><stop stop-color="#e2e8f0"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
  </defs>
  <ellipse cx="36" cy="44" rx="20" ry="14" fill="url(#t1)"/>
  <rect x="22" y="12" width="28" height="32" rx="5" fill="url(#t2)"/>
  <rect x="26" y="16" width="20" height="10" rx="2" fill="#f1f5f9" opacity="0.5"/>
  <rect x="31" y="6" width="10" height="8" rx="2" fill="#94a3b8"/>
</svg>`;

const bathtubSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="bt1" x1="8" y1="32" x2="64" y2="60"><stop stop-color="#f1f5f9"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
  </defs>
  <rect x="4" y="26" width="64" height="7" rx="2" fill="#e2e8f0"/>
  <path d="M8 33v18c0 4 4 8 8 8h40c4 0 8-4 8-8V33z" fill="url(#bt1)"/>
  <rect x="8" y="12" width="7" height="16" rx="2" fill="#94a3b8"/>
  <circle cx="12" cy="12" r="4" fill="#64748b"/>
  <ellipse cx="36" cy="29" rx="24" ry="3" fill="#bfdbfe" opacity="0.5"/>
</svg>`;

const plantSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <radialGradient id="p1"><stop stop-color="#86efac"/><stop offset="1" stop-color="#16a34a"/></radialGradient>
    <linearGradient id="p2" x1="22" y1="48" x2="50" y2="65"><stop stop-color="#d97706"/><stop offset="1" stop-color="#92400e"/></linearGradient>
  </defs>
  <ellipse cx="36" cy="22" rx="18" ry="16" fill="url(#p1)"/>
  <ellipse cx="26" cy="18" rx="9" ry="9" fill="#4ade80" opacity="0.7"/>
  <ellipse cx="46" cy="20" rx="8" ry="8" fill="#22c55e" opacity="0.6"/>
  <rect x="33" y="34" width="6" height="10" rx="1" fill="#92400e"/>
  <path d="M22 48h28l-4 16h-20z" fill="url(#p2)"/>
</svg>`;

const computerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="c1" x1="8" y1="8" x2="64" y2="44"><stop stop-color="#94a3b8"/><stop offset="1" stop-color="#64748b"/></linearGradient>
  </defs>
  <rect x="8" y="8" width="56" height="36" rx="4" fill="url(#c1)" stroke="#475569" stroke-width="2"/>
  <rect x="12" y="12" width="48" height="28" rx="2" fill="#1e293b"/>
  <rect x="16" y="16" width="14" height="7" rx="1" fill="#38bdf8" opacity="0.7"/>
  <rect x="16" y="26" width="24" height="2" rx="1" fill="#94a3b8" opacity="0.4"/>
  <rect x="16" y="30" width="16" height="2" rx="1" fill="#94a3b8" opacity="0.3"/>
  <rect x="28" y="44" width="16" height="5" fill="#64748b"/>
  <rect x="20" y="49" width="32" height="5" rx="2" fill="#94a3b8"/>
</svg>`;

const gamepadSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="g1" x1="12" y1="18" x2="60" y2="56"><stop stop-color="#a5b4fc"/><stop offset="1" stop-color="#6366f1"/></linearGradient>
  </defs>
  <path d="M12 26c0-5 3-8 8-8h32c5 0 8 3 8 8v10c0 9-4 18-12 20H24c-8-2-12-11-12-20z" fill="url(#g1)"/>
  <rect x="22" y="26" width="3" height="12" rx="1" fill="#1e1b4b"/>
  <rect x="18" y="30" width="11" height="3" rx="1" fill="#1e1b4b"/>
  <circle cx="50" cy="26" r="3" fill="#ef4444"/>
  <circle cx="46" cy="32" r="3" fill="#3b82f6"/>
  <rect x="32" y="34" width="8" height="3" rx="1.5" fill="#1e1b4b" opacity="0.5"/>
</svg>`;

const guitarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="gt1" x1="33" y1="4" x2="39" y2="36"><stop stop-color="#92400e"/><stop offset="1" stop-color="#78350f"/></linearGradient>
    <linearGradient id="gt2" x1="20" y1="30" x2="52" y2="68"><stop stop-color="#d97706"/><stop offset="1" stop-color="#92400e"/></linearGradient>
  </defs>
  <rect x="33" y="4" width="6" height="32" rx="2" fill="url(#gt1)"/>
  <ellipse cx="36" cy="50" rx="16" ry="18" fill="url(#gt2)"/>
  <ellipse cx="36" cy="50" rx="9" ry="11" fill="#451a03" opacity="0.5"/>
  <circle cx="36" cy="50" r="3.5" fill="#1c1917"/>
  <rect x="34" y="12" width="4" height="2" fill="#fbbf24" rx="0.5"/>
  <rect x="34" y="16" width="4" height="2" fill="#fbbf24" rx="0.5"/>
  <rect x="34" y="20" width="4" height="2" fill="#fbbf24" rx="0.5"/>
</svg>`;

const paintingSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="pt1" x1="10" y1="14" x2="62" y2="56"><stop stop-color="#7dd3fc"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
  </defs>
  <rect x="6" y="10" width="60" height="50" rx="2" fill="#92400e" stroke="#78350f" stroke-width="3"/>
  <rect x="10" y="14" width="52" height="42" rx="1" fill="url(#pt1)"/>
  <circle cx="24" cy="30" r="7" fill="#fbbf24" opacity="0.8"/>
  <path d="M10 44l14-12 9 7 12-14 17 19v12H10z" fill="#16a34a" opacity="0.6"/>
  <path d="M10 50l14-8 9 5 12-10 17 12v7H10z" fill="#15803d" opacity="0.5"/>
</svg>`;

const booksSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <rect x="12" y="44" width="48" height="9" rx="1" fill="#3b82f6"/>
  <rect x="14" y="33" width="44" height="9" rx="1" fill="#ef4444"/>
  <rect x="10" y="22" width="52" height="9" rx="1" fill="#22c55e"/>
  <rect x="16" y="11" width="40" height="9" rx="1" fill="#f59e0b"/>
  <rect x="12" y="44" width="48" height="2" fill="white" opacity="0.15"/>
  <rect x="14" y="33" width="44" height="2" fill="white" opacity="0.15"/>
  <rect x="10" y="22" width="52" height="2" fill="white" opacity="0.15"/>
  <rect x="16" y="11" width="40" height="2" fill="white" opacity="0.15"/>
  <rect x="8" y="53" width="56" height="5" rx="1" fill="#64748b"/>
</svg>`;

const lampSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="l1" x1="18" y1="8" x2="54" y2="32"><stop stop-color="#fef3c7"/><stop offset="1" stop-color="#fde68a"/></linearGradient>
  </defs>
  <rect x="32" y="30" width="8" height="24" rx="2" fill="#94a3b8"/>
  <ellipse cx="36" cy="58" rx="14" ry="5" fill="#64748b"/>
  <path d="M18 30h36l-7-22H25z" fill="url(#l1)"/>
  <ellipse cx="36" cy="12" rx="5" ry="3" fill="#fef3c7"/>
  <circle cx="36" cy="20" r="3" fill="#fbbf24" opacity="0.8"/>
</svg>`;

const trashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="tr1" x1="18" y1="18" x2="54" y2="58"><stop stop-color="#94a3b8"/><stop offset="1" stop-color="#64748b"/></linearGradient>
  </defs>
  <rect x="18" y="18" width="36" height="40" rx="3" fill="url(#tr1)"/>
  <rect x="14" y="12" width="44" height="7" rx="2" fill="#94a3b8"/>
  <rect x="29" y="6" width="14" height="8" rx="2" fill="#64748b"/>
  <rect x="24" y="24" width="3" height="28" rx="1" fill="#475569" opacity="0.5"/>
  <rect x="34" y="24" width="3" height="28" rx="1" fill="#475569" opacity="0.5"/>
  <rect x="44" y="24" width="3" height="28" rx="1" fill="#475569" opacity="0.5"/>
</svg>`;

const coffeeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="cf1" x1="14" y1="26" x2="50" y2="62"><stop stop-color="#78350f"/><stop offset="1" stop-color="#451a03"/></linearGradient>
  </defs>
  <path d="M14 26h36v28c0 5-4 8-8 8H22c-5 0-8-3-8-8z" fill="url(#cf1)"/>
  <path d="M50 30h7c3 0 6 2 6 6s-3 6-6 6h-7" stroke="#94a3b8" stroke-width="3" fill="none"/>
  <rect x="14" y="22" width="36" height="6" rx="2" fill="#e2e8f0"/>
  <path d="M22 14c0-4 2-7 2-7M32 12c0-4 2-7 2-7M42 14c0-4 2-7 2-7" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
</svg>`;

const cakeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="ck1" x1="10" y1="34" x2="62" y2="58"><stop stop-color="#fecdd3"/><stop offset="1" stop-color="#f43f5e"/></linearGradient>
    <linearGradient id="ck2" x1="14" y1="26" x2="58" y2="38"><stop stop-color="#fef3c7"/><stop offset="1" stop-color="#fde68a"/></linearGradient>
  </defs>
  <rect x="10" y="34" width="52" height="24" rx="5" fill="url(#ck1)"/>
  <path d="M10 34h52v6c0 0-7 5-26 5s-26-5-26-5z" fill="#fda4af"/>
  <rect x="14" y="26" width="44" height="10" rx="3" fill="url(#ck2)"/>
  <rect x="34" y="12" width="4" height="16" rx="1" fill="#f59e0b"/>
  <ellipse cx="36" cy="10" rx="3.5" ry="4.5" fill="#fbbf24"/>
  <path d="M36 5c0 0 0-2 0-2" stroke="#fb923c" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const pizzaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="pz1" x1="36" y1="8" x2="36" y2="64"><stop stop-color="#d97706"/><stop offset="1" stop-color="#92400e"/></linearGradient>
    <linearGradient id="pz2" x1="36" y1="16" x2="36" y2="58"><stop stop-color="#fde68a"/><stop offset="1" stop-color="#fbbf24"/></linearGradient>
  </defs>
  <path d="M36 8L8 64h56z" fill="url(#pz1)"/>
  <path d="M36 16L14 58h44z" fill="url(#pz2)"/>
  <circle cx="28" cy="40" r="5" fill="#dc2626" opacity="0.8"/>
  <circle cx="42" cy="44" r="4" fill="#dc2626" opacity="0.8"/>
  <circle cx="34" cy="52" r="3.5" fill="#16a34a" opacity="0.7"/>
</svg>`;

// ── 导出 Data URI ──────────────────────────────────

export const FURNITURE_ICONS = {
    bed: svgToDataUri(bedSvg),
    sofa: svgToDataUri(sofaSvg),
    chair: svgToDataUri(chairSvg),
    toilet: svgToDataUri(toiletSvg),
    bathtub: svgToDataUri(bathtubSvg),
    plant: svgToDataUri(plantSvg),
    computer: svgToDataUri(computerSvg),
    gamepad: svgToDataUri(gamepadSvg),
    guitar: svgToDataUri(guitarSvg),
    painting: svgToDataUri(paintingSvg),
    books: svgToDataUri(booksSvg),
    lamp: svgToDataUri(lampSvg),
    trash: svgToDataUri(trashSvg),
    coffee: svgToDataUri(coffeeSvg),
    cake: svgToDataUri(cakeSvg),
    pizza: svgToDataUri(pizzaSvg),
};
