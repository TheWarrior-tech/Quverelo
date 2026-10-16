/**
 * Preflight (Layout studio, inspector tab): live list of print problems —
 * overset text, missing fonts, low-resolution / missing images, items on the
 * pasteboard, plus any check other modules register (colour: RGB in CMYK).
 * Click an issue to go to its page and select the item. Re-runs shortly after
 * every edit.
 */
import { useEffect, useMemo, useState } from 'react';
import { preflightChecks, runPreflight, type PreflightEnv, type PreflightIssue } from '../../../core/preflight';
import type { QuvreloDocument } from '../../../core/types';
import { BUNDLED_FONTS, SYSTEM_FONTS } from '../fontList';
import { measureText, storyFlow } from '../../engine/draw';
import { editor } from '../../state/editor';
import { getViewport } from '../../state/commands';
import { pageLabel } from '../../../core/layout';
import { useEditor } from '../hooks';
import { Icon } from '../Icons';
import { Section } from '../controls/Panel';
import { installedFonts } from '../fonts';

const fontCache = new Map<string, boolean>();
let probe: CanvasRenderingContext2D | null = null;

/** Whether a font family can be drawn here: bundled, a found installed font, or it changes glyph widths. */
export function fontAvailable(family: string): boolean {
  if (BUNDLED_FONTS.some((f) => f.toLowerCase() === family.toLowerCase())) return true;
  if (installedFonts().some((f) => f.toLowerCase() === family.toLowerCase())) return true;
  const hit = fontCache.get(family);
  if (hit !== undefined) return hit;
  if (!probe) probe = document.createElement('canvas').getContext('2d');
  if (!probe) return true;
  const sample = 'mmmmmmmmmlli1WQ@#';
  let found = false;
  for (const generic of ['monospace', 'serif', 'sans-serif']) {
    probe.font = `72px ${generic}`;
    const base = probe.measureText(sample).width;
    probe.font = `72px "${family}", ${generic}`;
    if (Math.abs(probe.measureText(sample).width - base) > 0.5) {
      found = true;
      break;
    }
  }
  // a common system family that happens to match a generic's metrics
  if (!found && SYSTEM_FONTS.includes(family) && (family === 'Arial' || family === 'Helvetica')) found = true;
  fontCache.set(family, found);
  return found;
}

export function preflightEnv(): PreflightEnv {
  return {
    flow: (d, id) => storyFlow(d, id),
    measure: measureText,
    fontAvailable,
    assetSize: (id) => {
      const img = editor.assets.get(id);
      return img ? { width: img.width, height: img.height } : null;
    },
    minPpi: 150,
  };
}

/** Debounced preflight of the current document (shared by the panel and its tab badge). */
export function usePreflight(doc: QuvreloDocument | null, delay = 400): PreflightIssue[] {
  const [issues, setIssues] = useState<PreflightIssue[]>([]);
  useEffect(() => {
    if (!doc) return;
    const t = window.setTimeout(() => setIssues(runPreflight(doc, preflightEnv())), delay);
    return () => window.clearTimeout(t);
  }, [doc, delay]);
  return issues;
}

const SEV_LABEL = { error: 'Errors', warning: 'Warnings', info: 'Notes' } as const;

export function goToIssue(i: PreflightIssue): void {
  const doc = editor.doc;
  if (!doc) return;
  getViewport()?.textEdit.end();
  const container = i.containerId ?? (i.pageIndex >= 0 ? doc.pages[i.pageIndex]?.id : undefined);
  if (container) editor.setUi({ activeContainerId: container, selection: i.nodeId ? [i.nodeId] : [] });
  else if (i.nodeId) editor.select([i.nodeId]);
}

export function PreflightPanel() {
  const ed = useEditor();
  const doc = ed.doc;
  const issues = usePreflight(doc);
  const groups = useMemo(() => (['error', 'warning', 'info'] as const).map((sev) => ({ sev, items: issues.filter((i) => i.severity === sev) })).filter((g) => g.items.length), [issues]);
  if (!doc) return null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <div className="preflight-panel" data-testid="preflight">
      <div className={`preflight-summary ${errors ? 'bad' : issues.length ? 'warn' : 'ok'}`} role="status" aria-live="polite">
        <Icon name={errors ? 'close' : 'preflight'} size={16} />
        <span>{errors ? `${errors} error${errors === 1 ? '' : 's'}` : issues.length ? 'No errors' : 'No problems found'}</span>
        <span className="preflight-sub">{issues.length - errors ? `${issues.length - errors} other` : `${preflightChecks().length} checks`}</span>
      </div>
      {groups.map((g) => (
        <Section key={g.sev} id={`preflight-${g.sev}`} title={<>{SEV_LABEL[g.sev]} <span className="count">{g.items.length}</span></>}>
          <ul className="preflight-list" role="list">
            {g.items.map((i) => (
              <li key={i.id}>
                <button type="button" className={`preflight-item sev-${i.severity}`} onClick={() => goToIssue(i)} data-check={i.check}>
                  <span className="pf-dot" aria-hidden="true" />
                  <span className="pf-text">
                    <span className="pf-msg">{i.message}</span>
                    {i.detail && <span className="pf-detail">{i.detail}</span>}
                  </span>
                  <span className="pf-page num">{i.pageIndex >= 0 ? `p. ${pageLabel(doc, i.pageIndex)}` : i.containerId ? 'Master' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}
      <p className="empty-note preflight-foot">Checks: {preflightChecks().map((c) => c.label.toLowerCase()).join(', ')}.</p>
    </div>
  );
}
