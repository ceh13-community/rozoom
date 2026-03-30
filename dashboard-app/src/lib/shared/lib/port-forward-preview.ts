import { openInAppUrl } from "$shared/api/in-app-browser";

export function withRefreshNonce(url: string): string {
  return `${url.split("?")[0]}?r=${Date.now()}`;
}

export async function popOutPortForwardPreview(url: string): Promise<void> {
  if (!url) return;
  await openInAppUrl(url);
}
