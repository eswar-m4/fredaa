"use client";

import { useRef } from "react";
import type { FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ChatComposer({
  onQueued,
  pending = false,
}: {
  onQueued?: (text: string) => void;
  pending?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const value = inputRef.current?.value.trim() ?? "";
    if (!value) {
      event.preventDefault();
      return;
    }
    onQueued?.(value);
  }

  return (
    <form
      action="/chat"
      method="post"
      onSubmit={onSubmit}
      className="border-t bg-background/90 px-4 py-3 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <input
          ref={inputRef}
          type="text"
          name="message"
          autoComplete="off"
          enterKeyHint="send"
          readOnly={pending}
          placeholder="Describe the dataset, source, market, or refresh you need…"
          className="min-h-12 flex-1 rounded-lg border border-input bg-card px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 read-only:opacity-70"
          aria-label="Requirement"
        />
        <SubmitButton className={cn(buttonVariants({ size: "icon" }))} pendingLabel="">
          <ArrowUp className="size-4" />
          <span className="sr-only">Send</span>
        </SubmitButton>
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-[11px] text-muted-foreground">
        Press Enter to send. Freda will not invent Agents, Solutions, or source URLs.
      </p>
    </form>
  );
}
