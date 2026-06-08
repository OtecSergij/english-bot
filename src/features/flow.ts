import type { Context, InlineKeyboard } from 'grammy';
import type { MyContext } from '../context';

// Shared primitives for the "whole session = one editable message" pattern used by
// add (§4), review (§5) and test (§6) — and reused by the Phase 5 scheduler.

/**
 * Edit the single message a flow lives in. Best-effort: a failed edit (message
 * gone, identical content, lost permissions) is swallowed so the flow never crashes
 * on a stale message. Typed on the base `Context` so it works both outside
 * middleware (review/test) and inside a conversation (add) — it only needs
 * `ctx.api` + `ctx.chat`.
 */
export function editFlow(
  ctx: Context,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<unknown> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return Promise.resolve(undefined);
  return ctx.api
    .editMessageText(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard })
    .catch(() => undefined);
}

/** Delete a flow message (best-effort) — chat cleanup on finish / cancel / timeout. */
export function deleteFlowMessage(ctx: Context, messageId: number): Promise<unknown> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return Promise.resolve(undefined);
  return ctx.api.deleteMessage(chatId, messageId).catch(() => undefined);
}

/**
 * Reset the session to IDLE, clearing ANY in-progress flow state (review + test).
 * One reset for the whole FSM, so a stray field can't survive a transition.
 */
export function resetSession(ctx: MyContext): void {
  ctx.session.mode = 'idle';
  ctx.session.review = undefined;
  ctx.session.test = undefined;
}
