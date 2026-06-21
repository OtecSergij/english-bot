// Deterministic answer grading (design-doc.md §6).
// Forgive a leading article / "to"; reject synonyms and typos.

const LEADING_ARTICLE = /^(?:a|an|the)\s+/i;
const LEADING_TO = /^to\s+/i;

export function normalizeAnswer(input: string): string {
  let s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  s = s.replace(LEADING_ARTICLE, '');
  s = s.replace(LEADING_TO, '');
  return s.trim();
}

/** Correct = normalized input matches the (single) card answer (design-doc.md §6). */
export function isCorrect(input: string, answer: string): boolean {
  return normalizeAnswer(input) === normalizeAnswer(answer);
}
