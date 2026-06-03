import { getReiServer, handlerResultToResponse, internalErrorResponse, methodNotAllowed, preflightResponse, readRequestBody, toHeaderObject } from './_shared/rei';

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return preflightResponse('PUT');
  }

  if (req.method !== 'PUT') {
    return methodNotAllowed('PUT');
  }

  try {
    const rei = await getReiServer(req);
    const result = await rei.handlers.updateMessage.PUT(req.url, toHeaderObject(req), await readRequestBody(req));
    return handlerResultToResponse(result);
  } catch (error) {
    return internalErrorResponse(error);
  }
};
