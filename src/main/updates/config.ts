/**
 * Policy + user preferences → electron-updater configuration. Pure (no Electron
 * imports) so it can be unit tested. See docs/ADMIN_GUIDE.md "Updates".
 */
import { featureEnabled, type Policy, type UpdateChannel } from '../../core/policy';

/** Public feed: the GitHub Releases of the project (written into app-update.yml by electron-builder too). */
export const GITHUB_FEED = { provider: 'github', owner: 'TheWarrior-tech', repo: 'Quverelo', releaseType: 'release' } as const;

export const RELEASES_PAGE = `https://github.com/${GITHUB_FEED.owner}/${GITHUB_FEED.repo}/releases`;

/** The user's own choices (Preferences ▸ General). Policy may override both. */
export interface UpdatePrefs {
  autoDownloadUpdates: boolean;
  updateChannel: UpdateChannel;
}

export type FeedConfig =
  | { provider: 'github'; owner: string; repo: string; releaseType: 'release' }
  | { provider: 'generic'; url: string; channel: string };

export interface UpdaterConfig {
  /** false when policy turns update checks off entirely. */
  enabled: boolean;
  disabledReason: string | null;
  feed: FeedConfig;
  /** Effective channel after policy. */
  channel: UpdateChannel;
  /**
   * Value for `updater.channel`. Always set (electron-updater cannot unset it once set):
   * "latest" reads latest*.yml (same as the default), "beta" reads beta*.yml and, on GitHub,
   * considers prerelease releases too.
   */
  updaterChannel: 'latest' | 'beta';
  allowPrerelease: boolean;
  /** Never offer an older build, even after switching from beta back to stable. */
  allowDowngrade: false;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  /** Which preferences are fixed by the administrator (UI shows them disabled with a note). */
  locks: { autoDownload: boolean; autoInstall: boolean; channel: boolean };
  /** Human label for the feed, shown in the Updates dialog. */
  feedLabel: string;
  /** Where "Download update" sends people when the app cannot install by itself. */
  downloadPage: string;
}

export function resolveUpdaterConfig(policy: Policy, prefs: UpdatePrefs): UpdaterConfig {
  const channel: UpdateChannel = policy.updateChannel ?? (prefs.updateChannel === 'beta' ? 'beta' : 'stable');
  const beta = channel === 'beta';
  const generic = policy.updateFeedUrl;
  const feed: FeedConfig = generic
    ? { provider: 'generic', url: generic, channel: beta ? 'beta' : 'latest' }
    : { ...GITHUB_FEED };

  let disabledReason: string | null = null;
  if (policy.disableUpdateCheck || !featureEnabled(policy, 'update-check')) {
    disabledReason = 'Updates are managed by your organisation.';
  }

  return {
    enabled: disabledReason === null,
    disabledReason,
    feed,
    channel,
    updaterChannel: beta ? 'beta' : 'latest',
    allowPrerelease: beta,
    allowDowngrade: false,
    autoDownload: policy.autoDownload ?? prefs.autoDownloadUpdates !== false,
    autoInstallOnAppQuit: policy.autoInstall ?? true,
    locks: {
      autoDownload: policy.autoDownload !== null,
      autoInstall: policy.autoInstall !== null,
      channel: policy.updateChannel !== null,
    },
    feedLabel: generic ? hostOf(generic) : 'GitHub Releases',
    downloadPage: generic ?? RELEASES_PAGE,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Release notes arrive as HTML (GitHub) or Markdown/plain text (generic feeds).
 * The renderer is offline-only and never renders remote HTML, so reduce them
 * to plain text lines: block tags become line breaks, list items become "• ".
 */
export function releaseNotesToText(notes: unknown): string {
  let raw = '';
  if (typeof notes === 'string') raw = notes;
  else if (Array.isArray(notes)) {
    raw = notes
      .map((n) => (n && typeof n === 'object' && 'note' in n ? String((n as { version?: string; note?: string | null }).note ?? '') : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  if (!raw) return '';
  let s = raw
    .replace(/\r\n?/g, '\n')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/\s*li\s*>/gi, '')
    .replace(/<\s*li(\s[^>]*)?>/gi, '\n• ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/?\s*(p|div|ul|ol|h[1-6]|li|tr|table|pre|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
  // Markdown bullets and headings read fine as text; normalise "- " / "* " bullets.
  s = s.replace(/^[ \t]*[-*][ \t]+/gm, '• ').replace(/^#{1,6}[ \t]+/gm, '');
  return s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20_000);
}
