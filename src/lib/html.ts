/**
 * Escape text for Telegram's HTML parse mode. Per the Bot API, only these three
 * characters must be escaped in HTML mode; everything else is literal. Used for
 * user-supplied content (words, translations, examples) before it goes in a message.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
