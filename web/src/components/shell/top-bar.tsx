import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Info, Moon, Sun } from "lucide-react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompanyView } from "@/hooks/use-company-view";
import { useTheme } from "@/hooks/use-theme";
import { overviewQuery } from "@/lib/queries";
import type { Me } from "@/lib/types";

import { DemoControl } from "./demo-control";
import { UserMenu } from "./user-menu";

function MilestoneStrip() {
  const { data } = useQuery(overviewQuery());
  if (!data) return null;
  return (
    <div className="hidden items-center gap-4 xl:flex">
      {data.milestones.map((m) => (
        <div
          key={m.id}
          className="w-32"
          title={`${m.name} · due ${m.due} · ${m.done}/${m.total} done${m.approved_at ? " · signed off" : m.ready_for_signoff ? " · ready for sign-off" : ""}`}
        >
          <div className="flex justify-between text-[11px]">
            <span className="truncate text-muted-foreground">
              {m.approved_at ? <span className="text-success">✓ </span> : null}
              {m.name}
            </span>
            <span className="font-medium tabular-nums">{m.pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${m.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TopBar({ me }: { me: Me }) {
  const { theme, toggle } = useTheme();
  const { enabled: companyView, setEnabled: setCompanyView } = useCompanyView();
  const navigate = useNavigate();

  function changeCompanyView(enabled: boolean) {
    setCompanyView(enabled);
    void navigate({ to: enabled ? "/company" : me.capabilities.graph ? "/graph" : "/board" });
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-4">
      <div className="flex items-center gap-2.5">
        <Logo size={28} />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Orchestra</p>
          <p className="max-w-48 truncate text-[11px] text-muted-foreground">{me.project.name}</p>
        </div>
      </div>
      <div className="mx-auto">
        <MilestoneStrip />
      </div>
      <div className="flex items-center gap-2">
        {me.capabilities.graph ? (
          <div className="hidden items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 xl:flex">
            <Switch
              id="company-view"
              checked={companyView}
              onCheckedChange={changeCompanyView}
              aria-label="Company view for startups"
            />
            <label htmlFor="company-view" className="cursor-pointer text-xs font-medium">Company view · for startups</label>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-5" aria-label="About Company view"><Info className="size-3.5" /></Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-72 leading-5">
                  For startups: see the whole company's progress at a glance. Every task, who's on it and what it costs. Progress only: no prompts or agent reports.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : null}
        <DemoControl me={me} />
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle dark mode">
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        {me.capabilities.graph ? (
          <Button
            variant={companyView ? "secondary" : "ghost"}
            size="icon"
            className="xl:hidden"
            onClick={() => changeCompanyView(!companyView)}
            aria-label={companyView ? "Turn off Company view" : "Turn on Company view"}
            title="Company view · for startups"
          >
            <Building2 className="size-4" />
          </Button>
        ) : null}
        <UserMenu me={me} />
      </div>
    </header>
  );
}
