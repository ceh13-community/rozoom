export type PageData = {
  name?: string;
  title: string;
  slug: string;
  workload: string | null;
  sort_field: string | null;
  namespace?: string | null;
  filtersKey?: string | null;
};
