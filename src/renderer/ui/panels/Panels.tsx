import { useEffect, useState } from 'react';
import { useEditor } from '../hooks';
import { useScrollEdges } from '../controls/Panel';
import { PropertiesPanel } from './PropertiesPanel';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { HistoryPanel } from './HistoryPanel';
import { HistogramPanel } from './HistogramPanel';
import { SlicesPanel } from './SlicesPanel';
import { PreflightPanel, usePreflight } from './PreflightPanel';
import { PanelTabs, loadTab, saveTab, useShowTab, type Tab } from './PanelTabs';
import { ScriptsPanel } from './ScriptsPanel';
import { onInspectorTab } from '../../state/bus';

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
  const issues = usePreflight(studio === 'layout' ? ed.doc : null, 800);
  const preflightErrors = issues.filter((i) => i.severity === 'error').length;
  const tabs: Tab[] = [
    { id: 'properties', label: 'Design', render: () => <PropertiesPanel /> },
    ...(studio === 'photo' ? [{ id: 'adjust', label: 'Adjust', render: () => <AdjustmentsPanel /> }, { id: 'histogram', label: 'Histogram', render: () => <HistogramPanel /> }] : []),
    // Layout: live preflight; the tab carries the error count
    ...(studio === 'layout' ? [{ id: 'preflight', label: 'Preflight', badge: preflightErrors || undefined, render: () => <PreflightPanel /> }] : []),
    ...(studio === 'vector' ? [{ id: 'export', label: 'Export', render: () => <SlicesPanel /> }] : []),
    { id: 'history', label: 'History', render: () => <HistoryPanel /> },
    ...(ed.feature('scripting') ? [{ id: 'scripts', label: 'Scripts', render: () => <ScriptsPanel /> }] : []),
  ];
  const fallback = studio === 'photo' ? 'adjust' : 'properties';
  const [active, setActive] = useState(() => loadTab(KEY, studio, fallback));
  useEffect(() => setActive(loadTab(KEY, studio, fallback)), [studio]);
  useShowTab('inspector', (t) => {
    setActive(t);
    saveTab(KEY, studio, t);
  });
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  const scrollRef = useScrollEdges<HTMLDivElement>();
  const select = (id: string) => {
    setActive(id);
    saveTab(KEY, studio, id);
  };
  useEffect(() => onInspectorTab((id) => {
    setActive(id);
    saveTab(KEY, studio, id);
  }), [studio]);
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
