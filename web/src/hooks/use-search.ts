import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/** Current URL query params as plain strings. */
export function useSearchValues(): Record<string, string | undefined> {
  const raw = useSearch({ strict: false }) as Record<string, unknown>;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = String(v);
  }
  return out;
}

/** Merge query params into the current URL; undefined removes a key. */
export function useSetSearch() {
  const navigate = useNavigate();
  return useCallback(
    (patch: Record<string, string | undefined>, replace = true) => {
      void navigate({
        to: ".",
        replace,
        search: (prev: Record<string, unknown>) => {
          const next: Record<string, unknown> = { ...prev };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === "") delete next[k];
            else next[k] = v;
          }
          return next;
        },
      } as never);
    },
    [navigate],
  );
}
