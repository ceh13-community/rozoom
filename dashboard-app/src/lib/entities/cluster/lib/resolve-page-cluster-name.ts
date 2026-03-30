import type { PageData } from "../model/pages";

export function resolvePageClusterName(data: Pick<PageData, "name" | "slug" | "title">): string {
  const explicitName = data.name?.trim();
  if (explicitName) return explicitName;

  const titleMatch = data.title.match(/ - Cluster: (.+)$/);
  const titleName = titleMatch?.[1]?.trim();
  if (titleName) return titleName;

  return data.slug;
}
