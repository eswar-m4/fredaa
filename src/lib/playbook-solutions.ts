import type { Customer } from "@/data/customers";

export type PlaybookSolution = {
  name: string;
  blurb: string;
  sources: number;
  datapoints: number;
};

export function solutionsFor(customer: Customer): PlaybookSolution[] {
  return [
    {
      name: `${customer.industry} core profile`,
      blurb: "Entity master with identity, location and classification fields kept continuously verified.",
      sources: 4,
      datapoints: 18,
    },
    {
      name: "Change & event monitoring",
      blurb: "Daily delta feed of added, deleted and modified records with confidence scoring.",
      sources: 6,
      datapoints: 12,
    },
    {
      name: "Contact & decision maker enrichment",
      blurb: "Role-level contacts appended to each verified entity, with pattern validation.",
      sources: 3,
      datapoints: 9,
    },
    {
      name: "Competitive pricing & offer watch",
      blurb: "Price, availability and promotion tracking across the sources you already run.",
      sources: 5,
      datapoints: 14,
    },
  ];
}
