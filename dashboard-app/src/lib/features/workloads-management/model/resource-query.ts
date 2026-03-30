type QueryOperator = ":" | "=" | "!=" | ">" | "<" | ">=" | "<=";

export type ResourceQueryTerm = {
  field: string;
  operator: QueryOperator;
  value: string;
};

export type ParsedResourceQuery = {
  terms: ResourceQueryTerm[];
  freeText: string[];
};

const TERM_REGEX = /^([a-zA-Z][\w.-]*)(:|=|!=|>=|<=|>|<)(.+)$/;

function toComparableText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).toLowerCase();
  }
  return "";
}

export function parseResourceQuery(input: string): ParsedResourceQuery {
  const terms: ResourceQueryTerm[] = [];
  const freeText: string[] = [];
  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    const match = token.match(TERM_REGEX);
    if (!match) {
      freeText.push(token.toLowerCase());
      continue;
    }
    terms.push({
      field: match[1].toLowerCase(),
      operator: match[2] as QueryOperator,
      value: match[3].trim().toLowerCase(),
    });
  }
  return { terms, freeText };
}

export function applyResourceQuery<T extends Record<string, unknown>>(
  rows: T[],
  query: ParsedResourceQuery,
  getFulltext: (row: T) => string,
): T[] {
  const freeText = query.freeText;
  return rows.filter((row) => {
    const haystack = getFulltext(row).toLowerCase();
    for (const token of freeText) {
      if (!haystack.includes(token)) return false;
    }
    for (const term of query.terms) {
      const raw = row[term.field];
      const text = toComparableText(raw);
      switch (term.operator) {
        case ":":
          if (!text.includes(term.value)) return false;
          break;
        case "=":
          if (text !== term.value) return false;
          break;
        case "!=":
          if (text === term.value) return false;
          break;
        case ">":
        case "<":
        case ">=":
        case "<=": {
          const left = Number(raw);
          const right = Number(term.value);
          if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
          if (term.operator === ">" && !(left > right)) return false;
          if (term.operator === "<" && !(left < right)) return false;
          if (term.operator === ">=" && !(left >= right)) return false;
          if (term.operator === "<=" && !(left <= right)) return false;
          break;
        }
      }
    }
    return true;
  });
}
