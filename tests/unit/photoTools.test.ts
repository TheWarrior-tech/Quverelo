import { describe, expect, it } from 'vitest';
import { allMenuCommands } from '../../src/shared/menu';
import { STUDIO_TOOLS } from '../../src/renderer/state/editor';

describe('photo studio P0 wiring', () => {
  it('Object Select sits on the Photo rail right after Freehand Selection', () => {
    const photo = STUDIO_TOOLS.photo;
    expect(photo).toContain('object-select');
    expect(photo.indexOf('object-select')).toBe(photo.indexOf('lasso') + 1);
    expect(STUDIO_TOOLS.vector).not.toContain('object-select');
  });

  it('Select Subject has Ctrl/Cmd+Alt+S and no accelerator is used twice', () => {
    const cmds = allMenuCommands();
    expect(cmds.find((c) => c.id === 'select.subject')?.accel).toBe('CmdOrCtrl+Alt+S');
    expect(cmds.some((c) => c.id === 'select.remove-background')).toBe(true);
    const accels = cmds.filter((c) => c.accel).map((c) => c.accel!.toLowerCase());
    expect(new Set(accels).size).toBe(accels.length);
  });
});
