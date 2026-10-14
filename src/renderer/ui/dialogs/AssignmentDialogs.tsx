import { useState } from 'react';
import type { AssignmentInfo } from '../../../core/types';
import { editor } from '../../state/editor';
import { closeDialog, toast } from '../../state/bus';
import { handIn } from '../../state/io';
import { Dialog } from './DialogHost';

export function AssignmentDialog() {
  const doc = editor.doc!;
  const a = doc.assignment;
  const [info, setInfo] = useState<AssignmentInfo>(a ?? { title: doc.title, className: '', teacher: '', dueDate: '', instructions: '' });
  const save = () => {
    editor.commit('Assignment details', (d) => ({ ...d, assignment: { ...info } }));
    closeDialog();
    toast('Assignment details saved in the document', 'success');
  };
  const set = (k: keyof AssignmentInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInfo({ ...info, [k]: e.target.value });
  return (
    <Dialog title="Assignment Details" footer={<>{a && <button className="btn danger" onClick={() => { editor.commit('Remove assignment', (d) => { const { assignment: _x, ...rest } = d; return rest as typeof d; }); closeDialog(); }}>Remove</button>}<button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <p>Teachers: add instructions, then share this file (or save it into a school template folder). Students see the brief here and hand in with File ▸ Hand In.</p>
      <div className="form-grid">
        <label htmlFor="as-title">Assignment</label>
        <input id="as-title" type="text" value={info.title} onChange={set('title')} />
        <label htmlFor="as-class">Class</label>
        <input id="as-class" type="text" value={info.className} onChange={set('className')} placeholder="e.g. 9B Art" />
        <label htmlFor="as-teacher">Teacher</label>
        <input id="as-teacher" type="text" value={info.teacher} onChange={set('teacher')} />
        <label htmlFor="as-due">Due date</label>
        <input id="as-due" type="text" value={info.dueDate} onChange={set('dueDate')} placeholder="e.g. Friday 21 November" />
        <label htmlFor="as-ins">Instructions</label>
        <textarea id="as-ins" className="field" rows={5} value={info.instructions} onChange={set('instructions')} />
        {info.submittedAt && (
          <div className="full" style={{ color: 'var(--text-dim)' }}>Handed in by {info.studentName} on {new Date(info.submittedAt).toLocaleString()}</div>
        )}
      </div>
    </Dialog>
  );
}

export function HandInDialog() {
  const doc = editor.doc!;
  const a = doc.assignment;
  const [name, setName] = useState(a?.studentName ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await handIn(name.trim());
      closeDialog();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Hand In" footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>{busy ? 'Handing in…' : 'Hand in'}</button></>}>
      {a ? (
        <div style={{ marginBottom: 10 }}>
          <b>{a.title}</b> · {a.className || 'No class set'}{a.teacher ? ` · ${a.teacher}` : ''}{a.dueDate ? ` · due ${a.dueDate}` : ''}
          {a.instructions && <p style={{ whiteSpace: 'pre-wrap' }}>{a.instructions}</p>}
        </div>
      ) : (
        <p>This document has no assignment details. It will be handed in to a “Class” folder.</p>
      )}
      <div className="form-grid">
        <label htmlFor="hi-name">Your name</label>
        <input id="hi-name" type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </div>
      <p style={{ fontSize: 12 }}>{editor.policy.handInDirectory ? 'Your work is copied to the hand-in folder set by your school.' : 'You will be asked to choose the hand-in folder.'} A timestamped copy is saved; you can keep working on your own file.</p>
    </Dialog>
  );
}
