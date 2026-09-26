import { useSyncExternalStore } from "react";

import { getCompanyView, setCompanyView, subscribeCompanyView } from "@/lib/company-view";

export function useCompanyView() {
  const enabled = useSyncExternalStore(subscribeCompanyView, getCompanyView, () => false);
  return { enabled, setEnabled: setCompanyView };
}
