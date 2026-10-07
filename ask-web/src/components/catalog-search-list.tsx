"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AgentRecord } from "@/lib/catalog/types";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CatalogSearchList({
  agents,
}: {
  agents: AgentRecord[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents.slice(0, 80);
    return agents
      .filter((agent) =>
        [agent.name, agent.category, agent.country, agent.dataType, agent.industry, agent.sourceUrl]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 80);
  }, [agents, query]);

  return (
    <div className="flex flex-col gap-4">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search agents by name, country, category, or source"
        className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {agents.length} catalog agents
        {query ? ` matching “${query}”` : " (type to search the full 830)"}.
      </p>
      <ul className="divide-y rounded-xl border bg-card">
        {filtered.map((agent) => (
          <li key={`${agent.id}-${agent.project}-${agent.sourceUrl}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{agent.name}</p>
              <p className="text-xs text-muted-foreground">
                {agent.category}
                {agent.country ? ` · ${agent.country}` : ""} · {agent.dataType || agent.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {agent.complexity ? <Badge variant="outline">{agent.complexity}</Badge> : null}
              <Link href={`/agents/${agent.id}`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
                Open
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
