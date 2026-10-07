"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, ClipboardCheck, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatCard } from "@/lib/freda/types";
import { cn } from "@/lib/utils";
import { useCapabilityHref } from "@/lib/freda/capability-link";
import { SubmitButton } from "@/components/submit-button";

export function MessageCards({
  cards,
}: {
  cards: ChatCard[];
}) {
  const capabilityHref = hrefForUseCapability(cards);
  return (
    <div className="mt-3 flex flex-col gap-3">
      {cards.map((card, index) => (
        <Card key={`${card.type}-${index}`} size="sm" className="bg-white/90">
          {card.title ? (
            <CardHeader className="pb-0">
              <CardTitle>{card.title}</CardTitle>
              {card.body ? <CardDescription>{card.body}</CardDescription> : null}
            </CardHeader>
          ) : null}
          <CardContent className="flex flex-col gap-3">
            {card.type === "capabilities" ? (
              <div className="flex flex-col gap-2">
                {card.agents?.map((agent) => (
                  <div
                    key={`a-${agent.id}-${agent.project}`}
                    className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>Agent</Badge>
                        <p className="font-medium">{agent.name}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {agent.category}
                        {agent.country ? ` · ${agent.country}` : ""} · {agent.dataType || agent.description}
                      </p>
                      {agent.reasons[0] ? (
                        <p className="mt-1 text-xs text-muted-foreground">{agent.reasons[0]}</p>
                      ) : null}
                    </div>
                    <Link
                      href={useCapabilityHref("agent", agent.id)}
                      className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
                    >
                      Use this capability
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </div>
                ))}
                {card.solutions?.map((solution) => (
                  <div
                    key={solution.id}
                    className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">Solution</Badge>
                        <p className="font-medium">{solution.name}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{solution.tagline}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {solution.coverage ? `${solution.coverage}% coverage for this Solution` : ""}
                        {solution.refreshCadence ? ` · Default refresh ${solution.refreshCadence}` : ""}
                        {solution.sourceCount ? ` · ${solution.sourceCount} sources` : ""}
                      </p>
                    </div>
                    <Link
                      href={useCapabilityHref("solution", solution.id)}
                      className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
                    >
                      Use this capability
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </div>
                ))}
              </div>
            ) : null}

            {card.type === "gaps" ? (
              <ul className="space-y-2">
                {card.gaps?.map((gap) => (
                  <li key={gap.detail} className="flex gap-2 text-sm">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
                    <span>
                      <span className="font-medium capitalize">{gap.field.replace("-", " ")}: </span>
                      {gap.detail}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {card.type === "questions" ? (
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {card.questions?.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            ) : null}

            {card.type === "choice_question" ? <ChoiceQuestionForm card={card} /> : null}

            {(card.type === "summary" || (card.type === "capabilities" && card.summary)) && card.summary ? (
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {Object.entries(card.summary).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
                    <dd className="mt-0.5">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {card.type === "estimate" && card.estimate ? (
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <p><span className="text-muted-foreground">Volume: </span>{card.estimate.volume}</p>
                <p><span className="text-muted-foreground">Timeline: </span>{card.estimate.timeline}</p>
                <p><span className="text-muted-foreground">Refresh: </span>{card.estimate.refresh}</p>
                <p><span className="text-muted-foreground">Market: </span>{card.estimate.geography}</p>
                <p className="sm:col-span-2"><span className="text-muted-foreground">Sources: </span>{card.estimate.sources.join("; ")}</p>
                <p className="sm:col-span-2"><span className="text-muted-foreground">Attributes: </span>{card.estimate.attributes.join("; ")}</p>
                <ul className="sm:col-span-2 list-disc pl-4 text-xs text-muted-foreground">
                  {card.estimate.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {card.type === "job" && card.job ? (
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    <ClipboardCheck className="size-4" />
                    {card.job.id}
                  </p>
                  <p className="text-muted-foreground">{card.job.status} · {card.job.title}</p>
                </div>
                <a href="/product-monitoring" className={cn(buttonVariants({ size: "sm" }))}>
                  <Radio className="size-3.5" />
                  Open Monitoring
                </a>
              </div>
            ) : null}

            {card.type === "sources" ? (
              <ul className="space-y-2 text-sm">
                {card.sources?.map((source) => (
                  <li key={`${source.solutionId}-${source.name}`} className="rounded-md border p-2">
                    <p className="font-medium">{source.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {source.kind || "Catalog source"}
                      {source.region ? ` · ${source.region}` : ""}
                      {source.url ? ` · ${source.url}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            {card.type === "metadata" && card.metadata ? (
              <div className="flex flex-col gap-3">
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {card.metadata.rows.map((row) => (
                    <div key={row.label} className="rounded-md bg-muted/50 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className="text-sm">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                {card.metadata.solutions?.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {card.metadata.solutions.map((solution) => (
                      <li key={solution.id}>
                        <Link href={`/solutions/${solution.id}`} className="font-medium hover:underline">
                          {solution.name}
                        </Link>
                        <span className="text-muted-foreground"> · {solution.category} · {solution.tagline}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {card.options?.length ? (
              <div className="flex flex-wrap gap-2">
                {card.options.map((option, optionIndex) =>
                  option.id === "use_existing" ? (
                    <a
                      key={`${option.id}-${option.href || option.label}-${optionIndex}`}
                      href={option.href || capabilityHref}
                      className={cn(buttonVariants({ size: "sm" }))}
                    >
                      {option.label}
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  ) : (
                    <form action="/chat" method="post" key={`${option.id}-${optionIndex}`}>
                      <SubmitButton
                        name="action"
                        value={option.id}
                        className={cn(
                          buttonVariants({
                            size: "sm",
                            variant: option.id === "confirm" || option.id === "submit_job" ? "default" : "outline",
                          }),
                        )}
                      >
                        {option.label}
                      </SubmitButton>
                    </form>
                  ),
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function isAllAvailableFields(value: string) {
  return /^all available fields$/i.test(value.trim());
}

function ChoiceQuestionForm({ card }: { card: ChatCard }) {
  const choices = card.choices || [];
  const [picked, setPicked] = useState<string[]>(() => {
    const initial = (card.selected || []).filter((item) =>
      choices.some((choice) => choice.toLowerCase() === item.toLowerCase()),
    );
    return initial.some((item) => isAllAvailableFields(item))
      ? initial.filter((item) => isAllAvailableFields(item))
      : initial;
  });
  const [other, setOther] = useState("");
  const allFieldsSelected = picked.some((item) => isAllAvailableFields(item));

  function toggle(choice: string, checked: boolean) {
    if (isAllAvailableFields(choice)) {
      setPicked(checked ? [choice] : []);
      if (checked) setOther("");
      return;
    }
    if (allFieldsSelected) return;
    setPicked((current) => (checked ? [...current, choice] : current.filter((item) => item !== choice)));
  }

  const submitted = allFieldsSelected ? ["All available fields"] : [...picked, other.trim()].filter(Boolean);

  return (
    <form action="/chat" method="post" className="flex flex-col gap-3">
      <input type="hidden" name="action" value="answer_question" />
      {card.multi
        ? submitted.map((value) => <input key={value} type="hidden" name="choice" value={value} />)
        : null}
      <fieldset className="flex flex-col gap-2">
        {choices.map((choice) => {
          const selected = picked.some((item) => item.toLowerCase() === choice.toLowerCase());
          const lockedOut = Boolean(card.multi) && allFieldsSelected && !isAllAvailableFields(choice);
          return (
            <label
              key={choice}
              className={cn(
                "flex items-start gap-2 rounded-md px-1 py-0.5 text-sm",
                lockedOut ? "cursor-default opacity-50" : "cursor-pointer hover:bg-muted/60",
              )}
            >
              <input
                type={card.multi ? "checkbox" : "radio"}
                name={card.multi ? undefined : "choice"}
                value={choice}
                checked={card.multi ? selected : undefined}
                defaultChecked={card.multi ? undefined : selected}
                disabled={lockedOut}
                onChange={(event) => {
                  if (card.multi) toggle(choice, event.target.checked);
                  else setPicked([choice]);
                }}
                className="mt-1 size-4 accent-primary"
              />
              <span>{choice}</span>
            </label>
          );
        })}
      </fieldset>
      {card.multi && allFieldsSelected ? (
        <p className="text-xs text-muted-foreground">
          All available fields covers every option. Clear it to pick individual fields.
        </p>
      ) : null}
      {card.allowOther !== false ? (
        <input
          type="text"
          name={allFieldsSelected ? undefined : "choice_other"}
          value={other}
          disabled={allFieldsSelected}
          onChange={(event) => setOther(event.target.value)}
          placeholder="Other — type your own answer"
          className="min-h-10 rounded-lg border border-input bg-card px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
      ) : null}
      <SubmitButton className={cn(buttonVariants({ size: "sm" }), "self-start")}>Continue</SubmitButton>
    </form>
  );
}

function hrefForUseCapability(cards: ChatCard[]): string {
  const cap = cards.find((card) => card.type === "capabilities");
  const solution = cap?.solutions?.[0];
  const agent = cap?.agents?.[0];
  if (solution) return useCapabilityHref("solution", solution.id);
  if (agent) return useCapabilityHref("agent", agent.id);
  return useCapabilityHref();
}
