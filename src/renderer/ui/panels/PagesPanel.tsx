import { tip } from '../tooltip';
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

/** Page indices grouped into spreads: page 1 alone on the right, then pairs. */
export function spreads(count: number): number[][] {
  const out: number[][] = [];
  if (count > 0) out.push([0]);
  for (let i = 1; i < count; i += 2) out.push(i + 1 < count ? [i, i + 1] : [i]);
  return out;
}

export function PagesPanel() {
  const ed = useEditor();
  const doc = useDebouncedDoc(ed.doc!);
  const live = ed.doc!;
  const active = ed.ui.activeContainerId;
  const pageIdx = ed.activePageIndex;
  const curPage = live.pages[pageIdx];
  const thumb = (i: number) => {
    const p = live.pages[i];
    return (
      <button key={p.id} className={`page-thumb ${active === p.id ? 'active' : ''}`} onClick={() => ed.setUi({ activeContainerId: p.id, selection: [] })} aria-label={`Go to ${p.name}`} aria-current={active === p.id}>
        {doc.pages[i] && doc.pages[i].id === p.id ? <DocThumb doc={doc} pageIndex={i} max={live.settings.facingPages ? 96 : 110} /> : <DocThumb doc={live} pageIndex={i} max={live.settings.facingPages ? 96 : 110} />}
        <span>{p.name}{p.masterId ? ` · ${live.masters.find((m) => m.id === p.masterId)?.name.split('-')[0] ?? ''}` : ''}</span>
      </button>
    );
  };
  return (
    <div>
      <div className="section">
        <div className="section-title">
          Pages ({live.pages.length})
          <span>
            <button className="icon-btn sm" {...tip('Add page', 'page.add')} onClick={() => runCommand('page.add')}><Icon name="plus" /></button>
            <button className="icon-btn sm" data-tip="Duplicate page" aria-label="Duplicate page" onClick={() => runCommand('page.duplicate')}><Icon name="copy" /></button>
            <button className="icon-btn sm" data-tip="Move page earlier" aria-label="Move page earlier" disabled={pageIdx <= 0} onClick={() => ed.commit('Move page', (d) => movePage(d, curPage.id, pageIdx - 1))}><Icon name="chevron-left" /></button>
            <button className="icon-btn sm" data-tip="Move page later" aria-label="Move page later" disabled={pageIdx < 0 || pageIdx >= live.pages.length - 1} onClick={() => ed.commit('Move page', (d) => movePage(d, curPage.id, pageIdx + 1))}><Icon name="chevron-right" /></button>
            <button className="icon-btn sm" data-tip="Delete page" aria-label="Delete page" disabled={live.pages.length < 2} onClick={() => runCommand('page.delete')}><Icon name="trash" /></button>
          </span>
        </div>
        <div className={`pages-grid ${live.settings.facingPages ? 'spreads' : ''}`}>
          {live.settings.facingPages
            ? spreads(live.pages.length).map((idx, si) => (
                <div key={si} className={`spread ${si === 0 && idx.length === 1 ? 'first' : ''}`}>
                  {idx.map(thumb)}
                </div>
              ))
            : live.pages.map((_, i) => thumb(i))}
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
          <button className="icon-btn sm" data-tip="Add master page" aria-label="Add master page" onClick={() => runCommand('master.add')}><Icon name="plus" /></button>
        </div>
        {live.masters.length === 0 && <p className="empty-note">Masters hold headers, footers and backgrounds shared by many pages.</p>}
        {live.masters.map((m) => (
          <div className="row" key={m.id}>
            <span className={`master-name${active === m.id ? ' on' : ''}`}>{m.name}</span>
            <button className="btn sm ghost" onClick={() => ed.setUi({ activeContainerId: m.id, selection: [] })}>{active === m.id ? 'Editing' : 'Edit'}</button>
            <button className="icon-btn sm" aria-label={`Delete ${m.name}`} data-tip="Delete master" onClick={() => {
              ed.commit('Delete master', (d) => removeMaster(d, m.id));
              if (active === m.id) ed.setUi({ activeContainerId: live.pages[0].id });
            }}><Icon name="trash" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
