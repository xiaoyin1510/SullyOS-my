/**
 * WebDAV Client for Cloud Backup
 *
 * Supports: 坚果云 (Nutstore), Nextcloud, Synology NAS, TeraCloud, Box, etc.
 *
 * Two transports:
 *   - Native (Capacitor Android/iOS): hits the WebDAV server directly via
 *     CapacitorHttp, which uses the OS HTTP stack and bypasses CORS. No
 *     Cloudflare Worker request quota burned, no extra hop.
 *   - Web: routes POST + X-WebDAV-Method through the sully-n CF Worker so the
 *     browser CORS preflight passes (TeraCloud / infini-cloud / NAS don't
 *     return CORS headers).
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';

import { CloudBackupConfig, CloudBackupFile } from '../types';

const WORKER_URL = 'https://sullymeow.ccwu.cc';

const isNative = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

const buildFullUrl = (webdavUrl: string, path: string): string =>
    webdavUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');

const buildProxyUrl = (fullUrl: string): string =>
    `${WORKER_URL}/webdav?url=${encodeURIComponent(fullUrl)}`;

const buildAuthHeader = (config: CloudBackupConfig): string =>
    `Basic ${btoa(`${config.username}:${config.password}`)}`;

type WebdavMethod = 'GET' | 'PUT' | 'PROPFIND' | 'MKCOL' | 'DELETE';
type WebdavOptions = {
    range?: string;
    depth?: '0' | '1';
    contentType?: string;
    body?: string | ArrayBuffer | Blob;
};
type WebdavResponse = {
    status: number;
    text: () => Promise<string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
};

// Android's HttpURLConnection (which CapacitorHttp uses under the hood) rejects
// non-standard HTTP verbs like PROPFIND and MKCOL with `ProtocolException`.
// Standard verbs go direct on native; the rest fall back to the Worker, which
// is fine because PROPFIND/MKCOL responses are <1 KB.
const NATIVE_DIRECT_METHODS: ReadonlySet<WebdavMethod> = new Set(['GET', 'PUT', 'DELETE']);

const decodeBinaryFromCapacitor = (data: any): ArrayBuffer => {
    if (data instanceof ArrayBuffer) return data;
    if (data && data.buffer instanceof ArrayBuffer) return data.buffer;
    if (typeof data === 'string') {
        // Capacitor encodes binary as base64 for the JS bridge
        const bin = atob(data);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out.buffer;
    }
    return new ArrayBuffer(0);
};

const webdavRequest = async (
    config: CloudBackupConfig,
    path: string,
    method: WebdavMethod,
    opts: WebdavOptions = {},
): Promise<WebdavResponse> => {
    const fullUrl = buildFullUrl(config.webdavUrl, path);
    const auth = buildAuthHeader(config);

    if (isNative() && NATIVE_DIRECT_METHODS.has(method)) {
        const headers: Record<string, string> = { Authorization: auth };
        if (opts.range) headers['Range'] = opts.range;
        if (opts.depth) headers['Depth'] = opts.depth;
        if (opts.contentType) headers['Content-Type'] = opts.contentType;

        let data: any = undefined;
        if (opts.body !== undefined && opts.body !== null) {
            if (opts.body instanceof Blob) data = await opts.body.arrayBuffer();
            else data = opts.body;
        }

        const isBinaryGet = method === 'GET';
        const response = await CapacitorHttp.request({
            url: fullUrl,
            method,
            headers,
            data,
            responseType: isBinaryGet ? 'arraybuffer' : 'text',
        });

        const respData = response.data;
        return {
            status: response.status,
            text: async () => (typeof respData === 'string' ? respData : ''),
            arrayBuffer: async () => decodeBinaryFromCapacitor(respData),
        };
    }

    // Web path → POST through Worker, real method goes in X-WebDAV-Method
    const url = buildProxyUrl(fullUrl);
    const headers: Record<string, string> = {
        Authorization: auth,
        'X-WebDAV-Method': method,
    };
    if (opts.range) headers['X-WebDAV-Range'] = opts.range;
    if (opts.depth) headers['X-WebDAV-Depth'] = opts.depth;
    if (opts.contentType) headers['Content-Type'] = opts.contentType;

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: (opts.body as BodyInit | undefined) ?? null,
    });
    return {
        status: res.status,
        text: () => res.text(),
        arrayBuffer: () => res.arrayBuffer(),
    };
};

/**
 * Test WebDAV connection by doing a PROPFIND on the remote path
 */
export const testConnection = async (config: CloudBackupConfig): Promise<{ ok: boolean; message: string }> => {
    try {
        const res = await webdavRequest(config, config.remotePath, 'PROPFIND', {
            depth: '0',
            contentType: 'application/xml; charset=utf-8',
            body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
        });

        if (res.status === 207 || res.status === 200) return { ok: true, message: '连接成功' };
        if (res.status === 401) return { ok: false, message: '认证失败：请检查用户名和密码' };
        if (res.status === 404) {
            const mkcolOk = await createDirectory(config);
            if (mkcolOk) return { ok: true, message: '连接成功（已自动创建备份目录）' };
            return { ok: false, message: '备份目录不存在且无法创建' };
        }
        return { ok: false, message: `服务器返回 ${res.status}` };
    } catch (e: any) {
        return { ok: false, message: `连接失败: ${e.message}` };
    }
};

/**
 * Create remote directory (MKCOL)
 */
export const createDirectory = async (config: CloudBackupConfig): Promise<boolean> => {
    try {
        const res = await webdavRequest(config, config.remotePath, 'MKCOL');
        return res.status === 201 || res.status === 405; // 405 = already exists
    } catch {
        return false;
    }
};

/**
 * Upload a backup file to WebDAV.
 *
 * Web: XMLHttpRequest so upload.onprogress can report real bytes-uploaded.
 * Native: CapacitorHttp PUT direct to upstream — no real progress events,
 * but the round-trip skips the Worker entirely.
 */
export const uploadBackup = async (
    config: CloudBackupConfig,
    blob: Blob,
    filename: string,
    onProgress?: (percent: number) => void,
): Promise<{ ok: boolean; message: string }> => {
    const remotePath = config.remotePath.replace(/\/+$/, '') + '/' + filename;

    const mapStatus = (s: number) => {
        if (s === 200 || s === 201 || s === 204) return { ok: true, message: '上传成功' };
        if (s === 401) return { ok: false, message: '认证失败' };
        if (s === 507) return { ok: false, message: '云端空间不足' };
        return { ok: false, message: `上传失败 (${s})` };
    };

    // On native, PUT goes direct via CapacitorHttp (no XHR upload progress
    // available, so we just bookend with 5% → 100%). On web we keep XHR for
    // real byte-level progress through the Worker.
    if (isNative() && NATIVE_DIRECT_METHODS.has('PUT')) {
        try {
            onProgress?.(5);
            const res = await webdavRequest(config, remotePath, 'PUT', {
                contentType: 'application/zip',
                body: blob,
            });
            onProgress?.(100);
            return mapStatus(res.status);
        } catch (e: any) {
            return { ok: false, message: `上传失败: ${e?.message || '未知错误'}` };
        }
    }

    return new Promise((resolve) => {
        const url = buildProxyUrl(buildFullUrl(config.webdavUrl, remotePath));
        const auth = buildAuthHeader(config);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', auth);
        xhr.setRequestHeader('Content-Type', 'application/zip');
        xhr.setRequestHeader('X-WebDAV-Method', 'PUT');

        xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const pct = Math.min(99, Math.floor((e.loaded / e.total) * 100));
            onProgress?.(pct);
        };
        xhr.onload = () => {
            onProgress?.(100);
            resolve(mapStatus(xhr.status));
        };
        xhr.onerror = () => resolve({ ok: false, message: '上传失败: 网络错误' });
        xhr.onabort = () => resolve({ ok: false, message: '上传已取消' });
        xhr.ontimeout = () => resolve({ ok: false, message: '上传超时' });

        xhr.send(blob);
    });
};

/**
 * List backup files on WebDAV
 */
export const listBackups = async (config: CloudBackupConfig): Promise<CloudBackupFile[]> => {
    try {
        const res = await webdavRequest(config, config.remotePath, 'PROPFIND', {
            depth: '1',
            contentType: 'application/xml; charset=utf-8',
            body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/><d:displayname/><d:resourcetype/></d:prop></d:propfind>',
        });
        if (res.status !== 207 && res.status !== 200) return [];
        const xml = await res.text();
        return parseWebDAVListing(xml, config);
    } catch {
        return [];
    }
};

/**
 * Download a backup file from WebDAV in fixed-size chunks via HTTP Range.
 *
 * Single-shot GET reliably failed for large backups: through the Worker, the
 * upstream→worker→client pipe outlived the worker's wall-clock budget on slow
 * links and the browser logged `net::ERR_FAILED 200 (OK)`. Through native
 * CapacitorHttp, the whole response would have to land in JS as one
 * ArrayBuffer (OOM risk on big zips). Chunking solves both: each request is
 * bounded, retries are local, and progress reflects actual bytes.
 */
const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;

const fetchChunk = async (
    config: CloudBackupConfig,
    path: string,
    rangeHeader: string,
): Promise<ArrayBuffer> => {
    let lastErr: any = null;
    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
        try {
            const res = await webdavRequest(config, path, 'GET', { range: rangeHeader });
            if (res.status === 206 || res.status === 200) return await res.arrayBuffer();
            lastErr = new Error(`chunk HTTP ${res.status}`);
        } catch (e) {
            lastErr = e;
        }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
    throw lastErr || new Error('chunk failed');
};

export const downloadBackup = async (
    config: CloudBackupConfig,
    file: CloudBackupFile,
    onProgress?: (percent: number) => void,
): Promise<Blob | null> => {
    try {
        onProgress?.(2);

        if (file.size > CHUNK_SIZE) {
            try {
                const total = file.size;
                const parts: ArrayBuffer[] = [];
                let received = 0;
                for (let start = 0; start < total; start += CHUNK_SIZE) {
                    const end = Math.min(start + CHUNK_SIZE - 1, total - 1);
                    const buf = await fetchChunk(config, file.href, `bytes=${start}-${end}`);
                    parts.push(buf);
                    received += buf.byteLength;
                    onProgress?.(Math.min(99, Math.floor((received / total) * 100)));
                }
                const blob = new Blob(parts, { type: 'application/zip' });
                onProgress?.(100);
                return blob;
            } catch (e) {
                // Most likely: the deployed Worker hasn't been redeployed with the
                // X-WebDAV-Range header allowed by CORS preflight. Fall through to
                // a single GET so small/medium backups still restore. (Won't help
                // for huge files — those need the new worker.)
                console.warn('[webdav] chunked download failed, falling back to single GET', e);
                onProgress?.(2);
            }
        }

        // Small / unknown size, or chunked fallback — single GET
        const res = await webdavRequest(config, file.href, 'GET');
        if (res.status !== 200 && res.status !== 206) return null;
        onProgress?.(50);
        const buf = await res.arrayBuffer();
        onProgress?.(100);
        return new Blob([buf], { type: 'application/zip' });
    } catch {
        return null;
    }
};

/**
 * Delete a backup file from WebDAV
 */
export const deleteBackup = async (
    config: CloudBackupConfig,
    file: CloudBackupFile,
): Promise<boolean> => {
    try {
        const res = await webdavRequest(config, file.href, 'DELETE');
        return res.status === 204 || res.status === 200;
    } catch {
        return false;
    }
};

/**
 * Parse WebDAV PROPFIND XML response into file list
 */
const parseWebDAVListing = (xml: string, config: CloudBackupConfig): CloudBackupFile[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const responses = doc.querySelectorAll('response');
    const files: CloudBackupFile[] = [];

    responses.forEach((response) => {
        const href = response.querySelector('href')?.textContent || '';
        const isCollection = response.querySelector('resourcetype collection') !== null;
        if (isCollection) return;

        const displayName = response.querySelector('displayname')?.textContent || '';
        const contentLength = response.querySelector('getcontentlength')?.textContent || '0';
        const lastModified = response.querySelector('getlastmodified')?.textContent || '';

        const name = displayName || href.split('/').filter(Boolean).pop() || '';
        if (!name.endsWith('.zip')) return;

        files.push({
            name,
            size: parseInt(contentLength, 10),
            lastModified,
            href: config.remotePath.replace(/\/+$/, '') + '/' + name,
        });
    });

    files.sort((a, b) => b.name.localeCompare(a.name));
    return files;
};

/**
 * Clean up old backups, keeping only the latest N
 */
export const cleanupOldBackups = async (config: CloudBackupConfig, keepCount: number = 5): Promise<number> => {
    const files = await listBackups(config);
    if (files.length <= keepCount) return 0;

    let deleted = 0;
    const toDelete = files.slice(keepCount);
    for (const file of toDelete) {
        if (await deleteBackup(config, file)) deleted++;
    }
    return deleted;
};

/**
 * Format file size for display
 */
export const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
