export type ReviewRowStatus = "approved" | "rejected" | "auto";

export type ReviewSummarySlice = {
  key: string;
  label: string;
  coverage?: number | null;
  reviewed: number;
  approved: number;
  rejected: number;
  accuracy?: number | null;
  detail?: string;
  items?: string[];
  total?: number | null;
};

export type ReviewSummary = {
  updatedAt: string;
  overall: {
    reviewed: number;
    approved: number;
    rejected: number;
    accuracy?: number | null;
  };
  sourceBreakdown: ReviewSummarySlice[];
  attributeBreakdown: ReviewSummarySlice[];
};

type CoverageRow = {
  source_key?: string;
  source_label?: string;
  records_requested_from_source?: number;
  records_returned_by_source?: number;
  source_coverage?: number | null;
  filled_attributes?: number;
  filled_fields?: Array<{ attribute_key?: string }>;
  attribute_key?: string;
  attribute_label?: string;
  non_null_values?: number;
  total_records_in_scope?: number;
  attr_coverage?: number | null;
};

type CoverageLike = {
  source_breakdown?: CoverageRow[];
  attribute_breakdown?: CoverageRow[];
} | null | undefined;

type ReviewRowLike = {
  source?: string;
  sourceUrl?: string;
  source_label?: string;
  source_key?: string;
  attribute?: string;
  attributeKey?: string;
  attribute_label?: string;
  recordIndex?: number;
  id?: string;
};

type ReviewStatusMap = Record<string, ReviewRowStatus | undefined>;

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function labelFromValue(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function accuracyFromCounts(approved: number, rejected: number) {
  const reviewed = approved + rejected;
  if (!reviewed) return null;
  return approved / reviewed;
}

function collectStatusCounts(
  rows: ReviewRowLike[],
  rowStatus: ReviewStatusMap,
  scope: "source" | "attribute",
) {
  const buckets = new Map<
    string,
    {
      key: string;
      label: string;
      approved: number;
      rejected: number;
      reviewed: number;
      items: Set<string>;
    }
  >();

  for (const row of rows) {
    const status = rowStatus[String(row.id ?? "")];
    if (!status) continue;

    const rawKey =
      scope === "source"
        ? row.source_key || row.source || row.source_label || row.sourceUrl
        : row.attributeKey || row.attribute_label || row.attribute;
    const key = normalizeKey(rawKey);
    if (!key) continue;

    const label =
      scope === "source"
        ? labelFromValue(row.source_label || row.source || row.sourceUrl || rawKey, "Unknown source")
        : labelFromValue(row.attribute_label || row.attribute || rawKey, "Unknown attribute");

    const existing = buckets.get(key) || {
      key,
      label,
      approved: 0,
      rejected: 0,
      reviewed: 0,
      items: new Set<string>(),
    };

    existing.reviewed += 1;
    existing.items.add(String(row.attributeKey || row.attribute || row.source || row.sourceUrl || ""));
    if (status === "rejected") {
      existing.rejected += 1;
    } else {
      existing.approved += 1;
    }
    buckets.set(key, existing);
  }

  return buckets;
}

function mergeCoverageIntoSlices(
  slices: Array<{
    key: string;
    label: string;
    coverage?: number | null;
    reviewed: number;
    approved: number;
    rejected: number;
    items?: string[];
    total?: number | null;
    detail?: string;
  }>,
  coverageRows: CoverageRow[] | undefined,
  scope: "source" | "attribute",
) {
  const lookup = new Map<string, CoverageRow>();
  (coverageRows || []).forEach((row) => {
    const key =
      scope === "source"
        ? normalizeKey(row.source_key || row.source_label)
        : normalizeKey(row.attribute_key || row.attribute_label);
    if (key) lookup.set(key, row);
  });

  return slices.map((slice) => {
    const coverageRow = lookup.get(normalizeKey(slice.key)) || lookup.get(normalizeKey(slice.label));
    if (!coverageRow) {
      return {
        ...slice,
        accuracy: accuracyFromCounts(slice.approved, slice.rejected),
      };
    }

    const detail =
      scope === "source"
        ? [
            typeof coverageRow.records_returned_by_source === "number" && typeof coverageRow.records_requested_from_source === "number"
              ? `${coverageRow.records_returned_by_source.toLocaleString()} / ${coverageRow.records_requested_from_source.toLocaleString()} records`
              : "",
            coverageRow.filled_fields?.length
              ? `Top filled: ${coverageRow.filled_fields
                  .slice(0, 4)
                  .map((field) => String(field.attribute_key || "").replace(/_/g, " "))
                  .filter(Boolean)
                  .join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : [
            typeof coverageRow.non_null_values === "number" && typeof coverageRow.total_records_in_scope === "number"
              ? `${coverageRow.non_null_values.toLocaleString()} / ${coverageRow.total_records_in_scope.toLocaleString()} filled`
              : "",
          ]
            .filter(Boolean)
            .join(" · ");

    return {
      ...slice,
      coverage:
        scope === "source"
          ? coverageRow.source_coverage ?? slice.coverage ?? null
          : coverageRow.attr_coverage ?? slice.coverage ?? null,
      accuracy: accuracyFromCounts(slice.approved, slice.rejected),
      total:
        scope === "source"
          ? coverageRow.records_requested_from_source ?? slice.total ?? null
          : coverageRow.total_records_in_scope ?? slice.total ?? null,
      detail: detail || slice.detail,
      items:
        scope === "source"
          ? (coverageRow.filled_fields || []).map((field) => String(field.attribute_key || "").replace(/_/g, " ")).filter(Boolean)
          : slice.items,
    };
  });
}

function sortSliceList(slices: ReviewSummarySlice[]) {
  return [...slices].sort((a, b) => {
    const aMetric = a.accuracy ?? a.coverage ?? -1;
    const bMetric = b.accuracy ?? b.coverage ?? -1;
    if (bMetric !== aMetric) return bMetric - aMetric;
    return a.label.localeCompare(b.label);
  });
}

export function buildReviewSummary(
  rows: ReviewRowLike[],
  rowStatus: ReviewStatusMap,
  coverage?: CoverageLike,
): ReviewSummary {
  const sourceCounts = collectStatusCounts(rows, rowStatus, "source");
  const attributeCounts = collectStatusCounts(rows, rowStatus, "attribute");

  const sourceBreakdown = mergeCoverageIntoSlices(
    [...sourceCounts.values()].map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      reviewed: bucket.reviewed,
      approved: bucket.approved,
      rejected: bucket.rejected,
      items: Array.from(bucket.items).filter(Boolean),
    })),
    coverage?.source_breakdown,
    "source",
  );

  const attributeBreakdown = mergeCoverageIntoSlices(
    [...attributeCounts.values()].map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      reviewed: bucket.reviewed,
      approved: bucket.approved,
      rejected: bucket.rejected,
      items: Array.from(bucket.items).filter(Boolean),
    })),
    coverage?.attribute_breakdown,
    "attribute",
  );

  const overallApproved = rows.reduce((count, row) => {
    const status = rowStatus[String(row.id ?? "")];
    return count + ((status === "approved" || status === "auto") ? 1 : 0);
  }, 0);
  const overallRejected = rows.reduce((count, row) => {
    const status = rowStatus[String(row.id ?? "")];
    return count + (status === "rejected" ? 1 : 0);
  }, 0);

  return {
    updatedAt: new Date().toISOString(),
    overall: {
      reviewed: overallApproved + overallRejected,
      approved: overallApproved,
      rejected: overallRejected,
      accuracy: accuracyFromCounts(overallApproved, overallRejected),
    },
    sourceBreakdown: sortSliceList(sourceBreakdown),
    attributeBreakdown: sortSliceList(attributeBreakdown),
  };
}

