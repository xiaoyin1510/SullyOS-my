/**
 * 回归守卫: 禁止正则后行断言 (?<=) / (?<!) 混回源码与 bundle 产物。
 *
 * 为什么: iOS Safari <16.4 (WebKit/JSC) 不支持 lookbehind, 旧设备上 new RegExp('(?<=…)')
 *   直接抛 "Invalid regular expression: invalid group specifier name", 被聊天兜底 catch
 *   包成错误气泡弹给用户。详见 utils/lookbehindFree.test.ts。
 *
 * 怎么测: 扫源码目录 + worker bundle 产物。先剥注释 (我们在注释里大量用 (?<=…) 做说明,
 *   不能误伤), 再检测剩余代码是否含 lookbehind。命中即 fail, 报出文件:行号。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = join(__dirname, '..');
const SRC_DIRS = ['utils', 'hooks', 'apps', 'components', 'worker'];
const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.mjs']);
const SKIP_FILE = /(lookbehindFree\.test\.ts|noLookbehind\.test\.ts)$/;
const SKIP_DIR = /node_modules|\.worktrees|dist/;
const BUNDLE_FILES = [
  'public/instant-worker.bundle.js',
  'worker/instant-push/worker.bundle.js',
  'public/sw-keep-alive.js',
];
const LOOKBEHIND = /\(\?<[=!]/;

/** 粗剥 // 行注释和 块注释, 避免误伤注释里的 (?<=…) 说明文字。不需完整 parser。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (SKIP_DIR.test(full)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (SRC_EXT.has(extname(name)) && !SKIP_FILE.test(full) && !/\.bundle\.js$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('no-lookbehind 守卫', () => {
  it('源码 (剥注释后) 不含正则后行断言', () => {
    const offenders: string[] = [];
    for (const dir of SRC_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const stripped = stripComments(readFileSync(file, 'utf8'));
        stripped.split('\n').forEach((line, i) => {
          if (LOOKBEHIND.test(line)) {
            offenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}`);
          }
        });
      }
    }
    expect(offenders, `发现 lookbehind (旧 iOS 会炸):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('worker bundle 产物不含正则后行断言 (改完源码记得跑 build:workers)', () => {
    const offenders: string[] = [];
    for (const rel of BUNDLE_FILES) {
      let src: string;
      try {
        src = readFileSync(join(ROOT, rel), 'utf8');
      } catch {
        continue;
      }
      if (LOOKBEHIND.test(src)) offenders.push(rel);
    }
    expect(offenders, `bundle 含 lookbehind, 需重新 build:\n${offenders.join('\n')}`).toEqual([]);
  });
});
