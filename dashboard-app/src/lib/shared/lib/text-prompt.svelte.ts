// In-app replacement for window.prompt. WebKitGTK showed prompt() as a system window
// titled "JavaScript - tauri://localhost/...", outside the app's look and focus.
// One host (TextPromptHost in the root layout) renders the open request.

export type TextPromptRequest = {
  title: string;
  /** Line under the title explaining what to enter. */
  description?: string;
  initialValue?: string;
  placeholder?: string;
  /** A textarea instead of one line (pasted JSON and the like). */
  multiline?: boolean;
  confirmLabel?: string;
  /** Accept an empty answer (for example "leave blank to clear"). */
  allowEmpty?: boolean;
};

type PendingTextPrompt = TextPromptRequest & { resolve: (value: string | null) => void };

let pending = $state<PendingTextPrompt | null>(null);

export const textPrompt = {
  get current(): TextPromptRequest | null {
    return pending;
  },
};

/** Opens the in-app text dialog. Resolves with the text, or null on Cancel. */
export function requestText(request: TextPromptRequest): Promise<string | null> {
  // A second request replaces an open one; the first resolves as cancelled.
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { ...request, resolve };
  });
}

export function settleTextPrompt(value: string | null) {
  const current = pending;
  pending = null;
  current?.resolve(value);
}
