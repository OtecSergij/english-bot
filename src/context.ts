import type { Context, SessionFlavor } from 'grammy';
import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { SessionCard } from './db/words';

/** Per-user finite state (design-doc.md §8). Adding words is a conversation, not a mode. */
export type Mode = 'idle' | 'review';

/**
 * Transient state of an in-progress «повторение» session (design-doc.md §5) — the
 * single active-recall flow. The selection is SNAPSHOTTED at start: grading mutates
 * `next_review` / `last_tested`, which would reorder a mid-session re-query. The queue
 * is a cycle — a wrong answer re-enqueues the word until it's answered correctly or
 * revealed (the emergency exit), so it can outlive a single pass over `cards`. There
 * is no «Дальше»/pending step: both correct and wrong auto-advance, and the result of
 * the previous card is rendered in the same message above the next prompt.
 */
export interface ReviewState {
  /** The ONE message the whole session lives in (design-doc.md §5). Every step edits it. */
  messageId: number;
  /** Immutable snapshot of the selected words — id→card lookup + the final summary. */
  cards: SessionCard[];
  /**
   * Ids still to be resolved, FIFO; the current question is `queue[0]`. Correct /
   * reveal removes it; a wrong answer moves it to the back. `done = cards.length -
   * queue.length`; the session ends when the queue empties.
   */
  queue: number[];
  /** Distinct ids that lapsed at least once (wrong or revealed) — the score, already saved. */
  failedIds: number[];
  /** Epoch ms of the last interaction — drives the lazy timeout (design-doc.md §5). */
  lastActivity: number;
  /** Internal user id, snapshotted at start (stable) — no per-answer user re-resolve. */
  userId: number;
  /**
   * IANA timezone snapshot (stable for the session). `today` is still recomputed
   * from it on each grade — a long session can cross midnight (known_issues.md §6).
   */
  timezone: string;
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

/** Review session inactivity timeout (design-doc.md §5). */
export const SESSION_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * A review session is expired once it has been idle past the timeout. Enforced
 * lazily (checked on the next interaction): for a single-user in-memory session
 * that is equivalent to a proactive close — the only observable effect of a stale
 * session is on the next touch.
 */
export function sessionExpired(review: ReviewState | undefined, now: number): boolean {
  return review !== undefined && now - review.lastActivity > SESSION_TIMEOUT_MS;
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

/**
 * Predicate: a NON-text message (sticker, photo, voice, …) while in `mode`. Lets
 * review sweep such strays from the chat so only the flow message remains (to-do
 * §UX). Excludes commands and text (those have their own handling) and non-message
 * updates (e.g. callbacks have no `ctx.message`), so a catch-all built on it can't
 * swallow a `/command` meant for another feature.
 */
export const nonTextIn =
  (mode: Mode) =>
  (ctx: MyContext): boolean =>
    ctx.session.mode === mode && ctx.message !== undefined && ctx.message.text === undefined;
