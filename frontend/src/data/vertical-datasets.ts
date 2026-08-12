// Vertical dataset templates.
// Every vertical defaults to the company's OWN website as the primary source and
// then layers a wide list of third-party marketplaces, directories and regulators.

import type { Dataset, DatasetField, DatasetSource } from "./datasets";

const FREQ = ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "Custom"];

const out = (key: string, label: string, type: DatasetField["type"] = "string", group?: string): DatasetField => ({
  key,
  label,
  type,
  role: "output",
  group,
});

const inp = (key: string, label: string, required = false): DatasetField => ({
  key,
  label,
  type: "string",
  role: "input",
  ...(required ? { required: true } : {}),
});

const own = (label = "Company website (official)"): DatasetSource => ({
  name: label,
  url: "{company_domain}",
  kind: "Company website",
  attributes: 24,
});

const src = (name: string, url: string, kind: DatasetSource["kind"], attributes = 12, region?: string): DatasetSource => ({
  name,
  url,
  kind: kind as DatasetSource["kind"],
  attributes,
  ...(region ? { region } : {}),
});
export const VERTICAL_DATASETS: Dataset[] = [
  /* ───────────────── Healthcare ───────────────── */
  {
    id: "ds-healthcare-providers",
    name: "Hospitals, Clinics & Doctors",
    category: "Healthcare",
    tagline: "Providers, specialities, consult fees, accreditation",
    description:
      "Provider master for hospitals, clinics, diagnostic labs and individual practitioners — pulled from the hospital's own site first, then cross-verified against aggregators and medical councils.",
    icon: "Stethoscope",
    refreshDefault: "Weekly",
    refreshOptions: FREQ,
    rowsAvailable: "1.4M+ providers",
    coverage: 91,
    accuracy: 95,
    countriesCovered: 12,
    inputAttributes: [inp("provider_name", "Hospital / Doctor name", true), inp("city", "City / Region")],
    inputTemplateColumns: [
      inp("provider_name", "provider_name", true),
      inp("website", "website"),
      inp("city", "city"),
      inp("state", "state"),
      inp("speciality", "speciality"),
      inp("registration_no", "registration_no"),
    ],
    outputAttributes: [
      out("provider_name", "Provider Name", "string", "Identity"),
      out("provider_type", "Type (Hospital / Clinic / Lab)", "string", "Identity"),
      out("website", "Website", "url", "Identity"),
      out("speciality", "Speciality", "string", "Clinical"),
      out("departments", "Departments", "string", "Clinical"),
      out("bed_count", "Bed Count", "number", "Clinical"),
      out("doctors_count", "Doctors Listed", "number", "Clinical"),
      out("accreditation", "Accreditation (NABH / JCI)", "string", "Compliance"),
      out("registration_no", "Council Registration No.", "string", "Compliance"),
      out("address", "Address", "string", "Location"),
      out("city", "City", "string", "Location"),
      out("state", "State", "string", "Location"),
      out("pincode", "Pincode", "string", "Location"),
      out("latitude", "Latitude", "number", "Location"),
      out("longitude", "Longitude", "number", "Location"),
      out("phone", "Phone", "string", "Contact"),
      out("email", "Email", "email", "Contact"),
      out("emergency_number", "Emergency Number", "string", "Contact"),
      out("opening_hours", "Opening Hours", "string", "Contact"),
      out("consult_fee", "Consultation Fee", "number", "Commercial"),
      out("insurance_accepted", "Insurance / Cashless Panels", "string", "Commercial"),
      out("rating", "Patient Rating", "number", "Reputation"),
      out("review_count", "Review Count", "number", "Reputation"),
      out("source_url", "Source URL", "url", "Provenance"),
    ],
    sources: [
      own("Hospital / clinic website (official)"),
      src("Practo", "practo.com", "Third-party", 18),
      src("Apollo 24|7", "apollo247.com", "Third-party", 14),
      src("Lybrate", "lybrate.com", "Third-party", 12),
      src("Justdial Health", "justdial.com", "Directory", 12),
      src("Google Business Profile", "google.com/maps", "Directory", 14),
      src("Bajaj Finserv Health", "bajajfinservhealth.in", "Third-party", 10),
      src("Credihealth", "credihealth.com", "Third-party", 11),
      src("NABH accredited list", "nabh.co", "Regulator", 8),
      src("National Medical Commission registry", "nmc.org.in", "Regulator", 7),
      src("State health department directories", "nhm.gov.in", "Regulator", 9),
      src("Yelp Health", "yelp.com", "Directory", 8),
    ],
    workflowId: "wf-company-profile",
    sampleRow: {
      provider_name: "Kauvery Hospital, Chennai",
      speciality: "Multi-speciality",
      city: "Chennai",
      consult_fee: 700,
      accreditation: "NABH",
    },
  },
];