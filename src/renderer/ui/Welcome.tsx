import { useEffect, useMemo, useRef, useState } from 'react';
import { TEMPLATES, type TemplateInfo } from '../../core/templates';
import type { QuvreloDocument, StudioKind } from '../../core/types';
import type { ExternalTemplate, RecentFile, RecoveryEntry } from '../../shared/api';
import { editor } from '../state/editor';
import { newFromTemplate, openDialogAndLoad, openPath, restoreRecovery } from '../state/io';
import { openDialog } from '../state/bus';
import { createCanvas, ctx2d } from '../engine/assets';
import { drawPage } from '../engine/draw';
import { Icon, Logo } from './Icons';

export function DocThumb({ doc, max = 150, pageIndex = 0 }: { doc: QuvreloDocument; max?: number; pageIndex?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const s = max / Math.max(doc.settings.width, doc.settings.height);
    const dpr = window.devicePixelRatio || 1;
    const c = createCanvas(doc.settings.width * s * dpr, doc.settings.height * s * dpr);
    c.style.width = `${doc.settings.width * s}px`;
    c.style.height = `${doc.settings.height * s}px`;
    const ctx = ctx2d(c);
    ctx.scale(s * dpr, s * dpr);
    if (!doc.settings.background) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, doc.settings.width, doc.settings.height);
    }
    drawPage(ctx, doc, pageIndex, { doc, assets: editor.assets, editor: false, preview: true, zoom: s });
    host.replaceChildren(c);
  }, [doc, max, pageIndex]);
  return <div ref={ref} style={{ display: 'contents' }} />;
}

const STUDIO_INFO: { id: StudioKind; title: string; text: string; color: string; template: string }[] = [
  { id: 'photo', title: 'Photo', text: 'Retouch photos with pixel layers, brushes, selections and live adjustments.', color: 'var(--photo)', template: 'photo' },
  { id: 'vector', title: 'Vector', text: 'Draw logos, posters and diagrams with shapes, the pen tool and booleans.', color: 'var(--vector)', template: 'social' },
  { id: 'layout', title: 'Layout', text: 'Build worksheets, newsletters and booklets with pages, masters and flowing text.', color: 'var(--layout)', template: 'blank-a4' },
];

function TemplateCard({ t }: { t: TemplateInfo }) {
  const doc = useMemo(() => t.build(), [t]);
  return (
    <button className="template-card" onClick={() => newFromTemplate(t.id)} aria-label={`New ${t.name}: ${t.description}`} data-template={t.id}>
      <div className="thumb">
        <DocThumb doc={doc} />
      </div>
      <strong>{t.name}</strong>
      <span>{t.size} · {t.description}</span>
    </button>
  );
}

export function Welcome() {
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([]);
  const [external, setExternal] = useState<ExternalTemplate[]>([]);
  useEffect(() => {
    void window.quvrelo.getRecent().then(setRecent);
    void window.quvrelo.listRecovery().then(setRecovery);
    void window.quvrelo.listExternalTemplates().then(setExternal);
  }, []);
  const studios = STUDIO_INFO.filter((s) => editor.feature(s.id));
  const cats: TemplateInfo['category'][] = ['Classroom', 'Print', 'Digital', 'Start'];
  return (
    <main className="welcome">
      <div className="welcome-inner">
        <header className="welcome-hero">
          <Logo className="logo" />
          <div>
            <h1>Quvrelo</h1>
            <p>Photo, vector and layout design in one app — offline, private and made for classrooms.{editor.policy.organizationName ? ` · ${editor.policy.organizationName}` : ''}</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => void openDialogAndLoad()}>
              <Icon name="open" /> Open…
            </button>
            <button className="btn primary" onClick={() => openDialog('new')} data-testid="new-document">
              <Icon name="new" /> New document
            </button>
          </div>
        </header>

        {recovery.length > 0 && (
          <section className="recovery-banner" aria-label="Recovered documents">
            <h3>Recovered work</h3>
            <div style={{ color: 'var(--text-dim)' }}>Quvrelo closed unexpectedly. These documents were autosaved:</div>
            {recovery.map((r) => (
              <div className="item" key={r.id}>
                <span>
                  <b>{r.title}</b> — {new Date(r.savedAt).toLocaleString()}
                </span>
                <button className="btn primary" onClick={() => void restoreRecovery(r.id)}>Restore</button>
                <button className="btn ghost" onClick={async () => { await window.quvrelo.deleteRecovery(r.id); setRecovery((l) => l.filter((x) => x.id !== r.id)); }}>Discard</button>
              </div>
            ))}
          </section>
        )}

        <div className="studio-cards">
          {studios.map((s) => (
            <button key={s.id} className="studio-card" onClick={() => newFromTemplate(s.template)} data-studio-card={s.id}>
              <div className="badge">
                <Icon name={s.id} />
              </div>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <>
            <h2>Recent</h2>
            <div className="recent-list">
              {recent.slice(0, 8).map((r) => (
                <button key={r.path} className="recent-item" onClick={() => void openPath(r.path)} title={r.path}>
                  <Icon name="layout" />
                  <div>
                    <b>{r.name}</b>
                    <small>{r.path}</small>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {external.length > 0 && (
          <>
            <h2>School templates <small>provided by your IT team</small></h2>
            <div className="recent-list">
              {external.map((t) => (
                <button key={t.path} className="recent-item" onClick={() => void openPath(t.path)}>
                  <Icon name="folder" />
                  <div>
                    <b>{t.name}</b>
                    <small>{t.folder}</small>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {cats.map((cat) => (
          <section key={cat}>
            <h2>
              {cat === 'Classroom' ? 'Classroom pack' : cat === 'Start' ? 'Blank documents' : cat}
              {cat === 'Classroom' && <small>ready-made, fully editable</small>}
            </h2>
            <div className="template-grid">
              {TEMPLATES.filter((t) => t.category === cat && editor.feature(t.studio)).map((t) => (
                <TemplateCard key={t.id} t={t} />
              ))}
            </div>
          </section>
        ))}
        <p className="policy-note">
          Works fully offline. No account, no tracking, no telemetry. Press <kbd>F1</kbd> for keyboard shortcuts.
        </p>
      </div>
    </main>
  );
}
