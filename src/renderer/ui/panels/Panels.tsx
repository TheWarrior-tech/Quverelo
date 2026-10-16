import { useEffect, useState } from 'react';
import { useEditor } from '../hooks';
import { useScrollEdges } from '../controls/Panel';
import { PropertiesPanel } from './PropertiesPanel';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { HistoryPanel } from './HistoryPanel';
import { SlicesPanel } from './SlicesPanel';
import { PanelTabs, loadTab, saveTab, type Tab } from './PanelTabs';

const KEY = 'quvrelo.inspectorTab.v3';

/**
 * Right inspector (DESIGN.md §8 v3). One column, tabbed by concern:
 * Design (the selection's properties, document when nothing is selected),
 * Adjust (Photo: live adjustments) and History. Structure and library live in
 * the left rail (LeftRail.tsx).
 */
export function Panels() {
  const ed = useEditor();
  const studio = ed.ui.studio;
  const tabs: Tab[] = [
    { id: 'properties', label: 'Design', render: () => <PropertiesPanel /> },
    ...(studio === 'photo' ? [{ id: 'adjust', label: 'Adjust', render: () => <AdjustmentsPanel /> }] : []),
    ...(studio === 'vector' ? [{ id: 'export', label: 'Export', render: () => <SlicesPanel /> }] : []),
    { id: 'history', label: 'History', render: () => <HistoryPanel /> },
  ];
  const fallback = studio === 'photo' ? 'adjust' : 'properties';
  const [active, setActive] = useState(() => loadTab(KEY, studio, fallback));
  useEffect(() => setActive(loadTab(KEY, studio, fallback)), [studio]);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  const scrollRef = useScrollEdges<HTMLDivElement>();
  const select = (id: string) => {
    setActive(id);
    saveTab(KEY, studio, id);
  };
  return (
    <aside className="panels inspector" aria-label="Inspector" data-group="inspector">
      <div className="panel-head">
        <PanelTabs tabs={tabs} active={tab.id} onSelect={select} label="Inspector" groupId="inspector" />
      </div>
      <div ref={scrollRef} id="inspector-body" className="panel-body" role="tabpanel" aria-labelledby={`inspector-tab-${tab.id}`} key={tab.id}>
        {tab.render()}
      </div>
    </aside>
  );
}
