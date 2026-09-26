import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, LogOut, Plug, Settings } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/role-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDataSource } from "@/hooks/use-data-source";
import { useSignOut } from "@/hooks/use-sign-out";
import { getApiBase, setApiBase, setMockMode, type MockMode } from "@/lib/api";
import { initials } from "@/lib/format";
import { agentKeyQuery } from "@/lib/queries";
import type { Me } from "@/lib/types";

export function UserMenu({ me }: { me: Me }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const signOut = useSignOut();

  return (
    <>
      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PopoverAnchor asChild>
          <div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
                    {initials(me.user.name)}
                  </span>
                  <span className="hidden text-left leading-tight md:block">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {me.user.name} <RoleBadge role={me.user.role} short />
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{me.user.department}</span>
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium">{me.user.name}</p>
                  <p className="text-xs text-muted-foreground">{me.user.title}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setConnectOpen(true)}>
                  <Plug className="size-4" /> Connect your agent
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setSettingsOpen(true), 0)}>
                  <Settings className="size-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut className="size-4" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </PopoverAnchor>
        <PopoverContent align="end" className="w-80">
          <SettingsForm onDone={() => setSettingsOpen(false)} />
        </PopoverContent>
      </Popover>
      <ConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  );
}

function SettingsForm({ onDone }: { onDone: () => void }) {
  const { mode } = useDataSource();
  const [base, setBase] = useState(getApiBase);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setApiBase(base);
        toast.success("API URL saved");
        onDone();
      }}
    >
      <h3 className="text-sm font-semibold">Settings</h3>
      <div className="space-y-1.5">
        <Label htmlFor="api-base">API URL</Label>
        <Input id="api-base" value={base} onChange={(e) => setBase(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Mock mode</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(v) => v && setMockMode(v as MockMode)}
          className="w-full"
        >
          <ToggleGroupItem value="auto" className="flex-1">Auto</ToggleGroupItem>
          <ToggleGroupItem value="on" className="flex-1">On</ToggleGroupItem>
          <ToggleGroupItem value="off" className="flex-1">Off</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Button type="submit" size="sm" className="w-full">Save</Button>
    </form>
  );
}

function ConnectAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, error } = useQuery({ ...agentKeyQuery(), enabled: open });
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!data) return;
    await navigator.clipboard.writeText(data.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect your agent</DialogTitle>
          <DialogDescription>Your agent updates tasks through MCP; this page updates live.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg border bg-muted p-3 pr-12 font-mono text-xs whitespace-pre-wrap break-all">
              {data?.command ?? "Loading…"}
            </pre>
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-1.5 right-1.5 size-8"
              onClick={() => void copy()}
              disabled={!data}
              aria-label="Copy command"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
