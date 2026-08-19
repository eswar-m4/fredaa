// Lively per-category artwork used on dataset tiles.
// Gradient + icon + short vertical-specific language.

export type CategoryArt = {
  icon: string; // lucide icon name
  gradient: string; // tailwind gradient classes
  accent: string; // text colour on light chips
  chip: string; // chip background
  blurb: string; // vertical-specific language
};

export const CATEGORY_ART: Record<string, CategoryArt> = {
  Healthcare: {
    icon: "Stethoscope",
    gradient: "from-teal-500 via-emerald-500 to-cyan-600",
    accent: "text-teal-700",
    chip: "bg-teal-50 text-teal-700",
    blurb: "Wards, specialities and consult desks",
  },
  Hospitality: {
    icon: "UtensilsCrossed",
    gradient: "from-orange-500 via-amber-500 to-rose-500",
    accent: "text-amber-700",
    chip: "bg-amber-50 text-amber-700",
    blurb: "Front desks, kitchens and tariff boards",
  },
  Legal: {
    icon: "Scale",
    gradient: "from-slate-700 via-indigo-700 to-slate-900",
    accent: "text-indigo-700",
    chip: "bg-indigo-50 text-indigo-700",
    blurb: "Chambers, bar rolls and cause lists",
  },
  Insurance: {
    icon: "ShieldCheck",
    gradient: "from-sky-500 via-blue-600 to-indigo-700",
    accent: "text-sky-700",
    chip: "bg-sky-50 text-sky-700",
    blurb: "Policy wordings, premiums and claim ratios",
  },
  Automotive: {
    icon: "Car",
    gradient: "from-red-500 via-orange-600 to-zinc-800",
    accent: "text-red-700",
    chip: "bg-red-50 text-red-700",
    blurb: "Showrooms, engines and rental fleets",
  },
  Travel: {
    icon: "Plane",
    gradient: "from-cyan-500 via-sky-600 to-blue-700",
    accent: "text-cyan-700",
    chip: "bg-cyan-50 text-cyan-700",
    blurb: "Routes, rates and check-in windows",
  },
  Commerce: {
    icon: "ShoppingCart",
    gradient: "from-fuchsia-500 via-pink-500 to-rose-600",
    accent: "text-fuchsia-700",
    chip: "bg-fuchsia-50 text-fuchsia-700",
    blurb: "Carts, catalogues and price drops",
  },
  Competitive: {
    icon: "LineChart",
    gradient: "from-violet-500 via-purple-600 to-indigo-700",
    accent: "text-violet-700",
    chip: "bg-violet-50 text-violet-700",
    blurb: "Shelf prices against the field",
  },
  Company: {
    icon: "Building2",
    gradient: "from-blue-600 via-indigo-600 to-slate-800",
    accent: "text-blue-700",
    chip: "bg-blue-50 text-blue-700",
    blurb: "Registered offices and filings",
  },
  People: {
    icon: "Users",
    gradient: "from-emerald-500 via-teal-600 to-sky-700",
    accent: "text-emerald-700",
    chip: "bg-emerald-50 text-emerald-700",
    blurb: "Titles, desks and direct lines",
  },
  Education: {
    icon: "GraduationCap",
    gradient: "from-amber-500 via-yellow-500 to-orange-600",
    accent: "text-amber-700",
    chip: "bg-amber-50 text-amber-700",
    blurb: "Districts, faculty and rosters",
  },
  Financial: {
    icon: "BarChart3",
    gradient: "from-emerald-600 via-green-600 to-teal-700",
    accent: "text-emerald-700",
    chip: "bg-emerald-50 text-emerald-700",
    blurb: "Statements, filings and funding rounds",
  },
  "Real Estate": {
    icon: "Home",
    gradient: "from-stone-600 via-amber-700 to-orange-800",
    accent: "text-orange-800",
    chip: "bg-orange-50 text-orange-800",
    blurb: "Projects, carpet areas and RERA IDs",
  },
  Location: {
    icon: "MapPin",
    gradient: "from-rose-500 via-red-500 to-orange-600",
    accent: "text-rose-700",
    chip: "bg-rose-50 text-rose-700",
    blurb: "Storefronts, pins and opening hours",
  },
  Jobs: {
    icon: "Briefcase",
    gradient: "from-indigo-500 via-blue-600 to-cyan-700",
    accent: "text-indigo-700",
    chip: "bg-indigo-50 text-indigo-700",
    blurb: "Openings, salary bands and hiring pace",
  },
  "News & Media": {
    icon: "Newspaper",
    gradient: "from-zinc-600 via-slate-700 to-neutral-900",
    accent: "text-slate-700",
    chip: "bg-slate-100 text-slate-700",
    blurb: "Headlines, mentions and intent signals",
  },
};

export const DEFAULT_ART: CategoryArt = {
  icon: "Database",
  gradient: "from-slate-500 via-slate-600 to-slate-800",
  accent: "text-slate-700",
  chip: "bg-slate-100 text-slate-700",
  blurb: "Structured records, refreshed on schedule",
};

export function categoryArt(category: string): CategoryArt {
  return CATEGORY_ART[category] || DEFAULT_ART;
}
