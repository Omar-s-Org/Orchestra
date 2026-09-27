import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { RoleBadge } from "@/components/role-badge";
import { useOpenTask } from "@/hooks/use-task-param";
import { relativeTime } from "@/lib/format";
import { kbDocQuery } from "@/lib/queries";

export const Route = createFileRoute("/_shell/knowledge/$id")({
  head: () => ({
    meta: [
      { title: "Document — Orchestra" },
      { name: "description", content: "Read a knowledge base document and its linked tasks." },
      { property: "og:title", content: "Document — Orchestra" },
      { property: "og:description", content: "Read a knowledge base document and its linked tasks." },
    ],
  }),
  component: DocPage,
});

function DocPage() {
  const { id } = Route.useParams();
  const { data, error } = useQuery(kbDocQuery(id));
  const openTask = useOpenTask();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Link to="/knowledge" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Knowledge
      </Link>
      {!data ? (
        <p className="text-sm text-muted-foreground">{error ? error.message : "Loading…"}</p>
      ) : (
        <>
          <header>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{data.id}</span>
              {data.min_role !== "junior" ? <RoleBadge role={data.min_role} short /> : null}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.author.name} · {relativeTime(data.created_at)}
            </p>
          </header>
          <article className="rounded-xl border bg-card p-6">
            <Markdown>{data.body}</Markdown>
          </article>
          <section>
            <h2 className="mb-2 text-sm font-semibold">Linked tasks</h2>
            {data.linked_tasks.length ? (
              <ul className="space-y-1">
                {data.linked_tasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => openTask(t.id)} className="text-sm hover:underline">
                      <span className="font-mono text-xs text-muted-foreground">{t.id}</span> {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
