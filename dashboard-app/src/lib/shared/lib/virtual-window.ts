export type VirtualWindow = {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
};

export function computeVirtualWindow(input: {
  totalCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
}): VirtualWindow {
  const totalCount = Math.max(0, Math.floor(input.totalCount));
  if (totalCount === 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }

  const rowHeight = Math.max(1, Math.floor(input.rowHeight));
  const viewportHeight = Math.max(1, Math.floor(input.viewportHeight));
  const overscan = Math.max(0, Math.floor(input.overscan ?? 8));
  const maxScrollTop = Math.max(0, totalCount * rowHeight - viewportHeight);
  const scrollTop = Math.min(Math.max(0, Math.floor(input.scrollTop)), maxScrollTop);

  const visibleStart = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const startIndex = Math.max(0, visibleStart - overscan);
  const endIndex = Math.min(totalCount, visibleStart + visibleCount + overscan);
  const paddingTop = startIndex * rowHeight;
  const paddingBottom = Math.max(0, (totalCount - endIndex) * rowHeight);

  return { startIndex, endIndex, paddingTop, paddingBottom };
}
