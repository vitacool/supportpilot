const STOP_TERMS = new Set([
  '如何',
  '怎么',
  '怎样',
  '什么',
  '为什么',
  '是否',
  '可以',
  '能否',
  '请问',
  '一下',
  '我们',
  '你们',
  '他们',
  '这个',
  '那个',
  '哪些',
  '多少',
  '以及',
  '关于',
  '需要',
  '进行',
  '一个',
  '没有',
  '就是',
  '还是',
  '如果',
  '因为',
  '所以',
  'the',
  'and',
  'for',
  'with',
  'what',
  'how',
  'why',
  'this',
  'that',
]);

export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cjkBigrams(text: string): string[] {
  const cjk = text.replace(/[^\u3400-\u9fff]/g, '');
  const result: string[] = [];
  for (let i = 0; i < cjk.length - 1; i += 1) {
    result.push(cjk.slice(i, i + 2));
  }
  if (cjk.length === 1) result.push(cjk);
  return result;
}

/**
 * Produces a compact, deterministic term list for lexical scoring and SQL
 * candidate generation. It intentionally avoids a heavyweight tokenizer.
 */
export function extractTerms(query: string, maxTerms = 24): string[] {
  const normalized = normalizeText(query);
  const latin = normalized.match(/[a-z0-9][a-z0-9_.-]{1,}/g) || [];
  const cjk = cjkBigrams(normalized);
  const whole = normalized
    .replace(/[^\u3400-\u9fffa-z0-9]/g, '')
    .slice(0, 12);
  const candidates = [
    ...latin,
    ...cjk,
    ...(whole.length >= 3 && whole.length <= 12 ? [whole] : []),
  ];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of candidates) {
    const clean = term.trim();
    if (clean.length < 2 || STOP_TERMS.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
    if (result.length >= maxTerms) break;
  }
  return result;
}

export function lexicalScore(
  content: string,
  terms: string[],
  exactQuery?: string,
): number {
  if (!content || terms.length === 0) return 0;
  const haystack = normalizeText(content);
  let totalWeight = 0;
  let hitWeight = 0;

  for (const term of terms) {
    const weight = Math.min(2.2, 0.8 + term.length * 0.25);
    totalWeight += weight;
    let first = haystack.indexOf(term);
    if (first === -1) continue;
    let occurrences = 0;
    while (first !== -1 && occurrences < 4) {
      occurrences += 1;
      first = haystack.indexOf(term, first + term.length);
    }
    hitWeight += weight * Math.min(1.25, 1 + (occurrences - 1) * 0.08);
  }

  let score = totalWeight ? hitWeight / totalWeight : 0;
  const phrase = normalizeText(exactQuery || '')
    .replace(/[^\u3400-\u9fffa-z0-9]/g, '')
    .trim();
  if (phrase.length >= 3 && haystack.replace(/[^\u3400-\u9fffa-z0-9]/g, '').includes(phrase)) {
    score = Math.min(1, score + 0.14);
  }
  return Math.max(0, Math.min(1, score));
}

export function likePatterns(terms: string[]): string[] {
  return terms
    .map((term) => term.replace(/[%_\\]/g, ''))
    .filter(Boolean)
    .map((term) => `%${term}%`);
}
