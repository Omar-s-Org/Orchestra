import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataSource, useSourceMonitor } from "@/hooks/use-data-source";
import { ApiError, api, getToken, setToken } from "@/lib/api";
import { DEMO_ACCOUNTS } from "@/lib/mock";

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
  const search = Route.useSearch();
  const next = search.next?.startsWith("/login") ? undefined : search.next;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useSourceMonitor();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
  // Pre-fill the project manager of whichever project the server has loaded (layla@lumen.test after a
  // reset). Replace an earlier pre-fill when the real list arrives, but never what the user typed.
  const pmEmail = (source === "live" && liveAccounts.isPending ? [] : accounts).find((a) => a.role === "pm")?.email;
  const prefilled = useRef("");
  useEffect(() => {
    if (!pmEmail) return;
    const previous = prefilled.current;
    prefilled.current = pmEmail;
    setEmail((current) => (current === "" || current === previous ? pmEmail : current));
  }, [pmEmail]);

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
              <p className="text-xs text-muted-foreground">AI agents, one live project</p>
            </div>
          </div>
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
                placeholder="name@company.com"
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
