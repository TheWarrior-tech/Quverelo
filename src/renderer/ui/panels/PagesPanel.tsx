import { tip } from '../tips';
import { useEffect, useState } from 'react';
import { movePage, removeMaster, renamePage } from '../../../core/commands';
import { applyMasterToPages, insertPages, masterItemsFor, overrideAllMasterItems, pageLabel, removeMasterOverrides, setPageSection, spreadsOf } from '../../../core/layout';
import type { PageNumberStyle, QuvreloDocument } from '../../../core/types';
import { runCommand } from '../../state/commands';
import { useEditor } from '../hooks';
import { DocThumb } from '../Welcome';
import { Icon } from '../Icons';
import { NumberField } from '../controls/NumberField';

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
  return spreadsOf(count, true);
}

const NUMBER_STYLES: { value: PageNumberStyle; label: string }[] = [
  { value: 'arabic', label: '1, 2, 3' },
  { value: 'roman', label: 'i, ii, iii' },
  { value: 'ROMAN', label: 'I, II, III' },
  { value: 'alpha', label: 'a, b, c' },
  { value: 'ALPHA', label: 'A, B, C' },
];

/**
 * Pages (Layout, left rail): thumbnails as single pages or facing spreads,
 * drag to reorder, add / insert several / duplicate / delete, the current
 * page's master, section numbering and master-item overrides, then the
 * master pages themselves.
 */
export function PagesPanel() {
  const ed = useEditor();
  const doc = useDebouncedDoc(ed.doc!);
  const live = ed.doc!;
  const active = ed.ui.activeContainerId;
  const pageIdx = ed.activePageIndex;
  const curPage = live.pages[pageIdx];
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [inserting, setInserting] = useState(false);
  const [insertCount, setInsertCount] = useState(2);
  const go = (id: string) => ed.setUi({ activeContainerId: id, selection: [] });
  const thumb = (i: number) => {
    const p = live.pages[i];
    const label = pageLabel(live, i);
    const shownName = /^Page \d+$/.test(p.name) && label !== String(i + 1) ? `Page ${label}` : p.name;
    const masterLetter = p.masterId ? live.masters.find((m) => m.id === p.masterId)?.name.split('-')[0] ?? '' : '';
    return (
      <button
        key={p.id}
        className={`page-thumb ${active === p.id ? 'active' : ''}${dropAt === i && dragFrom !== null && dragFrom !== i ? ' drop-target' : ''}${dragFrom === i ? ' dragging' : ''}`}
        onClick={() => go(p.id)}
        aria-label={`Go to ${shownName}`}
        aria-current={active === p.id}
        draggable
        data-page-index={i}
        onDragStart={(e) => {
          setDragFrom(i);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/x-quvrelo-page', String(i));
        }}
        onDragOver={(e) => {
          if (dragFrom === null) return;
          e.preventDefault();
          setDropAt(i);
        }}
        onDragLeave={() => setDropAt((x) => (x === i ? null : x))}
        onDrop={(e) => {
          e.preventDefault();
          const from = dragFrom ?? parseInt(e.dataTransfer.getData('text/x-quvrelo-page'), 10);
          setDragFrom(null);
          setDropAt(null);
          if (Number.isFinite(from) && from !== i) ed.commit('Move page', (d) => movePage(d, d.pages[from].id, i));
        }}
        onDragEnd={() => {
          setDragFrom(null);
          setDropAt(null);
        }}
        onKeyDown={(e) => {
          // Alt+Arrow moves the page (keyboard alternative to dragging)
          if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
          e.preventDefault();
          const to = i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
          if (to >= 0 && to < live.pages.length) ed.commit('Move page', (d) => movePage(d, p.id, to));
        }}
      >
        {doc.pages[i] && doc.pages[i].id === p.id ? <DocThumb doc={doc} pageIndex={i} max={live.settings.facingPages ? 96 : 110} /> : <DocThumb doc={live} pageIndex={i} max={live.settings.facingPages ? 96 : 110} />}
        <span>{shownName}{masterLetter ? ` · ${masterLetter}` : ''}{p.section ? <i className="section-mark" aria-label="Section start"> §</i> : null}</span>
      </button>
    );
  };
  const curMasterItems = curPage ? masterItemsFor(live, curPage).length : 0;
  const overrides = curPage?.overrides?.length ?? 0;
  return (
    <div>
      <div className="section">
        <div className="section-title">
          Pages ({live.pages.length})
          <span>
            <button className="icon-btn sm" {...tip('Add page', 'page.add')} onClick={() => runCommand('page.add')}><Icon name="plus" /></button>
            <button className={`icon-btn sm${inserting ? ' on' : ''}`} data-tip="Insert several pages" aria-label="Insert several pages" aria-expanded={inserting} onClick={() => setInserting(!inserting)}><Icon name="pages" /></button>
            <button className="icon-btn sm" data-tip="Duplicate page" aria-label="Duplicate page" onClick={() => runCommand('page.duplicate')}><Icon name="copy" /></button>
            <button className="icon-btn sm" data-tip="Move page earlier" aria-label="Move page earlier" disabled={pageIdx <= 0} onClick={() => ed.commit('Move page', (d) => movePage(d, curPage.id, pageIdx - 1))}><Icon name="chevron-left" /></button>
            <button className="icon-btn sm" data-tip="Move page later" aria-label="Move page later" disabled={pageIdx < 0 || pageIdx >= live.pages.length - 1} onClick={() => ed.commit('Move page', (d) => movePage(d, curPage.id, pageIdx + 1))}><Icon name="chevron-right" /></button>
            <button className="icon-btn sm" data-tip="Delete page" aria-label="Delete page" disabled={live.pages.length < 2} onClick={() => runCommand('page.delete')}><Icon name="trash" /></button>
          </span>
        </div>
        {inserting && (
          <div className="row insert-pages" data-testid="insert-pages">
            <NumberField label="Insert" ariaLabel="Number of pages to insert" digits={0} min={1} max={500} value={insertCount} onCommit={(v) => setInsertCount(Math.max(1, Math.round(v)))} onChange={(v) => setInsertCount(Math.max(1, Math.round(v)))} />
            <span className="value">after this page</span>
            <span className="row-spacer" />
            <button className="btn sm" onClick={() => {
              let first = '';
              ed.commit(`Insert ${insertCount} pages`, (d) => {
                const r = insertPages(d, Math.max(0, pageIdx), insertCount, curPage?.masterId ?? null);
                first = r.pageIds[0];
                return r.doc;
              });
              setInserting(false);
              if (first) go(first);
            }}>Insert</button>
          </div>
        )}
        <div className={`pages-grid ${live.settings.facingPages ? 'spreads' : ''}`}>
          {live.settings.facingPages
            ? spreads(live.pages.length).map((idx, si) => (
                <div key={si} className={`spread ${si === 0 && idx.length === 1 ? 'first' : ''}`}>
                  {idx.map(thumb)}
                </div>
              ))
            : live.pages.map((_, i) => thumb(i))}
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={live.settings.facingPages} onChange={(e) => ed.commit('Facing pages', (d) => ({ ...d, settings: { ...d.settings, facingPages: e.target.checked } }))} /> Facing pages (spreads)</label>
        </div>
      </div>
      {curPage && (
        <div className="section">
          <div className="section-title">This page <span className="count num">{pageLabel(live, pageIdx)}</span></div>
          <div className="row">
            <label>Name</label>
            <input type="text" value={curPage.name} aria-label="Page name" onChange={(e) => ed.commit('Rename page', (d) => renamePage(d, curPage.id, e.target.value), 'pname')} />
          </div>
          <div className="row">
            <label>Master</label>
            <select value={curPage.masterId ?? ''} aria-label="Master page" onChange={(e) => ed.commit('Apply master', (d) => applyMasterToPages(d, e.target.value || null, [curPage.id]))}>
              <option value="">None</option>
              {live.masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {curPage.masterId && (
            <div className="row master-overrides">
              <button className="btn sm ghost" disabled={!curMasterItems} onClick={() => ed.commit('Override master items', (d) => overrideAllMasterItems(d, curPage.id))} data-tip="Copy the master’s items onto this page so they can be edited here">Override master items</button>
              <button className="btn sm ghost" disabled={!overrides} onClick={() => ed.commit('Remove overrides', (d) => removeMasterOverrides(d, curPage.id))} data-tip="Put back the master’s own items on this page">Remove overrides{overrides ? ` (${overrides})` : ''}</button>
            </div>
          )}
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={!!curPage.section} onChange={(e) => ed.commit('Section', (d) => setPageSection(d, curPage.id, e.target.checked ? { name: '', startAt: 1, style: 'arabic' } : null))} data-testid="section-start" /> Start a section here
            </label>
          </div>
          {curPage.section && (
            <div className="section-fields">
              <div className="row">
                <label>Section</label>
                <input type="text" value={curPage.section.name} aria-label="Section name" placeholder="Chapter 1" onChange={(e) => ed.commit('Section name', (d) => setPageSection(d, curPage.id, { ...curPage.section!, name: e.target.value }), 'sname')} />
              </div>
              <div className="grid2">
                <select aria-label="Page number style" value={curPage.section.style} onChange={(e) => ed.commit('Numbering', (d) => setPageSection(d, curPage.id, { ...curPage.section!, style: e.target.value as PageNumberStyle }))}>
                  {NUMBER_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <NumberField label="Start" ariaLabel="Start numbering at" digits={0} min={1} max={9999} value={curPage.section.startAt} onCommit={(v) => ed.commit('Numbering', (d) => setPageSection(d, curPage.id, { ...curPage.section!, startAt: v }))} />
              </div>
              <div className="row">
                <label>Prefix</label>
                <input type="text" value={curPage.section.prefix ?? ''} aria-label="Page number prefix" placeholder="A-" onChange={(e) => ed.commit('Numbering prefix', (d) => setPageSection(d, curPage.id, { ...curPage.section!, prefix: e.target.value }), 'sprefix')} />
              </div>
            </div>
          )}
        </div>
      )}
      <div className="section">
        <div className="section-title">
          Master pages
          <button className="icon-btn sm" data-tip="Add master page" aria-label="Add master page" onClick={() => runCommand('master.add')}><Icon name="plus" /></button>
        </div>
        {live.masters.length === 0 && <p className="empty-note">Masters hold headers, footers and backgrounds shared by many pages.</p>}
        {live.masters.map((m) => {
          const uses = live.pages.filter((p) => p.masterId === m.id).length;
          return (
            <div className="row" key={m.id}>
              <span className={`master-name${active === m.id ? ' on' : ''}`}>{m.name} <span className="count num" aria-label={`Used by ${uses} pages`}>{uses}</span></span>
              <button className="btn sm ghost" onClick={() => go(m.id)}>{active === m.id ? 'Editing' : 'Edit'}</button>
              <button className="icon-btn sm" aria-label={`Apply ${m.name} to all pages`} data-tip="Apply to all pages" disabled={uses === live.pages.length} onClick={() => ed.commit('Apply master to all pages', (d) => applyMasterToPages(d, m.id, d.pages.map((p) => p.id)))}><Icon name="layers" /></button>
              <button className="icon-btn sm" aria-label={`Delete ${m.name}`} data-tip="Delete master" onClick={() => {
                ed.commit('Delete master', (d) => removeMaster(d, m.id));
                if (active === m.id) ed.setUi({ activeContainerId: live.pages[0].id });
              }}><Icon name="trash" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
