import { useEffect, useState } from 'react';
import { useEditor } from '../hooks';
import { PropertiesPanel } from './PropertiesPanel';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { LayersPanel } from './LayersPanel';
import { PagesPanel } from './PagesPanel';
import { HistoryPanel } from './HistoryPanel';
import { ColorPanel } from './ColorPanel';
import { SwatchesPanel } from './SwatchesPanel';
import { AssetsPanel } from './AssetsPanel';

type Tab = { id: string; label: string; render: () => JSX.Element };

function PanelGroup({ tabs, initial, grow, height, label }: { tabs: Tab[]; initial: string; grow?: boolean; height?: number; label: string }) {
  const [active, setActive] = useState(initial);
  useEffect(() => setActive(initial), [initial]);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <section className={`panel-group ${grow ? 'grow' : ''}`} style={height ? { height, flex: 'none' } : undefined} aria-label={label}>
      <div className="panel-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab.id} className={t.id === tab.id ? 'active' : ''} onClick={() => setActive(t.id)} data-panel={t.id}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-body" role="tabpanel">{tab.render()}</div>
    </section>
  );
}

export function Panels() {
  const ed = useEditor();
  const studio = ed.ui.studio;
  const top: Tab[] = [
    { id: 'properties', label: 'Properties', render: () => <PropertiesPanel /> },
    ...(studio === 'photo' ? [{ id: 'adjust', label: 'Adjustments', render: () => <AdjustmentsPanel /> }] : []),
    { id: 'colour', label: 'Colour', render: () => <ColorPanel /> },
  ];
  const middle: Tab[] = [
    { id: 'layers', label: 'Layers', render: () => <LayersPanel /> },
    { id: 'pages', label: 'Pages', render: () => <PagesPanel /> },
    { id: 'history', label: 'History', render: () => <HistoryPanel /> },
  ];
  const bottom: Tab[] = [
    { id: 'swatches', label: 'Swatches', render: () => <SwatchesPanel /> },
    { id: 'assets', label: 'Assets', render: () => <AssetsPanel /> },
  ];
  return (
    <aside className="panels" aria-label="Panels">
      <PanelGroup label="Inspector" tabs={top} initial={studio === 'photo' ? 'adjust' : 'properties'} height={340} />
      <PanelGroup label="Document structure" tabs={middle} initial={studio === 'layout' ? 'pages' : 'layers'} grow />
      <PanelGroup label="Library" tabs={bottom} initial="swatches" height={170} />
    </aside>
  );
}
