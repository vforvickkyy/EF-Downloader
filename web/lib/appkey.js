import { HttpError } from './http.js';
import { safeEqual } from './crypto.js';

/**
 * The app sends a shared key with every request. It is built into the app,
 * so it only keeps out casual junk; validation and rate limits do the rest.
 */
export function requireAppKey(request) {
  const expected = process.env.APP_KEY;
  if (!expected) throw new HttpError(503, 'Service not configured');
  if (!safeEqual(request.headers.get('x-app-key'), expected)) throw new HttpError(401, 'Unauthorized');
}

export const INSTALL_ID_RE = /^[a-f0-9]{16,64}$/;
