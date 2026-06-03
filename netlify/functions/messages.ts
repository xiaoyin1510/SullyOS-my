import { getReiServer, handlerResultToResponse, internalErrorResponse, methodNotAllowed, preflightResponse, toHeaderObject } from './_shared/rei';

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return preflightResponse('GET');
  }

  if (req.method !== 'GET') {
    return methodNotAllowed('GET');
  }

  try {
    const rei = await getReiServer(req);
    const result = await rei.handlers.messages.GET(req.url, toHeaderObject(req));
    return handlerResultToResponse(result);
  } catch (error) {
    return internalErrorResponse(error);
  }
};
