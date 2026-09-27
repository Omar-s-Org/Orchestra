import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { getToken } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import type { Me } from "@/lib/types";

/**
 * Auth guard for a page: with no token, redirect to /login?next=<current path>.
 * Capabilities come from the server; the UI never computes them.
 */
export function useAuthGuard(): { me: Me | undefined; ready: boolean } {
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });
  const token = typeof window === "undefined" ? null : getToken();

  const { data: me } = useQuery({ ...meQuery(), enabled: Boolean(token) });

  useEffect(() => {
    // Never wrap the login page in itself (that loops: /login?next=/login?next=…).
    if (!token && !href.startsWith("/login")) void navigate({ to: "/login", search: { next: href }, replace: true });
  }, [href, navigate, token]);

  return { me, ready: Boolean(token && me) };
}
