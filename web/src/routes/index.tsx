import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { Logo } from "@/components/logo";
import { useSourceMonitor } from "@/hooks/use-data-source";
import { getToken } from "@/lib/api";
import { meQuery } from "@/lib/queries";

/** Landing router: Graph for PMs (capabilities.graph), otherwise Board. */
export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Workspace — Orchestra" },
      { name: "description", content: "Open your live Orchestra project workspace." },
      { property: "og:title", content: "Workspace — Orchestra" },
      { property: "og:description", content: "Open your live Orchestra project workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useSourceMonitor();
  const token = typeof window === "undefined" ? null : getToken();

  const { data: me, error } = useQuery({ ...meQuery(), enabled: Boolean(token) });

  useEffect(() => {
    if (!token) {
      void navigate({ to: "/login", search: { next: "/" }, replace: true });
      return;
    }
    if (error) return;
    if (me) {
      void navigate({ to: me.capabilities.graph ? "/graph" : "/board", replace: true });
    }
  }, [error, me, navigate, token]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Logo size={30} />
        <span className="text-sm">Loading your workspace…</span>
      </div>
    </div>
  );
}
