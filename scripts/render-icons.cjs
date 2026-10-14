// Renders build/icon.svg to PNG sizes with Electron (no extra dependencies).
// Each size is rasterised directly from the vector (not downscaled), so small
// sizes stay crisp. Sizes <= ICON_SMALL_MAX (default 32) use build/icon-small.svg,
// a simplified variant tuned for 16-32px, when that file exists.
//
// usage: ICON_OUT=dir ICON_SIZES=1024,512,256 xvfb-run -a npx electron --no-sandbox scripts/render-icons.cjs
// Output: <ICON_OUT>/icon-<size>.png
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.disableHardwareAcceleration();
const root = path.join(__dirname, '..', 'build');
const out = process.env.ICON_OUT || 'build';
const sizes = (process.env.ICON_SIZES || '1024').split(',').map(Number).filter(Boolean);
const smallMax = Number(process.env.ICON_SMALL_MAX || 32);

const read = (f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : null);
const svgMain = read('icon.svg');
const svgSmall = read('icon-small.svg') || svgMain;

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
  for (const s of sizes) {
    const svg = s <= smallMax ? svgSmall : svgMain;
    const b64 = await win.webContents.executeJavaScript(`(async () => {
      const svg = ${JSON.stringify(svg)}.replace(/width="\\d+" height="\\d+"/, 'width="${s}" height="${s}"');
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = ${s};
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, ${s}, ${s});
      ctx.drawImage(img, 0, 0, ${s}, ${s});
      return c.toDataURL('image/png').split(',')[1];
    })()`);
    fs.writeFileSync(path.join(out, `icon-${s}.png`), Buffer.from(b64, 'base64'));
  }
  win.destroy();
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
