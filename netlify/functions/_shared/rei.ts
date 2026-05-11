import { getStore } from '@netlify/blobs';
import { createReiServer, createTenantToken } from '@rei-standard/amsg-server';

type ReiHandlerResult = {
  status: number;
  body: Record<string, any>;
};

type ReiServer = Awaited<ReturnType<typeof createReiServer>>;

const ACTIVE_MSG_NAMESPACE = (process.env.AMSG_BLOB_NAMESPACE || 'rei-tenants').trim() || 'rei-tenants';
const ACTIVE_MSG_CORS_ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Init-Secret',
  'X-User-Id',
  'X-Response-Encrypted',
  'X-Payload-Encrypted',
  'X-Encryption-Version',
].join(', ');
const reiServerCache = new Map<string, Promise<ReiServer>>();

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[ActiveMsg2] Missing environment variable: ${name}`);
  }
  return value;
};

export const resolvePublicBaseUrl = (req: Request) => {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  return new URL(req.url).origin.replace(/\/+$/, '');
};

export const getReiServer = async (req: Request) => {
  const publicBaseUrl = resolvePublicBaseUrl(req);
  if (!reiServerCache.has(publicBaseUrl)) {
    reiServerCache.set(publicBaseUrl, createReiServer({
      vapid: {
        email: getRequiredEnv('VAPID_EMAIL'),
        publicKey: getRequiredEnv('VITE_AMSG_VAPID_PUBLIC_KEY'),
        privateKey: getRequiredEnv('VAPID_PRIVATE_KEY'),
      },
      tenant: {
        blobNamespace: ACTIVE_MSG_NAMESPACE,
        kek: getRequiredEnv('AMSG_TENANT_KEK'),
        tokenSigningKey: getRequiredEnv('AMSG_TOKEN_SIGNING_KEY'),
        initSecret: process.env.AMSG_INIT_SECRET?.trim() || undefined,
        publicBaseUrl,
      },
    }));
  }

  return reiServerCache.get(publicBaseUrl)!;
};

export const createCronTokenForTenant = (tenantId: string) => {
  return createTenantToken({ tenantId, type: 'cron' }, getRequiredEnv('AMSG_TOKEN_SIGNING_KEY'));
};

export const listTenantIds = async () => {
  const store = getStore(ACTIVE_MSG_NAMESPACE);
  const { blobs } = await store.list({ prefix: 'tenant/' });
  return blobs
    .map((entry) => entry.key.replace(/^tenant\//, '').trim())
    .filter(Boolean);
};

export const toHeaderObject = (req: Request) => Object.fromEntries(req.headers.entries());

export const readRequestBody = (req: Request) => req.text();

export const jsonResponse = (body: Record<string, any>, status = 200, headers?: HeadersInit) => {
  const nextHeaders = new Headers(headers);
  if (!nextHeaders.has('Content-Type')) {
    nextHeaders.set('Content-Type', 'application/json; charset=utf-8');
  }
  nextHeaders.set('Cache-Control', 'no-store');
  if (!nextHeaders.has('Access-Control-Allow-Origin')) {
    nextHeaders.set('Access-Control-Allow-Origin', '*');
  }
  if (!nextHeaders.has('Access-Control-Allow-Headers')) {
    nextHeaders.set('Access-Control-Allow-Headers', ACTIVE_MSG_CORS_ALLOWED_HEADERS);
  }
  if (!nextHeaders.has('Access-Control-Allow-Methods')) {
    nextHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (!nextHeaders.has('Access-Control-Max-Age')) {
    nextHeaders.set('Access-Control-Max-Age', '86400');
  }
  return new Response(JSON.stringify(body), { status, headers: nextHeaders });
};

export const preflightResponse = (allowed: string) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': ACTIVE_MSG_CORS_ALLOWED_HEADERS,
      'Access-Control-Allow-Methods': `${allowed}, OPTIONS`,
      'Access-Control-Max-Age': '86400',
      Allow: `${allowed}, OPTIONS`,
    },
  });
};

export const handlerResultToResponse = (result: ReiHandlerResult) => {
  return jsonResponse(result.body || {}, result.status || 200);
};

export const methodNotAllowed = (allowed: string) => {
  return jsonResponse({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `Method not allowed. Use ${allowed}.`,
    },
  }, 405, {
    Allow: `${allowed}, OPTIONS`,
    'Access-Control-Allow-Methods': `${allowed}, OPTIONS`,
  });
};

export const internalErrorResponse = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error('[ActiveMsg2 Function]', message);
  return jsonResponse({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  }, 500);
};

export const buildBackgroundFunctionUrl = (req: Request, search = '') => {
  const url = new URL('/.netlify/functions/send-notifications-background', req.url);
  url.search = search;
  return url.toString();
};



