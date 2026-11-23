// One collator for the whole app. `String.prototype.localeCompare(other, undefined, options)`
// builds a new Intl.Collator on every call; in WebKit that costs about 40 us, so sorting a
// 2,000-row list spent ~90 ms per sort and the pods list, re-sorted on every watch event,
// froze for the whole catch-up. A shared collator sorts the same list in ~3 ms.
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural, case-insensitive text order: "pod-2" before "pod-10". */
export function compareNatural(left: string, right: string): number {
  return naturalCollator.compare(left, right);
}
