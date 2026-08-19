import { useSyncExternalStore } from "react";
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
