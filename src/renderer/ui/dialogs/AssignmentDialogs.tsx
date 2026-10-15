import { useState } from 'react';
import type { AssignmentInfo } from '../../../core/types';
import { editor } from '../../state/editor';
import { closeDialog, toast } from '../../state/bus';
import { handIn } from '../../state/io';
import { Dialog } from './DialogHost';
import { Field } from './controls';

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
    <Dialog
      title="Assignment details"
      onSubmit={save}
      footerStart={a && <button className="btn danger" onClick={() => { editor.commit('Remove assignment', (d) => { const { assignment: _x, ...rest } = d; return rest as typeof d; }); closeDialog(); }}>Remove details</button>}
      footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}
    >
      <p>Add the brief, then share this file or save it to a school template folder. Students see it here and hand in with File › Hand In.</p>
      <div className="fgrid">
        <Field label="Assignment" htmlFor="as-title"><input id="as-title" type="text" value={info.title} onChange={set('title')} /></Field>
        <Field label="Class" htmlFor="as-class"><input id="as-class" type="text" value={info.className} onChange={set('className')} placeholder="e.g. 9B Art" /></Field>
        <Field label="Teacher" htmlFor="as-teacher"><input id="as-teacher" type="text" value={info.teacher} onChange={set('teacher')} placeholder="e.g. Ms Patel" /></Field>
        <Field label="Due date" htmlFor="as-due"><input id="as-due" type="text" value={info.dueDate} onChange={set('dueDate')} placeholder="e.g. Friday 21 November" /></Field>
        <Field label="Instructions" htmlFor="as-ins"><textarea id="as-ins" className="field" rows={5} value={info.instructions} onChange={set('instructions')} /></Field>
        {info.submittedAt && <p className="note" style={{ margin: 0 }}>Handed in by {info.studentName} on {new Date(info.submittedAt).toLocaleString()}</p>}
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
    <Dialog title="Hand in" onSubmit={submit} footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>{busy ? 'Handing in…' : 'Hand in'}</button></>}>
      {a ? (
        <div className="brief">
          <h4>{a.title}</h4>
          <div className="meta">{[a.className || 'No class set', a.teacher, a.dueDate && `Due ${a.dueDate}`].filter(Boolean).join(' · ')}</div>
          {a.instructions && <p>{a.instructions}</p>}
        </div>
      ) : (
        <p>This document has no assignment details. It will be handed in to a “Class” folder.</p>
      )}
      <div className="fgrid">
        <Field label="Your name" htmlFor="hi-name"><input id="hi-name" type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <p className="note" style={{ margin: '12px 0 0' }}>{editor.policy.handInDirectory ? 'Your work is copied to the hand-in folder set by your school.' : 'You will be asked to choose the hand-in folder.'} A timestamped copy is saved; you can keep working on your own file.</p>
    </Dialog>
  );
}
