const KEY = "companyView";
const EVENT = "orchestra:company-view";

export function getCompanyView(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "true";
}

export function setCompanyView(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: enabled }));
}

export function subscribeCompanyView(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
