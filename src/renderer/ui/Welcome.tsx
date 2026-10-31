import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import JSZip from 'jszip';
import { TEMPLATES, type TemplateInfo } from '../../core/templates';
import type { QuvreloDocument } from '../../core/types';
import type { ExternalTemplate, RecentFile, RecoveryEntry } from '../../shared/api';
import { editor } from '../state/editor';
import { newBlank, newFromTemplate, openDialogAndLoad, openPath, openPhotoDialog, restoreRecovery } from '../state/io';
import { openDialog, toast } from '../state/bus';
import { runCommand } from '../state/commands';
import { dismissChecklist, onboardingState } from '../state/onboarding';
import { STEP_LABELS, availableSteps, checklistVisible, type OnboardingStep } from '../../core/onboarding';
import { displayLocation, matchesQuery, relativeAge } from '../../core/paths';
import { useEditor } from './hooks';
import { shortcutFor, tip } from './tips';
import { Keys } from './dialogs/controls';
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

const TILE = { w: 136, h: 104 }; // page fits inside the 4:3 tile with breathing room

function TemplateCard({ t }: { t: TemplateInfo }) {
  const doc = useMemo(() => t.build(), [t]);
  return (
    <button className="tile" onClick={() => newFromTemplate(t.id)} data-template={t.id} aria-description={`New document: ${t.description}`}>
      {/* name = the visible words (WCAG 2.5.3, axe label-content-name-mismatch); the description rides on aria-description */}
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

/** One Recent row: thumbnail, name, folder (full path in the tooltip), when it was opened. */
function RecentRow({ r, home }: { r: RecentFile; home: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadThumb(r.path).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [r.path]);
  const name = r.name.replace(/\.(quvrelo|easel)$/i, '');
  const where = displayLocation(r.path, home);
  return (
    <li>
      <button className="recent-row" onClick={() => void openPath(r.path)} data-tip={r.path} data-recent={r.name} aria-label={`${name}, in ${where}, opened ${relativeAge(r.openedAt)}`}>
        <span className="recent-thumb">{src ? <img src={src} alt="" draggable={false} /> : src === null ? <Icon name="layout" size={16} /> : null}</span>
        <span className="recent-name">{name}</span>
        <span className="recent-where" data-testid="recent-where">{where}</span>
        <span className="recent-when" data-tip={relTime(r.openedAt)}>{relativeAge(r.openedAt)}</span>
      </button>
    </li>
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

/** Start row (UX audit P0-3a, P1-7): "Edit a photo…" opens a photo; the other two open New Document preselected. */
interface StartEntry {
  id: 'photo' | 'vector' | 'layout';
  title: string;
  text: string;
  meta: string;
  run: () => void;
  alt?: { label: string; run: () => void };
}

function startEntries(feature: (f: never) => boolean): StartEntry[] {
  const list: StartEntry[] = [];
  if (feature('photo' as never) && feature('import-images' as never)) {
    list.push({
      id: 'photo',
      title: 'Edit a photo…',
      text: 'Retouch, crop or cut out a picture.',
      meta: 'JPG · PNG · WebP · DNG',
      run: () => void openPhotoDialog(),
      alt: { label: 'Blank canvas', run: () => openDialog('new', { category: 'photo' }) },
    });
  }
  if (feature('vector' as never)) {
    list.push({ id: 'vector', title: 'Poster or social post', text: 'Shapes, type and logos.', meta: '1080 × 1080 px', run: () => openDialog('new', { preset: 'square' }) });
  }
  if (feature('layout' as never)) {
    list.push({ id: 'layout', title: 'A4 page', text: 'Worksheets, handouts and booklets.', meta: '210 × 297 mm', run: () => openDialog('new', { preset: 'a4' }) });
  }
  return list;
}

/**
 * Start-card artwork (DESIGN.md v4 §8 Welcome): a small line drawing of what the studio
 * makes, in the card's own ink with one accent stroke. Decorative (aria-hidden).
 */
function StartArt({ id }: { id: StartEntry['id'] }) {
  return (
    <svg className="start-art-svg" viewBox="0 0 240 112" aria-hidden="true" focusable="false">
      {id === 'photo' && (
        <g>
          <rect className="a-sheet" x="62" y="14" width="116" height="84" rx="6" />
          <path className="a-fill" d="M62 80 L96 50 L118 68 L140 46 L178 82 L178 92 a6 6 0 0 1 -6 6 L68 98 a6 6 0 0 1 -6 -6 Z" />
          <circle className="a-accent-fill" cx="152" cy="34" r="8" />
          <path className="a-dash" d="M84 30 h44 v40 h-44 Z" />
        </g>
      )}
      {id === 'vector' && (
        <g>
          <path className="a-line" d="M56 84 C 84 18, 132 18, 120 56 S 160 100, 186 30" />
          <path className="a-handle" d="M84 40 L56 84 M120 56 L104 76 M120 56 L136 36" />
          <rect className="a-node" x="52" y="80" width="8" height="8" />
          <rect className="a-node a-node-on" x="116" y="52" width="8" height="8" />
          <rect className="a-node" x="182" y="26" width="8" height="8" />
          <circle className="a-knob" cx="104" cy="76" r="3" />
          <circle className="a-knob" cx="136" cy="36" r="3" />
        </g>
      )}
      {id === 'layout' && (
        <g>
          <rect className="a-sheet" x="80" y="8" width="80" height="104" rx="3" />
          <rect className="a-accent-fill" x="90" y="20" width="40" height="7" rx="1.5" />
          <rect className="a-fill" x="90" y="34" width="60" height="28" rx="2" />
          <path className="a-text" d="M90 70 h28 M90 76 h28 M90 82 h24 M90 88 h28 M90 94 h18 M122 70 h28 M122 76 h28 M122 82 h22 M122 88 h28 M122 94 h26" />
        </g>
      )}
    </svg>
  );
}

/** First-run checklist (UX audit P1-4). Each row goes straight to the action. */
function Checklist({ recent }: { recent: RecentFile[] | null }) {
  const ed = useEditor();
  const ob = onboardingState();
  const steps = availableSteps((f) => ed.feature(f as never));
  if (!checklistVisible(ob, ed.policy, steps)) return null;
  const doneCount = steps.filter((s) => ob.done.includes(s)).length;
  const openSomething = async () => {
    if (recent?.length) await openPath(recent[0].path);
    else await openDialogAndLoad();
    return !!ed.session;
  };
  const actions: Record<OnboardingStep, { hint?: string; run: () => void }> = {
    create: { hint: shortcutFor('file.new'), run: () => openDialog('new') },
    place: { run: () => void openPhotoDialog() },
    subject: {
      run: async () => {
        if (await openPhotoDialog()) await runCommand('select.subject');
      },
    },
    text: {
      hint: 'T',
      run: () => {
        const studio = ed.feature('vector') ? 'vector' : ed.feature('layout') ? 'layout' : 'photo';
        newBlank({ title: 'Untitled', width: 1080, height: 1080, unit: 'px', pages: 1, studio, margins: 0, bleed: 0, background: '#ffffff', dpi: 72 });
        ed.setTool('text');
        toast('Click on the page to start typing');
      },
    },
    export: {
      hint: shortcutFor('file.export'),
      run: async () => {
        if (await openSomething()) await runCommand('file.export');
      },
    },
  };
  return (
    <section className="checklist" aria-label="Get started" data-testid="checklist">
      <header className="cl-head">
        <h2>Get started</h2>
        <span className="cl-count num" aria-label={`${doneCount} of ${steps.length} done`}>{doneCount}/{steps.length}</span>
        <button type="button" className="icon-btn sm" {...tip('Hide checklist')} onClick={dismissChecklist} data-testid="checklist-dismiss"><Icon name="close" /></button>
      </header>
      <div className="cl-progress" aria-hidden="true">
        {steps.map((s) => <span key={s} className={ob.done.includes(s) ? 'on' : undefined} />)}
      </div>
      <ol className="cl-list">
        {steps.map((s) => {
          const done = ob.done.includes(s);
          return (
            <li key={s}>
              <button type="button" className={`cl-row${done ? ' done' : ''}`} onClick={() => actions[s].run()} data-step={s}>
                {/* named by its content, not aria-label: the keycap hint is visible text, so an aria-label fails WCAG 2.5.3.
                    ", done" is inline zero-size text (an absolutely positioned sr-only span would add a stray space to the name) */}
                <span className="cl-check"><Icon name={done ? 'circle-check' : 'circle'} size={16} /></span>
                <span className="cl-label">{STEP_LABELS[s]}{done && <span className="sr-inline">, done</span>}</span>
                {actions[s].hint && <span className="cl-hint" aria-hidden="true"><Keys combo={actions[s].hint!} /></span>}
                <span className="cl-go"><Icon name="chevron-right" size={16} /></span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const RECENT_ROWS = 6;

export function Welcome() {
  const ed = useEditor();
  const [recent, setRecent] = useState<RecentFile[] | null>(null);
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([]);
  const [external, setExternal] = useState<ExternalTemplate[]>([]);
  const [home, setHome] = useState('');
  const [query, setQuery] = useState('');
  const [allRecent, setAllRecent] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void window.quvrelo.getRecent().then(setRecent);
    void window.quvrelo.listRecovery().then(setRecovery);
    void window.quvrelo.listExternalTemplates().then(setExternal);
    void window.quvrelo.getAppInfo().then((i) => setHome(i.homePath ?? ''));
  }, []);
  // "/" focuses search (as in Linear, GitHub and Figma's file browser)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], .dialog')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const starts = startEntries((f) => ed.feature(f));
  const groups: { title: string; cats: TemplateInfo['category'][] }[] = [
    { title: 'Classroom', cats: ['Classroom'] },
    { title: 'Print and screen', cats: ['Print', 'Digital'] },
    { title: 'Blank', cats: ['Start'] },
  ];
  const recentOn = ed.feature('recent-files' as never);
  const org = ed.policy.organizationName;
  const q = query.trim();

  const recentShown = (recent ?? []).filter((r) => matchesQuery(q, [r.name, r.path]));
  const externalShown = external.filter((t) => matchesQuery(q, [t.name, t.folder]));
  const groupLists = groups.map((g) => ({
    ...g,
    list: TEMPLATES.filter((t) => g.cats.includes(t.category) && ed.feature(t.studio) && matchesQuery(q, [t.name, t.description, t.category, t.size, t.studio])),
  }));
  const anyMatch = recentShown.length + externalShown.length + groupLists.reduce((n, g) => n + g.list.length, 0) > 0;

  return (
    <main className="welcome">
      <header className="w-bar">
        <div className="w-bar-inner">
          <div className="w-brand">
            <Logo className="logo" />
            <h1>Quvrelo</h1>
            {org && <span className="w-org">{org}</span>}
          </div>
          <label className="w-search">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search templates and recent files"
              aria-label="Search templates and recent files"
              aria-keyshortcuts="/"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  if (query) setQuery('');
                  else e.currentTarget.blur();
                }
              }}
              data-testid="welcome-search"
            />
            {!query && <kbd aria-hidden="true">/</kbd>}
          </label>
          <div className="w-actions">
            <button className="btn" onClick={() => void openDialogAndLoad()} data-tip={`Open (${shortcutFor('file.open') ?? ''})`}>
              <Icon name="open" size={16} /> Open…
            </button>
            <button className="btn primary" onClick={() => openDialog('new')} data-testid="new-document" data-tip={`New document (${shortcutFor('file.new') ?? ''})`}>
              <Icon name="new" size={16} /> New document…
            </button>
          </div>
        </div>
      </header>

      <div className="welcome-inner">
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

        {!q && (
          <section className="w-hero" aria-label="Welcome">
            <h2 className="w-hero-title">
              What will you <em>make</em> today?
            </h2>
            <p className="w-hero-sub">Photos, posters and pages, all in one place. Pick a starting point or open a file.</p>
          </section>
        )}

        <div className={`w-layout${q ? ' searching' : ''}`}>
          <div className="w-main">
            {!q && starts.length > 0 && (
              <section aria-label="Start">
                <SectionHead title="Start" />
                <div className="start-row">
                  {starts.map((s) => (
                    <div key={s.id} className="start-card" data-studio-card={s.id}>
                      <button type="button" className="start-main" onClick={s.run} data-start={s.id}>
                        <span className="start-art"><StartArt id={s.id} /></span>
                        <span className="start-icon"><Icon name={s.id} /></span>
                        <span className="start-text">
                          <span className="start-title">{s.title}</span>
                          <span className="start-desc">{s.text}</span>
                        </span>
                      </button>
                      <div className="start-foot">
                        <span className="start-meta">{s.meta}</span>
                        {s.alt && <button type="button" className="link start-alt" onClick={s.alt.run} data-start-alt={s.id}>{s.alt.label}</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {recentOn && (!q || recentShown.length > 0) && (
              <section aria-label="Recent documents">
                <SectionHead title="Recent" count={recentShown.length || undefined}>
                  {!q && recentShown.length > RECENT_ROWS && (
                    <button type="button" className="link" onClick={() => setAllRecent((v) => !v)} aria-expanded={allRecent}>{allRecent ? 'Show fewer' : `Show all ${recentShown.length}`}</button>
                  )}
                </SectionHead>
                {recentShown.length > 0 ? (
                  <div className="recent-table">
                    <div className="recent-cols" aria-hidden="true">
                      <span />
                      <span>Name</span>
                      <span>Location</span>
                      <span className="r">Opened</span>
                    </div>
                    <ul className="recent-list">
                      {(q || allRecent ? recentShown : recentShown.slice(0, RECENT_ROWS)).map((r) => <RecentRow key={r.path} r={r} home={home} />)}
                    </ul>
                  </div>
                ) : (
                  <div className="w-empty">
                    <Icon name="drop" size={16} />
                    <span>Files you open or save appear here. You can also drop a file anywhere in this window.</span>
                    <button className="btn ghost" onClick={() => void openDialogAndLoad()}>Open a file…</button>
                  </div>
                )}
              </section>
            )}

            {externalShown.length > 0 && (
              <section aria-label="School templates">
                <SectionHead title="School templates" count={externalShown.length}><span className="w-note">From your IT team</span></SectionHead>
                <div className="ext-list">
                  {externalShown.map((t) => (
                    <button key={t.path} className="ext-item" onClick={() => void openPath(t.path)} data-tip={t.path}>
                      <Icon name="folder" size={16} />
                      <span className="name">{t.name}</span>
                      <span className="where">{t.folder}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {groupLists.map((g) => {
              if (!g.list.length) return null;
              return (
                <section key={g.title} aria-label={`${g.title} templates`}>
                  <SectionHead title={g.title} count={g.list.length} />
                  <div className="tile-grid">
                    {g.list.map((t) => <TemplateCard key={t.id} t={t} />)}
                  </div>
                </section>
              );
            })}

            {q && !anyMatch && (
              <section aria-label="Search results">
                <div className="w-empty" role="status">
                  <Icon name="search" size={16} />
                  <span>No templates or recent files match “{q}”.</span>
                  <button className="btn ghost" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>Clear search</button>
                </div>
              </section>
            )}
          </div>

          {!q && (
            <aside className="w-side" aria-label="Help">
              <Checklist recent={recent} />
              <section className="w-links" aria-label="Learn">
                <h2 className="w-side-title">Learn</h2>
                <button type="button" className="w-link" onClick={() => openDialog('guide')}>
                  <Icon name="help" size={16} /><span>Quick start guide</span>
                </button>
                <button type="button" className="w-link" onClick={() => openDialog('shortcuts')}>
                  <Icon name="keyboard" size={16} /><span>Keyboard shortcuts</span>{shortcutFor('help.shortcuts') && <span className="w-link-keys" aria-hidden="true"><Keys combo={shortcutFor('help.shortcuts')!} /></span>}
                </button>
                <p className="w-tip"><Icon name="drop" size={16} /><span>Drop a photo or .quvrelo file anywhere in this window to open it.</span></p>
              </section>
            </aside>
          )}
        </div>

        <footer className="w-foot">
          Works offline. No account, no tracking, no telemetry.
        </footer>
      </div>
    </main>
  );
}
