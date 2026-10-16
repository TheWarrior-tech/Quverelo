import { useEffect, useState } from 'react';
import { useEditor } from '../hooks';
import { useScrollEdges } from '../controls/Panel';
import { LayersPanel } from './LayersPanel';
import { PagesPanel } from './PagesPanel';
import { AssetsPanel } from './AssetsPanel';
import { SwatchesPanel } from './SwatchesPanel';
import { StylesPanel } from './StylesPanel';
import { PanelTabs, loadTab, saveTab, useShowTab, type Tab } from './PanelTabs';

const KEY = 'quvrelo.leftTab.v3';

/** Assets tab: document swatches and recent colours, then shapes and placed images. */
function LibraryPanel() {
  return (
    <div className="library-panel">
      <SwatchesPanel />
      <AssetsPanel />
    </div>
  );
}

/**
 * Left rail (DESIGN.md §8 v3, MOBBIN #2): one column with three tabs, as in
 * Figma and Framer. Layers is the default in Photo and Vector, Pages in Layout;
 * the choice is remembered per studio.
 */
export function LeftRail() {
  const ed = useEditor();
  const studio = ed.ui.studio;
  const tabs: Tab[] = [
    { id: 'layers', label: 'Layers', render: () => <LayersPanel />, flush: true },
    { id: 'pages', label: 'Pages', render: () => <PagesPanel /> },
    // Layout: paragraph / character / cell styles (InDesign's Styles panels)
    ...(studio === 'layout' ? [{ id: 'styles', label: 'Styles', render: () => <StylesPanel /> }] : []),
    { id: 'assets', label: 'Assets', render: () => <LibraryPanel /> },
  ];
  const fallback = studio === 'layout' ? 'pages' : 'layers';
  const [active, setActive] = useState(() => loadTab(KEY, studio, fallback));
  useEffect(() => setActive(loadTab(KEY, studio, fallback)), [studio]);
  useShowTab('structure', (t) => {
    setActive(t);
    saveTab(KEY, studio, t);
  });
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  const scrollRef = useScrollEdges<HTMLDivElement>();
  const select = (id: string) => {
    setActive(id);
    saveTab(KEY, studio, id);
  };
  return (
    <aside className="left-rail" aria-label="Document" data-group="structure">
      <div className="panel-head">
        <PanelTabs tabs={tabs} active={tab.id} onSelect={select} label="Document" groupId="structure" />
      </div>
      <div ref={scrollRef} id="structure-body" className={`panel-body${tab.flush ? ' flush' : ''}`} role="tabpanel" aria-labelledby={`structure-tab-${tab.id}`} key={tab.id}>
        {tab.render()}
      </div>
    </aside>
  );
}
