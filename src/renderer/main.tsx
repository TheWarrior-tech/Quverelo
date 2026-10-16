import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
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
import './assets/fonts/eb-garamond/eb-garamond.css';
import './styles.css';
import './ui/panels.css';
import './ui/shell.css';
import './ui/layout.css';
import './ui/vector.css';
import { App } from './ui/App';
import { editor } from './state/editor';
import { resetMeasureCache } from './engine/draw';
import { onFeatureFontsChanged } from './engine/otFonts';
import { getViewport } from './state/commands';
import { browserFallbackApi } from './state/fallbackApi';

async function boot() {
  if (!window.quvrelo) window.quvrelo = browserFallbackApi();
  const [policy, settings] = await Promise.all([window.quvrelo.getPolicy(), window.quvrelo.getSettings()]);
  editor.policy = policy;
  editor.settings = settings;
  editor.ui.studio = settings.lastStudio;
  // re-measure text once bundled fonts are ready so layout is exact
  document.fonts.ready.then(() => {
    resetMeasureCache();
    editor.emitNow();
  });
  // OpenType feature faces load on demand: re-measure and redraw when one is ready
  onFeatureFontsChanged(() => {
    resetMeasureCache();
    getViewport()?.render();
    editor.emitNow();
  });
  createRoot(document.getElementById('root')!).render(<App />);
}

void boot();
