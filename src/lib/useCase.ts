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
    tagline: "Trusted sites, tuned agents, refreshed on your schedule.",
  },
  openweb: {
    id: "openweb" as const,
    name: "Solutions",
    short: "Solutions",
    tagline: "Pick a category, get company sites plus curated third-party sources.",
  },
  discovery: {
    id: "discovery" as const,
    name: "Ask Freda",
    short: "Ask Freda",
    tagline: "Not sure what you need? Answer a few questions and get a solution.",
  },
};

