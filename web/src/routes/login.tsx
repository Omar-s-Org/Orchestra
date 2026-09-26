import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/logo";
import { RoleBadge } from "@/components/role-badge";
import { SourcePill } from "@/components/source-pill";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataSource, useSourceMonitor } from "@/hooks/use-data-source";
import { ApiError, api, getToken, setToken } from "@/lib/api";
import { DEMO_ACCOUNTS, MOCK_PASSWORD } from "@/lib/mock";
import { cn } from "@/lib/utils";

type Search = { next?: string | undefined };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    next: typeof search["next"] === "string" ? search["next"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Orchestra" },
      { name: "description", content: "Sign in to Orchestra to follow your project and its AI agents live." },
      { property: "og:title", content: "Sign in — Orchestra" },
      {
        property: "og:description",
        content: "Sign in to Orchestra to follow your project and its AI agents live.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useSourceMonitor();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [openDemo, setOpenDemo] = useState(true);
  // Live: the accounts of whichever project the backend has loaded (Northwind, Lumen after Run demo…).
  const { source } = useDataSource();
  const liveAccounts = useQuery({
    queryKey: ["demo-accounts", source],
    queryFn: api.demoAccounts,
    enabled: source === "live",
    retry: false,
  });
  const accounts =
    source === "live" && liveAccounts.data?.length ? liveAccounts.data : DEMO_ACCOUNTS;

  // Already signed in: go straight to the landing page.
  useEffect(() => {
    if (getToken()) void navigate({ to: next ?? "/", replace: true });
  }, [navigate, next]);

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: async (data) => {
      setToken(data.token);
      queryClient.clear();
      toast.success(`Signed in as ${data.user.name}`);
      await navigate({ to: next ?? "/", replace: true });
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "Could not sign in";
      if (error instanceof ApiError && error.status === 403) {
        toast.warning(message);
      } else {
        toast.error(message);
      }
    },
  });

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />

      <div className="relative w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={34} />
            <div className="leading-tight">
              <p className="text-base font-semibold tracking-tight">Orchestra</p>
              <p className="text-xs text-muted-foreground">Northwind Launch</p>
            </div>
          </div>
          <SourcePill />
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-float">
          <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Follow your project while every agent reports its progress.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!email || !password) {
                toast.error("Enter your email and password");
                return;
              }
              login.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@northwind.test"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Sign in
            </Button>
          </form>

          <Collapsible open={openDemo} onOpenChange={setOpenDemo} className="mt-5 border-t pt-4">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium">
              Demo accounts
              <ChevronDown
                className={cn("size-4 text-muted-foreground transition-transform", openDemo && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Password for every account: <code className="rounded bg-muted px-1 py-0.5">{MOCK_PASSWORD}</code>
              </p>
              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {accounts.map((account) => (
                  <li key={account.email}>
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(MOCK_PASSWORD);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-surface"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{account.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {account.email} · {account.department}
                        </span>
                      </span>
                      <RoleBadge role={account.role} short />
                    </button>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <p className="mt-6 flex justify-center">
          <span className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            Demo data · Open source (MIT)
          </span>
        </p>
      </div>
    </main>
  );
}
