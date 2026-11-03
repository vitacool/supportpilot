export function estimateTokens(text: string): number {
  if (!text) return 0;
  const latinWords = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  const cjkChars = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const other = Math.max(0, text.length - cjkChars);
  return Math.max(1, Math.ceil(cjkChars / 1.5 + latinWords * 1.3 + other / 6));
}
