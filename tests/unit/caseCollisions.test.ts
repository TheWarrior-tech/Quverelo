/**
 * macOS and Windows checkouts are case-insensitive: two modules whose paths differ only by case
 * (e.g. ui/Tooltip.tsx and ui/tooltip.ts) resolve to the same file there and break the package
 * builds while Linux CI stays green. Script modules are compared without extension, since './Tooltip'
 * can resolve to either.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('case-insensitive file systems', () => {
  it('has no source modules whose paths differ only by case', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const root of ['src', 'tests']) {
      for (const f of walk(path.resolve(root))) {
        const id = f.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '').toLowerCase();
        const prev = seen.get(id);
        if (prev && prev !== f) clashes.push(`${path.relative('.', prev)} <-> ${path.relative('.', f)}`);
        else seen.set(id, f);
      }
    }
    expect(clashes).toEqual([]);
  });
});
