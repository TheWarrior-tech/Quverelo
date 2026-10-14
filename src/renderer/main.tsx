import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/roboto-slab/400.css';
import '@fontsource/roboto-slab/700.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import './styles.css';
import { App } from './ui/App';
import { editor } from './state/editor';
import { resetMeasureCache } from './engine/draw';
import { browserFallbackApi } from './state/fallbackApi';

async function boot() {
  if (!window.easel) window.easel = browserFallbackApi();
  const [policy, settings] = await Promise.all([window.easel.getPolicy(), window.easel.getSettings()]);
  editor.policy = policy;
  editor.settings = settings;
  editor.ui.studio = settings.lastStudio;
  // re-measure text once bundled fonts are ready so layout is exact
  document.fonts.ready.then(() => {
    resetMeasureCache();
    editor.emitNow();
  });
  createRoot(document.getElementById('root')!).render(<App />);
}

void boot();
