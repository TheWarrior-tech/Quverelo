import { contextBridge, ipcRenderer } from 'electron';
import type { EaselApi } from '../shared/api';

const api: EaselApi = {
  getPolicy: () => ipcRenderer.invoke('policy:get'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  openFileDialog: (o) => ipcRenderer.invoke('file:open-dialog', o),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  saveFile: (o) => ipcRenderer.invoke('file:save', o),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  addRecent: (p) => ipcRenderer.invoke('recent:add', p),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  writeRecovery: (e, d) => ipcRenderer.invoke('recovery:write', e, d),
  listRecovery: () => ipcRenderer.invoke('recovery:list'),
  readRecovery: (id) => ipcRenderer.invoke('recovery:read', id),
  deleteRecovery: (id) => ipcRenderer.invoke('recovery:delete', id),
  listExternalTemplates: () => ipcRenderer.invoke('templates:external'),
  handIn: (o) => ipcRenderer.invoke('handin:submit', o),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  openExternal: (u) => ipcRenderer.invoke('shell:open-external', u),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:show-item', p),
  nativeEdit: (a) => ipcRenderer.send('edit:native', a),
  setDirty: (d) => ipcRenderer.send('doc:dirty', d),
  setTitle: (t) => ipcRenderer.send('doc:title', t),
  quitNow: () => ipcRenderer.send('app:quit-now'),
  onMenuCommand: (cb) => {
    const h = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('menu:command', h);
    return () => ipcRenderer.removeListener('menu:command', h);
  },
  onOpenPath: (cb) => {
    const h = (_e: unknown, p: string) => cb(p);
    ipcRenderer.on('file:open-path', h);
    return () => ipcRenderer.removeListener('file:open-path', h);
  },
};

contextBridge.exposeInMainWorld('easel', api);
