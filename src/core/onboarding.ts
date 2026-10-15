/**
 * First-run checklist on the Welcome screen (UX audit P1-4). Pure helpers so the
 * rules are unit-tested; the renderer persists the state in settings.onboarding.
 */

export const ONBOARDING_STEPS = ['create', 'place', 'subject', 'text', 'export'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  /** The user closed the checklist. */
  dismissed: boolean;
  /** Steps already done, in the order they happened. */
  done: OnboardingStep[];
}

export const DEFAULT_ONBOARDING: OnboardingState = { dismissed: false, done: [] };

export const STEP_LABELS: Record<OnboardingStep, string> = {
  create: 'Create a document',
  place: 'Place an image',
  subject: 'Select a subject',
  text: 'Add text',
  export: 'Export your work',
};

/** Normalise whatever is stored in settings (older builds store nothing). */
export function readOnboarding(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ONBOARDING, done: [] };
  const r = raw as Partial<OnboardingState>;
  const done = Array.isArray(r.done) ? r.done.filter((s): s is OnboardingStep => (ONBOARDING_STEPS as readonly string[]).includes(s as string)) : [];
  return { dismissed: r.dismissed === true, done: [...new Set(done)] };
}

/** Marks a step done. Returns the same object when nothing changes, so callers can skip a write. */
export function withStep(state: OnboardingState, step: OnboardingStep): OnboardingState {
  if (state.done.includes(step)) return state;
  return { ...state, done: [...state.done, step] };
}

export function isComplete(state: OnboardingState): boolean {
  return ONBOARDING_STEPS.every((s) => state.done.includes(s));
}

/** The checklist shows unless IT turned onboarding off, the user hid it, or every step is done. */
export function checklistVisible(state: OnboardingState, policy: { disableOnboarding: boolean }): boolean {
  return !policy.disableOnboarding && !state.dismissed && !isComplete(state);
}
