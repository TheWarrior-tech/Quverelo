import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import JSZip from 'jszip';
import { TEMPLATES, type TemplateInfo } from '../../core/templates';
import type { QuvreloDocument, StudioKind } from '../../core/types';
import type { ExternalTemplate, RecentFile, RecoveryEntry } from '../../shared/api';
import { editor } from '../state/editor';
import { newFromTemplate, openDialogAndLoad, openPath, restoreRecovery } from '../state/io';
import { openDialog } from '../state/bus';
import { createCanvas, ctx2d } from '../engine/assets';
import { drawPage } from '../engine/draw';
import { Icon, Logo } from './Icons';
import './welcome.css';

/**
 * Renders page `pageIndex` of `doc` to fit inside `max` (square) or a `box`.
 * Drawn at 2× device pixels and downsampled by the browser so small type stays crisp.
 */
export function DocThumb({ doc, max = 150, box, pageIndex = 0 }: { doc: QuvreloDocument; max?: number; box?: { w: number; h: number }; pageIndex?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const bw = box?.w ?? max;
  const bh = box?.h ?? max;
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const s = Math.min(bw / doc.settings.width, bh / doc.settings.height);
    const k = (window.devicePixelRatio || 1) * 2;
    const c = createCanvas(Math.max(1, Math.round(doc.settings.width * s * k)), Math.max(1, Math.round(doc.settings.height * s * k)));
    c.style.width = `${doc.settings.width * s}px`;
    c.style.height = `${doc.settings.height * s}px`;
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(s * k, s * k);
    if (!doc.settings.background) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, doc.settings.width, doc.settings.height);
    }
    try {
      drawPage(ctx, doc, pageIndex, { doc, assets: editor.assets, editor: false, preview: true, zoom: s * k });
    } catch {
      /* a thumbnail must never break the screen */
    }
    host.replaceChildren(c);
  }, [doc, bw, bh, pageIndex]);
  return <div ref={ref} style={{ display: 'contents' }} />;
}

const STUDIO_INFO: { id: StudioKind; title: string; text: string; template: string; size: string }[] = [
  { id: 'photo', title: 'Photo', text: 'Retouch photos with pixel layers, brushes, selections and live adjustments.', template: 'photo', size: '1920 × 1280 px' },
  { id: 'vector', title: 'Vector', text: 'Draw logos, posters and diagrams with shapes, the pen tool and booleans.', template: 'social', size: '1080 × 1080 px' },
  { id: 'layout', title: 'Layout', text: 'Build worksheets, newsletters and booklets with pages, masters and flowing text.', template: 'blank-a4', size: 'A4 · 210 × 297 mm' },
];

const TILE = { w: 136, h: 104 }; // page fits inside the 4:3 tile with breathing room

function TemplateCard({ t }: { t: TemplateInfo }) {
  const doc = useMemo(() => t.build(), [t]);
  return (
    <button className="tile" onClick={() => newFromTemplate(t.id)} aria-label={`New ${t.name}: ${t.description}, ${t.size}`} data-template={t.id}>
      <span className="tile-thumb"><DocThumb doc={doc} box={TILE} /></span>
      <span className="tile-name">{t.name}</span>
      <span className="tile-meta">{t.size}</span>
    </button>
  );
}

/** Reads the preview image stored inside a .quvrelo file (thumbnail.png). */
const thumbCache = new Map<string, Promise<string | null>>();
function loadThumb(path: string): Promise<string | null> {
  let p = thumbCache.get(path);
  if (!p) {
    p = (async () => {
      try {
        const f = await window.quvrelo.readFile(path);
        const zip = await JSZip.loadAsync(f.data);
        const png = await zip.file('thumbnail.png')?.async('uint8array');
        return png ? URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })) : null;
      } catch {
        return null;
      }
    })();
    thumbCache.set(path, p);
  }
  return p;
}

function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function folderOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

function RecentCard({ r }: { r: RecentFile }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadThumb(r.path).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [r.path]);
  const name = r.name.replace(/\.(quvrelo|easel)$/i, '');
  return (
    <button className="tile" onClick={() => void openPath(r.path)} data-tip={r.path} data-recent={r.name}>
      <span className="tile-thumb">
        {src ? <img src={src} alt="" draggable={false} /> : src === null ? <Icon name="layout" /> : null}
      </span>
      <span className="tile-name">{name}</span>
      <span className="tile-meta">{[relTime(r.openedAt), folderOf(r.path)].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

function SectionHead({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="w-head">
      <h2>{title}</h2>
      {count !== undefined && <span className="w-count">{count}</span>}
      <span className="w-rule" />
      {children}
    </div>
  );
}

export function Welcome() {
  const [recent, setRecent] = useState<RecentFile[] | null>(null);
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([]);
  const [external, setExternal] = useState<ExternalTemplate[]>([]);
  useEffect(() => {
    void window.quvrelo.getRecent().then(setRecent);
    void window.quvrelo.listRecovery().then(setRecovery);
    void window.quvrelo.listExternalTemplates().then(setExternal);
  }, []);
  const studios = STUDIO_INFO.filter((s) => editor.feature(s.id));
  const groups: { title: string; cats: TemplateInfo['category'][] }[] = [
    { title: 'Classroom', cats: ['Classroom'] },
    { title: 'Print and screen', cats: ['Print', 'Digital'] },
    { title: 'Blank', cats: ['Start'] },
  ];
  const recentOn = editor.feature('recent-files' as never);
  const org = editor.policy.organizationName;
  return (
    <main className="welcome">
      <div className="welcome-inner">
        <header className="w-top">
          <Logo className="logo" />
          <h1>Quvrelo</h1>
          {org && <span className="w-org">{org}</span>}
          <div className="w-actions">
            <button className="btn" onClick={() => void openDialogAndLoad()}>
              <Icon name="open" size={16} /> Open…
            </button>
            <button className="btn primary" onClick={() => openDialog('new')} data-testid="new-document">
              <Icon name="new" size={16} /> New Document…
            </button>
          </div>
        </header>

        {recovery.length > 0 && (
          <section className="recovery" aria-label="Recovered documents">
            <div className="recovery-text">
              <h3>Recovered work</h3>
              <p>Quvrelo closed unexpectedly. These documents were autosaved.</p>
            </div>
            {recovery.map((r) => (
              <div className="recovery-item" key={r.id}>
                <span className="name">{r.title}</span>
                <span className="when">{relTime(r.savedAt)}</span>
                <button className="btn ghost" onClick={async () => { await window.quvrelo.deleteRecovery(r.id); setRecovery((l) => l.filter((x) => x.id !== r.id)); }}>Discard</button>
                <button className="btn primary" onClick={() => void restoreRecovery(r.id)}>Restore</button>
              </div>
            ))}
          </section>
        )}

        {recentOn && (
          <section aria-label="Recent documents">
            <SectionHead title="Recent" count={recent?.length || undefined} />
            {recent && recent.length > 0 ? (
              <div className="tile-grid">
                {recent.slice(0, 12).map((r) => <RecentCard key={r.path} r={r} />)}
              </div>
            ) : (
              <div className="w-empty">
                <span>Documents you open or save will appear here.</span>
                <button className="btn ghost" onClick={() => void openDialogAndLoad()}>Open a file…</button>
              </div>
            )}
          </section>
        )}

        <section aria-label="Start a blank document">
          <SectionHead title="Start" />
          <div className="studio-row">
            {studios.map((s) => (
              <button key={s.id} className="studio-entry" onClick={() => newFromTemplate(s.template)} data-studio-card={s.id}>
                <span className="studio-icon"><Icon name={s.id} /></span>
                <span className="studio-text">
                  <span className="studio-title">{s.title}</span>
                  <span className="studio-desc">{s.text}</span>
                  <span className="studio-size">{s.size}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {external.length > 0 && (
          <section aria-label="School templates">
            <SectionHead title="School templates" count={external.length}><span className="w-note">From your IT team</span></SectionHead>
            <div className="ext-list">
              {external.map((t) => (
                <button key={t.path} className="ext-item" onClick={() => void openPath(t.path)} data-tip={t.path}>
                  <Icon name="folder" size={16} />
                  <span className="name">{t.name}</span>
                  <span className="where">{t.folder}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {groups.map((g) => {
          const list = TEMPLATES.filter((t) => g.cats.includes(t.category) && editor.feature(t.studio));
          if (!list.length) return null;
          return (
            <section key={g.title} aria-label={`${g.title} templates`}>
              <SectionHead title={g.title} count={list.length} />
              <div className="tile-grid">
                {list.map((t) => <TemplateCard key={t.id} t={t} />)}
              </div>
            </section>
          );
        })}

        <footer className="w-foot">
          Works offline. No account, no tracking, no telemetry.
          <button className="link" onClick={() => openDialog('shortcuts')}>Keyboard shortcuts</button>
          <button className="link" onClick={() => openDialog('guide')}>Quick start guide</button>
        </footer>
      </div>
    </main>
  );
}
