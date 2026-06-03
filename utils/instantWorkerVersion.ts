// Single source of truth for Instant Push worker code version.
//
// Both the worker bundle (worker/instant-push/src/index.ts → /version route)
// and the SullyOS frontend (Settings 显示 + 部署对比 + 更新弹窗触发) import
// from here, so the date returned by the user's deployed worker and the date
// shown in the app cannot drift apart unless the bundle was rebuilt against
// an older source tree.
//
// Bump this whenever worker/instant-push/src/* gets a behavior change that
// requires users to redeploy their worker. Use YYYY-MM-DD; the frontend
// compares strings directly.
export const INSTANT_WORKER_VERSION = '2026-06-01';
