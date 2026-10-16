import { useEffect, useState } from 'react';
import { Section } from '../controls/Panel';
import { Icon } from '../Icons';
import { tip } from '../tips';
import { openDialog, toast } from '../../state/bus';
import { runUserScript } from '../../state/interop';
import { deleteUserScript, examples, getLastRun, listUserScripts, onScriptsChange, saveUserScript, setLastRun } from '../../state/scripts';
import './scripts.css';

/** Run a script and record the result for the Output section. */
export async function runAndReport(name: string, source: string, language: 'js' | 'ts', inlineErrors = false): Promise<boolean> {
  const r = await runUserScript(name, source, language);
  if (!r) return false;
  setLastRun(name, r);
  if (r.ok) toast(r.changed ? `Ran “${name}” — undo with Ctrl+Z` : `Ran “${name}” (no changes)`, 'success');
  else if (!inlineErrors) toast(`“${name}” stopped: ${r.error}`, 'error');
  return r.ok;
}

function useScriptsVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => onScriptsChange(() => setV((x) => x + 1)), []);
  return v;
}

async function importScriptFile(): Promise<void> {
  const files = await window.quvrelo.openFileDialog({ title: 'Import script', filters: [{ name: 'Scripts', extensions: ['js', 'ts', 'mjs'] }] });
  for (const f of files) {
    const language = /\.ts$/i.test(f.name) ? 'ts' : 'js';
    saveUserScript({ name: f.name.replace(/\.[^.]+$/, ''), language, source: new TextDecoder().decode(f.data) });
    toast(`Added ${f.name} to My scripts`, 'success');
  }
}

/**
 * Inspector › Scripts. Bundled examples and the user's own scripts (kept on
 * this computer), each with Run and Edit; the last run's log below. Scripts
 * run sandboxed (core/scripting/runner.ts) and apply as one undo step.
 */
export function ScriptsPanel() {
  useScriptsVersion();
  const mine = listUserScripts();
  const last = getLastRun();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, name: string, source: string, language: 'js' | 'ts') => {
    setBusy(key);
    try {
      await runAndReport(name, source, language);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="scripts-panel" data-testid="scripts-panel">
      <Section
        title="My scripts"
        actions={
          <>
            <button type="button" className="icon-btn" {...tip('Import a .js or .ts file')} onClick={() => void importScriptFile()}>
              <Icon name="open" size={16} />
            </button>
            <button type="button" className="icon-btn" {...tip('New script')} onClick={() => openDialog('script-editor', {})}>
              <Icon name="plus" size={16} />
            </button>
          </>
        }
      >
        {mine.length ? (
          <ul className="script-list" aria-label="My scripts">
            {mine.map((s) => (
              <li key={s.id} className="script-row">
                <div className="script-meta">
                  <span className="script-name">{s.name}</span>
                  <span className="script-sub">{s.language === 'ts' ? 'TypeScript' : 'JavaScript'}</span>
                </div>
                <div className="script-actions">
                  <button type="button" className="btn sm" aria-label={`Run ${s.name}`} disabled={!!busy} onClick={() => void run(s.id, s.name, s.source, s.language)}>{busy === s.id ? 'Running…' : 'Run'}</button>
                  <button type="button" className="icon-btn" {...tip(`Edit ${s.name}`)} onClick={() => openDialog('script-editor', { id: s.id })}>
                    <Icon name="script" size={16} />
                  </button>
                  <button type="button" className="icon-btn" {...tip(`Delete ${s.name}`)} onClick={() => deleteUserScript(s.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="script-empty">Write a script to automate repetitive work, or start from an example below.</p>
        )}
      </Section>
      <Section id="scripts-examples" title="Examples">
        <ul className="script-list" aria-label="Example scripts">
          {examples().map((s) => (
            <li key={s.id} className="script-row">
              <div className="script-meta">
                <span className="script-name">{s.name}</span>
                <span className="script-sub">{s.description}</span>
              </div>
              <div className="script-actions">
                <button type="button" className="btn sm" aria-label={`Run ${s.name}`} disabled={!!busy} onClick={() => void run(s.id, s.name, s.source, s.language)}>{busy === s.id ? 'Running…' : 'Run'}</button>
                <button type="button" className="icon-btn" {...tip(`Open ${s.name} in the editor`)} onClick={() => openDialog('script-editor', { example: s.id })}>
                  <Icon name="script" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="scripts-output" title="Output">
        {last ? (
          <div className="script-output" role="log" aria-live="polite" aria-label="Script output">
            <p className={`script-status ${last.result.ok ? 'ok' : 'err'}`}>
              <Icon name={last.result.ok ? 'circle-check' : 'close'} size={16} />
              <span>{last.result.ok ? `${last.name} · ${last.result.ms} ms` : last.result.error}</span>
            </p>
            {last.result.logs.length > 0 && <pre className="script-log">{last.result.logs.join('\n')}</pre>}
          </div>
        ) : (
          <p className="script-empty">Messages from <code>log()</code> appear here.</p>
        )}
      </Section>
    </div>
  );
}
