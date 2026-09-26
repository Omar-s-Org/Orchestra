# Orchestra Live

Build a frontend-only React + TypeScript + Tailwind + shadcn/ui app called Orchestra.
There is NO backend yet. Everything must work in mock mode by default.

HARD RULES (do not break these):
- Do NOT enable Lovable Cloud, Supabase, any database, any auth provider, or any GitHub API connector.
- All API calls go through src/lib/api.ts using plain fetch, with a Bearer token from localStorage.token.
- Mock mode is built into the frontend: src/lib/mock.ts serves every endpoint with the exact shapes below.
  localStorage.mockMode = "auto" | "on" | "off", default "auto". In "auto", poll GET /api/health every 10s with a 2s timeout; if unreachable, serve mock data and show a MOCK pill in the top bar; if reachable, serve the real API and show a LIVE pill.
- Mock data must be rich, consistent with the Northwind demo (section 7), and must MUTATE slightly on each poll (live agent activity text changes, a new activity item appears) so the UI looks live offline.
- Implement mock role visibility exactly as specified: junior sees own + junior coworkers' tasks in their department; senior sees their department; PM sees everything. Mock login must accept the demo accounts with password demo1234 and produce mock tokens like mock:john.
- Do NOT compute permissions in the UI. Render action buttons only if the task's allowed_actions includes them; render nav items only from me.capabilities.
- Poll the current page's data every 2s; poll the graph every 5s. Keep previous data on screen while refetching (no flicker, no spinners after first load) using TanStack Query with placeholderData: keepPreviousData.
- Build in this order and STOP after each step for my review:
  1) Login + demo accounts list + session/token handling
  2) App shell (top bar with milestone strip, left nav, right rail Live agents, user menu, settings popover, dark mode toggle)
  3) Board (kanban + filters via URL query params + cost tiles when capabilities.cost)
  4) Task drawer (timeline, details, files tabs; approve/send back only when allowed)
  5) Activity feed
  6) Knowledge list + reader
  7) Review queue (senior/PM only)
  8) Graph (PM only) with react-force-graph-2d
- Use React Router with the routes in section 10. The task drawer is ?task=T-12 in the URL. Filters are query params. Auth guard redirects to /login?next=...
- Use sonner for toasts, date-fns for relative times, react-markdown + remark-gfm WITHOUT rehype-raw (no raw HTML), lucide-react for icons.
- Stack is fixed. Do not add extra libraries. Do not improvise defaults — sections 8 and 10 are the source of truth.
- If anything in the spec is ambiguous, ASK ME before inventing. Do not hallucinate endpoints, fields, or screens beyond what is in the spec.

Now build the app exactly as specified in the attached plan. Start with mock mode so every screen works without a backend.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/5b9509cc-5d57-4f24-92e7-58372124855f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
