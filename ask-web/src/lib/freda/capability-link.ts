/** Dataset setup in the live Freda product (Mythili-freda /any-site). */
export const USE_CAPABILITY_PATH = "/any-site";
/** Sources & Agents in the live Freda product (Mythili-freda /site-specific). */
export const USE_AGENT_PATH = "/site-specific";

export function useCapabilityHref(kind?: "solution" | "agent", id?: string): string {
  if (kind === "solution" && id) {
    return `${USE_CAPABILITY_PATH}?dataset=${encodeURIComponent(id)}`;
  }
  if (kind === "agent") {
    return id ? `${USE_AGENT_PATH}?agent=${encodeURIComponent(id)}` : USE_AGENT_PATH;
  }
  return USE_CAPABILITY_PATH;
}

export function useExistingPathOptions(
  solutions: { id: string; name?: string }[],
  useLabel = "Use this capability",
  agents: { id: string; name?: string }[] = [],
): { id: "use_existing"; label: string; href: string }[] {
  if (solutions.length === 1) {
    return [{ id: "use_existing", label: useLabel, href: useCapabilityHref("solution", solutions[0].id) }];
  }
  if (solutions.length > 1) {
    return solutions.map((solution) => ({
      id: "use_existing" as const,
      label: `Use ${solution.name || "this capability"}`,
      href: useCapabilityHref("solution", solution.id),
    }));
  }
  if (agents.length === 1) {
    return [{ id: "use_existing", label: useLabel, href: useCapabilityHref("agent", agents[0].id) }];
  }
  if (agents.length > 1) {
    return agents.map((agent) => ({
      id: "use_existing" as const,
      label: `Use ${agent.name || "this capability"}`,
      href: useCapabilityHref("agent", agent.id),
    }));
  }
  return [{ id: "use_existing", label: useLabel, href: useCapabilityHref() }];
}
