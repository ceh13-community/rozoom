const SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Quote one argument so a POSIX shell, or our terminal's tokenizer, reads it back unchanged. */
export function quoteCommandArgument(argument: string): string {
  if (SAFE_ARGUMENT.test(argument)) return argument;
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

export function isWindowsPlatform(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-deprecated
  return typeof navigator !== "undefined" && /Win/i.test(navigator.platform ?? "");
}

export const COPY_BLOCKED_MESSAGE =
  "This name cannot be copied safely for cmd or PowerShell. Use Run debug describe instead.";

/**
 * The quoting above is POSIX only and means something else to cmd and PowerShell, so
 * on Windows a command is offered for copying only when no argument needs quoting.
 */
export function canCopyCommandLine(
  argv: readonly string[],
  windows: boolean = isWindowsPlatform(),
): boolean {
  return !windows || argv.every((argument) => SAFE_ARGUMENT.test(argument));
}

/** Render an argument list as one line, for display and for copying into a terminal. */
export function formatCommandLine(argv: readonly string[]): string {
  return argv.map(quoteCommandArgument).join(" ");
}
