import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { RoleBadge } from "@/components/role-badge";
import { Input } from "@/components/ui/input";
import { useSearchValues, useSetSearch } from "@/hooks/use-search";
import { relativeTime } from "@/lib/format";
import { kbQuery } from "@/lib/queries";
import { RelativeTime } from "@/components/relative-time";

export const Route = createFileRoute("/_shell/knowledge/")({
  head: () => ({
    meta: [
      { title: "Knowledge — Orchestra" },
      { name: "description", content: "Project knowledge base shared between people and their agents." },
      { property: "og:title", content: "Knowledge — Orchestra" },
      { property: "og:description", content: "Project knowledge base shared between people and their agents." },
    ],
  }),
  component: KnowledgePage,
});

function KnowledgePage() {
  const { q = "" } = useSearchValues();
  const setSearch = useSetSearch();
  const [text, setText] = useState(q);
  const { data } = useQuery(kbQuery(q));

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (text !== q) setSearch({ q: text || undefined });
    }, 250);
    return () => window.clearTimeout(t);
  }, [text, q, setSearch]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Knowledge</h1>
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search documents" className="pl-9" />
      </div>
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No documents found.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((d) => (
            <li key={d.id}>
              <Link
                to="/knowledge/$id"
                params={{ id: d.id }}
                className="block rounded-xl border bg-card p-4 hover:border-primary/40"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{d.id}</span>
                  <span className="font-medium">{d.title}</span>
                  {d.min_role !== "junior" ? <RoleBadge role={d.min_role} short /> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.excerpt}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {d.author.name} · <RelativeTime iso={d.created_at} />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
