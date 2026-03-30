export function getSearchParams(urlString: string) {
  if (!urlString) return {};

  const searchParams = new URLSearchParams(urlString);

  return Object.fromEntries(searchParams.entries());
}
