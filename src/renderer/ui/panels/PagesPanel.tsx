import { useEffect, useState } from 'react';
import { movePage, removeMaster, renamePage, setPageMaster } from '../../../core/commands';
import type { QuvreloDocument } from '../../../core/types';
import { runCommand } from '../../state/commands';
import { useEditor } from '../hooks';
import { DocThumb } from '../Welcome';
import { Icon } from '../Icons';

/** Debounce document snapshots for thumbnails so typing stays fast. */
function useDebouncedDoc(doc: QuvreloDocument, ms = 500): QuvreloDocument {
  const [d, setD] = useState(doc);
  useEffect(() => {
    const t = window.setTimeout(() => setD(doc), ms);
    return () => window.clearTimeout(t);
  }, [doc, ms]);
  return d;
}

export function PagesPanel() {
  const ed = useEditor();
  const doc = useDebouncedDoc(ed.doc!);
  const live = ed.doc!;
  const active = ed.ui.activeContainerId;
  const pageIdx = ed.activePageIndex;
  const curPage = live.pages[pageIdx];
  return (
    <div>
      <div className="section">
        <div className="section-title">
          Pages ({live.pages.length})
          <span>
            <button className="icon-btn sm" title="Add page" aria-label="Add page" onClick={() => runCommand('page.add')}><Icon name="plus" /></button>
            <button className="icon-btn sm" title="Duplicate page" aria-label="Duplicate page" onClick={() => runCommand('page.duplicate')}><Icon name="copy" /></button>
            <button className="icon-btn sm" title="Move page earlier" aria-label="Move page earlier" disabled={pageIdx <= 0} onClick={() => ed.commit('Move page', (d) => movePage(d, curPage.id, pageIdx - 1))}><Icon name="chevron-left" /></button>
            <button className="icon-btn sm" title="Move page later" aria-label="Move page later" disabled={pageIdx < 0 || pageIdx >= live.pages.length - 1} onClick={() => ed.commit('Move page', (d) => movePage(d, curPage.id, pageIdx + 1))}><Icon name="chevron-right" /></button>
            <button className="icon-btn sm" title="Delete page" aria-label="Delete page" disabled={live.pages.length < 2} onClick={() => runCommand('page.delete')}><Icon name="trash" /></button>
          </span>
        </div>
        <div className="pages-grid">
          {live.pages.map((p, i) => (
            <button key={p.id} className={`page-thumb ${active === p.id ? 'active' : ''}`} onClick={() => ed.setUi({ activeContainerId: p.id, selection: [] })} aria-label={`Go to ${p.name}`} aria-current={active === p.id}>
              {doc.pages[i] && doc.pages[i].id === p.id ? <DocThumb doc={doc} pageIndex={i} max={110} /> : <DocThumb doc={live} pageIndex={i} max={110} />}
              <span>{p.name}{p.masterId ? ` · ${live.masters.find((m) => m.id === p.masterId)?.name.split('-')[0] ?? ''}` : ''}</span>
            </button>
          ))}
        </div>
      </div>
      {curPage && (
        <div className="section">
          <div className="section-title">This page</div>
          <div className="row">
            <label>Name</label>
            <input type="text" value={curPage.name} aria-label="Page name" onChange={(e) => ed.commit('Rename page', (d) => renamePage(d, curPage.id, e.target.value), 'pname')} />
          </div>
          <div className="row">
            <label>Master</label>
            <select value={curPage.masterId ?? ''} aria-label="Master page" onChange={(e) => ed.commit('Apply master', (d) => setPageMaster(d, curPage.id, e.target.value || null))}>
              <option value="">None</option>
              {live.masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="section">
        <div className="section-title">
          Master pages
          <button className="icon-btn sm" title="Add master page" aria-label="Add master page" onClick={() => runCommand('master.add')}><Icon name="plus" /></button>
        </div>
        {live.masters.length === 0 && <p className="empty-note" style={{ padding: 4 }}>Masters hold headers, footers and backgrounds shared by many pages.</p>}
        {live.masters.map((m) => (
          <div className="row" key={m.id}>
            <span style={{ flex: 1, fontWeight: active === m.id ? 600 : 400 }}>{m.name}</span>
            <button className="btn sm ghost" onClick={() => ed.setUi({ activeContainerId: m.id, selection: [] })}>{active === m.id ? 'Editing' : 'Edit'}</button>
            <button className="icon-btn sm" aria-label={`Delete ${m.name}`} title="Delete master" onClick={() => {
              ed.commit('Delete master', (d) => removeMaster(d, m.id));
              if (active === m.id) ed.setUi({ activeContainerId: live.pages[0].id });
            }}><Icon name="trash" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
