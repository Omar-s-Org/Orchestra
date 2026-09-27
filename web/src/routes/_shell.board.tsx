import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Lock } from "lucide-react";

import { AvatarStack, Chip, DueLabel, OverdueBadge, STATUS_DOT } from "@/components/task-bits";
import { useSearchValues, useSetSearch } from "@/hooks/use-search";
import { useOpenTask } from "@/hooks/use-task-param";
import { money, STATUS_LABEL, STATUS_ORDER } from "@/lib/format";
import { meQuery, overviewQuery, tasksQuery } from "@/lib/queries";
import type { Me, Overview, TaskSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/board")({
  head: () => ({
    meta: [
      { title: "Board — Orchestra" },
      { name: "description", content: "Kanban board of every task your agents are working on." },
      { property: "og:title", content: "Board — Orchestra" },
      { property: "og:description", content: "Kanban board of every task your agents are working on." },
    ],
  }),
  component: BoardPage,
});

function BoardPage() {
  const { data: me } = useQuery(meQuery());
  const { data: overview } = useQuery(overviewQuery());
  const search = useSearchValues();
  const setSearch = useSetSearch();
  const filters = {
    department: search["department"],
    person: search["person"],
    mine: search["mine"] === "true",
  };
  const { data: tasks } = useQuery(tasksQuery(filters));
  const { data: all } = useQuery(tasksQuery({}));
  if (!me) return null;

  const departments = [...new Set((all ?? []).flatMap((t) => t.departments))].sort();
  const people = [...new Map((all ?? []).flatMap((t) => t.workers).map((u) => [u.id, u])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold tracking-tight">Board</h1>
        {overview
          ? STATUS_ORDER.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs">
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[s])} />
                {STATUS_LABEL[s]} <span className="font-semibold tabular-nums">{overview.by_status[s]}</span>
              </span>
            ))
          : null}
        {overview ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs text-destructive">
            Overdue <span className="font-semibold tabular-nums">{overview.overdue}</span>
          </span>
        ) : null}
      </div>

      {me.capabilities.cost && overview?.cost ? <CostTiles me={me} cost={overview.cost} /> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={filters.mine} onClick={() => setSearch({ mine: filters.mine ? undefined : "true" })}>
          Mine
        </FilterChip>
        <span className="mx-1 h-4 w-px bg-border" />
        {departments.map((d) => (
          <FilterChip
            key={d}
            active={filters.department === d}
            onClick={() => setSearch({ department: filters.department === d ? undefined : d })}
          >
            {d}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {people.map((p) => (
          <FilterChip
            key={p.id}
            active={filters.person === p.id}
            onClick={() => setSearch({ person: filters.person === p.id ? undefined : p.id })}
          >
            {p.name.split(" ")[0]}
          </FilterChip>
        ))}
      </div>

      <Kanban tasks={tasks ?? []} me={me} loading={!tasks} />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function CostTiles({ me, cost }: { me: Me; cost: NonNullable<Overview["cost"]> }) {
  const rows =
    me.user.role === "pm"
      ? cost.by_department.map((d) => ({ key: d.department, label: d.department, value: d.cost_usd, sub: null as string | null }))
      : cost.by_person.map((p) => ({ key: p.user.id, label: p.user.name, value: p.cost_usd, sub: `${p.tasks_done} done` }));
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
      <div className="rounded-xl border bg-card p-3">
        <p className="text-xs text-muted-foreground">Total agent cost</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{money(cost.total_usd)}</p>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="rounded-xl border bg-card p-3">
          <p className="truncate text-xs text-muted-foreground">{r.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{money(r.value)}</p>
          {r.sub ? <p className="text-[11px] text-muted-foreground">{r.sub}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** Parents first, each followed by its subtasks; sorted by sequence when the backend provides it. */
function ordered(list: TaskSummary[]): TaskSummary[] {
  const sorted = [...list].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const ids = new Set(sorted.map((t) => t.id));
  const out: TaskSummary[] = [];
  for (const t of sorted) {
    if (t.parent_id && ids.has(t.parent_id)) continue;
    out.push(t);
    out.push(...sorted.filter((c) => c.parent_id === t.id));
  }
  return out;
}

function Kanban({ tasks, me, loading }: { tasks: TaskSummary[]; me: Me; loading: boolean }) {
  const nextUp = ordered(tasks).find(
    (t) => t.status === "todo" && t.locked === false && t.workers.some((w) => w.id === me.user.id),
  )?.id;

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {STATUS_ORDER.map((status) => {
        const col = ordered(tasks.filter((t) => t.status === status));
        return (
          <section key={status} className="flex min-w-0 flex-col rounded-xl bg-surface p-2.5">
            <header className="mb-2 flex items-center gap-2 px-1 text-sm font-medium">
              <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
              {STATUS_LABEL[status]}
              <span className="text-xs text-muted-foreground tabular-nums">{col.length}</span>
            </header>
            <div className="space-y-2">
              {loading ? <p className="px-1 text-xs text-muted-foreground">Loading…</p> : null}
              {col.map((t) => (
                <TaskCard key={t.id} t={t} nextUp={t.id === nextUp} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({ t, nextUp }: { t: TaskSummary; nextUp: boolean }) {
  const openTask = useOpenTask();
  const sub = Boolean(t.parent_id);
  return (
    <button
      type="button"
      onClick={() => openTask(t.id)}
      className={cn(
        "block w-full rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/40",
        sub && "ml-4 w-[calc(100%-1rem)]",
        t.live && "animate-live-pulse border-agent",
        t.locked && "opacity-75",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {sub ? <span>↳</span> : null}
        <span className="font-mono">{t.id}</span>
        {t.locked ? <Lock className="size-3" /> : null}
        {nextUp ? <Chip className="bg-primary/12 text-primary">Next up</Chip> : null}
        <span className="ml-auto truncate">{t.milestone.name}</span>
      </div>
      <p className="mt-1 text-sm leading-snug font-medium">{t.title}</p>
      {t.locked && t.blocked_by?.length ? (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" />
          Locked · waiting on {t.blocked_by.map((b) => b.id).join(", ")}
        </p>
      ) : null}
      {t.live ? (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-agent/40 bg-agent/10 px-2 py-1 text-[11px] text-agent">
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-agent opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-agent" />
          </span>
          <Bot className="size-3 shrink-0" />
          <span className="shrink-0 font-medium">{t.live.agent_name}</span>
          <span className="truncate opacity-80">· {t.live.activity}</span>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {t.departments.map((d) => (
          <Chip key={d}>{d}</Chip>
        ))}
        <DueLabel due={t.due} overdue={t.overdue} />
        {t.overdue ? <OverdueBadge /> : null}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <AvatarStack users={t.workers} />
        {t.cost_usd > 0 ? <span className="text-[11px] text-muted-foreground tabular-nums">{money(t.cost_usd)}</span> : null}
      </div>
    </button>
  );
}
