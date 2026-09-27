import { createFileRoute, Outlet } from "@tanstack/react-router";

import { Logo } from "@/components/logo";
import { LeftNav } from "@/components/shell/left-nav";
import { TaskDrawer } from "@/components/task-drawer";
import { TopBar } from "@/components/shell/top-bar";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useSourceMonitor } from "@/hooks/use-data-source";

/** Signed-in layout: top bar, left nav, page. Live agent activity shows on each task. All data is fetched in the browser. */
export const Route = createFileRoute("/_shell")({
  ssr: false,
  component: ShellLayout,
});

function ShellLayout() {
  const { me, ready } = useAuthGuard();
  useSourceMonitor();

  if (!ready || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
        <Logo size={30} />
        <span className="text-sm">Loading your workspace…</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar me={me} />
      <div className="flex min-h-0 flex-1">
        <LeftNav capabilities={me.capabilities} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <TaskDrawer />
    </div>
  );
}
