"use client";

import { useFormStatus } from "react-dom";
import type { MouseEventHandler, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function SubmitButton({
  className,
  children,
  name,
  value,
  pendingLabel,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  name?: string;
  value?: string;
  pendingLabel?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      onClick={onClick}
      className={cn(className, pending && "opacity-70")}
      aria-busy={pending}
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" />
          {pendingLabel || children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
