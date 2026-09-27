/**
 * Backend base URLs. The first one is the default apiBase.
 * VITE_API_BASE overrides it (web/.env.development points local dev at http://localhost:8787).
 */
export const API_BASES = [
  import.meta.env["VITE_API_BASE"] || "https://orchestra-api-production-f275.up.railway.app",
] as const;
