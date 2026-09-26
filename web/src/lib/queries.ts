import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { api } from "./api";

/** Page data polls every 2s; the graph every 5s. Previous data stays on screen. */
const polling = (ms: number) =>
  ({
    refetchInterval: ms,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  }) as const;

export const meQuery = () =>
  queryOptions({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000, retry: false });

export const overviewQuery = () =>
  queryOptions({ queryKey: ["overview"], queryFn: api.overview, ...polling(2000) });

export const companyOverviewQuery = () =>
  queryOptions({ queryKey: ["overview"], queryFn: api.overview, ...polling(5000) });

export const tasksQuery = (filters: {
  status?: string | undefined;
  department?: string | undefined;
  person?: string | undefined;
  mine?: boolean;
}) =>
  queryOptions({
    queryKey: ["tasks", filters],
    queryFn: () => api.tasks(filters),
    ...polling(2000),
  });

export const companyTasksQuery = (filters: {
  status?: string | undefined;
  department?: string | undefined;
  person?: string | undefined;
  mine?: boolean;
}) =>
  queryOptions({
    queryKey: ["tasks", filters],
    queryFn: () => api.tasks(filters),
    ...polling(5000),
  });

export const taskQuery = (id: string) =>
  queryOptions({ queryKey: ["task", id], queryFn: () => api.task(id), ...polling(2000) });

export const companyTaskQuery = (id: string) =>
  queryOptions({ queryKey: ["task", id], queryFn: () => api.task(id), ...polling(5000) });

export const activityQuery = (filters: { via?: string | undefined; kind?: string | undefined; task?: string | undefined }) =>
  queryOptions({
    queryKey: ["activity", filters],
    queryFn: () => api.activity(filters),
    ...polling(2000),
  });

export const liveAgentsQuery = () =>
  queryOptions({ queryKey: ["agents-live"], queryFn: api.liveAgents, ...polling(2000) });

export const graphQuery = () =>
  queryOptions({ queryKey: ["graph"], queryFn: api.graph, ...polling(5000) });

export const kbQuery = (q: string) =>
  queryOptions({ queryKey: ["kb", q], queryFn: () => api.kb(q), placeholderData: keepPreviousData });

export const kbDocQuery = (id: string) =>
  queryOptions({ queryKey: ["kb", "doc", id], queryFn: () => api.kbDoc(id) });

export const agentKeyQuery = () =>
  queryOptions({ queryKey: ["agent-key"], queryFn: api.agentKey, staleTime: 10 * 60_000 });
