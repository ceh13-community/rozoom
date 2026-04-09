/**
 * Simple fuzzy search: scores candidates by how well they match a query.
 * Prefers: exact prefix > word-boundary match > subsequence match.
 */

export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact prefix match
  if (t.startsWith(q)) return 100;

  // Contains as substring
  if (t.includes(q)) return 80;

  // Word-boundary match: each query char matches start of a word
  const words = t.split(/[\s\-_/]+/);
  let wordMatchCount = 0;
  for (let i = 0; i < q.length && i < words.length; i++) {
    if (words[i].startsWith(q[i])) wordMatchCount++;
  }
  if (wordMatchCount === q.length && q.length > 0) return 60;

  // Subsequence match
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return 40;

  return 0;
}

export type Searchable = {
  label: string;
  keywords?: string[];
};

export function fuzzyFilter<T extends Searchable>(items: T[], query: string): T[] {
  if (!query.trim()) return items;

  const scored = items
    .map((item) => {
      const labelScore = fuzzyScore(query, item.label);
      const keywordScore = item.keywords
        ? Math.max(...item.keywords.map((kw) => fuzzyScore(query, kw)), 0)
        : 0;
      return { item, score: Math.max(labelScore, keywordScore) };
    })
    .filter(({ score }) => score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ item }) => item);
}
