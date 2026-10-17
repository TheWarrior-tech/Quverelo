/**
 * electron-builder afterPack hook (macOS only).
 *
 * Quvrelo ships without an Apple Developer ID (Finley's decision, Oct 2026). With
 * `identity: null` electron-builder skips signing entirely, which leaves Electron's
 * original signature broken once the app is renamed and resources are added. On
 * Apple Silicon macOS then refuses to launch it with "Quvrelo is damaged and can't
 * be opened". An ad-hoc signature ("-") makes the bundle internally valid, so macOS
 * shows the normal "unverified developer" prompt and System Settings > Privacy &
 * Security > Open Anyway works.
 *
 * Skipped when a real signing identity is configured (CSC_LINK set by CI).
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK) {
    console.log('  • mac-adhoc-sign: CSC_LINK present, leaving signing to electron-builder');
    return;
  }
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const app = path.join(context.appOutDir, appName);
  console.log(`  • mac-adhoc-sign: ad-hoc signing ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
