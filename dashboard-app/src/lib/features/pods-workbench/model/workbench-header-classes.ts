type WorkbenchHeaderClasses = {
  root: string;
  scrollViewport: string;
  tabsRow: string;
  tabItem: string;
  controls: string;
};

const WORKBENCH_HEADER_CLASSES: WorkbenchHeaderClasses = {
  root: "flex items-center overflow-hidden border-b bg-muted/40 px-2 py-1.5",
  scrollViewport: "min-w-0 basis-0 flex-1 overflow-x-auto overflow-y-hidden",
  tabsRow: "inline-flex w-max gap-2 py-1",
  tabItem: "flex shrink-0 items-center gap-1",
  controls: "ml-2 flex shrink-0 items-center gap-2",
};

export function getWorkbenchHeaderClasses(): WorkbenchHeaderClasses {
  return WORKBENCH_HEADER_CLASSES;
}
