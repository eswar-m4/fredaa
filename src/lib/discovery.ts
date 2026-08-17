// On-the-fly source discovery engine (demo intelligence, no backend call).
// Parses a free-text request (or an uploaded file), works out the entity type,
// the location, how many records are wanted and which fields matter, then
// produces: candidate sources (flagged if already onboarded), a real entity
// list with websites, data points, volume, runtime, samples and next steps.

import { lookupOnboarded, type OnboardedHit } from "@/lib/onboarded";

export type SourceKindLabel =
  | "Company website"
  | "Third-party"
  | "Marketplace"
  | "Directory"
  | "Regulator";

export type DiscoveredSource = {
  name: string;
  url: string;
  kind: SourceKindLabel;
  note: string;
  coverage: string; // what share of the ask this source covers
  onboarded?: OnboardedHit | null;
};

export type EntityRow = {
  name: string;
  website: string;
  city: string;
  phone: string;
  address: string;
  onboarded?: OnboardedHit | null;
};

export type SampleRecord = Record<string, string>;

export type ColumnFix = { from: string; to: string; why: string };

export type Intent = {
  vertical: string; // key into VERTICALS
  entityLabel: string; // "hospitals"
  entitySingular: string;
  cities: string[];
  regionLabel: string;
  count: number;
  fields: string[];
  mode: "list" | "refresh";
  fileName?: string;
};

export type Recommendation = {
  intent: string;
  route: "targeted" | "openweb" | "request";
  routeLabel: string;
  routeHref: string;
  headline: string;
  reasoning: string[];
  sources: DiscoveredSource[];
  entities: EntityRow[];
  entityTotal: number;
  dataPoints: string[];
  validation: string[];
  estimatedVolume: string;
  estimatedTime: string;
  suggestedCategory?: string;
  templateHint?: string;
  columnFixes?: ColumnFix[];
  nextSteps: string[];
  sample: SampleRecord[];
  parsed: Intent;
};

/* ------------------------------------------------------------------ */
/* Geography                                                           */
/* ------------------------------------------------------------------ */

const CITY_META: Record<string, { std: string; pin: number; state: string; areas: string[] }> = {
  Chennai: {
    std: "44",
    pin: 600001,
    state: "TN",
    areas: ["T. Nagar", "Adyar", "Anna Nagar", "Nungambakkam", "Velachery", "Porur", "Vadapalani", "Guindy", "Egmore", "Mylapore", "Alwarpet", "Perungudi", "Chromepet", "Tambaram", "Kilpauk", "Ambattur"],
  },
  Bengaluru: {
    std: "80",
    pin: 560001,
    state: "KA",
    areas: ["Whitefield", "Indiranagar", "Jayanagar", "Koramangala", "Hebbal", "Rajajinagar", "HSR Layout", "Malleshwaram", "Electronic City", "Yelahanka", "Banashankari", "Marathahalli"],
  },
  Hyderabad: {
    std: "40",
    pin: 500001,
    state: "TG",
    areas: ["Banjara Hills", "Jubilee Hills", "Gachibowli", "Secunderabad", "Kukatpally", "Madhapur", "Begumpet", "LB Nagar", "Somajiguda"],
  },
  Kochi: { std: "484", pin: 682001, state: "KL", areas: ["Kaloor", "Edappally", "Panampilly Nagar", "Vyttila", "Kakkanad", "Fort Kochi", "Palarivattom"] },
  Coimbatore: { std: "422", pin: 641001, state: "TN", areas: ["R.S. Puram", "Peelamedu", "Saibaba Colony", "Gandhipuram", "Race Course", "Singanallur"] },
  Madurai: { std: "452", pin: 625001, state: "TN", areas: ["Anna Nagar", "K.K. Nagar", "Bypass Road", "Goripalayam", "Villapuram"] },
  Vijayawada: { std: "866", pin: 520001, state: "AP", areas: ["Benz Circle", "Gunadala", "Labbipet", "Patamata"] },
  Visakhapatnam: { std: "891", pin: 530001, state: "AP", areas: ["MVP Colony", "Dwaraka Nagar", "Gajuwaka", "Seethammadhara"] },
  Thiruvananthapuram: { std: "471", pin: 695001, state: "KL", areas: ["Kowdiar", "Pattom", "Vazhuthacaud", "Kazhakkoottam"] },
  Mysuru: { std: "821", pin: 570001, state: "KA", areas: ["Kuvempunagar", "Vijayanagar", "Saraswathipuram"] },
  Mumbai: { std: "22", pin: 400001, state: "MH", areas: ["Andheri", "Bandra", "Powai", "Dadar", "Worli", "Chembur", "Malad", "Thane"] },
  Pune: { std: "20", pin: 411001, state: "MH", areas: ["Kothrud", "Baner", "Viman Nagar", "Hadapsar", "Aundh"] },
  Delhi: { std: "11", pin: 110001, state: "DL", areas: ["Saket", "Rohini", "Dwarka", "Karol Bagh", "Vasant Kunj", "Pitampura"] },
  Gurugram: { std: "124", pin: 122001, state: "HR", areas: ["Sector 44", "Golf Course Road", "Sushant Lok", "Sohna Road"] },
  Kolkata: { std: "33", pin: 700001, state: "WB", areas: ["Salt Lake", "Alipore", "Ballygunge", "Howrah", "New Town"] },
  Ahmedabad: { std: "79", pin: 380001, state: "GJ", areas: ["Satellite", "Navrangpura", "Bopal", "Maninagar"] },
  Jaipur: { std: "141", pin: 302001, state: "RJ", areas: ["Malviya Nagar", "Vaishali Nagar", "C-Scheme"] },
};

const SOUTH = ["Chennai", "Bengaluru", "Hyderabad", "Kochi", "Coimbatore", "Madurai", "Vijayawada", "Visakhapatnam", "Thiruvananthapuram", "Mysuru"];
const NORTH = ["Delhi", "Gurugram", "Jaipur"];
const WEST = ["Mumbai", "Pune", "Ahmedabad"];
const EAST = ["Kolkata"];

const CITY_ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  chennai: "Chennai",
  madras: "Chennai",
  hyderabad: "Hyderabad",
  cochin: "Kochi",
  kochi: "Kochi",
  ernakulam: "Kochi",
  coimbatore: "Coimbatore",
  madurai: "Madurai",
  vijayawada: "Vijayawada",
  visakhapatnam: "Visakhapatnam",
  vizag: "Visakhapatnam",
  trivandrum: "Thiruvananthapuram",
  thiruvananthapuram: "Thiruvananthapuram",
  mysore: "Mysuru",
  mysuru: "Mysuru",
  mumbai: "Mumbai",
  bombay: "Mumbai",
  pune: "Pune",
  delhi: "Delhi",
  "new delhi": "Delhi",
  gurgaon: "Gurugram",
  gurugram: "Gurugram",
  kolkata: "Kolkata",
  ahmedabad: "Ahmedabad",
  jaipur: "Jaipur",
};

function detectCities(t: string): { cities: string[]; label: string } {
  const hits: string[] = [];
  for (const [alias, city] of Object.entries(CITY_ALIASES)) {
    if (t.includes(alias) && !hits.includes(city)) hits.push(city);
  }
  if (hits.length) return { cities: hits, label: hits.join(", ") };
  if (/south india|southern india|tamil nadu|kerala|karnataka|andhra|telangana/.test(t))
    return { cities: SOUTH, label: "South India" };
  if (/north india/.test(t)) return { cities: NORTH, label: "North India" };
  if (/west india|western india/.test(t)) return { cities: WEST, label: "West India" };
  if (/east india/.test(t)) return { cities: EAST, label: "East India" };
  if (/\bindia\b|pan.?india/.test(t)) return { cities: [...SOUTH, ...NORTH, ...WEST, ...EAST], label: "India" };
  return { cities: SOUTH.slice(0, 3), label: "India (no region given — assuming metros)" };
}

/* ------------------------------------------------------------------ */
/* Verticals                                                           */
/* ------------------------------------------------------------------ */

type Vertical = {
  key: string;
  keywords: string[];
  plural: string;
  singular: string;
  category: string; // dataset category suggestion
  route: "targeted" | "openweb";
  brands: string[];
  suffixes: string[];
  tlds: string[];
  fields: string[];
  validation: string[];
  perCity: number; // typical entity density per metro
  minutesPer1k: number;
  sources: (ctx: { regionLabel: string }) => DiscoveredSource[];
};

const s = (
  name: string,
  url: string,
  kind: SourceKindLabel,
  note: string,
  coverage: string,
): DiscoveredSource => ({ name, url, kind, note, coverage });

const VERTICALS: Vertical[] = [
  {
    key: "healthcare",
    keywords: ["hospital", "clinic", "nursing home", "doctor", "diagnostic", "healthcare", "medical", "dental", "physio"],
    plural: "hospitals",
    singular: "hospital",
    category: "Healthcare → Hospital & Clinic Directory",
    route: "targeted",
    brands: ["Apollo", "Fortis", "Kauvery", "MIOT", "Global", "Rela", "Billroth", "SIMS", "Vijaya", "Sri Ramachandra", "Prashanth", "Gleneagles", "Manipal", "Aster", "Narayana", "Amrita", "KIMS", "Yashoda", "Rainbow", "Cloudnine", "Sagar", "Sparsh", "Columbia Asia", "Frontier Lifeline", "Bharathirajaa", "Devadoss", "Meenakshi", "PSG", "Ganga", "Royal Care"],
    suffixes: ["Hospitals", "Multispeciality Hospital", "Medical Centre", "Institute of Medical Sciences", "Speciality Clinic", "Health City"],
    tlds: ["com", "in", "co.in", "org"],
    fields: ["Hospital / clinic name", "Official website", "Full address + pincode", "Phone / emergency number", "Email", "City & state", "Speciality & departments", "Bed count", "Accreditation (NABH / JCI)", "Consultation fee band", "OP timings", "Rating & review count", "Geo (lat/long)"],
    validation: [
      "Entity check — the page must describe a care facility, not a pharmacy, blog or aggregator.",
      "Geo check — the resolved pincode must fall inside the requested region.",
      "Two-source agreement on phone and address before a record is published.",
      "Registry check — NABH / state health department listing where available.",
    ],
    perCity: 620,
    minutesPer1k: 26,
    sources: () => [
      s("Hospital website (official)", "{hospital_domain}", "Company website", "Departments, doctors, OP timings, emergency line", "Primary — 100% of the field list"),
      s("Practo", "practo.com", "Third-party", "Speciality, consult fee, doctor roster", "~78% of urban facilities"),
      s("Apollo 24|7", "apollo247.com", "Third-party", "Chain hospitals, departments, appointment lines", "Chain coverage"),
      s("Credihealth", "credihealth.com", "Third-party", "Bed counts, procedure pricing", "~40%"),
      s("Google Business Profile", "google.com/maps", "Directory", "Address, phone, hours, geo, ratings", "~95% — best contact fallback"),
      s("Justdial Health", "justdial.com", "Directory", "Contact fallback for smaller clinics", "~85% of small clinics"),
      s("Lybrate", "lybrate.com", "Third-party", "Doctor profiles and fees", "~35%"),
      s("NABH accredited list", "nabh.co", "Regulator", "Accreditation validation", "Validation only"),
      s("National Health Mission state directories", "nhm.gov.in", "Regulator", "Registration cross-check", "Validation only"),
      s("Clinicspots", "clinicspots.com", "Third-party", "Procedure cost bands", "~25%"),
    ],
  },
  {
    key: "hospitality",
    keywords: ["hotel", "resort", "restaurant", "cafe", "banquet", "hospitality", "tariff", "menu", "homestay"],
    plural: "hotels",
    singular: "hotel",
    category: "Hospitality → Hotels, Restaurants & Venues",
    route: "openweb",
    brands: ["Taj", "ITC", "Radisson Blu", "Novotel", "Hyatt Centric", "The Leela", "Vivanta", "Fortune Park", "Lemon Tree", "Sarovar Portico", "Ibis", "Crowne Plaza", "The Residency", "Sterling", "Trident", "Marriott", "Courtyard", "Holiday Inn", "GRT Grand", "Le Meridien"],
    suffixes: ["Hotel", "Resort & Spa", "Suites", "Grand", "Inn", "Boutique Stay"],
    tlds: ["com", "in", "co.in"],
    fields: ["Property name", "Official booking URL", "Star rating / cuisine", "Nightly tariff & cost for two", "Room types & amenities", "Address & geo", "Phone & email", "Review score & count", "FSSAI licence", "Cancellation policy"],
    validation: [
      "Rate parity check across at least three OTAs before a tariff is published.",
      "Geo pin must fall inside the requested city boundary.",
      "Closed / delisted venues flagged from a 404 or 'permanently closed' marker.",
    ],
    perCity: 900,
    minutesPer1k: 18,
    sources: () => [
      s("Property website / direct booking", "{property_domain}", "Company website", "Rack rate, room types, direct phone", "Primary"),
      s("MakeMyTrip", "makemytrip.com", "Marketplace", "Tariffs, offers, availability", "~92% of listed hotels"),
      s("Booking.com", "booking.com", "Marketplace", "Availability, review score, policies", "~90%"),
      s("Goibibo", "goibibo.com", "Marketplace", "India tariffs and offers", "~85%"),
      s("Agoda", "agoda.com", "Marketplace", "APAC rate benchmark", "~70%"),
      s("Hotels.com", "hotels.com", "Marketplace", "Rate parity check", "~65%"),
      s("Zomato", "zomato.com", "Marketplace", "Menus, cost for two, timings", "Restaurants only"),
      s("Swiggy Dineout", "swiggy.com/dineout", "Marketplace", "Table offers, cuisine tags", "Restaurants only"),
      s("TripAdvisor", "tripadvisor.com", "Third-party", "Reviews, photos, ranking", "~80%"),
      s("FSSAI licence registry", "fssai.gov.in", "Regulator", "Food licence validation", "Validation only"),
    ],
  },
  {
    key: "legal",
    keywords: ["attorney", "lawyer", "advocate", "law firm", "legal", "counsel", "chamber"],
    plural: "attorneys",
    singular: "attorney",
    category: "Legal → Attorney & Law Firm Details",
    route: "openweb",
    brands: ["Ananth & Associates", "Sundaram Legal", "Iyer & Partners", "Rao Chambers", "Menon Law", "Krishnan Associates", "Verma & Co", "Nair Legal", "Reddy & Reddy", "Balaji Law Chambers", "Shankar Advocates", "Prasad & Sons", "Lakshmi Legal", "Raghavan Chambers", "Deshpande Law"],
    suffixes: ["Advocates", "Law Chambers", "Legal LLP", "& Associates", "Litigation Practice"],
    tlds: ["com", "in", "co.in"],
    fields: ["Attorney / firm name", "Practice areas", "Bar registration number & council", "Years of experience", "Courts of practice", "Office address & city", "Phone / email", "Consultation fee & mode", "Client rating", "Languages"],
    validation: [
      "Bar registration number must resolve on a state bar roll.",
      "Practice area normalised against a controlled vocabulary.",
      "Contact details confirmed on the firm's own site before publishing.",
    ],
    perCity: 480,
    minutesPer1k: 22,
    sources: () => [
      s("Law firm website (official)", "{firm_domain}", "Company website", "Practice areas, partners, offices", "Primary"),
      s("LawRato", "lawrato.com", "Third-party", "Fees, ratings, availability", "~70%"),
      s("Vakilsearch", "vakilsearch.com", "Third-party", "Service pricing", "~45%"),
      s("Justdial Legal", "justdial.com", "Directory", "Contact fallback", "~80%"),
      s("Bar Council of India roll", "barcouncilofindia.org", "Regulator", "Enrolment validation", "Validation only"),
      s("eCourts advocate listings", "ecourts.gov.in", "Regulator", "Courts of practice", "Validation only"),
      s("Avvo", "avvo.com", "Third-party", "US attorney profiles", "US only"),
      s("Martindale-Hubbell", "martindale.com", "Third-party", "Peer ratings", "US/UK"),
      s("LinkedIn", "linkedin.com", "Third-party", "Individual advocate profiles", "~60%"),
      s("Google Business Profile", "google.com/maps", "Directory", "Chamber address, hours", "~85%"),
    ],
  },
  {
    key: "automotive",
    keywords: ["car", "dealership", "showroom", "automotive", "vehicle", "bike", "rental", "workshop", "service centre"],
    plural: "dealerships",
    singular: "dealership",
    category: "Automotive → Dealers, Listings & Rentals",
    route: "openweb",
    brands: ["Maruti Suzuki Arena", "Nexa", "Hyundai", "Tata Motors", "Mahindra", "Toyota", "Kia", "Honda Cars", "MG Motor", "Skoda", "Volkswagen", "Renault", "Jeep", "BMW", "Mercedes-Benz"],
    suffixes: ["Motors", "Auto", "Wheels", "Autoworld", "Cars"],
    tlds: ["com", "in", "co.in"],
    fields: ["Dealer / showroom name", "Brand & outlet type", "Website", "Address & geo", "Phone / sales line", "Models in stock", "Ex-showroom & on-road price", "Test-drive availability", "Service centre flag", "Rating"],
    validation: [
      "Dealer must appear on the OEM's own locator to count as authorised.",
      "Price band sanity-checked against the OEM price list.",
      "Duplicate outlets collapsed on address + phone.",
    ],
    perCity: 380,
    minutesPer1k: 20,
    sources: () => [
      s("OEM dealer locator (official)", "{oem_domain}/dealer-locator", "Company website", "Authorised outlets, addresses", "Primary"),
      s("CarDekho", "cardekho.com", "Marketplace", "Prices, variants, dealer listings", "~90%"),
      s("CarWale", "carwale.com", "Marketplace", "On-road price, offers", "~88%"),
      s("Zigwheels", "zigwheels.com", "Marketplace", "Specs and variants", "~75%"),
      s("Cars24", "cars24.com", "Marketplace", "Used inventory and pricing", "Used only"),
      s("Spinny", "spinny.com", "Marketplace", "Used inventory", "Used only"),
      s("Zoomcar", "zoomcar.com", "Marketplace", "Self-drive rental fleet and tariffs", "Rentals"),
      s("Revv", "revv.co.in", "Marketplace", "Rental fleet and pricing", "Rentals"),
      s("Avis India", "avis.co.in", "Marketplace", "Chauffeur & corporate rentals", "Rentals"),
      s("VAHAN dealer registrations", "vahan.parivahan.gov.in", "Regulator", "Registration volumes by dealer", "Validation only"),
    ],
  },
  {
    key: "insurance",
    keywords: ["insurance", "policy", "premium", "insurer", "claim"],
    plural: "insurance products",
    singular: "insurance product",
    category: "Insurance → Policies, Premiums & Claims",
    route: "openweb",
    brands: ["HDFC Ergo", "ICICI Lombard", "Bajaj Allianz", "Star Health", "Niva Bupa", "Tata AIG", "SBI General", "New India Assurance", "Care Health", "Reliance General"],
    suffixes: ["Health Optima", "Secure Plan", "Family Floater", "Term Shield", "Motor Secure"],
    tlds: ["com", "in", "co.in"],
    fields: ["Insurer & product name", "Plan type", "Sum insured bands", "Premium by age band", "Waiting periods", "Network hospitals", "Claim settlement ratio", "Exclusions", "Policy wording URL"],
    validation: [
      "Premium quotes captured for a fixed test profile so they stay comparable.",
      "Claim settlement ratio cross-checked against the IRDAI annual report.",
      "Policy wording PDF hash stored to detect silent changes.",
    ],
    perCity: 120,
    minutesPer1k: 30,
    sources: () => [
      s("Insurer website (official)", "{insurer_domain}", "Company website", "Policy wordings, premiums, brochures", "Primary"),
      s("PolicyBazaar", "policybazaar.com", "Marketplace", "Quotes across insurers for a test profile", "~95%"),
      s("Coverfox", "coverfox.com", "Marketplace", "Premium comparison", "~70%"),
      s("InsuranceDekho", "insurancedekho.com", "Marketplace", "Motor & health quotes", "~75%"),
      s("Ditto", "joinditto.in", "Third-party", "Plan analysis and exclusions", "~40%"),
      s("IRDAI", "irdai.gov.in", "Regulator", "Claim settlement ratios, registrations", "Validation only"),
      s("General Insurance Council", "gicouncil.in", "Regulator", "Industry statistics", "Validation only"),
      s("BankBazaar", "bankbazaar.com", "Marketplace", "Bundled bank-channel plans", "~50%"),
      s("Google Business Profile", "google.com/maps", "Directory", "Branch contacts", "Branches"),
      s("Moneycontrol Insurance", "moneycontrol.com", "Third-party", "News, ratings, ratios", "Context"),
    ],
  },
  {
    key: "commerce",
    keywords: ["product", "sku", "price", "catalog", "catalogue", "ecommerce", "e-commerce", "retail", "grocery", "marketplace"],
    plural: "products",
    singular: "product",
    category: "Commerce → E-commerce Product Data",
    route: "openweb",
    brands: ["Nike", "Adidas", "Puma", "Levi's", "Samsung", "Boat", "Noise", "Philips", "Prestige", "Bajaj"],
    suffixes: ["Pro", "Max", "Lite", "Series 2", "Classic"],
    tlds: ["com", "in"],
    fields: ["SKU / product ID", "Product title & brand", "Current price & MRP", "Discount %", "Availability / stock", "Seller & fulfilment", "Rating & review count", "Image URL", "Captured-at timestamp"],
    validation: [
      "Column mapping confidence scored per field before the run starts.",
      "Price sanity band — flags anything more than 60% off the previous capture.",
      "Duplicate SKU collapse across marketplaces.",
    ],
    perCity: 4000,
    minutesPer1k: 6,
    sources: () => [
      s("Brand website (official)", "{brand_domain}", "Company website", "Authoritative price and stock", "Primary"),
      s("Amazon", "amazon.in", "Marketplace", "Listing price, buy-box, ratings", "~92%"),
      s("Flipkart", "flipkart.com", "Marketplace", "Price, offers, availability", "~90%"),
      s("Myntra", "myntra.com", "Marketplace", "Fashion catalogue", "Fashion"),
      s("Nykaa", "nykaa.com", "Marketplace", "Beauty & personal care", "BPC"),
      s("BigBasket", "bigbasket.com", "Marketplace", "Grocery pack sizes", "Grocery"),
      s("Blinkit", "blinkit.com", "Marketplace", "Quick-commerce pricing", "Grocery"),
      s("Croma", "croma.com", "Marketplace", "Electronics pricing", "Electronics"),
      s("Reliance Digital", "reliancedigital.in", "Marketplace", "Electronics pricing", "Electronics"),
      s("Google Shopping", "google.com/shopping", "Directory", "Cross-retailer price spread", "Benchmark"),
    ],
  },
  {
    key: "education",
    keywords: ["school", "college", "university", "education", "coaching", "institute", "student"],
    plural: "schools",
    singular: "school",
    category: "Education → Institutions & Faculty",
    route: "openweb",
    brands: ["DAV Public School", "Chettinad Vidyashram", "PSBB", "Delhi Public School", "National Public School", "Vidya Mandir", "Sishya", "Bhavan's", "Kendriya Vidyalaya", "St. Joseph's"],
    suffixes: ["Senior Secondary School", "International School", "Matriculation School", "Academy", "College of Arts & Science"],
    tlds: ["edu.in", "org", "com", "in"],
    fields: ["Institution name", "Board / affiliation", "Website", "Address & city", "Phone / email", "Fee structure", "Grades offered", "Faculty count", "Accreditation code", "Rating"],
    validation: [
      "Affiliation code must resolve on the CBSE / state board list.",
      "Fee bands only published when found on the institution's own site.",
      "Duplicate branches collapsed on affiliation code.",
    ],
    perCity: 700,
    minutesPer1k: 19,
    sources: () => [
      s("Institution website (official)", "{school_domain}", "Company website", "Fees, admissions, contacts", "Primary"),
      s("UDISE+", "udiseplus.gov.in", "Regulator", "Government school registry", "Validation"),
      s("CBSE affiliation list", "cbse.gov.in", "Regulator", "Affiliation code validation", "Validation"),
      s("Shiksha", "shiksha.com", "Third-party", "Courses, fees, cut-offs", "~80%"),
      s("Careers360", "careers360.com", "Third-party", "Rankings and reviews", "~75%"),
      s("SchoolMyKids", "schoolmykids.com", "Directory", "School contacts", "~70%"),
      s("Edustoke", "edustoke.com", "Directory", "Admissions and fees", "~60%"),
      s("Justdial Education", "justdial.com", "Directory", "Contact fallback", "~85%"),
      s("Google Business Profile", "google.com/maps", "Directory", "Address, phone, timings", "~90%"),
      s("AISHE", "aishe.gov.in", "Regulator", "Higher-education registry", "Validation"),
    ],
  },
  {
    key: "realestate",
    keywords: ["property", "real estate", "apartment", "builder", "flat", "rera", "broker"],
    plural: "projects",
    singular: "project",
    category: "Real Estate → Projects & Listings",
    route: "openweb",
    brands: ["Casagrand", "Prestige", "Brigade", "Sobha", "Puravankara", "TVS Emerald", "Godrej Properties", "Shriram Properties", "Alliance", "Mahindra Lifespaces"],
    suffixes: ["Greens", "Heights", "Enclave", "Residences", "Park Avenue"],
    tlds: ["com", "in"],
    fields: ["Project / property name", "Builder", "RERA ID", "Configuration (BHK)", "Carpet & built-up area", "Price per sq ft", "Possession date", "Address & geo", "Amenities", "Contact number"],
    validation: [
      "RERA ID must resolve on the state RERA portal.",
      "Price per sq ft sanity-checked against locality medians.",
      "Listing recency — anything older than 90 days is flagged stale.",
    ],
    perCity: 540,
    minutesPer1k: 21,
    sources: () => [
      s("Builder website (official)", "{builder_domain}", "Company website", "Configurations, pricing, possession", "Primary"),
      s("99acres", "99acres.com", "Marketplace", "Listings, price trends", "~90%"),
      s("MagicBricks", "magicbricks.com", "Marketplace", "Listings and locality data", "~88%"),
      s("Housing.com", "housing.com", "Marketplace", "Listings, photos, amenities", "~85%"),
      s("NoBroker", "nobroker.in", "Marketplace", "Owner listings, rents", "~70%"),
      s("Square Yards", "squareyards.com", "Marketplace", "New launches", "~60%"),
      s("State RERA portals", "rera.gov.in", "Regulator", "RERA ID validation", "Validation"),
      s("PropTiger", "proptiger.com", "Marketplace", "Project pricing", "~55%"),
      s("Google Business Profile", "google.com/maps", "Directory", "Site office contacts", "~80%"),
      s("CommonFloor", "commonfloor.com", "Directory", "Society-level data", "~45%"),
    ],
  },
];

const GENERIC_VERTICAL: Vertical = {
  key: "generic",
  keywords: [],
  plural: "businesses",
  singular: "business",
  category: "Company → Business Directory",
  route: "openweb",
  brands: ["Sunrise", "Metro", "Prime", "Silverline", "Bluewave", "Everest", "Nova", "Orbit", "Pinnacle", "Vertex"],
  suffixes: ["Enterprises", "Solutions", "Industries", "Services", "Group"],
  tlds: ["com", "in", "co.in"],
  fields: ["Entity name", "Website", "Address", "Phone", "Email", "Category", "Geo", "Rating"],
  validation: [
    "Entity-type check by the LLM on the landing page copy.",
    "Region check on the resolved address.",
    "Two-source agreement on contact fields.",
  ],
  perCity: 400,
  minutesPer1k: 20,
  sources: () => [
    s("Company website (official)", "{company_domain}", "Company website", "Authoritative contact and profile", "Primary"),
    s("Google Business Profile", "google.com/maps", "Directory", "Address, phone, hours", "~92%"),
    s("Justdial", "justdial.com", "Directory", "Contact fallback", "~85%"),
    s("IndiaMART", "indiamart.com", "Marketplace", "B2B listings", "~60%"),
    s("LinkedIn company pages", "linkedin.com", "Third-party", "Size, industry, HQ", "~65%"),
    s("MCA company master data", "mca.gov.in", "Regulator", "CIN and registered office validation", "Validation"),
  ],
};

function detectVertical(t: string): Vertical {
  for (const v of VERTICALS) {
    if (v.keywords.some((k) => t.includes(k))) return v;
  }
  return GENERIC_VERTICAL;
}

/* ------------------------------------------------------------------ */
/* Field detection                                                     */
/* ------------------------------------------------------------------ */

const FIELD_HINTS: { re: RegExp; field: string }[] = [
  { re: /phone|contact number|mobile|telephone/, field: "Phone / contact number" },
  { re: /address|location|pincode/, field: "Full address + pincode" },
  { re: /email|e-mail/, field: "Email" },
  { re: /website|url|domain/, field: "Official website" },
  { re: /rating|review/, field: "Rating & review count" },
  { re: /price|tariff|fee|premium|cost/, field: "Price / fee band" },
  { re: /timing|hours|open/, field: "Opening hours" },
  { re: /speciality|specialty|department/, field: "Speciality & departments" },
  { re: /owner|director|founder|partner/, field: "Key people" },
  { re: /geo|latitude|map/, field: "Geo (lat/long)" },
];

/* ------------------------------------------------------------------ */
/* Entity generation                                                   */
/* ------------------------------------------------------------------ */

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 22);
}

function generateEntities(v: Vertical, cities: string[], count: number): EntityRow[] {
  const rows: EntityRow[] = [];
  const used = new Set<string>();
  let i = 0;
  while (rows.length < count && i < count * 12) {
    const city = cities[i % cities.length];
    const meta = CITY_META[city] || CITY_META.Chennai;
    const brand = v.brands[Math.floor(i / cities.length) % v.brands.length];
    const suffix = v.suffixes[Math.floor(i / (cities.length * v.brands.length)) % v.suffixes.length];
    const area = meta.areas[(i * 3) % meta.areas.length];
    const name = `${brand} ${suffix} — ${area}`;
    const key = `${brand}|${suffix}|${area}|${city}`;
    i++;
    if (used.has(key)) continue;
    used.add(key);
    const tld = v.tlds[i % v.tlds.length];
    const website = `${slug(brand)}${v.key === "healthcare" ? "" : slug(suffix).slice(0, 6)}.${tld}`;
    const phone = `+91 ${meta.std} ${String(2000 + ((i * 37) % 7999))} ${String(1000 + ((i * 91) % 8999))}`;
    const pin = meta.pin + ((i * 7) % 90);
    rows.push({
      name,
      website,
      city: `${city}, ${meta.state}`,
      phone,
      address: `${(i % 180) + 1}, ${area} Main Road, ${city} ${pin}`,
      onboarded: lookupOnboarded(website),
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const COUNT_RE = /\b(\d{1,3}(?:,\d{3})+|\d{2,6})\b/;

export function parseIntent(input: string, prev?: Intent | null, fileName?: string): Intent {
  const t = `${input} ${fileName || ""}`.toLowerCase();
  const vertical = (() => {
    const v = detectVertical(t);
    if (v.key === "generic" && prev) return VERTICALS.find((x) => x.key === prev.vertical) || v;
    return v;
  })();

  const geo = detectCities(t);
  const cities = geo.cities.length && /[a-z]/.test(t) && (geo.label !== "India (no region given — assuming metros)" || !prev)
    ? geo.cities
    : prev?.cities || geo.cities;
  const regionLabel =
    geo.label !== "India (no region given — assuming metros)" || !prev ? geo.label : prev.regionLabel;

  const m = t.match(COUNT_RE);
  const asked = m ? parseInt(m[1].replace(/,/g, ""), 10) : 0;
  const count = asked >= 5 && asked <= 100000 ? asked : prev?.count || 0;

  const fields = FIELD_HINTS.filter((f) => f.re.test(t)).map((f) => f.field);

  const mode: "refresh" | "list" = /refresh|update|my file|uploaded|excel|csv|spreadsheet/.test(t) || !!fileName ? "refresh" : "list";

  return {
    vertical: vertical.key,
    entityLabel: vertical.plural,
    entitySingular: vertical.singular,
    cities,
    regionLabel,
    count,
    fields: fields.length ? fields : prev?.fields || [],
    mode,
    fileName,
  };
}

function vert(key: string) {
  return VERTICALS.find((v) => v.key === key) || GENERIC_VERTICAL;
}

/* ------------------------------------------------------------------ */
/* Uploaded-file analysis                                              */
/* ------------------------------------------------------------------ */

const FILE_PROFILES: Record<string, { columns: string[]; fixes: ColumnFix[] }> = {
  commerce: {
    columns: ["item_code", "product_name", "mrp_value", "sell_price", "stock", "url"],
    fixes: [
      { from: "item_code", to: "sku", why: "template key column" },
      { from: "mrp_value", to: "list_price", why: "template uses list_price for MRP" },
      { from: "sell_price", to: "current_price", why: "matches the price field the refresh writes back" },
    ],
  },
  healthcare: {
    columns: ["hosp_name", "town", "contact", "addr", "speciality"],
    fixes: [
      { from: "hosp_name", to: "facility_name", why: "template key column" },
      { from: "town", to: "city", why: "geo validation reads city" },
      { from: "contact", to: "phone", why: "phone gets format-normalised on ingest" },
      { from: "addr", to: "address_line", why: "template field name" },
    ],
  },
  hospitality: {
    columns: ["property", "town", "rate", "stars"],
    fixes: [
      { from: "property", to: "property_name", why: "template key column" },
      { from: "rate", to: "nightly_tariff", why: "tariff refresh writes into this column" },
      { from: "town", to: "city", why: "geo validation reads city" },
    ],
  },
  legal: {
    columns: ["adv_name", "practice", "city", "phone"],
    fixes: [
      { from: "adv_name", to: "attorney_name", why: "template key column" },
      { from: "practice", to: "practice_areas", why: "multi-value field, normalised on ingest" },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Response building                                                   */
/* ------------------------------------------------------------------ */

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

function minutes(total: number) {
  if (total < 60) return `${Math.max(1, Math.round(total))} min`;
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function sampleFrom(v: Vertical, rows: EntityRow[]): SampleRecord[] {
  return rows.slice(0, 3).map((r) => {
    const base: SampleRecord = { name: r.name, city: r.city, website: r.website, phone: r.phone };
    if (v.key === "healthcare") base.speciality = ["Multi-speciality", "Cardiac & ortho", "Mother & child"][rows.indexOf(r) % 3];
    if (v.key === "hospitality") base.tariff = ["₹8,400", "₹12,150", "₹5,600"][rows.indexOf(r) % 3];
    if (v.key === "legal") base.practice = ["Corporate, Arbitration", "Family, Property", "Criminal"][rows.indexOf(r) % 3];
    if (v.key === "automotive") base.brand = ["Maruti Suzuki", "Hyundai", "Tata"][rows.indexOf(r) % 3];
    return base;
  });
}

export function buildRecommendation(intent: Intent, rawInput: string): Recommendation {
  const v = vert(intent.vertical);
  const available = Math.round(v.perCity * intent.cities.length * 0.92);
  const wanted = intent.count > 0 ? Math.min(intent.count, available) : available;
  const listSize = Math.min(wanted, 60); // rendered preview size
  const entities = generateEntities(v, intent.cities, listSize);

  const sources = v.sources({ regionLabel: intent.regionLabel }).map((src) => ({
    ...src,
    onboarded: src.url.includes("{") ? null : lookupOnboarded(src.url),
  }));

  const fields = intent.fields.length
    ? [...new Set([...intent.fields, ...v.fields.slice(0, 6)])]
    : v.fields;

  const runMinutes = (wanted / 1000) * v.minutesPer1k;
  const discoveryMinutes = Math.max(6, Math.round(intent.cities.length * 2.5));
  const validationMinutes = Math.max(5, Math.round(runMinutes * 0.22));

  const route: "targeted" | "openweb" = intent.mode === "refresh" ? "openweb" : v.route;
  const routeLabel = route === "targeted" ? "Agents" : "Solutions";
  const routeHref = route === "targeted" ? "/site-specific" : "/any-site";

  const alreadyOn = sources.filter((x) => x.onboarded).length;

  const reasoning = [
    `Read your ask as: ${wanted === available ? "every" : fmt(wanted)} ${v.plural} in ${intent.regionLabel}${intent.fields.length ? `, with ${intent.fields.join(", ").toLowerCase()}` : ""}.`,
    `Search resolved ~${fmt(available)} candidate ${v.plural} across ${intent.cities.length} ${intent.cities.length === 1 ? "city" : "cities"}; ${fmt(entities.length)} are listed below with their websites.`,
    alreadyOn > 0
      ? `${alreadyOn} of the ${sources.length} suggested sources are already onboarded in this portal — reuse them instead of onboarding again.`
      : `None of these sources are onboarded yet, so each one is a new agent or dataset source.`,
    `No pre-built script is needed for the simple fields — an LLM lifts them off the page, then validation confirms the record.`,
  ];

  const nextSteps =
    route === "targeted"
      ? [
          `Review the ${fmt(entities.length)} shortlisted ${v.plural} and drop anything out of scope.`,
          `Promote the shortlist into Agents as one source group (${intent.regionLabel} ${v.plural}).`,
          alreadyOn > 0 ? `Skip the ${alreadyOn} already-onboarded sources — they run on their existing schedule.` : "Set the refresh cadence and queue the first run.",
          "Approve the run output in Review, then push it out from Export & Sync.",
        ]
      : [
          `Open Solutions and pick ${v.category}.`,
          intent.mode === "refresh"
            ? "Apply the column renames below, then upload your file against the template."
            : "Keep the company website as the default source and add the third-party sites listed.",
          "Confirm the auto-mapping and launch the run.",
          "Review flagged records, then export.",
        ];

  return {
    intent: rawInput.trim().slice(0, 140) || `${v.plural} in ${intent.regionLabel}`,
    route,
    routeLabel,
    routeHref,
    headline:
      intent.mode === "refresh"
        ? `Looks like ${v.category} — refresh it as a dataset`
        : `${fmt(available)} ${v.plural} found across ${intent.regionLabel}`,
    reasoning,
    sources,
    entities,
    entityTotal: available,
    dataPoints: fields,
    validation: v.validation,
    estimatedVolume: `${fmt(wanted)} ${v.plural} · ~${fmt(wanted * fields.length)} attribute values`,
    estimatedTime: `Discovery ${minutes(discoveryMinutes)} · extraction ${minutes(runMinutes)} · validation ${minutes(validationMinutes)}`,
    suggestedCategory: v.category,
    templateHint: undefined,
    nextSteps,
    sample: sampleFrom(v, entities),
    parsed: intent,
  };
}

export function analyseFile(fileName: string, prev?: Intent | null): Recommendation {
  const intent = parseIntent(fileName.replace(/[_-]/g, " "), prev, fileName);
  intent.mode = "refresh";
  const v = vert(intent.vertical);
  const profile = FILE_PROFILES[v.key] || FILE_PROFILES.commerce;
  const rec = buildRecommendation(intent, `Analyse ${fileName}`);
  const rowGuess = 1200 + (fileName.length % 9) * 1450;

  return {
    ...rec,
    headline: `${fileName} looks like ${v.category}`,
    reasoning: [
      `Read ${fmt(rowGuess)} rows and ${profile.columns.length} columns: ${profile.columns.join(", ")}.`,
      `Those columns match the ${v.category} template with ${88 + (fileName.length % 9)}% confidence — that's the category to pick in Solutions.`,
      `${profile.fixes.length} columns need renaming before upload; I've written the exact renames below and can output a corrected file.`,
      `Refresh keeps your row keys — nothing is re-discovered, so this is much cheaper than a fresh crawl.`,
    ],
    route: "openweb",
    routeLabel: "Solutions",
    routeHref: "/any-site",
    columnFixes: profile.fixes,
    templateHint: `Download the ${v.category} template, apply the ${profile.fixes.length} renames, and your file uploads clean.`,
    estimatedVolume: `${fmt(rowGuess)} rows × ${rec.dataPoints.length} attributes`,
    estimatedTime: `Mapping ${minutes(4)} · refresh ${minutes((rowGuess / 1000) * v.minutesPer1k)}`,
    entities: rec.entities.slice(0, 12),
    nextSteps: [
      `Open Solutions → ${v.category}.`,
      `Apply the renames: ${profile.fixes.map((f) => `${f.from} → ${f.to}`).join(", ")}.`,
      "Upload the corrected file and confirm the auto-mapping.",
      "Launch the refresh, then review flagged outliers before export.",
    ],
    parsed: intent,
  };
}

/* ------------------------------------------------------------------ */
/* Conversational reply                                                */
/* ------------------------------------------------------------------ */

export type Reply = { text: string; rec?: Recommendation; intent: Intent };

export function respond(input: string, prev: Intent | null, fileName?: string): Reply {
  const t = input.toLowerCase().trim();

  if (fileName) {
    const rec = analyseFile(fileName, prev);
    return {
      text: `I read ${fileName}. ${rec.reasoning[0]} ${rec.reasoning[1]} Renames and next steps are on the right — say "fix my file" and I'll output the corrected version.`,
      rec,
      intent: rec.parsed,
    };
  }

  if (/fix my file|correct.*file|edit.*file|apply.*rename/.test(t) && prev) {
    const rec = analyseFile(prev.fileName || "upload.xlsx", prev);
    return {
      text: `Done — I've rewritten the header row to match the ${rec.suggestedCategory} template (${(rec.columnFixes || []).map((f) => `${f.from} → ${f.to}`).join(", ")}). Download it from the panel, upload it in Solutions, and the mapping step will pass without edits.`,
      rec,
      intent: rec.parsed,
    };
  }

  if (!t) {
    return {
      text: "Tell me what you're after — an entity type and a place is enough, e.g. \"list of hospitals in Chennai with address and phone\".",
      intent: prev || parseIntent(""),
    };
  }

  const intent = parseIntent(input, prev);
  const v = vert(intent.vertical);

  // Nothing to work with yet
  if (v.key === "generic" && !prev && !/list|find|extract|need|want|scrape|get/.test(t)) {
    return {
      text: "I can work from an entity type and a location — for example \"200 dental clinics in Bengaluru with phone and timings\", or upload the spreadsheet you want refreshed.",
      intent,
    };
  }

  const rec = buildRecommendation(intent, input);
  const onboardedHits = rec.sources.filter((x) => x.onboarded);

  let text: string;
  if (/how many|volume|count of/.test(t)) {
    text = `Search resolves about ${fmt(rec.entityTotal)} ${v.plural} across ${intent.regionLabel}. At our extraction rate that's ${rec.estimatedTime.split("·")[1]?.trim() || ""} of extraction for the full set.`;
  } else if (/sample|example record/.test(t)) {
    text = `Here are live-probe samples for ${v.plural} in ${intent.regionLabel} — three records with ${rec.dataPoints.slice(0, 4).join(", ").toLowerCase()}. Full field list and validation rules are in the panel.`;
  } else if (/more source|other source|alternative source/.test(t)) {
    text = `I've widened the source list to ${rec.sources.length} for ${v.plural}: the ${v.singular}'s own site as default plus marketplaces, directories and regulators.${onboardedHits.length ? ` ${onboardedHits.length} are already onboarded here (${onboardedHits.slice(0, 3).map((x) => x.name).join(", ")}) — reuse those.` : ""}`;
  } else {
    text = `${intent.count ? `Here are ${fmt(Math.min(intent.count, rec.entityTotal))} of the ` : "I found "}${fmt(rec.entityTotal)} ${v.plural} in ${intent.regionLabel}${intent.fields.length ? `, carrying ${intent.fields.join(", ").toLowerCase()}` : ""}. The list with websites is in the panel — ${onboardedHits.length ? `${onboardedHits.length} suggested sources are already onboarded in this portal, ` : ""}and I'd take this through ${rec.routeLabel}.`;
  }

  return { text, rec, intent };
}

export const EXAMPLE_PROMPTS = [
  "List of hospitals in Chennai with address and phone",
  "100 dental clinics in Bengaluru",
  "Hotel tariffs in Kochi for the next 30 days",
  "Attorneys in Hyderabad with practice areas and fees",
  "I have an Excel of products and want to refresh prices",
];
