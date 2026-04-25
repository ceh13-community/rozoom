/**
 * POSIX-style tokenizer for the shell-window input.
 *
 * Handles the subset of shell parsing we actually need so pasted
 * multi-line commands round-trip correctly:
 *
 *   - single-quoted strings: literal, no escapes
 *   - double-quoted strings: allow backslash escapes (\", \\, \n, \t)
 *   - unquoted tokens: whitespace-separated, backslash escapes any char
 *   - line continuation: a backslash immediately before newline joins
 *     the two lines into one token-stream
 *   - comments: a `#` at the start of a token (not inside quotes) ends
 *     the rest of that line - lets users paste commented blocks
 *
 * Deliberately NOT handled (pass through as literal text, never
 * expanded): environment variables ($FOO), command substitution
 * ($(cmd) / backticks), glob patterns, brace expansion, redirects,
 * pipes. Users who need those should copy to an external terminal.
 */

export type TokenizeResult = { ok: true; tokens: string[] } | { ok: false; error: string };

const WHITESPACE = /[\s]/;

/**
 * Split a command string into an argv-style list of tokens.
 * Returns `{ok: false}` with a friendly error when quoting is
 * unbalanced, so the caller can refuse to execute.
 */
export function tokenizeCommand(rawInput: string): TokenizeResult {
  // Normalise line endings so CRLF (Windows / clipboards that carry
  // Windows line endings) behaves identically to LF. Without this,
  // `\\\r\n` gets parsed as backslash+CR escape and the following LF
  // becomes a token boundary - each continued line keeps a trailing \r
  // that helm / kubectl treat as part of the previous arg.
  const input = rawInput.replace(/\r\n?/g, "\n");
  const tokens: string[] = [];
  let buf = "";
  let inBuf = false;
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (ch === "\\") {
      // Forgiving line-continuation: bash strictly requires `\` then
      // `\n`, but clipboards/browsers/rich-text renders often leave
      // trailing horizontal whitespace (spaces/tabs) between the
      // backslash and the newline. Treat that as a continuation too -
      // it's almost never what the user meant to escape.
      let j = i + 1;
      while (j < len && (input[j] === " " || input[j] === "\t")) j++;
      if (j < len && input[j] === "\n") {
        i = j + 1;
        continue;
      }
      const next = input[i + 1];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (next === undefined) {
        return { ok: false, error: "Unterminated backslash escape at end of command" };
      }
      // Preserve literal of the next char (including space, ", ', $).
      buf += next;
      inBuf = true;
      i += 2;
      continue;
    }

    if (ch === "'") {
      inBuf = true;
      i += 1;
      while (i < len && input[i] !== "'") {
        buf += input[i];
        i += 1;
      }
      if (i >= len) {
        return { ok: false, error: "Unterminated single-quoted string" };
      }
      i += 1; // consume closing '
      continue;
    }

    if (ch === '"') {
      inBuf = true;
      i += 1;
      while (i < len && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < len) {
          const esc = input[i + 1];
          if (esc === '"' || esc === "\\" || esc === "$" || esc === "`" || esc === "\n") {
            if (esc === "\n") {
              // backslash-newline inside double quotes: still joins lines
              i += 2;
              continue;
            }
            buf += esc;
            i += 2;
            continue;
          }
        }
        buf += input[i];
        i += 1;
      }
      if (i >= len) {
        return { ok: false, error: "Unterminated double-quoted string" };
      }
      i += 1; // consume closing "
      continue;
    }

    if (ch === "#" && !inBuf) {
      // Comment: skip to end of line.
      while (i < len && input[i] !== "\n") i += 1;
      continue;
    }

    if (WHITESPACE.test(ch)) {
      if (inBuf) {
        tokens.push(buf);
        buf = "";
        inBuf = false;
      }
      i += 1;
      continue;
    }

    buf += ch;
    inBuf = true;
    i += 1;
  }

  if (inBuf) tokens.push(buf);
  return { ok: true, tokens };
}
