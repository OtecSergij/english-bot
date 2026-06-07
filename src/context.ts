import type { Context, SessionFlavor } from 'grammy';
import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';

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

/**
 * Three context layers for the conversations plugin's replay model:
 * - `BaseContext` — the outside middleware tree, with session (the plugin's `OC`).
 * - `MyContext` — `BaseContext` + `ctx.conversation` controls; used by the Bot and
 *   all feature composers (outside middleware).
 * - `MyConversationContext` — rebuilt from scratch on every replay INSIDE a
 *   conversation; it never passes through middleware, so it has NO `ctx.session`
 *   and NO `ctx.conversation`. Reach outside state via `conversation.external`.
 */
export type BaseContext = Context & SessionFlavor<SessionData>;
export type MyContext = ConversationFlavor<BaseContext>;
export type MyConversationContext = Context;
export type MyConversation = Conversation<BaseContext, MyConversationContext>;

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
