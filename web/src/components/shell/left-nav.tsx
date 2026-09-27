import { Link } from "@tanstack/react-router";
import { BookOpen, Building2, CheckCheck, Columns3, Network, Rss } from "lucide-react";

import { useCompanyView } from "@/hooks/use-company-view";
import type { Capabilities } from "@/lib/types";

/** Nav items come only from me.capabilities (section 3). */
export function LeftNav({ capabilities }: { capabilities: Capabilities }) {
  const { enabled: companyView } = useCompanyView();
  const items = [
    ...(capabilities.graph ? [{ to: "/graph", label: "Graph", icon: Network }] : []),
    ...(capabilities.graph && companyView ? [{ to: "/company", label: "Company", icon: Building2 }] : []),
    { to: "/board", label: "Board", icon: Columns3 },
    { to: "/activity", label: "Activity", icon: Rss },
    { to: "/knowledge", label: "Knowledge", icon: BookOpen },
    ...(capabilities.review ? [{ to: "/review", label: "Review", icon: CheckCheck }] : []),
  ] as const;

  return (
    <nav className="flex w-14 shrink-0 flex-col gap-0.5 border-r bg-sidebar p-2 sm:w-52 sm:p-3">
      {items.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-label={label}
          className="flex items-center justify-center gap-2.5 rounded-lg px-2 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground sm:justify-start sm:px-3"
          activeProps={{
            className: "bg-sidebar-accent font-medium !text-sidebar-accent-foreground",
          }}
        >
          <Icon className="size-4" />
          <span className="hidden sm:inline">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
