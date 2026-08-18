// Shared ticket store — requests raised by workspace users, visible to admin.
// Persisted in localStorage so the admin console can see what users submitted.
import { useSyncExternalStore } from "react";

export type TicketType = "New project" | "Add source" | "Remove source" | "Datapoint change";
export type TicketStatus = "Estimating" | "Awaiting admin approval" | "Approved" | "In build" | "Rejected";

export type Ticket = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  project: string;
  type: TicketType;
  detail: string;
  raisedBy: string;
  createdAt: string;
  status: TicketStatus;
  estimateDays: number;
  monthlyRecords?: number;
  sources: string[];
  datapoints: string[];
  fileName?: string;
};

const KEY = "freda_tickets_v1";
const listeners = new Set<() => void>();
let cache: Ticket[] | null = null;
const EMPTY: Ticket[] = [];

function persist(next: Ticket[]) {
  cache = next;
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

function read(): Ticket[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Ticket[]) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

export function useTickets(): Ticket[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => EMPTY,
  );
}

export function nextTicketId() {
  return `REQ-${2400 + read().length + 1}`;
}

export function addTicket(t: Omit<Ticket, "id" | "createdAt" | "status"> & { status?: TicketStatus }): Ticket {
  const ticket: Ticket = {
    ...t,
    id: nextTicketId(),
    createdAt: new Date().toISOString(),
    status: t.status ?? "Awaiting admin approval",
  };
  persist([ticket, ...read()]);
  return ticket;
}

export function setTicketStatus(id: string, status: TicketStatus) {
  persist(read().map((t) => (t.id === id ? { ...t, status } : t)));
}

export function clearTickets() {
  persist([]);
}
