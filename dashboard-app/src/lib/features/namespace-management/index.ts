export {
  EMPTY_NAMESPACE_SELECTION,
  setSelectedNamespace,
  setSelectedNamespaces,
  selectedNamespace,
  getSelectedNamespaceList,
  namespaceMatches,
  namespaces,
  namespacesError,
  isNamespacesLoading,
  getClusterNamespaces,
  stopNamespaceActivity,
  applyDefaultNamespace,
} from "./model/cache-store";
export type { Namespace } from "./model/types";
