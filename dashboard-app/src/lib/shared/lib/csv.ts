// Every CSV the app exports builds its cells here, so the rules hold for all of them:
// - a status shown with a decorative emoji in the lists ("🏃Running", "⚠️Critical") is saved
//   as the plain value; emoji inside the text stay;
// - a cell a spreadsheet would run as a formula (starting with = + - @, a tab or a carriage
//   return) gets a leading ' so it opens as text. Cluster data such as labels and annotations
//   can carry such text. A plain number ("-5") and the "-" placeholder stay as they are;
// - quotes are doubled and every cell is quoted; null and undefined are empty.

const LEADING_PICTOGRAPHS = /^(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D})+/u;
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
  let text = cellText(value).replace(LEADING_PICTOGRAPHS, "");
  if (FORMULA_START.test(text) && text !== "-" && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

export function csvText(rows: readonly (readonly unknown[])[]): string {
  return rows.map(csvRow).join("\n");
}
