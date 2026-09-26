import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { api, clearToken } from "@/lib/api";

export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    await queryClient.cancelQueries();
    queryClient.clear();
    clearToken();
    await navigate({ to: "/login", replace: true });
  }, [navigate, queryClient]);
}
