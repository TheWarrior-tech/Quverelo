/**
 * Runs a user script in a QuickJS sandbox (quickjs-emscripten, MIT; the engine
 * is WebAssembly with no access to the DOM, Node, the file system, the network
 * or the app's preload API). The only bridge is `__host`, which edits a
 * private copy of the document (see host.ts). Scripts may be JavaScript or
 * TypeScript (types are stripped with sucrase, MIT).
 *
 * Limits: wall-clock time (interrupt handler), memory and stack size, number
 * of objects created. A script that hits a limit is stopped and nothing it did
 * is applied.
 */
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-mjs-release-sync';
import { transform } from 'sucrase';
import type { Id, QuvreloDocument } from '../types';
import { DEFAULT_LIMITS, ScriptError, ScriptHost } from './host';
import { PRELUDE } from './prelude';

export interface ScriptRunOptions {
  timeoutMs?: number;
  memoryBytes?: number;
  maxCreated?: number;
  language?: 'js' | 'ts';
}

export interface ScriptRunResult {
  ok: boolean;
  doc: QuvreloDocument;
  selection: Id[];
  logs: string[];
  error: string | null;
  /** The script's final value (JSON-able), if any. */
  value: unknown;
  ms: number;
  changed: boolean;
}

let modPromise: Promise<QuickJSWASMModule> | null = null;
export function quickjs(): Promise<QuickJSWASMModule> {
  modPromise ??= newQuickJSWASMModuleFromVariant(variant);
  return modPromise;
}

export function toJavaScript(source: string, language: 'js' | 'ts'): string {
  if (language === 'js') return source;
  return transform(source, { transforms: ['typescript'], disableESTransforms: true }).code;
}

export async function runScript(source: string, doc: QuvreloDocument, selection: Id[] = [], opts: ScriptRunOptions = {}): Promise<ScriptRunResult> {
  const t0 = Date.now();
  const host = new ScriptHost(doc, selection, { ...DEFAULT_LIMITS, maxCreated: opts.maxCreated ?? DEFAULT_LIMITS.maxCreated });
  const fail = (error: string): ScriptRunResult => ({ ok: false, doc, selection, logs: host.logs, error, value: undefined, ms: Date.now() - t0, changed: false });
  let code: string;
  try {
    code = toJavaScript(source, opts.language ?? 'js');
  } catch (e) {
    return fail(`Syntax error: ${(e as Error).message}`);
  }
  const mod = await quickjs();
  const rt = mod.newRuntime();
  rt.setMemoryLimit(opts.memoryBytes ?? 64 * 1024 * 1024);
  rt.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + (opts.timeoutMs ?? 5000);
  let timedOut = false;
  rt.setInterruptHandler(() => {
    if (Date.now() > deadline) { timedOut = true; return true; }
    return false;
  });
  const vm = rt.newContext();
  try {
    const hostFn = vm.newFunction('__host', (opH, argsH) => {
      const op = vm.getString(opH);
      let args: unknown[] = [];
      try { args = JSON.parse(vm.getString(argsH)); } catch { /* bad args */ }
      try {
        const value = host.call(op, args);
        return vm.newString(JSON.stringify({ value: value === undefined ? null : value }));
      } catch (e) {
        return vm.newString(JSON.stringify({ error: e instanceof ScriptError ? e.message : `Internal error in ${op}: ${(e as Error).message}` }));
      }
    });
    vm.setProp(vm.global, '__host', hostFn);
    hostFn.dispose();
    const pre = vm.evalCode(PRELUDE, 'quvrelo-prelude.js');
    if (pre.error) {
      const err = vm.dump(pre.error);
      pre.error.dispose();
      return fail(`Prelude failed: ${JSON.stringify(err)}`);
    }
    pre.value.dispose();
    // hide the raw bridge from the script's globals (the prelude keeps its own reference)
    const hide = vm.evalCode('delete globalThis.__host;');
    if (hide.error) hide.error.dispose(); else hide.value.dispose();
    const r = vm.evalCode(`(function(){${code}\n})()`, 'script.js');
    if (r.error) {
      const err = vm.dump(r.error) as { name?: string; message?: string; stack?: string } | string;
      r.error.dispose();
      if (timedOut) return fail(`The script took longer than ${Math.round((opts.timeoutMs ?? 5000) / 1000)} s and was stopped`);
      if (typeof err === 'object' && err) {
        const line = /script\.js:(\d+)/.exec(err.stack ?? '')?.[1];
        return fail(`${err.name ?? 'Error'}: ${err.message ?? String(err)}${line ? ` (line ${line})` : ''}`);
      }
      return fail(String(err));
    }
    let value: unknown;
    try { value = vm.dump(r.value); } catch { value = undefined; }
    r.value.dispose();
    return { ok: true, doc: host.doc, selection: host.selection, logs: host.logs, error: null, value, ms: Date.now() - t0, changed: host.doc !== doc };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return fail(/out of memory/i.test(msg) ? 'The script used too much memory and was stopped' : msg);
  } finally {
    vm.dispose();
    rt.dispose();
  }
}
