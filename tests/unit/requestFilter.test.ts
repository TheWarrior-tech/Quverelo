import { describe, it, expect } from 'vitest';
import { devOrigins, isRequestAllowed } from '../../src/core/requestFilter';

const DEV = 'http://localhost:5173/';

describe('renderer request filter', () => {
  it('always allows bundled/local schemes', () => {
    for (const env of [{ packaged: true }, { packaged: false }, { packaged: false, devServerUrl: DEV }]) {
      for (const u of ['file:///app/dist/index.html', 'data:image/png;base64,AA', 'blob:file:///x', 'devtools://devtools/x']) {
        expect(isRequestAllowed(u, env)).toBe(true);
      }
    }
  });

  it('packaged builds block every http(s)/ws(s) URL, even with VITE_DEV_SERVER_URL set', () => {
    const env = { packaged: true, devServerUrl: DEV };
    expect(devOrigins(env)).toEqual([]);
    for (const u of ['ws://localhost:5173/', 'ws://localhost/', 'http://localhost:5173/src/main.tsx', 'https://example.com/', 'wss://localhost:5173/']) {
      expect(isRequestAllowed(u, env)).toBe(false);
    }
  });

  it('unpackaged runs without a dev server block localhost websockets too', () => {
    const env = { packaged: false };
    expect(isRequestAllowed('ws://localhost:5173/', env)).toBe(false);
    expect(isRequestAllowed('ws://localhost/', env)).toBe(false);
    expect(isRequestAllowed('http://localhost:5173/', env)).toBe(false);
  });

  it('dev runs allow only the dev server origin (http and its HMR websocket)', () => {
    const env = { packaged: false, devServerUrl: DEV };
    expect(devOrigins(env)).toEqual(['http://localhost:5173', 'ws://localhost:5173']);
    expect(isRequestAllowed('http://localhost:5173/src/main.tsx', env)).toBe(true);
    expect(isRequestAllowed('ws://localhost:5173/?token=abc', env)).toBe(true);
    expect(isRequestAllowed('ws://localhost:9999/', env)).toBe(false);
    expect(isRequestAllowed('http://localhost:5174/', env)).toBe(false);
    expect(isRequestAllowed('https://fonts.googleapis.com/css', env)).toBe(false);
    // Prefix tricks do not pass.
    expect(isRequestAllowed('http://localhost:5173.evil.com/', env)).toBe(false);
    expect(isRequestAllowed('ws://localhost.evil.com:5173/', env)).toBe(false);
  });

  it('a non-local dev server URL is ignored', () => {
    expect(devOrigins({ packaged: false, devServerUrl: 'http://192.168.1.5:5173/' })).toEqual([]);
    expect(devOrigins({ packaged: false, devServerUrl: 'not a url' })).toEqual([]);
  });
});
