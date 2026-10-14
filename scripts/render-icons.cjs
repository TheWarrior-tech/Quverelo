// Renders build/icon.svg to PNG sizes with Electron (no extra dependencies).
// usage: ICON_OUT=dir ICON_SIZES=1024,512,256 xvfb-run -a npx electron --no-sandbox scripts/render-icons.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
const out = process.env.ICON_OUT || 'build';
const sizes = (process.env.ICON_SIZES || '1024').split(',');
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
  for (const s of sizes.map(Number).filter(Boolean)) {
    const win = new BrowserWindow({ show: false, width: s, height: s, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: false } });
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('width="1024" height="1024"', `width="${s}" height="${s}"`)}</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 200));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: s, height: s });
    fs.writeFileSync(path.join(out, `icon-${s}.png`), img.toPNG());
    win.destroy();
  }
  app.quit();
});
