import type { Context, SessionFlavor } from 'grammy';

/** Per-user finite state (see design-doc.md §8). */
export type Mode = 'idle' | 'review' | 'test';

export interface SessionData {
  mode: Mode;
  // review/test session state is added when those flows are implemented.
}

export type MyContext = Context & SessionFlavor<SessionData>;

export function initialSession(): SessionData {
  return { mode: 'idle' };
}
