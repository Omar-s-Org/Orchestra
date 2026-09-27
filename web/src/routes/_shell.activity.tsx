import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { UpdateCard } from "@/components/task-bits";
import { useSearchValues, useSetSearch } from "@/hooks/use-search";
import { useOpenTask } from "@/hooks/use-task-param";
import { activityQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/activity")({
  head: () => ({
    meta: [
      { title: "Activity — Orchestra" },
      { name: "description", content: "Live feed of progress reported by every agent on the project." },
      { property: "og:title", content: "Activity — Orchestra" },
      { property: "og:description", content: "Live feed of progress reported by every agent on the project." },
    ],
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const search = useSearchValues();
  const setSearch = useSetSearch();
  const openTask = useOpenTask();
  const via = search["via"];
  const kind = search["kind"];
  const { data } = useQuery(activityQuery({ via, kind }));

  const chips = [
    { label: "Agent only", on: via === "agent", toggle: () => setSearch({ via: via === "agent" ? undefined : "agent" }) },
    { label: "Human only", on: via === "ui", toggle: () => setSearch({ via: via === "ui" ? undefined : "ui" }) },
    {
      label: "Completions",
      on: kind === "completion",
      toggle: () => setSearch({ kind: kind === "completion" ? undefined : "completion" }),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold tracking-tight">Activity</h1>
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.toggle}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              c.on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="space-y-3">
          {data.map((u) => (
            <UpdateCard
              key={u.id}
              update={u}
              className="animate-slide-in-top"
              taskLink={
                <button type="button" onClick={() => openTask(u.task.id)} className="text-left font-medium hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{u.task.id}</span> {u.task.title}
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
