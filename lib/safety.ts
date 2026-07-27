// ---------------------------------------------------------------------------
// Emergency safety detection.
//
// A pure, dependency-free scanner used LIVE on the intake form (as the customer
// types) to surface a 911 / emergency disclaimer. It errs toward warning: the
// message is conditional ("if this is an emergency…"), so an over-trigger is
// harmless while a miss could be dangerous. Kept framework-agnostic so it runs
// client-side without pulling in any server code.
// ---------------------------------------------------------------------------

export interface SafetyGroup {
  code: string;
  label: string;
  terms: string[];
}

// Grouped so the disclaimer can tailor its guidance (e.g. gas → gas utility).
export const SAFETY_GROUPS: SafetyGroup[] = [
  {
    code: "fire",
    label: "fire or smoke",
    terms: [
      "on fire",
      "fire",
      "flames",
      "flame",
      "smoking",
      "smoke",
      "burning",
      "burning smell",
      "explosion",
      "explode",
      "exploded",
    ],
  },
  {
    code: "gas",
    label: "a gas leak",
    terms: [
      "gas odor",
      "gas smell",
      "smell gas",
      "smell of gas",
      "smelling gas",
      "gas leak",
      "leaking gas",
      "rotten egg",
      "rotten eggs",
      "propane leak",
    ],
  },
  {
    code: "electrical",
    label: "an electrical hazard",
    terms: [
      "sparking",
      "sparks",
      "spark",
      "arcing",
      "arc",
      "shock",
      "shocked",
      "shocking",
      "electrocuted",
      "electrocution",
      "live wire",
      "exposed wire",
    ],
  },
  {
    code: "air",
    label: "dangerous fumes",
    terms: [
      "noxious",
      "carbon monoxide",
      "co detector",
      "can't breathe",
      "cannot breathe",
      "trouble breathing",
      "fumes",
      "toxic",
      "poisonous",
    ],
  },
  {
    code: "flood",
    label: "active flooding",
    terms: ["flooding", "flood", "gushing", "burst pipe"],
  },
];

export interface SafetyDetection {
  triggered: boolean;
  codes: string[];
  labels: string[];
  matched: string[];
}

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ")} `;
}

/** Scan free text for emergency safety terms (whole-word / phrase match). */
export function detectSafety(text: string): SafetyDetection {
  const hay = normalize(text || "");
  const codes = new Set<string>();
  const labels = new Set<string>();
  const matched: string[] = [];

  for (const group of SAFETY_GROUPS) {
    for (const term of group.terms) {
      if (hay.includes(` ${term} `)) {
        codes.add(group.code);
        labels.add(group.label);
        matched.push(term);
      }
    }
  }

  return {
    triggered: codes.size > 0,
    codes: [...codes],
    labels: [...labels],
    matched,
  };
}
