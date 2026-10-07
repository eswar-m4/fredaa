import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { initialState, type ChatCard, type ConversationState } from "./types";

const DIR = path.join(process.cwd(), "data", "sessions");

export type ChatTurn = {
  id: string;
  role: "user" | "freda";
  text: string;
  cards?: ChatCard[];
};

export type ChatSession = {
  state: ConversationState;
  turns: ChatTurn[];
  error?: string | null;
};

export function emptySession(): ChatSession {
  return { state: initialState(), turns: [], error: null };
}

function sessionPath(id: string) {
  return path.join(DIR, `${id}.json`);
}

export async function readSession(): Promise<{ id: string | null; data: ChatSession }> {
  const jar = await cookies();
  const id = jar.get("freda_sid")?.value ?? null;
  if (!id) return { id: null, data: emptySession() };
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath(id), "utf8")) as ChatSession;
    return { id, data: parsed };
  } catch {
    return { id, data: emptySession() };
  }
}

export async function writeSession(id: string | null, data: ChatSession): Promise<string> {
  fs.mkdirSync(DIR, { recursive: true });
  const sid = id || randomBytes(12).toString("hex");
  fs.writeFileSync(sessionPath(sid), JSON.stringify(data));
  const jar = await cookies();
  jar.set("freda_sid", sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return sid;
}
