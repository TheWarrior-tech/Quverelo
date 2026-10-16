/**
 * Administrator policy (policy.json). Shared by the main process (which reads
 * the file from the machine-wide location) and the renderer (which applies it).
 *
 * Windows: %ProgramData%\Quvrelo\policy.json
 * macOS:   /Library/Application Support/Quvrelo/policy.json
 * Linux:   /etc/quvrelo/policy.json
 */

export const FEATURE_IDS = [
  'photo', 'vector', 'layout', // studios
  'import-svg', 'import-images', 'export-png', 'export-jpg', 'export-svg', 'export-pdf',
  'autosave', 'recent-files', 'external-links', 'update-check', 'local-fonts', 'assignments',
  // interop & automation (parity wave 1)
  'import-psd', 'import-ai', 'import-idml', 'export-psd', 'scripting',
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export type ThemeId = 'dark' | 'light' | 'high-contrast';

export type UpdateChannel = 'stable' | 'beta';

export interface Policy {
  /** Directory used by Save / Export dialogs by default. Supports %USERPROFILE%, ~, %DOCUMENTS%. */
  defaultSaveDirectory: string | null;
  /** If true, users can only save/export inside defaultSaveDirectory (or allowedSaveDirectories). */
  lockSaveDirectory: boolean;
  /** Extra directories permitted when lockSaveDirectory is true (e.g. a network hand-in share). */
  allowedSaveDirectories: string[];
  /** Folder where students hand in assignments (shown in File ▸ Hand In). */
  handInDirectory: string | null;
  /** Hand-in bundles include a PDF preview for marking (default true; false = work file + manifest only). */
  handInIncludePreview: boolean;
  /** Turns off every update check (automatic and Help ▸ Check for Updates). Updates are then deployed by IT. */
  disableUpdateCheck: boolean;
  /**
   * Internal update server (electron-builder "generic" feed): a folder that holds latest*.yml,
   * beta*.yml, the installers and their .blockmap files. null = the public GitHub Releases feed.
   */
  updateFeedUrl: string | null;
  /** Lock background downloading of updates on (true) or off (false). null = user choice (default on). */
  autoDownload: boolean | null;
  /** Lock installing a downloaded update when the app quits. false = only when the user clicks Restart. null = on. */
  autoInstall: boolean | null;
  /** Lock the update channel. null = user choice (default "stable"). */
  updateChannel: UpdateChannel | null;
  /** Features to remove from the UI. */
  disabledFeatures: FeatureId[];
  /** Autosave interval in seconds (0 disables autosave). */
  autosaveIntervalSeconds: number;
  /** Force a theme for every user (null = user choice). */
  forceTheme: ThemeId | null;
  /** Default UI scale (0.75–2). Users may change it unless lockUiScale. */
  uiScale: number;
  lockUiScale: boolean;
  /** Extra template folders containing .quvrelo files (school template packs). */
  templateDirectories: string[];
  /** Show the welcome screen at launch. */
  showWelcomeScreen: boolean;
  /** Hide first-run onboarding (the Welcome "Get started" checklist) for every user. */
  disableOnboarding: boolean;
  /** Maximum undo steps (memory control on shared machines). */
  maxUndoSteps: number;
  /** Organisation name shown in About and the title bar. */
  organizationName: string | null;
}

export const DEFAULT_POLICY: Policy = {
  defaultSaveDirectory: null,
  lockSaveDirectory: false,
  allowedSaveDirectories: [],
  handInDirectory: null,
  handInIncludePreview: true,
  disableUpdateCheck: false,
  updateFeedUrl: null,
  autoDownload: null,
  autoInstall: null,
  updateChannel: null,
  disabledFeatures: [],
  autosaveIntervalSeconds: 60,
  forceTheme: null,
  uiScale: 1,
  lockUiScale: false,
  templateDirectories: [],
  showWelcomeScreen: true,
  disableOnboarding: false,
  maxUndoSteps: 250,
  organizationName: null,
};

export interface PolicyResult {
  policy: Policy;
  warnings: string[];
  source: string | null;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Validate untrusted JSON into a Policy, collecting warnings for bad keys. */
export function parsePolicy(raw: unknown, source: string | null = null): PolicyResult {
  const warnings: string[] = [];
  const policy: Policy = { ...DEFAULT_POLICY, disabledFeatures: [], allowedSaveDirectories: [], templateDirectories: [] };
  if (raw === null || raw === undefined) return { policy, warnings, source };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('policy.json must contain a JSON object');
    return { policy, warnings, source };
  }
  const r = raw as Record<string, unknown>;
  const known = new Set(Object.keys(DEFAULT_POLICY));
  for (const k of Object.keys(r)) if (!known.has(k) && !k.startsWith('$') && k !== 'comment') warnings.push(`Unknown policy key "${k}" ignored`);

  const strOrNull = (k: keyof Policy) => {
    if (!(k in r)) return;
    const v = r[k];
    if (v === null || isStr(v)) (policy as unknown as Record<string, unknown>)[k] = v === '' ? null : v;
    else warnings.push(`"${k}" must be a string or null`);
  };
  const bool = (k: keyof Policy) => {
    if (!(k in r)) return;
    if (typeof r[k] === 'boolean') (policy as unknown as Record<string, unknown>)[k] = r[k];
    else warnings.push(`"${k}" must be true or false`);
  };
  const strArr = (k: keyof Policy) => {
    if (!(k in r)) return;
    const v = r[k];
    if (Array.isArray(v) && v.every(isStr)) (policy as unknown as Record<string, unknown>)[k] = [...v];
    else warnings.push(`"${k}" must be an array of strings`);
  };
  const numIn = (k: keyof Policy, min: number, max: number) => {
    if (!(k in r)) return;
    const v = r[k];
    if (typeof v === 'number' && isFinite(v)) (policy as unknown as Record<string, unknown>)[k] = Math.min(max, Math.max(min, v));
    else warnings.push(`"${k}" must be a number`);
  };

  strOrNull('defaultSaveDirectory');
  bool('lockSaveDirectory');
  strArr('allowedSaveDirectories');
  strOrNull('handInDirectory');
  bool('handInIncludePreview');
  bool('disableUpdateCheck');
  numIn('autosaveIntervalSeconds', 0, 3600);
  numIn('uiScale', 0.75, 2);
  bool('lockUiScale');
  strArr('templateDirectories');
  bool('showWelcomeScreen');
  bool('disableOnboarding');
  numIn('maxUndoSteps', 10, 2000);
  strOrNull('organizationName');

  const boolOrNull = (k: 'autoDownload' | 'autoInstall') => {
    if (!(k in r)) return;
    const v = r[k];
    if (v === null || typeof v === 'boolean') policy[k] = v;
    else warnings.push(`"${k}" must be true, false or null`);
  };
  boolOrNull('autoDownload');
  boolOrNull('autoInstall');
  if ('updateFeedUrl' in r) {
    const v = r.updateFeedUrl;
    if (v === null || v === '') policy.updateFeedUrl = null;
    else if (isStr(v) && /^https?:\/\/[^\s/]+/i.test(v.trim())) policy.updateFeedUrl = v.trim().replace(/\/+$/, '') + '/';
    else warnings.push('"updateFeedUrl" must be an http:// or https:// URL or null');
  }
  if ('updateChannel' in r) {
    const v = r.updateChannel;
    if (v === null || v === 'stable' || v === 'beta') policy.updateChannel = v;
    else warnings.push('"updateChannel" must be "stable", "beta" or null');
  }

  if ('forceTheme' in r) {
    const v = r.forceTheme;
    if (v === null || v === 'dark' || v === 'light' || v === 'high-contrast') policy.forceTheme = v;
    else warnings.push('"forceTheme" must be "dark", "light", "high-contrast" or null');
  }
  if ('disabledFeatures' in r) {
    const v = r.disabledFeatures;
    if (Array.isArray(v)) {
      for (const f of v) {
        if ((FEATURE_IDS as readonly string[]).includes(f)) policy.disabledFeatures.push(f as FeatureId);
        else warnings.push(`Unknown feature "${String(f)}" in disabledFeatures`);
      }
    } else warnings.push('"disabledFeatures" must be an array');
  }
  // never allow every studio to be disabled
  if (['photo', 'vector', 'layout'].every((s) => policy.disabledFeatures.includes(s as FeatureId))) {
    warnings.push('All studios were disabled; re-enabling the Vector studio');
    policy.disabledFeatures = policy.disabledFeatures.filter((f) => f !== 'vector');
  }
  if (policy.lockSaveDirectory && !policy.defaultSaveDirectory) {
    warnings.push('"lockSaveDirectory" requires "defaultSaveDirectory"; lock ignored');
    policy.lockSaveDirectory = false;
  }
  return { policy, warnings, source };
}

export function featureEnabled(policy: Policy, f: FeatureId): boolean {
  return !policy.disabledFeatures.includes(f);
}

/** Normalise a path for prefix comparison (case-insensitive on Windows/macOS). */
function norm(p: string, caseInsensitive: boolean): string {
  let s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (caseInsensitive) s = s.toLowerCase();
  return s;
}

/** Whether saving to `target` is allowed under the policy (expects expanded absolute paths). */
export function isSavePathAllowed(policy: Policy, target: string, expand: (p: string) => string, caseInsensitive = true): boolean {
  if (!policy.lockSaveDirectory || !policy.defaultSaveDirectory) return true;
  const roots = [policy.defaultSaveDirectory, ...policy.allowedSaveDirectories, ...(policy.handInDirectory ? [policy.handInDirectory] : [])]
    .map((r) => norm(expand(r), caseInsensitive));
  const t = norm(target, caseInsensitive);
  return roots.some((r) => t === r || t.startsWith(r + '/'));
}
