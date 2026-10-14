// Development runner: Vite dev server for the renderer + Electron for the shell.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import electron from 'electron';

execSync('node scripts/build-main.mjs', { stdio: 'inherit' });
const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls.local[0];
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
