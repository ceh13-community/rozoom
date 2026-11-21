import { revealResult } from "./reveal-result";

const WAIT_MS = 4000;
const STEP_MS = 100;

function visibleListFilter(): HTMLInputElement | null {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[placeholder^="Filter"]'),
  );
  return inputs.find((input) => input.offsetParent !== null) ?? null;
}

/**
 * After "Jump to <Kind> page" (Workload Map, Service Chains): wait for the list of the
 * new page, put the resource name into its filter and focus it, so the person lands on
 * that resource instead of the top of a long list. Gives up quietly when the page has
 * no filter (it loads its data first) within a few seconds.
 */
export async function revealListFilteredTo(name: string): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  let input = visibleListFilter();
  while (!input && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, STEP_MS));
    input = visibleListFilter();
  }
  if (!input) return false;
  input.value = name;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  revealResult(input);
  return true;
}
