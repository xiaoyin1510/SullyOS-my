import { getReiServer, handlerResultToResponse, internalErrorResponse, methodNotAllowed, preflightResponse, toHeaderObject } from './_shared/rei';

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return preflightResponse('DELETE');
  }

  if (req.method !== 'DELETE') {
    return methodNotAllowed('DELETE');
  }

  try {
    const rei = await getReiServer(req);
    const result = await rei.handlers.cancelMessage.DELETE(req.url, toHeaderObject(req));
    return handlerResultToResponse(result);
  } catch (error) {
    return internalErrorResponse(error);
  }
};
