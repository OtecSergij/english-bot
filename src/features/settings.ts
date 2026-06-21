import { Composer, InlineKeyboard, type Context } from 'grammy';
import { config } from '../config';
import type { MyContext } from '../context';
import { ensureUser, getUserContext, updateSettings, type UserContext } from '../db/users';
import { countWords } from '../db/words';
import type { AppDeps } from '../deps';
import { hhmm } from '../lib/dates';
import { escapeHtml } from '../lib/html';
import { clampInt, effectiveNewPerDay, sessionSizeMax, COUNT_MIN, NEW_PER_DAY_MAX } from '../lib/settings';
import { reviewSessionSize } from '../lib/srs';
import { editFlow, deleteFlowMessage } from './flow';

/**
 * Settings menu (design-doc.md §9). Like the rest of the bot it's ONE editable
 * message, but unlike the review flow it holds NO session state: every screen (main /
 * session-size editor / new-per-day editor / time picker) is a pure function of the
 * `settings` row + deck size, the sub-screen is encoded in the callback data, and the
 * message id comes from the callback. So it needs no FSM mode, and it even survives a
 * restart (nothing to lose in memory). All callbacks live under the `set:` namespace.
 *
 * `session_size` is capped by the deck size (design-doc.md §9): the EFFECTIVE value
 * shown/edited is `reviewSessionSize(stored, deck)` — the very number a session runs —
 * so the screen can't drift from the scheduler/`startSession`. `new_per_day` has no
 * deck cap, just [0, NEW_PER_DAY_MAX] (0 = pause new words). Time is hour-only.
 */

// ── Pure renderers (unit-tested) ────────────────────────────────────────────

/** The overview screen. `session_size` is shown as its effective (deck-capped) value. */
export function renderMain(
  s: { sessionSize: number; reviewTime: string; newPerDay: number; timezone: string },
  deckSize: number,
): string {
  return [
    '⚙️ <b>Настройки</b>',
    '',
    `📚 Слов в день: <b>${reviewSessionSize(s.sessionSize, deckSize)}</b> (в колоде: ${deckSize})`,
    `🆕 Новых в день: <b>${effectiveNewPerDay(s.newPerDay)}</b>`,
    `⏰ Время повторения: <b>${hhmm(s.reviewTime)}</b>`,
    '',
    `🌍 Таймзона: ${escapeHtml(s.timezone)}`,
  ].join('\n');
}

/** The session-size editor: current effective value + the deck cap. */
export function renderSessionSizeEditor(value: number, deckSize: number): string {
  return [
    '📚 <b>Слов на ежедневное повторение</b>',
    '',
    `Сейчас: <b>${value}</b>`,
    `Колода: ${deckSize} · максимум ${sessionSizeMax(deckSize)}`,
  ].join('\n');
}

/** The new-per-day editor: current effective value + the fixed range. */
export function renderNewPerDayEditor(value: number): string {
  return [
    '🆕 <b>Новых слов в день</b>',
    '',
    `Сейчас: <b>${value}</b>`,
    `Диапазон: ${COUNT_MIN}–${NEW_PER_DAY_MAX}`,
  ].join('\n');
}

/** The hour picker header. */
export function renderTimePicker(reviewTime: string, timezone: string): string {
  return [
    '⏰ <b>Время ежедневного повторения</b>',
    '',
    `Сейчас: <b>${hhmm(reviewTime)}</b> (${escapeHtml(timezone)})`,
    'Выбери час (минуты — :00).',
  ].join('\n');
}

// ── Keyboards ───────────────────────────────────────────────────────────────

function mainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📚 Слов в день', 'set:nav:ss')
    .text('🆕 Новых', 'set:nav:np')
    .row()
    .text('⏰ Время', 'set:nav:time')
    .row()
    .text('Закрыть', 'set:close');
}

/** A ±1/±5 stepper for a count editor (`kind` = which setting: session-size / new-per-day). */
function stepperKeyboard(kind: 'ss' | 'np'): InlineKeyboard {
  return new InlineKeyboard()
    .text('−5', `set:${kind}:-5`)
    .text('−1', `set:${kind}:-1`)
    .text('+1', `set:${kind}:1`)
    .text('+5', `set:${kind}:5`)
    .row()
    .text('← Назад', 'set:nav:main');
}

/** A 6×4 grid of hours 00..23; the current hour is marked with a leading dot. */
function timeKeyboard(currentHour: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    kb.text(h === currentHour ? `·${hh}` : hh, `set:time:${h}`);
    if (h % 6 === 5) kb.row(); // 6 per row; the row() after h=23 lands «Назад» on its own row
  }
  return kb.text('← Назад', 'set:nav:main');
}

// ── Handlers (stateless: each reads the row fresh and re-renders) ─────────────

/** Edit the panel message the callback came from (best-effort via editFlow). */
async function editPanel(ctx: Context, text: string, keyboard: InlineKeyboard): Promise<void> {
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (messageId === undefined) return;
  await editFlow(ctx, messageId, text, keyboard);
}

/**
 * Resolve the settings row for a callback, or toast + bail if it's gone (e.g. a DB
 * reset under a stale panel). On the null path it has already answered the callback.
 */
async function loadOrToast(deps: AppDeps, ctx: MyContext): Promise<UserContext | null> {
  const chatId = ctx.chat?.id;
  const s = chatId === undefined ? null : await getUserContext(deps.db, chatId);
  if (!s)
    await ctx.answerCallbackQuery({ text: 'Настройки недоступны — открой /settings заново.' });
  return s;
}

async function showMain(deps: AppDeps, ctx: MyContext): Promise<void> {
  const s = await loadOrToast(deps, ctx);
  if (!s) return;
  const deck = await countWords(deps.db, s.userId);
  await ctx.answerCallbackQuery();
  await editPanel(ctx, renderMain(s, deck), mainKeyboard());
}

async function showSessionSize(deps: AppDeps, ctx: MyContext): Promise<void> {
  const s = await loadOrToast(deps, ctx);
  if (!s) return;
  const deck = await countWords(deps.db, s.userId);
  await ctx.answerCallbackQuery();
  await editPanel(
    ctx,
    renderSessionSizeEditor(reviewSessionSize(s.sessionSize, deck), deck),
    stepperKeyboard('ss'),
  );
}

async function showNewPerDay(deps: AppDeps, ctx: MyContext): Promise<void> {
  const s = await loadOrToast(deps, ctx);
  if (!s) return;
  await ctx.answerCallbackQuery();
  await editPanel(ctx, renderNewPerDayEditor(effectiveNewPerDay(s.newPerDay)), stepperKeyboard('np'));
}

async function showTime(deps: AppDeps, ctx: MyContext): Promise<void> {
  const s = await loadOrToast(deps, ctx);
  if (!s) return;
  await ctx.answerCallbackQuery();
  // The hour is the first two chars of 'HH:MM:SS' (distinct from the HH:MM truncation).
  await editPanel(
    ctx,
    renderTimePicker(s.reviewTime, s.timezone),
    timeKeyboard(Number(s.reviewTime.slice(0, 2))),
  );
}

async function stepSessionSize(deps: AppDeps, ctx: MyContext, delta: number): Promise<void> {
  const s = await loadOrToast(deps, ctx);
  if (!s) return;
  const deck = await countWords(deps.db, s.userId);
  const max = sessionSizeMax(deck);
  // Step from the EFFECTIVE value (deck-capped), so a no-op tap at the cap never
  // silently lowers the stored ceiling — the default survives the deck growing.
  const eff = reviewSessionSize(s.sessionSize, deck);
  const next = clampInt(eff + delta, COUNT_MIN, max);
  if (next !== eff) await updateSettings(deps.db, s.userId, { sessionSize: next });
  await ctx.answerCallbackQuery();
  await editPanel(ctx, renderSessionSizeEditor(next, deck), stepperKeyboard('ss'));
}

async function stepNewPerDay(deps: AppDeps, ctx: MyContext, delta: number): Promise<void> {
  const s = await loadOrToast(deps, ctx);
  if (!s) return;
  const eff = effectiveNewPerDay(s.newPerDay);
  const next = clampInt(eff + delta, COUNT_MIN, NEW_PER_DAY_MAX); // min 1 — new can't be paused
  if (next !== eff) await updateSettings(deps.db, s.userId, { newPerDay: next });
  await ctx.answerCallbackQuery();
  await editPanel(ctx, renderNewPerDayEditor(next), stepperKeyboard('np'));
}

async function setTime(deps: AppDeps, ctx: MyContext, hour: number): Promise<void> {
  const s = await loadOrToast(deps, ctx);
  if (!s) return;
  const hh = String(clampInt(hour, 0, 23)).padStart(2, '0');
  if (`${hh}:00:00` !== s.reviewTime)
    await updateSettings(deps.db, s.userId, { reviewTime: `${hh}:00` });
  const deck = await countWords(deps.db, s.userId);
  await ctx.answerCallbackQuery();
  // A time pick is a single decisive choice → back to the overview (patch locally to
  // avoid a re-read; renderMain only looks at the 'HH:MM' prefix).
  await editPanel(ctx, renderMain({ ...s, reviewTime: `${hh}:00:00` }, deck), mainKeyboard());
}

export function createSettingsFeature(deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  // Manual entry. Drop the command itself (§UX), then open the panel as a fresh
  // message; every later tap edits that same message in place.
  feature.command('settings', async (ctx) => {
    await ctx.deleteMessage().catch(() => undefined);
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    await ensureUser(deps.db, chatId, config.ownerTz);
    const s = await getUserContext(deps.db, chatId);
    if (!s) {
      await ctx.reply('Не удалось открыть настройки. Попробуй позже.');
      return;
    }
    const deck = await countWords(deps.db, s.userId);
    await ctx.reply(renderMain(s, deck), { parse_mode: 'HTML', reply_markup: mainKeyboard() });
  });

  feature.callbackQuery('set:nav:main', (ctx) => showMain(deps, ctx));
  feature.callbackQuery('set:nav:ss', (ctx) => showSessionSize(deps, ctx));
  feature.callbackQuery('set:nav:np', (ctx) => showNewPerDay(deps, ctx));
  feature.callbackQuery('set:nav:time', (ctx) => showTime(deps, ctx));
  feature.callbackQuery(/^set:ss:(-?\d+)$/, (ctx) => stepSessionSize(deps, ctx, Number(ctx.match[1])));
  feature.callbackQuery(/^set:np:(-?\d+)$/, (ctx) => stepNewPerDay(deps, ctx, Number(ctx.match[1])));
  feature.callbackQuery(/^set:time:(\d+)$/, (ctx) => setTime(deps, ctx, Number(ctx.match[1])));
  feature.callbackQuery('set:close', async (ctx) => {
    await ctx.answerCallbackQuery();
    const messageId = ctx.callbackQuery.message?.message_id;
    if (messageId !== undefined) await deleteFlowMessage(ctx, messageId);
  });

  return feature;
}
