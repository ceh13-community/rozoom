// Every CSV the app exports builds its cells here, so the rules hold for all of them:
// - a status the lists show with a decorative emoji glued to the word ("🏃Running",
//   "⚠️Critical") is saved as the plain word; only those status emoji are dropped, so other
//   symbols at the start of a cell ("©2024 Corp", "™", "↔") and emoji inside the text stay;
// - a cell a spreadsheet would run as a formula (starting with = + - @, a tab or a carriage
//   return) gets a leading ' so it opens as text. Cluster data such as labels and annotations
//   can carry such text. A plain number ("-5") and the "-" placeholder stay as they are;
// - quotes are doubled and every cell is quoted; null and undefined are empty.

// The emoji the status formatters glue to a status word (entities/*/ui/formatters.ts,
// check-health). A new one there needs adding here; the csv test lists them.
const STATUS_EMOJI = /^(?:🏃|🕰️?|😔|⚠️?|🔃|💪|❌|📉|🐌|🍏)(?=\p{Lu})/u;
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

function cellText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  // Symbols and functions have no JSON form.
  if (typeof value === "symbol" || typeof value === "function") return "";
  return JSON.stringify(value);
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = cellText(value).replace(STATUS_EMOJI, "");
  if (FORMULA_START.test(text) && text !== "-" && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

export function csvText(rows: readonly (readonly unknown[])[]): string {
  return rows.map(csvRow).join("\n");
}
