import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/** Opens / closes the task drawer via the ?task= query param on the current page. */
export function useOpenTask() {
  const navigate = useNavigate();
  return useCallback(
    (id: string | null) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => {
          const next = { ...prev };
          if (id) next["task"] = id;
          else delete next["task"];
          return next;
        },
      } as never);
    },
    [navigate],
  );
}
