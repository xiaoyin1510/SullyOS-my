import { buildBackgroundFunctionUrl, internalErrorResponse, jsonResponse, methodNotAllowed, preflightResponse } from './_shared/rei';

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return preflightResponse('POST');
  }

  if (req.method !== 'POST') {
    return methodNotAllowed('POST');
  }

  try {
    const headers = new Headers();
    const authorization = req.headers.get('authorization');
    if (authorization) {
      headers.set('authorization', authorization);
    }

    const backgroundResponse = await fetch(buildBackgroundFunctionUrl(req, new URL(req.url).search), {
      method: 'POST',
      headers,
    });

    if (!backgroundResponse.ok) {
      return jsonResponse({
        success: false,
        error: {
          code: 'BACKGROUND_QUEUE_FAILED',
          message: `Failed to queue background dispatch (HTTP ${backgroundResponse.status}).`,
        },
      }, 502);
    }

    return jsonResponse({
      success: true,
      data: {
        queued: true,
        message: 'send-notifications has been handed off to the background function.',
      },
    }, 202);
  } catch (error) {
    return internalErrorResponse(error);
  }
};
