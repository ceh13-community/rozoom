const SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Quote one argument so a POSIX shell, or our terminal's tokenizer, reads it back unchanged. */
export function quoteCommandArgument(argument: string): string {
  if (SAFE_ARGUMENT.test(argument)) return argument;
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

/** Render an argument list as one line, for display and for copying into a terminal. */
export function formatCommandLine(argv: readonly string[]): string {
  return argv.map(quoteCommandArgument).join(" ");
}
