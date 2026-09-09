// Starter row set for ERIS's live-refresh-enabled ESG Compliance Monitoring
// project. Unlike NTM's per-hotel model, this tracks real companies' public
// sustainability pages — genuinely real names and real URLs (verified
// reachable during live-refresh testing), with each row's tracked fields
// starting mostly blank so the first "Run" fills them in with real
// AI-extracted values, exactly like NTM Monitoring's first run did.

export const ESG_COLUMNS = [
  "Company_ID", "Company_Name", "Sector", "Sustainability_Report_Year",
  "Net_Zero_Target_Year", "Renewable_Energy_Commitment", "Emissions_Disclosure",
  "Disclosure_Framework", "Board_Diversity_Statement", "Key_Certifications",
  "ESG_Highlight_Summary", "Source_URL",
];

export const ESG_SAMPLE_ROWS: Record<string, string>[] = [
  { Company_ID: "esg-001", Company_Name: "Microsoft", Sector: "Technology", Source_URL: "https://www.microsoft.com/en-us/corporate-responsibility/sustainability", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-002", Company_Name: "Apple", Sector: "Technology", Source_URL: "https://www.apple.com/environment/", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-003", Company_Name: "Unilever", Sector: "Consumer Goods", Source_URL: "https://www.unilever.com/sustainability/", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-004", Company_Name: "Walmart", Sector: "Retail", Source_URL: "https://corporate.walmart.com/purpose/esgreport", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-005", Company_Name: "Nike", Sector: "Consumer Goods", Source_URL: "https://about.nike.com/en/impact", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-006", Company_Name: "The Coca-Cola Company", Sector: "Consumer Goods", Source_URL: "https://www.coca-colacompany.com/sustainability", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-007", Company_Name: "IKEA", Sector: "Retail", Source_URL: "https://www.ikea.com/global/en/our-business/sustainability/", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-008", Company_Name: "Salesforce", Sector: "Technology", Source_URL: "https://www.salesforce.com/company/sustainability/", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-009", Company_Name: "Alphabet (Google)", Sector: "Technology", Source_URL: "https://sustainability.google/", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
  { Company_ID: "esg-010", Company_Name: "Johnson & Johnson", Sector: "Healthcare", Source_URL: "https://healthforhumanityreport.jnj.com/", Sustainability_Report_Year: "", Net_Zero_Target_Year: "", Renewable_Energy_Commitment: "", Emissions_Disclosure: "", Disclosure_Framework: "", Board_Diversity_Statement: "", Key_Certifications: "", ESG_Highlight_Summary: "" },
];
