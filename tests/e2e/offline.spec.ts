/**
 * Offline audit: the renderer cannot reach the network. A local HTTP server on
 * localhost (which also accepts websocket upgrades) must see zero connections.
 * Layer 1 is the renderer CSP; layer 2 is the session.webRequest filter, which in a
 * non-dev run must block ws://localhost too (it is allowed only for the Vite dev server).
 */
import { test, expect } from '@playwright/test';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { launch } from './helpers';

test('renderer requests to localhost http and ws are blocked outside dev', async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    res.end('ok');
  });
  server.on('upgrade', (_req, socket) => {
    hits++;
    socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const { app, page } = await launch();
  try {
    const result = await page.evaluate(async (p) => {
      const out: Record<string, string> = {};
      try {
        await fetch(`http://localhost:${p}/x`);
        out.fetch = 'loaded';
      } catch {
        out.fetch = 'blocked';
      }
      out.ws = await new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${p}/hmr`);
        ws.onopen = () => resolve('open');
        ws.onerror = () => resolve('blocked');
        setTimeout(() => resolve('timeout'), 5000);
      });
      out.img = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => resolve('loaded');
        img.onerror = () => resolve('blocked');
        img.src = `http://127.0.0.1:${p}/i.png`;
      });
      return out;
    }, port);
    expect(result).toEqual({ fetch: 'blocked', ws: 'blocked', img: 'blocked' });
    expect(hits).toBe(0);
    // Layer 2: the session request filter. A CSP-free page in the default session
    // (so only onBeforeRequest stands in the way) tries the same URLs.
    await app.evaluate(async ({ BrowserWindow }, p) => {
      const w = new BrowserWindow({ show: false });
      const html = `<img src="http://localhost:${p}/i.png"><script>new WebSocket("ws://localhost:${p}/hmr");fetch("http://localhost:${p}/f").catch(()=>{})</script>`;
      await w.loadURL('data:text/html,' + encodeURIComponent(html));
      await new Promise((r) => setTimeout(r, 1500));
      w.destroy();
    }, port);
    expect(hits).toBe(0);
    const blocked = await app.evaluate(() => (globalThis as { __quvreloBlocked?: string[] }).__quvreloBlocked ?? []);
    expect(blocked.some((u) => u.startsWith(`ws://localhost:${port}`))).toBe(true);
    expect(blocked.some((u) => u.startsWith(`http://localhost:${port}`))).toBe(true);
  } finally {
    await app.close();
    server.close();
  }
});
