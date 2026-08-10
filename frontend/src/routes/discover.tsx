import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Bot, Compass, FileText, Paperclip, Sparkles, ShieldCheck } from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Badge, Button, Card, Input } from "@/components/ui-bits";
import { setUseCase, USE_CASES } from "@/lib/useCase";

const PROMPTS = [
  "Top CRM companies in APAC",
  "Hospitals in Chennai with phone and address",
  "Hotel tariffs across booking sites",
  "Attorney directory for Tier 2 cities",
  "Refresh my product price sheet",
];

export const Route = createFileRoute("/discover")({
  head: () => ({
    meta: [
      { title: "Freda AI - FreshData AI" },
      {
        name: "description",
        content: "Ask Freda AI for a solution and it proposes sources, workflow, volume and timeline.",
      },
    ],
  }),
  component: Discover,
});

function Discover() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");

  return (
    <AppLayout>
      <div className="px-7 pb-8 pt-7 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight">Freda AI</h1>
            <p className="text-[13px] text-muted-foreground mt-1 max-w-3xl">
              Answer a few questions and Freda proposes the sources, workflow, volume and timeline for your data solution.
            </p>
          </div>
          <Badge tone="purple" className="rounded-full px-3 py-1.5 shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
            Solution discovery
          </Badge>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-5 items-start">
          <div className="space-y-5">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border/70">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-md bg-violet-100 text-violet-700 flex items-center justify-center">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">Freda AI consultant</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground whitespace-nowrap">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  0% of the interview
                </div>
              </div>

              <div className="px-5 py-5">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-md bg-secondary flex items-center justify-center shrink-0">
                    <Bot className="h-4.5 w-4.5 text-muted-foreground" />
                  </div>
                  <div className="max-w-2xl rounded-2xl bg-slate-100/80 dark:bg-secondary/60 px-4 py-4 text-[15px] leading-7 text-foreground">
                    I&apos;m Freda. Tell me the data you&apos;re after in one line - or drop a file you want refreshed - and I&apos;ll ask a few quick questions, then propose the sources, workflow, volume and timeline.
                    <div className="mt-3 text-[12px] leading-6 text-muted-foreground">
                      Publicly available sources only. I propose a solution; I don&apos;t quote prices or SLAs.
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 border-t border-border/70 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {PROMPTS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPrompt(item)}
                      className="h-9 rounded-full border border-input bg-card px-4 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground transition"
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <div className="flex items-end gap-3">
                  <button
                    type="button"
                    className="h-12 w-12 shrink-0 rounded-lg border border-input bg-card text-foreground hover:bg-secondary transition inline-flex items-center justify-center"
                    aria-label="Attach file"
                  >
                    <Paperclip className="h-4.5 w-4.5" />
                  </button>
                  <Input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g. top CRM companies in APAC with pricing tiers..."
                    className="h-14 text-[15px] rounded-lg"
                  />
                  <Button
                    className="h-12 px-5 rounded-lg"
                    onClick={() => {
                      setUseCase("discovery");
                      navigate({ to: "/discover" });
                    }}
                  >
                    <ArrowRight className="h-4 w-4 rotate-45" />
                    Start
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                What Freda will and won&apos;t do
              </div>
              <div className="mt-4 space-y-3 text-[14px] leading-6 text-foreground">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="h-4.5 w-4.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Publicly available sources only - no logins, paywalls or personal data.</span>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="h-4.5 w-4.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Freda proposes a solution; it does not quote binding prices or SLAs.</span>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="h-4.5 w-4.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>If a source can&apos;t be confirmed, Freda says so instead of guessing.</span>
                </div>

                <div className="rounded-xl border border-amber-300/60 bg-amber-50/70 px-4 py-4">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 h-5 w-5 rounded-full border border-amber-500/60 text-amber-700 inline-flex items-center justify-center shrink-0">
                      <FileText className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-foreground">Scraping terms - quick heads-up</div>
                      <p className="text-[13px] leading-6 text-muted-foreground mt-1">
                        We only collect publicly accessible pages, honour each site&apos;s robots.txt and rate limits, and never touch logged-in or paywalled content or personal data. Extracted values are stored with their source URL and timestamp so every field can be traced back and re-verified. You remain responsible for how the output is used under the source site&apos;s terms of use and applicable data-protection law.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <Card className="min-h-[186px] p-0 overflow-hidden">
            <div className="h-full min-h-[186px] flex items-center justify-center px-6 py-8 text-center">
              <div className="max-w-lg">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full border-4 border-slate-400/80 text-slate-500 flex items-center justify-center">
                  <Compass className="h-5 w-5" />
                </div>
                <div className="text-[16px] font-semibold">No requirement yet</div>
                <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                  Describe the data you need or attach a file. Freda then runs three short batches of questions and drafts the solution here.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
