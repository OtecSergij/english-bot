import type { Context, SessionFlavor } from 'grammy';
import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { ReviewWord, TestCard } from './db/words';

/** Per-user finite state (design-doc.md §8). */
export type Mode = 'idle' | 'review' | 'test';

/**
 * Transient state of an in-progress review session (design-doc.md §5). The next
 * card is recomputed from the DB each step (excluding `seenIds`); we keep the
 * current card in memory so the «Показать ответ» reveal can re-render it and the
 * grade can read `intervalIndex` without a re-fetch.
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
   * The full card on screen awaiting a grade (so reveal can render it and the grade
   * reads `intervalIndex` without a DB re-fetch). `null` means "no card awaiting a
   * grade" (consumed but the next not shown yet), so a stale press can't re-grade it.
   */
  current: ReviewWord | null;
  /**
   * The ONE message the whole session lives in (design-doc.md §5). Every step edits
   * it (card → card) so the chat isn't littered, exactly like the add-word flow.
   */
  messageId: number;
  /** Internal user id, snapshotted at start (stable) — no per-grade user re-resolve. */
  userId: number;
  /**
   * IANA timezone snapshot (stable for the session). `today` is still recomputed
   * from it on each grade — a long session can cross midnight (known_issues.md §6).
   */
  timezone: string;
}

/**
 * Transient state of an in-progress test session (design-doc.md §6). Unlike review
 * (which re-queries each step), the selection is SNAPSHOTTED at start: grading
 * stamps `last_tested`, which would re-order a re-query mid-session. The queue is a
 * cycle — a wrong answer re-enqueues the word until it's answered correctly or
 * revealed (the emergency exit), so it can outlive a single pass over `cards`.
 */
export interface TestState {
  /** The ONE message the whole session lives in (design-doc.md §6; like review). */
  messageId: number;
  /** Immutable snapshot of the selected words — id→card lookup + the final summary. */
  cards: TestCard[];
  /**
   * Ids still to be resolved, FIFO; the current question is `queue[0]`. Correct /
   * reveal removes it; a wrong answer moves it to the back. `done = cards.length -
   * queue.length`; the session ends when the queue empties.
   */
  queue: number[];
  /** Distinct ids that failed at least once (wrong or revealed) — the score + already reset in the DB. */
  failedIds: number[];
  /** Epoch ms of the last interaction — drives the 20-minute lazy timeout (design-doc.md §6). */
  lastActivity: number;
  /** Internal user id, snapshotted at start (stable) — no per-answer user re-resolve. */
  userId: number;
  /**
   * IANA timezone snapshot (stable for the session). `today` is still recomputed
   * from it on each answer — a long session can cross midnight (known_issues.md §6).
   */
  timezone: string;
  /**
   * Answer-shown state (design-doc.md §6): non-null means the result/answer is on
   * screen with a «Дальше» button, holding the outcome to apply to the queue once
   * «Дальше» is pressed. `null` = a question is on screen, awaiting a typed answer.
   * (A correct answer auto-advances and never sets this.)
   */
  pending: { failed: boolean; retry: boolean } | null;
}

/**
 * Session holds ONLY transient flow state (current mode + in-progress review/test).
 * Deliberately in-memory: it resets on restart, which is the desired behaviour for
 * transient state. Persistent data (words, settings, schedule) lives in Postgres,
 * never here.
 */
export interface SessionData {
  mode: Mode;
  /** Present only while `mode === 'review'`. */
  review?: ReviewState;
  /** Present only while `mode === 'test'`. */
  test?: TestState;
}

/** Test session inactivity timeout (design-doc.md §6). */
export const TEST_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * A test session is expired once it has been idle past the timeout. Enforced
 * lazily (checked on the next interaction): for a single-user in-memory session
 * that is equivalent to a proactive close — the only observable effect of a stale
 * session is on the next touch — while keeping `lastActivity` available for the
 * Phase 5 scheduler to defer a scheduled review around an active test.
 */
export function testExpired(test: TestState | undefined, now: number): boolean {
  return test !== undefined && now - test.lastActivity > TEST_TIMEOUT_MS;
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
 * review/test sweep such strays from the chat so only the flow message remains
 * (to-do §UX). Excludes commands and text (those have their own handling) and
 * non-message updates (e.g. callbacks have no `ctx.message`), so a catch-all built
 * on it can't swallow a `/command` meant for another feature.
 */
export const nonTextIn =
  (mode: Mode) =>
  (ctx: MyContext): boolean =>
    ctx.session.mode === mode && ctx.message !== undefined && ctx.message.text === undefined;
