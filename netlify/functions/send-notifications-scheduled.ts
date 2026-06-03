import { buildBackgroundFunctionUrl, createCronTokenForTenant, internalErrorResponse, jsonResponse, listTenantIds } from './_shared/rei';

export const config = {
  schedule: '* * * * *',
};

export default async (req: Request) => {
  try {
    const tenantIds = await listTenantIds();
    if (tenantIds.length === 0) {
      return jsonResponse({
        success: true,
        data: {
          tenantCount: 0,
          queued: 0,
          message: 'No ActiveMsg 2.0 tenants found.',
        },
      });
    }

    const results = await Promise.allSettled(tenantIds.map(async (tenantId) => {
      const search = new URLSearchParams({ token: createCronTokenForTenant(tenantId) }).toString();
      const response = await fetch(buildBackgroundFunctionUrl(req, `?${search}`), {
        method: 'POST',
      });

      return {
        tenantId,
        status: response.status,
        ok: response.ok,
      };
    }));

    const queued = results.filter((result) => result.status === 'fulfilled' && result.value.ok).length;
    const failed = results
      .filter((result) => result.status === 'rejected' || !result.value.ok)
      .map((result) => result.status === 'rejected'
        ? { tenantId: 'unknown', error: result.reason instanceof Error ? result.reason.message : 'Unknown error' }
        : { tenantId: result.value.tenantId, error: `HTTP ${result.value.status}` });

    return jsonResponse({
      success: true,
      data: {
        tenantCount: tenantIds.length,
        queued,
        failed,
      },
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
};
