import type { PageLoad } from "./$types";

function sanitizePreviewUrl(input: string | null): string {
  if (!input) return "about:blank";
  try {
    const parsed = new URL(input);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return "about:blank";
  } catch {
    return "about:blank";
  }
}

export const load: PageLoad = ({ url }) => {
  return {
    targetUrl: sanitizePreviewUrl(url.searchParams.get("url")),
    redirectMode: url.searchParams.get("redirect") === "1",
  };
};
