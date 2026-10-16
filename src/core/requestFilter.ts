/**
 * Renderer request filter (wired into session.webRequest.onBeforeRequest in main.ts).
 *
 * Quvrelo is offline by design: the renderer may only load bundled/local resources.
 * The Vite dev server (http + its HMR websocket on localhost) is allowed only in an
 * unpackaged development run with VITE_DEV_SERVER_URL set. Packaged builds never allow
 * any http(s) or ws(s) URL, whatever the environment says.
 */
export interface RequestFilterEnv {
  /** app.isPackaged */
  packaged: boolean;
  /** process.env.VITE_DEV_SERVER_URL (only honoured when not packaged) */
  devServerUrl?: string;
}

const LOCAL_SCHEMES = ['file:', 'data:', 'blob:', 'devtools:'];

/** Origins (http + ws) of the dev server, or [] when dev access is not allowed. */
export function devOrigins(env: RequestFilterEnv): string[] {
  if (env.packaged || !env.devServerUrl) return [];
  let u: URL;
  try {
    u = new URL(env.devServerUrl);
  } catch {
    return [];
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return [];
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return [];
  const ws = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return [`${u.protocol}//${u.host}`, `${ws}//${u.host}`];
}

/** True when the renderer request may proceed. */
export function isRequestAllowed(url: string, env: RequestFilterEnv): boolean {
  if (LOCAL_SCHEMES.some((s) => url.startsWith(s))) return true;
  const origins = devOrigins(env);
  if (!origins.length) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return origins.includes(`${u.protocol}//${u.host}`);
}
