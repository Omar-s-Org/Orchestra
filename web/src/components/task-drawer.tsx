import { useQuery } from "@tanstack/react-query";
import { Bot, FileText, Lock } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Markdown } from "@/components/markdown";
import { Link } from "@tanstack/react-router";

import { Avatar, Chip, UpdateCard, DueLabel, OverdueBadge, StatusPill } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSearchValues } from "@/hooks/use-search";
import { useTaskAction } from "@/hooks/use-task-actions";
import { useOpenTask } from "@/hooks/use-task-param";
import { artifactUrl } from "@/lib/api";
import { money, relativeTime, STATUS_LABEL } from "@/lib/format";
import { taskQuery } from "@/lib/queries";
import type { Artifact, Status, TaskDetail, Update, UserRef } from "@/lib/types";

/** Task drawer driven by ?task=<id> on any signed-in page. */
export function TaskDrawer() {
  const { task } = useSearchValues();
  const openTask = useOpenTask();
  return (
    <Sheet open={Boolean(task)} onOpenChange={(o) => !o && openTask(null)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
        {task ? <DrawerBody id={task} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ id }: { id: string }) {
  const { data: t, error } = useQuery(taskQuery(id));

  if (!t) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        <SheetTitle className="text-base">{id}</SheetTitle>
        <SheetDescription className="mt-2">{error ? error.message : "Loading task…"}</SheetDescription>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 border-b p-5 pr-12">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">{t.id}</span>
          <StatusPill status={t.status} />
          {t.sequence !== undefined ? <Chip>Step {t.sequence}</Chip> : null}
          <DueLabel due={t.due} overdue={t.overdue} />
          {t.overdue ? <OverdueBadge /> : null}
        </div>
        <SheetTitle className="text-lg leading-snug">{t.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
          <span>{t.milestone.name}</span>
          {t.departments.map((d) => (
            <Chip key={d}>{d}</Chip>
          ))}
          {t.cost_usd > 0 ? <Chip className="tabular-nums">{money(t.cost_usd)}</Chip> : null}
        </SheetDescription>
        {t.locked ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <div>
              Locked until its dependencies are done
              {t.blocked_by?.length ? (
                <ul className="mt-1 space-y-0.5">
                  {t.blocked_by.map((b) => (
                    <li key={b.id}>
                      Waiting on <span className="font-mono">{b.id}</span> {b.title} · {STATUS_LABEL[b.status]}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-6 text-xs">
          <People label="Workers" users={t.workers} />
          <People label="Access" users={t.access} />
        </div>
        {t.live ? (
          <div className="flex items-center gap-2 rounded-lg border border-agent/40 bg-agent/10 p-2.5 text-xs text-agent">
            <span className="size-2 animate-live-pulse rounded-full bg-agent" />
            <Bot className="size-3.5" />
            <span className="font-medium">{t.live.agent_name}:</span>
            <span className="truncate">{t.live.activity}</span>
            <span className="ml-auto shrink-0 opacity-75">{relativeTime(t.live.since)}</span>
          </div>
        ) : null}
      </div>

      <Tabs defaultValue="timeline" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-5 mt-3 w-fit">
          <TabsTrigger value="timeline">Timeline ({t.updates.length})</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="files">Files ({t.artifacts.length})</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <TabsContent value="timeline" className="mt-0 space-y-3">
            <Timeline t={t} />
          </TabsContent>
          <TabsContent value="details" className="mt-0 space-y-5">
            <Details t={t} />
          </TabsContent>
          <TabsContent value="files" className="mt-0">
            <FileGrid artifacts={t.artifacts} />
          </TabsContent>
        </div>
      </Tabs>

      <Actions t={t} />
    </>
  );
}

function People({ label, users }: { label: string; users: UserRef[] }) {
  return (
    <div>
      <p className="mb-1 text-muted-foreground">{label}</p>
      {users.length ? (
        <div className="flex flex-wrap gap-1.5">
          {users.map((u) => (
            <span key={u.id} className="inline-flex items-center gap-1">
              <Avatar user={u} size={22} />
              <span>{u.name.split(" ")[0]}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">—</p>
      )}
    </div>
  );
}

function Timeline({ t }: { t: TaskDetail }) {
  if (!t.updates.length) return <p className="text-sm text-muted-foreground">No updates yet.</p>;
  const images = t.artifacts.filter((a) => a.mime.startsWith("image/"));
  return (
    <>
      {t.updates.map((u) => (
        <UpdateCardWithImages key={u.id} update={u} images={u.kind === "completion" ? images : []} />
      ))}
    </>
  );
}

function UpdateCardWithImages({ update, images }: { update: Update; images: Artifact[] }) {
  const inline = images.filter((a) => !update.summary.includes(a.url));
  return (
    <div className="space-y-2">
      <UpdateCard update={update} />
      {inline.length ? (
        <div className="flex flex-wrap gap-2 pl-4">
          {inline.map((a) => (
            <img key={a.id} src={artifactUrl(a.url)} alt={a.name} className="max-h-48 rounded-lg border" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function TaskLinks({ items }: { items: { id: string; title: string; status: Status }[] }) {
  const openTask = useOpenTask();
  if (!items.length) return <p className="text-sm text-muted-foreground">None</p>;
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.id}>
          <button
            type="button"
            onClick={() => openTask(i.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
          >
            <span className="font-mono text-xs text-muted-foreground">{i.id}</span>
            <span className="flex-1 truncate">{i.title}</span>
            <StatusPill status={i.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Details({ t }: { t: TaskDetail }) {
  return (
    <>
      <Section title="Description">
        {t.description ? <Markdown>{t.description}</Markdown> : <p className="text-sm text-muted-foreground">—</p>}
      </Section>
      <Section title="Scope">
        {t.scope ? <Markdown>{t.scope}</Markdown> : <p className="text-sm text-muted-foreground">—</p>}
      </Section>
      <Section title="Depends on">
        <TaskLinks items={t.depends_on} />
      </Section>
      <Section title="Blocks">
        <TaskLinks items={t.blocks} />
      </Section>
      <Section title="Related">
        <TaskLinks items={t.mentions} />
      </Section>
      <Section title="Docs">
        {t.docs.length ? (
          <ul className="space-y-1">
            {t.docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                {d.readable ? <FileText className="size-3.5" /> : <Lock className="size-3.5 text-muted-foreground" />}
                <span className="font-mono text-xs text-muted-foreground">{d.id}</span>
                {d.readable ? (
                  <Link to="/knowledge/$id" params={{ id: d.id }} className="hover:underline">
                    {d.title}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{d.title}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None</p>
        )}
      </Section>
      <Section title="Subtasks">
        <TaskLinks items={t.subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status }))} />
      </Section>
    </>
  );
}

export function FileGrid({ artifacts }: { artifacts: Artifact[] }) {
  if (!artifacts.length) return <p className="text-sm text-muted-foreground">No files yet.</p>;
  return (
    <div className="grid grid-cols-2 gap-3">
      {artifacts.map((a) => (
        <a
          key={a.id}
          href={artifactUrl(a.url)}
          target="_blank"
          rel="noreferrer"
          className="overflow-hidden rounded-lg border bg-card hover:border-primary/40"
        >
          {a.mime.startsWith("image/") ? (
            <img src={artifactUrl(a.url)} alt={a.name} className="h-28 w-full bg-muted object-contain" />
          ) : (
            <div className="flex h-28 items-center justify-center bg-muted">
              <FileText className="size-8 text-muted-foreground" />
            </div>
          )}
          <div className="p-2 text-xs">
            <p className="truncate font-medium">{a.name}</p>
            <p className="text-muted-foreground">
              {a.user.name} · {relativeTime(a.created_at)}
            </p>
          </div>
        </a>
      ))}
    </div>
  );
}

function Actions({ t }: { t: TaskDetail }) {
  const [mode, setMode] = useState<null | "approve" | "reopen">(null);
  const [note, setNote] = useState("");
  const action = useTaskAction();
  const canApprove = t.allowed_actions.includes("approve");
  const canReopen = t.allowed_actions.includes("reopen");
  if (!canApprove && !canReopen) return null;

  const submit = () => {
    if (!mode) return;
    action.mutate(
      { id: t.id, action: mode, note: note.trim() },
      { onSuccess: () => { setMode(null); setNote(""); } },
    );
  };

  return (
    <div className="space-y-2 border-t bg-surface p-4">
      {mode ? (
        <>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "approve" ? "Optional note" : "What needs to change? (required)"}
            rows={3}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={action.isPending || (mode === "reopen" && !note.trim())}
              onClick={submit}
              className={mode === "approve" ? "bg-success text-success-foreground hover:bg-success/90" : "bg-warning text-warning-foreground hover:bg-warning/90"}
            >
              {mode === "approve" ? "Confirm approve" : "Send back"}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex justify-end gap-2">
          {canReopen ? (
            <Button size="sm" className="bg-warning text-warning-foreground hover:bg-warning/90" onClick={() => setMode("reopen")}>
              Send back
            </Button>
          ) : null}
          {canApprove ? (
            <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" onClick={() => setMode("approve")}>
              Approve
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
