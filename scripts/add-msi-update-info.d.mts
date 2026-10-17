export interface FileEntry { url: string; sha512: string; size: number }
export function addFileEntries(yml: string, entries: FileEntry[]): string;
export function msiEntries(dir: string, version: string, names?: string[]): FileEntry[];
