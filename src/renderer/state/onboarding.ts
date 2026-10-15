/**
 * Persists first-run checklist progress (core/onboarding.ts) in user settings.
 * Steps are marked where the action really happens (io.ts, commands.ts) and by
 * a watcher for content the user adds (text, images) after a document opens.
 */
import { readOnboarding, withStep, type OnboardingState, type OnboardingStep } from '../../core/onboarding';
import type { SceneNode } from '../../core/types';
import { editor } from './editor';

export function onboardingState(): OnboardingState {
  return readOnboarding(editor.settings.onboarding);
}

async function save(next: OnboardingState): Promise<void> {
  editor.settings = { ...editor.settings, onboarding: next };
  editor.emit();
  try {
    editor.settings = await window.quvrelo.setSettings({ onboarding: next });
    editor.emit();
  } catch {
    /* settings persistence unavailable */
  }
}

export function markStep(step: OnboardingStep): void {
  if (editor.policy.disableOnboarding) return;
  const cur = onboardingState();
  const next = withStep(cur, step);
  if (next !== cur) void save(next);
}

export function dismissChecklist(): void {
  void save({ ...onboardingState(), dismissed: true });
}

/** Counts text nodes (artistic and frame text) in a node tree, groups included. */
export function countText(nodes: SceneNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'textframe') n++;
    else if (node.type === 'group') n += countText(node.children);
  }
  return n;
}

function docText(): number {
  const doc = editor.doc;
  return doc ? countText([...doc.pages, ...doc.masters].flatMap((c) => c.nodes)) : 0;
}

/**
 * Ticks "Add text" when the open document gains a text node it did not have
 * when it was opened, so a template that already contains text does not count.
 * (Images are marked where they are placed, in io.ts: a blank pixel layer is
 * not a placed image.)
 */
export function startOnboardingWatcher(): () => void {
  let session: unknown = null;
  let base = 0;
  return editor.subscribe(() => {
    if (editor.policy.disableOnboarding) return;
    const ob = onboardingState();
    if (ob.dismissed || ob.done.includes('text')) return;
    if (editor.session !== session) {
      session = editor.session;
      base = docText();
      return;
    }
    if (!session) return;
    const now = docText();
    if (now > base) markStep('text');
    base = Math.max(base, now);
  });
}
