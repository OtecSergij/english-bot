import type { Context, SessionFlavor } from 'grammy';

/** Per-user finite state (design-doc.md §8). */
export type Mode = 'idle' | 'review' | 'test';

/**
 * Session holds ONLY transient flow state (current mode; the in-progress card
 * queue once flows are implemented). Deliberately in-memory: it resets on restart,
 * which is the desired behaviour for transient state. Persistent data (words,
 * settings, schedule) lives in Postgres, never here.
 */
export interface SessionData {
  mode: Mode;
}

export type MyContext = Context & SessionFlavor<SessionData>;

export function initialSession(): SessionData {
  return { mode: 'idle' };
}

/** Predicate: user is currently in `mode`. */
export const modeIs =
  (mode: Mode) =>
  (ctx: MyContext): boolean =>
    ctx.session.mode === mode;

/**
 * Predicate: free text (not a /command) while in `mode`. Used to route message
 * text by FSM mode without swallowing commands (design-doc.md §8).
 */
export const freeTextIn =
  (mode: Mode) =>
  (ctx: MyContext): boolean =>
    ctx.session.mode === mode && !(ctx.message?.text?.startsWith('/') ?? false);
