import { useEffect, useState, useSyncExternalStore } from "react";
import { CUSTOMERS, getCustomer, type Customer } from "@/data/customers";

const KEY = "freda_customer";
const listeners = new Set<() => void>();

function read(): string {
  if (typeof window === "undefined") return CUSTOMERS[0]!.id;
  const v = window.localStorage.getItem(KEY);
  return CUSTOMERS.some((c) => c.id === v) ? (v as string) : CUSTOMERS[0]!.id;
}

export function setActiveCustomer(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, id);
  listeners.forEach((l) => l());
}

export function useActiveCustomerId(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => CUSTOMERS[0]!.id,
  );
}

export function useActiveCustomer(): Customer {
  return getCustomer(useActiveCustomerId());
}

// The server (and the very first client paint, to avoid a hydration
// mismatch) always render CUSTOMERS[0] here, since localStorage isn't
// readable until the browser has mounted. If a different workspace was
// last selected, the next render corrects it — visible as a flash of the
// wrong workspace's name/projects for a frame. Pages that show
// customer-dependent content should gate on this and render a lightweight
// placeholder until mounted, so that "wrong" render never paints at all.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
