// ---------------------------------------------------------------------------
// State licensing advisory.
//
// Derived from the 50-state matrix in docs/State_Licensing_Comparison.xlsx
// (the "Comparison" tab). For each state it records whether Plumbing,
// Electrical, and HVAC are licensed at the STATE vs LOCAL level, the unlicensed
// dollar threshold, the written-contract law, and an "Early Bird implication"
// rating (favorable / caution / restrictive).
//
// This module is pure and dependency-free so it can run BOTH on the intake form
// (a live advisory as the customer picks a service + state) and on the server
// (to persist the assessment with the submission). It is advisory only — it
// never blocks a booking. Per the workbook's standing policy, electrical,
// plumbing, and HVAC are treated as "confirm-before-offer" everywhere; the
// three light-burden categories (appliances, basic repair, connectivity) carry
// no state-trade gate.
//
// NOT LEGAL ADVICE. Thresholds change and vary by city/county; several cells in
// the source are marked "verify". Confirm with each state board before acting.
// ---------------------------------------------------------------------------

import { LICENSING_DATA } from "./licensing-data";

/** How a trade is regulated in a given state. */
export type TradeRegulation = "state" | "local" | "mixed" | "none" | "unknown";

/** Early Bird workability rating for a state. */
export type LicensingImplication = "favorable" | "caution" | "restrictive";

export interface TradeRule {
  reg: TradeRegulation;
  /** True when the state offers a minor / like-for-like repair carve-out. */
  exempt: boolean;
  /** Verbatim cell from the source matrix. */
  note: string;
}

export interface StateLicensing {
  /** Two-letter USPS code. */
  code: string;
  name: string;
  implication: LicensingImplication;
  /** Dollar value below which general (non-trade) work needs no license. */
  unlicensedThreshold: string;
  trades: {
    plumbing: TradeRule;
    electrical: TradeRule;
    hvac: TradeRule;
  };
  /** Home-improvement / consumer contract law summary. */
  writtenContract: string;
  /** "Key notes" — the operator-facing explanation. */
  notes: string;
}

/** The regulated trades this advisory covers, mapped from service categories. */
export type RegulatedTrade = "plumbing" | "electrical" | "hvac";

/**
 * Map an app service category id (see lib/services.ts) to a regulated trade.
 * The three light-burden categories return null — no state-trade gate applies.
 */
export function categoryToTrade(categoryId: string): RegulatedTrade | null {
  switch (categoryId) {
    case "plumbing":
      return "plumbing";
    case "electrical":
      return "electrical";
    case "hvac":
      return "hvac";
    default:
      // appliance, repair, connectivity — lightest regulatory burden.
      return null;
  }
}

const TRADE_LABEL: Record<RegulatedTrade, string> = {
  plumbing: "plumbing",
  electrical: "electrical",
  hvac: "HVAC",
};

const LICENSED_PRO: Record<RegulatedTrade, string> = {
  plumbing: "licensed plumber",
  electrical: "licensed electrician",
  hvac: "licensed HVAC technician",
};

// Fast lookups by code and by lowercased name.
const BY_CODE = new Map<string, StateLicensing>();
const BY_NAME = new Map<string, StateLicensing>();
for (const s of LICENSING_DATA) {
  BY_CODE.set(s.code, s);
  BY_NAME.set(s.name.toLowerCase(), s);
}

/** All states, sorted by name — for building a <select>. */
export const STATES: ReadonlyArray<{ code: string; name: string }> =
  LICENSING_DATA.map((s) => ({ code: s.code, name: s.name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

/** Look up a state by USPS code (e.g. "AZ") or full name (e.g. "Arizona"). */
export function findState(stateCodeOrName: string): StateLicensing | null {
  const raw = (stateCodeOrName || "").trim();
  if (!raw) return null;
  if (raw.length === 2) return BY_CODE.get(raw.toUpperCase()) ?? null;
  return BY_NAME.get(raw.toLowerCase()) ?? null;
}

// USPS codes present in the dataset, for address parsing.
const CODE_SET = new Set(LICENSING_DATA.map((s) => s.code));

/**
 * Best-effort extraction of a US state from a free-text address. Recognizes a
 * trailing/again two-letter code ("…, TX 75001") or a full state name. Returns
 * the USPS code, or null if nothing confident is found. Never throws.
 */
export function parseStateFromAddress(address: string): string | null {
  const raw = (address || "").trim();
  if (!raw) return null;
  // Full name first (handles multi-word names like "New York").
  const lower = ` ${raw.toLowerCase()} `;
  for (const s of LICENSING_DATA) {
    if (lower.includes(` ${s.name.toLowerCase()} `)) return s.code;
  }
  // Two-letter code as a standalone, word-bounded token (so "IN" inside
  // "MAIN" doesn't match — only a free-standing "IN" does).
  const tokens = raw.toUpperCase().match(/\b[A-Z]{2}\b/g) || [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (CODE_SET.has(tokens[i])) return tokens[i];
  }
  return null;
}

/** One trade's advisory within a chosen state. */
export interface TradeAdvisory {
  trade: RegulatedTrade;
  tradeLabel: string;
  reg: TradeRegulation;
  /** Whether the work likely requires a licensed professional in this state. */
  requiresLicensedPro: boolean;
  message: string;
}

/** The full assessment for a (state, categories) pair. */
export interface LicensingAssessment {
  stateCode: string;
  stateName: string;
  implication: LicensingImplication;
  /** Regulated-trade advisories for the selected categories. */
  trades: TradeAdvisory[];
  /** True if any selected trade likely needs a licensed pro here. */
  requiresLicensedPro: boolean;
  /** Written-contract / consumer-law summary for this state. */
  writtenContract: string;
  /** Operator-facing note from the source matrix. */
  notes: string;
}

function tradeMessage(
  state: StateLicensing,
  trade: RegulatedTrade,
  rule: TradeRule,
): { requiresLicensedPro: boolean; message: string } {
  const label = TRADE_LABEL[trade];
  const pro = LICENSED_PRO[trade];

  if (rule.reg === "none") {
    return {
      requiresLicensedPro: false,
      message: `${state.name} does not separately license ${label} at the state level — an Early Bird technician can typically handle this.`,
    };
  }
  if (rule.reg === "local") {
    return {
      requiresLicensedPro: false,
      message: `${label[0].toUpperCase()}${label.slice(1)} is regulated locally in ${state.name} (city/county), not statewide — rules vary by municipality.`,
    };
  }

  // state / mixed / unknown → treat as needing a licensed pro (confirm-before-offer).
  if (rule.exempt) {
    return {
      requiresLicensedPro: true,
      message: `${state.name} state-licenses ${label}, but allows a minor / like-for-like repair carve-out (${state.unlicensedThreshold}). Small repairs may be in scope; anything beyond is routed to a ${pro}.`,
    };
  }
  // State-licensed with no per-trade carve-out in the source cell. Some states
  // (e.g. Arizona) have a general unlicensed dollar cap that also covers trades;
  // that nuance lives in prose, so we surface the cap rather than assert "no
  // exemption," and always route the repair itself to a licensed pro.
  const hasDollarCap = /\$/.test(state.unlicensedThreshold);
  const capNote = hasDollarCap
    ? ` (state unlicensed cap: ${state.unlicensedThreshold} — confirm whether it covers this trade)`
    : "";
  return {
    requiresLicensedPro: true,
    message: `${state.name} state-licenses ${label}${capNote}. Early Bird can diagnose, but the repair is routed to a ${pro}.`,
  };
}

/**
 * Assess licensing for a chosen state and the customer's selected service
 * categories. Returns null when the state is unknown. Order of `categoryIds`
 * is preserved; duplicate trades are collapsed.
 */
export function assessLicensing(
  stateCodeOrName: string,
  categoryIds: string[],
): LicensingAssessment | null {
  const state = findState(stateCodeOrName);
  if (!state) return null;

  const seen = new Set<RegulatedTrade>();
  const trades: TradeAdvisory[] = [];
  for (const id of categoryIds) {
    const trade = categoryToTrade(id);
    if (!trade || seen.has(trade)) continue;
    seen.add(trade);
    const rule = state.trades[trade];
    const { requiresLicensedPro, message } = tradeMessage(state, trade, rule);
    trades.push({
      trade,
      tradeLabel: TRADE_LABEL[trade],
      reg: rule.reg,
      requiresLicensedPro,
      message,
    });
  }

  return {
    stateCode: state.code,
    stateName: state.name,
    implication: state.implication,
    trades,
    requiresLicensedPro: trades.some((t) => t.requiresLicensedPro),
    writtenContract: state.writtenContract,
    notes: state.notes,
  };
}
