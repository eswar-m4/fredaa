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

// Comprehensive datasets from vertical templates
export const DATASETS: Dataset[] = [
  {
    id: "ds-healthcare-providers",
    name: "Hospitals, Clinics and Doctors",
    category: "Healthcare",
    tagline: "Providers, specialities, consult fees, accreditation",
    description: "Provider master for hospitals, clinics, diagnostic labs and individual practitioners — pulled from the hospital's own site first, then cross-verified against aggregators and medical councils.",
    icon: "Stethoscope",
    refreshDefault: "Weekly",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "1.4M+ providers",
    coverage: 91,
    accuracy: 95,
    countriesCovered: 12,
    inputAttributes: [
      { key: "provider_name", label: "Hospital / Doctor name", type: "string", role: "input", required: true },
      { key: "city", label: "City / Region", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "provider_name", label: "provider_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "city", label: "city", type: "string", role: "input" },
      { key: "state", label: "state", type: "string", role: "input" },
      { key: "speciality", label: "speciality", type: "string", role: "input" },
      { key: "registration_no", label: "registration_no", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "provider_name", label: "Provider Name", type: "string", role: "output", group: "Identity" },
      { key: "provider_type", label: "Type (Hospital / Clinic / Lab)", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "speciality", label: "Speciality", type: "string", role: "output", group: "Clinical" },
      { key: "departments", label: "Departments", type: "string", role: "output", group: "Clinical" },
      { key: "bed_count", label: "Bed Count", type: "number", role: "output", group: "Clinical" },
      { key: "doctors_count", label: "Doctors Listed", type: "number", role: "output", group: "Clinical" },
      { key: "accreditation", label: "Accreditation (NABH / JCI)", type: "string", role: "output", group: "Compliance" },
      { key: "registration_no", label: "Council Registration No.", type: "string", role: "output", group: "Compliance" },
      { key: "address", label: "Address", type: "string", role: "output", group: "Location" },
      { key: "city", label: "City", type: "string", role: "output", group: "Location" },
      { key: "state", label: "State", type: "string", role: "output", group: "Location" },
      { key: "pincode", label: "Pincode", type: "string", role: "output", group: "Location" },
      { key: "latitude", label: "Latitude", type: "number", role: "output", group: "Location" },
      { key: "longitude", label: "Longitude", type: "number", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" },
      { key: "emergency_number", label: "Emergency Number", type: "string", role: "output", group: "Contact" },
      { key: "opening_hours", label: "Opening Hours", type: "string", role: "output", group: "Contact" },
      { key: "consult_fee", label: "Consultation Fee", type: "number", role: "output", group: "Commercial" },
      { key: "insurance_accepted", label: "Insurance / Cashless Panels", type: "string", role: "output", group: "Commercial" },
      { key: "rating", label: "Patient Rating", type: "number", role: "output", group: "Reputation" },
      { key: "review_count", label: "Review Count", type: "number", role: "output", group: "Reputation" },
      { key: "source_url", label: "Source URL", type: "url", role: "output", group: "Provenance" }
    ],
    sources: [
      { name: "Hospital / clinic website (official)", url: "{company_domain}", kind: "Company website", attributes: 24 },
      { name: "Practo", url: "practo.com", kind: "Third-party", attributes: 18 },
      { name: "Apollo 24|7", url: "apollo247.com", kind: "Third-party", attributes: 14 },
      { name: "Lybrate", url: "lybrate.com", kind: "Third-party", attributes: 12 },
      { name: "Justdial Health", url: "justdial.com", kind: "Directory", attributes: 12 },
      { name: "Google Business Profile", url: "google.com/maps", kind: "Directory", attributes: 14 },
      { name: "Bajaj Finserv Health", url: "bajajfinservhealth.in", kind: "Third-party", attributes: 10 },
      { name: "Credihealth", url: "credihealth.com", kind: "Third-party", attributes: 11 },
      { name: "NABH accredited list", url: "nabh.co", kind: "Regulator", attributes: 8 },
      { name: "National Medical Commission registry", url: "nmc.org.in", kind: "Regulator", attributes: 7 },
      { name: "State health department directories", url: "nhm.gov.in", kind: "Regulator", attributes: 9 },
      { name: "Yelp Health", url: "yelp.com", kind: "Directory", attributes: 8 }
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      provider_name: "Kauvery Hospital, Chennai",
      speciality: "Multi-speciality",
      city: "Chennai",
      consult_fee: 700,
      accreditation: "NABH"
    }
  },
  {
    id: "ds-hospitality-restaurants",
    name: "Restaurants and Food Services", 
    category: "Hospitality",
    tagline: "Menus, ratings, delivery, reservations",
    description: "Restaurant directory with cuisine types, pricing, ratings, delivery options and contact details from restaurant websites and food aggregators.",
    icon: "UtensilsCrossed",
    refreshDefault: "Daily",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "850K+ restaurants",
    coverage: 88,
    accuracy: 92,
    countriesCovered: 15,
    inputAttributes: [
      { key: "restaurant_name", label: "Restaurant Name", type: "string", role: "input", required: true },
      { key: "city", label: "City", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "restaurant_name", label: "restaurant_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "city", label: "city", type: "string", role: "input" },
      { key: "cuisine", label: "cuisine", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "restaurant_name", label: "Restaurant Name", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "cuisine", label: "Cuisine Type", type: "string", role: "output", group: "Food" },
      { key: "menu_items", label: "Menu Items", type: "string", role: "output", group: "Food" },
      { key: "price_range", label: "Price Range", type: "string", role: "output", group: "Commercial" },
      { key: "avg_cost_for_two", label: "Average Cost for Two", type: "number", role: "output", group: "Commercial" },
      { key: "delivery_available", label: "Delivery Available", type: "boolean", role: "output", group: "Services" },
      { key: "takeaway_available", label: "Takeaway Available", type: "boolean", role: "output", group: "Services" },
      { key: "reservation_required", label: "Reservation Required", type: "boolean", role: "output", group: "Services" },
      { key: "address", label: "Address", type: "string", role: "output", group: "Location" },
      { key: "city", label: "City", type: "string", role: "output", group: "Location" },
      { key: "state", label: "State", type: "string", role: "output", group: "Location" },
      { key: "pincode", label: "Pincode", type: "string", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" },
      { key: "opening_hours", label: "Opening Hours", type: "string", role: "output", group: "Contact" },
      { key: "rating", label: "Rating", type: "number", role: "output", group: "Reputation" },
      { key: "review_count", label: "Review Count", type: "number", role: "output", group: "Reputation" }
    ],
    sources: [
      { name: "Restaurant website (official)", url: "{company_domain}", kind: "Company website", attributes: 20 },
      { name: "Zomato", url: "zomato.com", kind: "Third-party", attributes: 18 },
      { name: "Swiggy", url: "swiggy.com", kind: "Third-party", attributes: 16 },
      { name: "Google Business Profile", url: "google.com/maps", kind: "Directory", attributes: 14 },
      { name: "Yelp", url: "yelp.com", kind: "Directory", attributes: 12 },
      { name: "TripAdvisor", url: "tripadvisor.com", kind: "Directory", attributes: 10 }
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      restaurant_name: "The Spice Route",
      cuisine: "Indian",
      city: "Mumbai",
      avg_cost_for_two: 1200,
      rating: 4.2
    }
  },
  {
    id: "ds-legal-firms",
    name: "Law Firms and Legal Services",
    category: "Legal", 
    tagline: "Practice areas, lawyers, case history, fees",
    description: "Legal directory with firm specializations, lawyer profiles, case success rates, and fee structures from firm websites and legal directories.",
    icon: "Scale",
    refreshDefault: "Monthly",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "320K+ firms",
    coverage: 85,
    accuracy: 94,
    countriesCovered: 8,
    inputAttributes: [
      { key: "firm_name", label: "Law Firm Name", type: "string", role: "input", required: true },
      { key: "city", label: "City", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "firm_name", label: "firm_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "city", label: "city", type: "string", role: "input" },
      { key: "practice_areas", label: "practice_areas", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "firm_name", label: "Firm Name", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "practice_areas", label: "Practice Areas", type: "string", role: "output", group: "Services" },
      { key: "lawyer_count", label: "Number of Lawyers", type: "number", role: "output", group: "Services" },
      { key: "founding_year", label: "Founding Year", type: "number", role: "output", group: "Services" },
      { key: "bar_registration", label: "Bar Registration", type: "string", role: "output", group: "Compliance" },
      { key: "address", label: "Address", type: "string", role: "output", group: "Location" },
      { key: "city", label: "City", type: "string", role: "output", group: "Location" },
      { key: "state", label: "State", type: "string", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" },
      { key: "consultation_fee", label: "Consultation Fee", type: "number", role: "output", group: "Commercial" },
      { key: "success_rate", label: "Success Rate", type: "number", role: "output", group: "Reputation" }
    ],
    sources: [
      { name: "Law firm website (official)", url: "{company_domain}", kind: "Company website", attributes: 18 },
      { name: "Bar Council directories", url: "barcouncilofindia.org", kind: "Regulator", attributes: 12 },
      { name: "Legal directories", url: "lawrato.com", kind: "Directory", attributes: 14 },
      { name: "Justia", url: "justia.com", kind: "Directory", attributes: 10 }
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      firm_name: "Shah and Associates",
      practice_areas: "Corporate Law, IPR",
      city: "Delhi",
      lawyer_count: 25,
      consultation_fee: 5000
    }
  },
  {
    id: "ds-insurance-companies",
    name: "Insurance Companies and Agents",
    category: "Insurance",
    tagline: "Policies, premiums, claims, coverage",
    description: "Insurance provider directory with policy offerings, premium rates, claim ratios, and agent networks from company websites and regulatory filings.",
    icon: "Shield",
    refreshDefault: "Weekly",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "180K+ entities",
    coverage: 87,
    accuracy: 96,
    countriesCovered: 6,
    inputAttributes: [
      { key: "company_name", label: "Insurance Company Name", type: "string", role: "input", required: true },
      { key: "state", label: "State/Region", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "company_name", label: "company_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "state", label: "state", type: "string", role: "input" },
      { key: "insurance_type", label: "insurance_type", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "company_name", label: "Company Name", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "insurance_type", label: "Insurance Type", type: "string", role: "output", group: "Products" },
      { key: "policy_count", label: "Active Policies", type: "number", role: "output", group: "Products" },
      { key: "premium_collected", label: "Premium Collected", type: "number", role: "output", group: "Financial" },
      { key: "claim_ratio", label: "Claim Settlement Ratio", type: "number", role: "output", group: "Performance" },
      { key: "solvency_ratio", label: "Solvency Ratio", type: "number", role: "output", group: "Financial" },
      { key: "agent_count", label: "Agent Network Size", type: "number", role: "output", group: "Distribution" },
      { key: "branch_count", label: "Branch Count", type: "number", role: "output", group: "Distribution" },
      { key: "headquarters", label: "Headquarters", type: "string", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" },
      { key: "customer_rating", label: "Customer Rating", type: "number", role: "output", group: "Reputation" }
    ],
    sources: [
      { name: "Insurance company website", url: "{company_domain}", kind: "Company website", attributes: 20 },
      { name: "IRDAI database", url: "irdai.gov.in", kind: "Regulator", attributes: 16 },
      { name: "Policybazaar", url: "policybazaar.com", kind: "Third-party", attributes: 14 }
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      company_name: "HDFC ERGO General Insurance",
      insurance_type: "General Insurance",
      state: "Mumbai",
      claim_ratio: 89.5,
      customer_rating: 4.1
    }
  },
  {
    id: "ds-automotive-dealers",
    name: "Auto Dealerships and Service Centers", 
    category: "Automotive",
    tagline: "Inventory, pricing, service, financing",
    description: "Automotive dealer network with vehicle inventory, pricing, service offerings, and financing options from dealer websites and automotive platforms.",
    icon: "Car",
    refreshDefault: "Daily",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "95K+ dealers",
    coverage: 82,
    accuracy: 91,
    countriesCovered: 10,
    inputAttributes: [
      { key: "dealer_name", label: "Dealer Name", type: "string", role: "input", required: true },
      { key: "city", label: "City", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "dealer_name", label: "dealer_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "city", label: "city", type: "string", role: "input" },
      { key: "brand", label: "brand", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "dealer_name", label: "Dealer Name", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "brand", label: "Vehicle Brand", type: "string", role: "output", group: "Inventory" },
      { key: "inventory_count", label: "Inventory Count", type: "number", role: "output", group: "Inventory" },
      { key: "new_vehicles", label: "New Vehicles Available", type: "boolean", role: "output", group: "Inventory" },
      { key: "used_vehicles", label: "Used Vehicles Available", type: "boolean", role: "output", group: "Inventory" },
      { key: "service_center", label: "Service Center Available", type: "boolean", role: "output", group: "Services" },
      { key: "parts_available", label: "Parts Available", type: "boolean", role: "output", group: "Services" },
      { key: "financing_options", label: "Financing Options", type: "string", role: "output", group: "Financial" },
      { key: "address", label: "Address", type: "string", role: "output", group: "Location" },
      { key: "city", label: "City", type: "string", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" },
      { key: "rating", label: "Customer Rating", type: "number", role: "output", group: "Reputation" }
    ],
    sources: [
      { name: "Dealer website (official)", url: "{company_domain}", kind: "Company website", attributes: 18 },
      { name: "CarDekho", url: "cardekho.com", kind: "Third-party", attributes: 16 },
      { name: "CarWale", url: "carwale.com", kind: "Third-party", attributes: 14 },
      { name: "Google Business Profile", url: "google.com/maps", kind: "Directory", attributes: 12 }
    ],
    workflowId: "wf-company-profile", 
    sampleRow: {
      dealer_name: "Maruti Suzuki Arena Delhi",
      brand: "Maruti Suzuki",
      city: "Delhi",
      inventory_count: 150,
      rating: 4.3
    }
  },
  {
    id: "ds-technology-companies",
    name: "Technology Companies and Startups",
    category: "Technology",
    tagline: "Funding, products, team, tech stack",
    description: "Technology company directory with funding details, product offerings, team information, and technology stack from company websites and startup databases.",
    icon: "Code",
    refreshDefault: "Weekly",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "450K+ companies",
    coverage: 89,
    accuracy: 93,
    countriesCovered: 25,
    inputAttributes: [
      { key: "company_name", label: "Company Name", type: "string", role: "input", required: true },
      { key: "website", label: "Website", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "company_name", label: "company_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "industry", label: "industry", type: "string", role: "input" },
      { key: "funding_stage", label: "funding_stage", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "company_name", label: "Company Name", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "industry", label: "Industry", type: "string", role: "output", group: "Business" },
      { key: "founding_year", label: "Founding Year", type: "number", role: "output", group: "Business" },
      { key: "employee_count", label: "Employee Count", type: "number", role: "output", group: "Business" },
      { key: "funding_stage", label: "Funding Stage", type: "string", role: "output", group: "Financial" },
      { key: "total_funding", label: "Total Funding", type: "number", role: "output", group: "Financial" },
      { key: "valuation", label: "Valuation", type: "number", role: "output", group: "Financial" },
      { key: "products", label: "Products/Services", type: "string", role: "output", group: "Products" },
      { key: "tech_stack", label: "Technology Stack", type: "string", role: "output", group: "Technical" },
      { key: "headquarters", label: "Headquarters", type: "string", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" }
    ],
    sources: [
      { name: "Company website (official)", url: "{company_domain}", kind: "Company website", attributes: 22 },
      { name: "Crunchbase", url: "crunchbase.com", kind: "Third-party", attributes: 18 },
      { name: "AngelList", url: "angel.co", kind: "Third-party", attributes: 14 },
      { name: "LinkedIn Company Pages", url: "linkedin.com/company", kind: "Directory", attributes: 16 }
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      company_name: "TechFlow Solutions",
      industry: "SaaS",
      founding_year: 2019,
      funding_stage: "Series A",
      total_funding: 5000000
    }
  },
  {
    id: "ds-financial-services",
    name: "Banks and Financial Institutions",
    category: "Finance",
    tagline: "Services, rates, branches, compliance",
    description: "Financial services directory with banking products, interest rates, branch networks, and regulatory compliance from institution websites and financial databases.",
    icon: "Banknote",
    refreshDefault: "Weekly",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "75K+ institutions",
    coverage: 94,
    accuracy: 97,
    countriesCovered: 12,
    inputAttributes: [
      { key: "institution_name", label: "Institution Name", type: "string", role: "input", required: true },
      { key: "city", label: "City", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "institution_name", label: "institution_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "city", label: "city", type: "string", role: "input" },
      { key: "institution_type", label: "institution_type", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "institution_name", label: "Institution Name", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "institution_type", label: "Institution Type", type: "string", role: "output", group: "Business" },
      { key: "banking_license", label: "Banking License", type: "string", role: "output", group: "Compliance" },
      { key: "services_offered", label: "Services Offered", type: "string", role: "output", group: "Products" },
      { key: "interest_rates", label: "Interest Rates", type: "string", role: "output", group: "Products" },
      { key: "branch_count", label: "Branch Count", type: "number", role: "output", group: "Distribution" },
      { key: "atm_count", label: "ATM Count", type: "number", role: "output", group: "Distribution" },
      { key: "digital_banking", label: "Digital Banking Available", type: "boolean", role: "output", group: "Services" },
      { key: "headquarters", label: "Headquarters", type: "string", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" },
      { key: "customer_rating", label: "Customer Rating", type: "number", role: "output", group: "Reputation" }
    ],
    sources: [
      { name: "Bank website (official)", url: "{company_domain}", kind: "Company website", attributes: 20 },
      { name: "Reserve Bank database", url: "rbi.org.in", kind: "Regulator", attributes: 16 },
      { name: "Banking directories", url: "bankbazaar.com", kind: "Directory", attributes: 14 }
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      institution_name: "HDFC Bank",
      institution_type: "Private Bank",
      city: "Mumbai",
      branch_count: 6342,
      customer_rating: 4.2
    }
  },
  {
    id: "ds-retail-stores",
    name: "Retail Stores and Chains",
    category: "Retail",
    tagline: "Inventory, pricing, locations, promotions",
    description: "Retail directory with store locations, product catalogs, pricing information, and promotional offers from retailer websites and e-commerce platforms.",
    icon: "ShoppingBag",
    refreshDefault: "Daily",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "680K+ stores",
    coverage: 86,
    accuracy: 90,
    countriesCovered: 18,
    inputAttributes: [
      { key: "store_name", label: "Store Name", type: "string", role: "input", required: true },
      { key: "city", label: "City", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "store_name", label: "store_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "city", label: "city", type: "string", role: "input" },
      { key: "category", label: "category", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "store_name", label: "Store Name", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "category", label: "Store Category", type: "string", role: "output", group: "Business" },
      { key: "chain_store", label: "Chain Store", type: "boolean", role: "output", group: "Business" },
      { key: "location_count", label: "Number of Locations", type: "number", role: "output", group: "Distribution" },
      { key: "online_presence", label: "Online Store Available", type: "boolean", role: "output", group: "Services" },
      { key: "product_range", label: "Product Range", type: "string", role: "output", group: "Inventory" },
      { key: "price_range", label: "Price Range", type: "string", role: "output", group: "Commercial" },
      { key: "delivery_options", label: "Delivery Options", type: "string", role: "output", group: "Services" },
      { key: "address", label: "Address", type: "string", role: "output", group: "Location" },
      { key: "city", label: "City", type: "string", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" },
      { key: "rating", label: "Customer Rating", type: "number", role: "output", group: "Reputation" }
    ],
    sources: [
      { name: "Store website (official)", url: "{company_domain}", kind: "Company website", attributes: 18 },
      { name: "Google Business Profile", url: "google.com/maps", kind: "Directory", attributes: 16 },
      { name: "Yelp", url: "yelp.com", kind: "Directory", attributes: 12 },
      { name: "E-commerce platforms", url: "amazon.in", kind: "Marketplace", attributes: 14 }
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      store_name: "Reliance Digital",
      category: "Electronics",
      city: "Mumbai",
      chain_store: true,
      location_count: 350
    }
  },
  {
    id: "ds-manufacturing-companies",
    name: "Manufacturing and Industrial Companies",
    category: "Manufacturing",
    tagline: "Products, capacity, certifications, supply chain",
    description: "Manufacturing directory with production capabilities, product catalogs, quality certifications, and supply chain information from company websites and industrial databases.",
    icon: "Factory",
    refreshDefault: "Monthly",
    refreshOptions: ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"],
    rowsAvailable: "290K+ companies",
    coverage: 83,
    accuracy: 95,
    countriesCovered: 15,
    inputAttributes: [
      { key: "company_name", label: "Company Name", type: "string", role: "input", required: true },
      { key: "industry", label: "Industry", type: "string", role: "input" }
    ],
    inputTemplateColumns: [
      { key: "company_name", label: "company_name", type: "string", role: "input", required: true },
      { key: "website", label: "website", type: "string", role: "input" },
      { key: "industry", label: "industry", type: "string", role: "input" },
      { key: "products", label: "products", type: "string", role: "input" }
    ],
    outputAttributes: [
      { key: "company_name", label: "Company Name", type: "string", role: "output", group: "Identity" },
      { key: "website", label: "Website", type: "url", role: "output", group: "Identity" },
      { key: "industry", label: "Industry Sector", type: "string", role: "output", group: "Business" },
      { key: "products_manufactured", label: "Products Manufactured", type: "string", role: "output", group: "Production" },
      { key: "production_capacity", label: "Production Capacity", type: "string", role: "output", group: "Production" },
      { key: "certifications", label: "Quality Certifications", type: "string", role: "output", group: "Compliance" },
      { key: "facility_count", label: "Manufacturing Facilities", type: "number", role: "output", group: "Operations" },
      { key: "employee_strength", label: "Employee Strength", type: "number", role: "output", group: "Operations" },
      { key: "export_countries", label: "Export Countries", type: "string", role: "output", group: "Global" },
      { key: "headquarters", label: "Headquarters", type: "string", role: "output", group: "Location" },
      { key: "phone", label: "Phone", type: "string", role: "output", group: "Contact" },
      { key: "email", label: "Email", type: "email", role: "output", group: "Contact" },
      { key: "annual_revenue", label: "Annual Revenue", type: "number", role: "output", group: "Financial" }
    ],
    sources: [
      { name: "Company website (official)", url: "{company_domain}", kind: "Company website", attributes: 20 },
      { name: "TradeIndia", url: "tradeindia.com", kind: "Directory", attributes: 16 },
      { name: "IndiaMart", url: "indiamart.com", kind: "Marketplace", attributes: 14 },
      { name: "Exporters Directory", url: "exportersindia.com", kind: "Directory", attributes: 12 }
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      company_name: "Tata Steel Limited",
      industry: "Steel Manufacturing",
      products_manufactured: "Steel products, Iron ore",
      facility_count: 15,
      annual_revenue: 2500000000
    }
  }
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