import { format } from "date-fns";
import { Bot, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { Markdown } from "@/components/markdown";
import { RoleBadge } from "@/components/role-badge";
import { absoluteTime, initials, money, relativeTime, STATUS_LABEL } from "@/lib/format";
import type { Status, Update, UserRef } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/relative-time";

export const STATUS_DOT: Record<Status, string> = {
  todo: "bg-muted-foreground/60",
  in_progress: "bg-primary",
  review: "bg-warning",
  done: "bg-success",
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function dueText(due: string | null | undefined): string | null {
  if (!due) return null;
  try {
    return `Due ${format(new Date(due), "d MMM")}`;
  } catch {
    return null;
  }
}

export function DueLabel({ due, overdue }: { due: string | null | undefined; overdue: boolean }) {
  const text = dueText(due);
  if (!text) return null;
  return (
    <span className={cn("text-[11px] tabular-nums", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
      {text}
    </span>
  );
}

export function OverdueBadge() {
  return (
    <span className="rounded-md bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground">
      Overdue
    </span>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export function Avatar({ user, size = 24 }: { user: UserRef; size?: number }) {
  return (
    <span
      title={`${user.name} · ${user.department}`}
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold"
    >
      {initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users, max = 4 }: { users: UserRef[]; max?: number }) {
  if (!users.length) return null;
  return (
    <span className="flex -space-x-1.5">
      {users.slice(0, max).map((u) => (
        <Avatar key={u.id} user={u} size={22} />
      ))}
      {users.length > max ? (
        <span className="inline-flex size-[22px] items-center justify-center rounded-full border-2 border-card bg-muted text-[10px]">
          +{users.length - max}
        </span>
      ) : null}
    </span>
  );
}

/** Shared card for task timeline, activity feed and review rows. */
export function UpdateCard({
  update,
  taskLink,
  className,
}: {
  update: Update;
  taskLink?: ReactNode;
  className?: string;
}) {
  const completion = update.kind === "completion";
  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4",
        completion && "border-agent/40 bg-agent/5",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <Avatar user={update.user} size={24} />
        <span className="font-medium">{update.user.name}</span>
        <RoleBadge role={update.user.role} short />
        {update.via === "agent" ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-agent/12 px-1.5 py-0.5 text-[11px] font-medium text-agent">
            <Bot className="size-3" /> {update.agent_name ?? "via agent"}
          </span>
        ) : null}
        {completion ? <Chip className="bg-agent/15 text-agent">Completion</Chip> : null}
        {update.kind === "approval" ? <Chip className="bg-success/15 text-success">Approval</Chip> : null}
        {update.status_from && update.status_to ? (
          <Chip>
            {STATUS_LABEL[update.status_from]} → {STATUS_LABEL[update.status_to]}
          </Chip>
        ) : null}
        <span className="ml-auto text-muted-foreground" title={absoluteTime(update.created_at)}>
          <RelativeTime iso={update.created_at} />
        </span>
      </header>
      {taskLink ? <div className="mt-2 text-sm">{taskLink}</div> : null}
      {update.summary ? <Markdown className="mt-2">{update.summary}</Markdown> : null}
      {update.agents_used.length || update.cost_usd > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {update.agents_used.map((a) => (
            <Chip key={a}>{a}</Chip>
          ))}
          {update.cost_usd > 0 ? <Chip className="font-medium tabular-nums">{money(update.cost_usd)}</Chip> : null}
        </div>
      ) : null}
      {update.links.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {update.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
            >
              <ExternalLink className="size-3" /> {l.label}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}
