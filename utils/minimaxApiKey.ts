import { APIConfig } from '../types';

export const normalizeApiKey = (raw: string): string => raw.trim().replace(/^Bearer\s+/i, '').trim();

export const resolveMiniMaxApiKey = (apiConfig: APIConfig): string => {
  const dedicated = normalizeApiKey(apiConfig.minimaxApiKey || '');
  if (dedicated) return dedicated;
  return normalizeApiKey(apiConfig.apiKey || '');
};
