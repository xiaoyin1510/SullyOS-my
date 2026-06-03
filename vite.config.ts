import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { bakeVoiceMiddleware } from './server/bake-voice-middleware';

// 构建时抓 git 分支 + short commit，注入到 BuildBadge 显示。
// 非 git 环境（容器、tarball 部署）退化成 'unknown'，不影响构建。
//
// 显示规则：
//   - 默认在 main / master 上隐藏（视为正式发布），其他分支显示
//   - CI detached HEAD 优先读 GITHUB_REF_NAME / VERCEL_GIT_COMMIT_REF / CF_PAGES_BRANCH / BRANCH(Netlify)
//   - VITE_HIDE_BUILD_BADGE=1 强制隐藏（覆盖默认）
//   - VITE_SHOW_BUILD_BADGE=1 强制显示（在 master 本地调试用）
const RELEASE_BRANCHES = new Set(['main', 'master']);

function readBranch(): string {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.VERCEL_GIT_COMMIT_REF) return process.env.VERCEL_GIT_COMMIT_REF;
  if (process.env.CF_PAGES_BRANCH) return process.env.CF_PAGES_BRANCH;
  if (process.env.BRANCH) return process.env.BRANCH;
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}
function readCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const gitInfo = { branch: readBranch(), commit: readCommit() };
const isReleaseBranch = RELEASE_BRANCHES.has(gitInfo.branch);
let showBuildBadge = !isReleaseBranch;
if (process.env.VITE_HIDE_BUILD_BADGE === '1') showBuildBadge = false;
if (process.env.VITE_SHOW_BUILD_BADGE === '1') showBuildBadge = true;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bake-voice-middleware',
      configureServer(server) {
        server.middlewares.use('/api/minimax/bake-voice', bakeVoiceMiddleware);
      },
    },
  ],
  define: {
    __BUILD_BRANCH__: JSON.stringify(gitInfo.branch),
    __BUILD_COMMIT__: JSON.stringify(gitInfo.commit),
    __BUILD_BADGE_VISIBLE__: JSON.stringify(showBuildBadge),
  },
  // GitHub Pages 发布时使用相对路径，避免仓库子路径导致资源 404
  base: process.env.GITHUB_PAGES ? './' : '/',
  esbuild: {
    // 只剥 debugger，保留 console.* —— 部署后按 F12 仍能看到运行时日志，方便排查。
    drop: ['debugger'],
  },
  server: {
    proxy: {
      '/api/minimax/t2a': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/v1/t2a_v2',
        // Route to 国服 / 海外 based on X-MiniMax-Region header sent by the client.
        router: (req) => {
          const region = String(req.headers['x-minimax-region'] || '').toLowerCase();
          return region === 'overseas' ? 'https://api.minimax.io' : 'https://api.minimaxi.com';
        },
      },
      '/api/minimax/get-voice': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/v1/get_voice',
        router: (req) => {
          const region = String(req.headers['x-minimax-region'] || '').toLowerCase();
          return region === 'overseas' ? 'https://api.minimax.io' : 'https://api.minimaxi.com';
        },
      },
      '/api/minimax/music': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/v1/music_generation',
        router: (req) => {
          const region = String(req.headers['x-minimax-region'] || '').toLowerCase();
          return region === 'overseas' ? 'https://api.minimax.io' : 'https://api.minimaxi.com';
        },
      },
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // 关键修复：将这些包排除在打包之外，让浏览器通过 index.html 的 importmap 加载
      external: ['pdfjs-dist', 'katex'],
      onwarn(warning, defaultHandler) {
        // 抑制动态导入与静态导入混合的无害警告
        if (warning.message?.includes('dynamic import will not move module into another chunk')) return;
        defaultHandler(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('@phosphor-icons')) {
              return 'vendor-icons';
            }
            if (id.includes('@capacitor')) {
              return 'vendor-capacitor';
            }
            return 'vendor';
          }
          if (id.includes('utils/memoryPalace')) {
            return 'memory-palace';
          }
        }
      }
    }
  }
});
