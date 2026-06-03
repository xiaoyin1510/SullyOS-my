import { getReiServer, handlerResultToResponse, internalErrorResponse, methodNotAllowed, preflightResponse, readRequestBody, toHeaderObject } from './_shared/rei';

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return preflightResponse('POST');
  }

  if (req.method !== 'POST') {
    return methodNotAllowed('POST');
  }

  try {
    const rei = await getReiServer(req);
    const result = await rei.handlers.initTenant.POST(toHeaderObject(req), await readRequestBody(req));
    return handlerResultToResponse(result);
  } catch (error) {
    return internalErrorResponse(error);
  }
};
