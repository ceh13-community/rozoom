/**
 * Client-side pagination helper for data tables.
 * Works alongside virtual scrolling - pagination limits total dataset,
 * virtual scroll handles rendering within the current page.
 */

export const DEFAULT_PAGE_SIZE = 100;

export type PaginationState = {
  page: number;
  pageSize: number;
};

export function paginate<T>(items: T[], state: PaginationState): T[] {
  const start = state.page * state.pageSize;
  return items.slice(start, start + state.pageSize);
}

export function totalPages(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function clampPage(page: number, total: number): number {
  return Math.max(0, Math.min(page, total - 1));
}
