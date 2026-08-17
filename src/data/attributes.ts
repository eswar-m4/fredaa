export type AttributeCategory =
  | "Firmographic"
  | "Contacts"
  | "Financials"
  | "Funding"
  | "Compliance"
  | "Technographic"
  | "Web Presence";

export type Attribute = {
  key: string;
  label: string;
  category: AttributeCategory;
  description: string;
  example?: string;
};

export const ATTRIBUTES: Attribute[] = [
  // Firmographic
  { key: "company_name", label: "Company Name", category: "Firmographic", description: "Common trading name", example: "Acme Inc." },
  { key: "legal_name", label: "Legal Name", category: "Firmographic", description: "Registered legal entity name" },
  { key: "description", label: "Company Description", category: "Firmographic", description: "Short business description" },
  { key: "industry", label: "Industry", category: "Firmographic", description: "Primary industry segment" },
  { key: "sub_industry", label: "Sub-Industry", category: "Firmographic", description: "Granular industry" },
  { key: "founded_year", label: "Founded Year", category: "Firmographic", description: "Year incorporated" },
  { key: "employees", label: "Employee Count", category: "Firmographic", description: "Total headcount" },
  { key: "hq_address", label: "HQ Address", category: "Firmographic", description: "Full headquarters address" },
  { key: "country", label: "Country", category: "Firmographic", description: "HQ country" },

  // Contacts
  { key: "contact_name", label: "Contact Full Name", category: "Contacts", description: "First + last name" },
  { key: "contact_title", label: "Title", category: "Contacts", description: "Job title" },
  { key: "contact_email", label: "Email", category: "Contacts", description: "Verified email address" },
  { key: "contact_phone", label: "Phone", category: "Contacts", description: "Direct or company phone" },
  { key: "contact_linkedin", label: "LinkedIn URL", category: "Contacts", description: "Profile URL" },
  { key: "contact_seniority", label: "Seniority", category: "Contacts", description: "C-level / VP / Director / Manager" },

  // Financials
  { key: "revenue", label: "Revenue", category: "Financials", description: "Annual revenue" },
  { key: "net_income", label: "Net Income", category: "Financials", description: "Annual net income" },
  { key: "ebitda", label: "EBITDA", category: "Financials", description: "Earnings before ITDA" },
  { key: "assets", label: "Total Assets", category: "Financials" , description: "Balance sheet total assets" },
  { key: "liabilities", label: "Total Liabilities", category: "Financials", description: "Balance sheet total liabilities" },
  { key: "fiscal_year", label: "Fiscal Year", category: "Financials", description: "Reporting fiscal year" },

  // Funding
  { key: "last_round", label: "Last Funding Round", category: "Funding", description: "Series / type" },
  { key: "amount_raised", label: "Amount Raised", category: "Funding", description: "Total in latest round" },
  { key: "investors", label: "Investors", category: "Funding", description: "List of investors" },
  { key: "valuation", label: "Post-money Valuation", category: "Funding", description: "Latest known valuation" },

  // Compliance
  { key: "registry_number", label: "Registry Number", category: "Compliance", description: "Companies House / MCA / SOS ID" },
  { key: "ticker", label: "Ticker Symbol", category: "Compliance", description: "Public stock ticker" },
  { key: "lei", label: "LEI", category: "Compliance", description: "Legal Entity Identifier" },
  { key: "sic_code", label: "SIC Code", category: "Compliance", description: "Standard Industrial Classification" },
  { key: "naics_code", label: "NAICS Code", category: "Compliance", description: "North American Industry Classification" },
  { key: "tax_id", label: "Tax ID / EIN", category: "Compliance", description: "Federal tax identifier" },
  { key: "incorporation_state", label: "Incorporation State", category: "Compliance", description: "State / country of incorporation" },

  // Technographic
  { key: "cms", label: "CMS", category: "Technographic", description: "Content management system" },
  { key: "analytics", label: "Analytics Stack", category: "Technographic", description: "GA / Segment / etc." },
  { key: "frameworks", label: "JS Frameworks", category: "Technographic", description: "React / Angular / Vue" },
  { key: "hosting", label: "Hosting Provider", category: "Technographic", description: "AWS / Azure / GCP" },

  // Web Presence
  { key: "website", label: "Website URL", category: "Web Presence", description: "Primary domain" },
  { key: "linkedin_url", label: "LinkedIn Company URL", category: "Web Presence", description: "Company page" },
  { key: "twitter_handle", label: "Twitter / X Handle", category: "Web Presence", description: "Social handle" },
  { key: "facebook_url", label: "Facebook URL", category: "Web Presence", description: "Facebook page" },
];

export const CATEGORY_ORDER: AttributeCategory[] = [
  "Firmographic", "Contacts", "Financials", "Funding", "Compliance", "Technographic", "Web Presence",
];
