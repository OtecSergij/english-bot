import type { Context, SessionFlavor } from 'grammy';
import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';

/** Per-user finite state (design-doc.md §8). */
export type Mode = 'idle' | 'review' | 'test';

/**
 * Transient state of an in-progress review session (design-doc.md §5). We do NOT
 * store the card queue: the next due card is recomputed from the DB each step
 * (a graded card's `next_review` moves past today, so it leaves the due set on its
 * own). We only need the per-session budget and the on-screen card.
 */
export interface ReviewState {
  /** Session size = min(review_count, deck size), fixed at start — the `N/total`. */
  total: number;
  /**
   * Word ids already graded this session. Length = cards done (step shown =
   * `length + 1`; session ends at `total`). Also the exclude-set for the next pick,
   * so a word never repeats within one run (review has no due filter to lean on).
   */
  seenIds: number[];
  /**
   * The card on screen awaiting a grade — guards button presses. `null` means "no
   * card awaiting a grade" (a graded card has been consumed but the next one isn't
   * shown yet), so a stale press can't re-grade it.
   */
  currentWordId: number | null;
  /**
   * The ONE message the whole session lives in (design-doc.md §5). Every step edits
   * it (card → card) so the chat isn't littered, exactly like the add-word flow.
   */
  messageId: number;
}

/**
 * Session holds ONLY transient flow state (current mode + in-progress review).
 * Deliberately in-memory: it resets on restart, which is the desired behaviour for
 * transient state. Persistent data (words, settings, schedule) lives in Postgres,
 * never here.
 */
export interface SessionData {
  mode: Mode;
  /** Present only while `mode === 'review'`. */
  review?: ReviewState;
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
