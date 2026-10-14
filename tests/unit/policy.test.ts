import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, isSavePathAllowed, parsePolicy } from '../../src/core/policy';

describe('policy.json', () => {
  it('returns defaults for missing policy', () => {
    expect(parsePolicy(null).policy).toEqual(DEFAULT_POLICY);
  });
  it('parses valid keys and warns on invalid ones', () => {
    const r = parsePolicy({
      defaultSaveDirectory: 'H:\\Work', lockSaveDirectory: true, disabledFeatures: ['photo', 'bogus'],
      autosaveIntervalSeconds: 99999, forceTheme: 'neon', unknownKey: 1,
    });
    expect(r.policy.lockSaveDirectory).toBe(true);
    expect(r.policy.disabledFeatures).toEqual(['photo']);
    expect(r.policy.autosaveIntervalSeconds).toBe(3600);
    expect(r.policy.forceTheme).toBeNull();
    expect(r.warnings.length).toBe(3);
  });
  it('never disables every studio', () => {
    const r = parsePolicy({ disabledFeatures: ['photo', 'vector', 'layout'] });
    expect(r.policy.disabledFeatures).not.toContain('vector');
  });
  it('enforces locked save directories', () => {
    const { policy } = parsePolicy({ defaultSaveDirectory: 'H:\\Work', lockSaveDirectory: true, allowedSaveDirectories: ['\\\\server\\handin'] });
    const id = (p: string) => p;
    expect(isSavePathAllowed(policy, 'H:\\Work\\art\\poster.quvrelo', id)).toBe(true);
    expect(isSavePathAllowed(policy, 'h:\\work\\poster.quvrelo', id)).toBe(true);
    expect(isSavePathAllowed(policy, 'C:\\Users\\x\\poster.quvrelo', id)).toBe(false);
    expect(isSavePathAllowed(policy, 'H:\\Workshop\\x.quvrelo', id)).toBe(false);
    expect(isSavePathAllowed(policy, '\\\\server\\handin\\x.quvrelo', id)).toBe(true);
  });
});
