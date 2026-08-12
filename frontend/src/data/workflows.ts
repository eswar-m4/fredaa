// Workflow definitions for datasets

export type Workflow = {
  id: string;
  name: string;
  description: string;
  steps: string[];
};

export const WORKFLOWS: Workflow[] = [
  {
    id: "wf-company-profile",
    name: "Company Profile Enrichment",
    description: "Standard workflow for enriching company profiles with firmographic data",
    steps: [
      "Input company list",
      "Fetch public pages", 
      "Extract company data",
      "Validate and normalize",
      "Export enriched dataset"
    ]
  },
  {
    id: "wf-travel-prices",
    name: "Travel & Pricing Data",
    description: "Specialized workflow for travel industry pricing and availability data",
    steps: [
      "Input venue list",
      "Fetch booking pages",
      "Extract pricing data",
      "Validate rates",
      "Export pricing dataset"
    ]
  },
  {
    id: "wf-dealer-inventory",
    name: "Dealer Network & Inventory", 
    description: "Automotive dealer network and inventory workflow",
    steps: [
      "Input dealer network",
      "Fetch inventory pages",
      "Extract vehicle data",
      "Normalize pricing",
      "Export inventory dataset"
    ]
  },
  {
    id: "mock-workflow",
    name: "Mock Workflow",
    description: "Mock workflow for testing",
    steps: ["Step 1", "Step 2", "Step 3"]
  }
];