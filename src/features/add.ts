import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { config } from '../config';
import {
  freeTextIn,
  type BaseContext,
  type MyContext,
  type MyConversation,
  type MyConversationContext,
} from '../context';
import { addWord, findWordByRussian } from '../db/words';
import { ensureUser, getTimezone } from '../db/users';
import type { AppDeps } from '../deps';
import {
  buildCardFromFallback,
  buildCardFromSense,
  withExample,
  type WordCard,
  type WordSource,
} from '../lib/card';
import { addDays, todayInTz } from '../lib/dates';
import { escapeHtml } from '../lib/html';
import { detectLang, lookupDirection } from '../lib/lang';
import type { DictionarySense } from '../services/dictionary/types';
import { deleteFlowMessage, editFlow as editFlowMessage } from './flow';

const CONVO_ID = 'add-word';

/** Entry payload: the typed word plus its message id (so we can delete it on save). */
interface AddWordSeed {
  text: string;
  messageId: number;
}

function renderCard(
  card: WordCard,
  dup?: { russian: string; english: string } | null,
  saved = false,
): string {
  const lines: string[] = [];
  if (dup) {
    lines.push(`⚠️ Возможно, уже есть: ${escapeHtml(dup.russian)} → ${escapeHtml(dup.english)}`);
  }
  // A ✅ on the word marks the saved state (no separate "Сохранено #N" line).
  const mark = saved ? '✅ ' : '';
  lines.push(`${mark}<b>${escapeHtml(card.russian)}</b> → ${escapeHtml(card.english)}`);
  if (card.exampleRu && card.exampleEn) {
    lines.push('', escapeHtml(card.exampleRu), escapeHtml(card.exampleEn));
  }
  if (card.source === 'fallback') {
    lines.push('', '⚠️ Переведено с помощью LLM, проверь');
  }
  return lines.join('\n');
}

// «🔄 Другой пример» always (the example is LLM-made). «✏️ Перевод» only for
// fallback cards, where the translation itself is an LLM guess. A dictionary
// translation is authoritative, so it isn't edited at add-time; homographs are
// handled by the per-tr sense choice, and full per-word editing is a lifecycle
// feature (design-doc.md §10).
function confirmKeyboard(source: WordSource): InlineKeyboard {
  // One button per row — a full-width label never gets truncated («🔄 Дру…ример»).
  const kb = new InlineKeyboard().text('💾 Сохранить', `${CONVO_ID}:save`).row();
  kb.text('🔄 Другой пример', `${CONVO_ID}:example`).row();
  if (source === 'fallback') kb.text('✏️ Перевод', `${CONVO_ID}:translation`).row();
  kb.text('Отмена', `${CONVO_ID}:cancel`);
  return kb;
}

function lastSegment(data: string): string {
  return data.slice(data.lastIndexOf(':') + 1);
}

/**
 * Add-word conversation (design-doc.md §4). The whole flow lives in ONE message
 * that we keep editing (lookup → sense choice → confirm/edit → result), so the
 * chat stays clean and finished flows leave no live buttons. All side-effects go
 * through `conversation.external`; Bot API calls (reply/edit) are replay-safe.
 */
function makeAddWordConversation(deps: AppDeps) {
  return async function addWordConversation(
    conversation: MyConversation,
    ctx: MyConversationContext,
    seed?: AddWordSeed,
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const input = (seed?.text ?? '').trim();
    // The user's original word message — deleted once the word is saved (to-do §UX).
    const userMessageId = seed?.messageId;
    if (!input) {
      await ctx.reply('Пришли слово (рус/англ), чтобы добавить его в словарь.');
      return;
    }

    const lang = detectLang(input);
    const direction = lookupDirection(lang);

    // The single evolving message: send once, then edit it on every step.
    const flow = await ctx.reply(`Ищу «${escapeHtml(input)}»…`, { parse_mode: 'HTML' });
    // The single evolving message — delegates to the shared flow editor, bound to
    // this flow's message id so call sites stay terse.
    const editFlow = (text: string, keyboard?: InlineKeyboard): Promise<unknown> =>
      editFlowMessage(ctx, flow.message_id, text, keyboard);

    const cancelFlow = async (): Promise<void> => {
      await deleteFlowMessage(ctx, flow.message_id);
      if (userMessageId !== undefined) await deleteFlowMessage(ctx, userMessageId);
    };

    // A stray MESSAGE sent while we wait for a button is noise — delete it so the
    // chat stays at the single flow message (to-do §UX). Used as `otherwise` on the
    // waits below (the skipped update is dropped, not re-dispatched). Guarded to
    // messages only: a non-matching callback must not delete the message it sits on.
    const dropStray = (c: MyConversationContext): Promise<unknown> =>
      c.message === undefined
        ? Promise.resolve(undefined)
        : c.deleteMessage().catch(() => undefined);

    const userId = await conversation.external(() => ensureUser(deps.db, chatId, config.ownerTz));

    let senses: DictionarySense[];
    try {
      const result = await conversation.external(() =>
        deps.services.dictionary.lookup(input, direction),
      );
      senses = result.senses;
    } catch (err) {
      await conversation.error(err);
      await editFlow('Словарь сейчас недоступен. Попробуй ещё раз позже.');
      return;
    }

    let card: WordCard;

    if (senses.length === 0) {
      await editFlow('Слова нет в словаре, делаю автоперевод…');
      try {
        const fb = await conversation.external(() =>
          deps.services.llm.fallbackTranslate(input, direction),
        );
        card = buildCardFromFallback(input, lang, fb.translation, fb.example);
      } catch (err) {
        await conversation.error(err);
        await editFlow('Слова нет в словаре, а автоперевод недоступен. Попробуй позже.');
        return;
      }
    } else {
      let sense = senses[0]!;
      if (senses.length > 1) {
        // Options go in the message TEXT (wraps → full glosses fit); buttons are
        // just numbers (a button label can't be long — Telegram truncates it).
        // The Russian gloss helps only for RU input (for EN input it's English noise).
        const list = senses
          .map((s, i) => {
            const gloss = lang === 'ru' && s.gloss ? ` — ${escapeHtml(s.gloss)}` : '';
            return `${i + 1}. ${escapeHtml(s.translation)}${gloss}`;
          })
          .join('\n');
        const kb = new InlineKeyboard();
        senses.forEach((_, i) => kb.text(String(i + 1), `${CONVO_ID}:sense:${i}`));
        kb.row().text('Отмена', `${CONVO_ID}:cancel`);
        await editFlow(`«${escapeHtml(input)}»:\n\n${list}`, kb);

        const pick = await conversation.waitForCallbackQuery(
          new RegExp(`^${CONVO_ID}:(sense:\\d+|cancel)$`),
          { otherwise: dropStray },
        );
        await pick.answerCallbackQuery();
        if (lastSegment(pick.callbackQuery.data) === 'cancel') {
          await cancelFlow();
          return;
        }
        sense = senses[Number(lastSegment(pick.callbackQuery.data))] ?? senses[0]!;
      }

      await editFlow('Собираю карточку…');
      // Build the card first, then fill the example from it — one place computes
      // the (russian, english) pair, shared with the regenerate path below.
      card = buildCardFromSense(input, lang, sense, { ru: '', en: '' });
      try {
        const example = await conversation.external(() =>
          deps.services.llm.generateExample(card.russian, card.english),
        );
        card = withExample(card, example);
      } catch (err) {
        // A missing example is not fatal — save the card without it.
        await conversation.error(err);
      }
    }

    if (!card.russian || !card.english) {
      await editFlow('Не удалось собрать карточку для этого слова.');
      return;
    }

    let dup = await conversation.external(() => findWordByRussian(deps.db, userId, card.russian));
    await editFlow(renderCard(card, dup), confirmKeyboard(card.source));

    for (;;) {
      const decision = await conversation.waitForCallbackQuery(
        new RegExp(`^${CONVO_ID}:(save|example|translation|cancel)$`),
        { otherwise: dropStray },
      );
      await decision.answerCallbackQuery();
      const action = lastSegment(decision.callbackQuery.data);

      if (action === 'cancel') {
        await cancelFlow();
        return;
      }
      if (action === 'save') break;

      if (action === 'example') {
        // Regenerate the example (the LLM part) — tap until it's good.
        await editFlow('Генерирую другой пример…');
        try {
          const example = await conversation.external(() =>
            deps.services.llm.generateExample(card.russian, card.english),
          );
          card = withExample(card, example);
        } catch (err) {
          await conversation.error(err);
        }
      } else {
        // 'translation' — only offered for fallback cards (LLM-guessed translation).
        const isRu = lang === 'ru';
        await editFlow(
          isRu
            ? 'Пришли исправленный перевод (англ.):'
            : 'Пришли исправленное русское слово-подсказку:',
        );
        const reply = await conversation.waitFor('message:text', { otherwise: dropStray });
        const text = reply.message.text.trim();
        if (text && !text.startsWith('/')) {
          if (isRu) {
            card = { ...card, english: text };
          } else {
            // The Russian prompt changed → refresh the soft duplicate check.
            card = { ...card, russian: text };
            dup = await conversation.external(() =>
              findWordByRussian(deps.db, userId, card.russian),
            );
          }
        }
        // The correction is consumed — delete it so only the flow message remains.
        await reply.deleteMessage().catch(() => undefined);
      }
      await editFlow(renderCard(card, dup), confirmKeyboard(card.source));
    }

    // Timezone comes from settings (the SRS source of truth, known_issues.md §6),
    // so add and review compute "today" the same way once TZ is editable (Phase 6).
    // Read by the userId we already hold (no second user lookup).
    const tz = (await conversation.external(() => getTimezone(deps.db, userId))) ?? config.ownerTz;
    const today = todayInTz(new Date(await conversation.now()), tz);
    const nextReview = addDays(today, 1);
    try {
      await conversation.external(() => addWord(deps.db, userId, card, nextReview));
      await editFlow(renderCard(card, null, true));
      // Saved → drop the user's original word message so only the ✅ card remains.
      if (userMessageId !== undefined) await deleteFlowMessage(ctx, userMessageId);
    } catch (err) {
      await conversation.error(err);
      await editFlow('Не удалось сохранить слово. Попробуй позже.');
    }
  };
}

export function createAddFeature(deps: AppDeps): Composer<MyContext> {
  const feature = new Composer<MyContext>();

  feature.use(
    createConversation<BaseContext, MyConversationContext>(makeAddWordConversation(deps), CONVO_ID),
  );

  feature.filter(freeTextIn('idle')).on('message:text', async (ctx) => {
    const seed: AddWordSeed = { text: ctx.message.text, messageId: ctx.message.message_id };
    await ctx.conversation.enter(CONVO_ID, seed);
  });

  return feature;
}
