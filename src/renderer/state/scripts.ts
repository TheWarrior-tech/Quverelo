/** The user's own scripts (Scripts panel), kept on this computer only (localStorage). */
import { EXAMPLE_SCRIPTS, type ExampleScript } from '../../core/scripting/examples';
import type { ScriptRunResult } from '../../core/scripting/runner';

export interface UserScript {
  id: string;
  name: string;
  language: 'js' | 'ts';
  source: string;
  updatedAt: string;
}

const KEY = 'quvrelo.scripts.v1';
type Listener = () => void;
const listeners = new Set<Listener>();
let lastRun: { name: string; result: ScriptRunResult } | null = null;

export function listUserScripts(): UserScript[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => s && typeof s.source === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: UserScript[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable */
  }
  for (const l of listeners) l();
}

export function saveUserScript(s: Omit<UserScript, 'id' | 'updatedAt'> & { id?: string }): UserScript {
  const list = listUserScripts();
  const entry: UserScript = { id: s.id ?? `s${Date.now().toString(36)}`, name: s.name.trim() || 'Untitled script', language: s.language, source: s.source, updatedAt: new Date().toISOString() };
  const i = list.findIndex((x) => x.id === entry.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  write(list);
  return entry;
}

export function deleteUserScript(id: string): void {
  write(listUserScripts().filter((s) => s.id !== id));
}

export function examples(): ExampleScript[] {
  return EXAMPLE_SCRIPTS;
}

export function setLastRun(name: string, result: ScriptRunResult): void {
  lastRun = { name, result };
  for (const l of listeners) l();
}

export function getLastRun() {
  return lastRun;
}

export function onScriptsChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
