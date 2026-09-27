import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Lock, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/role-badge";
import { Avatar, Chip, DueLabel, StatusPill } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompanyView } from "@/hooks/use-company-view";
import { money, STATUS_LABEL, STATUS_ORDER } from "@/lib/format";
import { companyOverviewQuery, companyTaskQuery, companyTasksQuery, meQuery } from "@/lib/queries";
import type { Overview, Status, TaskSummary, UserRef } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/company")({
  head: () => ({
    meta: [
      { title: "Company progress — Orchestra" },
      { name: "description", content: "A privacy-safe view of company tasks, progress, people and spend." },
      { property: "og:title", content: "Company progress — Orchestra" },
      { property: "og:description", content: "A privacy-safe view of company tasks, progress, people and spend." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompanyPage,
});

type GroupBy = "milestone" | "department" | "person";
type Panel = { kind: "task"; id: string } | { kind: "person"; user: UserRef } | null;

const COMPANY_STATUS: Record<Status, string> = {
  todo: "bg-company-todo text-company-todo-foreground",
  in_progress: "bg-company-progress text-company-progress-foreground",
  review: "bg-company-review text-company-review-foreground",
  done: "bg-company-done text-company-done-foreground",
};

const EXPLANATION =
  "For startups: see the whole company's progress at a glance. Every task, who's on it and what it costs. Progress only: no prompts or agent reports.";

function CompanyPage() {
  const navigate = useNavigate();
  const { enabled } = useCompanyView();
  const { data: me } = useQuery(meQuery());
  const allowed = Boolean(me?.capabilities.graph);
  const { data: tasks = [] } = useQuery({ ...companyTasksQuery({}), enabled: allowed && enabled });
  const { data: overview } = useQuery({ ...companyOverviewQuery(), enabled: allowed && enabled });
  const [groupBy, setGroupBy] = useState<GroupBy>("milestone");
  const [panel, setPanel] = useState<Panel>(null);
  const [showCompanyTasks, setShowCompanyTasks] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [demoTasks, setDemoTasks] = useState<TaskSummary[]>([]);

  useEffect(() => {
    if (me && (!allowed || !enabled)) void navigate({ to: "/board", replace: true });
  }, [allowed, enabled, me, navigate]);

  if (!me || !allowed || !enabled) return null;

  const allTasks = [...tasks, ...demoTasks];
  const yourTasks = allTasks.filter((task) => task.workers.some((worker) => worker.id === me.user.id));

  return (
    <div className="min-h-full bg-surface/45 p-4 sm:p-6 lg:p-8">
      <header className="company-enter flex flex-col gap-5 border-b pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase text-primary">Company view</p>
          <h1 className="font-display mt-1 text-3xl font-semibold">Company progress</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{EXPLANATION}</p>
        </div>
        <StatusLegend />
      </header>

      <Kpis tasks={allTasks} overview={overview} />

      <div className="company-enter mt-6 overflow-hidden rounded-lg border bg-card shadow-card [animation-delay:80ms]">
        <div className="flex flex-col gap-4 border-b px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Focused work</h2>
            <p className="text-xs text-muted-foreground">Your assigned tasks stay visible. Company detail is optional.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-full bg-surface px-3 py-1.5">
              <span className="text-xs font-semibold text-primary">Your tasks</span>
              <span className="h-4 w-px bg-border" />
              <Label htmlFor="show-company" className="text-[11px] font-bold uppercase text-muted-foreground">Company</Label>
              <Switch id="show-company" checked={showCompanyTasks} onCheckedChange={setShowCompanyTasks} aria-label="Show company tasks" />
            </div>
            <Button onClick={() => setCreateOpen(true)}><Plus /> Add task</Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[104px_1fr]">
          <GroupingRail groupBy={groupBy} onChange={setGroupBy} />
          <div className="min-w-0 p-5 sm:p-7">
            <TaskLane title="Your tasks" tasks={yourTasks} onPanel={setPanel} emphasized empty="No tasks are assigned to you right now" />
            {showCompanyTasks ? (
              <div className="company-reveal mt-9 border-t pt-7">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-semibold">Company tasks</h3>
                    <p className="text-xs text-muted-foreground">Visible work from people below you, grouped for a quick scan.</p>
                  </div>
                  <ToggleGroup type="single" value={groupBy} onValueChange={(value) => value && setGroupBy(value as GroupBy)} variant="outline" size="sm">
                    <ToggleGroupItem value="milestone">Milestone</ToggleGroupItem>
                    <ToggleGroupItem value="department">Department</ToggleGroupItem>
                    <ToggleGroupItem value="person">Person</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <TaskGroups tasks={allTasks} overview={overview} groupBy={groupBy} onPanel={setPanel} />
              </div>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setShowCompanyTasks(true)} className="mt-9 h-auto w-full justify-between rounded-none border-t border-dashed px-0 pt-5 text-left text-xs text-muted-foreground hover:bg-transparent hover:text-foreground">
                <span className="inline-flex items-center gap-2"><Users className="size-4" /> Company tasks are hidden to keep this view focused</span>
                <span className="font-semibold text-primary">Show company tasks</span>
              </Button>
            )}
          </div>
        </div>
      </div>
      <CompanyPanel panel={panel} overview={overview} onPanel={setPanel} />
      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} tasks={allTasks} currentUser={me.user} onCreate={(task) => { setDemoTasks((current) => [...current, task]); setShowCompanyTasks(true); }} />
    </div>
  );
}

function GroupingRail({ groupBy, onChange }: { groupBy: GroupBy; onChange: (value: GroupBy) => void }) {
  return (
    <aside className="border-b bg-surface/55 p-3 lg:border-b-0 lg:border-r lg:py-7">
      <div className="flex gap-2 lg:flex-col">
        {(["milestone", "department", "person"] as const).map((value) => (
          <Button key={value} variant={groupBy === value ? "default" : "ghost"} className="h-auto flex-1 flex-col gap-0.5 px-2 py-2 text-[10px] font-bold uppercase lg:w-full" onClick={() => onChange(value)}>
            {value.slice(0, 1).toUpperCase()}{value === "milestone" ? "1" : ""}
            <span className="max-w-full truncate text-[9px] font-medium normal-case opacity-70">{value}</span>
          </Button>
        ))}
      </div>
    </aside>
  );
}

function TaskLane({ title, tasks, onPanel, emphasized = false, empty }: { title: string; tasks: TaskSummary[]; onPanel: (panel: Panel) => void; emphasized?: boolean; empty: string }) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h3 className={cn("text-xs font-bold uppercase", emphasized && "text-primary")}>{title}</h3>
        <span className={cn("h-px flex-1", emphasized ? "bg-primary/15" : "bg-border")} />
        <span className="text-[10px] tabular-nums text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex min-h-16 flex-wrap items-center gap-3">
        {ordered(tasks).map((task, index) => <TaskTile key={task.id} task={task} onClick={() => task.id.startsWith("DEMO-") ? toast.info("Visual preview only", { description: "This task has not been saved to company data." }) : onPanel({ kind: "task", id: task.id })} index={index} />)}
        {!tasks.length ? <p className="text-xs text-muted-foreground">{empty}</p> : null}
      </div>
    </section>
  );
}

function Kpis({ tasks, overview }: { tasks: TaskSummary[]; overview: Overview | undefined }) {
  const done = overview?.by_status.done ?? 0;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const values = [
    ["Tasks", tasks.length],
    ["Done", `${pct}%`],
    ["In progress", overview?.by_status.in_progress ?? 0],
    ["Milestones approved", `${overview?.milestones.filter((m) => m.approved_at).length ?? 0}/${overview?.milestones.length ?? 0}`],
    ["Overdue", overview?.overdue ?? 0],
    ["Agent spend", money(overview?.cost?.total_usd ?? 0)],
  ];
  return (
    <div className="company-enter mt-5 grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border bg-card shadow-card sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0 [animation-delay:40ms]">
      {values.map(([label, value]) => (
        <div key={label} className="min-w-0 px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className={cn("mt-1 text-xl font-semibold tabular-nums", label === "Overdue" && Number(value) > 0 && "text-destructive")}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {STATUS_ORDER.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", COMPANY_STATUS[status])} /> {STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  );
}

function TaskGroups({ tasks, overview, groupBy, onPanel }: { tasks: TaskSummary[]; overview: Overview | undefined; groupBy: GroupBy; onPanel: (panel: Panel) => void }) {
  const groups = useMemo(() => {
    if (groupBy === "milestone") {
      return (overview?.milestones ?? []).map((m) => ({ id: m.id, name: m.name, tasks: tasks.filter((t) => t.milestone.id === m.id), person: undefined }));
    }
    if (groupBy === "department") {
      return [...new Set(tasks.flatMap((t) => t.departments))].sort().map((name) => ({ id: name, name, tasks: tasks.filter((t) => t.departments.includes(name)), person: undefined }));
    }
    const people = new Map<string, UserRef>();
    tasks.flatMap((t) => t.workers).forEach((person) => people.set(person.id, person));
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map((person) => ({ id: person.id, name: person.name, tasks: tasks.filter((t) => t.workers.some((w) => w.id === person.id)), person }));
  }, [groupBy, overview?.milestones, tasks]);

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      {groups.map((group) => {
        const done = group.tasks.filter((t) => t.status === "done").length;
        const pct = group.tasks.length ? Math.round((done / group.tasks.length) * 100) : 0;
        return (
          <section key={group.id} className="grid gap-4 border-b p-4 last:border-b-0 md:grid-cols-[180px_1fr]">
            <div className="min-w-0 self-center">
              {group.person ? (
                <Button variant="ghost" className="h-auto max-w-full justify-start px-1 py-0.5" onClick={() => onPanel({ kind: "person", user: group.person as UserRef })}>
                  <Avatar user={group.person} /> <span className="truncate">{group.name}</span>
                </Button>
              ) : <p className="truncate text-sm font-medium">{group.name}</p>}
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} /></div>
                <span className="text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
              </div>
            </div>
            <div className="flex min-h-14 flex-wrap items-center gap-3">
              {ordered(group.tasks).map((task, index) => <TaskTile key={task.id} task={task} onClick={() => task.id.startsWith("DEMO-") ? toast.info("Visual preview only", { description: "This task has not been saved to company data." }) : onPanel({ kind: "task", id: task.id })} index={index} />)}
              {!group.tasks.length ? <span className="text-xs text-muted-foreground">No tasks</span> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ordered(tasks: TaskSummary[]) {
  return [...tasks].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function TaskTile({ task, onClick, index = 0 }: { task: TaskSummary; onClick: () => void; index?: number }) {
  const subtask = Boolean(task.parent_id);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            onClick={onClick}
            aria-label={`Open ${task.id}: ${task.title}`}
            className={cn(
              "company-tile relative size-14 shrink-0 rounded-lg p-0 font-mono text-[10px] font-bold shadow-none hover:-translate-y-0.5 hover:brightness-95",
              COMPANY_STATUS[task.status],
              task.locked && "opacity-60",
              task.overdue && "ring-2 ring-company-overdue",
              task.live && "company-live-tile",
              subtask && "border-2 border-dashed border-current",
            )}
            style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
          >
            <span>{task.id}</span>
            {subtask ? <span className="absolute bottom-1 text-[7px] font-medium uppercase opacity-70">Subtask</span> : null}
            {task.locked ? <Lock className="absolute right-0.5 top-0.5 size-2.5" /> : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64"><p className="font-medium">{task.id} · {task.title}</p><p className="opacity-80">{STATUS_LABEL[task.status]}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CreateTaskDialog({ open, onOpenChange, tasks, currentUser, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; tasks: TaskSummary[]; currentUser: UserRef; onCreate: (task: TaskSummary) => void }) {
  const people = uniquePeople([currentUser, ...tasks.flatMap((task) => task.workers)]);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUser.id);

  function assign(event: FormEvent) {
    event.preventDefault();
    const assignee = people.find((person) => person.id === assigneeId) ?? currentUser;
    const nextNumber = tasks.filter((task) => task.id.startsWith("DEMO-")).length + 1;
    const task: TaskSummary = {
      id: `DEMO-${nextNumber}`,
      title: title.trim() || "New assigned task",
      status: "todo",
      milestone: tasks[0]?.milestone ?? { id: "demo", name: "New work" },
      parent_id: null,
      departments: [assignee.department],
      workers: [assignee],
      access: [currentUser],
      live: null,
      cost_usd: 0,
      updated_at: new Date().toISOString(),
      due: null,
      overdue: false,
      sequence: nextNumber,
      locked: false,
      blocked_by: [],
      allowed_actions: [],
    };
    onCreate(task);
    setTitle("");
    onOpenChange(false);
    toast.success("Assigned", { description: `${task.id} is now shown in the Company view. This is a visual preview only.` });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={assign} className="space-y-5">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Assign a task</DialogTitle>
            <DialogDescription>This preview adds the task to this screen only and does not change company data.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2"><Label htmlFor="task-title">Task</Label><Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" autoFocus /></div>
          <div className="space-y-2">
            <Label>Assign to</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{people.map((person) => <SelectItem key={person.id} value={person.id}>{person.name} · {person.department}</SelectItem>)}</SelectContent></Select>
          </div>
          <DialogFooter><Button type="submit"><Check /> Assign task</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompanyPanel({ panel, overview, onPanel }: { panel: Panel; overview: Overview | undefined; onPanel: (panel: Panel) => void }) {
  return (
    <Sheet open={panel !== null} onOpenChange={(open) => !open && onPanel(null)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[420px]">
        {panel?.kind === "task" ? <TaskPanel id={panel.id} onPanel={onPanel} /> : null}
        {panel?.kind === "person" ? <PersonPanel user={panel.user} overview={overview} onPanel={onPanel} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function TaskPanel({ id, onPanel }: { id: string; onPanel: (panel: Panel) => void }) {
  const { data: task } = useQuery(companyTaskQuery(id));
  if (!task) return <SheetTitle>Loading task…</SheetTitle>;
  const people = uniquePeople([...task.workers, ...task.access]);
  return (
    <div className="space-y-6">
      <SheetHeader>
        <p className="font-mono text-xs text-muted-foreground">{task.id}</p>
        <SheetTitle className="pr-8">{task.title}</SheetTitle>
        <SheetDescription>Progress details only. Agent reports and prompts stay private.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-wrap items-center gap-2"><StatusPill status={task.status} /><DueLabel due={task.due} overdue={task.overdue} />{task.locked ? <Chip><Lock className="mr-1 size-3" /> Locked</Chip> : null}</div>
      <PanelSection title="Departments"><div className="flex flex-wrap gap-1.5">{task.departments.map((d) => <Chip key={d}>{d}</Chip>)}</div></PanelSection>
      <PanelSection title="People">
        <div className="space-y-2">{people.map((person) => <Button key={person.id} variant="ghost" className="h-auto w-full justify-start px-2 py-1.5" onClick={() => onPanel({ kind: "person", user: person })}><Avatar user={person} /><span className="text-left"><span className="block text-sm font-medium">{person.name}</span><span className="block text-[11px] text-muted-foreground">{person.department}</span></span><RoleBadge className="ml-auto" role={person.role} short /></Button>)}</div>
      </PanelSection>
      <PanelSection title="Subtasks"><TaskLinks tasks={task.subtasks} onPanel={onPanel} empty="No subtasks" /></PanelSection>
      <PanelSection title="Dependencies"><TaskLinks tasks={task.depends_on} onPanel={onPanel} empty="No dependencies" /></PanelSection>
      <PanelSection title="Blocks"><TaskLinks tasks={task.blocks} onPanel={onPanel} empty="Doesn't block another task" /></PanelSection>
      {task.locked && task.blocked_by?.length ? <PanelSection title="Waiting on"><TaskLinks tasks={task.blocked_by} onPanel={onPanel} /></PanelSection> : null}
      {task.sequence != null ? <p className="text-xs text-muted-foreground">Suggested sequence: {task.sequence}</p> : null}
    </div>
  );
}

function PersonPanel({ user, overview, onPanel }: { user: UserRef; overview: Overview | undefined; onPanel: (panel: Panel) => void }) {
  const { data: all = [] } = useQuery(companyTasksQuery({ person: user.id }));
  const { data: active = [] } = useQuery(companyTasksQuery({ person: user.id, status: "in_progress" }));
  const cost = overview?.cost?.by_person.find((row) => row.user.id === user.id);
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, all.filter((task) => task.status === status).length])) as Record<Status, number>;
  return (
    <div className="space-y-6">
      <SheetHeader>
        <div className="flex items-center gap-3"><Avatar user={user} size={42} /><div><SheetTitle>{user.name}</SheetTitle><SheetDescription>{user.department}</SheetDescription></div></div>
      </SheetHeader>
      <RoleBadge role={user.role} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
        <Metric label="Spend" value={money(cost?.cost_usd ?? 0)} />
        <Metric label="Tasks done" value={cost?.tasks_done ?? 0} />
      </div>
      <PanelSection title="Task status"><div className="grid grid-cols-2 gap-2">{STATUS_ORDER.map((status) => <div key={status} className="flex items-center justify-between rounded-md bg-muted px-2.5 py-2 text-xs"><span>{STATUS_LABEL[status]}</span><strong className="tabular-nums">{counts[status]}</strong></div>)}</div></PanelSection>
      <PanelSection title="In progress"><TaskLinks tasks={active} onPanel={onPanel} empty="No tasks in progress" tiles /></PanelSection>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="bg-card p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>; }
function PanelSection({ title, children }: { title: string; children: ReactNode }) { return <section><h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</h3>{children}</section>; }
function TaskLinks({ tasks, onPanel, empty, tiles = false }: { tasks: Pick<TaskSummary, "id" | "title" | "status">[]; onPanel: (panel: Panel) => void; empty?: string; tiles?: boolean }) {
  if (!tasks.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return <div className="space-y-1.5">{tasks.map((task) => <Button key={task.id} variant="outline" className="h-auto w-full justify-start px-2.5 py-2 text-left" onClick={() => onPanel({ kind: "task", id: task.id })}><span className={cn("size-2 shrink-0 rounded-sm", COMPANY_STATUS[task.status])} /><span className={cn("font-mono text-[11px]", tiles && "font-semibold")}>{task.id}</span><span className="truncate text-xs font-normal">{task.title}</span></Button>)}</div>;
}
function uniquePeople(people: UserRef[]) { return [...new Map(people.map((person) => [person.id, person])).values()]; }
