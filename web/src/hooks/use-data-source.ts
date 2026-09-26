import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getMockMode,
  getSource,
  onSourceFlip,
  startSourceMonitor,
  subscribeSource,
  type DataSource,
  type MockMode,
} from "@/lib/api";

/** Current data source (live | mock) plus the configured mock mode. */
export function useDataSource(): { source: DataSource; mode: MockMode } {
  const [snapshot, setSnapshot] = useState<{ source: DataSource; mode: MockMode }>({
    source: "mock",
    mode: "auto",
  });

  useEffect(() => {
    const sync = () => setSnapshot({ source: getSource(), mode: getMockMode() });
    sync();
    const unsubscribe = subscribeSource(sync);
    return () => {
      unsubscribe();
    };
  }, []);

  return snapshot;
}

/** Starts the health monitor and toasts once whenever the source flips. */
export function useSourceMonitor() {
  const queryClient = useQueryClient();

  useEffect(() => {
    startSourceMonitor();
    const unsubscribe = onSourceFlip((next) => {
      // Only auto mode switches the data itself; off mode just reflects health in the pill.
      if (getMockMode() === "auto") void queryClient.resetQueries();
      if (next === "mock") {
        toast.warning("Backend offline, showing mock data");
      } else {
        toast.success("Connected to live backend");
      }
    });
    return () => {
      unsubscribe();
    };
  }, [queryClient]);
}
