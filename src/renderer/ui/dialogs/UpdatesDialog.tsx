/** Help ▸ Check for Updates (docs/DESIGN.md §8 Dialogs). */
import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../shared/api';
import { closeDialog, toast } from '../../state/bus';
import {
  checkForUpdates, downloadUpdate, openUpdateDownload, restartToUpdate, setUpdatesDialogOpen, useUpdateState,
} from '../../state/updates';
import { editor } from '../../state/editor';
import { Logo } from '../Icons';
import { Dialog } from './DialogHost';
import { formatBytes } from './controls';

const CHANNEL_LABEL = { stable: 'Stable', beta: 'Beta' } as const;

function timeOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatusBlock({ s }: { s: UpdateState }) {
  const v = s.latest ?? '';
  switch (s.status) {
    case 'checking':
      return <p className="upd-status" data-status="checking">Checking for updates…</p>;
    case 'downloading': {
      const p = s.progress;
      const pct = p ? Math.max(0, Math.min(100, p.percent)) : 0;
      return (
        <div className="upd-status" data-status="downloading">
          <p>Downloading Quvrelo {v}</p>
          <div className="upd-progress" role="progressbar" aria-label={`Downloading Quvrelo ${v}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="upd-meta num">
            {p && p.total > 0 ? `${formatBytes(p.transferred)} of ${formatBytes(p.total)}` : 'Starting…'}
            {p && p.bytesPerSecond > 0 ? ` · ${formatBytes(p.bytesPerSecond)}/s` : ''}
            <span className="upd-pct">{Math.floor(pct)}%</span>
          </p>
        </div>
      );
    }
    case 'ready':
      return (
        <div className="upd-status" data-status="ready">
          <p>Quvrelo {v} is downloaded and verified.</p>
          <p className="upd-meta">
            Restart to finish updating{s.autoInstallOnQuit ? ', or it installs the next time you quit' : ''}. Unsaved work is never lost: you will be asked to save first.
          </p>
        </div>
      );
    case 'available':
      return (
        <div className="upd-status" data-status="available">
          <p>Quvrelo {v} is available.</p>
          {s.mode === 'notify' && s.note && <p className="upd-meta">{s.note}</p>}
          {s.mode === 'auto' && <p className="upd-meta">Automatic download is off. Download now and restart when it suits you.</p>}
          {s.command && (
            <div className="upd-cmd">
              <code>{s.command}</code>
              <button
                type="button"
                className="btn ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(s.command!);
                    toast('Command copied', 'success');
                  } catch {
                    toast('Could not copy the command', 'error');
                  }
                }}
              >
                Copy
              </button>
            </div>
          )}
        </div>
      );
    case 'up-to-date':
      return (
        <div className="upd-status" data-status="up-to-date">
          <p>Quvrelo is up to date.</p>
          {s.checkedAt && <p className="upd-meta num">Checked at {timeOf(s.checkedAt)}</p>}
        </div>
      );
    case 'error':
      return (
        <div className="upd-status" data-status="error">
          <p className="upd-error">{s.error ?? 'The update check failed.'}</p>
          {s.checkedAt && <p className="upd-meta num">Tried at {timeOf(s.checkedAt)}</p>}
        </div>
      );
    case 'disabled':
      return (
        <div className="upd-status" data-status="disabled">
          <p>Automatic updates are off.</p>
          {s.note && <p className="upd-meta">{s.note}</p>}
        </div>
      );
    default:
      return <p className="upd-status" data-status="idle">Not checked yet.</p>;
  }
}

export function UpdatesDialog() {
  const s = useUpdateState();
  const [notesFor, setNotesFor] = useState<string | null>(null);

  useEffect(() => {
    setUpdatesDialogOpen(true);
    const st = s?.status;
    if (st !== 'disabled' && st !== 'downloading' && st !== 'ready' && st !== 'checking') void checkForUpdates();
    return () => setUpdatesDialogOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s) return null;
  const busy = s.status === 'checking' || s.status === 'downloading';
  const canCheck = s.mode !== 'disabled' && !busy && s.status !== 'ready';
  const showNotes = !!s.releaseNotes && ['available', 'downloading', 'ready'].includes(s.status);
  const linksAllowed = editor.feature('external-links');

  let footer: JSX.Element;
  if (s.status === 'ready') {
    footer = (
      <>
        <button className="btn" onClick={closeDialog}>Later</button>
        <button className="btn primary" data-autofocus onClick={() => { closeDialog(); restartToUpdate(); }}>Restart Now</button>
      </>
    );
  } else if (s.status === 'available' && s.mode === 'auto') {
    footer = (
      <>
        <button className="btn" onClick={closeDialog}>Later</button>
        <button className="btn primary" data-autofocus onClick={() => void downloadUpdate()}>Download</button>
      </>
    );
  } else if (s.status === 'available' && s.mode === 'notify' && s.downloadUrl && linksAllowed && !(s.action === 'package-manager' && /^flatpak|snap/.test(s.command ?? ''))) {
    footer = (
      <>
        <button className="btn" onClick={closeDialog}>Later</button>
        <button className="btn primary" data-autofocus onClick={() => void openUpdateDownload()}>
          {s.action === 'package-manager' ? 'Download Package' : 'Download Update'}
        </button>
      </>
    );
  } else {
    footer = <button className="btn primary" data-autofocus onClick={closeDialog}>{s.status === 'downloading' ? 'Hide' : 'Done'}</button>;
  }

  const rows: [string, string][] = [
    ...(s.latest && s.status !== 'up-to-date' ? [['Available version', s.latest] as [string, string]] : []),
    ['Update source', s.feedLabel || '—'],
  ];

  return (
    <Dialog
      title="Software Update"
      size="md"
      className="updates-dialog"
      footerStart={canCheck ? <button className="btn ghost" onClick={() => void checkForUpdates()}>Check Again</button> : undefined}
      footer={footer}
    >
      <div className="about-head">
        <Logo className="logo" />
        <div>
          <h3>Quvrelo {s.current}</h3>
          <span>{CHANNEL_LABEL[s.channel]} channel{s.locks.channel ? ', set by your organisation' : ''}</span>
        </div>
      </div>
      <div aria-live="polite">
        <StatusBlock s={s} />
      </div>
      {showNotes && (
        <section className="upd-notes">
          <h3 className="micro">What’s new in {s.latest}</h3>
          <div className="upd-notes-body" tabIndex={0} aria-label={`Release notes for Quvrelo ${s.latest}`}>
            {(notesFor === s.latest ? s.releaseNotes! : s.releaseNotes!.slice(0, 1200)).split('\n').map((line, i) =>
              line.trim() === '' ? <span key={i} className="gap" aria-hidden="true" /> : <p key={i} className={line.startsWith('• ') ? 'li' : 'head'}>{line.startsWith('• ') ? line.slice(2) : line}</p>,
            )}
          </div>
          {s.releaseNotes!.length > 1200 && notesFor !== s.latest && (
            <button className="btn ghost upd-more" onClick={() => setNotesFor(s.latest)}>Show all notes</button>
          )}
        </section>
      )}
      <dl className="about-rows upd-rows">
        {rows.map(([k, val]) => (
          <div key={k}><dt>{k}</dt><dd data-tip={val}>{val}</dd></div>
        ))}
      </dl>
      {s.mode === 'auto' && s.status !== 'disabled' && (
        <p className="fineprint">
          Quvrelo checks every 4 hours{s.autoDownload ? ', downloads in the background' : ''} and verifies each update’s SHA-512 checksum{s.installKind === 'mac' ? ' and code signature' : ''} before installing it.
        </p>
      )}
    </Dialog>
  );
}
