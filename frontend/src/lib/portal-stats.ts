// Single source of truth for the headline portal counters.
// These are the authoritative figures for the portal and are used everywhere
// the numbers appear, so they only need changing in one place.
import { DATASETS, DATASET_CATEGORIES } from "@/data/any-site-reference/datasets";

/** Number of site-specific agents onboarded in the library. */
export const AGENT_COUNT = 830;

/** Distinct agent categories in the library. */
export const AGENT_CATEGORY_COUNT = 14;

/** Ready-made solutions available under Solutions (derived from the catalog). */
export const SOLUTION_COUNT = DATASETS.length;

/** Solution categories / verticals (derived from the catalog). */
export const SOLUTION_CATEGORY_COUNT = DATASET_CATEGORIES.length;

/** Back-compat aliases. */
export const SOLUTION_VERTICAL_COUNT = SOLUTION_CATEGORY_COUNT;
export const SOLUTION_TEMPLATE_COUNT = SOLUTION_COUNT;