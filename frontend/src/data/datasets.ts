// Dataset type definitions for the vertical datasets

export type DatasetField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "date" | "url" | "email";
  role: "input" | "output";
  group?: string;
  required?: boolean;
};

export type DatasetSource = {
  name: string;
  url: string;
  kind: "Company website" | "Third-party" | "Directory" | "Regulator" | "Marketplace";
  attributes: number;
  region?: string;
};

export type Dataset = {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  icon: string;
  refreshDefault: string;
  refreshOptions: string[];
  rowsAvailable: string;
  coverage: number;
  accuracy: number;
  countriesCovered: number;
  inputAttributes: DatasetField[];
  inputTemplateColumns: DatasetField[];
  outputAttributes: DatasetField[];
  sources: DatasetSource[];
  workflowId: string;
  sampleRow: Record<string, any>;
};

// Mock datasets for the onboarded lookup
export const DATASETS: Dataset[] = [
  {
    id: "healthcare-mock",
    name: "Healthcare Providers",
    category: "Healthcare",
    tagline: "Hospitals and clinics",
    description: "Mock dataset for healthcare providers",
    icon: "Stethoscope",
    refreshDefault: "Weekly",
    refreshOptions: ["Daily", "Weekly", "Monthly"],
    rowsAvailable: "1000+",
    coverage: 90,
    accuracy: 95,
    countriesCovered: 1,
    inputAttributes: [],
    inputTemplateColumns: [],
    outputAttributes: [],
    sources: [
      {
        name: "Practo",
        url: "practo.com",
        kind: "Third-party",
        attributes: 20,
      },
    ],
    workflowId: "mock-workflow",
    sampleRow: {},
  },
];
// Dataset categories for filtering
export const DATASET_CATEGORIES = [
  "Healthcare",
  "Hospitality", 
  "Legal",
  "Insurance",
  "Automotive",
  "Technology",
  "Finance",
  "Retail",
  "Manufacturing"
];