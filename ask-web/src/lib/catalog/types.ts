export interface AgentRecord {
  id: string;
  name: string;
  sourceUrl: string;
  project: string;
  type: string;
  category: string;
  industry: string;
  country: string;
  dataType: string;
  description: string;
  complexity: string;
  datapoints: string;
  estimatedRecords: string;
  runtimeType: string;
  hostname: string;
}

export interface SolutionRecord {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  records: string;
  coverage: string;
  accuracy: string;
  countriesCovered: string;
  refreshCadence: string;
  refreshOptions: string[];
  sourceCount: string;
  sourceNames: string[];
  attributeCount: string;
  attributes: string[];
  inputAttributeCount: string;
}

export interface SolutionSourceRecord {
  solutionId: string;
  solutionName: string;
  solutionCategory: string;
  name: string;
  url: string;
  kind: string;
  attributesContributed: string;
  region: string;
}

export interface FacetCount {
  name: string;
  count: number;
}

export interface OverviewStat {
  label: string;
  value: string;
}

export interface SheetInfo {
  name: string;
  contents: string;
}

export interface Catalog {
  generated: string;
  overview: OverviewStat[];
  sheets: SheetInfo[];
  agents: AgentRecord[];
  solutions: SolutionRecord[];
  sources: SolutionSourceRecord[];
  agentsByCategory: FacetCount[];
  agentsByIndustry: FacetCount[];
  agentsByDataType: FacetCount[];
  solutionsByCategory: FacetCount[];
}
