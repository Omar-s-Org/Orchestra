<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Orchestra architecture rules

- Routing is TanStack Router (file-based in `src/routes/`); React Router cannot be installed on this stack, so section 10's routes, `?task=` drawer and `?next=` login redirect are implemented with it.
- Every network call goes through `src/lib/api.ts`; no component calls `fetch` directly, so token, error shape, 401 handling and mock switching stay in one place.
- `src/lib/mock.ts` is a full in-memory backend keyed by the same paths and query filters as the real API, so mock and live differ only in transport.
- Shared query options with polling intervals live in `src/lib/queries.ts` so every screen polls consistently (2s pages, 5s graph) and keeps previous data.
- Company view is a PM-capability-gated, localStorage-enabled projection of existing task/overview endpoints; it polls every 5s and never renders agent-authored content.
- Company task creation is a visual-only in-memory preview; it never calls or implies a backend write because no creation endpoint exists.
- No backend integrations (Cloud/Supabase/auth providers): the app is frontend-only against an external Express API.
