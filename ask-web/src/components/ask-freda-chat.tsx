"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Sparkles } from "lucide-react";
import { ChatComposer } from "@/components/chat-composer";
import { MessageCards } from "@/components/message-cards";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { stripCatalogIds } from "@/lib/freda/display";
import type { ChatSession } from "@/lib/freda/session";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "List of Tech companies in India with Address and phone number",
  "Show me hotels with pricing in India",
  "I need annual reports from BSE, NSE and company websites",
  "List the solution catalogue",
  "I want Amazon product pricing refreshed daily",
  "I need hospital information in India with doctors, specialties and services",
];

export function AskFredaChat({ session }: { session: ChatSession }) {
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const empty = session.turns.length === 0;
  const showWelcome = empty && !pendingUserText;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [pendingUserText, session.turns.length]);

  function queueUserMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPendingUserText(trimmed);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:py-10">
          {!empty ? (
            <form action="/chat" method="post" className="flex justify-end">
              <SubmitButton
                name="reset"
                value="1"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                New conversation
              </SubmitButton>
            </form>
          ) : null}

          <div className={cn("flex flex-col gap-6", !showWelcome && "hidden")}>
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="size-3.5" />
                Conversational discovery — not a questionnaire
              </p>
              <h1 className="font-heading mt-4 text-3xl tracking-tight text-foreground sm:text-4xl">
                What data do you need?
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Describe the requirement in plain English. Freda checks the F.R.E.D.A. catalog first,
                recommends what already exists, and only asks for details that are still missing.
              </p>
            </div>
            <form action="/chat" method="post" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <SubmitButton
                  key={suggestion}
                  name="suggestion"
                  value={suggestion}
                  onClick={() => queueUserMessage(suggestion)}
                  className="rounded-xl border bg-card px-4 py-3 text-left text-sm leading-5 transition-colors hover:border-primary/30 hover:bg-muted/60"
                >
                  {suggestion}
                </SubmitButton>
              ))}
            </form>
          </div>

          {!empty || pendingUserText ? (
            <>
              {session.turns.map((turn) => (
                <div key={turn.id} className={turn.role === "user" ? "ml-auto max-w-[90%] sm:max-w-[75%]" : "max-w-full"}>
                  {turn.role === "user" ? (
                    <UserBubble text={turn.text} />
                  ) : (
                    <div>
                      <p className="text-[11px] font-medium tracking-[0.14em] text-primary uppercase">Freda</p>
                      <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
                        {stripCatalogIds(turn.text)}
                      </div>
                      {turn.cards?.length ? <MessageCards cards={turn.cards} /> : null}
                    </div>
                  )}
                </div>
              ))}
              {pendingUserText ? (
                <>
                  <div className="ml-auto max-w-[90%] sm:max-w-[75%]">
                    <UserBubble text={pendingUserText} />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.14em] text-primary uppercase">Freda</p>
                    <p className="mt-1 text-sm text-muted-foreground">Checking the catalog…</p>
                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {session.error && !pendingUserText ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p>{session.error}</p>
                <form action="/chat" method="post">
                  <input type="hidden" name="message" value="Retry" />
                  <SubmitButton className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-1 h-7 px-0 text-destructive")}>
                    Try again
                  </SubmitButton>
                </form>
              </div>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <ChatComposer onQueued={queueUserMessage} pending={Boolean(pendingUserText)} />
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
      {text}
    </div>
  );
}
