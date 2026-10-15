import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { toPx, fromPx } from '../../../core/units';
import type { StudioKind, Unit } from '../../../core/types';
import { editor } from '../../state/editor';
import { closeDialog } from '../../state/bus';
import { newBlank, newFromTemplate } from '../../state/io';
import { TEMPLATES, type TemplateInfo } from '../../../core/templates';
import { inferStudio, type NewDocCategory } from '../../../core/newDocument';
import { Icon } from '../Icons';
import { DocThumb } from '../Welcome';
import { Dialog } from './DialogHost';
import { Field, NumberInput, Segmented } from './controls';

interface Preset {
  id: string;
  name: string;
  /** Width/height in `unit`, portrait-or-native orientation. */
  w: number;
  h: number;
  unit: Unit;
  dpi: number;
  margins: number; // in unit
  bleed: number; // in unit
  pages?: number;
  transparent?: boolean;
}

type CategoryId = NewDocCategory;

// ISO sizes get metric margins (15 mm), never ½ in leaking in as 12.7 mm (CRITIQUE-4 P2-24)
const mm = (id: string, name: string, w: number, h: number, extra: Partial<Preset> = {}): Preset => ({ id, name, w, h, unit: 'mm', dpi: 300, margins: 15, bleed: 3, ...extra });
const inch = (id: string, name: string, w: number, h: number, extra: Partial<Preset> = {}): Preset => ({ id, name, w, h, unit: 'in', dpi: 300, margins: 0.5, bleed: 0.125, ...extra });
const px = (id: string, name: string, w: number, h: number, extra: Partial<Preset> = {}): Preset => ({ id, name, w, h, unit: 'px', dpi: 72, margins: 0, bleed: 0, ...extra });

export const PRESETS: Record<Exclude<CategoryId, 'templates'>, Preset[]> = {
  print: [
    mm('a4', 'A4', 210, 297),
    mm('a3', 'A3', 297, 420),
    mm('a5', 'A5', 148, 210),
    mm('a6', 'A6 postcard', 105, 148, { margins: 6 }),
    mm('dl', 'DL flyer', 99, 210, { margins: 8 }),
    mm('card', 'Business card', 85, 55, { margins: 4 }),
    inch('letter', 'US Letter', 8.5, 11),
    inch('legal', 'US Legal', 8.5, 14),
    inch('tabloid', 'Tabloid', 11, 17),
  ],
  screen: [
    px('hd', 'HD 1080p', 1920, 1080),
    px('4k', '4K UHD', 3840, 2160),
    px('slide', 'Slides 16:9', 1920, 1080, { margins: 80 }),
    px('slide43', 'Slides 4:3', 1024, 768, { margins: 48 }),
    px('square', 'Square post', 1080, 1080),
    px('story', 'Story', 1080, 1920),
    px('desktop', 'Desktop', 1440, 1024),
    px('mobile', 'Mobile', 390, 844),
    px('banner', 'Web banner', 1500, 500),
  ],
  photo: [
    px('photo32', 'Photo 3:2', 6000, 4000, { dpi: 300 }),
    px('photo43', 'Photo 4:3', 4032, 3024, { dpi: 300 }),
    px('photo-sq', 'Square', 3000, 3000, { dpi: 300 }),
    inch('print46', '6 × 4 print', 6, 4, { margins: 0, bleed: 0 }),
    inch('print57', '7 × 5 print', 7, 5, { margins: 0, bleed: 0 }),
    inch('print108', '10 × 8 print', 10, 8, { margins: 0, bleed: 0 }),
  ],
  school: [
    mm('worksheet', 'Worksheet', 210, 297, { margins: 15 }),
    mm('booklet', 'A5 booklet', 148, 210, { margins: 12, pages: 8 }),
    mm('poster', 'Classroom poster', 297, 420, { margins: 15 }),
    mm('display', 'Display banner', 420, 297, { margins: 15 }),
    mm('cert', 'Certificate', 297, 210, { margins: 15 }),
    mm('flash', 'Flashcards', 105, 74, { margins: 6, pages: 2 }),
    px('school-slide', 'Lesson slides', 1920, 1080, { margins: 80, pages: 6 }),
  ],
};

const CATEGORIES: { id: CategoryId; label: string; icon: string; blurb: string }[] = [
  { id: 'print', label: 'Print', icon: 'pages', blurb: 'Paper sizes at 300 dpi with bleed' },
  { id: 'screen', label: 'Screen', icon: 'rect', blurb: 'Pixel sizes for slides, web and social' },
  { id: 'photo', label: 'Photo', icon: 'photo', blurb: 'Camera ratios and photo print sizes' },
  { id: 'school', label: 'School', icon: 'textframe', blurb: 'Worksheets, posters and booklets' },
  { id: 'templates', label: 'Templates', icon: 'layout', blurb: 'Ready-made, fully editable designs' },
];

const UNITS: Unit[] = ['px', 'mm', 'cm', 'in', 'pt'];
const DPIS = [72, 96, 150, 300, 600];
const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number, unit: Unit) => (unit === 'px' || unit === 'pt' ? String(Math.round(v)) : String(r2(v)));
export const presetMeta = (p: { w: number; h: number; unit: Unit }) => `${fmt(p.w, p.unit)} × ${fmt(p.h, p.unit)} ${p.unit}`;

/** Grid of radio cards with arrow-key navigation (2-D). */
function useGridKeys(count: number, index: number, select: (i: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const el = ref.current;
    if (!el || !count) return;
    const first = el.querySelector<HTMLElement>('[role="radio"]');
    const cols = first ? Math.max(1, Math.round(el.clientWidth / (first.offsetWidth + 8))) : 1;
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -count, End: count }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(count - 1, index + d));
    select(next);
    requestAnimationFrame(() => el.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus());
  };
  return { ref, onKeyDown };
}

/**
 * Preset thumbnail: the page drawn as real paper (white in every theme, never a
 * grey slab). `margin` (fraction of the width) draws a faint coral inset; only
 * the selected tile passes it.
 */
function PageGlyph({ w, h, margin }: { w: number; h: number; margin?: number }) {
  const s = 60 / Math.max(w, h);
  const pw = Math.max(6, w * s);
  const ph = Math.max(6, h * s);
  const m = margin ? Math.min(pw / 2 - 1, ph / 2 - 1, Math.max(1, margin * pw)) : 0;
  return (
    <span className="sheet" style={{ width: pw, height: ph }}>
      {m > 0 && <span className="sheet-margin" style={{ left: m, top: m, right: m, bottom: m }} />}
    </span>
  );
}

function PagePreview({ w, h, unit, margins, bleed, transparent, pages }: { w: number; h: number; unit: Unit; margins: number; bleed: number; transparent: boolean; pages: number }) {
  // fit the page (plus bleed) into 268 × 140
  const W = toPx(w, unit);
  const H = toPx(h, unit);
  const B = toPx(bleed, unit);
  const k = Math.min(252 / (W + 2 * B), 136 / (H + 2 * B));
  const pw = W * k;
  const ph = H * k;
  const m = Math.min(toPx(margins, unit) * k, pw / 2 - 2, ph / 2 - 2);
  const b = B * k;
  return (
    <div className="page-preview" aria-hidden="true">
      {b > 0.5 && <div className="pv-bleed" style={{ width: pw + 2 * b, height: ph + 2 * b }} />}
      <div className={`pv-page${transparent ? ' transparent' : ''}`} style={{ width: pw, height: ph }}>
        {m > 1 && <div className="pv-margin" style={{ inset: m }} />}
      </div>
      {pages > 1 && <span className="pv-pages">{pages} pages</span>}
    </div>
  );
}

function TemplateGlyph({ t }: { t: TemplateInfo }) {
  const doc = useMemo(() => t.build(), [t]);
  return <DocThumb doc={doc} max={76} />;
}

const MORE_KEY = 'quvrelo.newDoc.moreOptions';
function readMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Finds a preset by id in any category. */
function findPreset(id: string | undefined): { cat: Exclude<CategoryId, 'templates'>; preset: Preset } | null {
  if (!id) return null;
  for (const [cat, list] of Object.entries(PRESETS) as [Exclude<CategoryId, 'templates'>, Preset[]][]) {
    const preset = list.find((p) => p.id === id);
    if (preset) return { cat, preset };
  }
  return null;
}

/**
 * One way to start a blank document (UX audit P1-7). Welcome's Start cards open
 * this dialog preselected (`category`, `preset`). The studio is inferred from the
 * category; "Open in" lives under More options for people who want to choose.
 */
export function NewDocumentDialog({ category, preset: presetArg }: { category?: CategoryId; preset?: string } = {}) {
  const studios = (['photo', 'vector', 'layout'] as StudioKind[]).filter((s) => editor.feature(s));
  const templates = TEMPLATES.filter((t) => editor.feature(t.studio));

  const found = findPreset(presetArg);
  const initialCat: CategoryId = found?.cat ?? (category && (category === 'templates' || PRESETS[category]) ? category : 'print');
  const initial: Preset | null = found?.preset ?? (initialCat === 'templates' ? null : PRESETS[initialCat][0]);

  const [cat, setCatState] = useState<CategoryId>(initialCat);
  const [presetId, setPresetId] = useState<string | null>(initial?.id ?? null);
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? '');
  const [title, setTitle] = useState('Untitled');
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? 'mm');
  const [w, setW] = useState(initial?.w ?? 210);
  const [h, setH] = useState(initial?.h ?? 297);
  const [dpi, setDpi] = useState(initial?.dpi ?? 300);
  const [pages, setPages] = useState(initial?.pages ?? 1);
  const [margins, setMargins] = useState(initial?.margins ?? 15);
  const [bleed, setBleed] = useState(initial?.bleed ?? 3);
  const [transparent, setTransparent] = useState(!!initial?.transparent);
  /** Studio picked by hand under More options; null = inferred. */
  const [studioPick, setStudioPick] = useState<StudioKind | null>(null);
  const [more, setMore] = useState(readMore);

  const list = cat === 'templates' ? [] : PRESETS[cat];
  const landscape = w > h;
  const inferred = inferStudio(cat, { pages }, studios);
  const studio: StudioKind = studioPick && studios.includes(studioPick) ? studioPick : inferred;

  const setCat = (c: CategoryId) => {
    setCatState(c);
    setStudioPick(null);
  };
  const toggleMore = () => {
    const next = !more;
    setMore(next);
    try {
      localStorage.setItem(MORE_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };

  const apply = (p: Preset) => {
    setPresetId(p.id);
    setUnit(p.unit);
    setW(p.w);
    setH(p.h);
    setDpi(p.dpi);
    setMargins(p.margins);
    setBleed(p.bleed);
    setPages(p.pages ?? 1);
    setTransparent(!!p.transparent);
  };
  const custom = () => setPresetId(null);
  const changeUnit = (u: Unit) => {
    const k = (v: number) => r2(fromPx(toPx(v, unit), u));
    setW(k(w));
    setH(k(h));
    setMargins(k(margins));
    setBleed(k(bleed));
    setUnit(u);
  };
  const setOrientation = (o: 'portrait' | 'landscape') => {
    if ((o === 'landscape') !== landscape && w !== h) {
      setW(h);
      setH(w);
    }
  };

  const tIndex = Math.max(0, templates.findIndex((t) => t.id === templateId));
  const pIndex = list.findIndex((p) => p.id === presetId);
  const presetKeys = useGridKeys(list.length, pIndex, (i) => apply(list[i]));
  const tplKeys = useGridKeys(templates.length, tIndex, (i) => setTemplateId(templates[i].id));
  const template = templates[tIndex];
  const templateDoc = useMemo(() => template?.build(), [template]);

  const create = () => {
    if (cat === 'templates') {
      if (template) newFromTemplate(template.id);
      closeDialog();
      return;
    }
    const W = toPx(w, unit);
    const H = toPx(h, unit);
    newBlank({ title: title.trim() || 'Untitled', width: r2(W), height: r2(H), unit, pages, studio, margins: toPx(margins, unit), bleed: toPx(bleed, unit), background: transparent ? null : '#ffffff', dpi });
    closeDialog();
  };

  const pxW = Math.round((toPx(w, unit) / 96) * dpi);
  const pxH = Math.round((toPx(h, unit) / 96) * dpi);
  const step = unit === 'px' || unit === 'pt' ? 1 : unit === 'mm' ? 1 : 0.1;
  const activeCat = CATEGORIES.find((c) => c.id === cat)!;

  return (
    <Dialog
      title="New document"
      size="xl"
      split
      onSubmit={create}
      footerStart={cat !== 'templates' && <span className="num">{unit === 'px' ? `${fmt(w, unit)} × ${fmt(h, unit)} px` : `${pxW} × ${pxH} px at ${dpi} dpi`}</span>}
      footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={create} data-testid="create-document">Create</button></>}
    >
      <nav className="dlg-side" aria-label="Preset categories">
        <h3 className="micro">Start from</h3>
        {CATEGORIES.map((c) => (
          <button key={c.id} className="nav-item" aria-current={cat === c.id} onClick={() => setCat(c.id)} data-category={c.id}>
            <Icon name={c.icon} size={16} />
            {c.label}
            <span className="count">{c.id === 'templates' ? templates.length : PRESETS[c.id].length}</span>
          </button>
        ))}
      </nav>

      <div className="nd-grid-wrap">
        <div className="nd-grid-head">
          <h3>{activeCat.label}</h3>
          <span>{activeCat.blurb}</span>
        </div>
        {cat !== 'templates' ? (
          <div className="preset-grid" role="radiogroup" aria-label={`${activeCat.label} presets`} ref={presetKeys.ref} onKeyDown={presetKeys.onKeyDown}>
            {list.map((p, i) => {
              const on = p.id === presetId;
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={on}
                  tabIndex={on || (pIndex < 0 && i === 0) ? 0 : -1}
                  className="preset"
                  onClick={() => apply(p)}
                  onDoubleClick={() => { apply(p); requestAnimationFrame(create); }}
                  data-preset={p.id}
                >
                  <span className="glyph"><PageGlyph w={p.w} h={p.h} margin={on ? toPx(margins, unit) / toPx(p.w, p.unit) : undefined} /></span>
                  <span className="name">{p.name}</span>
                  <span className="meta">{presetMeta(p)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="preset-grid" role="radiogroup" aria-label="Templates" ref={tplKeys.ref} onKeyDown={tplKeys.onKeyDown}>
            {templates.map((t, i) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={i === tIndex}
                tabIndex={i === tIndex ? 0 : -1}
                className="preset"
                onClick={() => setTemplateId(t.id)}
                onDoubleClick={() => { newFromTemplate(t.id); closeDialog(); }}
                data-template-option={t.id}
              >
                <span className="glyph"><TemplateGlyph t={t} /></span>
                <span className="name">{t.name}</span>
                <span className="meta">{t.size}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="dlg-aside nd-aside" aria-label="Document settings">
        {cat === 'templates' ? (
          template && templateDoc && (
            <div className="tpl-info">
              <div className="page-preview"><DocThumb doc={templateDoc} max={150} /></div>
              <div className="preview-caption"><b>{template.size}</b><span>{template.studio[0].toUpperCase() + template.studio.slice(1)} studio</span></div>
              <h4>{template.name}</h4>
              <p>{template.description}. Every element stays editable.</p>
            </div>
          )
        ) : (
          <>
            <PagePreview w={w} h={h} unit={unit} margins={margins} bleed={bleed} transparent={transparent} pages={pages} />
            <div className="preview-caption">
              <b>{presetId ? list.find((p) => p.id === presetId)?.name ?? 'Custom' : 'Custom'}</b>
              <span>{presetMeta({ w, h, unit })}</span>
              <span className="opens-in" data-testid="opens-in">Opens in {studio[0].toUpperCase() + studio.slice(1)}</span>
            </div>
            <div className="fgrid">
              <Field label="Name" htmlFor="nd-title">
                <input id="nd-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
              </Field>
              <Field label="Size">
                <div className="pair">
                  <NumberInput label="Width" prefix="W" unit={unit} value={w} min={0.01} step={step} onChange={(v) => { setW(v); custom(); }} />
                  <NumberInput label="Height" prefix="H" unit={unit} value={h} min={0.01} step={step} onChange={(v) => { setH(v); custom(); }} />
                </div>
              </Field>
              <Field label="Units" htmlFor="nd-units">
                <div className="pair">
                  <select id="nd-units" aria-label="Units" value={unit} onChange={(e) => changeUnit(e.target.value as Unit)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <Segmented
                    label="Orientation"
                    full
                    value={landscape ? 'landscape' : 'portrait'}
                    onChange={setOrientation}
                    options={[
                      { value: 'portrait', label: <span className="orient p" />, title: 'Portrait' },
                      { value: 'landscape', label: <span className="orient l" />, title: 'Landscape' },
                    ]}
                  />
                </div>
              </Field>
              <Field label="Resolution" htmlFor="nd-dpi" hint="Colour: RGB · 8-bit · sRGB">
                <select id="nd-dpi" value={dpi} onChange={(e) => setDpi(parseInt(e.target.value, 10))}>
                  {[...new Set([...DPIS, dpi])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} dpi{d === 300 ? ' (print)' : d === 72 ? ' (screen)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Pages" htmlFor="nd-pages">
                <NumberInput id="nd-pages" label="Pages" value={pages} min={1} max={500} step={1} onChange={(v) => setPages(Math.round(v))} />
              </Field>
              <Field label="Margins" htmlFor="nd-margins">
                <NumberInput id="nd-margins" label="Margins" unit={unit} value={margins} min={0} step={step} onChange={setMargins} />
              </Field>
              <Field label="Bleed" htmlFor="nd-bleed">
                <NumberInput id="nd-bleed" label="Bleed" unit={unit} value={bleed} min={0} step={step} onChange={setBleed} />
              </Field>
              <Field label="Background">
                <Segmented
                  label="Background"
                  full
                  value={transparent ? 't' : 'w'}
                  onChange={(v) => setTransparent(v === 't')}
                  options={[{ value: 'w', label: 'White' }, { value: 't', label: 'Transparent' }]}
                />
              </Field>
            </div>
            {studios.length > 1 && (
              <div className={`nd-more${more ? ' open' : ''}`}>
                <button type="button" className="nd-more-toggle" aria-expanded={more} aria-controls="nd-more-body" onClick={toggleMore} data-testid="more-options">
                  <Icon name={more ? 'chevron-down' : 'chevron-right'} size={16} />
                  More options
                </button>
                {more && (
                  <div className="fgrid" id="nd-more-body">
                    <Field label="Open in" hint={studioPick ? undefined : 'Chosen from the category. Every studio can edit the document later.'}>
                      <Segmented
                        label="Open in studio"
                        full
                        value={studio}
                        onChange={setStudioPick}
                        options={studios.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </aside>
    </Dialog>
  );
}
