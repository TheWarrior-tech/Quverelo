import type { EaselDocument } from './types';

export interface HistoryEntry {
  label: string;
  doc: EaselDocument;
  time: number;
  mergeKey?: string;
}

export interface HistoryOptions {
  limit?: number;
  mergeWindowMs?: number;
  now?: () => number;
}

type Listener = () => void;

/**
 * Snapshot history over an immutable document. Because the document uses
 * structural sharing, each entry only costs the nodes that actually changed.
 * Pixels are referenced by immutable asset ids, so raster undo is cheap too.
 */
export class DocumentHistory {
  private entries: HistoryEntry[];
  private index = 0;
  private savedDoc: EaselDocument;
  private listeners = new Set<Listener>();
  private readonly limit: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;

  constructor(doc: EaselDocument, opts: HistoryOptions = {}) {
    this.limit = opts.limit ?? 250;
    this.mergeWindowMs = opts.mergeWindowMs ?? 1200;
    this.now = opts.now ?? (() => Date.now());
    this.entries = [{ label: 'Open', doc, time: this.now() }];
    this.savedDoc = doc;
  }

  get doc(): EaselDocument {
    return this.entries[this.index].doc;
  }

  get list(): readonly HistoryEntry[] {
    return this.entries;
  }

  get position(): number {
    return this.index;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  get dirty(): boolean {
    return this.doc !== this.savedDoc;
  }

  markSaved(): void {
    this.savedDoc = this.doc;
    this.emit();
  }

  /** Record a new document state. Returns false if nothing changed. */
  push(label: string, doc: EaselDocument, mergeKey?: string): boolean {
    if (doc === this.doc) return false;
    const t = this.now();
    const top = this.entries[this.index];
    const stamped = { ...doc, modifiedAt: new Date(t).toISOString() };
    if (
      mergeKey &&
      top.mergeKey === mergeKey &&
      this.index > 0 &&
      this.index === this.entries.length - 1 &&
      t - top.time < this.mergeWindowMs
    ) {
      this.entries[this.index] = { ...top, doc: stamped, time: t };
    } else {
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push({ label, doc: stamped, time: t, mergeKey });
      if (this.entries.length > this.limit) this.entries.splice(1, this.entries.length - this.limit);
      this.index = this.entries.length - 1;
    }
    this.emit();
    return true;
  }

  /** Replace the current state without creating an entry (used for live previews). */
  replace(doc: EaselDocument): void {
    this.entries[this.index] = { ...this.entries[this.index], doc };
    this.emit();
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    this.index--;
    this.emit();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.index++;
    this.emit();
    return true;
  }

  jumpTo(i: number): void {
    if (i < 0 || i >= this.entries.length || i === this.index) return;
    this.index = i;
    this.emit();
  }

  /** Reset to a fresh document (e.g. after opening a file). */
  reset(doc: EaselDocument, label = 'Open'): void {
    this.entries = [{ label, doc, time: this.now() }];
    this.index = 0;
    this.savedDoc = doc;
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
