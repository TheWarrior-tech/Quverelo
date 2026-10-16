/**
 * Layout studio commands: tables, auto-flow, page-number fields, master
 * overrides, the baseline grid and the Styles / Preflight panels. Registered
 * into the shared command registry so menus, the palette and tests run them by id.
 */
import { addNodes, updateNode } from '../../core/commands';
import { findNode } from '../../core/document';
import { autoFlow, overrideAllMasterItems, removeMasterOverrides } from '../../core/layout';
import { fitRowsToContent, makeTable } from '../../core/tables';
import { FIELD_PAGE, FIELD_PAGE_COUNT, FIELD_SECTION, sheetOf } from '../../core/typography';
import { measureText, storyFlow } from '../engine/draw';
import { editor } from './editor';
import { toast } from './bus';
import { getViewport, registerCommand } from './commands';

/** Ask the left rail / inspector to show a tab (StylesPanel, PreflightPanel). */
export function showPanelTab(group: 'structure' | 'inspector', tab: string): void {
  window.dispatchEvent(new CustomEvent('quvrelo:show-tab', { detail: { group, tab } }));
}

function currentPage() {
  const doc = editor.doc;
  if (!doc) return null;
  const pi = editor.ui.activeContainerId ? editor.activePageIndex : 0;
  return pi >= 0 ? doc.pages[pi] : null;
}

function targetFrame() {
  const doc = editor.doc;
  const id = editor.ui.editingTextId ?? editor.ui.selection[0];
  const n = doc && id ? findNode(doc, id)?.node : null;
  return n?.type === 'textframe' ? n : null;
}

registerCommand('table.insert', () => {
  const doc = editor.doc;
  const container = editor.activeContainer;
  if (!doc || !container) return;
  const s = doc.settings;
  const innerW = s.width - s.margins.left - s.margins.right;
  const w = Math.max(120, Math.min(innerW || s.width * 0.8, s.width * 0.8));
  const t = makeTable(4, 3, { w, h: 4 * 28 });
  t.x = (s.margins.left || (s.width - w) / 2) + w / 2;
  t.y = (s.margins.top || s.height * 0.1) + t.h / 2;
  t.headerRows = 1;
  t.cells = t.cells.map((row, r) => row.map((c, ci) => ({ ...c, text: r === 0 ? `Heading ${ci + 1}` : '' })));
  editor.commit('Insert table', (d) => addNodes(d, container.id, [t]));
  editor.select([t.id]);
  editor.setUi({ tableCell: { nodeId: t.id, r: 0, c: 0 } });
});

registerCommand('table.fit-rows', () => {
  const n = editor.selectedNodes().find((x) => x.type === 'table');
  if (!n) return toast('Select a table first');
  editor.commit('Fit rows to text', (d) => updateNode(d, n.id, (x) => (x.type === 'table' ? fitRowsToContent(x, sheetOf(d), measureText) : x)));
});

registerCommand('text.autoflow', () => {
  const f = targetFrame();
  if (!f) return toast('Select the text frame whose text is overset');
  let added = 0;
  getViewport()?.textEdit.end();
  editor.commit('Auto-flow', (d) => {
    const r = autoFlow(d, f.id, (x, sid) => storyFlow(x, sid));
    added = r.pagesAdded;
    return r.doc;
  });
  toast(added ? `Added ${added} page${added === 1 ? '' : 's'} with linked frames` : 'The text already fits');
});

function insertField(ch: string, label: string) {
  const vp = getViewport();
  if (!vp?.textEdit.rich) return toast(`Click into a text frame to insert the ${label}`);
  vp.textEdit.insert(ch);
}
registerCommand('text.insert-page-number', () => insertField(FIELD_PAGE, 'page number'));
registerCommand('text.insert-page-count', () => insertField(FIELD_PAGE_COUNT, 'page count'));
registerCommand('text.insert-section-name', () => insertField(FIELD_SECTION, 'section name'));

registerCommand('master.override-all', () => {
  const p = currentPage();
  if (!p?.masterId) return toast('This page has no master');
  editor.commit('Override master items', (d) => overrideAllMasterItems(d, p.id));
});
registerCommand('master.remove-overrides', () => {
  const p = currentPage();
  if (!p?.overrides?.length) return toast('This page has no overridden master items');
  editor.commit('Remove overrides', (d) => removeMasterOverrides(d, p.id));
});

registerCommand('view.baseline-grid', () => {
  const doc = editor.doc;
  if (!doc) return;
  const g = doc.settings.baselineGrid;
  const next = g?.enabled ? { ...g, visible: !g.visible } : { enabled: true, visible: true, start: doc.settings.margins.top || 36, increment: 18 };
  editor.commit('Baseline grid', (d) => ({ ...d, settings: { ...d.settings, baselineGrid: next } }));
});

registerCommand('layout.preflight', () => {
  if (editor.ui.studio !== 'layout') editor.setStudio('layout');
  showPanelTab('inspector', 'preflight');
});
registerCommand('text.styles', () => {
  if (editor.ui.studio !== 'layout') editor.setStudio('layout');
  showPanelTab('structure', 'styles');
});
