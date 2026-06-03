import { safeResponseJson } from './safeApi';

const TOOLBOX_BASE_URL = 'http://localhost:3001';

export const toolbox = {
  async search(query: string, options?: { count?: number; freshness?: string }) {
    const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, ...options })
    });
    return await safeResponseJson(res);
  },

  async fetch(url: string, maxChars?: number) {
    const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/fetch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, maxChars })
    });
    return await safeResponseJson(res);
  },

  async read(path: string, limit?: number) {
    const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, limit })
    });
    return await safeResponseJson(res);
  },

  async write(path: string, content: string) {
    const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content })
    });
    return await safeResponseJson(res);
  },

  async edit(path: string, oldText: string, newText: string) {
    const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/edit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, oldText, newText })
    });
    return await safeResponseJson(res);
  },

  async exec(command: string, timeout?: number) {
    const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/exec`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, timeout })
    });
    return await safeResponseJson(res);
  },

  browser: {
    async open(url: string) {
      const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/browser/open`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      return await safeResponseJson(res);
    },
    async screenshot(fullPage?: boolean) {
      const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/browser/screenshot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullPage })
      });
      return await safeResponseJson(res);
    },
    async snapshot() {
      const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/browser/snapshot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      });
      return await safeResponseJson(res);
    },
    async act(kind: string, params: any) {
      const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/browser/act`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...params })
      });
      return await safeResponseJson(res);
    }
  },

  async sendMessage(channel: string, target: string, message: string) {
    const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/message/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, target, message })
    });
    return await safeResponseJson(res);
  },

  async health() {
    try {
      const res = await fetch(`${TOOLBOX_BASE_URL}/toolbox/health`);
      return await safeResponseJson(res);
    } catch { return { ok: false }; }
  }
};

export default toolbox;
