function isRawRequestArg(arg: string): boolean {
  return arg === "--raw" || arg.startsWith("--raw=");
}

function isOutputFormatArg(arg: string): boolean {
  if (arg.startsWith("--")) return arg === "--output" || arg.startsWith("--output=");
  return arg.startsWith("-o");
}

/**
 * Append `-o json` only when kubectl can honour it. `kubectl get --raw` returns
 * the server body verbatim and refuses `-o` ("--raw and --output are mutually
 * exclusive"), and a command that already picks an output format must not get
 * a second one.
 */
export function withJsonOutput(cmd: string): string {
  const args = cmd.trim().split(/\s+/);
  if (args.some(isRawRequestArg) || args.some(isOutputFormatArg)) return cmd;
  return `${cmd} -o json`;
}
