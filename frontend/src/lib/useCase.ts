import { useSyncExternalStore } from "react";

export type UseCase = "targeted" | "openweb" | "discovery" | null;

const KEY = "fd_use_case";
const listeners = new Set<() => void>();

function read(): UseCase {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(KEY);
  return v === "targeted" || v === "openweb" || v === "discovery" ? v : null;
}

export function setUseCase(uc: UseCase) {
  if (typeof window === "undefined") return;
  if (uc) window.localStorage.setItem(KEY, uc);
  else window.localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export function useUseCase(): UseCase {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );
}

export const USE_CASES = {
  targeted: {
    id: "targeted" as const,
    name: "Agents",
    short: "Agents",
    tagline: "Pick from already-onboarded sources, or add a new one. Refresh on schedule.",
  },
  openweb: {
    id: "openweb" as const,
    name: "Solutions",
    short: "Solutions",
    tagline: "Tell us the attributes. AI finds them across the open web and chains the workflows.",
  },
  discovery: {
    id: "discovery" as const,
    name: "Freda AI",
    short: "Freda AI",
    tagline: "Describe what you need or drop a file. The assistant finds the sources and the plan.",
  },
};
