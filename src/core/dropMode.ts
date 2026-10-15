export type DropMode = 'open' | 'place';

/**
 * What dropping the dragged files would do (UX audit P0-3b): images dropped on an
 * open document are placed into it; anything else (a .quvrelo file, or any file
 * on the Welcome screen) is opened. `types` are the DataTransfer item MIME types
 * ('' for unknown kinds such as .quvrelo).
 */
export function dropModeFor(types: string[], hasSession: boolean): DropMode {
  return hasSession && types.length > 0 && types.every((t) => t.startsWith('image/')) ? 'place' : 'open';
}
