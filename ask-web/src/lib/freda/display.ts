/** Remove catalog IDs from user-facing chat copy. Keep names only. */
export function stripCatalogIds(text: string): string {
  return text
    .replace(/\[(?:ds-[a-z0-9-]+|\d{1,4})\]/gi, "")
    .replace(/\b(?:agent|solution|source)\s+ids?\s*[:=]?\s*(?:ds-[a-z0-9-]+|\d+)\b/gi, "")
    .replace(/\bds-[a-z0-9]+(?:-[a-z0-9]+)*\b/gi, "")
    .replace(/\s+[—–-]\s+(?=[A-Z])/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[—–\-:\s]+/gm, "")
    .replace(/:\s+/g, ": ")
    .replace(/\b(?:and|,)\s*([.!?])/g, "$1")
    .trim();
}
