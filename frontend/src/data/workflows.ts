import companyShot from "@/assets/workflows/company-data-enrichment.png";
import annualReportShot from "@/assets/workflows/annual-report-financials.png";
import registryShot from "@/assets/workflows/registry-lookup.png";

export type Workflow = {
  id: string;
  name: string;
  category: "Firmographic" | "Contacts" | "Financials" | "Funding" | "Compliance" | "Web Discovery" | "Enrichment";
  description: string;
  inputs: string[];
  outputs: string[];
  attributes: string[];
  datapointsSummary: string;
  runtime: string;
  qcPercent: number;
  steps: string[];
  sources: string[];
  screenshot?: string;
};

export const WORKFLOWS: Workflow[] = [
  {
    id: "wf-company-extraction",
    name: "Company Data Extraction",
    category: "Firmographic",
    description: "Crawls company website, extracts firmographic fields via HTML + GPT readers, joins and publishes.",
    inputs: ["Company URL", "Optional company name"],
    outputs: ["Firmographic record (JSON)", "Confidence per field"],
    attributes: ["Company Name", "Legal Name", "Description", "Industry", "HQ Address", "Founded Year", "Employee Count"],
    datapointsSummary: "7 core firmographic fields per company",
    runtime: "~45 sec / company",
    qcPercent: 94,
    steps: ["Input", "HTML Page Downloader", "Filter Columns", "GPT HTML Reader", "GPT Text Reader", "Union", "Key-Value Response", "SMLE Python", "GPT PP – Column Join", "MOJO Integration", "Production", "Output"],
    sources: ["Company Website", "LinkedIn", "Crunchbase"],
    screenshot: companyShot,
  },
  {
    id: "wf-financial-extraction",
    name: "Financial Statement Extraction",
    category: "Financials",
    description: "Annual report PDF → page classification → financial statements filter → RAG + LLM → HITL review.",
    inputs: ["Annual report PDF URL or S3 key"],
    outputs: ["Structured financial statements", "Fiscal year tagging"],
    attributes: ["Revenue", "Net Income", "EBITDA", "Total Assets", "Total Liabilities", "Cash Flow", "Fiscal Year"],
    datapointsSummary: "7 financial KPIs × N fiscal years",
    runtime: "~3 min / report",
    qcPercent: 91,
    steps: ["Input", "S3 SignedURL Generator", "Page Classification", "Sequence Filter", "PDF Merge", "Financial Statements Filter", "PDF Merge 2", "RAG", "LLM", "HITL", "Output"],
    sources: ["SEC EDGAR", "Annual Reports", "Investor Relations"],
    screenshot: annualReportShot,
  },
  {
    id: "wf-registry-multi",
    name: "Global Registry Lookup",
    category: "Compliance",
    description: "Routes by jurisdiction to Companies House (UK), MCA (India), California / Delaware / New York Registries (USA).",
    inputs: ["Company name", "Jurisdiction / country"],
    outputs: ["Registry record", "Directors list", "Filing history"],
    attributes: ["Registry Number", "Incorporation Date", "Status", "Directors", "Registered Address", "Filings"],
    datapointsSummary: "6 registry fields + directors + filings",
    runtime: "~25 sec / lookup",
    qcPercent: 97,
    steps: ["Input", "Companies House Filter", "MCA Filter", "California Filter", "Delaware Filter", "New York Filter", "Per-registry Bot", "Output"],
    sources: ["Companies House (UK)", "MCA (India)", "California SOS", "Delaware Division of Corporations", "New York DOS"],
    screenshot: registryShot,
  },
  {
    id: "wf-nap-discovery",
    name: "NAP (Name / Address / Phone) Discovery",
    category: "Web Discovery",
    description: "Find or refresh a company's canonical Name, Address and Phone from any open web source.",
    inputs: ["Company name", "Optional domain hint"],
    outputs: ["Verified NAP record", "Confidence score"],
    attributes: ["Company Name", "Street Address", "City", "State", "Postal Code", "Country", "Phone", "Website"],
    datapointsSummary: "8 NAP fields per company",
    runtime: "~20 sec / company",
    qcPercent: 92,
    steps: ["Input", "Search Engine", "Website Resolver", "Contact Page Scraper", "GPT Extractor", "Normalizer", "Confidence Scorer", "Output"],
    sources: ["Google Search", "Bing", "Company Website", "Yellow Pages"],
  },
  {
    id: "wf-contact-enrichment",
    name: "Contact Enrichment",
    category: "Contacts",
    description: "Find verified contacts (name, title, email pattern, LinkedIn) for a target company.",
    inputs: ["Company domain", "Optional role / seniority filter"],
    outputs: ["Contact records with verified emails"],
    attributes: ["Full Name", "Title", "Email", "Phone", "LinkedIn URL", "Department", "Seniority"],
    datapointsSummary: "7 fields × up to 50 contacts / company",
    runtime: "~1 min / company",
    qcPercent: 88,
    steps: ["Input", "Domain Resolver", "Email Pattern Detector", "LinkedIn Scraper", "Verifier", "Output"],
    sources: ["LinkedIn", "Company Website", "Hunter.io patterns"],
  },
  {
    id: "wf-funding",
    name: "Funding & Investment Tracker",
    category: "Funding",
    description: "Pulls funding rounds, investors, valuations from press and Crunchbase-style sources.",
    inputs: ["Company name or domain"],
    outputs: ["Funding round history", "Investor list"],
    attributes: ["Round", "Amount Raised", "Date", "Investors", "Lead Investor", "Post-money Valuation"],
    datapointsSummary: "6 fields × N rounds per company",
    runtime: "~40 sec / company",
    qcPercent: 90,
    steps: ["Input", "News Search", "Article Filter", "GPT Extractor", "Dedupe & Reconcile", "Output"],
    sources: ["Crunchbase", "TechCrunch", "PR Newswire", "Bloomberg"],
  },
  {
    id: "wf-sic-naics",
    name: "SIC / NAICS Classification",
    category: "Compliance",
    description: "Classify a company into SIC and NAICS codes from its description and website.",
    inputs: ["Company description or URL"],
    outputs: ["SIC + NAICS codes with descriptions"],
    attributes: ["SIC Code", "SIC Description", "NAICS Code", "NAICS Description"],
    datapointsSummary: "4 classification codes",
    runtime: "~10 sec / company",
    qcPercent: 96,
    steps: ["Input", "Description Builder", "LLM Classifier", "Validator", "Output"],
    sources: ["Company Website", "SEC Filings"],
  },
  {
    id: "wf-tech-stack",
    name: "Technology Stack Enrichment",
    category: "Enrichment",
    description: "Detects technologies, CMS, analytics, ads, hosting from the company's web properties.",
    inputs: ["Company domain"],
    outputs: ["Detected tech stack profile"],
    attributes: ["CMS", "Analytics", "Ad Tech", "CDN", "JS Frameworks", "Hosting Provider"],
    datapointsSummary: "6 technographic dimensions",
    runtime: "~15 sec / domain",
    qcPercent: 93,
    steps: ["Input", "Page Fetcher", "Tech Fingerprint", "DNS Probe", "Output"],
    sources: ["Company Website", "BuiltWith-style fingerprints"],
  },
  {
    id: "wf-news-signals",
    name: "News & Intent Signals",
    category: "Enrichment",
    description: "Tracks press releases, leadership changes, hiring spikes and other intent signals.",
    inputs: ["Company name", "Signal types of interest"],
    outputs: ["Time-stamped signal feed"],
    attributes: ["Headline", "Signal Type", "Date", "Source URL", "Sentiment"],
    datapointsSummary: "5 fields × N signals / week",
    runtime: "Streaming – ~5 min batches",
    qcPercent: 89,
    steps: ["Input", "News Search", "Classifier", "Sentiment", "Output"],
    sources: ["Google News", "PR Newswire", "BusinessWire"],
  },
];
