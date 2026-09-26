import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";

import { RoleBadge } from "@/components/role-badge";
import { useOpenTask } from "@/hooks/use-task-param";
import { absoluteTime, initials, relativeTime } from "@/lib/format";
import { liveAgentsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function useActiveAgentCount(): number {
  const { data } = useQuery(liveAgentsQuery());
  return data?.filter((a) => a.status === "active").length ?? 0;
}

export function LiveAgentsList() {
  const { data, isLoading } = useQuery(liveAgentsQuery());
  const openTask = useOpenTask();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Bot className="size-4 text-agent" />
        <h2 className="text-sm font-semibold">Live agents</h2>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading && !data ? (
          <p className="px-1 text-xs text-muted-foreground">Loading…</p>
        ) : !data?.length ? (
          <p className="px-1 text-xs text-muted-foreground">No agents connected yet.</p>
        ) : (
          data.map((a) => {
            const active = a.status === "active";
            return (
              <div key={a.user.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {initials(a.user.name)}
                    <span
                      className={cn(
                        "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card",
                        active ? "animate-live-pulse bg-agent" : "bg-muted-foreground/50",
                      )}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{a.user.name}</span>
                      <RoleBadge role={a.user.role} short />
                    </div>
                    <p className="truncate text-xs text-agent">🤖 {a.agent_name}</p>
                  </div>
                </div>
                {a.task ? (
                  <button
                    type="button"
                    onClick={() => openTask(a.task!.id)}
                    className="mt-2 block w-full truncate rounded-md bg-muted/60 px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    <span className="font-mono text-muted-foreground">{a.task.id}</span> {a.task.title}
                  </button>
                ) : null}
                {a.activity ? (
                  <p className="mt-1.5 text-xs italic text-muted-foreground">{a.activity}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground/80" title={absoluteTime(a.last_seen)}>
                  last seen {relativeTime(a.last_seen)}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
