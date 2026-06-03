"""一次性补丁：修复 xiaohongshu-skills 新版 publish.py 的"上传图文 tab 找不到" bug。

问题：小红书把发布页非激活 tab 定位到 left/top: -9999px（Vue carousel 常见做法），
而 _click_publish_tab 里的过滤 `if (rect.left < 0 || rect.top < 0) continue;`
把这些 tab 全跳过了，导致点不到"上传图文"。

修复：
1. 策略1：保留过滤，但发现 tab 在屏外时直接 .click()（JS click 不需要元素可见）
2. 策略2：直接删掉 rect.left/top < 0 的过滤

用法：
  python patch-xhs-publish.py [path/to/publish.py]

不传路径时自动找 ../xiaohongshu-skills*/scripts/xhs/publish.py。
已打过补丁会跳过。会自动备份原文件为 publish.py.bak。
"""

from __future__ import annotations

import sys
from pathlib import Path

# ─── 旧字符串（策略1）────────────────────────────────────────────────────────
OLD_STRATEGY_1 = """                        // 跳过隐藏或被移出视口的元素
                        if (rect.width === 0 || rect.height === 0) continue;
                        if (rect.left < 0 || rect.top < 0) continue;
                        if (style.display === 'none' || style.visibility === 'hidden') continue;
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        const target = document.elementFromPoint(x, y);
                        if (target === tab || tab.contains(target)) {{
                            tab.click();
                            return 'clicked';
                        }}
                        return 'blocked';"""

NEW_STRATEGY_1 = """                        // 跳过完全隐藏的元素；离屏 carousel tab（XHS 非激活 tab 定位到 -9999）保留，下面 .click() 处理
                        if (rect.width === 0 || rect.height === 0) continue;
                        if (style.display === 'none' || style.visibility === 'hidden') continue;
                        const offScreen = (rect.left < 0 || rect.top < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight);
                        if (offScreen) {{
                            tab.click();
                            return 'clicked';
                        }}
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        const target = document.elementFromPoint(x, y);
                        if (target === tab || tab.contains(target)) {{
                            tab.click();
                            return 'clicked';
                        }}
                        return 'blocked';"""

# ─── 旧字符串（策略2）────────────────────────────────────────────────────────
OLD_STRATEGY_2 = """                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        if (rect.width === 0 || rect.height === 0) continue;
                        if (rect.left < 0 || rect.top < 0) continue;
                        if (style.display === 'none' || style.visibility === 'hidden') continue;
                        el.click();
                        return 'clicked';"""

NEW_STRATEGY_2 = """                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        if (rect.width === 0 || rect.height === 0) continue;
                        if (style.display === 'none' || style.visibility === 'hidden') continue;
                        el.click();
                        return 'clicked';"""

PATCH_MARKER = "// 跳过完全隐藏的元素；离屏 carousel tab"


def find_publish_py() -> Path | None:
    """从当前目录向上找 xiaohongshu-skills*/scripts/xhs/publish.py。"""
    here = Path(__file__).resolve().parent
    candidates = []
    for base in [here, *here.parents]:
        for name in ("xiaohongshu-skills", "xiaohongshu-skills-main"):
            p = base / name / "scripts" / "xhs" / "publish.py"
            candidates.append(p)
        # 也搜 base 本身就是 skills 仓库的情况
        candidates.append(base / "scripts" / "xhs" / "publish.py")
    for p in candidates:
        if p.is_file():
            return p
    return None


def apply_patch(publish_py: Path) -> int:
    """返回 0=成功 1=已打过 2=失败。"""
    text = publish_py.read_text(encoding="utf-8")

    if PATCH_MARKER in text:
        print(f"[skip] {publish_py} 已经打过补丁，跳过。")
        return 1

    new_text = text
    s1_hit = OLD_STRATEGY_1 in new_text
    s2_hit = OLD_STRATEGY_2 in new_text

    if not s1_hit and not s2_hit:
        print(f"[error] {publish_py} 里找不到要修补的代码片段。")
        print("        可能上游已经改过了，或者你的文件版本和预期不符。")
        return 2

    if s1_hit:
        new_text = new_text.replace(OLD_STRATEGY_1, NEW_STRATEGY_1, 1)
        print("  [ok] 策略1 已修补")
    else:
        print("  [warn] 策略1 片段没找到，跳过")

    if s2_hit:
        new_text = new_text.replace(OLD_STRATEGY_2, NEW_STRATEGY_2, 1)
        print("  [ok] 策略2 已修补")
    else:
        print("  [warn] 策略2 片段没找到，跳过")

    backup = publish_py.with_suffix(publish_py.suffix + ".bak")
    if not backup.exists():
        backup.write_text(text, encoding="utf-8")
        print(f"  [bak] 已备份原文件到 {backup.name}")

    publish_py.write_text(new_text, encoding="utf-8")
    print(f"[done] {publish_py} 修补完成。")
    return 0


def main() -> int:
    if len(sys.argv) > 1:
        target = Path(sys.argv[1]).expanduser().resolve()
        if not target.is_file():
            print(f"[error] 指定的文件不存在: {target}")
            return 2
    else:
        target = find_publish_py()
        if target is None:
            print("[error] 自动找不到 publish.py，请把路径作为参数传入:")
            print("  python patch-xhs-publish.py path/to/xiaohongshu-skills/scripts/xhs/publish.py")
            return 2
        print(f"[auto] 找到目标: {target}")

    return apply_patch(target)


if __name__ == "__main__":
    sys.exit(main())
