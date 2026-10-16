import { useState } from 'react';
import { closeDialog } from '../../state/bus';
import { examples, listUserScripts, saveUserScript, getLastRun } from '../../state/scripts';
import { runAndReport } from '../panels/ScriptsPanel';
import { Dialog } from './DialogHost';
import { Field, Segmented } from './controls';
import '../panels/scripts.css';

/** Script editor (Scripts panel › New / Edit). Saves to My scripts; Run saves first and keeps the dialog open on errors. */
export function ScriptEditorDialog({ id, example }: { id?: string; example?: string }) {
  const existing = id ? listUserScripts().find((s) => s.id === id) : undefined;
  const ex = example ? examples().find((e) => e.id === example) : undefined;
  const [name, setName] = useState(existing?.name ?? (ex ? `${ex.name} (copy)` : 'My script'));
  const [language, setLanguage] = useState<'js' | 'ts'>(existing?.language ?? ex?.language ?? 'js');
  const [source, setSource] = useState(existing?.source ?? ex?.source ?? "// Your script runs on the open document. Example:\nfor (const n of selection.nodes) n.opacity = 0.5;\nlog('Done');\n");
  const [savedId, setSavedId] = useState(existing?.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = () => {
    const s = saveUserScript({ id: savedId, name, language, source });
    setSavedId(s.id);
    return s;
  };
  const saveClose = () => {
    save();
    closeDialog();
  };
  const run = async () => {
    const s = save();
    setBusy(true);
    setError(null);
    try {
      const ok = await runAndReport(s.name, s.source, s.language, true);
      if (ok) closeDialog();
      else setError(getLastRun()?.result.error ?? 'The script stopped');
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab indents inside the editor; Escape (handled by Dialog) and Ctrl+Enter (run) still work.
    // Shift+Tab leaves the editor so keyboard users are never trapped.
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const t = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = t;
      const next = source.slice(0, a) + '  ' + source.slice(b);
      setSource(next);
      requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2));
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void run();
    }
  };
  return (
    <Dialog
      title={existing ? 'Edit script' : 'New script'}
      size="xl"
      footerStart={error ? <p className="script-error" role="alert">{error}</p> : <span className="note">Ctrl+Enter runs · Shift+Tab leaves the editor</span>}
      footer={
        <>
          <button className="btn" onClick={closeDialog}>Cancel</button>
          <button className="btn" onClick={saveClose}>Save</button>
          <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : 'Save and run'}</button>
        </>
      }
    >
      <div className="script-editor">
        <div className="script-fields">
          <div className="fgrid">
            <Field label="Name" htmlFor="script-name"><input id="script-name" type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Language">
              <Segmented value={language} onChange={(v) => setLanguage(v as 'js' | 'ts')} label="Script language" options={[{ value: 'js', label: 'JavaScript' }, { value: 'ts', label: 'TypeScript' }]} />
            </Field>
          </div>
          <label className="sr-only" htmlFor="script-source">Script source</label>
          <textarea
            id="script-source"
            className="script-source"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={onKey}
            data-autofocus=""
          />
        </div>
        <aside className="script-help" aria-label="Scripting reference">
          <h4>Document</h4>
          <ul>
            <li><code>document.page</code>, <code>document.pages</code></li>
            <li><code>page.addRect({'{'} x, y, w, h, fill {'}'})</code></li>
            <li><code>addEllipse</code>, <code>addStar</code>, <code>addText</code>, <code>addPath(d)</code></li>
            <li><code>document.find({'{'} type, name, text {'}'})</code></li>
            <li><code>document.title</code>, <code>addPage()</code>, <code>addSwatch()</code></li>
          </ul>
          <h4>Objects</h4>
          <ul>
            <li><code>name x y w h rotation opacity</code></li>
            <li><code>fill stroke strokeWidth blend visible</code></li>
            <li><code>text fontSize fontFamily</code></li>
            <li><code>.remove() .duplicate() .moveBy()</code></li>
          </ul>
          <h4>Also</h4>
          <ul>
            <li><code>selection.nodes</code>, <code>selection.set([...])</code></li>
            <li><code>units.mm(10)</code>, <code>color.hsl(h, s, l)</code></li>
            <li><code>log(...)</code> writes to Output</li>
          </ul>
          <p>Scripts run in a sandbox with no files or network, and stop after 5 seconds. One run is one undo step. Full reference: docs/SCRIPTING.md.</p>
        </aside>
      </div>
    </Dialog>
  );
}

/** What an import could not keep editable (PSD, AI/PDF, IDML). */
export function ImportReportDialog({ name, warnings }: { name: string; warnings: string[] }) {
  return (
    <Dialog title="Import notes" size="md" footer={<button className="btn primary" onClick={closeDialog}>Done</button>}>
      <p>{name} opened. These parts were changed so the file could be edited in Quvrelo:</p>
      <ul className="import-report">
        {warnings.map((w) => <li key={w}>{w}</li>)}
      </ul>
    </Dialog>
  );
}
